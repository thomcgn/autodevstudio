import {readQualityRunReport} from '../src/core/quality-report.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {acquireProjectLock} from '../src/core/project-lock.ts';
import {saveCoreCheckpoint,loadCoreCheckpoint} from '../src/core/checkpoint-store.ts';
import {saveReviewedEvidenceProof} from '../src/core/review-approval-proof.ts';
import {verifyQualityForReviewedIssue} from '../src/core/reviewed-quality-gate.ts';

function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'autodev-quality-verify-'));
 const project=path.join(root,'project');
 fs.mkdirSync(project);
 fs.writeFileSync(path.join(project,'package.json'),JSON.stringify({
  scripts:{typecheck:'node -v',test:'node -v'},
 }));
 const base=path.join(root,'studio'),lock=acquireProjectLock(base,project);
 const git={head:'a'.repeat(40),branch:'autodev/issue-3',worktreeHash:'b'.repeat(64)};
 const cp=saveCoreCheckpoint(base,project,lock.record.token,{
  runId:randomUUID(),issueNumber:3,stage:'quality',git,
  sessions:{},reviewPassed:true,qualityPassed:false,
 },null);
 saveReviewedEvidenceProof(base,project,lock.record.token,cp,'c'.repeat(64));
 const state={git};
 const scripts=[];
 const dependencies={
  capture:async()=>({...state.git}),
  audit:async()=>({passed:true,changedFile:'src/code.ts',findings:[]}),
  runScript:async(_cwd,script)=>{scripts.push(script)},
 };
 const run=(names=['typecheck','test'],deps=dependencies,revision=cp.revision)=>
  verifyQualityForReviewedIssue(base,project,lock.record.token,revision,names,undefined,deps);
 return {root,project,base,lock,git,cp,state,scripts,dependencies,run,
  close:()=>{lock.release();fs.rmSync(root,{recursive:true,force:true})}};
}
test('real quality transition requires proof and runs only approved script names',async()=>{
 const f=fixture();
 try{
  const result=await f.run();
  assert.equal(result.kind,'quality-passed');
  assert.equal(result.publishAuthorized,false);
  assert.equal(result.reviewedFingerprint,'c'.repeat(64));
  assert.deepEqual(f.scripts,['typecheck','test']);
  assert.equal(result.checkpointRevision,2);
  const cp=loadCoreCheckpoint(f.base,f.project);
  assert.equal(cp.reviewPassed,true);
  assert.equal(cp.qualityPassed,true);
  assert.equal(cp.stage,'quality');
  const report=readQualityRunReport(f.base,f.project);
  assert.equal(report.outcome,'passed');
  assert.equal(report.issueNumber,3);
  assert.equal(report.checkpointRevision,2);
  assert.equal(report.reviewFingerprint,'c'.repeat(64));
 }finally{f.close();}
});
test('failed script never approves quality or runs later scripts',async()=>{
 const f=fixture(),called=[];
 try{
  const outcome=await f.run(['typecheck','test'],{
   ...f.dependencies,runScript:async(_cwd,script)=>{
    called.push(script);throw Error('synthetic failure');
   },
  });
  assert.equal(outcome.kind,'quality-failed');
  assert.equal(outcome.publishAuthorized,false);
  assert.deepEqual(called,['typecheck']);
  assert.equal(loadCoreCheckpoint(f.base,f.project).qualityPassed,false);
 }finally{f.close();}
});
test('missing or tampered review proof refuses all script calls',async()=>{
 const f=fixture();try{
  const proofDir=path.join(f.base,'review-proofs');
  fs.writeFileSync(path.join(proofDir,fs.readdirSync(proofDir)[0]),'{}');
  await assert.rejects(f.run(),/Review proof/);
  assert.deepEqual(f.scripts,[]);
 }finally{f.close();}
});
test('Git drift before and after tests invalidates result without setting qualityPassed',async()=>{
 const f=fixture();try{
  f.state.git={...f.git,worktreeHash:'d'.repeat(64)};
  await assert.rejects(f.run(),/drift before quality/);
  assert.deepEqual(f.scripts,[]);
  f.state.git=f.git;
  const deps={...f.dependencies,runScript:async()=>{
   f.state.git={...f.git,worktreeHash:'e'.repeat(64)};
  }};
  await assert.rejects(f.run(['typecheck'],deps),/modified the reviewed Git tree/);
  assert.equal(loadCoreCheckpoint(f.base,f.project).qualityPassed,false);
 }finally{f.close();}
});
test('unauthorized scripts and previous approvals cannot run',async()=>{
 const f=fixture();try{
  await assert.rejects(f.run(['missing']),/unavailable/);
  await assert.rejects(f.run(['test;rm -rf']),/script names/);
  assert.deepEqual(f.scripts,[]);
  await f.run(['typecheck']);
  await assert.rejects(f.run(['typecheck']),/already completed/);
 }finally{f.close();}
});
test('checkpoint drift during scripts discards success',async()=>{
 const f=fixture();try{
  const deps={...f.dependencies,runScript:async()=>{
   saveCoreCheckpoint(f.base,f.project,f.lock.record.token,{
    runId:f.cp.runId,issueNumber:3,stage:'quality',git:f.git,
    sessions:{},reviewPassed:true,qualityPassed:false,
   },1);
  }};
  await assert.rejects(f.run(['test'],deps),/checkpoint changed during tests/);
  assert.equal(loadCoreCheckpoint(f.base,f.project).qualityPassed,false);
 }finally{f.close();}
});

test('new Clean Code/SOLID/DRY violations block Quality PASS and all scripts',async()=>{
 const f=fixture();
 try{
  const result=await f.run(['typecheck','test'],{
   ...f.dependencies,
   audit:async()=>({passed:false,changedFile:'src/unsafe.ts',
    findings:[{principle:'clean-code',rule:'explicit-any',line:3,
      detail:'New any type'}]}),
  });
  assert.equal(result.kind,'quality-failed');
  assert.match(result.feedback,/Clean Code\/SOLID\/DRY/);
  assert.match(result.feedback,/explicit-any/);
  assert.deepEqual(f.scripts,[]);
  assert.equal(loadCoreCheckpoint(f.base,f.project).qualityPassed,false);
 }finally{f.close();}
});

test('failed static audit persists concrete rule and prevents quality approval',async()=>{
 const f=fixture();
 try{
  const result=await f.run(['typecheck','test'],{
    ...f.dependencies,
    audit:async()=>({passed:false,changedFile:'src/a.ts',
      findings:[{principle:'clean-code',rule:'explicit-any',line:12,
        detail:'New any declaration'}]}),
  });
  assert.equal(result.kind,'quality-failed');
  const report=readQualityRunReport(f.base,f.project);
  assert.equal(report.outcome,'failed');
  assert.equal(report.findings[0].line,12);
  assert.equal(report.findings[0].rule,'explicit-any');
  assert.equal(report.checkpointRevision,1);
 }finally{f.close();}
});
