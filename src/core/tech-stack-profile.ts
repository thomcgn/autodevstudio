import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {selectSafeQualityScripts} from './safe-quality-scripts.ts';

export type StackKind=
 'typescript-electron-react'|'typescript-react'|'typescript-node'|
 'javascript'|'java-spring'|'java'|'mixed'|'unknown';
export interface StackEvidence {
 file:string;sha256:string;bytes:number;
}
export interface TechStackProfile {
 schemaVersion:1;kind:StackKind;languages:readonly string[];
 frameworks:readonly string[];packageManager:string|null;
 toolchain:Record<string,string>;strictTypechecking:boolean;
 qualityScripts:readonly string[];evidence:readonly StackEvidence[];
 blockers:readonly string[];canDevelop:boolean;
}
function readVerified(root:string,filename:string,maxBytes:number):string|null{
 const full=path.join(root,filename);
 if(!fs.existsSync(full))return null;
 const stat=fs.lstatSync(full);
 if(!stat.isFile()||stat.isSymbolicLink()||stat.size>maxBytes)
  throw Error('Unsafe or oversized stack manifest: '+filename);
 return fs.readFileSync(full,'utf8');
}
function record(value:unknown):Record<string,unknown>|null {
 return value!==null&&typeof value==='object'&&!Array.isArray(value)
  ?value as Record<string,unknown>:null;
}
function parseJson(value:string,filename:string):Record<string,unknown>{
 try{
  const item:unknown=JSON.parse(value);
  const found=record(item);if(found)return found;
 }catch{/* Invalid JSON must fail closed. */}
 throw Error('Invalid stack configuration: '+filename);
}
function evidence(filename:string,content:string):StackEvidence{
 return {file:filename,sha256:createHash('sha256').update(content).digest('hex'),
  bytes:Buffer.byteLength(content,'utf8')};
}
function version(source:Record<string,unknown>,name:string):string|null{
 const dependencies=record(source.dependencies)??{};
 const devDependencies=record(source.devDependencies)??{};
 const v=dependencies[name]??devDependencies[name];
 return typeof v==='string'&&v.length<80?v:null;
}
/** Project evidence only. Never runs project scripts or scans unbounded source trees.
 * A profile is a fail-closed preflight, not an AI-derived guess from the README.
 */
export function detectTechStackProfile(projectPath:string):TechStackProfile{
 const root=fs.realpathSync(projectPath);
 if(!fs.statSync(root).isDirectory())throw Error('Invalid project directory');
 const source:StackEvidence[]=[];
 const read=(file:string,limit:number)=>{
  const raw=readVerified(root,file,limit);
  if(raw!==null)source.push(evidence(file,raw));
  return raw;
 };
 const packageText=read('package.json',256*1024);
 const tsText=read('tsconfig.json',128*1024);
 const lock=read('package-lock.json',16*1024*1024);
 const pnpm=read('pnpm-lock.yaml',16*1024*1024);
 const yarn=read('yarn.lock',16*1024*1024);
 const pom=read('pom.xml',2*1024*1024);
 const gradle=read('build.gradle',2*1024*1024)??read('build.gradle.kts',2*1024*1024);
 const manifest=packageText===null?null:parseJson(packageText,'package.json');
 const ts=tsText===null?null:parseJson(tsText,'tsconfig.json');
 const compiler=ts===null?null:record(ts.compilerOptions);
 const js=manifest!==null,java=pom!==null||gradle!==null;
 const strict=compiler?.strict===true&&manifest!==null&&version(manifest,'typescript')!==null;
 const react=manifest!==null&&version(manifest,'react')!==null;
 const electron=manifest!==null&&version(manifest,'electron')!==null;
 const spring=Boolean((pom&&/spring-boot-starter|spring-boot-maven-plugin/.test(pom))||
   (gradle&&/org\.springframework\.boot|spring-boot-starter/.test(gradle)));
 const kind:StackKind=js&&java?'mixed':java?(spring?'java-spring':'java'):
  js&&strict?(electron&&react?'typescript-electron-react':react?'typescript-react':'typescript-node'):
  js?'javascript':'unknown';
 const languages=[...(js?[strict?'TypeScript':'JavaScript']:[]),...(java?['Java']:[])];
 const frameworks=[...(react?['React']:[]),...(electron?['Electron']:[]),
   ...(spring?['Spring Boot']:[])];
 const blockers:string[]=[];
 const manager=lock?'npm':pnpm?'pnpm':yarn?'yarn':null;
 if(js&&!manager)blockers.push('No trusted package-manager lockfile');
 if([lock,pnpm,yarn].filter(Boolean).length>1)
  blockers.push('Conflicting package-manager lockfiles');
 if(js&&manager!=='npm')blockers.push('Quality runner for '+manager+' not verified');
 if(js&&!strict)blockers.push('TypeScript strict mode and compiler version not verified');
 if(java)blockers.push('Java build and test sandbox unavailable; do not run Node quality scripts');
 if(kind==='mixed')blockers.push('Mixed stack requires explicit independent quality runners');
 if(kind==='unknown')blockers.push('Unknown stack: no verified compiler or test contract');
 const toolchain:Record<string,string>={};
 if(manifest){
  for(const name of ['typescript','react','electron','vite','next','@playwright/test']){
   const v=version(manifest,name);if(v!==null)toolchain[name]=v;
  }
 }
 if(pom){
  const match=/<maven\.compiler\.release>\s*([0-9]+)\s*<\/maven\.compiler\.release>/.exec(pom);
  if(match)toolchain.java=match[1];
 }
 let scripts:string[]=[];
 if(js&&strict&&manager==='npm'){
  try{scripts=selectSafeQualityScripts(root);}
  catch(error){blockers.push(error instanceof Error?error.message:'Quality checks unavailable');}
 }
 const canDevelop=blockers.length===0&&kind.startsWith('typescript');
 return {schemaVersion:1,kind,languages,frameworks,packageManager:manager,
  toolchain,strictTypechecking:strict,qualityScripts:scripts,evidence:source,
  blockers,canDevelop};
}
export function assertSeniorStackPreflight(projectPath:string):TechStackProfile {
 const profile=detectTechStackProfile(projectPath);
 if(!profile.canDevelop||profile.qualityScripts.length<2)
  throw Error('Senior Engineering preflight blocked: '+profile.blockers.join('; '));
 return profile;
}
