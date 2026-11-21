import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createIsolatedQualityLaunch } from '../src/core/isolated-quality.ts';

function fixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'autodev-quality-'));
  t.after(()=>fs.rmSync(root,{force:true,recursive:true}));
  fs.mkdirSync(path.join(root,'.git'));
  return root;
}
test('quality sandbox exposes only its selected writable project while protecting .git',t=>{
  const root=fixture(t);
  if(process.platform!=='linux') {
    assert.throws(()=>createIsolatedQualityLaunch(root,'typecheck'),/require Linux/);
    return;
  }
  const launch=createIsolatedQualityLaunch(root,'typecheck');
  assert.equal(launch.binary,'bwrap');
  assert.ok(launch.args.includes('--unshare-net'));
  assert.ok(launch.args.includes('--unshare-pid'));
  assert.equal(launch.args[launch.args.indexOf('--proc')+1],'/proc');
  assert.ok(launch.args.indexOf('--proc')>launch.args.indexOf('--unshare-pid'));
  assert.equal(launch.args.filter(x=>x==='/proc').length,1);
  assert.ok(!launch.args.includes('--ro-bind-try'), 'host /proc must never be bound');
  assert.ok(launch.args.includes('--clearenv'));
  assert.ok(!launch.args.includes('/home'));
  const writable=launch.args.indexOf('--bind');
  assert.ok(writable>=0);
  assert.deepEqual(launch.args.slice(writable,writable+3),['--bind',root,'/project']);
  const readonly=launch.args.indexOf('/project/.git');
  assert.ok(readonly>writable);
  assert.deepEqual(launch.args.slice(readonly-2,readonly+1),['--ro-bind',path.join(root,'.git'),'/project/.git']);
  assert.deepEqual(launch.args.slice(-4),['/usr/bin/npm','run','--','typecheck']);
});
test('invalid scripts, missing repository and .git worktree files fail closed',t=>{
  const root=fixture(t);
  if(process.platform!=='linux')return;
  for(const name of ['','../evil','test;rm','test ok','-evil','test/evil'])
    assert.throws(()=>createIsolatedQualityLaunch(root,name),/Invalid quality script/);
  fs.rmSync(path.join(root,'.git'),{recursive:true});
  fs.writeFileSync(path.join(root,'.git'),'gitdir: elsewhere');
  assert.throws(()=>createIsolatedQualityLaunch(root,'typecheck'),/regular Git directory/);
});
