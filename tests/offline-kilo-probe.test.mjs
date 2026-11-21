import test from 'node:test';
import assert from 'node:assert/strict';
import { probeOfflineKiloRuntime } from '../src/core/offline-kilo-probe.ts';
test('CLI probe never mounts user HOME nor starts model or npm scripts',async()=>{
  let called=0;
  const result=await probeOfflineKiloRuntime(async launch=>{
    called++;
    assert.equal(launch.binary,'bwrap');
    assert.ok(launch.args.includes('--unshare-net'));
    assert.ok(launch.args.includes('--clearenv'));
    assert.ok(launch.args.includes('--proc'));
    assert.ok(!launch.args.includes('/home'));
    assert.ok(launch.cwd.includes('autodev-kilo-runtime-'));
    assert.deepEqual(launch.args.slice(-3),['--','/usr/bin/kilo','--version']);
    assert.equal(launch.args.includes('run'),false);
    assert.equal(launch.args.includes('--auto'),false);
    return 'kilo 1.0.0\n';
  },()=>'/usr/lib/node_modules/@kilocode/cli/bin/kilo');
  if(process.platform==='linux'){
    assert.deepEqual(result,{passed:true,reason:'passed'});
    assert.equal(called,1);
  }else assert.equal(called,0);
});
test('rejects CLI installed outside approved runtime tree without launching',async()=>{
  if(process.platform!=='linux')return;
  let called=0;
  const result=await probeOfflineKiloRuntime(async()=>{called++;return '1.0';},()=>'/home/user/.local/bin/kilo');
  assert.equal(result.reason,'cli-outside-usr');
  assert.equal(called,0);
});
test('handles unavailable and failed runtimes without leaking stderr',async()=>{
  if(process.platform!=='linux')return;
  assert.equal((await probeOfflineKiloRuntime(async()=>'',()=>null)).reason,'cli-unavailable');
  const result=await probeOfflineKiloRuntime(async()=>{throw new Error('SECRET HOME /home/user');},()=>'/usr/bin/kilo');
  assert.equal(result.reason,'sandbox-failed');
  assert.ok(!JSON.stringify(result).includes('/home/user'));
});
