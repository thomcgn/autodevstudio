import test from 'node:test';
import assert from 'node:assert/strict';
import {assertBranchProtection,verifyStrictRuleset} from '../src/core/branch-protection.ts';

const repo='example/studio';
const branch='main';
const good=()=>({
  id:111,source:repo,source_type:'Repository',target:'branch',enforcement:'active',
  current_user_can_bypass:'never',bypass_actors:[],
  conditions:{ref_name:{include:['refs/heads/main'],exclude:[]}},
  rules:[
    {type:'creation'},{type:'deletion'},{type:'non_fast_forward'},
    {type:'pull_request',parameters:{required_approving_review_count:0,required_review_thread_resolution:true}},
    {type:'required_status_checks',parameters:{
      strict_required_status_checks_policy:true,
      required_status_checks:[{context:'typecheck'},{context:'UI tests'}],
    }},
  ],
});
test('active ruleset with PR, strict checks and no bypass passes',()=>{
  assert.deepEqual(verifyStrictRuleset(good(),repo,branch)?.requiredChecks,['typecheck','UI tests']);
});
test('missing, inactive, bypassable or mismatched protection always fails',()=>{
  const changes=[
    v=>{v.enforcement='evaluate';},
    v=>{v.current_user_can_bypass='always';},
    v=>{v.bypass_actors=[{actor_id:1}];},
    v=>{v.conditions.ref_name.include=['refs/heads/develop'];},
    v=>{v.conditions.ref_name.exclude=['refs/heads/main'];},
    v=>{v.source='other/repo';},
    v=>{v.rules=v.rules.filter(r=>r.type!=='pull_request');},
    v=>{v.rules=v.rules.filter(r=>r.type!=='deletion');},
    v=>{v.rules=v.rules.filter(r=>r.type!=='non_fast_forward');},
    v=>{v.rules[3].parameters.required_review_thread_resolution=false;},
    v=>{v.rules[4].parameters.strict_required_status_checks_policy=false;},
    v=>{v.rules[4].parameters.required_status_checks=[];},
    v=>{v.rules[4].parameters.required_status_checks=[{context:''}];},
    v=>{v.rules[4].parameters.required_status_checks=[{context:'typecheck'},{context:'typecheck'}];},
  ];
  for(const change of changes){
    const candidate=good();
    change(candidate);
    assert.equal(verifyStrictRuleset(candidate,repo,branch),null);
  }
  assert.equal(verifyStrictRuleset(null,repo,branch),null);
});
const runner=(rules,options={})=>async(bin,args)=>{
  if(bin==='git')return options.remote??'https://github.com/example/studio.git\n';
  const endpoint=args.at(-1);
  if(endpoint==='repos/example/studio')return JSON.stringify({full_name:repo,default_branch:'main'});
  if(endpoint.startsWith('repos/example/studio/rulesets?'))return JSON.stringify([[{id:111,enforcement:'active'}]]);
  if(endpoint==='repos/example/studio/rulesets/111')return JSON.stringify(rules);
  throw Error('Unexpected network request');
};
test('live check only accepts matching origin, repo and ruleset',async()=>{
  const verified=await assertBranchProtection('/example',runner(good()));
  assert.equal(verified.rulesetId,111);
  assert.equal(verified.repository,repo);
  await assert.rejects(assertBranchProtection('/example',runner(good(),{
    remote:'https://github.com/another/studio.git',
  })),/Branch protection required/);
});
test('GitHub API failure, malformed state and absent rules fail closed',async()=>{
  await assert.rejects(assertBranchProtection('/example',async()=>{throw Error('403')}),/verification unavailable/);
  await assert.rejects(assertBranchProtection('/example',runner({...good(),enforcement:'disabled'})),/no active/);
  await assert.rejects(assertBranchProtection('/example',async(bin,args)=>{
    if(bin==='git')return 'https://github.com/example/studio.git';
    if(args.at(-1)==='repos/example/studio')return JSON.stringify({full_name:repo,default_branch:'main'});
    return 'invalid json';
  }),/verification unavailable/);
});
