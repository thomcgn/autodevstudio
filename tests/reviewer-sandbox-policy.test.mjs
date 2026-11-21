import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createReadonlyReviewerToolLaunch } from '../src/core/reviewer-sandbox-policy.ts';

function fixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-reviewer-policy-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  return root;
}
test('review tool launch has private root, project-only readonly access and no network',t=>{
  const projectPath=fixture(t);
  if(process.platform!=='linux'){
    assert.throws(()=>createReadonlyReviewerToolLaunch({projectPath,binary:'/usr/bin/git',args:['status']}),/Linux/);
    return;
  }
  const launch=createReadonlyReviewerToolLaunch({projectPath,binary:'/usr/bin/git',args:['--no-pager','status','--porcelain=v1','--untracked-files=all']});
  assert.equal(launch.binary,'bwrap');
  assert.ok(launch.args.includes('--unshare-net'));
  assert.ok(launch.args.includes('--unshare-ipc'));
  assert.ok(launch.args.includes('--clearenv'));
  assert.ok(launch.args.includes('--dev'));
  assert.equal(launch.args[launch.args.indexOf('--dev')+1],'/dev');
  assert.ok(launch.args.includes('GIT_OPTIONAL_LOCKS'));
  for(const name of ['/bin','/lib','/lib64']) {
    if (!fs.existsSync(name)) continue;
    const index=launch.args.indexOf(name);
    if (fs.lstatSync(name).isSymbolicLink()) {
      assert.ok(index > 0);
      assert.equal(launch.args[index-2], '--symlink');
      assert.equal(launch.args[index-1], fs.readlinkSync(name));
    }
  }
  assert.deepEqual(launch.args.slice(-6),['--','/usr/bin/git','--no-pager','status','--porcelain=v1','--untracked-files=all']);
  const tmpfsIndex=launch.args.indexOf('--tmpfs');
  assert.equal(launch.args[tmpfsIndex+1],'/');
  assert.ok(launch.args.includes(projectPath));
  assert.ok(launch.args.includes('/project'));
  assert.equal(launch.args.join(' ').includes('--ro-bind / /'),false);
  assert.equal(launch.args.includes('/home'),false);
  assert.equal(launch.args.includes('/run'),false);
  assert.equal(launch.args.includes('/var'),false);
  assert.equal(launch.args.includes('--bind'),false);
});
test('rejects arbitrary executables, user shells and malformed input',t=>{
  const projectPath=fixture(t);
  if(process.platform!=='linux')return;
  for(const binary of ['/bin/bash','/usr/bin/python3','/usr/bin/env','/usr/bin/gh','/usr/bin/git;echo','/usr/bin/../bin/sh','git']){
    assert.throws(()=>createReadonlyReviewerToolLaunch({projectPath,binary,args:[]}),/tool|binary|executable/);
  }
  assert.throws(()=>createReadonlyReviewerToolLaunch({projectPath,binary:'/usr/bin/sh',args:['-c','touch /project/modified']}),/Unsupported reviewer executable/);
  assert.throws(()=>createReadonlyReviewerToolLaunch({projectPath,binary:'/usr/bin/git',args:['x'.repeat(5000)]}),/Invalid tool arguments/);
});
test('refuses nonexistent project roots',t=>{
  const root=fixture(t);
  if(process.platform!=='linux')return;
  assert.throws(()=>createReadonlyReviewerToolLaunch({projectPath:path.join(root,'missing'),binary:'/usr/bin/git',args:[]}));
});

test('rejects Git command injection and writable or external operations',t=>{
  const projectPath=fixture(t);
  if(process.platform!=='linux')return;
  for(const args of [
    ['status'],['commit','-am','bad'],['push'],['-C','/home','status'],
    ['-c','alias.status=!touch /tmp/evil','status'],
    ['--exec-path=/home/evil','status'],['--no-pager','diff','--ext-diff'],
    ['--no-pager','config','--global','--list'],
    ['--no-pager','show','HEAD:secret'],
    ['--no-pager','status','--porcelain=v1','--untracked-files=all','--'],
  ])assert.throws(()=>createReadonlyReviewerToolLaunch({projectPath,binary:'/usr/bin/git',args}),/Unsupported reviewer Git operation/);
  for(const args of [
    ['--no-pager','status','--porcelain=v1','--untracked-files=all'],
    ['--no-pager','diff','--no-ext-diff','--no-textconv','--'],
    ['--no-pager','diff','--cached','--no-ext-diff','--no-textconv','--'],
    ['--no-pager','log','-5','--format=%h %s'],
  ])assert.equal(createReadonlyReviewerToolLaunch({projectPath,binary:'/usr/bin/git',args}).binary,'bwrap');
});
