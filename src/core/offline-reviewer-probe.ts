import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createOfflineReviewerSandboxLaunch, type OfflineReviewerSandboxLaunch } from './offline-reviewer-sandbox.ts';
import { discoverKiloInstallation } from './offline-kilo-probe.ts';

const exec=promisify(execFile);
export type ReviewerProbeStage = 'runtime' | 'help' | 'policy';
export type ReviewerProbeDetail = 'mount-or-namespace' | 'runtime-library' |
  'permission-or-config' | 'timeout' | 'process-exit' | 'other';
export interface OfflineReviewerProbeResult {
  passed:boolean;
  reason:'passed'|'unsupported-platform'|'cli-unavailable'|'sandbox-failed'|'invalid-output';
  stage:ReviewerProbeStage|null;
  detail:ReviewerProbeDetail|null;
  exitCode:number|null;
}
export type ReviewerHelpExecutor=(launch:OfflineReviewerSandboxLaunch)=>Promise<string>;
const run:ReviewerHelpExecutor=async launch=>{
  const result=await exec(launch.binary,launch.args,{
    cwd:launch.cwd,shell:false,windowsHide:true,timeout:10000,
    maxBuffer:32*1024,encoding:'utf8',env:{PATH:'/usr/bin:/bin',LANG:'C'},
  });
  return result.stdout;
};
/** Offline staged diagnosis. We do NOT show raw CLI output, stderr, config,
 * home paths or provider data. The no-policy stages distinguish Bubblewrap/CLI
 * failures from failures introduced by the deny-all reviewer config.
 */
function classifyFailure(error:unknown):Pick<OfflineReviewerProbeResult,'detail'|'exitCode'>{
  const value=error as {code?:unknown;killed?:unknown;stderr?:unknown}|null;
  const code=typeof value?.code==='number'&&Number.isInteger(value.code)&&
    value.code>=0&&value.code<=255 ? value.code : null;
  if(value?.code==='ETIMEDOUT'||value?.killed===true)
    return {detail:'timeout',exitCode:code};
  const stderr=typeof value?.stderr==='string' ? value.stderr.slice(0,4096) : '';
  if(/bwrap:.*(?:mount|namespace|operation not permitted|create file|read-only file system)/i.test(stderr))
    return {detail:'mount-or-namespace',exitCode:code};
  if(/shared librar|cannot open shared object|no such file or directory|cannot find module/i.test(stderr))
    return {detail:'runtime-library',exitCode:code};
  if(/permission denied|config|schema|invalid model|invalid agent/i.test(stderr))
    return {detail:'permission-or-config',exitCode:code};
  return {detail:code===null?'other':'process-exit',exitCode:code};
}
function deriveStageLaunch(
  launch:OfflineReviewerSandboxLaunch,
  stage:ReviewerProbeStage,
):OfflineReviewerSandboxLaunch{
  const delimiter=launch.args.indexOf('--');
  const envAt=launch.args.indexOf('KILO_CONFIG_CONTENT');
  if(delimiter<0 || envAt<1 || launch.args[envAt-1]!=='--setenv' ||
      envAt+1>=delimiter ||
      launch.args.slice(delimiter+2).join(' ')!=='run --help')
    throw new Error('Unexpected offline reviewer launch layout');
  const stripped=launch.args.slice(0,envAt-1).concat(launch.args.slice(envAt+2,delimiter));
  const command=launch.args[delimiter+1];
  if(stage==='runtime')
    return {...launch,args:[...stripped,'--',command,'--version']};
  if(stage==='help')
    return {...launch,args:[...stripped,'--',command,'run','--help']};
  return launch;
}
export async function probeOfflineReviewerSandbox(
  executor:ReviewerHelpExecutor=run,
  find:()=>string|null=()=>discoverKiloInstallation()?.binary??null,
):Promise<OfflineReviewerProbeResult>{
  const failed=(reason:OfflineReviewerProbeResult['reason'],
    stage:ReviewerProbeStage|null=null,
    detail:ReviewerProbeDetail|null=null,exitCode:number|null=null):OfflineReviewerProbeResult=>
      ({passed:false,reason,stage,detail,exitCode});
  if(process.platform!=='linux')return failed('unsupported-platform');
  let kilo:string|null;
  try{kilo=find()}catch{return failed('cli-unavailable');}
  if(!kilo)return failed('cli-unavailable');
  const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'autodev-reviewer-offline-'));
  let stage:ReviewerProbeStage='runtime';
  try{
    const launch=createOfflineReviewerSandboxLaunch(scratch,kilo,'kilocode/reviewer-probe');
    for(const next of ['runtime','help','policy'] as const){
      stage=next;
      let output:string;
      try{output=await executor(deriveStageLaunch(launch,stage))}
      catch(error){return {...failed('sandbox-failed',stage),...classifyFailure(error)};}
      const length=typeof output==='string'?Buffer.byteLength(output,'utf8'):Infinity;
      const valid=length>0&&length<=32*1024&&
        (stage==='runtime'?/^\\s*(?:kilo\\s+)?v?\\d+\\.\\d+\\.\\d+/i.test(output):
          output.includes('--model')&&output.includes('--agent'));
      if(!valid)return failed('invalid-output',stage);
    }
    return {passed:true,reason:'passed',stage:null,detail:null,exitCode:null};
  }catch(error){
    return {...failed('sandbox-failed',stage),...classifyFailure(error)};
  }finally{
    fs.rmSync(scratch,{recursive:true,force:true});
  }
}
