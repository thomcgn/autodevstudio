import test from 'node:test';
import assert from 'node:assert/strict';
import {previewFreeRoutes} from '../src/core/free-route-preview.ts';

const ultra='nvidia/nemotron-3-ultra-550b-a55b:free';
const supermodel='nvidia/nemotron-3.5-super-vl:free';
const roles={planner:supermodel,builder:ultra,reviewer:ultra};
const catalog=[{id:ultra,name:'Ultra',preferred:true},{id:supermodel,name:'Super',preferred:false}];
const unknown={source:'local-observation',limit:200,reserve:10,usedLocal:4,
 remainingVerified:null,resetAt:null,blockedBy429:false,observedAt:1000};
const ready={ready:true,reason:'ready'};
const offline={ready:false,reason:'unreachable'};
test('unknown Kilo IP quota pauses every Kilo role even with free models',()=>{
 const result=previewFreeRoutes(roles,catalog,unknown,offline,false);
 assert.deepEqual(result.roles.map(r=>r.route),['paused','paused','paused']);
 assert.equal(result.executionEnabled,false);
 assert.equal(result.previewOnly,true);
 assert.equal(result.roles[0].reason,'kilo-quota-unverified');
});
test('explicit opt-in only permits local reviewer candidate on quota exhaustion',()=>{
 const r=previewFreeRoutes(roles,catalog,{...unknown,blockedBy429:true},ready,true);
 assert.deepEqual(r.roles.map(x=>x.route),['paused','paused','ollama-candidate']);
 assert.equal(r.roles[2].model,'qwen2.5-coder:3b');
 assert.equal(r.executionEnabled,false);
});
test('local reviewer unavailable or disabled always pauses, never writes code',()=>{
 const a=previewFreeRoutes(roles,catalog,unknown,offline,true);
 const b=previewFreeRoutes(roles,catalog,unknown,ready,false);
 assert.equal(a.roles[2].route,'paused');
 assert.equal(a.roles[2].reason,'local-unavailable');
 assert.equal(b.roles[2].reason,'local-not-enabled');
});
test('verified Kilo remaining makes the preferred route a candidate only',()=>{
 const quota={...unknown,source:'provider-verified',remainingVerified:100};
 const r=previewFreeRoutes({...roles,reviewer:supermodel},catalog,quota,ready,false);
 assert.deepEqual(r.roles.map(x=>x.route),['kilo-candidate','kilo-candidate','kilo-candidate']);
 assert.equal(r.executionEnabled,false);
});
test('a paid or stale model never becomes a Kilo candidate',()=>{
 const r=previewFreeRoutes({...roles,builder:'paid-model'},catalog,unknown,ready,true);
 assert.equal(r.roles[1].route,'paused');
 assert.equal(r.roles[1].reason,'model-not-free');
});
