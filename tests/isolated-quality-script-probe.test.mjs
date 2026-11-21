import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { probeIsolatedQualityScript } from '../src/core/isolated-quality-script-probe.ts';
import { createIsolatedQualityLaunch } from '../src/core/isolated-quality.ts';

test('probe only invokes trusted script on throwaway project with Git read-only overlay',async()=>{
  let called=0;
  const result=await probeIsolatedQualityScript(async(cwd,name)=>{
    called++;
    assert.equal(name,'studio-probe');
    assert.ok(path.basename(cwd).startsWith('autodev-script-probe-'));
    assert.ok(fs.existsSync(path.join(cwd,'package.json')));
    assert.ok(fs.existsSync(path.join(cwd,'.git')));
    const scripts=JSON.parse(fs.readFileSync(path.join(cwd,'package.json'),'utf8')).scripts;
    assert.deepEqual(Object.keys(scripts),['studio-probe']);
    assert.match(scripts['studio-probe'],/write-forbidden.txt/);
    assert.ok(!scripts['studio-probe'].includes('npm install'));
    const launch=createIsolatedQualityLaunch(cwd,name);
    assert.ok(launch.args.includes('--unshare-net'));
    assert.ok(launch.args.includes('--proc'));
    const ro=launch.args.indexOf('/project/.git');
    assert.deepEqual(launch.args.slice(ro-2,ro+1),['--ro-bind',path.join(cwd,'.git'),'/project/.git']);
    fs.writeFileSync(path.join(cwd,'probe-canary.txt'),'written');
  });
  if(process.platform!=='linux') {
    assert.equal(called,0);
    assert.equal(result.reason,'unsupported-platform');
  }else{
    assert.equal(called,1);
    assert.deepEqual(result,{passed:true,reason:'passed'});
  }
});
test('missing worktree write fails closed',async()=>{
  if(process.platform!=='linux')return;
  const result=await probeIsolatedQualityScript(async()=>{});
  assert.equal(result.reason,'missing-expected-write');
});
test('repository metadata modified fails closed',async()=>{
  if(process.platform!=='linux')return;
  const result=await probeIsolatedQualityScript(async cwd=>{
    fs.writeFileSync(path.join(cwd,'probe-canary.txt'),'written');
    fs.writeFileSync(path.join(cwd,'.git','write-forbidden.txt'),'bad');
  });
  assert.equal(result.reason,'git-metadata-modified');
});
test('script error fails closed and exposes no process stderr',async()=>{
  if(process.platform!=='linux')return;
  const result=await probeIsolatedQualityScript(async()=>{throw Error('sensitive user path');});
  assert.deepEqual(result,{passed:false,reason:'script-failed'});
  assert.ok(!JSON.stringify(result).includes('sensitive'));
});
