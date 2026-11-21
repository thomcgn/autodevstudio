import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createIsolatedQualityLaunch } from '../src/core/isolated-quality.ts';
import { probeIsolatedQualityRuntime, createQualityProbeCommand } from '../src/core/isolated-quality-probe.ts';

const localReady=process.platform==='linux'&&fs.existsSync('/usr/bin/node')&&fs.existsSync('/usr/bin/npm');
test('tests isolated Node then npm, never executing project scripts',async()=>{
  const calls=[];
  const result=await probeIsolatedQualityRuntime(async launch=>{
    calls.push(launch.args.slice(-3));
    assert.equal(launch.binary,'bwrap');
    assert.ok(launch.args.includes('--unshare-net'));
    assert.ok(launch.args.includes('--unshare-pid'));
    assert.equal(launch.args[launch.args.indexOf('--proc')+1],'/proc');
    assert.ok(!launch.args.includes('/proc/self/exe'), 'do not bind host executable');
    assert.ok(launch.args.includes('--clearenv'));
    assert.ok(launch.args.includes('/project/.git'));
    assert.ok(!launch.args.includes('/home'));
    assert.ok(path.basename(launch.cwd).startsWith('autodev-quality-probe-'));
    assert.ok(fs.existsSync(path.join(launch.cwd,'.git')));
    assert.equal(launch.args.includes('run'),false);
    return launch.args.includes('/usr/bin/node') ? 'v22.14.0\n' : '10.9.4\n';
  });
  if(!localReady){
    assert.equal(calls.length,0);
    assert.equal(result.reason,process.platform==='linux'?'npm-unavailable':'unsupported-platform');
  }else{
    assert.deepEqual(calls,[['--','/usr/bin/node','--version'],['--','/usr/bin/npm','--version']]);
    assert.deepEqual(result,{supported:true,passed:true,reason:'passed',stage:null,detail:null,exitCode:null});
  }
});
test('node failure is distinguished from npm failure and raw error is redacted',async()=>{
  if(!localReady)return;
  const error=new Error('credential HOME=/private/secret');
  error.code=1;error.stderr='bwrap: Can\'t create file /project/.git: Read-only file system';
  const failed=await probeIsolatedQualityRuntime(async()=>{throw error;});
  assert.equal(failed.stage,'node');
  assert.equal(failed.detail,'mount-or-namespace');
  assert.equal(failed.exitCode,1);
  assert.ok(!JSON.stringify(failed).includes('secret'));
  const npmFailed=await probeIsolatedQualityRuntime(async launch=>{
    if(launch.args.includes('/usr/bin/npm')){
      const failure=new Error('confidential');failure.code=127;throw failure;
    }
    return 'v22.0.0\n';
  });
  assert.equal(npmFailed.stage,'npm');
  assert.equal(npmFailed.detail,'command-exit');
  assert.equal(npmFailed.exitCode,127);
});
test('invalid output is flagged at its actual stage',async()=>{
  if(!localReady)return;
  const output=await probeIsolatedQualityRuntime(async launch=>
    launch.args.includes('/usr/bin/npm')?'HOME=/private/user':'v22.0.0\n');
  assert.equal(output.stage,'npm');
  assert.equal(output.reason,'invalid-output');
  assert.ok(!JSON.stringify(output).includes('/private'));
});

test('regression: Bubblewrap delimiter precedes npm run delimiter, never runs npm scripts',t=>{
  if(process.platform!=='linux')return;
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'autodev-probe-layout-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.mkdirSync(path.join(root,'.git'));
  const launch=createIsolatedQualityLaunch(root,'typecheck');
  assert.equal(launch.args.filter(x=>x==='--').length,2);
  const first=launch.args.indexOf('--');
  const last=launch.args.lastIndexOf('--');
  assert.ok(first<last);
  assert.deepEqual(launch.args.slice(first),['--','/usr/bin/npm','run','--','typecheck']);
  for (const binary of ['/usr/bin/node','/usr/bin/npm']) {
    const probe=createQualityProbeCommand(launch,binary);
    assert.deepEqual(probe.args.slice(first),['--',binary,'--version']);
    assert.equal(probe.args.length,first+3);
    assert.equal(probe.args.includes('run'),false);
    assert.equal(probe.args.includes('typecheck'),false);
  }
});
test('rejects unexpected command layouts rather than launching an unsafe test',()=>{
  assert.throws(()=>createQualityProbeCommand({binary:'bwrap',cwd:'/tmp',args:['--','/usr/bin/npm','install','--','danger']},'/usr/bin/node'),/Unexpected/);
  assert.throws(()=>createQualityProbeCommand({binary:'bwrap',cwd:'/tmp',args:['--','/usr/bin/bash','-c','danger']},'/usr/bin/node'),/Unexpected/);
});
