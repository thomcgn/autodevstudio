import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { probeBubblewrap } from '../src/core/bwrap-probe.ts';

test('sandbox probe never targets a selected Git project or calls a model', async () => {
  let seen = 0;
  const outcome = await probeBubblewrap(async (args, cwd) => {
    seen++;
    assert.ok(args.includes('--unshare-net'));
    assert.ok(args.includes('--ro-bind'));
    assert.ok(args.includes('--die-with-parent'));
    assert.ok(args.includes('/probe'));
    assert.equal(path.basename(cwd).startsWith('autodev-sandbox-probe-'),true);
    assert.equal(fs.readFileSync(path.join(cwd,'canary.txt'),'utf8'),'original');
    assert.ok(!args.includes('kilo'));
  });
  if (process.platform === 'linux') {
    assert.equal(seen,1);
    assert.deepEqual(outcome,{available:true,isolated:true,reason:'passed'});
  } else assert.equal(outcome.reason,'unsupported-platform');
});

test('sandbox launch failure blocks readiness without leaking process error',async()=>{
  const result=await probeBubblewrap(async()=>{throw new Error('secret user home path');});
  if(process.platform==='linux'){
    assert.equal(result.isolated,false);
    assert.equal(result.reason,'sandbox-failed');
    assert.ok(!JSON.stringify(result).includes('secret'));
  }
});

test('a deceptive process success cannot hide changes to canary',async()=>{
  const result=await probeBubblewrap(async (_args,cwd)=>{
    fs.writeFileSync(path.join(cwd,'canary.txt'),'modified');
  });
  if(process.platform==='linux') assert.equal(result.reason,'canary-modified');
});
