import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
export type DiagnosticRunner = (command: string, args: readonly string[], cwd: string) => Promise<string>;
const run: DiagnosticRunner = async (command, args, cwd) => {
  const result = await exec(command, [...args], {
    cwd, timeout: 8000, encoding: 'utf8', maxBuffer: 32 * 1024, windowsHide: true,
  });
  return result.stdout + result.stderr;
};
export interface ProviderDiagnostics {
  kiloInstalled: boolean;
  kiloVersion: string | null;
  supportedFlags: string[];
  kiloRunCommandReady: boolean;
  agentCatalogReadable: boolean;
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
      await runner('kilo', ['agent','list'], projectDirectory);
      agentCatalogReadable = true;
    } catch { /* cannot list agents; do not expose raw output */ }
  }
  if (sandboxTool) {
    try {
      // Version check is harmless and does not create an actual sandbox.
      await runner(sandboxTool, ['--version'], projectDirectory);
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
    agentCatalogReadable, sandboxTool, sandboxToolAvailable,
    ghInstalled, ghAuthenticated, checkedAt: new Date().toISOString(),
  };
}
