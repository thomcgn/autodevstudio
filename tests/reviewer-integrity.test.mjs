import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { withReviewIntegrity } from '../src/core/reviewer-integrity.ts';

const git=(cwd,...args)=>execFileSync('git',args,{cwd,encoding:'utf8'}).trim();
function setup(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-review-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  git(root,'init','-q');git(root,'config','user.email','test@example.invalid');
  git(root,'config','user.name','Studio Test');
  git(root,'checkout','-qb','autodev/issue-42');
  fs.writeFileSync(path.join(root,'file.txt'),'original');
  git(root,'add','file.txt');git(root,'commit','-qm','base');
  return root;
}
test('accepts read-only reviewer verdict on unchanged workspace',async t=>{
  const root=setup(t);
  assert.deepEqual(await withReviewIntegrity(root,async()=>({verdict:'PASS'})),{verdict:'PASS'});
});
test('rejects unexpected tracked file mutation even after claimed PASS',async t=>{
  const root=setup(t);
  await assert.rejects(withReviewIntegrity(root,async()=>{
    fs.writeFileSync(path.join(root,'file.txt'),'mutated');
    return {verdict:'PASS'};
  }),/Reviewer changed Git/);
});
test('rejects staged mutation or new untracked file',async t=>{
  const root=setup(t);
  await assert.rejects(withReviewIntegrity(root,async()=>{
    fs.writeFileSync(path.join(root,'file.txt'),'staged');
    git(root,'add','file.txt');
    return 'PASS';
  }),/Reviewer changed Git/);
  git(root,'reset','-q','HEAD','--','file.txt');
  fs.writeFileSync(path.join(root,'file.txt'),'original');
  await assert.rejects(withReviewIntegrity(root,async()=>{
    fs.writeFileSync(path.join(root,'extra.txt'),'untracked');
    return 'PASS';
  }),/Reviewer changed Git/);
});
test('detects untracked file content changes even with unchanged status output',async t=>{
  const root=setup(t);
  const extra=path.join(root,'new.txt');
  fs.writeFileSync(extra,'alpha');
  await assert.rejects(withReviewIntegrity(root,async()=>{
    fs.writeFileSync(extra,'omega');
    return 'PASS';
  }),/Reviewer changed Git/);
});
test('retains reviewer failure when repository remains unchanged',async t=>{
  const root=setup(t);
  await assert.rejects(withReviewIntegrity(root,async()=>{throw new Error('model failed');}),/model failed/);
});
test('fails closed when identity cannot be captured after review',async t=>{
  const root=setup(t);
  let calls=0;
  const identity=async()=>{if(++calls===2) throw new Error('broken git');return {head:'a'.repeat(40),branch:'a',worktreeHash:'b'.repeat(64)};};
  await assert.rejects(withReviewIntegrity(root,async()=> 'PASS',identity),/could not be verified/);
});
