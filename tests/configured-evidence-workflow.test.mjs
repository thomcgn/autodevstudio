import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { acquireProjectLock } from '../src/core/project-lock.ts';
import { orchestrateIssue } from '../src/core/orchestrator.ts';
import { createConfiguredEvidenceWorkflow } from '../src/core/configured-evidence-workflow.ts';
const issue={number:15,title:'Fix sample',body:'Implement validation'};
const identity={head:'a'.repeat(40),branch:'autodev/issue-15',worktreeHash:'b'.repeat(64)};
const evidence={identity,fingerprint:'c'.repeat(64),status:' M src/index.ts',
  unstagedDiff:'diff --git a/src/index.ts b/src/index.ts\n+validate(input);',
  stagedDiff:'',recentCommits:'abc fixture'};
const verdict=(v)=>'AUTODEV_JSON_BEGIN\n'+JSON.stringify(v)+'\nAUTODEV_JSON_END';
function fixture(t){
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'autodev-model-workflow-'));
  const projectPath=path.join(base,'repo');
  fs.mkdirSync(projectPath);
  const lock=acquireProjectLock(base,projectPath);
  t.after(()=>{try{lock.release()}catch{};fs.rmSync(base,{recursive:true,force:true});});
  return {base,projectPath,lock};
}
const stages=(publish)=>({
  planner:async()=>({summary:'plan',steps:['implement']}),
  builder:async()=>({summary:'patch prepared'}),
  publish,
});
const config=(f)=>({projectPath:f.projectPath,lockBase:f.base,
  lockToken:f.lock.record.token,scripts:['typecheck'],timeoutMs:5000});
test('model-only PASS with matching evidence and lock runs quality then in-memory publish',async t=>{
  const f=fixture(t);let qualityCalls=0,published=0,providerCalls=0;
  const workflow=createConfiguredEvidenceWorkflow(config(f),stages(async()=>{published++;}),
    {provider:'ollama-local',model:'qwen2.5-coder:3b'},
    async()=>{qualityCalls++;return {passed:true,summary:'ok'};},async()=>evidence,
    async(url,options)=>{
      providerCalls++;
      assert.equal(url,'http://127.0.0.1:11434/api/chat');
      assert.match(JSON.parse(options.body).messages[1].content,/diff --git/);
      return new Response(JSON.stringify({model:'qwen2.5-coder:3b',done:true,
        message:{role:'assistant',content:verdict({verdict:'PASS',blockers:0,summary:'reviewed'})}}),{status:200});
    });
  const result=await orchestrateIssue(issue,workflow);
  assert.equal(result.state.stage,'done');
  assert.equal(providerCalls,1);assert.equal(qualityCalls,1);assert.equal(published,1);
});
test('model FAIL blocks scripts and publish without changing the project',async t=>{
  const f=fixture(t);let quality=0,published=0;
  const workflow=createConfiguredEvidenceWorkflow(config(f),stages(async()=>{published++;}),
    {provider:'ollama-local',model:'qwen2.5-coder:3b'},
    async()=>{quality++;return {passed:true,summary:'ok'};},async()=>evidence,
    async()=>new Response(JSON.stringify({model:'qwen2.5-coder:3b',done:true,
      message:{role:'assistant',content:verdict({verdict:'FAIL',blockers:1,feedback:'missing tests'})}}),{status:200}));
  const result=await orchestrateIssue(issue,workflow,{maxFixAttempts:0});
  assert.equal(result.state.stage,'blocked');
  assert.equal(quality,0);assert.equal(published,0);
});
test('missing Kilo Gateway key never starts provider, quality or publication',async t=>{
  const f=fixture(t);let calls=0;
  const workflow=createConfiguredEvidenceWorkflow(config(f),stages(async()=>{calls++;}),
    {provider:'kilo-gateway',model:'anthropic/claude-sonnet-4.5',gatewayKey:()=>null},
    async()=>{calls++;return {passed:true,summary:'ok'};},async()=>evidence,
    async()=>{calls++;throw Error('No external request authorized');});
  await assert.rejects(orchestrateIssue(issue,workflow),/key unavailable/);
  assert.equal(calls,0);
});
test('changed evidence after quality cannot authorize publication',async t=>{
  const f=fixture(t);let changed=false,published=false;
  const workflow=createConfiguredEvidenceWorkflow(config(f),stages(async()=>{published=true;}),
    {provider:'ollama-local',model:'qwen2.5-coder:3b'},
    async()=>{changed=true;return {passed:true,summary:'ok'};},
    async()=>changed?{...evidence,fingerprint:'d'.repeat(64)}:evidence,
    async()=>new Response(JSON.stringify({model:'qwen2.5-coder:3b',done:true,
      message:{role:'assistant',content:verdict({verdict:'PASS',blockers:0,summary:'reviewed'})}}),{status:200}));
  await assert.rejects(orchestrateIssue(issue,workflow),/stale/);
  assert.equal(published,false);
});
