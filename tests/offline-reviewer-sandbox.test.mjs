import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createOfflineReviewerSandboxLaunch } from '../src/core/offline-reviewer-sandbox.ts';

function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'autodev-reviewer-policy-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const pkg=path.join(root,'lib','node_modules','@kilocode','cli');
  const binary=path.join(pkg,'bin','kilo');
  fs.mkdirSync(path.dirname(binary),{recursive:true});
  fs.writeFileSync(path.join(pkg,'package.json'),JSON.stringify({name:'@kilocode/cli'}));
  fs.writeFileSync(binary,'#!/usr/bin/env node\n',{mode:0o755});
  return {root,pkg,binary};
}
test('offline reviewer is model-configured but cannot see host project or invoke model',t=>{
  const {root,pkg,binary}=fixture(t);
  if(process.platform!=='linux'){
    assert.throws(()=>createOfflineReviewerSandboxLaunch(root,binary,'provider/model'),/require Linux/);
    return;
  }
  const spec=createOfflineReviewerSandboxLaunch(root,binary,'provider/model');
  assert.equal(spec.binary,'bwrap');
  const a=spec.args;
  assert.ok(a.includes('--unshare-net'));
  assert.ok(a.includes('--unshare-pid'));
  assert.ok(a.includes('--clearenv'));
  assert.equal(a.filter(x=>x==='--bind').length,0);
  assert.equal(a.includes('--ro-bind-try'),false);
  assert.ok(!a.includes(root));
  assert.equal(a.includes('/home'),false);
  assert.equal(a.includes('/project'),false);
  assert.equal(a.includes('--auto'),false);
  assert.deepEqual(a.slice(-4),['--','/opt/kilo/bin/kilo','run','--help']);
  const mount=a.indexOf('/opt/kilo');
  assert.deepEqual(a.slice(mount-2,mount+1),['--ro-bind',pkg,'/opt/kilo']);
  const config=JSON.parse(a[a.indexOf('KILO_CONFIG_CONTENT')+1]);
  assert.equal(config.permission['*'],'deny');
  assert.equal(config.agent['autodev-reviewer'].permission['*'],'deny');
  assert.equal(config.agent['autodev-reviewer'].model,'provider/model');
  assert.equal(config.formatter,false);
  assert.equal(config.lsp,false);
});
test('no reviewer launch from missing or misleading model',t=>{
  const {root,binary}=fixture(t);
  if(process.platform!=='linux')return;
  for(const model of ['','../../foo','invalidmodel','p/../secret']){
    assert.throws(()=>createOfflineReviewerSandboxLaunch(root,binary,model),/Invalid reviewer model/);
  }
});
test('unverified standalone executable is forbidden, even if executable',t=>{
  const {root}=fixture(t);
  if(process.platform!=='linux')return;
  const binary=path.join(root,'kilo');
  fs.writeFileSync(binary,'#!/bin/sh\nexit 0\n',{mode:0o755});
  assert.throws(()=>createOfflineReviewerSandboxLaunch(root,binary,'provider/model'),/Unverified standalone/);
});
