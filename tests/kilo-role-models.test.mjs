import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {validateRoleModels,saveKiloRoles,loadKiloRoles} from '../src/core/kilo-role-models.ts';
const ultra='nvidia/nemotron-3-ultra-550b-a55b:free';
const other='kilo-auto/free';
const models=[{id:ultra,name:'Nemotron Ultra',preferred:true},{id:other,name:'Auto Free',preferred:false}];
const choices={planner:ultra,builder:ultra,reviewer:other};
test('roles accept only fresh verified catalog membership',()=>{
 assert.deepEqual(validateRoleModels(choices,models),choices);
 for(const input of [{...choices,builder:'premium/model'}, {...choices,reviewer:'not-listed:free'}, {...choices,extra:'x'}, {}])
   assert.throws(()=>validateRoleModels(input,models));
 assert.throws(()=>validateRoleModels(choices,[]));
});
test('project role settings persist exclusively under studio userData',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'autodev-kilo-roles-'));
 try{
  assert.equal(loadKiloRoles(root,'fixture-project'),null);
  assert.deepEqual(saveKiloRoles(root,'fixture-project',choices,models),choices);
  assert.deepEqual(loadKiloRoles(root,'fixture-project'),choices);
  assert.equal(loadKiloRoles(root,'other-project'),null);
  assert.ok(fs.existsSync(path.join(root,'kilo-roles','fixture-project.json')));
  assert.throws(()=>saveKiloRoles(root,'fixture-project',{...choices,builder:'paid/model'},models));
  assert.deepEqual(loadKiloRoles(root,'fixture-project'),choices);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('malformed persisted settings fail closed',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'autodev-kilo-roles-'));
 try{
  const dir=path.join(root,'kilo-roles');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir,'fixture-project.json'),'{oops');
  assert.equal(loadKiloRoles(root,'fixture-project'),null);
  assert.throws(()=>loadKiloRoles(root,'../escape'));
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
