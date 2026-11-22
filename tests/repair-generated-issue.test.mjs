import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {acquireProjectLock} from '../src/core/project-lock.ts';
import {captureGitIdentity} from '../src/core/git-identity.ts';
import {saveCoreCheckpoint,loadCoreCheckpoint} from '../src/core/checkpoint-store.ts';
import {repairGeneratedIssue} from '../src/core/repair-generated-issue.ts';
import {repairAttempts} from '../src/core/repair-budget.ts';

const issue={number:8,title:'Fix bad result',body:'Return the correct value'};
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'autodev-repair-'));
 const project=path.join(root,'repo'),base=path.join(root,'studio');
 fs.mkdirSync(path.join(project,'src'),{recursive:true});
 const file=path.join(project,'src','code.ts');
 fs.writeFileSync(file,'export const value = 1;\n');
 const git=(...args)=>execFileSync('git',args,{cwd:project,encoding:'utf8'}).trim();
 git('init','-b','main');
 git('config','user.name','Tests');
 git('config','user.email','tests@example.org');
 git('add','.');
 git('commit','-m','base');
 git('switch','-c','autodev/issue-8');
 fs.writeFileSync(file,'export const value = 2;\n');
 return {root,project,base,file,git,close:()=>fs.rmSync(root,{recursive:true,force:true})};
}
async function checkpoint(f,stage='review',reviewPassed=false){
 const token=acquireProjectLock(f.base,f.project);
 const old=loadCoreCheckpoint(f.base,f.project);
 const git=await captureGitIdentity(f.project);
 const cp=saveCoreCheckpoint(f.base,f.project,token.record.token,{
  runId:old?.runId??randomUUID(),issueNumber:8,stage,
  git,sessions:{},reviewPassed,qualityPassed:false,
 },old?.revision??null);
 token.release();
 return cp;
}
test('repair actually changes one source file and revokes all approvals',async()=>{
 const f=fixture();
 try{
  await checkpoint(f,'quality',true);
  const old=loadCoreCheckpoint(f.base,f.project);
  const result=await repairGeneratedIssue(f.base,f.project,issue,'test expected 3',
    undefined,async()=>JSON.stringify({search:'value = 2',replace:'value = 3'}));
  assert.equal(result.attempt,1);
  assert.equal(result.checkpointRevision,old.revision+1);
  assert.equal(result.published,false);
  assert.equal(fs.readFileSync(f.file,'utf8'),'export const value = 3;\n');
  const cp=loadCoreCheckpoint(f.base,f.project);
  assert.equal(cp.stage,'review');
  assert.equal(cp.reviewPassed,false);
  assert.equal(cp.qualityPassed,false);
  assert.equal(repairAttempts(f.base,f.project,cp.runId),1);
 }finally{f.close();}
});
test('two attempts maximum, even after process-like re-entry',async()=>{
 const f=fixture();
 try{
  await checkpoint(f);
  await repairGeneratedIssue(f.base,f.project,issue,'fix',undefined,
    async()=>JSON.stringify({search:'value = 2',replace:'value = 3'}));
  await repairGeneratedIssue(f.base,f.project,issue,'still wrong',undefined,
    async()=>JSON.stringify({search:'value = 3',replace:'value = 4'}));
  await assert.rejects(repairGeneratedIssue(f.base,f.project,issue,'third try',
    undefined,async()=>JSON.stringify({search:'value = 4',replace:'value = 5'})),
    /limit reached/);
  assert.equal(fs.readFileSync(f.file,'utf8'),'export const value = 4;\n');
 }finally{f.close();}
});
test('invalid model patch consumes budget but never modifies source',async()=>{
 const f=fixture();try{
  await checkpoint(f);
  await assert.rejects(repairGeneratedIssue(f.base,f.project,issue,'fix',undefined,
    async()=>JSON.stringify({search:'missing',replace:'new'})),/not unique/);
  assert.equal(fs.readFileSync(f.file,'utf8'),'export const value = 2;\n');
  const cp=loadCoreCheckpoint(f.base,f.project);
  assert.equal(repairAttempts(f.base,f.project,cp.runId),1);
  assert.equal(cp.stage,'review');
 }finally{f.close();}
});
test('unexpected untracked file stops repair before model call and mutation',async()=>{
 const f=fixture();try{
  await checkpoint(f);
  fs.writeFileSync(path.join(f.project,'unexpected.txt'),'surprise');
  let called=false;
  await assert.rejects(repairGeneratedIssue(f.base,f.project,issue,'fix',
    undefined,async()=>{called=true;return '{}'}),/Git tree differs/);
  assert.equal(called,false);
 }finally{f.close();}
});
