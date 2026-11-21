import test from 'node:test';
import assert from 'node:assert/strict';
import { orchestrateIssue } from '../src/core/orchestrator.ts';
import { createIntegrityGuardedAdapters } from '../src/core/integrity-guarded-adapters.ts';
const identity={head:'a'.repeat(40),branch:'autodev/issue-12',worktreeHash:'b'.repeat(64)};
const baseline={identity,status:' M a.ts',unstagedDiff:'patch',stagedDiff:'',recentCommits:'x',fingerprint:'c'.repeat(64)};
const issue={number:12,title:'Test',body:'Example'};
function setup(overrides={},collect=async()=>baseline) {
  let publishCount=0,qualityCount=0,reviewCount=0,builderCount=0;
  const base={
    planner:async()=>({summary:'plan',steps:['one']}),
    builder:async()=>{builderCount++;return {summary:'done'};},
    reviewer:async(_issue,_plan,_build,evidence)=>{reviewCount++;assert.equal(evidence.fingerprint,baseline.fingerprint);return {verdict:'PASS',blockers:0,summary:'verified'};},
    quality:async()=>{qualityCount++;return {passed:true,summary:'tests pass'};},
    publish:async()=>{publishCount++;},
    ...overrides,
  };
  return {adapters:createIntegrityGuardedAdapters('/repo',base,undefined,collect),
    counts:()=>({publishCount,qualityCount,reviewCount,builderCount})};
}
test('allows publish only after evidence bound PASS and unchanged quality gates',async()=>{
  const {adapters,counts}=setup();
  const result=await orchestrateIssue(issue,adapters);
  assert.equal(result.state.stage,'done');
  assert.deepEqual(counts(),{publishCount:1,qualityCount:1,reviewCount:1,builderCount:1});
  await assert.rejects(adapters.publish(issue),/requires successful quality gate/);
});
test('rejects git changes during reviewer invocation before quality or publish',async()=>{
  let revision=0,qualified=0,published=0;
  const collect=async()=>({...baseline,fingerprint:revision===0?baseline.fingerprint:'d'.repeat(64)});
  const {adapters}=setup({
    reviewer:async()=>{revision++;return {verdict:'PASS',blockers:0,summary:'claimed'};},
    quality:async()=>{qualified++;return {passed:true,summary:'ok'};},
    publish:async()=>{published++;},
  },collect);
  await assert.rejects(orchestrateIssue(issue,adapters),/evidence changed/);
  assert.equal(qualified,0);assert.equal(published,0);
});
test('rejects changes caused by quality scripts before publishing',async()=>{
  let changed=false,published=0;
  const collect=async()=>({...baseline,identity:changed?{...identity,worktreeHash:'f'.repeat(64)}:identity});
  const {adapters}=setup({
    quality:async()=>{changed=true;return {passed:true,summary:'ok'};},
    publish:async()=>{published++;},
  },collect);
  await assert.rejects(orchestrateIssue(issue,adapters),/stale/);
  assert.equal(published,0);
});
test('review FAIL returns builder for repair and invalidates previous state',async()=>{
  let reviewCount=0;
  const {adapters,counts}=setup({
    reviewer:async()=>++reviewCount===1
      ? {verdict:'FAIL',blockers:1,feedback:'repair'}
      : {verdict:'PASS',blockers:0,summary:'fixed'},
  });
  const outcome=await orchestrateIssue(issue,adapters);
  assert.equal(outcome.state.stage,'done');
  assert.equal(outcome.state.fixAttempts,1);
  assert.equal(counts().publishCount,1);
  assert.equal(counts().builderCount,2);
});
test('a FAIL never permits quality or publication directly',async()=>{
  const {adapters,counts}=setup({reviewer:async()=>({verdict:'FAIL',blockers:1,feedback:'not done'})});
  await adapters.planner(issue);
  const plan={summary:'plan',steps:['one']};
  await adapters.builder(issue,plan,[]);
  const review=await adapters.reviewer(issue,plan,{summary:'built'});
  assert.equal(review.verdict,'FAIL');
  await assert.rejects(adapters.quality(issue),/No current reviewer PASS/);
  await assert.rejects(adapters.publish(issue),/requires successful quality gate/);
  assert.equal(counts().publishCount,0);
});
