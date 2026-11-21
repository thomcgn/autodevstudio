import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectFreeRunReadiness} from '../src/core/free-run-readiness.ts';
const models=[
 {id:'nvidia/nemotron-3-ultra-550b-a55b:free',name:'Ultra',preferred:true},
 {id:'nvidia/nemotron-3.5-super-vl:free',name:'Super',preferred:false},
];
const roles={planner:models[1].id,builder:models[0].id,reviewer:models[1].id};
const quota={source:'provider-verified',limit:200,reserve:10,usedLocal:3,
 remainingVerified:130,resetAt:null,blockedBy429:false,observedAt:1234};
const reasons=x=>x.roles.map(r=>r.reason);
test('distinct verified free role models with authentic remaining quota pass model-only preflight',()=>{
 const r=inspectFreeRunReadiness(roles,models,quota);
 assert.deepEqual(reasons(r),['ready','ready','ready']);
 assert.equal(r.modelAndQuotaReady,true);
 assert.equal(r.executionEnabled,false);
});
test('real provider remaining is mandatory; local observations cannot substitute',()=>{
 const r=inspectFreeRunReadiness(roles,models,{...quota,source:'local-observation',remainingVerified:null});
 assert.deepEqual(reasons(r),['remaining-unknown','remaining-unknown','remaining-unknown']);
 assert.equal(r.modelAndQuotaReady,false);
 assert.equal(r.countedLocally,3);
});
test('reviewer must not blindly reuse the exact Builder model',()=>{
 const r=inspectFreeRunReadiness({...roles,reviewer:roles.builder},models,quota);
 assert.equal(r.roles[2].reason,'reviewer-not-independent');
 assert.equal(r.modelAndQuotaReady,false);
});
test('any unknown paid model, 429 or exhausted reserve stops automatic readiness',()=>{
 assert.equal(inspectFreeRunReadiness({...roles,builder:'paid/model'},models,quota)
  .roles[1].reason,'model-no-longer-free');
 assert.deepEqual(reasons(inspectFreeRunReadiness(roles,models,{...quota,blockedBy429:true})),
  ['429-blocked','429-blocked','429-blocked']);
 assert.deepEqual(reasons(inspectFreeRunReadiness(roles,models,{...quota,remainingVerified:10})),
  ['reserve-protected','reserve-protected','reserve-protected']);
 assert.equal(inspectFreeRunReadiness(null,models,quota).roles[0].reason,'not-configured');
});
