import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {acquireProjectLock} from '../src/core/project-lock.ts';
import {saveCoreCheckpoint} from '../src/core/checkpoint-store.ts';
import {runGuardedEvidenceReview} from '../src/core/guarded-evidence-review.ts';

const pass='AUTODEV_JSON_BEGIN\n'+JSON.stringify({verdict:'PASS',blockers:0,summary:'Safe patch'})+'\nAUTODEV_JSON_END';
const fail='AUTODEV_JSON_BEGIN\n'+JSON.stringify({verdict:'FAIL',blockers:1,feedback:'Missing permission guard'})+'\nAUTODEV_JSON_END';
const issue={number:55,title:'Synthetic issue',body:'Verify access'};
const plan={summary:'Review changes',steps:['Check permissions']};
const build={summary:'Updated code'};
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'autodev-review-git-guard-'));
 const project=path.join(root,'project');fs.mkdirSync(project);
 const base=path.join(root,'studio'),lock=acquireProjectLock(base,project);
 const git={head:'a'.repeat(40),branch:'autodev/issue-55',worktreeHash:'b'.repeat(64)};
 const checkpoint=saveCoreCheckpoint(base,project,lock.record.token,{
  runId:randomUUID(),issueNumber:55,stage:'review',git,
  sessions:{reviewer:'review-session-1234'},reviewPassed:false,qualityPassed:false,
 },null);
 const evidence={identity:git,fingerprint:'c'.repeat(64),status:' M fixture.ts',
  unstagedDiff:'diff --git a/fixture.ts b/fixture.ts\n+checkAccess();',
  stagedDiff:'',recentCommits:'abc synthetic'};
 const dependencies={capture:async()=>({...git}),evidence:async()=>evidence};
 const close=()=>{lock.release();fs.rmSync(root,{recursive:true,force:true})};
 const run=(transport=async()=>pass,other=dependencies,token=lock.record.token,revision=1,task=issue)=>
  runGuardedEvidenceReview(base,project,token,revision,task,plan,build,transport,undefined,other);
 return {root,base,project,lock,git,evidence,dependencies,checkpoint,run,close};
}
test('a model PASS remains a non-publishing report with exact checkpoint and evidence fingerprint',async()=>{
 const f=fixture();let calls=0;
 try{
  const outcome=await f.run(async request=>{
   calls++;assert.equal(request.issueNumber,55);
   assert.equal(request.fingerprint,'c'.repeat(64));
   assert.match(request.prompt,/checkAccess/);
   return pass;
  });
  assert.equal(calls,1);
  assert.equal(outcome.verdict.verdict,'PASS');
  assert.equal(outcome.publishAuthorized,false);
  assert.equal(outcome.checkpointRevision,1);
  assert.equal(outcome.evidenceFingerprint,'c'.repeat(64));
  assert.equal(f.checkpoint.reviewPassed,false);
 }finally{f.close();}
});
test('FAIL stays FAIL and does not mutate approval state',async()=>{
 const f=fixture();
 try{
  const outcome=await f.run(async()=>fail);
  assert.equal(outcome.verdict.verdict,'FAIL');
  assert.equal(outcome.publishAuthorized,false);
 }finally{f.close();}
});
test('lock, issue, checkpoint revision and prior approval must be valid before any model call',async()=>{
 const f=fixture();let calls=0;
 const transport=async()=>{calls++;return pass};
 try{
  await assert.rejects(f.run(transport,f.dependencies,'bad-token'),/exclusive project lock/);
  await assert.rejects(f.run(transport,f.dependencies,f.lock.record.token,2),/checkpoint invalid/);
  await assert.rejects(f.run(transport,f.dependencies,f.lock.record.token,1,{...issue,number:56}),/checkpoint invalid/);
  assert.equal(calls,0);
 }finally{f.close();}
});
test('changed repository after inference invalidates PASS',async()=>{
 const f=fixture();let captures=0;
 try{
  const deps={...f.dependencies,capture:async()=>({...f.git,worktreeHash:
    ++captures===1?f.git.worktreeHash:'e'.repeat(64)})};
  await assert.rejects(f.run(async()=>pass,deps),/Repository changed during reviewer inference/);
  assert.equal(captures,2);
 }finally{f.close();}
});
test('changed checkpoint revision during model call invalidates PASS',async()=>{
 const f=fixture();
 try{
  await assert.rejects(f.run(async()=>{
   saveCoreCheckpoint(f.base,f.project,f.lock.record.token,{
    runId:f.checkpoint.runId,issueNumber:55,stage:'review',
    git:f.git,sessions:f.checkpoint.sessions,reviewPassed:false,qualityPassed:false,
   },1);
   return pass;
  }),/Checkpoint changed during review/);
 }finally{f.close();}
});
test('evidence identity mismatch fails before transport',async()=>{
 const f=fixture();let called=false;
 try{
  const deps={...f.dependencies,evidence:async()=>({...f.evidence,
   identity:{...f.git,head:'d'.repeat(40)}})};
  await assert.rejects(f.run(async()=>{called=true;return pass},deps),/evidence does not match/);
  assert.equal(called,false);
 }finally{f.close();}
});
test('aborted review does not contact provider',async()=>{
 const f=fixture();const abort=new AbortController();abort.abort();let called=false;
 try{
  await assert.rejects(runGuardedEvidenceReview(f.base,f.project,f.lock.record.token,1,
   issue,plan,build,async()=>{called=true;return pass},abort.signal,f.dependencies),/cancelled/);
  assert.equal(called,false);
 }finally{f.close();}
});
