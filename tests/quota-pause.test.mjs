import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {acquireProjectLock} from '../src/core/project-lock.ts';
import {saveCoreCheckpoint} from '../src/core/checkpoint-store.ts';
import {FreeQuotaGuard} from '../src/core/free-quota-guard.ts';
import {pauseForQuota,assertQuotaResume} from '../src/core/quota-pause.ts';
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'autodev-quota-pause-'));
 const project=path.join(root,'project');fs.mkdirSync(project);
 const base=path.join(root,'studio');
 const git={head:'a'.repeat(40),branch:'autodev/issue-55',worktreeHash:'b'.repeat(64)};
 const lock=acquireProjectLock(base,project);
 const guard=new FreeQuotaGuard(base);
 const checkpoint=saveCoreCheckpoint(base,project,lock.record.token,{
  runId:randomUUID(),issueNumber:55,stage:'review',git,
  sessions:{reviewer:'session12345678'},reviewPassed:false,qualityPassed:false,
 },null);
 return {base,project,lock,guard,checkpoint,git,close:()=>{lock.release();fs.rmSync(root,{recursive:true,force:true});}};
}
test('rate-limit checkpoint persists stage and requires verified recovery',()=>{
 const f=fixture();
 try{
  f.guard.recordRateLimit(60000);
  const paused=pauseForQuota(f.base,f.project,f.lock.record.token,f.git,f.guard);
  assert.equal(paused.stage,'review');
  assert.equal(paused.revision,2);
  assert.equal(paused.quotaReason,'rate-limit');
  assert.throws(()=>assertQuotaResume(f.base,f.project,f.lock.record.token,2,f.git,f.guard),/Quota remains unavailable/);
  f.guard.recoverFromVerifiedProvider(80,Date.now()+3600000);
  const resumed=assertQuotaResume(f.base,f.project,f.lock.record.token,2,f.git,f.guard);
  assert.equal(resumed.stage,'review');
  assert.equal(resumed.sessions.reviewer,'session12345678');
 }finally{f.close();}
});
test('drift and stale revisions prevent resuming from safe checkpoint',()=>{
 const f=fixture();
 try{
  f.guard.recordRateLimit();
  pauseForQuota(f.base,f.project,f.lock.record.token,f.git,f.guard);
  f.guard.recoverFromVerifiedProvider(100,Date.now()+3600000);
  assert.throws(()=>assertQuotaResume(f.base,f.project,f.lock.record.token,1,f.git,f.guard),/Stale/);
  assert.throws(()=>assertQuotaResume(f.base,f.project,f.lock.record.token,2,{...f.git,head:'c'.repeat(40)},f.guard),/drift/);
  assert.throws(()=>assertQuotaResume(f.base,f.project,'invalid-token',2,f.git,f.guard),/owned/);
 }finally{f.close();}
});
test('no checkpoint is created while quota remains available',()=>{
 const f=fixture();
 try{
  assert.throws(()=>pauseForQuota(f.base,f.project,f.lock.record.token,f.git,f.guard),/No quota pause/);
  assert.equal(f.checkpoint.revision,1);
 }finally{f.close();}
});
