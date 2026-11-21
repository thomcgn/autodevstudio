import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { acquireProjectLock } from '../src/core/project-lock.ts';
import { orchestrateIssue } from '../src/core/orchestrator.ts';
import { createEvidenceOnlyStandaloneWorkflow } from '../src/core/evidence-only-standalone-workflow.ts';
const issue={number:9,title:'Improve check',body:'Fix validator'};
const identity={head:'a'.repeat(40),branch:'autodev/issue-9',worktreeHash:'b'.repeat(64)};
const evidence={identity,fingerprint:'c'.repeat(64),status:' M src/file.ts',
  unstagedDiff:'diff --git a/src/file.ts b/src/file.ts\n+return true;',stagedDiff:'',recentCommits:'abc fix'};
const response=output=>'AUTODEV_JSON_BEGIN\n'+JSON.stringify(output)+'\nAUTODEV_JSON_END';
function fixture(t){
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'autodev-review-compose-'));
  const projectPath=path.join(base,'project');fs.mkdirSync(projectPath);
  const lock=acquireProjectLock(base,projectPath);
  t.after(()=>{try{lock.release()}catch{}fs.rmSync(base,{recursive:true,force:true});});
  return {base,projectPath,lock};
}
const stages=(publish)=>({
  planner:async()=>({summary:'plan',steps:['validate']}),
  builder:async()=>({summary:'change made'}),
  publish,
});
test('reviewer gets only evidence-bound prompt and cannot bypass isolated quality gate',async t=>{
  const f=fixture(t);let reviewed=0,quality=0,published=0;
  const workflow=createEvidenceOnlyStandaloneWorkflow({
    projectPath:f.projectPath,lockBase:f.base,lockToken:f.lock.record.token,
    scripts:['typecheck'],timeoutMs:5000,
  },stages(async()=>{published++;}),async request=>{
    reviewed++;
    assert.equal(request.issueNumber,9);
    assert.equal(request.fingerprint,evidence.fingerprint);
    assert.match(request.prompt,/diff --git/);
    return response({verdict:'PASS',blockers:0,summary:'looks correct'});
  },async config=>{quality++;assert.deepEqual(config.scripts,['typecheck']);return {passed:true,summary:'passed'};},
  async()=>evidence);
  const outcome=await orchestrateIssue(issue,workflow);
  assert.equal(outcome.state.stage,'done');
  assert.equal(reviewed,1);assert.equal(quality,1);assert.equal(published,1);
});
test('untracked files prevent model invocation and publication',async t=>{
  const f=fixture(t);let invoked=false,published=false;
  const workflow=createEvidenceOnlyStandaloneWorkflow({
    projectPath:f.projectPath,lockBase:f.base,lockToken:f.lock.record.token,
    scripts:['typecheck'],timeoutMs:5000,
  },stages(async()=>{published=true;}),async()=>{invoked=true;return response({verdict:'PASS',blockers:0,summary:'ok'});},
  async()=>({passed:true,summary:'fake'}),async()=>({...evidence,status:'?? new.ts'}));
  await assert.rejects(orchestrateIssue(issue,workflow),/Untracked/);
  assert.equal(invoked,false);assert.equal(published,false);
});
test('review FAIL is never treated as a quality or publish authorization',async t=>{
  const f=fixture(t);let published=false,quality=false;
  const workflow=createEvidenceOnlyStandaloneWorkflow({
    projectPath:f.projectPath,lockBase:f.base,lockToken:f.lock.record.token,
    scripts:['typecheck'],timeoutMs:5000,
  },stages(async()=>{published=true;}),async()=>response({verdict:'FAIL',blockers:1,feedback:'Fix it'}),
  async()=>{quality=true;return {passed:true,summary:'ok'};},async()=>evidence);
  const result=await orchestrateIssue(issue,workflow,{maxFixAttempts:0});
  assert.equal(result.state.stage,'blocked');
  assert.equal(quality,false);assert.equal(published,false);
});
test('missing independent reviewer transport is refused',t=>{
  const f=fixture(t);
  assert.throws(()=>createEvidenceOnlyStandaloneWorkflow({
    projectPath:f.projectPath,lockBase:f.base,lockToken:f.lock.record.token,
    scripts:['typecheck'],timeoutMs:5000,
  },stages(async()=>{}),undefined),/mandatory/);
});
