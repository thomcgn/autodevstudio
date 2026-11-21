import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { acquireProjectLock } from '../src/core/project-lock.ts';
import { createProjectLockGuardedAdapters, assertWorkflowLockOwned } from '../src/core/project-lock-guarded-adapters.ts';
import { orchestrateIssue } from '../src/core/orchestrator.ts';

function fixture(t){
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'autodev-workflow-lock-'));
  const projectPath=path.join(base,'project');
  fs.mkdirSync(projectPath);
  t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
  return {base,projectPath};
}
function adapters(onPublish=async()=>{}){
  return {
    planner:async()=>({summary:'plan',steps:['one']}),
    builder:async()=>({summary:'built'}),
    reviewer:async()=>({verdict:'PASS',blockers:0,summary:'review'}),
    quality:async()=>({passed:true,summary:'gates'}),
    publish:onPublish,
  };
}
const issue={number:3,title:'Issue',body:''};
test('requires a live owned lock for every workflow step',async t=>{
  const {base,projectPath}=fixture(t);
  const owned=acquireProjectLock(base,projectPath);
  t.after(()=>{try{owned.release()}catch{}});
  const guarded=createProjectLockGuardedAdapters({
    base,projectPath,token:owned.record.token,
  },adapters());
  assertWorkflowLockOwned({base,projectPath,token:owned.record.token});
  const result=await orchestrateIssue(issue,guarded);
  assert.equal(result.state.stage,'done');
  owned.release();
  await assert.rejects(orchestrateIssue(issue,guarded),/project lock lost/);
});
test('rejects wrong token and never launches planner',async t=>{
  const {base,projectPath}=fixture(t);
  const owned=acquireProjectLock(base,projectPath);
  t.after(()=>owned.release());
  let started=false;
  const guarded=createProjectLockGuardedAdapters({base,projectPath,token:'unowned'},{
    ...adapters(),planner:async()=>{started=true;return {summary:'plan',steps:['one']};},
  });
  await assert.rejects(orchestrateIssue(issue,guarded),/project lock lost/);
  assert.equal(started,false);
});
test('rejects lock replacement during asynchronous quality stage before publish',async t=>{
  const {base,projectPath}=fixture(t);
  const owned=acquireProjectLock(base,projectPath);
  let released=false, published=false;
  t.after(()=>{if(!released)try{owned.release()}catch{}});
  const guarded=createProjectLockGuardedAdapters({base,projectPath,token:owned.record.token},
    {...adapters(async()=>{published=true;}),quality:async()=>{
      owned.release();released=true;
      return {passed:true,summary:'passed despite lost lock'};
    }});
  await assert.rejects(orchestrateIssue(issue,guarded),/project lock lost/);
  assert.equal(published,false);
});
test('wrong project identity cannot reuse an owned token',async t=>{
  const {base,projectPath}=fixture(t);
  const other=path.join(base,'other');fs.mkdirSync(other);
  const owned=acquireProjectLock(base,projectPath);
  t.after(()=>owned.release());
  assert.throws(()=>assertWorkflowLockOwned({base,projectPath:other,token:owned.record.token}),/project lock lost/);
});
