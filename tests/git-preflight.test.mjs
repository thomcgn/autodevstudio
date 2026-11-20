import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inspectGitPreflight, parseGitHubRemote, assertGitPreflightReady } from '../src/core/git-preflight.ts';

const HEAD = 'a'.repeat(40);
function fixture(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'studio-preflight-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  return dir;
}
function mock(root, options={}) {
  const calls=[];
  const runner=async (args,cwd)=>{
    calls.push({args,cwd});
    const command=args.join(' ');
    if(command.includes('show-toplevel')) return options.top ?? root;
    if(command.includes('verify HEAD')) return HEAD;
    if(command.includes('symbolic-ref')) {
      if(options.detached) throw new Error('detached');
      return options.branch ?? 'feat/fix-issues';
    }
    if(command.includes('remote get-url')) {
      if(options.noRemote) throw new Error('missing origin');
      return options.remote ?? 'git@github.com:thomcgn/autodevstudio.git';
    }
    if(command.includes('status --porcelain')) return options.dirty ? '?? secret.txt\0' : '';
    throw new Error('Unexpected command: '+command);
  };
  return {runner,calls};
}

test('accepts clean feature branch of GitHub repo, without any write command', async t=>{
  const dir=fixture(t);
  const {runner,calls}=mock(dir);
  const readiness=await inspectGitPreflight(dir,runner);
  assert.equal(readiness.canExecute,true);
  assert.equal(readiness.remoteSlug,'thomcgn/autodevstudio');
  assert.equal(readiness.branch,'feat/fix-issues');
  assertGitPreflightReady(readiness);
  assert.ok(calls.every(x=>x.cwd===dir));
  assert.ok(calls.every(x=>!x.args.includes('commit')&&!x.args.includes('push')));
});

test('blocks the protected main branch even when clean', async t=>{
  const dir=fixture(t);
  const readiness=await inspectGitPreflight(dir,mock(dir,{branch:'main'}).runner);
  assert.equal(readiness.canExecute,false);
  assert.match(readiness.reasons.join(' '),/Protected branch/);
  assert.throws(()=>assertGitPreflightReady(readiness),/preflight failed/);
});

test('blocks untracked or pre-existing modifications', async t=>{
  const dir=fixture(t);
  const result=await inspectGitPreflight(dir,mock(dir,{dirty:true}).runner);
  assert.equal(result.clean,false);
  assert.equal(result.canExecute,false);
  assert.match(result.reasons.join(' '),/Uncommitted/);
});

test('blocks missing or unsafe remotes', async t=>{
  const dir=fixture(t);
  const result=await inspectGitPreflight(dir,mock(dir,{noRemote:true}).runner);
  assert.equal(result.canExecute,false);
  assert.match(result.reasons.join(' '),/origin/);
  assert.equal(parseGitHubRemote('https://user:secret@github.com/a/b.git'),null);
  assert.equal(parseGitHubRemote('https://github.com.evil.example/a/b.git'),null);
  assert.equal(parseGitHubRemote('https://github.com/a/b.git'),'a/b');
  assert.equal(parseGitHubRemote('git@github.com:a/b.git'),'a/b');
});

test('blocks detached HEAD and mismatched selected repository root', async t=>{
  const dir=fixture(t);
  const status=await inspectGitPreflight(dir,mock(dir,{detached:true}).runner);
  assert.equal(status.canExecute,false);
  const parent=path.dirname(dir);
  await assert.rejects(inspectGitPreflight(dir,mock(dir,{top:parent}).runner),/not the Git repository root/);
});
