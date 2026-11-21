import test from 'node:test';
import assert from 'node:assert/strict';
import { collectReviewEvidence } from '../src/core/review-evidence.ts';

const identity={head:'a'.repeat(40),branch:'autodev/issue-5',worktreeHash:'b'.repeat(64)};
const evidenceTool=async (_cwd,args)=>({
  output:args.includes('status')?' M src/a.ts':args.includes('log')?'abcd123 update':
    args.includes('--cached')?'staged patch':'unstaged patch',
  isolated:true,readonly:true,
});
test('captures all four allowlisted evidence commands and stable fingerprint',async()=>{
  const requested=[];
  const tool=async(cwd,args)=>{requested.push([...args]);return evidenceTool(cwd,args);};
  const capture=async()=>identity;
  const first=await collectReviewEvidence('/example',undefined,tool,capture);
  const second=await collectReviewEvidence('/example',undefined,tool,capture);
  assert.equal(first.fingerprint,second.fingerprint);
  assert.match(first.fingerprint,/^[a-f0-9]{64}$/);
  assert.equal(first.identity.branch,'autodev/issue-5');
  assert.deepEqual(requested.slice(0,4),[
    ['--no-pager','status','--porcelain=v1','--untracked-files=all'],
    ['--no-pager','diff','--no-ext-diff','--no-textconv','--'],
    ['--no-pager','diff','--cached','--no-ext-diff','--no-textconv','--'],
    ['--no-pager','log','-5','--format=%h %s'],
  ]);
});
test('rejects workspace changes occurring mid-review',async()=>{
  let checked=0;
  await assert.rejects(collectReviewEvidence('/example',undefined,evidenceTool,
    async()=>({...identity,worktreeHash:checked++===0?identity.worktreeHash:'c'.repeat(64)})),
  /Repository changed/);
});
test('rejects dishonest nonisolated tool and does not continue to later commands',async()=>{
  let invocations=0;
  await assert.rejects(collectReviewEvidence('/example',undefined,async()=>{
    invocations++;return {output:'pass',isolated:false,readonly:true};
  },async()=>identity),/not isolated/);
  assert.equal(invocations,1);
});
test('rejects excessive output and aborted run',async()=>{
  await assert.rejects(collectReviewEvidence('/example',undefined,async()=>({
    output:'x'.repeat(140000),isolated:true,readonly:true,
  }),async()=>identity),/exceeds output limits/);
  const abort=new AbortController();abort.abort();
  let called=false;
  await assert.rejects(collectReviewEvidence('/example',abort.signal,async()=>{
    called=true;return evidenceTool('/example',[]);
  },async()=>identity),/cancelled/);
  assert.equal(called,false);
});
test('fails closed on an isolated tool error',async()=>{
  await assert.rejects(collectReviewEvidence('/example',undefined,async()=>{throw Error('sandbox unavailable');},
    async()=>identity),/sandbox unavailable/);
});
