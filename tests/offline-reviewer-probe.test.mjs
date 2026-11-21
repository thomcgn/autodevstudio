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
    const stage=launch.args.at(-1)==='--version'?'runtime':launch.args.includes('KILO_CONFIG_CONTENT')?'policy':'help';
    assert.equal(launch.binary,'bwrap');
    assert.ok(launch.args.includes('--unshare-net'));
    assert.ok(launch.args.includes('--clearenv'));
    assert.ok(!launch.args.includes('--auto'));
    assert.ok(!launch.args.includes('/project'));
    assert.ok(!launch.args.includes(home));
    if(stage==='runtime')assert.deepEqual(launch.args.slice(-3),['--','/opt/kilo/bin/kilo','--version']);
    else assert.deepEqual(launch.args.slice(-4),['--','/opt/kilo/bin/kilo','run','--help']);
    if(stage==='policy'){
      const config=JSON.parse(launch.args[launch.args.indexOf('KILO_CONFIG_CONTENT')+1]);
      assert.equal(config.permission['*'],'deny');
      assert.equal(config.agent['autodev-reviewer'].permission['*'],'deny');
    }else assert.equal(launch.args.includes('KILO_CONFIG_CONTENT'),false);
    assert.ok(launch.cwd.startsWith(os.tmpdir()+path.sep));
    return stage==='runtime'?'kilo 7.8.27\n':'Usage: kilo run --model provider/model --agent reviewer\n';
  },()=>binary);
  assert.equal(calls,process.platform==='linux'?3:0);
  assert.equal(result.passed,process.platform==='linux');
  if(process.platform==='linux')assert.deepEqual(result,{passed:true,reason:'passed',stage:null,detail:null,exitCode:null});
});
test('unavailable Kilo and failed CLI are sanitized',async t=>{
  const {binary}=fixture(t);
  if(process.platform!=='linux')return;
  assert.equal((await probeOfflineReviewerSandbox(async()=>'',()=>null)).reason,'cli-unavailable');
  const failure=await probeOfflineReviewerSandbox(async()=>{throw Error('SECRET /home/user');},()=>binary);
  assert.deepEqual(failure,{passed:false,reason:'sandbox-failed',stage:'runtime',detail:'other',exitCode:null});
  assert.ok(!JSON.stringify(failure).includes('SECRET'));
});
test('invalid help output fails closed',async t=>{
  const {binary}=fixture(t);
  if(process.platform!=='linux')return;
  const result=await probeOfflineReviewerSandbox(async launch=>launch.args.at(-1)==='--version'?'kilo 7.8.27\n':'no agent flags',()=>binary);
  assert.equal(result.reason,'invalid-output');
  assert.equal(result.stage,'help');
});

test('runtime works but deny-all config fails: report policy without stderr',async t=>{
  const {binary}=fixture(t);
  if(process.platform!=='linux')return;
  const seen=[];
  const result=await probeOfflineReviewerSandbox(async launch=>{
    const hasPolicy=launch.args.includes('KILO_CONFIG_CONTENT');
    const isVersion=launch.args.at(-1)==='--version';
    seen.push(isVersion?'runtime':hasPolicy?'policy':'help');
    if(hasPolicy){const e=new Error('secret from /home/user');e.code=254;e.stderr='configuration invalid in /home/user';throw e;}
    return isVersion?'kilo 7.8.27\n':'Usage: kilo run --model example --agent reviewer\n';
  },()=>binary);
  assert.deepEqual(seen,['runtime','help','policy','policy']);
  assert.equal(result.stage,'policy');
  assert.equal(result.detail,'permission-or-config');
  assert.equal(result.exitCode,254);
  assert.ok(!JSON.stringify(result).includes('/home/user'));
});
test('Bubblewrap launch error classified separately from provider policy',async t=>{
  const {binary}=fixture(t);
  if(process.platform!=='linux')return;
  const result=await probeOfflineReviewerSandbox(async()=>{
    const e=new Error('ignored');e.code=1;e.stderr='bwrap: failed to mount /proc: Operation not permitted';throw e;
  },()=>binary);
  assert.equal(result.stage,'runtime');
  assert.equal(result.detail,'mount-or-namespace');
  assert.equal(result.exitCode,1);
});

test('reviewer help fallback works both without and with deny-all policy',async t=>{
  const {binary}=fixture(t);
  if(process.platform!=='linux')return;
  const seen=[];
  const result=await probeOfflineReviewerSandbox(async launch=>{
    const args=launch.args.slice(launch.args.indexOf('--')+2);
    const hasPolicy=launch.args.includes('KILO_CONFIG_CONTENT');
    seen.push([hasPolicy?'policy':'plain',args.join(' ')]);
    if(args.join(' ')==='--version')return 'kilo 7.8.27\n';
    if(args.join(' ')==='run --help'){
      const e=new Error('CLI help entrypoint exited');e.code=254;throw e;
    }
    assert.deepEqual(args,['help','run']);
    return 'kilo run --model provider/model --agent reviewer\n';
  },()=>binary);
  assert.equal(result.passed,true);
  assert.deepEqual(seen,[
    ['plain','--version'],
    ['plain','run --help'],['plain','help run'],
    ['policy','run --help'],['policy','help run'],
  ]);
});
