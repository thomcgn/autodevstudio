import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { probeBubblewrap, classifySandboxError } from '../src/core/bwrap-probe.ts';

test('sandbox probe never targets a selected Git project or calls a model', async () => {
  let seen = 0;
  const outcome = await probeBubblewrap(async (args, cwd) => {
    seen++;
    assert.ok(args.includes('--unshare-net'));
    assert.ok(args.includes('--ro-bind'));
    assert.ok(args.includes('--die-with-parent'));
    assert.ok(args.includes('/tmp/probe'));
    assert.equal(args[args.indexOf('--chdir')+1], '/tmp/probe');
    assert.equal(path.basename(cwd).startsWith('autodev-sandbox-probe-'),true);
    assert.equal(fs.readFileSync(path.join(cwd,'canary.txt'),'utf8'),'original');
    assert.ok(!args.includes('kilo'));
  });
  if (process.platform === 'linux') {
    assert.equal(seen,1);
    assert.deepEqual(outcome,{available:true,isolated:true,reason:'passed',detail:null,exitCode:null});
  } else assert.equal(outcome.reason,'unsupported-platform');
});

test('sandbox launch failure blocks readiness without leaking process error',async()=>{
  const result=await probeBubblewrap(async()=>{throw new Error('secret user home path');});
  if(process.platform==='linux'){
    assert.equal(result.isolated,false);
    assert.equal(result.reason,'sandbox-failed');
    assert.equal(result.detail,'unknown');
    assert.ok(!JSON.stringify(result).includes('secret'));
  }
});

test('a deceptive process success cannot hide changes to canary',async()=>{
  const result=await probeBubblewrap(async (_args,cwd)=>{
    fs.writeFileSync(path.join(cwd,'canary.txt'),'modified');
  });
  if(process.platform==='linux') assert.equal(result.reason,'canary-modified');
});

test('categorizes known Linux namespace and mount failures without leaking stderr',()=>{
  assert.equal(classifySandboxError({code:1,stderr:'bwrap: Creating new namespace failed: Operation not permitted'}),'namespace-permission-denied');
  assert.equal(classifySandboxError({code:1,stderr:'bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted'}),'network-setup-denied');
  assert.equal(classifySandboxError({code:1,stderr:'bwrap: mount /probe failed: No such file or directory'}),'mount-setup-failed');
  assert.equal(classifySandboxError({code:'ETIMEDOUT',killed:true,stderr:'private'}),'timeout');
});
test('creates private writable tmpfs before binding canary read-only into it',async()=>{
  if(process.platform!=='linux') return;
  const result = await probeBubblewrap(async(args)=>{
    const tmpIndex = args.indexOf('--tmpfs');
    const bindIndex = args.indexOf('/tmp/probe');
    assert.ok(tmpIndex >= 0 && bindIndex > tmpIndex);
    assert.equal(args[tmpIndex + 1], '/tmp');
    assert.equal(args[bindIndex - 2], '--ro-bind');
    assert.ok(!args.includes('/probe'), 'mountpoint must not be under readonly root');
  });
  assert.equal(result.isolated, true, 'fake successful sandbox runner must pass validated argument layout');
});
test('failure result contains only stable diagnostic enum, not raw error',async()=>{
  if(process.platform!=='linux') return;
  const result=await probeBubblewrap(async()=>{
    const error=new Error('HOME=/private/password');
    error.code=1;
    error.stderr='bwrap: Creating new namespace failed: Operation not permitted\nsecret=somevalue';
    throw error;
  });
  assert.equal(result.detail,'namespace-permission-denied');
  assert.ok(!JSON.stringify(result).includes('secret'));
  assert.ok(!JSON.stringify(result).includes('/private'));
});

test('classifies distinct canary read, protection and verification exits',async()=>{
  assert.equal(classifySandboxError({code:40,stderr:''}),'canary-read-failed');
  assert.equal(classifySandboxError({code:41,stderr:''}),'write-protection-failed');
  assert.equal(classifySandboxError({code:42,stderr:''}),'canary-verification-failed');
});
test('provides only validated numeric exit code for failures',async()=>{
  if(process.platform!=='linux') return;
  const result=await probeBubblewrap(async()=>{const error=new Error('local private path');error.code=40;throw error;});
  assert.equal(result.exitCode,40);
  assert.equal(result.detail,'canary-read-failed');
  assert.ok(!JSON.stringify(result).includes('private'));
});
