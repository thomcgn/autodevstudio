import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { probeOfflineReviewerSandbox } from '../src/core/offline-reviewer-probe.ts';
function fixture(t){
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'autodev-reviewer-check-'));
  t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
  const pkg=path.join(home,'.local','npm','lib','node_modules','@kilocode','cli');
  const binary=path.join(pkg,'bin','kilo');
  fs.mkdirSync(path.dirname(binary),{recursive:true});
  fs.writeFileSync(path.join(pkg,'package.json'),JSON.stringify({name:'@kilocode/cli'}));
  fs.writeFileSync(binary,'#!/usr/bin/env node\n',{mode:0o755});
  return {home,binary};
}
test('offline reviewer probe is separate from user projects and never invokes an agent',async t=>{
  const {home,binary}=fixture(t);
  let calls=0;
  const result=await probeOfflineReviewerSandbox(async launch=>{
    calls++;
    assert.equal(launch.binary,'bwrap');
    assert.ok(launch.args.includes('--unshare-net'));
    assert.ok(launch.args.includes('--clearenv'));
    assert.ok(!launch.args.includes('--auto'));
    assert.ok(!launch.args.includes('/project'));
    assert.ok(!launch.args.includes(home));
    assert.deepEqual(launch.args.slice(-4),['--','/opt/kilo/bin/kilo','run','--help']);
    const config=JSON.parse(launch.args[launch.args.indexOf('KILO_CONFIG_CONTENT')+1]);
    assert.equal(config.permission['*'],'deny');
    assert.equal(config.agent['autodev-reviewer'].permission['*'],'deny');
    assert.ok(launch.cwd.startsWith(os.tmpdir()+path.sep));
    return 'Usage: kilo run --model provider/model --agent reviewer\n';
  },()=>binary);
  assert.equal(calls,process.platform==='linux'?1:0);
  assert.equal(result.passed,process.platform==='linux');
});
test('unavailable Kilo and failed CLI are sanitized',async t=>{
  const {binary}=fixture(t);
  if(process.platform!=='linux')return;
  assert.equal((await probeOfflineReviewerSandbox(async()=>'',()=>null)).reason,'cli-unavailable');
  const failure=await probeOfflineReviewerSandbox(async()=>{throw Error('SECRET /home/user');},()=>binary);
  assert.deepEqual(failure,{passed:false,reason:'sandbox-failed'});
  assert.ok(!JSON.stringify(failure).includes('SECRET'));
});
test('invalid help output fails closed',async t=>{
  const {binary}=fixture(t);
  if(process.platform!=='linux')return;
  assert.equal((await probeOfflineReviewerSandbox(async()=> 'no agent flags',()=>binary)).reason,'invalid-output');
});
