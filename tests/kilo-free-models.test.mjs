import test from 'node:test';
import assert from 'node:assert/strict';
import {parseFreeModels,fetchKiloFreeModels} from '../src/core/kilo-free-models.ts';

const ultra='nvidia/nemotron-3-ultra-550b-a55b:free';
const entry=(id,pricing={prompt:'0',completion:'0'},name=id)=>({id,name,pricing});
test('only explicitly free catalog entries, Nemotron 3 Ultra first',()=>{
 const models=parseFreeModels({data:[
  entry('anthropic/claude-opus', {prompt:'0.01',completion:'0.02'}),
  entry('premium/model'),
  entry('kilo-auto/frontier'),
  entry('kilo-auto/free'),
  entry('other/coder:free'),
  entry(ultra),
  entry(ultra),
  entry('sneaky/paid:free',{prompt:'0.01',completion:'0'}),
  entry('unknown/maybe:free',{prompt:'0',completion:'unknown'}),
 ]});
 assert.deepEqual(models.map(x=>x.id),[ultra,'kilo-auto/free','other/coder:free']);
 assert.equal(models[0].preferred,true);
});
test('reject malformed entries and unknown catalog formats',()=>{
 assert.throws(()=>parseFreeModels([]));
 assert.throws(()=>parseFreeModels({data:{}}));
 assert.deepEqual(parseFreeModels({data:[{},null,17,{id:'bad id:free'},entry('paid/basic')]}),[]);
});
test('catalog is fetched from fixed read-only HTTPS endpoint without credentials',async()=>{
 const result=await fetchKiloFreeModels(async(url,init)=>{
  assert.equal(url,'https://ai-gateway.kilo.ai/api/v1/models');
  assert.equal(init.method,'GET');
  assert.equal(init.redirect,'error');
  assert.equal(init.body,undefined);
  assert.equal(init.headers,undefined);
  return new Response(JSON.stringify({data:[entry(ultra)]}));
 });
 assert.deepEqual(result.models.map(x=>x.id),[ultra]);
 assert.ok(!Number.isNaN(Date.parse(result.checkedAt)));
});
test('invalid HTTP, response and oversize fail closed, never return paid models',async()=>{
 await assert.rejects(fetchKiloFreeModels(async()=>new Response('bad',{status:500})));
 await assert.rejects(fetchKiloFreeModels(async()=>new Response('{not JSON')));
 await assert.rejects(fetchKiloFreeModels(async()=>new Response('x'.repeat(1024*1024+1))));
});
