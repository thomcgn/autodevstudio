import test from 'node:test';
import assert from 'node:assert/strict';
import {FreeQuotaGate,QuotaPauseError} from '../src/core/free-quota-gate.ts';
import {guardWorkflowWithQuota} from '../src/core/quota-workflow-guard.ts';
import {createSimulationAdapters,orchestrateIssue} from '../src/core/orchestrator.ts';
const issue={number:81,title:'Guard',body:'Synthetic only'};
test('unknown free quota checkpoints before planning; no simulated builder or publish',async()=>{
 const pauses=[];
 let planned=0;
 let published=0;
 const source=createSimulationAdapters();
 const adapter=guardWorkflowWithQuota({
  ...source,
  async planner(task){planned++;return source.planner(task);},
  async publish(task){published++;return source.publish(task);},
 },new FreeQuotaGate(),async value=>{pauses.push(value);});
 await assert.rejects(orchestrateIssue(issue,adapter),QuotaPauseError);
 assert.equal(planned,0);
 assert.equal(published,0);
 assert.deepEqual(pauses,[{issueNumber:81,stage:'plan',pauseUntil:null,source:'unknown',reason:'unknown-quota'}]);
});
test('failed checkpoint handler prevents further agent calls and never publishes',async()=>{
 const guard=guardWorkflowWithQuota(createSimulationAdapters(),new FreeQuotaGate(),async()=>{throw Error('checkpoint failed')});
 await assert.rejects(orchestrateIssue(issue,guard),/checkpoint failed/);
});
test('valid provider evidence permits in-memory simulation and no unsafe auto escalation',async()=>{
 const quota=new FreeQuotaGate();
 quota.observe(new Headers({'x-ratelimit-limit':'200','x-ratelimit-remaining':'40'}));
 const guard=guardWorkflowWithQuota(createSimulationAdapters(),quota,async()=>{throw Error('unexpected pause')});
 const result=await orchestrateIssue(issue,guard);
 assert.equal(result.state.stage,'done');
});
test('reserve blocks review at phase boundary and preserves unfinished work',async()=>{
 const quota=new FreeQuotaGate();
 quota.observe(new Headers({'x-ratelimit-limit':'200','x-ratelimit-remaining':'11'}));
 const calls=[];
 const source=createSimulationAdapters();
 const guard=guardWorkflowWithQuota({
  ...source,
  async planner(task){calls.push('plan');return source.planner(task);},
  async builder(task,plan,feedback){
   calls.push('build');
   quota.recordAccepted();
   return source.builder(task,plan,feedback);
  },
  async reviewer(task,plan,build){calls.push('review');return source.reviewer(task,plan,build);},
  async publish(task){calls.push('publish');return source.publish(task);},
 },quota,async record=>{calls.push(record.stage+':paused')});
 await assert.rejects(orchestrateIssue(issue,guard),QuotaPauseError);
 assert.deepEqual(calls,['plan','build','review:paused']);
});
