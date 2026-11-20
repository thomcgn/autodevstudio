import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { RunHistory } from '../src/main/run-history.ts';

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autodev-history-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return new RunHistory(dir);
}
function start(history, projectId = 'project-a') {
  const runId = randomUUID();
  history.start({ runId, projectId, projectName: 'laceframe', mode: 'dry-run', startedAt: Date.now() });
  return runId;
}

test('persists run metadata and log across history instances', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autodev-history-persist-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const history = new RunHistory(dir);
  const id = start(history);
  history.append(id, 'stdout', 'controller started\n');
  history.finish(id, 0, null);
  const reopened = new RunHistory(dir);
  assert.equal(reopened.list('project-a')[0].outcome, 'success');
  assert.match(reopened.getLog('project-a', id), /controller started/);
});

test('does not expose another project log or arbitrary file paths', t => {
  const history = fixture(t);
  const id = start(history);
  assert.deepEqual(history.list('project-b'), []);
  assert.throws(() => history.getLog('project-b', id), /not found/);
  assert.throws(() => history.getLog('project-a', '../../secret'), /Invalid run ID/);
});

test('recovers interrupted runs without claiming success', t => {
  const history = fixture(t);
  const id = start(history);
  history.recoverInterrupted();
  assert.equal(history.list('project-a')[0].outcome, 'interrupted');
  assert.ok(history.list('project-a')[0].endedAt);
  assert.match(history.getLog('project-a', id), /^$/);
});

test('records nonzero exit and termination signals separately', t => {
  const history = fixture(t);
  const failed = start(history);
  const stopped = start(history);
  history.finish(failed, 1, null);
  history.finish(stopped, null, 'SIGTERM');
  const records = history.list('project-a');
  assert.equal(records.find(r => r.runId === failed).outcome, 'failed');
  assert.equal(records.find(r => r.runId === stopped).outcome, 'interrupted');
});

test('truncates oversized run logs instead of growing indefinitely', t => {
  const history = fixture(t);
  const id = start(history);
  history.append(id, 'stdout', 'x'.repeat(5 * 1024 * 1024 + 100));
  const item = history.list('project-a')[0];
  assert.equal(item.truncated, true);
  assert.ok(history.getLog('project-a', id).length <= 512 * 1024 + 10);
});
