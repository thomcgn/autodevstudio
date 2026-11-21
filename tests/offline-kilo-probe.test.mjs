import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  probeOfflineKiloRuntime, discoverKiloInstallation, classifyKiloPlacement,
} from '../src/core/offline-kilo-probe.ts';

function fixture(t,kind='standalone'){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'autodev-kilo-install-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const directory=kind==='npm'
    ?path.join(root,'lib','node_modules','@kilocode','cli','bin')
    :path.join(root,'bin');
  fs.mkdirSync(directory,{recursive:true});
  const binary=path.join(directory,'kilo');
  fs.writeFileSync(binary,'#!/usr/bin/env node\nconsole.log("test")\n',{mode:0o755});
  if(kind==='npm'){
    fs.writeFileSync(path.join(path.dirname(directory),'package.json'),
      JSON.stringify({name:'@kilocode/cli',version:'1.0.0'}));
    fs.mkdirSync(path.join(root,'bin'),{recursive:true});
    fs.symlinkSync(binary,path.join(root,'bin','kilo'));
  }
  return {root,binary};
}

test('finds CLI via PATH symlink without executing host Kilo',t=>{
  const {root,binary}=fixture(t,'npm');
  assert.deepEqual(discoverKiloInstallation(path.join(root,'bin')),{binary});
  assert.equal(discoverKiloInstallation('/nonexistent/path'),null);
  assert.equal(discoverKiloInstallation('relative:path'),null);
});
test('verified npm package alone is exposed read-only, not host home',async t=>{
  const {binary}=fixture(t,'npm');
  let called=0;
  const result=await probeOfflineKiloRuntime(async launch=>{
    called++;
    assert.equal(launch.binary,'bwrap');
    assert.ok(launch.args.includes('--unshare-net'));
    assert.ok(launch.args.includes('--clearenv'));
    assert.ok(launch.args.includes('--proc'));
    assert.equal(launch.args.includes('/home'),false);
    const mount=launch.args.indexOf('/opt/kilo');
    assert.ok(mount>0);
    assert.equal(launch.args[mount-2],'--ro-bind');
    assert.equal(path.basename(launch.args[mount-1]),'cli');
    if(launch.args.at(-1)==='--version'){
      assert.deepEqual(launch.args.slice(-3),['--','/opt/kilo/bin/kilo','--version']);
      return 'kilo 1.0.0\n';
    }
    assert.deepEqual(launch.args.slice(-4),['--','/opt/kilo/bin/kilo','run','--help']);
    assert.ok(!launch.args.includes('--auto'));
    return 'Usage: kilo run --agent <name> --model <model>\n';
  },()=>binary);
  if(process.platform==='linux'){
    assert.deepEqual(result,{passed:true,reason:'passed',stage:null,detail:null,exitCode:null});
    assert.equal(called,2);
  }else assert.equal(called,0);
});
test('standalone Kilo copies exactly one executable into private staging',async t=>{
  const {binary}=fixture(t);
  assert.equal(classifyKiloPlacement(binary).kind,'standalone');
  let called=0;
  const result=await probeOfflineKiloRuntime(async launch=>{
    called++;
    const mount=launch.args.indexOf('/opt/kilo');
    assert.ok(mount>0);
    assert.equal(launch.args[mount-2],'--ro-bind');
    const copiedDir=launch.args[mount-1];
    assert.ok(copiedDir.startsWith(launch.cwd+path.sep));
    assert.deepEqual(fs.readdirSync(copiedDir),['kilo']);
    assert.equal(fs.readFileSync(path.join(copiedDir,'kilo'),'utf8'),
      fs.readFileSync(binary,'utf8'));
    if(launch.args.at(-1)==='--version'){
      assert.deepEqual(launch.args.slice(-3),['--','/opt/kilo/kilo','--version']);
      return 'kilo 1.0.0\n';
    }
    assert.deepEqual(launch.args.slice(-4),['--','/opt/kilo/kilo','run','--help']);
    return 'Usage: kilo run --agent <name> --model <model>\n';
  },()=>binary);
  if(process.platform==='linux'){
    assert.deepEqual(result,{passed:true,reason:'passed',stage:null,detail:null,exitCode:null});
    assert.equal(called,2);
  }else assert.equal(called,0);
});
test('fake package metadata in HOME cannot authorize mounting a home ancestor',t=>{
  const {root,binary}=fixture(t);
  fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({name:'@kilocode/cli'}));
  assert.equal(classifyKiloPlacement(binary).kind,'standalone');
});
test('unavailable and failed runtime are sanitized',async t=>{
  const {binary}=fixture(t);
  if(process.platform!=='linux')return;
  assert.equal((await probeOfflineKiloRuntime(async()=>'',()=>null)).reason,'cli-unavailable');
  const result=await probeOfflineKiloRuntime(async()=>{throw new Error('SECRET HOME /home/user');},()=>binary);
  assert.equal(result.reason,'sandbox-failed');
  assert.ok(!JSON.stringify(result).includes('/home/user'));
});

test('Electron PATH missing user npm prefix still finds verified Kilo package',t=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'autodev-home-npm-'));
  t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
  const prefix=path.join(home,'.local','npm');
  const packageDir=path.join(prefix,'lib','node_modules','@kilocode','cli');
  const binary=path.join(packageDir,'bin','kilo');
  fs.mkdirSync(path.dirname(binary),{recursive:true});
  fs.mkdirSync(path.join(prefix,'bin'),{recursive:true});
  fs.writeFileSync(path.join(packageDir,'package.json'),
    JSON.stringify({name:'@kilocode/cli',version:'1.0.0'}));
  fs.writeFileSync(binary,'#!/usr/bin/env node\n',{mode:0o755});
  fs.symlinkSync(binary,path.join(prefix,'bin','kilo'));
  assert.deepEqual(discoverKiloInstallation('/usr/bin:/bin',home),{binary});
  assert.equal(classifyKiloPlacement(binary).kind,'package');
  assert.equal(classifyKiloPlacement(binary).sourceDirectory,packageDir);
});
test('untrusted executable in user npm bin is not accepted through fallback',t=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'autodev-home-untrusted-'));
  t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
  const bin=path.join(home,'.local','npm','bin');
  fs.mkdirSync(bin,{recursive:true});
  fs.writeFileSync(path.join(bin,'kilo'),'#!/bin/sh\nexit 0\n',{mode:0o755});
  assert.equal(discoverKiloInstallation('/usr/bin:/bin',home),null);
});
test('fallback does not inspect arbitrary home directories or execute package manager',t=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'autodev-home-other-'));
  t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
  fs.writeFileSync(path.join(home,'kilo'),'#!/bin/sh\nexit 0\n',{mode:0o755});
  assert.equal(discoverKiloInstallation('',home),null);
});

test('missing model/agent CLI options fails closed, without running a model',async t=>{
  const {binary}=fixture(t,'npm');
  if(process.platform!=='linux')return;
  let n=0;
  const result=await probeOfflineKiloRuntime(async launch=>{
    n++;
    if(launch.args.at(-1)==='--version')return 'kilo 7.8.27\n';
    assert.deepEqual(launch.args.slice(-2),['run','--help']);
    return 'Usage: kilo run --only-help\n';
  },()=>binary);
  assert.equal(n,2);
  assert.deepEqual(result,{passed:false,reason:'invalid-output',stage:'help',detail:null,exitCode:null});
});

test('version succeeds but help fails with classified status and no raw stderr',async t=>{
  const {binary}=fixture(t,'npm');
  if(process.platform!=='linux')return;
  const calls=[];
  const result=await probeOfflineKiloRuntime(async launch=>{
    const kind=launch.args.at(-1)==='--version'?'version':'help';
    calls.push(kind);
    if(kind==='version')return 'kilo 7.8.27\n';
    const error=new Error('SECRET /home/user/.config/kilo');
    error.code=254;
    error.stderr='missing dependency: cannot find module /home/user/private';
    throw error;
  },()=>binary);
  assert.deepEqual(calls,['version','help']);
  assert.deepEqual(result,{passed:false,reason:'sandbox-failed',stage:'help',detail:'runtime-library',exitCode:254});
  assert.ok(!JSON.stringify(result).includes('/home/user'));
});
test('CLI help that exits nonzero is not treated as a valid result',async t=>{
  const {binary}=fixture(t,'npm');
  if(process.platform!=='linux')return;
  let count=0;
  const result=await probeOfflineKiloRuntime(async launch=>{
    count++;
    if(launch.args.at(-1)==='--version')return 'kilo 7.8.27\n';
    const error=new Error('non-zero');
    error.code=1;
    throw error;
  },()=>binary);
  assert.equal(count,2);
  assert.equal(result.stage,'help');
  assert.equal(result.detail,'process-exit');
  assert.equal(result.exitCode,1);
});
