import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {FreeQuotaGuard} from '../src/core/free-quota-guard.ts';
import {probeKiloReviewerCalibration} from '../src/core/kilo-reviewer-calibration-probe.ts';
const ultra='nvidia/nemotron-3-ultra-550b-a55b:free';
const response=(verdict)=>new Response(JSON.stringify({choices:[{
 message:{role:'assistant',content:'AUTODEV_JSON_BEGIN\n'+JSON.stringify(verdict==='PASS'
 ?{verdict:'PASS',blockers:0,summary:'The token guard is correct'}
 :{verdict:'FAIL',blockers:1,feedback:'Permissions check bypassed'})
 +'\nAUTODEV_JSON_END'},finish_reason:'stop',
}]}),{status:200});
const fixture=()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'autodev-kilo-calibration-'));
 return {root,guard:new FreeQuotaGuard(root),close:()=>fs.rmSync(root,{recursive:true,force:true})};
};
test('anonymous free-only Kilo calibration invokes two synthetic prompts and counts each request',async()=>{
 const f=fixture();let calls=0;
 try{
  const result=await probeKiloReviewerCalibration(ultra,f.guard,async(url,opts)=>{
   calls++;
   assert.equal(url,'https://ai-gateway.kilo.ai/api/v1/chat/completions');
   assert.equal(opts.headers.Authorization,undefined);
   const body=JSON.parse(opts.body);
   assert.equal(body.model,ultra);
   assert.equal(body.tool_choice,'none');
   assert.equal(body.tools,undefined);
   assert.doesNotMatch(body.messages[1].content,/\/home\/|SECRET_TOKEN/);
   return response(calls===1?'PASS':'FAIL');
  });
  assert.deepEqual(result,{passed:true,reason:'passed'});
  assert.equal(calls,2);
  assert.equal(f.guard.snapshot().usedLocal,2);
  assert.equal(f.guard.snapshot().remainingVerified,null);
 }finally{f.close();}
});
test('HTTP 429 blocks second request and persists quota pause across app restart',async()=>{
 const f=fixture();let calls=0;
 try{
  const result=await probeKiloReviewerCalibration(ultra,f.guard,async()=>{
   calls++;return new Response('PRIVATE',{status:429});
  });
  assert.deepEqual(result,{passed:false,reason:'rate-limit',caseNumber:1});
  assert.equal(calls,1);
  assert.equal(f.guard.snapshot().blockedBy429,true);
  const more=await probeKiloReviewerCalibration(ultra,new FreeQuotaGuard(f.root),async()=>{
   calls++;return response('PASS');
  });
  assert.equal(more.reason,'rate-limit');
  assert.equal(calls,1);
  assert.doesNotMatch(JSON.stringify(result),/PRIVATE/);
 }finally{f.close();}
});
test('last 10 requests remain reserved and paid model cannot be probed',async()=>{
 const f=fixture();let calls=0;
 try{
  for(let i=0;i<190;i++)f.guard.recordAttempt('normal');
  const send=async()=>{calls++;return response('PASS');};
  assert.equal((await probeKiloReviewerCalibration(ultra,f.guard,send)).reason,'quota-reserve');
  assert.equal((await probeKiloReviewerCalibration('anthropic/claude-opus',f.guard,send)).reason,'model-unavailable');
  assert.equal(calls,0);
 }finally{f.close();}
});
