import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { acquireProjectLock, inspectProjectLock, keyForProject } from '../src/core/project-lock.ts';
import { loadCoreCheckpoint, saveCoreCheckpoint, assertCoreResumeEligible } from '../src/core/checkpoint-store.ts';

const HEAD='a'.repeat(40);
const TREE='b'.repeat(64);
function fixture(t) {
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'studio-locks-'));
  t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
  const repo=path.join(base,'repo');
  fs.mkdirSync(repo);
  return {base,repo};
}
function draft(overrides={}) {
  return {
    runId:randomUUID(),issueNumber:5,stage:'plan',
    git:{head:HEAD,branch:'feat/issue-5',worktreeHash:TREE},sessions:{},
    reviewPassed:false,qualityPassed:false,...overrides,
  };
}

test('atomically locks the same canonical project once and releases by owner', t=>{
  const {base,repo}=fixture(t);
  const alias=path.join(base,'alias');
  fs.symlinkSync(repo,alias);
  const lock=acquireProjectLock(base,repo);
  assert.equal(inspectProjectLock(base,alias).token,lock.record.token);
  assert.equal(keyForProject(repo),keyForProject(alias));
  assert.throws(()=>acquireProjectLock(base,alias),/locked/);
  lock.release();
  lock.release();
  assert.equal(inspectProjectLock(base,repo),null);
  const next=acquireProjectLock(base,repo);
  assert.notEqual(next.record.token,lock.record.token);
  next.release();
});

test('will not remove another owner lock after ownership changes', t=>{
  const {base,repo}=fixture(t);
  const lock=acquireProjectLock(base,repo);
  const dir=path.join(base,'core-locks',keyForProject(repo)+'.lock');
  const file=path.join(dir,'owner.json');
  const replaced={...lock.record,token:randomUUID()};
  fs.writeFileSync(file,JSON.stringify(replaced));
  assert.throws(()=>lock.release(),/ownership/);
  assert.equal(inspectProjectLock(base,repo).token,replaced.token);
});

test('checkpoint writes require lock and exact revision', t=>{
  const {base,repo}=fixture(t);
  assert.throws(()=>saveCoreCheckpoint(base,repo,'bogus',draft(),null),/owned project lock/);
  const lock=acquireProjectLock(base,repo);
  const cp=saveCoreCheckpoint(base,repo,lock.record.token,draft(),null);
  assert.equal(cp.revision,1);
  assert.deepEqual(loadCoreCheckpoint(base,repo),cp);
  assert.throws(()=>saveCoreCheckpoint(base,repo,lock.record.token,draft(),null),/revision conflict/);
  const next=saveCoreCheckpoint(base,repo,lock.record.token,{...cp,stage:'build'},1);
  assert.equal(next.revision,2);
  lock.release();
  assert.throws(()=>saveCoreCheckpoint(base,repo,lock.record.token,draft(),2),/owned project lock/);
});

test('resume requires exact Git identity and existing active agent session', t=>{
  const {base,repo}=fixture(t);
  const lock=acquireProjectLock(base,repo);
  const cp=saveCoreCheckpoint(base,repo,lock.record.token,draft({stage:'build'}),null);
  assert.throws(()=>assertCoreResumeEligible(cp,repo,cp.git),/session ID/);
  const next=saveCoreCheckpoint(base,repo,lock.record.token,{...cp,sessions:{builder:'ses_123456789'}},1);
  assert.doesNotThrow(()=>assertCoreResumeEligible(next,repo,next.git));
  assert.throws(()=>assertCoreResumeEligible(next,repo,{...next.git,head:'c'.repeat(40)}),/drift/);
  assert.throws(()=>assertCoreResumeEligible(next,repo,{...next.git,worktreeHash:'d'.repeat(64)}),/drift/);
  lock.release();
});

test('publication checkpoint is blocked without independent review and quality PASS', t=>{
  const {base,repo}=fixture(t);
  const lock=acquireProjectLock(base,repo);
  assert.throws(()=>saveCoreCheckpoint(base,repo,lock.record.token,draft({stage:'publish'}),null),/review and quality/);
  const cp=saveCoreCheckpoint(base,repo,lock.record.token,
    draft({stage:'publish',reviewPassed:true,qualityPassed:true}),null);
  assert.throws(()=>assertCoreResumeEligible(cp,repo,cp.git),/manual verification/);
  lock.release();
});

test('corrupt checkpoint fails closed rather than silently resetting progress', t=>{
  const {base,repo}=fixture(t);
  const lock=acquireProjectLock(base,repo);
  saveCoreCheckpoint(base,repo,lock.record.token,draft(),null);
  const file=path.join(base,'core-checkpoints',keyForProject(repo)+'.json');
  fs.writeFileSync(file,'not-json');
  assert.throws(()=>loadCoreCheckpoint(base,repo),/Corrupted checkpoint/);
  assert.throws(()=>saveCoreCheckpoint(base,repo,lock.record.token,draft(),null),/Corrupted checkpoint/);
  lock.release();
});
