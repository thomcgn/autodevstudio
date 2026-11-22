import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {FreeQuotaGuard} from '../src/core/free-quota-guard.ts';
import {createKiloPrimaryReviewer,selectPrimaryKiloRoles} from '../src/core/kilo-primary-reviewer.ts';

const catalog=[
 {id:'nvidia/nemotron-3-ultra-550b-a55b:free',name:'Nemotron',preferred:true},
 {id:'other/reviewer:free',name:'Other Free Reviewer',preferred:false},
];
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'kilo-primary-review-'));
 return {root,quota:new FreeQuotaGuard(root),close:()=>fs.rmSync(root,{recursive:true,force:true})};
}
test('default selection prioritizes Nemotron builder and DIFFERENT verified-free Kilo reviewer',()=>{
 const roles=selectPrimaryKiloRoles(null,catalog);
 assert.equal(roles.builder,catalog[0].id);
 assert.equal(roles.reviewer,catalog[1].id);
 assert.equal(roles.planner,catalog[0].id);
 assert.throws(()=>selectPrimaryKiloRoles({...roles,reviewer:roles.builder},catalog),
  /different model/);
});
test('one-click Reviewer uses Kilo model-only Gateway first despite unknown upstream quota',async()=>{
 const f=fixture();let calls=0;
 try {
  const roles=selectPrimaryKiloRoles(null,catalog);
  const fetcher=async(url,opts)=>{
   calls++;
   assert.equal(url,'https://ai-gateway.kilo.ai/api/v1/chat/completions');
   const body=JSON.parse(opts.body);
   assert.equal(body.model,roles.reviewer);
   assert.equal(body.tool_choice,'none');
   assert.equal(body.tools,undefined);
   assert.equal(opts.headers.Authorization,undefined);
   return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{
    role:'assistant',content:'AUTODEV_JSON_BEGIN\n'+
      JSON.stringify({verdict:'PASS',blockers:0,summary:'Safe'})+
      '\nAUTODEV_JSON_END'}}]}),{status:200});
  };
  const reviewer=createKiloPrimaryReviewer(f.root,'project',roles,catalog,f.quota,fetcher);
  const readiness=await reviewer.canReview();
  assert.equal(readiness.ready,true);
  assert.equal(f.quota.snapshot().source,'unknown');
  const result=await reviewer.transport({
   issueNumber:9,fingerprint:'c'.repeat(64),prompt:'Review isolated patch only',
  });
  assert.match(result,/verdict/);
  assert.equal(calls,1);
  assert.equal(f.quota.snapshot().usedLocal,1);
 }finally{f.close();}
});
test('Kilo 429 is persisted, not silently retried or switched to another Kilo model',async()=>{
 const f=fixture();let calls=0;
 try{
  const roles=selectPrimaryKiloRoles(null,catalog);
  const reviewer=createKiloPrimaryReviewer(f.root,'project',roles,catalog,f.quota,
   async()=>{calls++;return new Response('rate limited',{status:429})});
  await assert.rejects(reviewer.transport({
   issueNumber:1,fingerprint:'a'.repeat(64),prompt:'review',
  }),/429/);
  assert.equal(f.quota.snapshot().blockedBy429,true);
  assert.equal((await reviewer.canReview()).ready,false);
  assert.equal(calls,1);
 }finally{f.close();}
});
