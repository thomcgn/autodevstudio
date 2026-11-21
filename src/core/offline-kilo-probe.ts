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

export interface KiloInstallation {
  /** Canonical executable path determined from PATH; never renderer input. */
  binary: string;
}

/** Resolve only an executable named kilo from the current process PATH.
 * No shell, no npm execution, no Home or provider config inspection.
 */
export function discoverKiloInstallation(
  envPath:string|undefined=process.env.PATH,
):KiloInstallation|null{
  for(const dir of (envPath??'').split(path.delimiter)){
    if(!dir || !path.isAbsolute(dir))continue;
    const candidate=path.join(dir,'kilo');
    try {
      const binary=fs.realpathSync(candidate);
      const stat=fs.statSync(binary);
      if(!stat.isFile())continue;
      fs.accessSync(binary,fs.constants.X_OK);
      return {binary};
    }catch {/* not an executable candidate */}
  }
  return null;
}
export interface KiloPackagePlacement {
  kind:'system'|'package'|'standalone';
  executable:string;
  sourceDirectory?:string;
}
/** Never mount a home ancestor. A user-installed npm package is eligible only
 * if its package.json explicitly identifies @kilocode/cli and its executable
 * lives inside that exact package; otherwise copy just the standalone binary.
 */
export function classifyKiloPlacement(binary:string):KiloPackagePlacement{
  const canonical=fs.realpathSync(binary);
  const stat=fs.statSync(canonical);
  if(!stat.isFile()||stat.size>512*1024*1024)throw new Error('Invalid Kilo executable');
  if(canonical.startsWith('/usr/'))
    return {kind:'system',executable:canonical};
  let directory=path.dirname(canonical);
  for(let i=0;i<8;i++){
    const pkg=path.join(directory,'package.json');
    try {
      const stat=fs.lstatSync(pkg);
      if(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=128*1024){
        const data:unknown=JSON.parse(fs.readFileSync(pkg,'utf8'));
        if(path.basename(directory)==='cli' && path.basename(path.dirname(directory))==='@kilocode' &&
          path.basename(path.dirname(path.dirname(directory)))==='node_modules' &&
          data&&typeof data==='object'&&!Array.isArray(data)&&
          (data as {name?:unknown}).name==='@kilocode/cli'){
          const relative=path.relative(directory,canonical);
          if(relative&&relative!=='.'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative))
            return {kind:'package',executable:'/opt/kilo/'+relative,sourceDirectory:directory};
        }
      }
    }catch {/* not a matching package root */}
    const parent=path.dirname(directory);
    if(parent===directory)break;
    directory=parent;
  }
  return {kind:'standalone',executable:'/opt/kilo/kilo'};
}
/** Offline test only. The sandbox receives either /usr, one verified Kilo npm
 * package (read-only), or a COPY of one standalone executable (read-only).
 * It never receives the host HOME, credentials, runtime sockets or network.
 */
export async function probeOfflineKiloRuntime(
  executor:KiloVersionExecutor=execute,
  lookup:()=>string|null=()=>discoverKiloInstallation()?.binary??null,
):Promise<OfflineKiloProbeResult>{
  if(process.platform!=='linux')return {passed:false,reason:'unsupported-platform'};
  let executable:string|null;
  try{executable=lookup()}catch{return {passed:false,reason:'cli-unavailable'};}
  if(executable===null)return {passed:false,reason:'cli-unavailable'};
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'autodev-kilo-runtime-'));
  try {
    fs.mkdirSync(path.join(temp,'.git'));
    const placement=classifyKiloPlacement(executable);
    let source:string|undefined=placement.sourceDirectory;
    if(placement.kind==='standalone'){
      const isolated=path.join(temp,'isolated-cli');
      fs.mkdirSync(isolated,{mode:0o700});
      const copy=path.join(isolated,'kilo');
      fs.copyFileSync(fs.realpathSync(executable),copy);
      fs.chmodSync(copy,0o500);
      source=isolated;
    }
    const launch=createIsolatedQualityLaunch(temp,'studio-probe');
    const separator=launch.args.indexOf('--');
    if(separator<0||launch.args[separator+1]!=='/usr/bin/npm'||launch.args[separator+2]!=='run')
      return {passed:false,reason:'sandbox-failed'};
    const args=launch.args.slice(0,separator);
    if(source)args.push('--dir','/opt','--ro-bind',source,'/opt/kilo');
    args.push('--',placement.executable,'--version');
    let output:string;
    try{output=await executor({...launch,args})}
    catch{return {passed:false,reason:'sandbox-failed'};}
    if(!output.trim()||Buffer.byteLength(output)>4096)
      return {passed:false,reason:'invalid-output'};
    return {passed:true,reason:'passed'};
  }catch{
    return {passed:false,reason:'sandbox-failed'};
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
}
