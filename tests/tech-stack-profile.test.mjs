import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {detectTechStackProfile,assertSeniorStackPreflight} from '../src/core/tech-stack-profile.ts';

function fixture(files){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'autodev-techstack-'));
 for(const [name,content] of Object.entries(files)){
  fs.writeFileSync(path.join(root,name),content);
 }
 return {root,close:()=>fs.rmSync(root,{recursive:true,force:true})};
}
const packageJson=(deps,dev={},scripts={typecheck:'tsc --noEmit',test:'node --test'})=>
 JSON.stringify({dependencies:deps,devDependencies:dev,scripts});
const strict=JSON.stringify({compilerOptions:{strict:true,noEmit:true}});
test('typescript React and Electron with a lockfile and quality scripts is developer eligible',()=>{
 const f=fixture({
  'package.json':packageJson({react:'^19.2.0'},{
   typescript:'^5.9.0',electron:'^39.0.0'}),
  'tsconfig.json':strict,'package-lock.json':'{"lockfileVersion":3}',
 });
 try{
  const p=assertSeniorStackPreflight(f.root);
  assert.equal(p.kind,'typescript-electron-react');
  assert.equal(p.canDevelop,true);
  assert.deepEqual(p.qualityScripts,['typecheck','test']);
  assert.equal(p.evidence.every(x=>/^[0-9a-f]{64}$/.test(x.sha256)),true);
  assert.equal(p.toolchain.electron,'^39.0.0');
 }finally{f.close();}
});
test('typescript Node and React variants identified with direct config evidence',()=>{
 for(const deps of [{},{react:'^19.0.0'}]){
  const f=fixture({'package.json':packageJson(deps,{typescript:'^5.0.0'}),
   'tsconfig.json':strict,'package-lock.json':'{}'});
  try{
   const p=detectTechStackProfile(f.root);
   assert.equal(p.kind,deps.react?'typescript-react':'typescript-node');
   assert.equal(p.canDevelop,true);
  }finally{f.close();}
 }
});
test('Java Spring cannot accidentally pass the npm quality runner',()=>{
 const f=fixture({'pom.xml':'<project><properties><maven.compiler.release>21</maven.compiler.release></properties><dependency>spring-boot-starter-web</dependency></project>'});
 try{
  const p=detectTechStackProfile(f.root);
  assert.equal(p.kind,'java-spring');assert.equal(p.toolchain.java,'21');
  assert.equal(p.canDevelop,false);
  assert.throws(()=>assertSeniorStackPreflight(f.root),/Java build and test sandbox unavailable/);
 }finally{f.close();}
});
test('mixed Java and TypeScript require separate mandatory quality checks',()=>{
 const f=fixture({'package.json':packageJson({}, {typescript:'^5.0.0'}),
  'tsconfig.json':strict,'package-lock.json':'{}',
  'pom.xml':'<project><dependency>spring-boot-starter-web</dependency></project>'});
 try{
  const p=detectTechStackProfile(f.root);
  assert.equal(p.kind,'mixed');assert.equal(p.canDevelop,false);
 }finally{f.close();}
});
test('unknown JavaScript, weak type checking, missing lock or tests all fail closed',()=>{
 const candidates=[
  {'README.md':'# demo'},
  {'package.json':packageJson({}, {typescript:'^5.0.0'}),
   'tsconfig.json':JSON.stringify({compilerOptions:{strict:false}}),'package-lock.json':'{}'},
  {'package.json':packageJson({}, {typescript:'^5.0.0'}),'tsconfig.json':strict},
  {'package.json':packageJson({}, {typescript:'^5.0.0'}, {typecheck:'tsc'}),
   'tsconfig.json':strict,'package-lock.json':'{}'},
 ];
 for(const files of candidates){
  const f=fixture(files);
  try{
   assert.equal(detectTechStackProfile(f.root).canDevelop,false);
   assert.throws(()=>assertSeniorStackPreflight(f.root),/preflight blocked/);
  }finally{f.close();}
 }
});
test('conflicting lockfiles and symlinked manifests fail closed',()=>{
 const f=fixture({'package.json':packageJson({}, {typescript:'^5.0.0'}),
  'tsconfig.json':strict,'package-lock.json':'{}','pnpm-lock.yaml':'lock'});
 try{
  assert.equal(detectTechStackProfile(f.root).canDevelop,false);
  fs.unlinkSync(path.join(f.root,'tsconfig.json'));
  fs.symlinkSync('/etc/passwd',path.join(f.root,'tsconfig.json'));
  assert.throws(()=>detectTechStackProfile(f.root),/Unsafe or oversized stack manifest/);
 }finally{f.close();}
});

test('no-op typecheck and fake test scripts cannot qualify as quality gates',()=>{
 for(const scripts of [
  {typecheck:'echo PASS',test:'node --test'},
  {typecheck:'tsc --noCheck',test:'node --test'},
  {typecheck:'tsc --noEmit',test:'echo all good'},
  {typecheck:'tsc --noEmit || true',test:'node --test'},
  {typecheck:'tsc --noEmit',test:'vitest run --passWithNoTests'},
 ]){
  const f=fixture({'package.json':packageJson({}, {typescript:'^5.0.0'},scripts),
   'tsconfig.json':strict,'package-lock.json':'{}'});
  try{
   const p=detectTechStackProfile(f.root);
   assert.equal(p.canDevelop,false);
   assert.match(p.blockers.join(' '),/Quality script is not a recognized/);
  }finally{f.close();}
 }
});
