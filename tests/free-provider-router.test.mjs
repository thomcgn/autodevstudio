import test from 'node:test';
import assert from 'node:assert/strict';
import {chooseFreeProvider,quotaPhaseFor} from '../src/core/free-provider-router.ts';

const kilo=(id,model=id)=>({id,kind:'kilo',model,zeroCostVerified:true,
 ready:true,quota:'available',roles:['plan','build','review'],reviewerIsolated:true});
const direct=(id)=>({id,kind:'direct',model:id,zeroCostVerified:true,
 ready:true,quota:'available',roles:['plan','build','review'],reviewerIsolated:true});
const ollama=()=>({id:'ollama-local',kind:'ollama',model:'qwen2.5-coder:3b',
 zeroCostVerified:true,ready:true,quota:'unknown',
 roles:['plan','build','review'],reviewerIsolated:true});
const open={allowed:true,reason:'allowed',retryAt:null};
const limited={allowed:false,reason:'rate-limit',retryAt:null};
const route=(phase,preferredId,candidates,kiloQuota=open,rest={})=>
 chooseFreeProvider({phase,preferredId,candidates,kiloQuota,...rest});

test('preferred Nemotron free stays selected while Kilo quota is available',()=>{
 assert.deepEqual(route('build','kilo-ultra',[kilo('kilo-ultra'),ollama()]),{
  kind:'selected',providerId:'kilo-ultra',providerKind:'kilo',model:'kilo-ultra',fallback:false,
 });
});
test('429 blocks every Kilo free model, not just the selected one',()=>{
 const a=route('plan','kilo-ultra',[kilo('kilo-ultra'),kilo('kilo-free')],limited);
 assert.deepEqual(a,{kind:'paused',reason:'quota-unavailable'});
 const b=route('plan','kilo-ultra',[kilo('kilo-ultra'),kilo('kilo-free'),ollama()],limited);
 assert.equal(b.kind,'selected');
 assert.equal(b.providerId,'ollama-local');
 assert.equal(b.fallback,true);
});
test('direct independently limited free provider is a safe alternate',()=>{
 const result=route('build','kilo-ultra',[kilo('kilo-ultra'),direct('other-provider-free')],limited);
 assert.equal(result.kind,'selected');
 assert.equal(result.providerKind,'direct');
});
test('never silently choose paid, exhausted, disabled, or unsupported fallback',()=>{
 const paid={...direct('paid'),zeroCostVerified:false};
 const offline={...ollama(),ready:false};
 const exhausted={...direct('exhausted'),quota:'exhausted'};
 assert.deepEqual(route('build','kilo-ultra',[kilo('kilo-ultra'),paid,offline,exhausted],limited),
  {kind:'paused',reason:'quota-unavailable'});
});
test('reviewer never uses unisolated or same exact builder transport',()=>{
 const same=kilo('kilo-ultra','ultra');
 const unsafe={...direct('other'),reviewerIsolated:false};
 const candidate=kilo('kilo-super','super');
 const no=route('review','kilo-ultra',[same,unsafe],open,
   {builderProviderId:'kilo-ultra',builderModel:'ultra'});
 assert.deepEqual(no,{kind:'paused',reason:'independent-reviewer-unavailable'});
 const yes=route('review','kilo-ultra',[same,candidate],open,
   {builderProviderId:'kilo-ultra',builderModel:'ultra'});
 assert.deepEqual(yes,{kind:'selected',providerId:'kilo-super',
   providerKind:'kilo',model:'super',fallback:true});
});
test('finalization is the only phase that can use a reserved request',()=>{
 assert.equal(quotaPhaseFor('finalize'),'finalize');
 for(const role of ['plan','build','review'])
   assert.equal(quotaPhaseFor(role),'normal');
});
