import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runReadonlyReviewerTool } from '../src/core/reviewer-tool-runner.ts';

function repo(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'studio-review-runner-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  return dir;
}
test('only invokes wrapped bwrap process without model, networking or host HOME',async t=>{
  if(process.platform!=='linux')return;
  const projectPath=repo(t);
  let called=0;
  const result=await runReadonlyReviewerTool(
    {projectPath,binary:'/usr/bin/git',args:['status','--short']},
    undefined,
    async launch=>{
      called++;
      assert.equal(launch.binary,'bwrap');
      assert.ok(launch.args.includes('--clearenv'));
      assert.ok(launch.args.includes('--unshare-net'));
      assert.ok(launch.args.includes('--ro-bind'));
      assert.ok(!launch.args.includes('/home'));
      assert.ok(!launch.args.includes('/run'));
      assert.ok(!launch.args.includes('kilo'));
      assert.equal(launch.cwd,projectPath);
      return ' M test.txt\n';
    },
  );
  assert.equal(called,1);
  assert.deepEqual(result,{output:' M test.txt\n',isolated:true,readonly:true});
});
test('rejects oversized output and never treats an error as successful review',async t=>{
  if(process.platform!=='linux')return;
  const projectPath=repo(t);
  const spec={projectPath,binary:'/usr/bin/git',args:['status']};
  await assert.rejects(
    runReadonlyReviewerTool(spec,undefined,async()=> 'x'.repeat(140000)),
    /cannot count as PASS/,
  );
  await assert.rejects(
    runReadonlyReviewerTool(spec,undefined,async()=>{throw Error('private HOME secret');}),
    /cannot count as PASS/,
  );
});
test('abort before start does not execute reviewer tools',async t=>{
  if(process.platform!=='linux')return;
  const projectPath=repo(t);
  const controller=new AbortController();
  controller.abort();
  let started=false;
  await assert.rejects(
    runReadonlyReviewerTool({projectPath,binary:'/usr/bin/git',args:['status']},controller.signal,
      async()=>{started=true;return '';}),
    /cancelled before start/,
  );
  assert.equal(started,false);
});
