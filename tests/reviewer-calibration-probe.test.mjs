import test from 'node:test';
import assert from 'node:assert/strict';
import {probeReviewerCalibration} from '../src/core/reviewer-calibration-probe.ts';

const response=(verdict)=>{
  const content='AUTODEV_JSON_BEGIN\n'+JSON.stringify(verdict==='PASS'
    ?{verdict:'PASS',blockers:0,summary:'Fixture change appears correct'}
    :{verdict:'FAIL',blockers:1,feedback:'Authorization was bypassed'})
    +'\nAUTODEV_JSON_END';
  return new Response(JSON.stringify({
    model:'qwen2.5-coder:3b',done:true,message:{role:'assistant',content},
  }),{status:200});
};
test('local calibration sends exactly two separate model-only synthetic prompts',async()=>{
  if(process.platform!=='linux')return;
  const calls=[];
  const result=await probeReviewerCalibration(async(url,options)=>{
    assert.equal(url,'http://127.0.0.1:11434/api/chat');
    const req=JSON.parse(options.body);
    assert.equal(req.model,'qwen2.5-coder:3b');
    assert.equal(req.stream,false);
    assert.equal(req.tools,undefined);
    assert.doesNotMatch(req.messages[1].content,/\/home\/|SECRET_TOKEN|\.env/);
    calls.push(req.messages[1].content);
    return response(calls.length===1?'PASS':'FAIL');
  });
  assert.deepEqual(result,{passed:true,reason:'passed'});
  assert.equal(calls.length,2);
  assert.match(calls[0],/tokenMatches/);
  assert.match(calls[1],/canAccess/);
});
test('always-PASS fails calibration without revealing model output',async()=>{
  if(process.platform!=='linux')return;
  const result=await probeReviewerCalibration(async()=>response('PASS'));
  assert.deepEqual(result,{passed:false,reason:'wrong-verdict',caseNumber:1});
});
test('unreachable model returns safe failure status',async()=>{
  if(process.platform!=='linux')return;
  const result=await probeReviewerCalibration(async()=>{throw Error('SECRET: /home/user')});
  assert.deepEqual(result,{passed:false,reason:'transport-failed',caseNumber:1});
  assert.doesNotMatch(JSON.stringify(result),/SECRET|home/);
});

test('HTTP 404 is reported as unavailable without exposing response text',async()=>{
  if(process.platform!=='linux')return;
  const result=await probeReviewerCalibration(async()=>new Response('SECRET',{status:404}));
  assert.deepEqual(result,{passed:false,reason:'model-unavailable',caseNumber:1});
  assert.doesNotMatch(JSON.stringify(result),/SECRET/);
});
test('HTTP 500 has distinct transport failure status',async()=>{
  if(process.platform!=='linux')return;
  const result=await probeReviewerCalibration(async()=>new Response('SECRET',{status:500}));
  assert.deepEqual(result,{passed:false,reason:'transport-failed',caseNumber:1});
});
test('malformed successful model reply is distinguished from network failure',async()=>{
  if(process.platform!=='linux')return;
  const result=await probeReviewerCalibration(async()=>new Response('{not json',{status:200}));
  assert.deepEqual(result,{passed:false,reason:'invalid-response',caseNumber:1});
});
