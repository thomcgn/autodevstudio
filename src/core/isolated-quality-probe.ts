import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createIsolatedQualityLaunch, type IsolatedQualityLaunch, type IsolatedQualityExecutor } from './isolated-quality.ts';

const exec=promisify(execFile);
export interface IsolatedQualityProbe {
  supported:boolean;
  passed:boolean;
  reason:'passed' | 'unsupported-platform' | 'npm-unavailable' | 'sandbox-failed' | 'invalid-output';
}
const realExecutor:IsolatedQualityExecutor=async(launch,timeoutMs)=>{
  const result=await exec(launch.binary,launch.args,{
    cwd:launch.cwd,timeout:timeoutMs,maxBuffer:4096,
    encoding:'utf8',windowsHide:true,shell:false,
    env:{PATH:'/usr/bin:/bin',LANG:'C'},
  });
  return result.stdout;
};

/** Runtime smoke-test for npm itself; no selected project is mounted and no
 * npm script is executed. All host file paths and process output are withheld
 * from the renderer. Passing does not approve future quality scripts.
 */
export async function probeIsolatedQualityRuntime(
  executor:IsolatedQualityExecutor=realExecutor,
):Promise<IsolatedQualityProbe> {
  if(process.platform!=='linux')
    return {supported:false,passed:false,reason:'unsupported-platform'};
  if(!fs.existsSync('/usr/bin/npm'))
    return {supported:true,passed:false,reason:'npm-unavailable'};
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'autodev-quality-probe-'));
  try {
    fs.mkdirSync(path.join(temp,'.git'));
    const launch=createIsolatedQualityLaunch(temp,'typecheck');
    const commandSeparator=launch.args.lastIndexOf('--');
    if(commandSeparator<0)throw new Error('Missing sandbox command separator');
    const probeLaunch:IsolatedQualityLaunch={
      ...launch,args:[...launch.args.slice(0,commandSeparator+1),'/usr/bin/npm','--version'],
    };
    let output:string;
    try{output=await executor(probeLaunch,10000)}
    catch{return {supported:true,passed:false,reason:'sandbox-failed'}}
    if(!/^\s*\d+\.\d+\.\d+\s*$/.test(output))
      return {supported:true,passed:false,reason:'invalid-output'};
    return {supported:true,passed:true,reason:'passed'};
  } catch {
    return {supported:true,passed:false,reason:'sandbox-failed'};
  } finally {
    fs.rmSync(temp,{recursive:true,force:true});
  }
}
