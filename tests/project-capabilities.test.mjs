import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inspectProject } from '../src/main/project-capabilities.ts';

test('accepts a Git repository without embedded AutoDev Core', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-git-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, '.git'));
  assert.deepEqual(inspectProject(dir), { isGitRepo: true, hasCore: false });
});

test('detects a Git repository with embedded Core', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-core-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, '.git'));
  fs.mkdirSync(path.join(dir, 'src', 'autodev'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'autodev', 'cli.ts'), '');
  assert.deepEqual(inspectProject(dir), { isGitRepo: true, hasCore: true });
});

test('supports Git metadata stored in a .git file', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-worktree-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, '.git'), 'gitdir: /tmp/example');
  assert.equal(inspectProject(dir).isGitRepo, true);
});

test('rejects ordinary directories as registered Git repositories', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-folder-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.equal(inspectProject(dir).isGitRepo, false);
});
