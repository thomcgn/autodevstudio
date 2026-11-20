import test from 'node:test';
import assert from 'node:assert/strict';
import { assertRunApproved } from '../src/main/run-policy.ts';

test('status and dry-run do not require production consent', () => {
  assert.doesNotThrow(() => assertRunApproved('status', 'laceframe', undefined));
  assert.doesNotThrow(() => assertRunApproved('dry-run', 'laceframe', undefined));
});

test('production mode requires exact project-specific acknowledgment', () => {
  assert.throws(() => assertRunApproved('execute', 'laceframe', undefined), /approval required/);
  assert.throws(() => assertRunApproved('execute', 'laceframe', 'EXECUTE other'), /approval required/);
  assert.throws(() => assertRunApproved('execute', 'laceframe', 'execute laceframe'), /approval required/);
  assert.doesNotThrow(() => assertRunApproved('execute', 'laceframe', 'EXECUTE laceframe'));
});

test('unknown IPC modes fail closed', () => {
  for (const mode of ['reviewer', 'retry', 'push', null, 1, {}]) {
    assert.throws(() => assertRunApproved(mode, 'laceframe', 'EXECUTE laceframe'), /Unsupported run mode/);
  }
});
