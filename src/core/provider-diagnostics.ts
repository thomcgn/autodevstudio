import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { accessSync, constants } from 'node:fs';

const exec = promisify(execFile);
export type DiagnosticRunner = (command: string, args: readonly string[], cwd: string) => Promise<string>;
const run: DiagnosticRunner = async (command, args, cwd) => {
  const isCatalog = command === 'kilo' && args.length === 2 && args[0] === 'agent' && args[1] === 'list';
  const result = await exec(command, [...args], {
    cwd, timeout: isCatalog ? 20000 : 8000, encoding: 'utf8',
    maxBuffer: isCatalog ? 1024 * 1024 : 32 * 1024, windowsHide: true,
  });
  return result.stdout + result.stderr;
};
export interface ProviderDiagnostics {
  kiloInstalled: boolean;
  kiloVersion: string | null;
  supportedFlags: string[];
  kiloRunCommandReady: boolean;
  agentCatalogReadable: boolean;
  agentCatalogProblem: 'timeout' | 'output-limit' | 'command-failed' | 'not-found' | 'empty-output' | null;
  sandboxTool: 'bwrap' | 'sandbox-exec' | null;
  sandboxToolAvailable: boolean;
  ghInstalled: boolean;
  ghAuthenticated: boolean;
  checkedAt: string;
}
const FLAGS = ['--auto','--agent','--model','--session'] as const;

/** Read-only local diagnostics. No Kilo run command or model request is issued.
 * In particular, raw auth output, environment variables and tokens are never returned.
 */
export async function inspectLocalProviders(
  projectDirectory: string, runner: DiagnosticRunner = run,
): Promise<ProviderDiagnostics> {
  let kiloInstalled = false;
  let kiloVersion: string | null = null;
  let supportedFlags: string[] = [];
  let ghInstalled = false;
  let ghAuthenticated = false;
  let agentCatalogReadable = false;
  let agentCatalogProblem: ProviderDiagnostics['agentCatalogProblem'] = null;
  const sandboxTool = process.platform === 'linux' ? 'bwrap' : process.platform === 'darwin' ? 'sandbox-exec' : null;
  let sandboxToolAvailable = false;
  try {
    const version = await runner('kilo', ['--version'], projectDirectory);
    kiloInstalled = true;
    kiloVersion = version.trim().split(/\r?\n/,1)[0].slice(0,120) || 'Installed';
  } catch { /* not installed or not executable */ }
  if (kiloInstalled) {
    try {
      const help = await runner('kilo', ['run','--help'], projectDirectory);
      supportedFlags = FLAGS.filter(flag => help.includes(flag));
    } catch { /* run command unavailable */ }
    try {
      const catalog = await runner('kilo', ['agent','list'], projectDirectory);
      if (catalog.trim()) agentCatalogReadable = true;
      else agentCatalogProblem = 'empty-output';
    } catch (error) {
      // Only classify trusted process error codes; never expose message, stderr,
      // stdout or provider configuration to the renderer.
      const info = error as NodeJS.ErrnoException & { killed?: boolean };
      agentCatalogProblem = info.code === 'ENOENT' ? 'not-found' :
        info.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' ? 'output-limit' :
        info.code === 'ETIMEDOUT' || info.killed === true ? 'timeout' : 'command-failed';
    }
  }
  if (sandboxTool === 'sandbox-exec') {
    try { accessSync('/usr/bin/sandbox-exec', constants.X_OK); sandboxToolAvailable = true; }
    catch { /* absent */ }
  } else if (sandboxTool === 'bwrap') {
    try {
      // Version check is harmless and does not create an actual sandbox.
      await runner('bwrap', ['--version'], projectDirectory);
      sandboxToolAvailable = true;
    } catch { /* binary absent or not executable */ }
  }
  try {
    await runner('gh', ['--version'], projectDirectory);
    ghInstalled = true;
  } catch { /* not installed */ }
  if (ghInstalled) {
    try {
      await runner('gh', ['auth','status','--hostname','github.com'], projectDirectory);
      ghAuthenticated = true;
    } catch { /* not authenticated; never expose potentially sensitive stderr */ }
  }
  return {
    kiloInstalled, kiloVersion, supportedFlags,
    kiloRunCommandReady: FLAGS.every(flag => supportedFlags.includes(flag)),
    agentCatalogReadable, agentCatalogProblem, sandboxTool, sandboxToolAvailable,
    ghInstalled, ghAuthenticated, checkedAt: new Date().toISOString(),
  };
}
