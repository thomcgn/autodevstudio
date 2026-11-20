import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { captureGitIdentity } from '../src/core/git-identity.ts';

function git(dir, ...args) {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
}
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-identity-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 'test@example.invalid');
  git(dir, 'config', 'user.name', 'Studio Test');
  git(dir, 'checkout', '-qb', 'feat/issue-5');
  fs.writeFileSync(path.join(dir, 'tracked.txt'), 'original\n');
  git(dir, 'add', 'tracked.txt');
  git(dir, 'commit', '-qm', 'initial');
  return dir;
}

test('clean repository has stable HEAD, branch and SHA-256 fingerprint', async t => {
  const dir = fixture(t);
  const first = await captureGitIdentity(dir);
  const second = await captureGitIdentity(dir);
  assert.deepEqual(first, second);
  assert.equal(first.head, git(dir, 'rev-parse', 'HEAD'));
  assert.equal(first.branch, 'feat/issue-5');
  assert.match(first.worktreeHash, /^[a-f0-9]{64}$/);
});

test('detects staged and unstaged changes, including binary content', async t => {
  const dir = fixture(t);
  const clean = await captureGitIdentity(dir);
  fs.writeFileSync(path.join(dir, 'tracked.txt'), Buffer.from([0, 1, 2, 3]));
  const unstaged = await captureGitIdentity(dir);
  assert.notEqual(unstaged.worktreeHash, clean.worktreeHash);
  git(dir, 'add', 'tracked.txt');
  const staged = await captureGitIdentity(dir);
  assert.notEqual(staged.worktreeHash, unstaged.worktreeHash);
  fs.writeFileSync(path.join(dir, 'tracked.txt'), 'another edit');
  assert.notEqual((await captureGitIdentity(dir)).worktreeHash, staged.worktreeHash);
});

test('hashes untracked file contents, not only their filenames', async t => {
  const dir = fixture(t);
  const untracked = path.join(dir, 'candidate.txt');
  fs.writeFileSync(untracked, 'first');
  const a = await captureGitIdentity(dir);
  fs.writeFileSync(untracked, 'other');
  const b = await captureGitIdentity(dir);
  assert.notEqual(a.worktreeHash, b.worktreeHash);
  fs.unlinkSync(untracked);
  assert.notEqual((await captureGitIdentity(dir)).worktreeHash, b.worktreeHash);
});

test('changes in ignored files do not trigger false resume drift', async t => {
  const dir = fixture(t);
  fs.writeFileSync(path.join(dir, '.gitignore'), 'ignored.dat\n');
  git(dir, 'add', '.gitignore');
  git(dir, 'commit', '-qm', 'ignore');
  const before = await captureGitIdentity(dir);
  fs.writeFileSync(path.join(dir, 'ignored.dat'), 'cache');
  assert.deepEqual(await captureGitIdentity(dir), before);
});

test('rejects nested folders and oversized untracked files', async t => {
  const dir = fixture(t);
  fs.mkdirSync(path.join(dir, 'nested'));
  await assert.rejects(captureGitIdentity(path.join(dir, 'nested')), /repository root/);
  fs.writeFileSync(path.join(dir, 'big.dat'), Buffer.alloc(16 * 1024 * 1024 + 1));
  await assert.rejects(captureGitIdentity(dir), /fingerprint limits/);
});

test('fingerprinting does not modify the Git working tree', async t => {
  const dir = fixture(t);
  fs.writeFileSync(path.join(dir, 'tracked.txt'), 'pending');
  fs.writeFileSync(path.join(dir, 'new.txt'), 'untracked');
  const before = git(dir, 'status', '--porcelain=v1', '--untracked-files=all');
  await captureGitIdentity(dir);
  const after = git(dir, 'status', '--porcelain=v1', '--untracked-files=all');
  assert.equal(after, before);
});
