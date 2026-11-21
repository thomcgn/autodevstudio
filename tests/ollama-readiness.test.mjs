import test from 'node:test';
import assert from 'node:assert/strict';
import {probeOllamaReadiness} from '../src/core/ollama-readiness.ts';
const api=(names)=>new Response(JSON.stringify({models:names.map(name=>({name}))}),{status:200});
test('local fixed API checks exact model without model generation',async()=>{
 let calls=0;
 const result=await probeOllamaReadiness(async(url,init)=>{
   calls++;
   assert.equal(url,'http://127.0.0.1:11434/api/tags');
   assert.equal(init.method,'GET');
   assert.equal(init.redirect,'error');
   assert.equal(init.body,undefined);
   return api(['qwen2.5-coder:3b']);
 });
 assert.equal(calls,1);
 assert.deepEqual(result,{ready:true,reason:'ready'});
});
test('missing model has explicit safe status',async()=>{
 const result=await probeOllamaReadiness(async()=>api(['another:latest']));
 assert.deepEqual(result,{ready:false,reason:'model-missing'});
});
test('transport failure, HTTP errors and malformed responses are distinct and sanitized',async()=>{
 assert.deepEqual(await probeOllamaReadiness(async()=>{throw Error('SECRET /home/user')}),
   {ready:false,reason:'unreachable'});
 assert.deepEqual(await probeOllamaReadiness(async()=>new Response('SECRET',{status:503})),
   {ready:false,reason:'http-error'});
 assert.deepEqual(await probeOllamaReadiness(async()=>new Response('{invalid')),
   {ready:false,reason:'invalid-response'});
 assert.deepEqual(await probeOllamaReadiness(async()=>new Response(JSON.stringify({models:[{wrong:'shape'}]}))),
   {ready:false,reason:'invalid-response'});
});
test('oversized response cannot be used for denial-of-service or leaked to UI',async()=>{
 const response=new Response(JSON.stringify({models:[{name:'a'.repeat(70000)}]}));
 assert.deepEqual(await probeOllamaReadiness(async()=>response),
   {ready:false,reason:'invalid-response'});
});
test('deadline-aborted request is classified as timeout',async()=>{
 const result=await probeOllamaReadiness(async(_url,opts)=>
   new Promise((_resolve,reject)=>{
     opts.signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true});
   }),100);
 assert.deepEqual(result,{ready:false,reason:'timeout'});
});
