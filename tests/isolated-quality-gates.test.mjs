import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runIsolatedQualityGates } from '../src/core/isolated-quality-gates.ts';
import { runIsolatedNpmScript, createIsolatedQualityLaunch } from '../src/core/isolated-quality.ts';

function fixture(t,scripts={typecheck:'node --version',test:'node --version'}){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-quality-entry-'));
  t.after(()=>fs.rmSync(root,{force:true,recursive:true}));
  fs.mkdirSync(path.join(root,'.git'));
  fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({name:'quality-test',version:'1.0.0',scripts}));
  return root;
}
test('explicit isolated entrypoint respects script order and stops on failure',async t=>{
  const root=fixture(t);
  if(process.platform!=='linux'){
    const result=await runIsolatedQualityGates({cwd:root,scripts:['typecheck'],timeoutMs:5000});
    assert.equal(result.passed,false);
    return;
  }
  const names=[];
  const result=await runIsolatedQualityGates({cwd:root,scripts:['typecheck','test'],timeoutMs:5000},
    async (cwd,name)=>{names.push(name);const launch=createIsolatedQualityLaunch(cwd,name);
      assert.ok(launch.args.includes('--unshare-net'));
      assert.ok(launch.args.includes('--proc'));
      assert.ok(launch.args.includes('/project/.git'));
      assert.deepEqual(launch.args.slice(-5),['--','/usr/bin/npm','run','--',name]);
    });
  assert.equal(result.passed,true);
  assert.deepEqual(names,['typecheck','test']);
  const blocked=[];
  const failure=await runIsolatedQualityGates({cwd:root,scripts:['typecheck','test'],timeoutMs:5000},
    async(_cwd,name)=>{blocked.push(name);throw Error('broken');});
  assert.equal(failure.passed,false);
  assert.deepEqual(blocked,['typecheck']);
});
test('script names are validated before any isolated invocation',async t=>{
  const root=fixture(t);
  if(process.platform!=='linux')return;
  let ran=false;
  for(const scripts of [[],['test','test'],['bad;touch /tmp/x'],['missing']]){
    await assert.rejects(runIsolatedQualityGates({cwd:root,scripts,timeoutMs:1000},
      async()=>{ran=true;}));
  }
  assert.equal(ran,false);
});
test('pre-abort fails closed before executing npm',async t=>{
  const root=fixture(t);
  const c=new AbortController();c.abort();
  const result=await runIsolatedQualityGates({cwd:root,scripts:['typecheck'],timeoutMs:5000,signal:c.signal},
    async()=>{throw Error('should not run');});
  assert.equal(result.passed,false);
});
test('production script executor refuses host npm fallback without sandbox preparation',async t=>{
  const root=fixture(t);
  const aborted=new AbortController();aborted.abort();
  await assert.rejects(runIsolatedNpmScript(root,'typecheck',5000,aborted.signal),/cancelled/);
  await assert.rejects(runIsolatedNpmScript(root,'invalid;name',5000),/Invalid quality script/);
});
