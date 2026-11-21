import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {acquireProjectLock} from '../src/core/project-lock.ts';
import {loadCoreCheckpoint,saveCoreCheckpoint} from '../src/core/checkpoint-store.ts';
import {reviewAndCheckpointQuality} from '../src/core/review-quality-handoff.ts';
import {requireReviewedEvidenceProof,saveReviewedEvidenceProof} from '../src/core/review-approval-proof.ts';

const issue={number:12,title:'Test',body:'Preserve guard'};
const plan={summary:'Plan',steps:['review']};
const build={summary:'Build'};
const PASS='AUTODEV_JSON_BEGIN\n'+JSON.stringify({
 verdict:'PASS',blockers:0,summary:'Reviewed',
})+'\nAUTODEV_JSON_END';
const FAIL='AUTODEV_JSON_BEGIN\n'+JSON.stringify({
 verdict:'FAIL',blockers:1,feedback:'Missing guard',
})+'\nAUTODEV_JSON_END';
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'autodev-review-proof-'));
 const project=path.join(root,'project');fs.mkdirSync(project);
 const base=path.join(root,'studio'),lock=acquireProjectLock(base,project);
 const git={head:'a'.repeat(40),branch:'autodev/issue-12',worktreeHash:'b'.repeat(64)};
 saveCoreCheckpoint(base,project,lock.record.token,{
  runId:randomUUID(),issueNumber:12,stage:'review',git,
  sessions:{reviewer:'session-123456789'},reviewPassed:false,qualityPassed:false,
 },null);
 const deps={capture:async()=>({...git}),evidence:async()=>({
   identity:git,fingerprint:'c'.repeat(64),status:' M file.ts',
   unstagedDiff:'diff --git a/file.ts b/file.ts\n+check();',
   stagedDiff:'',recentCommits:'abc',
 })};
 const run=async(output=PASS)=>reviewAndCheckpointQuality(base,project,
   lock.record.token,1,issue,plan,build,async()=>output,undefined,deps);
 const current=()=>loadCoreCheckpoint(base,project);
 return {root,project,base,lock,git,run,current,
   close:()=>{lock.release();fs.rmSync(root,{recursive:true,force:true})}};
}
test('review PASS persists exact content fingerprint and correct quality checkpoint',async()=>{
 const f=fixture();
 try{
  const result=await f.run();
  assert.equal(result.kind,'quality-pending');
  const proof=requireReviewedEvidenceProof(f.base,f.project,f.current(),f.git);
  assert.equal(proof.evidenceFingerprint,'c'.repeat(64));
  assert.equal(proof.checkpointRevision,2);
  assert.equal(proof.runId,f.current().runId);
  assert.equal(f.current().reviewPassed,true);
  assert.equal(f.current().qualityPassed,false);
 }finally{f.close();}
});
test('FAIL never creates approval proof or changes state',async()=>{
 const f=fixture();
 try{
  const result=await f.run(FAIL);
  assert.equal(result.kind,'fix-required');
  assert.equal(f.current().reviewPassed,false);
  assert.throws(()=>requireReviewedEvidenceProof(f.base,f.project,f.current(),f.git));
 }finally{f.close();}
});
test('missing proof after crash fails closed even if checkpoint says PASS',()=>{
 const f=fixture();
 try{
  const cp=f.current();
  saveCoreCheckpoint(f.base,f.project,f.lock.record.token,{
   runId:cp.runId,issueNumber:12,stage:'quality',
   git:f.git,sessions:cp.sessions,reviewPassed:true,qualityPassed:false,
  },1);
  assert.throws(()=>requireReviewedEvidenceProof(f.base,f.project,f.current(),f.git),
   /missing or corrupt/);
 }finally{f.close();}
});
test('stale revision and changed worktree cannot reuse previous review proof',async()=>{
 const f=fixture();
 try{
  await f.run();
  const previous=f.current();
  assert.throws(()=>requireReviewedEvidenceProof(f.base,f.project,previous,
    {...f.git,worktreeHash:'d'.repeat(64)}),/invalid for current quality/);
  const next=saveCoreCheckpoint(f.base,f.project,f.lock.record.token,{
   runId:previous.runId,issueNumber:12,stage:'quality',git:f.git,
   sessions:previous.sessions,reviewPassed:true,qualityPassed:false,
  },previous.revision);
  assert.throws(()=>requireReviewedEvidenceProof(f.base,f.project,next,f.git),
   /stale or mismatched/);
 }finally{f.close();}
});
test('tampered proof, unauthorized writer and arbitrary content are rejected',async()=>{
 const f=fixture();
 try{
  await f.run();
  const proofDir=path.join(f.base,'review-proofs');
  const file=path.join(proofDir,fs.readdirSync(proofDir)[0]);
  assert.throws(()=>saveReviewedEvidenceProof(f.base,f.project,'wrong',f.current(),'e'.repeat(64)),
    /owned project lock/);
  fs.writeFileSync(file,'{not-json');
  assert.throws(()=>requireReviewedEvidenceProof(f.base,f.project,f.current(),f.git),
    /missing or corrupt/);
 }finally{f.close();}
});
