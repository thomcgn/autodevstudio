import test from 'node:test';
import assert from 'node:assert/strict';
import { orchestrateIssue, createSimulationAdapters } from '../src/core/orchestrator.ts';

const issue = { number: 24, title: 'Example', body: 'Only a simulation' };
const planner = async () => ({ summary: 'Plan', steps: ['Implement'] });
const builder = async () => ({ summary: 'Build complete' });
const quality = async () => ({ passed: true, summary: 'All checks passed' });
const reviewerPass = async () => ({ verdict: 'PASS', blockers: 0, summary: 'Reviewed' });

test('simulator completes review FAIL -> builder FIX -> reviewer PASS -> quality -> publish', async () => {
  const result = await orchestrateIssue(issue, createSimulationAdapters({ failFirstReview: true }));
  assert.equal(result.state.stage, 'done');
  assert.equal(result.state.fixAttempts, 1);
  assert.deepEqual(result.events.map(e => e.stage),
    ['plan', 'build', 'review', 'build', 'review', 'quality', 'publish', 'done']);
});

test('quality gate failure returns to builder and requires another independent review', async () => {
  const result = await orchestrateIssue(issue, createSimulationAdapters({ failFirstQuality: true }));
  assert.equal(result.state.stage, 'done');
  assert.equal(result.state.fixAttempts, 1);
  assert.deepEqual(result.events.map(e => e.stage),
    ['plan', 'build', 'review', 'quality', 'build', 'review', 'quality', 'publish', 'done']);
});

test('publisher is never called on persistent review FAIL', async () => {
  let published = 0;
  let attempts = 0;
  const result = await orchestrateIssue(issue, {
    planner,
    builder: async () => { attempts++; return builder(); },
    reviewer: async () => ({ verdict: 'FAIL', blockers: 2, feedback: 'Still broken' }),
    quality,
    publish: async () => { published++; },
  }, { maxFixAttempts: 2 });
  assert.equal(result.state.stage, 'blocked');
  assert.equal(attempts, 3);
  assert.equal(published, 0);
});

test('review PASS with blockers never reaches quality or publisher', async () => {
  let qualityInvoked = false;
  let published = false;
  await assert.rejects(orchestrateIssue(issue, {
    planner, builder,
    reviewer: async () => ({ verdict: 'PASS', blockers: 1, summary: 'Invalid result' }),
    quality: async () => { qualityInvoked = true; return quality(); },
    publish: async () => { published = true; },
  }), /zero blockers/);
  assert.equal(qualityInvoked, false);
  assert.equal(published, false);
});

test('abort before publication preserves state without external side effects', async () => {
  const controller = new AbortController();
  let published = false;
  await assert.rejects(orchestrateIssue(issue, {
    planner, builder, reviewer: reviewerPass,
    quality: async () => { controller.abort(); return quality(); },
    publish: async () => { published = true; },
  }, { signal: controller.signal }), /aborted/);
  assert.equal(published, false);
});

test('planner must return complete plan before calling builder', async () => {
  let builderInvoked = false;
  await assert.rejects(orchestrateIssue(issue, {
    planner: async () => ({ summary: ' ', steps: [] }),
    builder: async () => { builderInvoked = true; return builder(); },
    reviewer: reviewerPass, quality, publish: async () => {},
  }), /incomplete plan/);
  assert.equal(builderInvoked, false);
});

test('progress events are emitted in the same order as result trace', async () => {
  const emitted = [];
  const result = await orchestrateIssue(issue, createSimulationAdapters(), {
    onEvent: entry => emitted.push(entry),
  });
  assert.deepEqual(emitted, result.events);
  assert.equal(result.state.stage, 'done');
});
