import test from 'node:test';
import assert from 'node:assert/strict';
import {listOwnedGitHubRepositories} from '../src/core/owned-github-repositories.ts';

const entry=(name,isPrivate=false)=>({
 full_name:name,private:isPrivate,default_branch:'main',
 description:'A project',updated_at:'2026-11-22T12:00:00Z',
});
test('authenticated owned list preserves public/private metadata and is read only',async()=>{
 const paths=[];
 const repos=await listOwnedGitHubRepositories(async endpoint=>{
  paths.push(endpoint);
  return [entry('example/public'),entry('example/private',true)];
 });
 assert.deepEqual(repos.map(r=>r.fullName),['example/public','example/private']);
 assert.equal(repos[1].isPrivate,true);
 assert.deepEqual(paths,['user/repos?affiliation=owner&per_page=100&page=1&sort=updated']);
});
test('fetches second page only when a full first page is received',async()=>{
 const pages=[];
 const result=await listOwnedGitHubRepositories(async endpoint=>{
  pages.push(endpoint);
  return pages.length===1
    ?Array.from({length:100},(_,i)=>entry('example/repo'+i))
    :[entry('example/last')];
 });
 assert.equal(result.length,101);
 assert.equal(pages[1],'user/repos?affiliation=owner&per_page=100&page=2&sort=updated');
});
test('deduplicates repository records without changing GitHub state',async()=>{
 const result=await listOwnedGitHubRepositories(async()=>[
  entry('example/Repo'),entry('example/repo'),entry('example/other')]);
 assert.equal(result.length,2);
});
test('API failures and unexpected response shapes fail closed',async()=>{
 await assert.rejects(listOwnedGitHubRepositories(async()=>{throw Error('403');}),/nicht geladen/);
 for(const invalid of [{items:[]},[entry('example/bad'),{full_name:'evil/../repo',private:false,
   default_branch:'main'}],Array.from({length:101},(_,i)=>entry('example/r'+i))])
  await assert.rejects(listOwnedGitHubRepositories(async()=>invalid),/Ungültig/);
});
test('never claims an incomplete 500-result list is complete',async()=>{
 await assert.rejects(listOwnedGitHubRepositories(async(_,)=>{
  return Array.from({length:100},(_,i)=>entry('example/repo'+i));
 }),/Mehr als 500/);
});
test('invalid metadata and unexpected private values are rejected',async()=>{
 for(const change of [{private:'false'},{default_branch:'../escape'},
  {description:{}},{updated_at:'not a timestamp'}]){
  await assert.rejects(listOwnedGitHubRepositories(async()=>[
    {...entry('example/demo'),...change},
  ]),/Ungültig/);
 }
});
