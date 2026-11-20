import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runTrustedQualityGates, runNpmScript } from '../src/core/quality-gates.ts';

function fixture(t, scripts = { typecheck: 'node -e "process.exit(0)"', test: 'node -e "process.exit(0)"' }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-gates-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'gates-fixture', version: '1.0.0', scripts }));
  return root;
}
test('runs only explicitly trusted script names in order', async t => {
  const root = fixture(t);
  const called = [];
  const result = await runTrustedQualityGates({
    cwd: root, scripts: ['typecheck','test'], timeoutMs: 1000,
  }, async (cwd, name) => { called.push([cwd,name]); });
  assert.equal(result.passed, true);
  assert.deepEqual(called, [[root,'typecheck'],[root,'test']]);
});
test('refuses missing, duplicated, injected or empty scripts before running', async t => {
  const root = fixture(t);
  let runs = 0;
  const runner = async () => { runs++; };
  for (const scripts of [[], ['missing'], ['test','test'], ['test;rm -rf /'], ['--help']]) {
    await assert.rejects(runTrustedQualityGates({cwd:root,scripts,timeoutMs:1000},runner));
  }
  assert.equal(runs,0);
});
test('gate failure stops all subsequent commands and never returns PASS', async t => {
  const root = fixture(t);
  const called = [];
  const result = await runTrustedQualityGates({cwd:root,scripts:['typecheck','test'],timeoutMs:1000},
    async (_cwd,name) => { called.push(name); throw new Error('failed'); });
  assert.deepEqual(called,['typecheck']);
  assert.equal(result.passed,false);
  assert.match(result.feedback,/typecheck failed/);
});
test('pre-aborted gate never executes a script', async t => {
  const root = fixture(t);
  const controller = new AbortController();
  controller.abort();
  let called = 0;
  const result = await runTrustedQualityGates({cwd:root,scripts:['test'],timeoutMs:1000,
    signal:controller.signal},async()=>{called++;});
  assert.equal(result.passed,false);
  assert.equal(called,0);
});
test('actual npm gate succeeds or fails based on script exit code', async t => {
  const root = fixture(t, { good: 'node -e "process.exit(0)"', bad: 'node -e "process.exit(3)"' });
  const ok = await runTrustedQualityGates({cwd:root,scripts:['good'],timeoutMs:10000});
  const bad = await runTrustedQualityGates({cwd:root,scripts:['bad'],timeoutMs:10000});
  assert.equal(ok.passed,true);
  assert.equal(bad.passed,false);
});
test('actual npm script cancellation fails closed', async t => {
  const root = fixture(t);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(runNpmScript(root,'test',1000,controller.signal),/Cancelled/);
});
