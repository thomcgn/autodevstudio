import test from 'node:test';
import assert from 'node:assert/strict';
import {installRequiredIssueLabels,REQUIRED_ISSUE_LABELS} from '../src/core/issue-label-onboarding.ts';

const evidence={repository:'example/studio',branch:'main',rulesetId:15,
 requiredChecks:['typecheck','ui','desktop'],verifiedAt:'2026-11-22T14:00:00Z'};
function fixture(existing=[]){
 const calls=[];
 const runner=async args=>{
  calls.push([...args]);
  if(args[0]==='label'&&args[1]==='list')return JSON.stringify(existing);
  if(args[0]==='label'&&args[1]==='create')return '';
  throw Error('unexpected gh command');
 };
 return {runner,calls};
}
test('first setup creates only repository-scoped defined labels',async()=>{
 const f=fixture();
 const result=await installRequiredIssueLabels('/tmp/not-used',f.runner,async()=>evidence);
 assert.equal(result.repository,'example/studio');
 assert.equal(result.created.length,REQUIRED_ISSUE_LABELS.length);
 assert.equal(f.calls.length,REQUIRED_ISSUE_LABELS.length+1);
 for(const args of f.calls){
  assert.equal(args.includes('--repo'),true);
  assert.equal(args[args.indexOf('--repo')+1],'example/studio');
  assert.equal(args.includes('--force'),false);
  assert.equal(args.includes('--edit'),false);
 }
});
test('already compliant server definitions are idempotent without writes',async()=>{
 const existing=REQUIRED_ISSUE_LABELS.map(x=>({...x}));
 const f=fixture(existing);
 const result=await installRequiredIssueLabels('/tmp/project',f.runner,async()=>evidence);
 assert.equal(result.created.length,0);
 assert.equal(result.alreadyPresent.length,REQUIRED_ISSUE_LABELS.length);
 assert.equal(f.calls.length,1);
});
test('conflicting definitions cause fail-closed with no mutations',async()=>{
 const f=fixture([{name:'status:ready',color:'000000',description:'wrong'}]);
 await assert.rejects(installRequiredIssueLabels('/tmp/project',f.runner,async()=>evidence),
  /Conflicting existing label definitions/);
 assert.equal(f.calls.length,1);
});
test('no current verified branch protection means no GitHub label access',async()=>{
 const f=fixture();
 await assert.rejects(installRequiredIssueLabels('/tmp/project',f.runner,
  async()=>{throw Error('branch protection not verified');}),/branch protection/);
 assert.equal(f.calls.length,0);
});
test('truncated or corrupt GitHub responses fail before changes',async()=>{
 for(const listing of ['{}','not-json',JSON.stringify(Array(1000).fill({
   name:'label',description:'',color:'000000'}))]){
  const calls=[];
  await assert.rejects(installRequiredIssueLabels('/tmp/project',async args=>{
   calls.push(args);return listing;
  },async()=>evidence),/GitHub label/);
  assert.equal(calls.length,1);
 }
});
test('partial write failure is not silently retried or presented as success',async()=>{
 let writes=0;
 await assert.rejects(installRequiredIssueLabels('/tmp/project',async args=>{
  if(args[1]==='list')return '[]';
  writes++;
  throw Error('GitHub 429 or permission denied');
 },async()=>evidence),/GitHub 429/);
 assert.equal(writes,1);
});
test('invalid protection evidence fails closed even with apparent auth',async()=>{
 const f=fixture();
 await assert.rejects(installRequiredIssueLabels('/tmp/project',f.runner,
  async()=>({...evidence,repository:'evil/../other'})),/Cannot verify selected repository/);
 assert.equal(f.calls.length,0);
});
