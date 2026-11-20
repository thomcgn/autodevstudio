import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { runKilo, createKiloArgs, KiloProcessError } from '../src/core/kilo-process.ts';

function fake(script, inspection) {
  return (_bin, args, opts) => {
    inspection?.(args, opts);
    return spawn(process.execPath, ['-e', script], opts);
  };
}
const base = {
  cwd: process.cwd(), role: 'builder', agent: 'code', model: 'provider/model:free',
  prompt: 'Implement issue #5', inactivityTimeoutMs: 1500, heartbeatIntervalMs: 30,
};

test('constructs direct Kilo argv with no interpolated shell command', () => {
  const args = createKiloArgs({ agent: 'code', model: 'provider/model:free',
    prompt: 'one ; echo malicious', resumeSessionId: 'ses_123456789' });
  assert.deepEqual(args, ['run', '--auto', '--model', 'provider/model:free',
    '--agent', 'code', '--session', 'ses_123456789', 'one ; echo malicious']);
  assert.throws(() => createKiloArgs({ agent: '--help', model: 'valid', prompt: 'x' }), /Invalid/);
  assert.throws(() => createKiloArgs({ agent: 'code', model: '--bad', prompt: 'x' }), /Invalid/);
});

test('streams stdout/stderr and persists split session id early', async () => {
  const output = [];
  const session = [];
  let command;
  const result = await runKilo({
    ...base,
    spawnProcess: fake("process.stdout.write('Session: ses_'); setTimeout(()=>{process.stdout.write('abc123xyz\\n'); process.stderr.write('warning\\n');},15)", (args,opts)=>{command={args,opts};}),
    onOutput: (stream,text)=>output.push([stream,text]),
    onSessionId: id=>session.push(id),
  });
  assert.equal(command.opts.shell, false);
  assert.equal(command.opts.cwd, base.cwd);
  assert.equal(command.args.at(-1), base.prompt);
  assert.equal(result.sessionId, 'ses_abc123xyz');
  assert.deepEqual(session, ['ses_abc123xyz']);
  assert.match(result.output, /warning/);
  assert.ok(output.some(([stream])=>stream === 'stderr'));
});

test('nonzero exit fails with session information', async () => {
  await assert.rejects(runKilo({
    ...base,
    spawnProcess: fake("console.log('session: ses_987654321'); process.exit(7)"),
  }), error => error instanceof KiloProcessError && error.reason === 'exit' && error.sessionId === 'ses_987654321');
});

test('inactivity timeout terminates silent process', async () => {
  await assert.rejects(runKilo({
    ...base, inactivityTimeoutMs: 150, heartbeatIntervalMs: 20,
    spawnProcess: fake("setInterval(()=>{}, 1000)"),
  }), error => error instanceof KiloProcessError && error.reason === 'inactivity');
});

test('external abort terminates child without treating it as PASS', async () => {
  const ctrl = new AbortController();
  const task = runKilo({
    ...base, signal: ctrl.signal,
    spawnProcess: fake("console.log('started'); setInterval(()=>{}, 1000)"),
  });
  setTimeout(() => ctrl.abort(), 85);
  await assert.rejects(task, error => error instanceof KiloProcessError && error.reason === 'abort');
});

test('already-aborted signal does not start provider process', async () => {
  const ctrl = new AbortController();
  ctrl.abort();
  let called = false;
  await assert.rejects(runKilo({
    ...base, signal: ctrl.signal,
    spawnProcess: ()=>{called=true;throw new Error('should not spawn');},
  }), error=>error instanceof KiloProcessError && error.reason==='abort');
  assert.equal(called, false);
});

test('auto-rejected permission is not considered successful exit', async () => {
  await assert.rejects(runKilo({
    ...base, spawnProcess: fake("console.log('run ended with an auto-rejected permission')"),
  }), error=>error instanceof KiloProcessError && error.reason==='permission');
});

test('log output kept in memory is bounded', async () => {
  const result = await runKilo({
    ...base,
    spawnProcess: fake("process.stdout.write('x'.repeat(310000))"),
  });
  assert.ok(result.output.length <= 256 * 1024);
});
