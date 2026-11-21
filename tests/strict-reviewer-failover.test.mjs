import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {FreeQuotaGuard} from '../src/core/free-quota-guard.ts';
import {createStrictReviewerFailoverTransport} from '../src/core/strict-reviewer-failover.ts';
import {createEvidenceOnlyReviewer} from '../src/core/evidence-only-reviewer.ts';

const ULTRA='nvidia/nemotron-3-ultra-550b-a55b:free';
const OTHER='kilo-auto/free';
const catalog=[{id:ULTRA,name:'Ultra',preferred:true},{id:OTHER,name:'Auto Free',preferred:false}];
const evidence={
 identity:{head:'a'.repeat(40),branch:'autodev/issue-7',worktreeHash:'b'.repeat(64)},
 fingerprint:'c'.repeat(64),status:' M fixture.ts',
 unstagedDiff:'diff --git a/fixture.ts b/fixture.ts\n+return false;',stagedDiff:'',
 recentCommits:'aaaa Synthetic fixture',
};
const issue={number:7,title:'Test',body:'Prevent unauthorized access'};
const plan={summary:'Fix',steps:['Check permission']};
const build={summary:'Implemented validation'};
const answer='AUTODEV_JSON_BEGIN\n'+JSON.stringify({
 verdict:'FAIL',blockers:1,feedback:'Missing permission check',
})+'\nAUTODEV_JSON_END';
function gateway(status=200){
 return new Response(status===200?JSON.stringify({choices:[{
  message:{role:'assistant',content:answer},finish_reason:'stop',
 }]}):'REMOTE SECRET',{status});
}
function ollama(){
 return new Response(JSON.stringify({
  model:'qwen2.5-coder:3b',done:true,message:{role:'assistant',content:answer},
 }),{status:200});
}
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'autodev-review-failover-'));
 const guard=new FreeQuotaGuard(root);
 const config={
  kiloModel:ULTRA,builderModel:OTHER,freeCatalog:catalog,quota:guard,
  local:{enabled:true,model:'qwen2.5-coder:3b',ready:true,
    calibrationPassed:true,toolFreeTransportApproved:true},
 };
 const close=()=>fs.rmSync(root,{recursive:true,force:true});
 return {root,guard,config,close};
}
const review=(transport)=>createEvidenceOnlyReviewer(transport)(issue,plan,build,evidence);

test('available verified cloud quota selects Kilo and never calls Ollama',async()=>{
 const f=fixture();let cloud=0,local=0;
 try{
  f.guard.recordProviderQuota(90,Date.now()+3600000);
  const transport=createStrictReviewerFailoverTransport(f.config,async(url,init)=>{
    if(url.startsWith('https://')){cloud++;const req=JSON.parse(init.body);
      assert.equal(req.model,ULTRA);
      assert.equal(req.tool_choice,'none');
      assert.equal(req.tools,undefined);
      return gateway();}
    local++;return ollama();
  });
  assert.equal((await review(transport)).verdict,'FAIL');
  assert.equal(cloud,1);assert.equal(local,0);
  assert.equal(f.guard.snapshot().usedLocal,1);
  assert.equal(f.guard.snapshot().remainingVerified,89);
 }finally{f.close();}
});

test('real HTTP 429 persists and switches only to approved local tool-free review',async()=>{
 const f=fixture();let cloud=0,local=0;
 try{
  f.guard.recordProviderQuota(90,Date.now()+3600000);
  const transport=createStrictReviewerFailoverTransport(f.config,async(url,init)=>{
    if(url.startsWith('https://')){cloud++;return gateway(429);}
    local++;
    assert.equal(url,'http://127.0.0.1:11434/api/chat');
    const body=JSON.parse(init.body);
    assert.equal(body.tools,undefined);
    assert.equal(body.model,'qwen2.5-coder:3b');
    assert.match(body.messages[1].content,/REVIEW FINGERPRINT: c{64}/);
    return ollama();
  });
  assert.equal((await review(transport)).verdict,'FAIL');
  assert.equal(cloud,1);assert.equal(local,1);
  assert.equal(f.guard.snapshot().blockedBy429,true);
  const other=new FreeQuotaGuard(f.root);
  assert.equal(other.decide('normal',true).reason,'rate-limit');
  assert.equal((await review(transport)).verdict,'FAIL');
  assert.equal(cloud,1);assert.equal(local,2);
 }finally{f.close();}
});

test('unknown true Kilo remaining never sends cloud inference; local requires attestation',async()=>{
 const f=fixture();let count=0;
 try{
  const fetcher=async(url)=>{count++;assert.equal(url,'http://127.0.0.1:11434/api/chat');return ollama();};
  assert.equal((await review(createStrictReviewerFailoverTransport(f.config,fetcher))).verdict,'FAIL');
  assert.equal(count,1);
  for(const field of ['enabled','ready','calibrationPassed','toolFreeTransportApproved']){
    const config={...f.config,local:{...f.config.local,[field]:false}};
    await assert.rejects(review(createStrictReviewerFailoverTransport(config,fetcher)),/No approved reviewer/);
  }
  assert.equal(count,1);
  assert.equal(f.guard.snapshot().usedLocal,0);
 }finally{f.close();}
});

test('cloud invalid response or timeout must not silently route to local fallback',async()=>{
 const f=fixture();let calls=0;
 try{
  f.guard.recordProviderQuota(50,Date.now()+3600000);
  const fetcher=async(url)=>{calls++;if(url.startsWith('http://'))throw Error('Local fallback forbidden');return gateway(503);};
  await assert.rejects(review(createStrictReviewerFailoverTransport(f.config,fetcher)),/HTTP 503/);
  assert.equal(calls,1);
 }finally{f.close();}
});

test('unverified paid catalog and same builder model cannot use cloud quota',async()=>{
 const f=fixture();let cloud=0;
 try{
  f.guard.recordProviderQuota(50,Date.now()+3600000);
  const config={...f.config,kiloModel:'paid/model',local:{...f.config.local,enabled:false}};
  await assert.rejects(review(createStrictReviewerFailoverTransport(config,async()=>{cloud++;return gateway();})),
    /No approved reviewer/);
  await assert.rejects(review(createStrictReviewerFailoverTransport({...f.config,
    builderModel:ULTRA,local:{...f.config.local,enabled:false}},async()=>{cloud++;return gateway();})),
    /Reviewer model not independent/);
  assert.equal(cloud,0);
 }finally{f.close();}
});
