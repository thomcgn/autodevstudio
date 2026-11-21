import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { QualityScriptRunner } from './quality-gates.ts';

const exec=promisify(execFile);
const SCRIPT=/^[a-zA-Z][a-zA-Z0-9:_-]{0,79}$/;
export interface IsolatedQualityLaunch {binary:'bwrap'; args:string[]; cwd:string}

/** Filesystem policy for explicitly trusted quality scripts, not model commands.
 * Files outside the one selected project are invisible. Project files can be
 * modified by scripts; .git is overlaid read-only and network is disabled.
 * Caller must enforce explicit script approval and test results after execution.
 */
export function createIsolatedQualityLaunch(projectPath:string, script:string):IsolatedQualityLaunch {
  if(process.platform!=='linux')throw new Error('Isolated quality gates currently require Linux');
  if(!SCRIPT.test(script))throw new Error('Invalid quality script name');
  const root=fs.realpathSync(projectPath);
  if(!fs.statSync(root).isDirectory())throw new Error('Invalid project root');
  const git=path.join(root,'.git');
  const gitStat=fs.lstatSync(git);
  if(!gitStat.isDirectory()||gitStat.isSymbolicLink())
    throw new Error('Quality sandbox requires a regular Git directory (no worktrees)');

  const args=[
    '--die-with-parent','--unshare-net','--unshare-ipc','--unshare-pid',
    '--clearenv','--setenv','PATH','/usr/bin:/bin',
    '--setenv','HOME','/tmp',
    '--setenv','TMPDIR','/tmp',
    '--setenv','npm_config_cache','/tmp/npm-cache',
    '--setenv','CI','true',
    '--setenv','GIT_OPTIONAL_LOCKS','0',
    '--setenv','GIT_TERMINAL_PROMPT','0',
    '--tmpfs','/',
    '--dir','/usr','--ro-bind','/usr','/usr','--dev','/dev',
    // Node resolves its executable through /proc/self/exe. This procfs belongs
    // to the PRIVATE PID namespace, not to the host; never bind host /proc.
    '--proc','/proc',
  ];
  for(const name of ['/bin','/lib','/lib64']){
    let stat:fs.Stats;
    try{stat=fs.lstatSync(name)}catch(error){
      if((error as NodeJS.ErrnoException).code==='ENOENT')continue;
      throw error;
    }
    if(stat.isSymbolicLink()){
      const target=fs.readlinkSync(name);
      if(!/^usr\/(?:bin|lib|lib64)$/.test(target))
        throw new Error('Unexpected runtime symlink');
      args.push('--symlink',target,name);
    }else if(stat.isDirectory())args.push('--ro-bind',name,name);
    else throw new Error('Unexpected runtime mount source');
  }
  args.push('--dir','/project','--bind',root,'/project',
    '--ro-bind',git,'/project/.git',
    '--tmpfs','/tmp','--chdir','/project',
    '--','/usr/bin/npm','run','--',script);
  return {binary:'bwrap',args,cwd:root};
}
export type IsolatedQualityExecutor=(launch:IsolatedQualityLaunch,timeoutMs:number,signal?:AbortSignal)=>Promise<string>;

const execute:IsolatedQualityExecutor=async(launch,timeoutMs,signal)=>{
  const result=await exec(launch.binary,launch.args,{
    cwd:launch.cwd,encoding:'utf8',windowsHide:true,shell:false,
    timeout:timeoutMs,maxBuffer:32*1024,signal,
    env:{PATH:'/usr/bin:/bin',LANG:'C'},
  });
  return result.stdout;
};

/** Compatible with runTrustedQualityGates' trusted script runner hook.
 * Caller may only invoke after an explicit repository/script trust decision.
 * Raw subprocess errors are never returned to the controller/UI.
 */
export const runIsolatedNpmScript:QualityScriptRunner=async(cwd,script,timeoutMs,signal,onOutput)=>{
  if(signal?.aborted)throw new Error('Isolated quality gate cancelled');
  if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1000||timeoutMs>30*60*1000)
    throw new Error('Invalid isolated quality timeout');
  const launch=createIsolatedQualityLaunch(cwd,script);
  if(!fs.existsSync('/usr/bin/npm'))throw new Error('System npm unavailable for isolated quality gate');
  try {
    const text=await execute(launch,timeoutMs,signal);
    if(signal?.aborted)throw new Error('Cancelled');
    if(text)onOutput?.('stdout',text);
  } catch {
    throw new Error('Isolated quality gate failed; authorization remains revoked');
  }
};
