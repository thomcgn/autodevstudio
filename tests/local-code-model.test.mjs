import test from 'node:test';
import assert from 'node:assert/strict';
import {localCodeModel} from '../src/core/local-issue-to-code.ts';

test('real local builder transport uses fixed Ollama loopback and never exposes tools',async()=>{
 const original=globalThis.fetch;
 let calls=0;
 globalThis.fetch=async(url,options)=>{
  calls++;
  assert.equal(url,'http://127.0.0.1:11434/api/chat');
  assert.equal(options.method,'POST');
  assert.equal(options.redirect,'error');
  assert.equal(options.headers.Authorization,undefined);
  const body=JSON.parse(options.body);
  assert.equal(body.model,'qwen2.5-coder:3b');
  assert.equal(body.stream,false);
  assert.equal(body.think,false);
  assert.equal(body.tools,undefined);
  assert.deepEqual(body.messages.map(m=>m.role),['system','user']);
  assert.equal(body.messages[1].content,'Choose one source file');
  return new Response(JSON.stringify({model:'qwen2.5-coder:3b',done:true,
    message:{role:'assistant',content:'{"path":"src/a.ts"}'}}),{status:200});
 };
 try{
  assert.equal(await localCodeModel('Choose one source file'),'{"path":"src/a.ts"}');
  assert.equal(calls,1);
 }finally{globalThis.fetch=original;}
});
test('untrusted tool calls or unfinished completions are rejected',async()=>{
 const original=globalThis.fetch;
 try{
  for(const payload of [
    {model:'qwen2.5-coder:3b',done:true,message:{
      role:'assistant',content:'{}',tool_calls:[{function:{name:'exec',arguments:{}}}]}},
    {model:'qwen2.5-coder:3b',done:false,message:{role:'assistant',content:'{}'}},
  ]){
   globalThis.fetch=async()=>new Response(JSON.stringify(payload),{status:200});
   await assert.rejects(localCodeModel('Test the response'),/request failed or invalid/);
  }
 }finally{globalThis.fetch=original;}
});
test('aborted model request never contacts local provider',async()=>{
 const original=globalThis.fetch;
 const abort=new AbortController();abort.abort();
 let called=false;
 globalThis.fetch=async()=>{called=true;throw Error('should not run')};
 try{
  await assert.rejects(localCodeModel('Run',abort.signal),/cancelled/);
  assert.equal(called,false);
 }finally{globalThis.fetch=original;}
});
