import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {acquireProjectLock} from '../src/core/project-lock.ts';
import {loadCoreCheckpoint,saveCoreCheckpoint} from '../src/core/checkpoint-store.ts';
import {reviewAndCheckpointQuality} from '../src/core/review-quality-handoff.ts';

const json=v=>'AUTODEV_JSON_BEGIN\n'+JSON.stringify(v==='PASS'
 ?{verdict:'PASS',blockers:0,summary:'Looks correct'}
 :{verdict:'FAIL',blockers:1,feedback:'Permission bypass'})+'\nAUTODEV_JSON_END';
const issue={number:77,title:'Synthetic review',body:'Preserve authorization'};
const plan={summary:'Check access',steps:['Review diff']};
const build={summary:'Implementation complete'};
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'autodev-quality-handoff-'));
 const project=path.join(root,'project');fs.mkdirSync(project);
 const base=path.join(root,'studio'),lock=acquireProjectLock(base,project);
 const git={head:'a'.repeat(40),branch:'autodev/issue-77',worktreeHash:'b'.repeat(64)};
 const cp=saveCoreCheckpoint(base,project,lock.record.token,{
   runId:randomUUID(),issueNumber:77,stage:'review',git,
   sessions:{reviewer:'session-1234567890'},reviewPassed:false,qualityPassed:false,
 },null);
 const evidence={identity:git,fingerprint:'c'.repeat(64),status:' M src/fixture.ts',
  unstagedDiff:'diff --git a/src/fixture.ts b/src/fixture.ts\n+return hasPermission;',
  stagedDiff:'',recentCommits:'a1 baseline'};
 const deps={capture:async()=>({...git}),evidence:async()=>evidence};
 const run=(value='PASS',other=deps,token=lock.record.token)=>
  reviewAndCheckpointQuality(base,project,token,1,issue,plan,build,async()=>json(value),undefined,other);
 return {root,project,base,lock,git,cp,deps,run,
  close:()=>{lock.release();fs.rmSync(root,{recursive:true,force:true})}};
}
test('review PASS advances to quality-pending, never quality-PASS or publish',async()=>{
 const f=fixture();
 try{
  const result=await f.run();
  assert.equal(result.kind,'quality-pending');
  assert.equal(result.publishAuthorized,false);
  assert.equal(result.reviewedFingerprint,'c'.repeat(64));
  assert.equal(result.checkpointRevision,2);
  const cp=loadCoreCheckpoint(f.base,f.project);
  assert.equal(cp.stage,'quality');
  assert.equal(cp.reviewPassed,true);
  assert.equal(cp.qualityPassed,false);
  assert.equal(cp.revision,2);
  assert.deepEqual(cp.git,f.git);
 }finally{f.close();}
});
test('review FAIL never grants PASS or modifies checkpoint',async()=>{
 const f=fixture();
 try{
  const result=await f.run('FAIL');
  assert.equal(result.kind,'fix-required');
  assert.match(result.feedback,/Permission bypass/);
  assert.equal(result.publishAuthorized,false);
  const cp=loadCoreCheckpoint(f.base,f.project);
  assert.equal(cp.revision,1);
  assert.equal(cp.stage,'review');
  assert.equal(cp.reviewPassed,false);
 }finally{f.close();}
});
test('quality handoff rejects repository changes after verdict',async()=>{
 const f=fixture();let captures=0;
 try{
  const deps={...f.deps,capture:async()=>({...f.git,worktreeHash:
    ++captures===3?'d'.repeat(64):f.git.worktreeHash})};
  await assert.rejects(f.run('PASS',deps),/Repository drift during quality handoff/);
  assert.equal(loadCoreCheckpoint(f.base,f.project).revision,1);
 }finally{f.close();}
});
test('handoff cannot promote when lock changes or checkpoint revision is stale',async()=>{
 const f=fixture();
 try{
  await assert.rejects(f.run('PASS',f.deps,'invalid-lock'),/exclusive project lock/);
  const result=await f.run();
  assert.equal(result.kind,'quality-pending');
  await assert.rejects(f.run(),/checkpoint invalid/);
 }finally{f.close();}
});
test('checkpoint modification during inference invalidates PASS and preserves quality gate',async()=>{
 const f=fixture();
 try{
  await assert.rejects(reviewAndCheckpointQuality(f.base,f.project,f.lock.record.token,
    1,issue,plan,build,async()=>{
      saveCoreCheckpoint(f.base,f.project,f.lock.record.token,{
        runId:f.cp.runId,issueNumber:77,stage:'review',git:f.git,
        sessions:f.cp.sessions,reviewPassed:false,qualityPassed:false,
      },1);
      return json('PASS');
    },undefined,f.deps),/Checkpoint changed during review/);
  const cp=loadCoreCheckpoint(f.base,f.project);
  assert.equal(cp.stage,'review');
  assert.equal(cp.reviewPassed,false);
 }finally{f.close();}
});
