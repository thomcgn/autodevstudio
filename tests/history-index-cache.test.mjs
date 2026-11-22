import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {readCompletePublicHistory} from '../src/core/history-index-cache.ts';

const HEAD='a'.repeat(40);
const SHAS=Array.from({length:2055},(_,i)=>(i+1).toString(16).padStart(40,'0'));
function api({failAtPage=0,requests}){
 return async endpoint=>{
  requests.push(endpoint);
  if(endpoint==='repos/example/studio')return {
   private:false,full_name:'example/studio',default_branch:'main',size:300000,
   license:{spdx_id:'MIT'},
  };
  if(endpoint==='repos/example/studio/branches/main')
   return {commit:{sha:HEAD}};
  if(endpoint.startsWith('repos/example/studio/commits?')){
   const url=new URL('https://api.github.com/'+endpoint);
   const page=Number(url.searchParams.get('page')??1);
   assert.equal(url.searchParams.get('sha'),HEAD);
   assert.equal(url.searchParams.get('per_page'),'100');
   if(page===failAtPage)throw Error('GitHub API rate limit');
   return SHAS.slice((page-1)*100,page*100).map(sha=>({
    sha,commit:{message:'unit-tested historical change'},
   }));
  }
  throw Error('Unexpected API request '+endpoint);
 };
}
test('large repository resumes at cached page after API rate limit',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'autodev-commits-'));
 try{
  const firstRequests=[];
  const progress=[];
  await assert.rejects(readCompletePublicHistory(directory,'example/studio',{
   read:api({failAtPage:7,requests:firstRequests}),
   onProgress:(count,page)=>progress.push({count,page}),
  }),/rate limit/);
  assert.equal(progress.at(-1).count,600);
  const resumedRequests=[];
  const result=await readCompletePublicHistory(directory,'example/studio',{
   read:api({requests:resumedRequests}),
  });
  assert.equal(result.commits.length,2055);
  assert.equal(result.head,HEAD);
  assert.equal(result.licenseSpdx,'MIT');
  assert.equal(new Set(result.commits.map(x=>x.sha)).size,2055);
  assert.equal(resumedRequests.some(x=>x.includes('page=2')),false);
  assert.equal(resumedRequests.some(x=>x.includes('page=6')),false);
  assert.equal(resumedRequests.some(x=>x.includes('page=7')),true);
  const fullyCachedRequests=[];
  const cached=await readCompletePublicHistory(directory,'example/studio',{
   read:api({requests:fullyCachedRequests}),
  });
  assert.equal(cached.commits.length,2055);
  assert.equal(fullyCachedRequests.filter(x=>x.includes('page=')).length,1);
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
test('an invalid cache page fails closed rather than silently skipping history',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'autodev-cache-corrupt-'));
 try{
  const calls=[];
  await readCompletePublicHistory(directory,'example/studio',{
   read:api({requests:calls}),
  });
  const filename=path.join(directory,'learning-history-cache','example__studio',HEAD,
   'page-0000000002.json');
  const payload=JSON.parse(fs.readFileSync(filename,'utf8'));
  payload.commits[0].sha='invalid';
  fs.writeFileSync(filename,JSON.stringify(payload));
  await assert.rejects(readCompletePublicHistory(directory,'example/studio',{
   read:api({requests:[]}),
  }),/Corrupt historical commit provenance/);
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
