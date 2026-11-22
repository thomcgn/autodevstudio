import test from 'node:test';
import assert from 'node:assert/strict';
import {FreeQuotaGate,QuotaPauseError,parseQuotaHeaders,parseRetryAfter} from '../src/core/free-quota-gate.ts';
const headers=(values)=>new Headers(values);
const now=1800000000000;
test('only genuine provider quota headers count as provider measurement',()=>{
 assert.equal(parseQuotaHeaders(headers({}),now),null);
 assert.equal(parseQuotaHeaders(headers({'x-ratelimit-limit':'200'}),now),null);
 assert.equal(parseQuotaHeaders(headers({'x-ratelimit-limit':'200','x-ratelimit-remaining':'unknown'}),now),null);
 assert.equal(parseQuotaHeaders(headers({'x-ratelimit-limit':'200','x-ratelimit-remaining':'201'}),now),null);
 const r=parseQuotaHeaders(headers({'x-ratelimit-limit':'200','x-ratelimit-remaining':'11'}),now);
 assert.equal(r.remaining,11);
 assert.equal(r.source,'provider');
});
test('unknown real balance is never invented and work fails closed',()=>{
 const gate=new FreeQuotaGate();
 const state=gate.status(now);
 assert.equal(state.source,'unknown');
 assert.equal(state.remaining,null);
 assert.equal(state.workAllowed,false);
 assert.throws(()=>gate.assertAllowed('work',now),QuotaPauseError);
});
test('reserve 5% of 200 for finalization, block regular work at 10',()=>{
 const gate=new FreeQuotaGate();
 gate.observe(headers({'x-ratelimit-limit':'200','x-ratelimit-remaining':'10'}),now);
 assert.equal(gate.status(now).reserve,10);
 assert.equal(gate.status(now).workAllowed,false);
 assert.equal(gate.status(now).finalizationAllowed,true);
 assert.throws(()=>gate.assertAllowed('work',now),QuotaPauseError);
 gate.assertAllowed('finalize',now);
});
test('once final ten are used, no further finalization attempts are admitted',()=>{
 const gate=new FreeQuotaGate();
 gate.observe(headers({'x-ratelimit-limit':'200','x-ratelimit-remaining':'10'}),now);
 for(let i=0;i<10;i++)gate.recordAccepted(now+1+i);
 const state=gate.status(now+20);
 assert.equal(state.remaining,0);
 assert.equal(state.finalizationAllowed,false);
});
test('provider snapshot is not trusted indefinitely and excludes earlier requests',()=>{
 const gate=new FreeQuotaGate();
 gate.recordAccepted(now-10000);
 gate.observe(headers({'x-ratelimit-limit':'200','x-ratelimit-remaining':'15'}),now);
 assert.equal(gate.status(now).remaining,15);
 gate.recordAccepted(now+1);
 assert.equal(gate.status(now+2).remaining,14);
 assert.equal(gate.status(now+61000).source,'local-estimate');
});
test('429 uses real Retry-After but never invents accurate reset from absence',()=>{
 const gate=new FreeQuotaGate();
 gate.observe(headers({'x-ratelimit-limit':'200','x-ratelimit-remaining':'150'}),now);
 gate.reject429(headers({'retry-after':'120'}),now);
 assert.equal(gate.status(now+1000).reason,'rate-limited');
 assert.equal(gate.status(now+1000).pauseUntil,now+120000);
 assert.equal(gate.status(now+120001).pauseUntil,null);
 const unknown=new FreeQuotaGate();
 unknown.reject429(headers({}),now);
 assert.equal(unknown.status(now).pauseUntil,now+3600000);
});
test('malformed Retry-After cannot force unsafe immediate retries',()=>{
 assert.equal(parseRetryAfter(headers({'retry-after':'nonsense'}),now),null);
 assert.equal(parseRetryAfter(headers({'retry-after':'999999999'}),now),null);
});
