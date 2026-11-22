import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {acquireProjectLock,projectLockDirectoryExists} from '../src/core/project-lock.ts';
import {saveCoreCheckpoint,loadCoreCheckpoint} from '../src/core/checkpoint-store.ts';
import {verifyGeneratedIssue} from '../src/core/verify-generated-issue.ts';

const issue={number:81,title:'Protect access',body:'Require permission check'};
const pass='AUTODEV_JSON_BEGIN\n'+JSON.stringify({
 verdict:'PASS',blockers:0,summary:'Exact diff has check',
})+'\nAUTODEV_JSON_END';
const fail='AUTODEV_JSON_BEGIN\n'+JSON.stringify({
 verdict:'FAIL',blockers:1,feedback:'Access check missing',
})+'\nAUTODEV_JSON_END';
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'autodev-generated-verification-'));
 const project=path.join(root,'repo');fs.mkdirSync(project);
 fs.writeFileSync(path.join(project,'package.json'),JSON.stringify({
  scripts:{typecheck:'node -v',test:'node -v'},
 }));
 const base=path.join(root,'studio');
 const git={head:'a'.repeat(40),branch:'autodev/issue-81',worktreeHash:'b'.repeat(64)};
 const lock=acquireProjectLock(base,project);
 const cp=saveCoreCheckpoint(base,project,lock.record.token,{
  runId:randomUUID(),issueNumber:81,stage:'review',git,
  sessions:{},reviewPassed:false,qualityPassed:false,
 },null);
 lock.release();
 const evidence={identity:git,fingerprint:'c'.repeat(64),status:' M src/code.ts',
  unstagedDiff:'diff --git a/src/code.ts b/src/code.ts\n+checkPermission();',
  stagedDiff:'',recentCommits:'abc baseline'};
 const called=[];
 const deps={
  reviewer:{capture:async()=>({...git}),evidence:async()=>evidence},
  quality:{capture:async()=>({...git}),
    runScript:async(_cwd,script)=>{called.push(script)}},
 };
 const run=(raw=pass,dependencies=deps,names=['typecheck','test'])=>
  verifyGeneratedIssue(base,project,issue,async()=>raw,names,undefined,dependencies);
 return {root,project,base,git,cp,called,deps,run,
  close:()=>fs.rmSync(root,{recursive:true,force:true})};
}
test('generated issue review PASS runs approved quality gates and leaves no publish permissions',async()=>{
 const f=fixture();
 try{
  const result=await f.run();
  assert.equal(result.kind,'quality-passed');
  assert.equal(result.publishAuthorized,false);
  assert.equal(result.issueNumber,81);
  assert.deepEqual(f.called,['typecheck','test']);
  const cp=loadCoreCheckpoint(f.base,f.project);
  assert.equal(cp.stage,'quality');
  assert.equal(cp.reviewPassed,true);
  assert.equal(cp.qualityPassed,true);
  assert.equal(cp.revision,3);
  assert.equal(projectLockDirectoryExists(f.base,f.project),false);
 }finally{f.close();}
});
test('review FAIL does not run scripts or set PASS',async()=>{
 const f=fixture();
 try{
  const result=await f.run(fail);
  assert.equal(result.kind,'review-failed');
  assert.match(result.feedback,/Access check/);
  assert.deepEqual(f.called,[]);
  const cp=loadCoreCheckpoint(f.base,f.project);
  assert.equal(cp.stage,'review');
  assert.equal(cp.reviewPassed,false);
  assert.equal(projectLockDirectoryExists(f.base,f.project),false);
 }finally{f.close();}
});
test('failed quality leaves review proof but does not publish or approve',async()=>{
 const f=fixture();
 try{
  const deps={...f.deps,quality:{...f.deps.quality,runScript:async()=>{
   throw Error('synthetic test failure');
  }}};
  const result=await f.run(pass,deps);
  assert.equal(result.kind,'quality-failed');
  assert.equal(result.publishAuthorized,false);
  const cp=loadCoreCheckpoint(f.base,f.project);
  assert.equal(cp.stage,'quality');
  assert.equal(cp.reviewPassed,true);
  assert.equal(cp.qualityPassed,false);
 }finally{f.close();}
});
test('missing or stale checkpoint, wrong issue and Git changes block model requests',async()=>{
 const f=fixture();let count=0;
 try{
  const transport=async()=>{count++;return pass};
  const badDeps={...f.deps,reviewer:{...f.deps.reviewer,
    capture:async()=>({...f.git,worktreeHash:'d'.repeat(64)})}};
  await assert.rejects(verifyGeneratedIssue(f.base,f.project,issue,transport,
    ['test'],undefined,badDeps),/Git tree changed/);
  await assert.rejects(verifyGeneratedIssue(f.base,f.project,{...issue,number:82},
    transport,['test'],undefined,f.deps),/No eligible generated issue/);
  assert.equal(count,0);
  await f.run();
  await assert.rejects(verifyGeneratedIssue(f.base,f.project,issue,transport,
    ['test'],undefined,f.deps),/No eligible generated issue/);
  assert.equal(count,0);
 }finally{f.close();}
});
test('occupied project lock aborts verification before provider',async()=>{
 const f=fixture(),lock=acquireProjectLock(f.base,f.project);
 try{
  await assert.rejects(f.run(),/locked by another run/);
  assert.deepEqual(f.called,[]);
 }finally{lock.release();f.close();}
});
