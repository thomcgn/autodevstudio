import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

interface Project { id: string; name: string; path: string }
type RunMode = 'status' | 'dry-run';
let window: BrowserWindow | null = null;
let active: ChildProcess | null = null;
let activeRun: string | null = null;
let pendingStop: NodeJS.Timeout | null = null;
const registry = (): string => path.join(app.getPath('userData'), 'projects.json');
function projects(): Project[] {
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(registry(), 'utf8'));
    return Array.isArray(raw) ? raw.filter((p): p is Project => typeof p?.id === 'string' && typeof p?.path === 'string' && typeof p?.name === 'string') : [];
  } catch { return []; }
}
function persist(list: Project[]): void {
  fs.mkdirSync(path.dirname(registry()), { recursive: true });
  const temp = `${registry()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(list, null, 2), { mode: 0o600 });
  fs.renameSync(temp, registry());
}
function send(channel: string, value: unknown): void {
  if (window && !window.isDestroyed()) window.webContents.send(channel, value);
}
function getProject(id: string): Project {
  const project = projects().find(p => p.id === id);
  if (!project) throw new Error('Project not found');
  const real = fs.realpathSync(project.path);
  const script = path.join(real, 'src', 'autodev', 'cli.ts');
  if (!fs.statSync(real).isDirectory() || !fs.existsSync(script)) throw new Error('AutoDev CLI missing in selected project');
  return { ...project, path: real };
}
type ControllerPhase = 'builder' | 'reviewer' | 'quality-gates' | 'finalize';
interface ControllerSnapshot {
  currentIssue: number | null;
  reviewIteration: number;
  processedIssues: number[];
  failedIssues: number[];
  checkpoint: { issueNumber: number; phase: ControllerPhase; reason: string; sessionId: string | null; timestamp: string } | null;
  hasState: boolean;
  updatedAt: number | null;
}
function safeJson(file: string): Record<string, unknown> | null {
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > 1024 * 1024) return null;
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch { return null; }
}
function numberArray(value: unknown): number[] {
  return Array.isArray(value) ? value.filter((n): n is number => Number.isSafeInteger(n) && n > 0).slice(0, 1000) : [];
}
function snapshot(id: string): ControllerSnapshot {
  const project = getProject(id);
  const file = path.join(project.path, '.autodev-state.json');
  const state = safeJson(file);
  // Controller stores its own checkpoint both in state and in a separate file.
  // The separate checkpoint wins if present; no prompt/credentials are exposed to renderer.
  const saved = safeJson(path.join(project.path, '.autodev-checkpoint.json'));
  const cp = saved ?? (state?.checkpoint && typeof state.checkpoint === 'object' && !Array.isArray(state.checkpoint) ? state.checkpoint as Record<string, unknown> : null);
  const phase = cp?.phase;
  const checkpoint = cp && typeof cp.issueNumber === 'number' &&
    (phase === 'builder' || phase === 'reviewer' || phase === 'quality-gates' || phase === 'finalize')
    ? { issueNumber: cp.issueNumber, phase, reason: typeof cp.reason === 'string' ? cp.reason : 'unknown',
        sessionId: typeof cp.sessionId === 'string' ? cp.sessionId : null,
        timestamp: typeof cp.timestamp === 'string' ? cp.timestamp : '' } : null;
  let updatedAt: number | null = null;
  try { updatedAt = fs.statSync(file).mtimeMs; } catch { /* no saved state */ }
  return { currentIssue: Number.isSafeInteger(state?.currentIssue) ? state!.currentIssue as number : null,
    reviewIteration: typeof state?.reviewIteration === 'number' ? state.reviewIteration : 0,
    processedIssues: numberArray(state?.processedIssues), failedIssues: numberArray(state?.failedIssues),
    checkpoint, hasState: state !== null, updatedAt };
}
function terminate(): void {
  const child = active;
  if (!child) return;
  try {
    if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGTERM');
    else child.kill('SIGTERM');
  } catch { /* process may have exited */ }
  if (pendingStop) clearTimeout(pendingStop);
  pendingStop = setTimeout(() => {
    if (active === child) {
      try { if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); }
      catch { /* already exited */ }
    }
  }, 4000);
  pendingStop.unref();
}
function createWindow(): void {
  window = new BrowserWindow({ width: 1160, height: 780, minWidth: 820, minHeight: 560,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
    backgroundColor: '#111827', title: 'AutoDev Studio' });
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) void window.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  else void window.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  window.on('closed', () => { window = null; });
}
app.whenReady().then(() => {
  ipcMain.handle('project:list', () => projects());
  ipcMain.handle('project:snapshot', (_event, id: string) => {
    if (typeof id !== 'string') throw new Error('Invalid project ID');
    return snapshot(id);
  });
  ipcMain.handle('project:add', async () => {
    const selection = await dialog.showOpenDialog(window!, { properties: ['openDirectory'] });
    if (selection.canceled || !selection.filePaths[0]) return null;
    const dir = fs.realpathSync(selection.filePaths[0]);
    if (!fs.existsSync(path.join(dir, 'src/autodev/cli.ts'))) throw new Error('This directory has no src/autodev/cli.ts');
    const existing = projects();
    const present = existing.find(p => p.path === dir);
    if (present) return present;
    const project = { id: randomUUID(), name: path.basename(dir), path: dir };
    persist([...existing, project]);
    return project;
  });
  ipcMain.handle('project:remove', (_event, id: string) => {
    if (typeof id !== 'string') throw new Error('Invalid ID');
    if (active && activeRun?.startsWith(id + ':')) throw new Error('Stop the running process first');
    persist(projects().filter(p => p.id !== id));
    return true;
  });
  ipcMain.handle('run:start', (_event, id: string, mode: RunMode) => {
    if (active) throw new Error('A run is already active');
    if (mode !== 'status' && mode !== 'dry-run') throw new Error('Only read-only and dry-run operations are allowed in Phase 1');
    const project = getProject(id);
    const bin = path.join(project.path, 'node_modules', '.bin', 'tsx');
    if (!fs.existsSync(bin)) throw new Error('Missing local tsx. Run npm install in the project.');
    const runId = randomUUID();
    const args = mode === 'status' ? [path.join(project.path, 'src/autodev/cli.ts'), 'status'] : [path.join(project.path, 'src/autodev/cli.ts'), 'run', '--dry-run'];
    const child = spawn(bin, args, { cwd: project.path, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32', env: { ...process.env, FORCE_COLOR: '0' } });
    active = child;
    activeRun = `${id}:${runId}`;
    send('run:event', { runId, type: 'start', mode, project: project.name, time: Date.now() });
    child.stdout?.on('data', (chunk: Buffer) => send('run:event', { runId, type: 'stdout', message: chunk.toString(), time: Date.now() }));
    child.stderr?.on('data', (chunk: Buffer) => send('run:event', { runId, type: 'stderr', message: chunk.toString(), time: Date.now() }));
    child.on('error', error => send('run:event', { runId, type: 'stderr', message: error.message, time: Date.now() }));
    child.on('close', (code, signal) => {
      if (pendingStop) { clearTimeout(pendingStop); pendingStop = null; }
      active = null; activeRun = null;
      send('run:event', { runId, type: 'exit', code, signal, time: Date.now() });
    });
    return { runId };
  });
  ipcMain.handle('run:stop', () => { if (!active) return false; terminate(); return true; });
  ipcMain.handle('run:active', () => Boolean(active));
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('before-quit', () => terminate());
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
