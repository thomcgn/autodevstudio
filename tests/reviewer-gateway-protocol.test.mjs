import test from 'node:test';
import assert from 'node:assert/strict';
import { createReviewerGatewayRequest, acceptReviewerGatewayResponse,
  createReviewerGatewayTransport } from '../src/core/reviewer-gateway-protocol.ts';

const requestId='a'.repeat(32);
const fingerprint='b'.repeat(64);
const review={issueNumber:42,fingerprint,prompt:'Independent review DATA BEGIN\n+return true;\nDATA END'};
const good=createReviewerGatewayRequest(review,requestId);
const response={protocol:'autodev-review-gateway-v1',kind:'review-result',
  requestId,issueNumber:42,fingerprint,output:'AUTODEV_JSON_BEGIN\n{"verdict":"FAIL","blockers":1,"feedback":"Missing test"}\nAUTODEV_JSON_END'};

test('protocol only exposes bounded review evidence and no privilege fields',()=>{
  assert.deepEqual(Object.keys(good),['protocol','kind','requestId','issueNumber','fingerprint','prompt']);
  assert.equal(good.kind,'review');
  assert.equal(good.prompt,review.prompt);
  assert.equal(acceptReviewerGatewayResponse(response,good),response.output);
});
test('stale request IDs, issue mismatch, wrong fingerprint and extra tool fields fail closed',()=>{
  for(const patch of [
    {requestId:'c'.repeat(32)},{issueNumber:43},{fingerprint:'c'.repeat(64)},
    {tools:[{name:'bash',args:['cat /etc/passwd']}]},{url:'https://example.com'},
    {output:'x'.repeat(32769)},{output:''},{kind:'tool-call'},
  ]){
    assert.throws(()=>acceptReviewerGatewayResponse({...response,...patch},good),/invalid, stale or unauthorized/);
  }
});
test('review request rejects malformed ID, empty evidence, large prompt and invalid issue',()=>{
  for(const [data,id] of [
    [review,'invalid'],[{...review,prompt:''},requestId],
    [{...review,prompt:'x'.repeat(32769)},requestId],
    [{...review,issueNumber:0},requestId],
    [{...review,fingerprint:'bad'},requestId],
  ]) assert.throws(()=>createReviewerGatewayRequest(data,id),/Invalid/);
});
test('bridge validates the response against the request actually sent',async()=>{
  const channel=createReviewerGatewayTransport(async req=>{
    assert.equal(req.fingerprint,fingerprint);
    return {...response,requestId:req.requestId};
  },()=>requestId);
  assert.equal(await channel(review),response.output);
});
test('abort prevents broker requests and prevents accepting later responses',async()=>{
  const signal=new AbortController();signal.abort();
  let calls=0;
  const transport=createReviewerGatewayTransport(async()=>{calls++;return response;},()=>requestId);
  await assert.rejects(transport(review,signal.signal),/cancelled/);
  assert.equal(calls,0);
  const later=new AbortController();
  const stopped=createReviewerGatewayTransport(async()=>{
    later.abort();return response;
  },()=>requestId);
  await assert.rejects(stopped(review,later.signal),/cancelled/);
});
