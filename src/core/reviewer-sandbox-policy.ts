import fs from 'node:fs';
import path from 'node:path';

export interface ReviewerSandboxSpec {
  projectPath: string;
  binary: string;
  args: readonly string[];
}
export interface ReviewerSandboxLaunch {
  binary: 'bwrap';
  args: string[];
  cwd: string;
}

/** Strictly local, offline reviewer TOOL sandbox policy.
 *
 * This is not a Kilo network-enabled agent sandbox. A future controller must
 * keep model/network calls outside this tool boundary, verify host-level
 * containment, and provide narrowly scoped model input.
 *
 * Unlike '--ro-bind / /', the private root has NO home, SSH keys, other
 * projects, credential stores, runtime sockets or host /tmp.
 */
export function createReadonlyReviewerToolLaunch(spec: ReviewerSandboxSpec): ReviewerSandboxLaunch {
  if (process.platform !== 'linux') throw new Error('Reviewer tool sandbox requires Linux');
  const root = fs.realpathSync(spec.projectPath);
  if (!fs.statSync(root).isDirectory()) throw new Error('Reviewer project is not a directory');
  if (!path.isAbsolute(spec.binary) || !spec.binary.startsWith('/usr/bin/') ||
      !/^\/usr\/bin\/[a-zA-Z0-9._+-]+$/.test(spec.binary)) {
    throw new Error('Reviewer tool must be an approved /usr/bin binary');
  }
  const allowed = new Set(['/usr/bin/sh','/usr/bin/true','/usr/bin/false',
    '/usr/bin/cat','/usr/bin/grep','/usr/bin/git','/usr/bin/diff']);
  if (!allowed.has(spec.binary)) throw new Error('Reviewer tool not allowlisted');
  if (spec.args.length > 64 || spec.args.some(arg => typeof arg !== 'string' ||
    arg.length > 4096 || arg.includes('\0'))) throw new Error('Invalid tool arguments');
  // This is a policy primitive: arbitrary shell code is NOT an acceptable reviewer tool.
  if (spec.binary === '/usr/bin/sh' && spec.args.length)
    throw new Error('Shell execution requires a separate fixed test harness');
  const args = [
    '--die-with-parent',
    '--unshare-net', '--unshare-ipc', '--unshare-pid',
    '--clearenv',
    '--setenv','PATH','/usr/bin',
    '--setenv','HOME','/tmp',
    '--setenv','TMPDIR','/tmp',
    '--tmpfs','/',
    '--dir','/usr',
    '--ro-bind','/usr','/usr',
  ];
  // The /usr-merged layout differs across distributions. Expose only
  // runtime library/executable paths, and never bind the host root.
  for (const name of ['/bin','/lib','/lib64']) {
    if (fs.existsSync(name)) {
      args.push('--ro-bind',name,name);
    }
  }
  args.push('--dir','/project','--ro-bind',root,'/project',
    '--tmpfs','/tmp','--chdir','/project','--',spec.binary,...spec.args);
  return {binary:'bwrap',args,cwd:root};
}
