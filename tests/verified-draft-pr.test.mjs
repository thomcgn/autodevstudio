import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {acquireProjectLock,projectLockDirectoryExists} from '../src/core/project-lock.ts';
import {captureGitIdentity} from '../src/core/git-identity.ts';
import {saveCoreCheckpoint,loadCoreCheckpoint} from '../src/core/checkpoint-store.ts';
import {saveReviewedEvidenceProof} from '../src/core/review-approval-proof.ts';
import {publishVerifiedDraftPullRequest} from '../src/core/verified-draft-pr.ts';

const FILE='src/change.ts';
function git(cwd,...args){return execFileSync('git',args,{cwd,encoding:'utf8'});}
async function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'autodev-pr-publish-'));
 const project=path.join(root,'repo');fs.mkdirSync(path.join(project,'src'),{recursive:true});
 fs.writeFileSync(path.join(project,FILE),'export const value = 1;\n');
 git(project,'init','-b','main');
 git(project,'config','user.email','tests@example.org');
 git(project,'config','user.name','AutoDev Tests');
 git(project,'remote','add','origin','https://github.com/sample/project.git');
 git(project,'add','.');
 git(project,'commit','-m','base');
 git(project,'switch','-c','autodev/issue-5');
 fs.writeFileSync(path.join(project,FILE),'export const value = 2;\n');
 const base=path.join(root,'studio');
 const lock=acquireProjectLock(base,project);
 const identity=await captureGitIdentity(project);
 const runId=randomUUID();
 const initial=saveCoreCheckpoint(base,project,lock.record.token,{
  runId,issueNumber:5,stage:'review',git:identity,sessions:{},
  reviewPassed:false,qualityPassed:false,
 },null);
 const review=saveCoreCheckpoint(base,project,lock.record.token,{
  runId,issueNumber:5,stage:'quality',git:identity,sessions:{},
  reviewPassed:true,qualityPassed:false,
 },initial.revision);
 saveReviewedEvidenceProof(base,project,lock.record.token,review,'c'.repeat(64));
 saveCoreCheckpoint(base,project,lock.record.token,{
  runId,issueNumber:5,stage:'quality',git:identity,sessions:{},
  reviewPassed:true,qualityPassed:true,
 },review.revision);
 lock.release();
 const calls=[];
 const runner=async(bin,args,cwd)=>{
  calls.push({bin,args});
  if(bin==='gh'){
   assert.deepEqual(args.slice(0,3),['pr','create','--draft']);
   assert.equal(args.includes('--base'),true);
   assert.equal(args.includes('main'),true);
   return 'https://github.com/sample/project/pull/123\n';
  }
  if(args[0]==='push')return '';
  return git(cwd,...args);
 };
 return {root,project,base,calls,runner,
  close:()=>fs.rmSync(root,{recursive:true,force:true})};
}
test('real Git commit and mock push/draft PR only after reviewed quality PASS',async()=>{
 const f=await fixture();
 try{
  const old=git(f.project,'rev-parse','HEAD').trim();
  const result=await publishVerifiedDraftPullRequest(f.base,f.project,5,f.runner);
  assert.equal(result.draft,true);
  assert.equal(result.autoMerge,false);
  assert.equal(result.url,'https://github.com/sample/project/pull/123');
  assert.notEqual(git(f.project,'rev-parse','HEAD').trim(),old);
  assert.equal(git(f.project,'status','--porcelain'),'');
  assert.equal(git(f.project,'branch','--show-current').trim(),'autodev/issue-5');
  assert.equal(loadCoreCheckpoint(f.base,f.project).stage,'done');
  assert.equal(loadCoreCheckpoint(f.base,f.project).qualityPassed,true);
  assert.equal(f.calls.filter(x=>x.bin==='gh').length,1);
  assert.equal(f.calls.filter(x=>x.args[0]==='push').length,1);
  assert.equal(projectLockDirectoryExists(f.base,f.project),false);
 }finally{f.close();}
});
test('unreviewed or stale review certificate prevents any Git staging or push',async()=>{
 const f=await fixture();
 try{
  const proofs=path.join(f.base,'review-proofs');
  fs.writeFileSync(path.join(proofs,fs.readdirSync(proofs)[0]),'{}');
  await assert.rejects(publishVerifiedDraftPullRequest(f.base,f.project,5,f.runner),/Review proof/);
  assert.equal(f.calls.some(x=>x.args.includes('add')),false);
  assert.equal(f.calls.some(x=>x.args.includes('push')),false);
 }finally{f.close();}
});
test('extra working-tree changes refuse publication before any mutation',async()=>{
 const f=await fixture();
 try{
  fs.writeFileSync(path.join(f.project,'unknown.txt'),'not reviewed');
  await assert.rejects(publishVerifiedDraftPullRequest(f.base,f.project,5,f.runner),
    /Git identity drift/);
  assert.equal(f.calls.length,0);
 }finally{f.close();}
});
test('network push failure leaves post-commit checkpoint for explicit recovery',async()=>{
 const f=await fixture();
 try{
  const runner=async(bin,args,cwd)=>{
   if(args[0]==='push')throw Error('synthetic offline');
   if(bin==='gh')throw Error('PR must not be created after failed push');
   return git(cwd,...args);
  };
  await assert.rejects(publishVerifiedDraftPullRequest(f.base,f.project,5,runner),/offline/);
  const cp=loadCoreCheckpoint(f.base,f.project);
  assert.equal(cp.stage,'publish');
  assert.equal(cp.qualityPassed,true);
  assert.equal(git(f.project,'status','--porcelain'),'');
  await assert.rejects(publishVerifiedDraftPullRequest(f.base,f.project,5,runner),
    /No fully reviewed/);
 }finally{f.close();}
});
test('incorrect issue number refuses publication',async()=>{
 const f=await fixture();
 try{
  await assert.rejects(publishVerifiedDraftPullRequest(f.base,f.project,6,f.runner),
    /No fully reviewed/);
  assert.equal(f.calls.length,0);
 }finally{f.close();}
});
