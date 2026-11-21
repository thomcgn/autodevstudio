import test from 'node:test';
import assert from 'node:assert/strict';
import { createKiloGatewayReviewerChannel } from '../src/core/kilo-gateway-reviewer.ts';
const req={protocol:'autodev-review-gateway-v1',kind:'review',requestId:'a'.repeat(32),
  issueNumber:5,fingerprint:'b'.repeat(64),prompt:'Review this patch: +return false;'};
const verdict='AUTODEV_JSON_BEGIN\n{"verdict":"FAIL","blockers":1,"feedback":"No test"}\nAUTODEV_JSON_END';
const completion=(message,finish_reason='stop')=>
  new Response(JSON.stringify({choices:[{message,finish_reason}]}),{
    status:200,headers:{'Content-Type':'application/json'}});
const config={model:'anthropic/claude-sonnet-4.5',
  readGatewayApiKey:()=> 'test-gateway-api-key',
  timeoutMs:5000,maxCompletionTokens:700};

test('fixed external endpoint, no tool capabilities, key used only as header',async()=>{
  const calls=[];
  const channel=createKiloGatewayReviewerChannel(config,async(url,options)=>{
    calls.push([url,options]);
    return completion({role:'assistant',content:verdict});
  });
  const result=await channel(req);
  assert.deepEqual(result,{protocol:'autodev-review-gateway-v1',kind:'review-result',
    requestId:req.requestId,issueNumber:5,fingerprint:req.fingerprint,output:verdict});
  assert.equal(calls.length,1);
  const [url,opts]=calls[0];
  assert.equal(url,'https://ai-gateway.kilo.ai/api/v1/chat/completions');
  assert.equal(opts.redirect,'error');
  assert.equal(opts.headers.Authorization,'Bearer test-gateway-api-key');
  const body=JSON.parse(opts.body);
  assert.equal(body.tool_choice,'none');
  assert.equal(body.stream,false);
  assert.equal(body.max_tokens,700);
  assert.deepEqual(body.messages.map(x=>x.role),['system','user']);
  assert.equal(body.messages[1].content,req.prompt);
  assert.equal(opts.body.includes('test-gateway-api-key'),false);
  assert.equal('tools' in body,false);
});
test('rejects tool calls, truncated output, unexpected finish and missing text',async()=>{
  for(const [message,finish] of [
    [{role:'assistant',content:verdict,tool_calls:[]},'stop'],
    [{role:'assistant',content:verdict},'tool_calls'],
    [{role:'assistant',content:verdict},'length'],
    [{role:'assistant',content:null},'stop'],
  ]){
    const channel=createKiloGatewayReviewerChannel(config,async()=>completion(message,finish));
    await assert.rejects(channel(req),/Reviewer/);
  }
});
test('no key, suspicious config and untrusted envelope fail before network',async()=>{
  let called=false;
  const send=async()=>{called=true;return completion({role:'assistant',content:verdict});};
  const missing=createKiloGatewayReviewerChannel({...config,readGatewayApiKey:()=>null},send);
  await assert.rejects(missing(req),/key unavailable/);
  assert.equal(called,false);
  for(const patch of [{prompt:'x'.repeat(32769)},{url:'http://private'},
    {requestId:'bad'},{fingerprint:'oops'}]){
    await assert.rejects(createKiloGatewayReviewerChannel(config,send)({...req,...patch}),/envelope/);
  }
  assert.equal(called,false);
  assert.throws(()=>createKiloGatewayReviewerChannel({...config,model:'../../http://evil'},send),/model/);
});
test('HTTP error does not leak response body, and oversized completion is blocked',async()=>{
  const fail=createKiloGatewayReviewerChannel(config,async()=>
    new Response('SECRET stored at home', {status:401}));
  await assert.rejects(fail(req),error=>/HTTP 401/.test(error.message) && !error.message.includes('SECRET'));
  const tooLarge=createKiloGatewayReviewerChannel(config,async()=>completion({
    role:'assistant',content:'x'.repeat(65000)}));
  await assert.rejects(tooLarge(req),/exceeds limit|oversized/);
});
test('cancellation short-circuits network',async()=>{
  let invoked=false;
  const abort=new AbortController();abort.abort();
  const channel=createKiloGatewayReviewerChannel(config,async()=>{
    invoked=true;return completion({role:'assistant',content:verdict});
  });
  await assert.rejects(channel(req,abort.signal),/cancelled/);
  assert.equal(invoked,false);
});

test('anonymous free model is allowed, but paid models still require an API key',async()=>{
 let calls=0;
 const free=createKiloGatewayReviewerChannel({
  ...config,model:'nvidia/nemotron-3-ultra-550b-a55b:free',
  readGatewayApiKey:()=>null,
 },async(_url,opts)=>{
  calls++;
  assert.equal(opts.headers.Authorization,undefined);
  return completion({role:'assistant',content:verdict});
 });
 assert.equal((await free(req)).output,verdict);
 assert.equal(calls,1);
 const paid=createKiloGatewayReviewerChannel({...config,readGatewayApiKey:()=>null},
   async()=>{calls++;throw Error('must never run paid')});
 await assert.rejects(paid(req),/key unavailable/);
 assert.equal(calls,1);
});
test('HTTP 429 is categorized and quota hooks run exactly once, without response text',async()=>{
 let started=0,limits=0;
 const free=createKiloGatewayReviewerChannel({
   ...config,model:'nvidia/nemotron-3-ultra-550b-a55b:free',
   readGatewayApiKey:()=>null,
   onBeforeRequest:()=>{started++},
   onRateLimited:()=>{limits++},
 },async()=>new Response('SECRET',{status:429}));
 await assert.rejects(free(req),error=>
   /Kilo Gateway free rate limited \(HTTP 429\)/.test(error.message)&&
   !error.message.includes('SECRET'));
 assert.equal(started,1);
 assert.equal(limits,1);
});
