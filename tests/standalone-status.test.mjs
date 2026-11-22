import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { acquireProjectLock } from '../src/core/project-lock.ts';
import { saveCoreCheckpoint } from '../src/core/checkpoint-store.ts';
import { assessCheckpointRecovery, inspectStandaloneStatus } from '../src/core/standalone-status.ts';
import { captureGitIdentity } from '../src/core/git-identity.ts';

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
  assert.equal(status.recovery.state,'none');
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

test('orphaned lock directory is shown as occupied, not free',async t=>{
  const {base,repo}=setup(t);
  const {keyForProject}=await import('../src/core/project-lock.ts');
  const folder=path.join(base,'core-locks',keyForProject(repo)+'.lock');
  fs.mkdirSync(folder,{recursive:true});
  const status=await inspectStandaloneStatus(base,repo);
  assert.equal(status.lock.held,true);
  assert.equal(status.lock.startedAt,null);
});

test('matching checked identity only recommends inspected manual continuation',async t=>{
 const {base,repo}=setup(t);
 git(repo,'checkout','-qb','autodev/issue-6');
 const identity=await captureGitIdentity(repo);
 const lock=acquireProjectLock(base,repo);
 try{
  saveCoreCheckpoint(base,repo,lock.record.token,{
   runId:randomUUID(),issueNumber:6,stage:'review',git:identity,
   sessions:{reviewer:'review-session-0001'},reviewPassed:false,qualityPassed:false,
  },null);
 }finally{lock.release();}
 const good=await inspectStandaloneStatus(base,repo);
 assert.equal(good.recovery.state,'inspect');
 assert.equal(good.recovery.identityMatches,true);
 assert.equal(good.recovery.automaticResume,false);
 fs.writeFileSync(path.join(repo,'README.md'),'changed');
 const drift=await inspectStandaloneStatus(base,repo);
 assert.equal(drift.recovery.state,'manual');
 assert.equal(drift.recovery.identityMatches,false);
});
test('publish checkpoint is never eligible for automatic retry',async t=>{
 const {base,repo}=setup(t);
 const lock=acquireProjectLock(base,repo);
 try{
  saveCoreCheckpoint(base,repo,lock.record.token,{
   runId:randomUUID(),issueNumber:6,stage:'publish',
   git:{head:git(repo,'rev-parse','HEAD'),branch:'main',worktreeHash:'b'.repeat(64)},
   sessions:{},reviewPassed:true,qualityPassed:true,
  },null);
 }finally{lock.release();}
 const status=await inspectStandaloneStatus(base,repo);
 assert.equal(status.recovery.state,'manual');
 assert.equal(status.recovery.automaticResume,false);
 assert.match(status.recovery.reason,/GitHub-PR/);
});

test('blocked checkpoint never fabricates an original stop cause',()=>{
 const result=assessCheckpointRecovery({stage:'blocked'},false,null);
 assert.equal(result.state,'manual');
 assert.equal(result.automaticResume,false);
 assert.match(result.reason,/nicht enthalten/);
});
test('publish checkpoint requires reconciliation, not a second push',()=>{
 const result=assessCheckpointRecovery({stage:'publish'},false,null);
 assert.equal(result.state,'manual');
 assert.match(result.reason,/Commit, Push oder Draft-PR/);
});
test('missing builder or reviewer session explicitly blocks automatic resume',()=>{
 for(const stage of ['build','review']){
  const result=assessCheckpointRecovery({stage,sessions:{}},false,{});
  assert.equal(result.state,'manual');
  assert.equal(result.automaticResume,false);
  assert.match(result.reason,/Session-ID/);
 }
});
