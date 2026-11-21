import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { probeIsolatedQualityRuntime } from '../src/core/isolated-quality-probe.ts';

test('runtime probe invokes npm --version only in throwaway repo under bwrap',async()=>{
  let invoked=0;
  const result=await probeIsolatedQualityRuntime(async launch=>{
    invoked++;
    assert.equal(launch.binary,'bwrap');
    assert.ok(launch.args.includes('--unshare-net'));
    assert.ok(launch.args.includes('--clearenv'));
    assert.ok(launch.args.includes('--ro-bind'));
    assert.ok(launch.args.includes('/project/.git'));
    assert.ok(!launch.args.includes('/home'));
    assert.deepEqual(launch.args.slice(-3),['--','/usr/bin/npm','--version']);
    assert.ok(path.basename(launch.cwd).startsWith('autodev-quality-probe-'));
    assert.ok(fs.existsSync(path.join(launch.cwd,'.git')));
    assert.equal(launch.args.includes('run'),false);
    return '10.9.4\n';
  });
  if(process.platform!=='linux') {
    assert.equal(result.reason,'unsupported-platform');
    assert.equal(invoked,0);
  } else if(!fs.existsSync('/usr/bin/npm')) {
    assert.equal(result.reason,'npm-unavailable');
    assert.equal(invoked,0);
  } else {
    assert.deepEqual(result,{supported:true,passed:true,reason:'passed'});
    assert.equal(invoked,1);
  }
});
test('runtime errors and unexpected output fail closed without leaking stdout',async()=>{
  if(process.platform!=='linux'||!fs.existsSync('/usr/bin/npm'))return;
  const failed=await probeIsolatedQualityRuntime(async()=>{throw new Error('secret credentials');});
  assert.equal(failed.reason,'sandbox-failed');
  assert.ok(!JSON.stringify(failed).includes('secret'));
  const malformed=await probeIsolatedQualityRuntime(async()=> 'HOME=/secret/path');
  assert.equal(malformed.reason,'invalid-output');
  assert.ok(!JSON.stringify(malformed).includes('/secret'));
});
