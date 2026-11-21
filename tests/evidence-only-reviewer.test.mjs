import test from 'node:test';
import assert from 'node:assert/strict';
import { createEvidenceOnlyReviewerRequest, createEvidenceOnlyReviewer } from '../src/core/evidence-only-reviewer.ts';

const issue={number:8,title:'Fix validation',body:'Please fix the user input validator'};
const plan={summary:'Add check',steps:['validate']};
const build={summary:'Added a check'};
const evidence={
  identity:{head:'a'.repeat(40),branch:'autodev/issue-8',worktreeHash:'b'.repeat(64)},
  fingerprint:'c'.repeat(64),status:' M validator.ts',
  unstagedDiff:'diff --git a/validator.ts b/validator.ts\n+if (input) return true;',
  stagedDiff:'',recentCommits:'aaaa add validation',
};
const wrap=x=>'AUTODEV_JSON_BEGIN\n'+JSON.stringify(x)+'\nAUTODEV_JSON_END';

test('creates model-only request containing exact reviewed changes and fingerprint',async()=>{
  const request=createEvidenceOnlyReviewerRequest(issue,plan,build,evidence);
  assert.equal(request.issueNumber,8);
  assert.equal(request.fingerprint,'c'.repeat(64));
  assert.match(request.prompt,/UNSTAGED AND STAGED PATCH/);
  assert.match(request.prompt,/diff --git/);
  assert.match(request.prompt,/untrusted content/);
  let sent=0;
  const reviewer=createEvidenceOnlyReviewer(async data=>{
    sent++;
    assert.equal(data.fingerprint,request.fingerprint);
    assert.equal(data.prompt,request.prompt);
    return wrap({verdict:'PASS',blockers:0,summary:'Diff reviewed'});
  });
  assert.equal((await reviewer(issue,plan,build,evidence)).verdict,'PASS');
  assert.equal(sent,1);
});
test('missing diff, untracked files or wrong branch fail closed before calling model',async()=>{
  let called=false;
  const reviewer=createEvidenceOnlyReviewer(async()=>{called=true;return wrap({verdict:'PASS',blockers:0,summary:'yes'});});
  for(const item of [{...evidence,unstagedDiff:''},{...evidence,status:'?? secret.ts'},{...evidence,identity:{...evidence.identity,branch:'main'}}]){
    await assert.rejects(reviewer(issue,plan,build,item),/diff|Untracked|branch/);
  }
  assert.equal(called,false);
});
test('oversized or untrustworthy evidence is rejected rather than silently truncated',()=>{
  for(const item of [{...evidence,unstagedDiff:'x'.repeat(20000)},
    {...evidence,identity:{...evidence.identity,head:'invalid'}},
    {...evidence,status:'x'.repeat(3000)}]){
    assert.throws(()=>createEvidenceOnlyReviewerRequest(issue,plan,build,item),/limit|identity/);
  }
  assert.throws(()=>createEvidenceOnlyReviewerRequest({...issue,body:'x'.repeat(9000)},plan,build,evidence),/limit/);
});
test('reviewer failure, malformed answer and abort cannot pass',async()=>{
  const failed=createEvidenceOnlyReviewer(async()=>wrap({verdict:'PASS',blockers:3,summary:'invalid'}));
  await assert.rejects(failed(issue,plan,build,evidence),/zero blockers/);
  const aborted=new AbortController();aborted.abort();
  let called=false;
  const reviewer=createEvidenceOnlyReviewer(async()=>{called=true;return wrap({verdict:'PASS',blockers:0,summary:'ok'});},aborted.signal);
  await assert.rejects(reviewer(issue,plan,build,evidence),/cancelled/);
  assert.equal(called,false);
});
