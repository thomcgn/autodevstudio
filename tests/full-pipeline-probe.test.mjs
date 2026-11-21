import test from 'node:test';
import assert from 'node:assert/strict';
import { probeFullStandalonePipeline } from '../src/core/full-pipeline-probe.ts';

const identity={head:'a'.repeat(40),branch:'autodev/issue-1',worktreeHash:'b'.repeat(64)};
const evidence={identity,status:'',unstagedDiff:'',stagedDiff:'',recentCommits:'fixture',fingerprint:'c'.repeat(64)};
const collect=async()=>evidence;

test('full dry-run performs mocked review & quality then in-memory publish only',async()=>{
  let qualityCalls=0;
  const result=await probeFullStandalonePipeline({
    quality:async config=>{
      qualityCalls++;
      assert.equal(config.scripts.length,1);
      assert.equal(config.scripts[0],'studio-smoke');
      assert.ok(config.cwd.includes('autodev-pipeline-smoke-'));
      return {passed:true,summary:'fixture test OK'};
    },collect,
  });
  if(process.platform==='linux'){
    assert.deepEqual(result,{passed:true,reason:'passed'});
    assert.equal(qualityCalls,1);
  }else{
    assert.equal(result.reason,'unsupported-platform');
    assert.equal(qualityCalls,0);
  }
});
test('quality failure fails closed and never fabricates success',async()=>{
  if(process.platform!=='linux')return;
  const result=await probeFullStandalonePipeline({
    quality:async()=>({passed:false,feedback:'No execution'}),
    collect,
  });
  assert.deepEqual(result,{passed:false,reason:'pipeline-failed'});
});
test('review evidence mismatch blocks quality scripts',async()=>{
  if(process.platform!=='linux')return;
  let invoked=false;
  const result=await probeFullStandalonePipeline({
    quality:async()=>{invoked=true;return {passed:true,summary:'OK'};},
    collect:async()=>({...evidence,identity:{...identity,branch:'main'}}),
  });
  assert.equal(result.passed,false);
  assert.equal(invoked,false);
});
test('no raw sandbox errors or secrets appear in output',async()=>{
  if(process.platform!=='linux')return;
  const result=await probeFullStandalonePipeline({
    quality:async()=>{throw Error('secret from /home/user/private');},
    collect,
  });
  assert.deepEqual(result,{passed:false,reason:'pipeline-failed'});
  assert.ok(!JSON.stringify(result).includes('/home'));
});
