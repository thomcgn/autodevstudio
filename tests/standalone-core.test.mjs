import test from 'node:test';
import assert from 'node:assert/strict';
import { initializeWorkflow, transition } from '../src/core/workflow.ts';
import { listIssues, parseIssues } from '../src/core/issues.ts';

test('PASS requires review and quality before publication', () => {
  let flow = initializeWorkflow(42);
  assert.throws(() => transition(flow, { type: 'published' }), /Invalid transition/);
  flow = transition(flow, { type: 'plan-approved' });
  flow = transition(flow, { type: 'build-complete' });
  assert.throws(() => transition(flow, { type: 'review-pass', blockers: 1 }), /blockers/);
  flow = transition(flow, { type: 'review-pass', blockers: 0 });
  assert.throws(() => transition(flow, { type: 'published' }), /Invalid transition/);
  flow = transition(flow, { type: 'quality-pass' });
  flow = transition(flow, { type: 'published' });
  assert.equal(flow.stage, 'done');
});

test('review FAIL returns to builder, with bounded retries', () => {
  let flow = initializeWorkflow(7, 2);
  flow = transition(flow, { type: 'plan-approved' });
  for (let i = 0; i < 3; i++) {
    flow = transition(flow, { type: 'build-complete' });
    flow = transition(flow, { type: 'review-fail', feedback: 'Fix test' });
  }
  assert.equal(flow.stage, 'blocked');
  assert.equal(flow.fixAttempts, 3);
  assert.throws(() => transition(flow, { type: 'plan-approved' }), /blocked/);
});

test('failed quality gate invalidates reviewer approval', () => {
  let flow = initializeWorkflow(12);
  flow = transition(flow, { type: 'plan-approved' });
  flow = transition(flow, { type: 'build-complete' });
  flow = transition(flow, { type: 'review-pass', blockers: 0 });
  flow = transition(flow, { type: 'quality-fail', feedback: 'Typecheck failed' });
  assert.equal(flow.stage, 'build');
  assert.equal(flow.reviewed, false);
  assert.equal(flow.qualityPassed, false);
});

test('issue reader uses read-only gh issue list with project cwd', async () => {
  let invocation;
  const runner = async (binary, args, cwd) => {
    invocation = { binary, args, cwd };
    return JSON.stringify([{ number: 4, title: 'Fix', body: 'Description', url: 'https://github.com/org/repo/issues/4', labels: [{name:'approved'}] }]);
  };
  const issues = await listIssues('/repo/test', runner);
  assert.equal(invocation.binary, 'gh');
  assert.equal(invocation.cwd, '/repo/test');
  assert.deepEqual(invocation.args.slice(0, 3), ['issue','list','--state']);
  assert.equal(issues[0].labels[0], 'approved');
});

test('malformed GitHub issue data fails closed', () => {
  assert.throws(() => parseIssues('{}'), /Unexpected/);
  assert.throws(() => parseIssues('[{"number":3,"title":"x","url":"file:\/\/etc\/passwd"}]'), /Invalid GitHub/);
});

test('rejects confusing GitHub lookalike and unsafe issue URLs', () => {
  for (const url of [
    'https://github.com.evil.example/owner/repo/issues/1',
    'http://github.com/owner/repo/issues/1',
    'https://github.com/owner/repo/pulls/1',
    'file:///etc/passwd',
  ]) {
    assert.throws(() => parseIssues(JSON.stringify([
      { number: 1, title: 'Fake', url, labels: [] },
    ])), /Invalid GitHub issue/);
  }
});
