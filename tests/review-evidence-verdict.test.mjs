import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewEvidenceBound, assertBoundReviewStillCurrent } from '../src/core/review-evidence-verdict.ts';
const identity={head:'a'.repeat(40),branch:'autodev/issue-7',worktreeHash:'b'.repeat(64)};
const evidence={identity,status:' M file',unstagedDiff:'patch',stagedDiff:'',recentCommits:'a init',fingerprint:'c'.repeat(64)};
const collect=async()=>evidence;

test('binds PASS to evidence and verifies it again before consumption',async()=>{
  const approval=await reviewEvidenceBound('/repo',7,async()=>({verdict:'PASS',blockers:0,summary:'reviewed'}),undefined,collect);
  assert.equal(approval.evidenceFingerprint,evidence.fingerprint);
  assert.equal(approval.issueNumber,7);
  await assertBoundReviewStillCurrent('/repo',7,approval,undefined,collect);
});
test('rejects changes during review even when model says PASS',async()=>{
  let count=0;
  const drifting=async()=>count++===0?evidence:{...evidence,fingerprint:'d'.repeat(64)};
  await assert.rejects(reviewEvidenceBound('/repo',7,async()=>({verdict:'PASS',blockers:0,summary:'approved'}),undefined,drifting),/changed/);
});
test('stale approval cannot survive later builder fix or another issue',async()=>{
  const approval=await reviewEvidenceBound('/repo',7,async()=>({verdict:'PASS',blockers:0,summary:'ok'}),undefined,collect);
  await assert.rejects(assertBoundReviewStillCurrent('/repo',7,approval,undefined,async()=>({
    ...evidence,identity:{...identity,worktreeHash:'e'.repeat(64)},
  })),/stale/);
  await assert.rejects(assertBoundReviewStillCurrent('/repo',8,approval,undefined,collect),/No matching PASS/);
});
test('review FAIL is not authorization to pass quality or publish',async()=>{
  const approval=await reviewEvidenceBound('/repo',7,async()=>({verdict:'FAIL',blockers:1,feedback:'fix bug'}),undefined,collect);
  await assert.rejects(assertBoundReviewStillCurrent('/repo',7,approval,undefined,collect),/No matching PASS/);
});
test('rejects invalid model verdicts and aborts before evidence collection',async()=>{
  await assert.rejects(reviewEvidenceBound('/repo',7,async()=>({verdict:'PASS',blockers:1,summary:'bad'}),undefined,collect),/Invalid PASS/);
  await assert.rejects(reviewEvidenceBound('/repo',7,async()=>({verdict:'FAIL',blockers:0,feedback:'bad'}),undefined,collect),/Invalid FAIL/);
  const controller=new AbortController();controller.abort();
  let called=false;
  await assert.rejects(reviewEvidenceBound('/repo',7,async()=>({verdict:'PASS',blockers:0,summary:'fine'}),controller.signal,async()=>{
    called=true;return evidence;
  }),/cancelled/);
  assert.equal(called,false);
});
