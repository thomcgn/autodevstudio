import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const WARNING_PATTERNS=[
  /(?:^|\n)[^\n]*\b(?:DeprecationWarning|ExperimentalWarning|MODULE_TYPELESS_PACKAGE_JSON)\b/,
  /(?:^|\n)\s*(?:npm|pnpm|yarn)\s+(?:warn|WARN)\b/,
  /(?:^|\n)\s*(?:\([^)]*\)\s+)?(?:WARNING|WARN|Warning):\s/i,
  /(?:^|\n)\s*\[vite\]\s*(?:warn|warning)\b/i,
  /(?:^|\n)\s*(?:\[\d+\]\s+)?(?:deprecated|deprecation):\s/i,
  /(?:^|\n)\s*\(!\)\s+/,
];
export function findBuildWarnings(output){
  const text=output.replace(/\x1b\[[0-9;]*m/g,'');
  return text.split(/\r?\n/).filter(line=>
    WARNING_PATTERNS.some(regex=>regex.test('\n'+line)));
}

const root=path.resolve(import.meta.dirname,'..');
const which={
  typecheck:[process.execPath,['node_modules/typescript/bin/tsc','--noEmit']],
  policy:[process.execPath,['--experimental-strip-types','--test',
    ...fs.readdirSync(path.join(root,'tests'))
      .filter(file=>file.endsWith('.test.mjs')).sort()
      .map(file=>'tests/'+file)]],
  package:[process.execPath,['node_modules/.bin/electron-forge','package']],
  ui:[process.execPath,['tests/ui-smoke.mjs']],
  desktop:[process.execPath,['tests/electron-native-smoke.mjs']],
  install:['npm',['ci']],
  playwrightDependency:['npm',['install','--no-save','--package-lock=false','@playwright/test@1.65.1']],
  playwrightBrowser:[process.execPath,['node_modules/.bin/playwright','install','--with-deps','chromium']],
};
async function main(){
 const command=process.argv[2];
 if(!Object.hasOwn(which,command)){
   process.stderr.write('Usage: node scripts/strict-check.mjs typecheck|policy|package|ui|desktop|install|playwrightDependency|playwrightBrowser\n');
   process.exitCode=2;return;
 }
 const [binary,args]=which[command];
 const child=spawn(binary,args,{cwd:root,env:{...process.env,NODE_OPTIONS:
   [process.env.NODE_OPTIONS,'--throw-deprecation'].filter(Boolean).join(' ')},
   stdio:['inherit','pipe','pipe'],shell:false});
 const output=[];
 let length=0;
 let truncated=false;
 const relay=(part,target)=>{
   part.on('data',chunk=>{
     target.write(chunk);
     if(!truncated){
       output.push(chunk.toString('utf8'));
       length+=chunk.length;
       if(length>4_000_000)truncated=true;
     }
   });
 };
 relay(child.stdout,process.stdout);
 relay(child.stderr,process.stderr);
 const status=await new Promise((resolve,reject)=>{
   child.once('error',reject);
   child.once('close',(code,signal)=>resolve({code,signal}));
 });
 const warnings=findBuildWarnings(output.join(''));
 if(truncated||warnings.length){
   process.stderr.write('\nSTRICT ZERO-WARNING GATE FAILED'+(truncated?' (log output exceeded limit)':'')+'\n');
   for(const w of warnings.slice(0,20))process.stderr.write(w+'\n');
   process.exitCode=1;
 }else if(status.code!==0){
   process.exitCode=status.code??1;
 }
}
if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(import.meta.filename))
  main().catch(error=>{process.stderr.write(String(error)+'\n');process.exitCode=1});
