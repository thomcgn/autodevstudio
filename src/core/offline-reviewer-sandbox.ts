import fs from 'node:fs';
import path from 'node:path';
import { classifyKiloPlacement } from './offline-kilo-probe.ts';
import {
  createNoToolsReviewerPolicy,
  assertNoToolsReviewerPolicy,
} from './kilo-reviewer-policy.ts';

export interface OfflineReviewerSandboxLaunch {
  binary:'bwrap';
  args:string[];
  cwd:string;
}

/** Construct an OFFLINE, command-help-only reviewer policy smoke launch.
 *
 * The critical separation is intentional:
 * - no user project/worktree is visible, not even read-only
 * - no host HOME, global Kilo config, auth credentials or runtime sockets
 * - no network, no --auto, no actual reviewer model prompt
 * - only a verified Kilo installation and OS runtime are read-only mounted
 *
 * This is NOT a production model transport. Network and provider
 * authentication will require a separate explicitly reviewed gateway.
 */
export function createOfflineReviewerSandboxLaunch(
  scratchDirectory:string, kiloBinary:string, model:string,
):OfflineReviewerSandboxLaunch {
  if(process.platform!=='linux')throw new Error('Reviewer runtime sandbox requires Linux');
  const scratch=fs.realpathSync(scratchDirectory);
  if(!fs.statSync(scratch).isDirectory())throw new Error('Invalid temporary reviewer staging');
  const policy=createNoToolsReviewerPolicy(model);
  assertNoToolsReviewerPolicy(policy.configContent);
  const placement=classifyKiloPlacement(kiloBinary);
  if(placement.kind==='standalone') {
    throw new Error('Unverified standalone CLI requires separate staging before reviewer use');
  }
  const args=[
    '--die-with-parent','--unshare-net','--unshare-ipc','--unshare-pid',
    '--clearenv',
    '--setenv','HOME','/tmp',
    '--setenv','TMPDIR','/tmp',
    '--setenv','PATH','/usr/bin:/bin',
    '--setenv','XDG_CONFIG_HOME','/tmp/config',
    '--setenv','XDG_DATA_HOME','/tmp/data',
    '--setenv','KILO_CONFIG_CONTENT',policy.configContent,
    '--tmpfs','/',
    '--dir','/usr','--ro-bind','/usr','/usr',
    '--dev','/dev','--proc','/proc',
  ];
  for(const name of ['/bin','/lib','/lib64']){
    let stat:fs.Stats;
    try{stat=fs.lstatSync(name)}
    catch(error){
      if((error as NodeJS.ErrnoException).code==='ENOENT')continue;
      throw error;
    }
    if(stat.isSymbolicLink()){
      const target=fs.readlinkSync(name);
      if(!/^usr\/(?:bin|lib|lib64)$/.test(target))
        throw new Error('Unexpected runtime symlink');
      args.push('--symlink',target,name);
    }else if(stat.isDirectory())args.push('--ro-bind',name,name);
    else throw new Error('Unexpected runtime directory');
  }
  if(placement.kind==='package'){
    if(!placement.sourceDirectory)throw new Error('Missing verified Kilo package');
    args.push('--dir','/opt','--ro-bind',placement.sourceDirectory,'/opt/kilo');
  }
  args.push(
    '--tmpfs','/tmp','--chdir','/tmp',
    '--',placement.executable,'run','--help',
  );
  // No host scratch mount: it serves only as trusted process cwd.
  // No user-supplied project path is included anywhere in the argv.
  return {binary:'bwrap',args,cwd:scratch};
}
