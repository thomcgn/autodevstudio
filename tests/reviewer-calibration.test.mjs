import test from 'node:test';
import assert from 'node:assert/strict';
import {calibrateReviewer} from '../src/core/reviewer-calibration.ts';

const json=(verdict)=>'AUTODEV_JSON_BEGIN\n'+JSON.stringify(
  verdict==='PASS'
    ?{verdict:'PASS',blockers:0,summary:'No issues found in this synthetic patch'}
    :{verdict:'FAIL',blockers:1,feedback:'Authorization bypass'}
)+'\nAUTODEV_JSON_END';

test('calibration demands both known-good PASS and known-bad FAIL',async()=>{
  const numbers=[];
  const result=await calibrateReviewer(async request=>{
    numbers.push(request.issueNumber);
    assert.equal(request.fingerprint,'c'.repeat(64));
    assert.match(request.prompt,/DATA BEGIN/);
    assert.match(request.prompt,/fixture.ts/);
    assert.doesNotMatch(request.prompt,/\/home\/|\/Users\/|SECRET_TOKEN/);
    return json(request.issueNumber===901?'PASS':'FAIL');
  });
  assert.deepEqual(numbers,[901,902]);
  assert.deepEqual(result,{passed:true,reason:'passed'});
});

test('a reviewer that blindly approves is rejected',async()=>{
  const result=await calibrateReviewer(async()=>json('PASS'));
  assert.deepEqual(result,{passed:false,reason:'wrong-verdict',caseNumber:1});
});

test('a reviewer that blindly rejects is rejected without second model call',async()=>{
  let count=0;
  const result=await calibrateReviewer(async()=>{count++;return json('FAIL')});
  assert.deepEqual(result,{passed:false,reason:'wrong-verdict',caseNumber:1});
  assert.equal(count,1);
});

test('malformed response is sanitized and stops calibration',async()=>{
  let count=0;
  const result=await calibrateReviewer(async()=>{count++;return 'PRIVATE SECRET'});
  assert.deepEqual(result,{passed:false,reason:'invalid-response',caseNumber:1});
  assert.equal(count,1);
  assert.doesNotMatch(JSON.stringify(result),/PRIVATE/);
});

test('transport exceptions never escape into renderer-facing statuses',async()=>{
  const result=await calibrateReviewer(async()=>{throw Error('SECRET /home/user')});
  assert.deepEqual(result,{passed:false,reason:'invalid-response',caseNumber:1});
});

test('aborted calibration never contacts the provider',async()=>{
  const controller=new AbortController();
  controller.abort();
  let calls=0;
  const result=await calibrateReviewer(async()=>{calls++;return json('PASS')},controller.signal);
  assert.deepEqual(result,{passed:false,reason:'cancelled'});
  assert.equal(calls,0);
});

test('aborting after first verdict prevents second call',async()=>{
  const controller=new AbortController();
  let calls=0;
  const result=await calibrateReviewer(async()=>{
    calls++;
    controller.abort();
    return json('PASS');
  },controller.signal);
  assert.deepEqual(result,{passed:false,reason:'cancelled'});
  assert.equal(calls,1);
});

test('timeouts are separately classified and never leak messages',async()=>{
  const result=await calibrateReviewer(async()=>{throw Error('Local reviewer cancelled or timed out: /home/secret')});
  assert.deepEqual(result,{passed:false,reason:'timeout',caseNumber:1});
  assert.doesNotMatch(JSON.stringify(result),/home|secret/);
});
test('second synthetic example is identified on malformed response',async()=>{
  let calls=0;
  const result=await calibrateReviewer(async()=>++calls===1?json('PASS'):'malformed');
  assert.deepEqual(result,{passed:false,reason:'invalid-response',caseNumber:2});
});
