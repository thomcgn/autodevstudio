import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { orchestrateIssue } from '../src/core/orchestrator.ts';
import { acquireProjectLock } from '../src/core/project-lock.ts';
import { createStandaloneSafeWorkflowAdapters } from '../src/core/standalone-safe-adapters.ts';

const issue={number:17,title:'Review',body:''};
const identity={head:'a'.repeat(40),branch:'autodev/issue-17',worktreeHash:'b'.repeat(64)};
const evidence={identity,status:' M source.ts',unstagedDiff:'patch',stagedDiff:'',recentCommits:'a',fingerprint:'c'.repeat(64)};

function fixture(t){
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'autodev-safe-compose-'));
  const projectPath=path.join(base,'repo');
  fs.mkdirSync(projectPath);
  const lock=acquireProjectLock(base,projectPath);
  t.after(()=>{try{lock.release();}catch{}fs.rmSync(base,{recursive:true,force:true});});
  return {base,projectPath,lock};
}
function config(fixture){
  return {projectPath:fixture.projectPath,lockBase:fixture.base,
    lockToken:fixture.lock.record.token,scripts:['typecheck'],timeoutMs:5000};
}
function agents(publish){
  return {
    planner:async()=>({summary:'plan',steps:['one']}),
    builder:async()=>({summary:'built'}),
    reviewer:async(_issue,_plan,_build,reviewEvidence)=>{
      assert.equal(reviewEvidence.fingerprint,evidence.fingerprint);
      return {verdict:'PASS',blockers:0,summary:'read actual evidence'};
    },
    publish,
  };
}
test('composed lock + evidence + isolated quality are required before publish',async t=>{
  const f=fixture(t);
  const steps=[];
  const workflow=createStandaloneSafeWorkflowAdapters(config(f),agents(async()=>steps.push('publish')),
    async cfg=>{steps.push('quality');assert.deepEqual(cfg.scripts,['typecheck']);return {passed:true,summary:'ok'};},
    async()=>evidence);
  const result=await orchestrateIssue(issue,workflow);
  assert.equal(result.state.stage,'done');
  assert.deepEqual(steps,['quality','publish']);
});
test('absent or mismatched lock blocks composition before planning or running npm',t=>{
  const f=fixture(t);
  let started=false;
  assert.throws(()=>createStandaloneSafeWorkflowAdapters({...config(f),lockToken:'invalid'},
    agents(async()=>{started=true;}),async()=>{started=true;return {passed:true,summary:'ok'};},
    async()=>evidence),/project lock lost/);
  assert.equal(started,false);
});
test('stale review evidence after quality blocks publishing even with valid lock',async t=>{
  const f=fixture(t);
  let changed=false,published=false;
  const workflow=createStandaloneSafeWorkflowAdapters(config(f),agents(async()=>{published=true;}),
    async()=>{changed=true;return {passed:true,summary:'ok'};},
    async()=>changed?{...evidence,fingerprint:'f'.repeat(64)}:evidence);
  await assert.rejects(orchestrateIssue(issue,workflow),/stale/);
  assert.equal(published,false);
});
test('lost project lock during quality blocks publication even with unchanged evidence',async t=>{
  const f=fixture(t);
  let published=false;
  const workflow=createStandaloneSafeWorkflowAdapters(config(f),agents(async()=>{published=true;}),
    async()=>{
      f.lock.release();
      return {passed:true,summary:'ok'};
    },async()=>evidence);
  await assert.rejects(orchestrateIssue(issue,workflow),/project lock lost/);
  assert.equal(published,false);
});
test('isolated quality failure blocks publish, never falls back to host npm',async t=>{
  const f=fixture(t);
  let published=false;
  const workflow=createStandaloneSafeWorkflowAdapters(config(f),agents(async()=>{published=true;}),
    async()=>({passed:false,feedback:'sandbox refused script'}),async()=>evidence);
  const result=await orchestrateIssue(issue,workflow,{maxFixAttempts:0});
  assert.equal(result.state.stage,'blocked');
  assert.equal(published,false);
});
