import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createOfflineReviewerSandboxLaunch, type OfflineReviewerSandboxLaunch } from './offline-reviewer-sandbox.ts';
import { discoverKiloInstallation } from './offline-kilo-probe.ts';

const exec=promisify(execFile);
export interface OfflineReviewerProbeResult {
  passed:boolean;
  reason:'passed'|'unsupported-platform'|'cli-unavailable'|'sandbox-failed'|'invalid-output';
}
export type ReviewerHelpExecutor=(launch:OfflineReviewerSandboxLaunch)=>Promise<string>;
const run:ReviewerHelpExecutor=async launch=>{
  const result=await exec(launch.binary,launch.args,{
    cwd:launch.cwd,shell:false,windowsHide:true,timeout:10000,
    maxBuffer:32*1024,encoding:'utf8',env:{PATH:'/usr/bin:/bin',LANG:'C'},
  });
  return result.stdout;
};
/** A LOCAL capability probe only: one fixed `kilo run --help` call with
 * deny-all reviewer config and no host project, home, network or auth.
 * Never supplies a prompt, credentials, --auto, or an agent session.
 */
export async function probeOfflineReviewerSandbox(
  executor:ReviewerHelpExecutor=run,
  find:()=>string|null=()=>discoverKiloInstallation()?.binary??null,
):Promise<OfflineReviewerProbeResult>{
  if(process.platform!=='linux')return {passed:false,reason:'unsupported-platform'};
  let kilo:string|null;
  try{kilo=find()}catch{return {passed:false,reason:'cli-unavailable'};}
  if(!kilo)return {passed:false,reason:'cli-unavailable'};
  const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'autodev-reviewer-offline-'));
  try{
    const launch=createOfflineReviewerSandboxLaunch(scratch,kilo,'kilocode/reviewer-probe');
    let help:string;
    try{help=await executor(launch)}
    catch{return {passed:false,reason:'sandbox-failed'};}
    if(typeof help!=='string'||!help.includes('--model')||!help.includes('--agent')||
      !help.trim()||Buffer.byteLength(help,'utf8')>32*1024)
      return {passed:false,reason:'invalid-output'};
    return {passed:true,reason:'passed'};
  }catch{
    return {passed:false,reason:'sandbox-failed'};
  }finally{
    fs.rmSync(scratch,{recursive:true,force:true});
  }
}
