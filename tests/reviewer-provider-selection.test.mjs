import test from 'node:test';
import assert from 'node:assert/strict';
import {createSelectedReviewerTransport} from '../src/core/reviewer-provider-selection.ts';
import {createEvidenceOnlyReviewer} from '../src/core/evidence-only-reviewer.ts';
const evidence={
  identity:{head:'a'.repeat(40),branch:'autodev/issue-7',worktreeHash:'b'.repeat(64)},
  fingerprint:'c'.repeat(64),status:' M src/fix.ts',
  unstagedDiff:'diff --git a/src/fix.ts b/src/fix.ts\n+return true;',
  stagedDiff:'',recentCommits:'head commit'};
const good='AUTODEV_JSON_BEGIN\n{"verdict":"PASS","blockers":0,"summary":"Reviewed diff"}\nAUTODEV_JSON_END';
const bad='AUTODEV_JSON_BEGIN\n{"verdict":"FAIL","blockers":1,"feedback":"Incomplete check"}\nAUTODEV_JSON_END';
const id=()=> 'd'.repeat(32);
const issue={number:7,title:'Fix',body:'Add proper check'};
const plan={summary:'plan',steps:['check']};
const build={summary:'changed source'};
test('local provider passes bounded evidence through gateway to existing reviewer validator',async()=>{
  let calls=0;
  const transport=createSelectedReviewerTransport({
    provider:'ollama-local',model:'qwen2.5-coder:3b',timeoutMs:10000,
  },async(url,init)=>{
    calls++;
    assert.equal(url,'http://127.0.0.1:11434/api/chat');
    const request=JSON.parse(init.body);
    assert.match(request.messages[1].content,/diff --git/);
    assert.equal(Object.hasOwn(request,'tools'),false);
    return new Response(JSON.stringify({model:'qwen2.5-coder:3b',done:true,
      message:{role:'assistant',content:good}}),{status:200});
  },id);
  const review=await createEvidenceOnlyReviewer(transport)(issue,plan,build,evidence);
  assert.equal(review.verdict,'PASS');
  assert.equal(calls,1);
});
test('cloud key never enters model prompt; no key means NO request or local fallback',async()=>{
  let calls=0;
  const missing=createSelectedReviewerTransport({
    provider:'kilo-gateway',model:'anthropic/claude-sonnet-4.5',
    gatewayKey:()=>null,
  },async()=>{calls++;throw Error('Cloud must not run');},id);
  await assert.rejects(createEvidenceOnlyReviewer(missing)(issue,plan,build,evidence),/key unavailable/);
  assert.equal(calls,0);
});
test('independent reviewer FAIL stays FAIL even if gateway returns valid response',async()=>{
  const transport=createSelectedReviewerTransport({
    provider:'ollama-local',model:'qwen2.5-coder:3b',
  },async()=>new Response(JSON.stringify({model:'qwen2.5-coder:3b',done:true,
    message:{role:'assistant',content:bad}}),{status:200}),id);
  assert.equal((await createEvidenceOnlyReviewer(transport)(issue,plan,build,evidence)).verdict,'FAIL');
});
test('unknown provider and untracked changes cannot reach model transport',async()=>{
  assert.throws(()=>createSelectedReviewerTransport({provider:'arbitrary',model:'x'},async()=>{},id),/Unsupported/);
  let requested=false;
  const transport=createSelectedReviewerTransport({
    provider:'ollama-local',model:'qwen2.5-coder:3b',
  },async()=>{requested=true;throw Error('must not send');},id);
  await assert.rejects(createEvidenceOnlyReviewer(transport)(issue,plan,build,
    {...evidence,status:'?? unsafe.ts'}),/Untracked/);
  assert.equal(requested,false);
});
