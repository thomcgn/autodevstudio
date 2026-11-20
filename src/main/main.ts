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
