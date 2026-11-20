import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { prepareControlledIssueRun } from '../src/core/controlled-run-preparation.ts';
import { loadCoreCheckpoint } from '../src/core/checkpoint-store.ts';
import { inspectProjectLock } from '../src/core/project-lock.ts';

const git=(cwd,...args)=>execFileSync('git',args,{cwd,encoding:'utf8'}).trim();
function setup(t) {
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'studio-prepare-'));
  t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
  const repo=path.join(base,'repo');fs.mkdirSync(repo);
  git(repo,'init','-q');git(repo,'config','user.name','Studio Test');
  git(repo,'config','user.email','test@example.invalid');
  git(repo,'checkout','-qb','main');
  git(repo,'remote','add','origin','https://github.com/thomcgn/autodevstudio.git');
  fs.writeFileSync(path.join(repo,'file.txt'),'baseline');
  git(repo,'add','file.txt');git(repo,'commit','-qm','baseline');
  return {base,repo};
}
test('new issue preparation creates branch, checkpoint and retained owned lock',async t=>{
  const {base,repo}=setup(t),mainHead=git(repo,'rev-parse','main');
  const prepared=await prepareControlledIssueRun(base,repo,42);
  try {
    assert.equal(prepared.branch,'autodev/issue-42');
    assert.equal(prepared.checkpoint.stage,'plan');
    assert.equal(prepared.checkpoint.issueNumber,42);
    assert.equal(prepared.checkpoint.git.head,mainHead);
    assert.equal(prepared.checkpoint.reviewPassed,false);
    assert.equal(prepared.checkpoint.qualityPassed,false);
    assert.equal(git(repo,'rev-parse','main'),mainHead);
    assert.deepEqual(loadCoreCheckpoint(base,repo),prepared.checkpoint);
    assert.equal(inspectProjectLock(base,repo).token,prepared.lock.record.token);
    await assert.rejects(prepareControlledIssueRun(base,repo,43),/locked/);
  } finally {prepared.lock.release();}
});
test('cannot silently start another run over existing checkpoint',async t=>{
  const {base,repo}=setup(t);
  const prepared=await prepareControlledIssueRun(base,repo,42);
  prepared.lock.release();
  await assert.rejects(prepareControlledIssueRun(base,repo,43),/Existing Studio checkpoint/);
  assert.equal(inspectProjectLock(base,repo),null);
  assert.equal(git(repo,'branch','--show-current'),'autodev/issue-42');
});
test('fails cleanly on dirty working tree without leaving a lock',async t=>{
  const {base,repo}=setup(t);
  fs.writeFileSync(path.join(repo,'untracked.txt'),'user work');
  await assert.rejects(prepareControlledIssueRun(base,repo,5),/Unsafe branch preparation/);
  assert.equal(inspectProjectLock(base,repo),null);
  assert.equal(git(repo,'branch','--show-current'),'main');
  assert.equal(loadCoreCheckpoint(base,repo),null);
});
