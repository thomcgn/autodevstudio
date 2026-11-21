import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {FreeQuotaGuard} from '../src/core/free-quota-guard.ts';
import {writeLocalReviewFallback} from '../src/core/local-review-fallback-settings.ts';
import {recordLocalReviewCalibration} from '../src/core/local-review-calibration-record.ts';
import {createAttestedProjectReviewerTransport} from '../src/core/attested-project-reviewer.ts';
import {createEvidenceOnlyReviewer} from '../src/core/evidence-only-reviewer.ts';

const ULTRA='nvidia/nemotron-3-ultra-550b-a55b:free';
const AUTO='kilo-auto/free';
const freeCatalog=[{id:ULTRA,name:'Ultra',preferred:true},{id:AUTO,name:'Auto',preferred:false}];
const answer='AUTODEV_JSON_BEGIN\n'+JSON.stringify({
 verdict:'FAIL',blockers:1,feedback:'Authorization check missing',
})+'\nAUTODEV_JSON_END';
const evidence={identity:{head:'a'.repeat(40),branch:'autodev/issue-7',worktreeHash:'b'.repeat(64)},
 fingerprint:'c'.repeat(64),status:' M fixture.ts',
 unstagedDiff:'diff --git a/fixture.ts b/fixture.ts\n+return true;',stagedDiff:'',
 recentCommits:'aaaa Synthetic baseline'};
const issue={number:7,title:'Check permissions',body:'Reject unauthorized access'};
const plan={summary:'check',steps:['review']};
const build={summary:'modified permissions'};
const localReply=()=>new Response(JSON.stringify({model:'qwen2.5-coder:3b',done:true,
 message:{role:'assistant',content:answer}}),{status:200});
const cloudReply=()=>new Response(JSON.stringify({choices:[{
 message:{role:'assistant',content:answer},finish_reason:'stop'}]}),{status:200});
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'autodev-attested-reviewer-'));
 const quota=new FreeQuotaGuard(root);
 const input={userData:root,projectId:'fixture-project',
   roles:{planner:AUTO,builder:AUTO,reviewer:ULTRA},
   freeCatalog,quota,ollamaReadiness:{ready:true,reason:'ready'}};
 return {root,quota,input,close:()=>fs.rmSync(root,{recursive:true,force:true})};
}
const review=transport=>createEvidenceOnlyReviewer(transport)(issue,plan,build,evidence);

test('real local fallback requires both persisted opt-in and fresh calibration',async()=>{
 const f=fixture();let calls=0;
 const fetcher=async url=>{calls++;assert.equal(url,'http://127.0.0.1:11434/api/chat');return localReply()};
 try{
  const transport=()=>createAttestedProjectReviewerTransport(f.input,fetcher);
  await assert.rejects(review(transport()),/No approved reviewer/);
  writeLocalReviewFallback(f.root,'fixture-project',true);
  await assert.rejects(review(transport()),/No approved reviewer/);
  recordLocalReviewCalibration(f.root,'fixture-project',true);
  assert.equal((await review(transport())).verdict,'FAIL');
  assert.equal(calls,1);
  recordLocalReviewCalibration(f.root,'fixture-project',false);
  await assert.rejects(review(transport()),/No approved reviewer/);
  writeLocalReviewFallback(f.root,'fixture-project',false);
  recordLocalReviewCalibration(f.root,'fixture-project',true);
  await assert.rejects(review(transport()),/No approved reviewer/);
  assert.equal(calls,1);
 }finally{f.close();}
});
test('verified Kilo can review without local opt-in; does not contact localhost',async()=>{
 const f=fixture();let cloud=0;
 try{
  f.quota.recordProviderQuota(75,Date.now()+3600000);
  const transport=createAttestedProjectReviewerTransport(f.input,async url=>{
   assert.equal(url,'https://ai-gateway.kilo.ai/api/v1/chat/completions');
   cloud++;return cloudReply();
  });
  assert.equal((await review(transport)).verdict,'FAIL');
  assert.equal(cloud,1);
  assert.equal(f.quota.snapshot().usedLocal,1);
 }finally{f.close();}
});
test('real 429 routes to attested local model without Kilo re-try',async()=>{
 const f=fixture();let cloud=0,local=0;
 try{
  writeLocalReviewFallback(f.root,'fixture-project',true);
  recordLocalReviewCalibration(f.root,'fixture-project',true);
  f.quota.recordProviderQuota(75,Date.now()+3600000);
  const transport=createAttestedProjectReviewerTransport(f.input,async url=>{
   if(url.startsWith('https://')){cloud++;return new Response('SECRET',{status:429})}
   local++;return localReply();
  });
  assert.equal((await review(transport)).verdict,'FAIL');
  assert.equal((await review(transport)).verdict,'FAIL');
  assert.equal(cloud,1);
  assert.equal(local,2);
  assert.equal(f.quota.snapshot().blockedBy429,true);
 }finally{f.close();}
});
test('unreachable local model, other projects and corrupted calibration cannot be bypassed',async()=>{
 const f=fixture();let requests=0;
 try{
  writeLocalReviewFallback(f.root,'fixture-project',true);
  recordLocalReviewCalibration(f.root,'fixture-project',true);
  const fetcher=async()=>{requests++;return localReply()};
  await assert.rejects(review(createAttestedProjectReviewerTransport({
    ...f.input,ollamaReadiness:{ready:false,reason:'unreachable'},
  },fetcher)),/No approved reviewer/);
  await assert.rejects(review(createAttestedProjectReviewerTransport({
    ...f.input,projectId:'another-project',
  },fetcher)),/No approved reviewer/);
  fs.writeFileSync(path.join(f.root,'local-review-calibration','fixture-project.json'),'{invalid');
  await assert.rejects(review(createAttestedProjectReviewerTransport(f.input,fetcher)),/manual review/);
  assert.equal(requests,0);
 }finally{f.close();}
});

test('already constructed transport immediately honors opt-out and failed re-calibration',async()=>{
 const f=fixture();let requests=0;
 try{
  writeLocalReviewFallback(f.root,'fixture-project',true);
  recordLocalReviewCalibration(f.root,'fixture-project',true);
  const transport=createAttestedProjectReviewerTransport(f.input,async url=>{
   requests++;
   assert.equal(url,'http://127.0.0.1:11434/api/chat');
   return localReply();
  });
  assert.equal((await review(transport)).verdict,'FAIL');
  writeLocalReviewFallback(f.root,'fixture-project',false);
  await assert.rejects(review(transport),/No approved reviewer/);
  writeLocalReviewFallback(f.root,'fixture-project',true);
  recordLocalReviewCalibration(f.root,'fixture-project',false);
  await assert.rejects(review(transport),/No approved reviewer/);
  assert.equal(requests,1);
 }finally{f.close();}
});
test('inconsistent local readiness cannot grant reviewer permission',async()=>{
 const f=fixture();let requests=0;
 try{
  writeLocalReviewFallback(f.root,'fixture-project',true);
  recordLocalReviewCalibration(f.root,'fixture-project',true);
  const transport=createAttestedProjectReviewerTransport({
   ...f.input,ollamaReadiness:{ready:true,reason:'unreachable'},
  },async()=>{requests++;return localReply()});
  await assert.rejects(review(transport),/No approved reviewer/);
  assert.equal(requests,0);
 }finally{f.close();}
});
