import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { acquireProjectLock } from '../src/core/project-lock.ts';
import { prepareIssueBranch } from '../src/core/issue-branch.ts';

const git=(cwd,...args)=>execFileSync('git',args,{cwd,encoding:'utf8'}).trim();
function setup(t) {
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'studio-branches-'));
  t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
  const root=path.join(base,'project');fs.mkdirSync(root);
  git(root,'init','-q');git(root,'config','user.email','test@example.invalid');
  git(root,'config','user.name','Test');
  git(root,'checkout','-qb','main');
  git(root,'remote','add','origin','https://github.com/thomcgn/autodevstudio.git');
  fs.writeFileSync(path.join(root,'file.txt'),'original');
  git(root,'add','file.txt');git(root,'commit','-qm','initial');
  return {base,root};
}
test('creates a safe per-issue branch and leaves main untouched',async t=>{
  const {base,root}=setup(t),head=git(root,'rev-parse','main');
  const lock=acquireProjectLock(base,root);
  try {
    const result=await prepareIssueBranch(base,root,lock.record.token,42);
    assert.deepEqual(result,{branch:'autodev/issue-42',startingHead:head,remoteSlug:'thomcgn/autodevstudio'});
    assert.equal(git(root,'branch','--show-current'),'autodev/issue-42');
    assert.equal(git(root,'rev-parse','main'),head);
    assert.equal(git(root,'status','--porcelain'),'');
  } finally {lock.release();}
});
test('refuses missing lock, dirty tree and existing branch',async t=>{
  const {base,root}=setup(t);
  await assert.rejects(prepareIssueBranch(base,root,'no',42),/owned project lock/);
  const lock=acquireProjectLock(base,root);
  try {
    fs.writeFileSync(path.join(root,'untracked.txt'),'user');
    await assert.rejects(prepareIssueBranch(base,root,lock.record.token,42),/Unsafe branch/);
    fs.unlinkSync(path.join(root,'untracked.txt'));
    git(root,'branch','autodev/issue-42');
    await assert.rejects(prepareIssueBranch(base,root,lock.record.token,42),/already exists/);
    assert.equal(git(root,'branch','--show-current'),'main');
  } finally {lock.release();}
});
test('rejects missing remote and invalid issue numbers',async t=>{
  const {base,root}=setup(t),lock=acquireProjectLock(base,root);
  try {
    for (const n of [0,-1,1.5,Number.MAX_SAFE_INTEGER])
      await assert.rejects(prepareIssueBranch(base,root,lock.record.token,n),/Invalid issue/);
    git(root,'remote','remove','origin');
    await assert.rejects(prepareIssueBranch(base,root,lock.record.token,3),/Unsafe branch/);
  } finally {lock.release();}
});
test('rejects mutations made between preflight and branch creation',async t=>{
  const {base,root}=setup(t),lock=acquireProjectLock(base,root);
  let injected=false;
  const runner=async (args,cwd)=>{
    if (!injected && args.includes('--format=%(refname:short)')) {
      injected=true;fs.writeFileSync(path.join(root,'new.txt'),'external change');
    }
    return execFileSync('git',[...args],{cwd,encoding:'utf8'});
  };
  try {
    await assert.rejects(prepareIssueBranch(base,root,lock.record.token,3,runner),/drift/);
    assert.equal(git(root,'branch','--show-current'),'main');
  } finally {lock.release();}
});
