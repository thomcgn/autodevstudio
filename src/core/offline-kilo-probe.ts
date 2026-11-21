import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createIsolatedQualityLaunch, type IsolatedQualityLaunch } from './isolated-quality.ts';

const exec=promisify(execFile);
export interface OfflineKiloProbeResult {
  passed:boolean;
  reason:'passed'|'unsupported-platform'|'cli-unavailable'|
    'cli-outside-usr'|'sandbox-failed'|'invalid-output';
}
export type KiloVersionExecutor=(launch:IsolatedQualityLaunch)=>Promise<string>;
const execute:KiloVersionExecutor=async launch=>{
  const result=await exec(launch.binary,launch.args,{
    cwd:launch.cwd,encoding:'utf8',windowsHide:true,shell:false,
    timeout:10000,maxBuffer:4096,env:{PATH:'/usr/bin:/bin',LANG:'C'},
  });
  return result.stdout;
};
/** Offline test of the CLI binary, never a model invocation. Only the
 * verified /usr-installed CLI can be exposed; never mount the host HOME,
 * configured provider secrets, other projects or network.
 *
 * This is a runtime capability check only, not proof of safe Kilo model use.
 */
export async function probeOfflineKiloRuntime(
  executor:KiloVersionExecutor=execute,
  lookup:()=>string|null=()=>{
    if(!fs.existsSync('/usr/bin/kilo'))return null;
    return fs.realpathSync('/usr/bin/kilo');
  },
):Promise<OfflineKiloProbeResult>{
  if(process.platform!=='linux')return {passed:false,reason:'unsupported-platform'};
  let executable:string|null;
  try{executable=lookup()}catch{return {passed:false,reason:'cli-unavailable'};}
  if(executable===null)return {passed:false,reason:'cli-unavailable'};
  if(!executable.startsWith('/usr/')||executable.includes('/../'))
    return {passed:false,reason:'cli-outside-usr'};
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'autodev-kilo-runtime-'));
  try {
    fs.mkdirSync(path.join(temp,'.git'));
    const launch=createIsolatedQualityLaunch(temp,'studio-probe');
    const separator=launch.args.indexOf('--');
    if(separator<0||launch.args[separator+1]!=='/usr/bin/npm'||launch.args[separator+2]!=='run')
      return {passed:false,reason:'sandbox-failed'};
    const probeLaunch:IsolatedQualityLaunch={
      ...launch,args:[...launch.args.slice(0,separator+1),'/usr/bin/kilo','--version'],
    };
    let output:string;
    try{output=await executor(probeLaunch)}
    catch{return {passed:false,reason:'sandbox-failed'};}
    if(!output.trim()||Buffer.byteLength(output)>4096)
      return {passed:false,reason:'invalid-output'};
    return {passed:true,reason:'passed'};
  }catch{
    return {passed:false,reason:'sandbox-failed'};
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
}
