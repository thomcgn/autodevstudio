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

/** A sandbox boundary is not a command-authorization boundary. Keep the review
 * operation surface closed: no arbitrary git options (aliases, -c, -C,
 * external diff helpers, git subcommands or pagers) and no shell access.
 */
function assertReadonlyToolCommand(binary: string, args: readonly string[]): void {
  if (binary === '/usr/bin/git') {
    const allowed = [
      ['--no-pager', 'status', '--porcelain=v1', '--untracked-files=all'],
      ['--no-pager', 'diff', '--no-ext-diff', '--no-textconv', '--'],
      ['--no-pager', 'diff', '--cached', '--no-ext-diff', '--no-textconv', '--'],
      ['--no-pager', 'log', '-5', '--format=%h %s'],
    ];
    if (!allowed.some(sequence => args.length === sequence.length &&
        sequence.every((item,index) => args[index] === item))) {
      throw new Error('Unsupported reviewer Git operation');
    }
    return;
  }
  if (binary === '/usr/bin/true' || binary === '/usr/bin/false') {
    if (args.length) throw new Error('Reviewer command does not accept arguments');
    return;
  }
  throw new Error('Unsupported reviewer executable');
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
  if (spec.args.length > 64 || spec.args.some(arg => typeof arg !== 'string' ||
    arg.length > 4096 || arg.includes('\0'))) throw new Error('Invalid tool arguments');
  assertReadonlyToolCommand(spec.binary, spec.args);
  const args = [
    '--die-with-parent',
    '--unshare-net', '--unshare-ipc', '--unshare-pid',
    '--clearenv',
    '--setenv','PATH','/usr/bin',
    '--setenv','HOME','/tmp',
    '--setenv','TMPDIR','/tmp',
    '--setenv','GIT_CONFIG_NOSYSTEM','1',
    '--setenv','GIT_CONFIG_GLOBAL','/dev/null',
    '--setenv','GIT_OPTIONAL_LOCKS','0',
    '--setenv','GIT_TERMINAL_PROMPT','0',
    '--setenv','GIT_NO_REPLACE_OBJECTS','1',
    '--tmpfs','/',
    '--dir','/usr',
    '--ro-bind','/usr','/usr',
    '--dev','/dev',
  ];
  // On Arch (and other usr-merged distros) /bin, /lib and /lib64 are
  // symlinks into /usr. Recreate those links in the private root instead
  // of trying to bind-mount onto symlinks that resolve within /usr.
  // Real directories on non-usr-merged systems are mounted read-only.
  for (const name of ['/bin','/lib','/lib64']) {
    let stat: fs.Stats;
    try { stat = fs.lstatSync(name); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    if (stat.isSymbolicLink()) {
      const target = fs.readlinkSync(name);
      if (!target.startsWith('usr/') || !/^usr\/(?:bin|lib|lib64)$/.test(target)) {
        throw new Error('Unexpected host library symlink: cannot construct safe sandbox');
      }
      args.push('--symlink', target, name);
    } else if (stat.isDirectory()) {
      args.push('--ro-bind', name, name);
    } else {
      throw new Error('Unexpected host runtime directory type');
    }
  }
  args.push('--dir','/project','--ro-bind',root,'/project',
    '--tmpfs','/tmp','--chdir','/project','--',spec.binary,...spec.args);
  return {binary:'bwrap',args,cwd:root};
}
