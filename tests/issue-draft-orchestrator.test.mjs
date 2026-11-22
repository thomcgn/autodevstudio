import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {acquireProjectLock} from '../src/core/project-lock.ts';
import {loadCoreCheckpoint,saveCoreCheckpoint} from '../src/core/checkpoint-store.ts';
import {runIssueToDraftPr} from '../src/core/issue-draft-orchestrator.ts';

const issue={number:14,title:'Fix synthetic bug',body:'Return correct value'};
const git={head:'a'.repeat(40),branch:'autodev/issue-14',worktreeHash:'b'.repeat(64)};
function fixture(stage=null,reviewPassed=false,qualityPassed=false){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'autodev-issue-coordinator-'));
 const project=path.join(root,'project');fs.mkdirSync(project);
 const base=path.join(root,'studio'),runId=randomUUID();
 if(stage){
  const lock=acquireProjectLock(base,project);
  saveCoreCheckpoint(base,project,lock.record.token,{
   runId,issueNumber:issue.number,stage,git,sessions:{},reviewPassed,qualityPassed,
  },null);
  lock.release();
 }
 const calls=[];
 function advance(stage,reviewPassed,qualityPassed){
  const lock=acquireProjectLock(base,project);
  const old=loadCoreCheckpoint(base,project);
  const next=saveCoreCheckpoint(base,project,lock.record.token,{
   runId:old?.runId??runId,issueNumber:issue.number,stage,git,sessions:{},
   reviewPassed,qualityPassed,
  },old?.revision??null);
  lock.release();
  return next;
 }
 const deps={
  build:async()=>{calls.push('build');const cp=advance('review',false,false);return {
   issueNumber:14,branch:git.branch,changedFile:'src/a.ts',
   runId,checkpointRevision:cp.revision,stage:'review',git,published:false,
  }},
  review:async()=>{calls.push('review');const cp=advance('quality',true,true);return {
   kind:'quality-passed',issueNumber:14,checkpointRevision:cp.revision,
   publishAuthorized:false,
  }},
  quality:async()=>{calls.push('quality');const cp=advance('quality',true,true);return {
   kind:'quality-passed',issueNumber:14,checkpointRevision:cp.revision,
   publishAuthorized:false,
  }},
  draft:async()=>{calls.push('draft');return {issueNumber:14,branch:git.branch,
   url:'https://github.com/example/project/pull/15',checkpointRevision:4,
   draft:true,autoMerge:false,
  }},
 };
 const run=(signal)=>runIssueToDraftPr(base,project,issue,async()=>'',[
  'typecheck','test'],signal,stage=>calls.push('stage:'+stage),deps);
 return {base,project,root,calls,deps,run,advance,
  close:()=>fs.rmSync(root,{recursive:true,force:true})};
}
test('one action chains real persisted build/review/quality checkpoints to draft',async()=>{
 const f=fixture();
 try{
  const result=await f.run();
  assert.equal(result.status,'draft-created');
  assert.equal(result.draftUrl,'https://github.com/example/project/pull/15');
  assert.equal(result.autoMerge,false);
  assert.deepEqual(f.calls,['stage:build','build','stage:review','review','stage:publish','draft']);
 }finally{f.close();}
});
test('resume at review skips builder and never repeats an existing issue branch',async()=>{
 const f=fixture('review');
 try{
  const r=await f.run();
  assert.equal(r.status,'draft-created');
  assert.deepEqual(f.calls,['stage:review','review','stage:publish','draft']);
 }finally{f.close();}
});
test('resume at quality runs only pending tests then draft',async()=>{
 const f=fixture('quality',true,false);
 try{
  const r=await f.run();
  assert.equal(r.status,'draft-created');
  assert.deepEqual(f.calls,['stage:quality','quality','stage:publish','draft']);
 }finally{f.close();}
});
test('existing quality PASS is not reviewed a second time',async()=>{
 const f=fixture('quality',true,true);
 try{
  await f.run();
  assert.deepEqual(f.calls,['stage:publish','draft']);
 }finally{f.close();}
});
test('review FAIL pauses with persisted review checkpoint, no publish',async()=>{
 const f=fixture('review');
 try{
  f.deps.review=async()=>{f.calls.push('review');return {
   kind:'review-failed',issueNumber:14,checkpointRevision:1,
   feedback:'Missing authorization',publishAuthorized:false,
  }};
  const r=await f.run();
  assert.equal(r.status,'paused');
  assert.equal(r.stage,'review');
  assert.match(r.reason,/authorization/);
  assert.equal(f.calls.includes('draft'),false);
 }finally{f.close();}
});
test('quality failure pauses and can resume after tests are fixed',async()=>{
 const f=fixture('quality',true,false);
 try{
  f.deps.quality=async()=>{f.calls.push('quality');return {
   kind:'quality-failed',issueNumber:14,checkpointRevision:1,
   feedback:'test failed',publishAuthorized:false,
  }};
  const r=await f.run();
  assert.equal(r.stage,'quality');
  assert.equal(r.status,'paused');
  assert.equal(f.calls.includes('draft'),false);
 }finally{f.close();}
});
test('publish and done checkpoint never retry network side effects',async()=>{
 for(const stage of ['publish','done']){
  const f=fixture(stage,true,true);
  try{
   const r=await f.run();
   assert.equal(r.status,'paused');
   assert.equal(r.stage,'publish');
   assert.deepEqual(f.calls,[]);
  }finally{f.close();}
 }
});
test('abort before publication blocks draft even if quality was completed',async()=>{
 const f=fixture('quality',true,true);
 const signal=new AbortController();signal.abort();
 try{
  await assert.rejects(f.run(signal.signal),/cancelled/);
  assert.deepEqual(f.calls,[]);
 }finally{f.close();}
});
test('foreign issue checkpoint blocks mutation and publication',async()=>{
 const f=fixture('review');
 try{
  const lock=acquireProjectLock(f.base,f.project);
  const cp=loadCoreCheckpoint(f.base,f.project);
  saveCoreCheckpoint(f.base,f.project,lock.record.token,{
   runId:cp.runId,issueNumber:15,stage:'review',
   git:{...git,branch:'autodev/issue-15'},sessions:{},
   reviewPassed:false,qualityPassed:false,
  },1);
  lock.release();
  await assert.rejects(f.run(),/Another issue owns/);
  assert.deepEqual(f.calls,[]);
 }finally{f.close();}
});

test('unknown shared Kilo quota pauses AFTER local code creation, without reviewer or publication',async()=>{
 const f=fixture();try{
  const outcome=await runIssueToDraftPr(f.base,f.project,issue,async()=>'',[
   'typecheck','test'],undefined,stage=>f.calls.push('stage:'+stage),
   f.deps,async()=>({ready:false,reason:'Provider quota unverified'}));
  assert.equal(outcome.status,'paused');
  assert.equal(outcome.stage,'review');
  assert.match(outcome.reason,/unverified/);
  assert.equal(loadCoreCheckpoint(f.base,f.project).stage,'review');
  assert.deepEqual(f.calls,['stage:build','build','stage:review']);
 }finally{f.close();}
});
test('approved reviewer after pause resumes without calling Builder twice',async()=>{
 const f=fixture('review');try{
  const result=await runIssueToDraftPr(f.base,f.project,issue,async()=>'',[
   'typecheck','test'],undefined,undefined,f.deps,
   async()=>({ready:true,reason:'Verified reviewer ready'}));
  assert.equal(result.status,'draft-created');
  assert.deepEqual(f.calls,['review','draft']);
 }finally{f.close();}
});
