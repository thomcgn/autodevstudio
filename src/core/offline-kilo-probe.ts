import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createIsolatedQualityLaunch, type IsolatedQualityLaunch } from './isolated-quality.ts';

const exec=promisify(execFile);
export type OfflineKiloStage = 'prepare'|'version'|'help';
export type OfflineKiloDetail = 'mount-or-namespace'|'runtime-library'|'timeout'|'process-exit'|'other';
export interface OfflineKiloProbeResult {
  passed:boolean;
  reason:'passed'|'unsupported-platform'|'cli-unavailable'|
    'cli-outside-usr'|'sandbox-failed'|'invalid-output';
  stage:OfflineKiloStage|null;
  detail:OfflineKiloDetail|null;
  exitCode:number|null;
}
function classifyOfflineKiloError(error:unknown):Pick<OfflineKiloProbeResult,'detail'|'exitCode'>{
  const e=error as {code?:unknown;killed?:unknown;stderr?:unknown}|null;
  const exitCode=typeof e?.code==='number'&&Number.isInteger(e.code)&&e.code>=0&&e.code<=255?e.code:null;
  if(e?.code==='ETIMEDOUT'||e?.killed===true)return {detail:'timeout',exitCode};
  const stderr=typeof e?.stderr==='string'?e.stderr.slice(0,4096):'';
  if(/bwrap:.*(?:mount|namespace|operation not permitted|create file|read-only file system)/i.test(stderr))
    return {detail:'mount-or-namespace',exitCode};
  if(/cannot find module|no such file or directory|shared librar|cannot open shared object/i.test(stderr))
    return {detail:'runtime-library',exitCode};
  return {detail:exitCode===null?'other':'process-exit',exitCode};
}
export type KiloVersionExecutor=(launch:IsolatedQualityLaunch)=>Promise<string>;
const execute:KiloVersionExecutor=async launch=>{
  const result=await exec(launch.binary,launch.args,{
    cwd:launch.cwd,encoding:'utf8',windowsHide:true,shell:false,
    timeout:10000,maxBuffer:32*1024,env:{PATH:'/usr/bin:/bin',LANG:'C'},
  });
  return result.stdout;
};

export interface KiloInstallation {
  /** Canonical executable path determined from PATH; never renderer input. */
  binary: string;
}

/** Electron desktop sessions can have a different PATH than interactive
 * shells. Search PATH first, then a SMALL fixed set of per-user npm bin
 * locations. The fallback accepts ONLY a verified @kilocode/cli package,
 * never arbitrary home executables or a caller-controlled repository path.
 * Discovery executes no CLI, shell or npm configuration.
 */
export function discoverKiloInstallation(
  envPath:string|undefined=process.env.PATH,
  home:string=os.homedir(),
):KiloInstallation|null{
  const fromPath=(envPath??'').split(path.delimiter)
    .filter(dir=>dir.length>0 && path.isAbsolute(dir));
  const fallback=path.isAbsolute(home) ? [
    path.join(home,'.local','npm','bin'),
    path.join(home,'.npm-global','bin'),
    path.join(home,'.local','bin'),
  ] : [];
  const visited=new Set<string>();
  for(const dir of [...fromPath,...fallback]){
    if(visited.has(dir))continue;
    visited.add(dir);
    const candidate=path.join(dir,'kilo');
    try {
      const binary=fs.realpathSync(candidate);
      const stat=fs.statSync(binary);
      if(!stat.isFile())continue;
      fs.accessSync(binary,fs.constants.X_OK);
      if(fallback.includes(dir) && classifyKiloPlacement(binary).kind!=='package')
        continue;
      return {binary};
    }catch {/* not an executable or not a verified npm package */}
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
/** Offline CLI capability test only. The sandbox receives either /usr, one verified Kilo npm
 * package (read-only), or a COPY of one standalone executable (read-only).
 * It never receives the host HOME, credentials, runtime sockets or network.
 */
export async function probeOfflineKiloRuntime(
  executor:KiloVersionExecutor=execute,
  lookup:()=>string|null=()=>discoverKiloInstallation()?.binary??null,
):Promise<OfflineKiloProbeResult>{
  const fail=(reason:OfflineKiloProbeResult['reason'],stage:OfflineKiloStage|null=null,
    detail:OfflineKiloDetail|null=null,exitCode:number|null=null):OfflineKiloProbeResult=>
      ({passed:false,reason,stage,detail,exitCode});
  if(process.platform!=='linux')return fail('unsupported-platform');
  let executable:string|null;
  try{executable=lookup()}catch{return fail('cli-unavailable','prepare');}
  if(executable===null)return fail('cli-unavailable','prepare');
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'autodev-kilo-runtime-'));
  let stage:OfflineKiloStage='prepare';
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
      return fail('sandbox-failed','prepare');
    const args=launch.args.slice(0,separator);
    if(source)args.push('--dir','/opt','--ro-bind',source,'/opt/kilo');
    // Fixed, offline commands only. No model request, credentials or --auto.
    for(const [part,command] of [
      ['version',['--version']],
      ['help',['run','--help']],
    ] as const){
      stage=part;
      let output:string;
      try{output=await executor({...launch,args:[...args,'--',placement.executable,...command]});}
      catch(error){return {...fail('sandbox-failed',stage),...classifyOfflineKiloError(error)};}
      if(typeof output!=='string'||!output.trim()||
        Buffer.byteLength(output,'utf8')>(stage==='version'?4096:32*1024)||
        (stage==='help'&&(!output.includes('--model')||!output.includes('--agent'))))
        return fail('invalid-output',stage);
    }
    return {passed:true,reason:'passed',stage:null,detail:null,exitCode:null};
  }catch(error){
    return {...fail('sandbox-failed',stage),...classifyOfflineKiloError(error)};
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
}
