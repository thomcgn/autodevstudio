import test from 'node:test';
import assert from 'node:assert/strict';
import { orchestrateIssue } from '../src/core/orchestrator.ts';
import { createIsolatedQualityWorkflowAdapters } from '../src/core/isolated-quality-workflow.ts';

const issue={number:17,title:'Example',body:'Sample'};
const identity={head:'a'.repeat(40),branch:'autodev/issue-17',worktreeHash:'b'.repeat(64)};
const baseline={identity,status:' M file',unstagedDiff:'patch',stagedDiff:'',recentCommits:'head',fingerprint:'c'.repeat(64)};
const defaults={projectPath:'/isolated-test-project',scripts:['typecheck','test'],timeoutMs:10000};
function setup(overrides={},quality=async()=>({passed:true,summary:'OK'}),collect=async()=>baseline){
  let published=0;
  const adapters=createIsolatedQualityWorkflowAdapters(defaults,{
    planner:async()=>({summary:'plan',steps:['one']}),
    builder:async()=>({summary:'built'}),
    reviewer:async(_issue,_plan,_build,evidence)=>{
      assert.equal(evidence.fingerprint,baseline.fingerprint);
      return {verdict:'PASS',blockers:0,summary:'independent reviewer pass'};
    },
    publish:async()=>{published++;},
    ...overrides,
  },quality,collect);
  return {adapters,published:()=>published};
}
test('isolated quality callback receives only trusted config and runs after evidence-bound PASS',async()=>{
  let seen=null;
  const {adapters,published}=setup({},async config=>{
    seen=config;
    return {passed:true,summary:'passed'};
  });
  const outcome=await orchestrateIssue(issue,adapters);
  assert.equal(outcome.state.stage,'done');
  assert.equal(published(),1);
  assert.deepEqual(seen,{cwd:'/isolated-test-project',scripts:['typecheck','test'],timeoutMs:10000,
    signal:undefined,onOutput:undefined});
});
test('isolated npm failure never permits publish',async()=>{
  const {adapters,published}=setup({},async()=>({passed:false,feedback:'sandbox failed'}));
  const result=await orchestrateIssue(issue,adapters,{maxFixAttempts:0});
  assert.equal(result.state.stage,'blocked');
  assert.equal(published(),0);
});
test('quality scripts that mutate the workspace invalidate PASS before publish',async()=>{
  let changed=false;
  const {adapters,published}=setup({},async()=>{
    changed=true;
    return {passed:true,summary:'passes but mutates repository'};
  },async()=>changed?{...baseline,identity:{...identity,worktreeHash:'d'.repeat(64)}}:baseline);
  await assert.rejects(orchestrateIssue(issue,adapters),/stale/);
  assert.equal(published(),0);
});
test('invalid or externally supplied quality callbacks fail closed',async()=>{
  assert.throws(()=>createIsolatedQualityWorkflowAdapters({...defaults,scripts:[]},{
    planner:async()=>({summary:'',steps:[]}),builder:async()=>({summary:''}),
    reviewer:async()=>({verdict:'PASS',blockers:0,summary:'ok'}),publish:async()=>{},
  }),/approved/);
  assert.throws(()=>createIsolatedQualityWorkflowAdapters(defaults,{
    planner:async()=>({summary:'',steps:[]}),builder:async()=>({summary:''}),
    reviewer:async()=>({verdict:'PASS',blockers:0,summary:'ok'}),
    quality:async()=>({passed:true,summary:'host npm bypass'}),
    publish:async()=>{},
  }),/isolated controller/);
});
