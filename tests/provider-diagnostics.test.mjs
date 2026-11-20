import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectLocalProviders } from '../src/core/provider-diagnostics.ts';

test('diagnoses installed Kilo, flags and logged-in gh without invoking a model', async () => {
  const calls=[];
  const runner=async (bin,args,cwd)=>{
    calls.push({bin,args,cwd});
    if(bin==='kilo' && args[0]==='--version') return 'kilo 1.2.3\n';
    if(bin==='kilo' && args[0]==='run') return 'Usage: kilo run --auto --agent --model --session';
    if(bin==='kilo' && args[0]==='agent' && args[1]==='list') return 'plan code review';
    if(bin==='bwrap' && args[0]==='--version') return 'bubblewrap 0.11';
    if(bin==='gh' && args[0]==='--version') return 'gh 2.1';
    if(bin==='gh' && args[0]==='auth') return 'Logged in: hidden-token';
    throw new Error('Unexpected command');
  };
  const status=await inspectLocalProviders('/example/repo',runner);
  assert.equal(status.kiloInstalled,true);
  assert.equal(status.kiloVersion,'kilo 1.2.3');
  assert.equal(status.kiloRunCommandReady,true);
  assert.equal(status.agentCatalogReadable,true);
  if (process.platform==='linux') {
    assert.equal(status.sandboxTool,'bwrap');
    assert.equal(status.sandboxToolAvailable,true);
  }
  assert.equal(status.ghInstalled,true);
  assert.equal(status.ghAuthenticated,true);
  assert.ok(calls.every(x=>x.cwd==='/example/repo'));
  assert.ok(calls.every(x=>!x.args.includes('--execute')));
  assert.ok(calls.every(x=>!(x.bin==='kilo'&&x.args[0]==='run'&&x.args[1]!=='--help')));
  assert.ok(!JSON.stringify(status).includes('hidden-token'));
});

test('reports missing tools without rejecting or exposing raw error output', async () => {
  const status=await inspectLocalProviders('/fake',async ()=>{
    throw new Error('GH_TOKEN secret: abcde');
  });
  assert.equal(status.kiloInstalled,false);
  assert.equal(status.ghAuthenticated,false);
  assert.equal(status.kiloRunCommandReady,false);
  assert.ok(!JSON.stringify(status).includes('abcde'));
});

test('rejects incomplete Kilo command support', async () => {
  const runner=async (bin,args)=>{
    if (bin==='kilo'&&args[0]==='--version') return 'kilo';
    if (bin==='kilo'&&args[0]==='run') return '--auto --model --agent';
    throw new Error('not available');
  };
  const status=await inspectLocalProviders('/fake',runner);
  assert.equal(status.kiloInstalled,true);
  assert.equal(status.kiloRunCommandReady,false);
  assert.equal(status.supportedFlags.includes('--session'),false);
});

test('agent inventory and sandbox tool failures do not incorrectly report readiness',async()=>{
  const runner=async(bin,args)=>{
    if(bin==='kilo'&&args[0]==='--version')return 'kilo 7';
    if(bin==='kilo'&&args[0]==='run')return '--auto --model --agent --session';
    throw new Error('unauthorized output: credential SECRET');
  };
  const status=await inspectLocalProviders('/fake',runner);
  assert.equal(status.kiloRunCommandReady,true);
  assert.equal(status.agentCatalogReadable,false);
  assert.equal(status.sandboxToolAvailable,false);
  assert.ok(!JSON.stringify(status).includes('SECRET'));
});
