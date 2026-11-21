import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {FreeQuotaGuard} from '../src/core/free-quota-guard.ts';

function fixture(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'autodev-quota-'));
 let time=10000000;
 const guard=new FreeQuotaGuard(dir,()=>time);
 return {guard,advance:ms=>{time+=ms},now:()=>time,close:()=>fs.rmSync(dir,{recursive:true,force:true}),dir};
}
test('one IP-wide Kilo quota preserves last 5% for finalization',()=>{
 const f=fixture();
 try{
  assert.equal(f.guard.snapshot().source,'unknown');
  assert.equal(f.guard.snapshot().remainingVerified,null);
  for(let i=0;i<190;i++)f.guard.recordAttempt('normal');
  assert.deepEqual(f.guard.decide('normal'),{allowed:false,reason:'reserve',retryAt:null});
  assert.throws(()=>f.guard.recordAttempt('normal'),/Quota checkpoint required/);
  assert.equal(f.guard.decide('finalize').allowed,true);
  for(let i=0;i<10;i++)f.guard.recordAttempt('finalize');
  assert.equal(f.guard.snapshot().usedLocal,200);
  assert.equal(f.guard.decide('finalize').allowed,false);
 }finally{f.close();}
});
test('authoritative provider count overrides higher local estimate conservatively',()=>{
 const f=fixture();
 try{
  f.guard.recordProviderQuota(10,f.now()+60000);
  assert.equal(f.guard.snapshot().source,'provider-verified');
  assert.equal(f.guard.decide('normal').reason,'reserve');
  assert.equal(f.guard.decide('finalize').allowed,true);
  f.guard.recordAttempt('finalize');
  assert.equal(f.guard.snapshot().remainingVerified,9);
 }finally{f.close();}
});
test('HTTP 429 checkpoint persists across restarts and hourly window',()=>{
 const f=fixture();
 try{
  f.guard.recordRateLimit(15000);
  assert.equal(f.guard.decide('normal').reason,'rate-limit');
  assert.equal(new FreeQuotaGuard(f.dir,f.now).snapshot().blockedBy429,true);
  f.advance(2*60*60*1000);
  assert.equal(f.guard.snapshot().usedLocal,0);
  assert.equal(f.guard.decide('normal').reason,'rate-limit');
  assert.throws(()=>f.guard.recordAttempt('finalize'));
  assert.throws(()=>f.guard.recoverFromVerifiedProvider(0,null));
  f.guard.recoverFromVerifiedProvider(60,f.now()+3600000);
  assert.equal(f.guard.decide('normal').allowed,true);
 }finally{f.close();}
});
test('estimated count never impersonates verified provider remaining',()=>{
 const f=fixture();
 try{
  f.guard.recordAttempt();
  assert.equal(f.guard.snapshot().source,'local-observation');
  assert.equal(f.guard.snapshot().remainingVerified,null);
  assert.throws(()=>f.guard.recordProviderQuota(-1,null));
  assert.throws(()=>f.guard.recordProviderQuota(201,null));
  assert.throws(()=>f.guard.recordRateLimit(-2));
 }finally{f.close();}
});
test('shared counters persist across guarded objects and roll off after 60 min',()=>{
 const f=fixture();
 try{
  f.guard.recordAttempt();
  const other=new FreeQuotaGuard(f.dir,f.now);
  assert.equal(other.snapshot().usedLocal,1);
  f.advance(3600001);
  assert.equal(other.snapshot().usedLocal,0);
  assert.equal(other.snapshot().remainingVerified,null);
 }finally{f.close();}
});

test('corrupt accounting never silently resets the quota counter',()=>{
 const f=fixture();
 try{
  f.guard.recordRateLimit();
  fs.writeFileSync(path.join(f.dir,'free-quota.json'),'{bad');
  assert.throws(()=>f.guard.snapshot(),/manual recovery required/);
  assert.throws(()=>f.guard.recordAttempt(),/manual recovery required/);
 }finally{f.close();}
});
