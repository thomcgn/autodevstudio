import test from 'node:test';
import assert from 'node:assert/strict';
import {createKiloLearningModel} from '../src/core/kilo-learning-gateway.ts';

const ok=(content='{"title":"Test result"}')=>new Response(JSON.stringify({
 choices:[{finish_reason:'stop',message:{role:'assistant',content}}],
}),{status:200,headers:{'Content-Type':'application/json'}});
test('Kilo learning sends text only to fixed HTTPS endpoint, with no tools or git writes',async()=>{
 const calls=[];
 const model=createKiloLearningModel({
  readKey:()=>null,
  fetcher:async(url,init)=>{calls.push({url,init});return ok();},
 });
 const result=await model('trusted system','public source snippet',
  new AbortController().signal);
 assert.match(result,/title/);
 assert.equal(calls.length,1);
 assert.equal(calls[0].url,'https://ai-gateway.kilo.ai/api/v1/chat/completions');
 assert.equal(calls[0].init.redirect,'error');
 const body=JSON.parse(calls[0].init.body);
 assert.equal(body.tool_choice,'none');
 assert.equal(body.stream,false);
 assert.equal(body.model,'kilo-auto/free');
 assert.deepEqual(body.messages.map(x=>x.role),['system','user']);
 assert.equal(JSON.stringify(body).includes('tools'),false);
 assert.equal(calls[0].init.headers.Authorization,undefined);
});
test('Kilo learning refuses priced model identifiers and malformed responses',async()=>{
 assert.throws(()=>createKiloLearningModel({model:'paid/model'}),/free/);
 const model=createKiloLearningModel({fetcher:async()=>new Response(JSON.stringify({
  choices:[{finish_reason:'length',message:{role:'assistant',content:'truncated'}}],
 }))});
 await assert.rejects(model('system','source',new AbortController().signal),
  /Kilo completion truncated at token limit/);
});
test('Kilo rate limits fail without hidden fallback or retry',async()=>{
 let calls=0;
 const model=createKiloLearningModel({fetcher:async()=>{calls++;
  return new Response('',{status:429});}});
 await assert.rejects(model('system','source',new AbortController().signal),
  /quota exceeded/);
 assert.equal(calls,1);
});
test('Kilo learning cancellation blocks HTTP requests and oversized source prompts',async()=>{
 let calls=0;
 const model=createKiloLearningModel({fetcher:async()=>{calls++;return ok();}});
 const controller=new AbortController();controller.abort();
 await assert.rejects(model('system','source',controller.signal),/cancelled/);
 await assert.rejects(model('system','x'.repeat(30000),
  new AbortController().signal),/exceeds safe size/);
 assert.equal(calls,0);
});

test('Kilo reports explicit output token exhaustion without accepting a partial lesson',async()=>{
 let requests=0;
 const model=createKiloLearningModel({fetcher:async(_url,init)=>{
  requests++;
  const body=JSON.parse(init.body);
  assert.equal(body.max_tokens,4096);
  return new Response(JSON.stringify({choices:[{
   finish_reason:'length',
   message:{role:'assistant',content:'{"title":"Partial reply"}'},
  }]}));
 }});
 await assert.rejects(model('system','source',new AbortController().signal),
  /Kilo completion truncated at token limit/);
 assert.equal(requests,1);
});
