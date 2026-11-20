import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { acquireProjectLock } from '../src/core/project-lock.ts';
import { saveCoreCheckpoint } from '../src/core/checkpoint-store.ts';
import { inspectStandaloneStatus } from '../src/core/standalone-status.ts';

const git=(cwd,...args)=>execFileSync('git',args,{cwd,encoding:'utf8'}).trim();
function setup(t) {
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'studio-status-'));
  t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
  const repo=path.join(base,'repo');fs.mkdirSync(repo);
  git(repo,'init','-q');git(repo,'config','user.name','Test');
  git(repo,'config','user.email','test@example.invalid');
  git(repo,'checkout','-qb','main');
  git(repo,'remote','add','origin','git@github.com:thomcgn/autodevstudio.git');
  fs.writeFileSync(path.join(repo,'README.md'),'test');
  git(repo,'add','README.md');git(repo,'commit','-qm','initial');
  return {base,repo};
}
test('read-only status reports Git and disabled execution without legacy core',async t=>{
  const {base,repo}=setup(t);
  const status=await inspectStandaloneStatus(base,repo);
  assert.equal(status.git.branch,'main');
  assert.equal(status.git.clean,true);
  assert.equal(status.git.remoteSlug,'thomcgn/autodevstudio');
  assert.equal(status.git.canExecute,false);
  assert.equal(status.lock.held,false);
  assert.equal(status.checkpoint,null);
  assert.equal(status.executionEnabled,false);
});
test('status includes checkpoint metadata without exposing lock tokens or agent session IDs',async t=>{
  const {base,repo}=setup(t);
  const lock=acquireProjectLock(base,repo);
  try {
    saveCoreCheckpoint(base,repo,lock.record.token,{
      runId:randomUUID(),issueNumber:5,stage:'build',
      git:{head:git(repo,'rev-parse','HEAD'),branch:'main',worktreeHash:'b'.repeat(64)},
      sessions:{builder:'secretSession123'},reviewPassed:false,qualityPassed:false,
    },null);
    const status=await inspectStandaloneStatus(base,repo);
    assert.equal(status.lock.held,true);
    assert.equal(status.checkpoint?.issueNumber,5);
    assert.equal(status.checkpoint?.stage,'build');
    assert.doesNotMatch(JSON.stringify(status),/secretSession123/);
    assert.equal(JSON.stringify(status).includes(lock.record.token),false);
  } finally {lock.release();}
});
test('corrupted checkpoint cannot silently appear as no checkpoint',async t=>{
  const {base,repo}=setup(t);
  const lock=acquireProjectLock(base,repo);
  try {
    saveCoreCheckpoint(base,repo,lock.record.token,{
      runId:randomUUID(),issueNumber:5,stage:'plan',
      git:{head:git(repo,'rev-parse','HEAD'),branch:'main',worktreeHash:'b'.repeat(64)},
      sessions:{},reviewPassed:false,qualityPassed:false,
    },null);
    const {keyForProject}=await import('../src/core/project-lock.ts');
    fs.writeFileSync(path.join(base,'core-checkpoints',keyForProject(repo)+'.json'),'{invalid');
    await assert.rejects(inspectStandaloneStatus(base,repo),/Corrupted checkpoint/);
  } finally {lock.release();}
});
