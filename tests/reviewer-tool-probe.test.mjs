import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { probeReadonlyReviewerTool } from '../src/core/reviewer-tool-probe.ts';

function fixture(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'studio-review-tool-probe-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  return dir;
}

test('isolated Git smoke test is strictly read-only and does not leak file names',async t=>{
  const root=fixture(t);
  let runs=0;
  const result=await probeReadonlyReviewerTool(root,async launch=>{
    runs++;
    assert.equal(launch.binary,'bwrap');
    assert.equal(launch.cwd,root);
    assert.ok(launch.args.includes('--unshare-net'));
    assert.ok(launch.args.includes('--clearenv'));
    assert.ok(launch.args.includes('--ro-bind'));
    assert.ok(launch.args.includes('/project'));
    assert.ok(!launch.args.includes('/home'));
    assert.ok(launch.args.includes('--porcelain=v1'));
    return '?? personal-document.txt\n';
  });
  if(process.platform==='linux'){
    assert.equal(runs,1);
    assert.deepEqual(result,{supported:true,passed:true,reason:'passed'});
    assert.ok(!JSON.stringify(result).includes('personal-document.txt'));
  } else {
    assert.equal(runs,0);
    assert.equal(result.reason,'unsupported-platform');
  }
});

test('failed isolated tool probe does not expose sensitive process output',async t=>{
  const root=fixture(t);
  const result=await probeReadonlyReviewerTool(root,async()=>{throw new Error('token private home');});
  if(process.platform==='linux'){
    assert.deepEqual(result,{supported:true,passed:false,reason:'tool-failed'});
    assert.ok(!JSON.stringify(result).includes('private'));
  }
});
