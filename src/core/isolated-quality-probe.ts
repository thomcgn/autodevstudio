import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createIsolatedQualityLaunch, type IsolatedQualityLaunch, type IsolatedQualityExecutor } from './isolated-quality.ts';

const exec=promisify(execFile);
type Stage='prepare'|'node'|'npm';
type Failure='mount-or-namespace'|'runtime-library'|'command-exit'|'timeout'|'other';
export interface IsolatedQualityProbe {
  supported:boolean;
  passed:boolean;
  reason:'passed'|'unsupported-platform'|'npm-unavailable'|'sandbox-failed'|'invalid-output';
  stage:Stage|null;
  detail:Failure|null;
  exitCode:number|null;
}
const realExecutor:IsolatedQualityExecutor=async(launch,timeoutMs)=>{
  const result=await exec(launch.binary,launch.args,{
    cwd:launch.cwd,timeout:timeoutMs,maxBuffer:4096,
    encoding:'utf8',windowsHide:true,shell:false,
    env:{PATH:'/usr/bin:/bin',LANG:'C'},
  });
  return result.stdout;
};
function classify(error:unknown):{detail:Failure;exitCode:number|null}{
  const e=error as {code?:unknown;killed?:unknown;stderr?:unknown}|null;
  const code=typeof e?.code==='number'&&Number.isInteger(e.code)&&e.code>=0&&e.code<=255?e.code:null;
  if(e?.code==='ETIMEDOUT'||e?.killed===true)return {detail:'timeout',exitCode:code};
  const stderr=typeof e?.stderr==='string'?e.stderr.slice(0,4096):'';
  if(/bwrap:.*(?:mount|namespace|create file|operation not permitted|read-only file system)/i.test(stderr))
    return {detail:'mount-or-namespace',exitCode:code};
  if(/cannot open shared object|error while loading shared libraries|not found|no such file or directory/i.test(stderr))
    return {detail:'runtime-library',exitCode:code};
  if(code!==null)return {detail:'command-exit',exitCode:code};
  return {detail:'other',exitCode:null};
}
const command=(launch:IsolatedQualityLaunch,program:string):IsolatedQualityLaunch=>{
  const separator=launch.args.lastIndexOf('--');
  if(separator<0)throw new Error('Missing sandbox command separator');
  return {...launch,args:[...launch.args.slice(0,separator+1),program,'--version']};
};

/** Read-only smoke test using only a temporary mock project. First confirm the
 * Node runtime, then npm. Never launch a project script or return raw output.
 */
export async function probeIsolatedQualityRuntime(
  executor:IsolatedQualityExecutor=realExecutor,
):Promise<IsolatedQualityProbe>{
  const unsupported={supported:false,passed:false,reason:'unsupported-platform',stage:null,detail:null,exitCode:null} as const;
  if(process.platform!=='linux')return unsupported;
  if(!fs.existsSync('/usr/bin/npm')||!fs.existsSync('/usr/bin/node'))
    return {supported:true,passed:false,reason:'npm-unavailable',stage:'prepare',detail:null,exitCode:null};
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'autodev-quality-probe-'));
  let stage:Stage='prepare';
  try{
    fs.mkdirSync(path.join(temp,'.git'));
    const launch=createIsolatedQualityLaunch(temp,'typecheck');
    for(const [part,program] of [['node','/usr/bin/node'],['npm','/usr/bin/npm']] as const){
      stage=part;
      let output:string;
      try{output=await executor(command(launch,program),10000)}
      catch(error){
        return {supported:true,passed:false,reason:'sandbox-failed',stage,
          ...classify(error)};
      }
      if(!(part==='node' ? /^\s*v\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?\s*$/.test(output) : /^\s*\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?\s*$/.test(output)))
        return {supported:true,passed:false,reason:'invalid-output',stage,detail:null,exitCode:null};
    }
    return {supported:true,passed:true,reason:'passed',stage:null,detail:null,exitCode:null};
  }catch(error){
    return {supported:true,passed:false,reason:'sandbox-failed',stage,...classify(error)};
  }finally{
    fs.rmSync(temp,{recursive:true,force:true});
  }
}
