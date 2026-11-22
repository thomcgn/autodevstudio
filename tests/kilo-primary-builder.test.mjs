import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {FreeQuotaGuard} from '../src/core/free-quota-guard.ts';
import {createKiloPrimaryBuilder} from '../src/core/kilo-primary-builder.ts';
import {loadCoreCheckpoint} from '../src/core/checkpoint-store.ts';
import {createKiloArgs} from '../src/core/kilo-process.ts';

const models=[
 {id:'nvidia/nemotron-3-ultra-550b-a55b:free',name:'Nemotron',preferred:true},
 {id:'other/model:free',name:'Reviewer',preferred:false},
];
const roles={planner:models[0].id,builder:models[0].id,reviewer:models[1].id};
const issue={number:57,title:'Make greeting correct',
 body:'Return "Hello, world!" instead of "hi".'};
const marked=(value)=>'AUTODEV_JSON_BEGIN\n'+JSON.stringify(value)+'\nAUTODEV_JSON_END';
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'kilo-real-issue-'));
 const project=path.join(root,'project'),base=path.join(root,'studio');
 fs.mkdirSync(path.join(project,'src'),{recursive:true});
 fs.writeFileSync(path.join(project,'src','greet.ts'),
  'export const greet = () => "hi";\n');
 const git=(...args)=>execFileSync('git',args,{cwd:project,encoding:'utf8'}).trim();
 git('init','-b','main');
 git('config','user.name','Test');
 git('config','user.email','test@example.org');
 git('remote','add','origin','https://github.com/example/project.git');
 git('add','.');
 git('commit','-m','baseline');
 return {root,base,project,git,close:()=>fs.rmSync(root,{recursive:true,force:true})};
}
test('Kilo Planner+Builder generates REAL code on issue branch, with no CLI --auto and no Ollama',async()=>{
 const f=fixture();const calls=[];
 try {
  const invoke=async(input)=>{
   calls.push(input);
   assert.equal(input.autoApprove,false);
   assert.equal(input.agent,'plan');
   assert.equal(input.model,roles[input.role]);
   assert.notEqual(input.cwd,f.project,'Kilo must not run inside target worktree');
   assert.equal(fs.existsSync(input.cwd),true);
   const obj=input.role==='planner'
     ?{summary:'Fix greeting',steps:['Replace old greeting']}
     :input.prompt.includes('Choose exactly ONE relevant file')
       ?{path:'src/greet.ts'}
       :{search:'"hi"',replace:'"Hello, world!"'};
   return {output:marked(obj),sessionId:null,elapsedMs:3};
  };
  const quota=new FreeQuotaGuard(f.base);
  const start=f.git('rev-parse','HEAD');
  const result=await createKiloPrimaryBuilder(roles,models,quota,invoke)
   .build(f.base,f.project,issue);
  assert.equal(result.stage,'review');
  assert.equal(result.branch,'autodev/issue-57');
  assert.equal(result.changedFile,'src/greet.ts');
  assert.equal(f.git('rev-parse','HEAD'),start,'No commit before review');
  assert.equal(fs.readFileSync(path.join(f.project,'src','greet.ts'),'utf8'),
   'export const greet = () => "Hello, world!";\n');
  assert.equal(loadCoreCheckpoint(f.base,f.project).reviewPassed,false);
  assert.equal(quota.snapshot().usedLocal,3);
  assert.deepEqual(calls.map(c=>c.role),['planner','builder','builder']);
  assert.equal(calls.every(c=>!createKiloArgs(c).includes('--auto')),true);
  assert.equal(calls.every(c=>!fs.existsSync(c.cwd)),true,'Prompt temp dirs cleaned');
 }finally{f.close();}
});
test('invalid free model is rejected BEFORE invoking Kilo',async()=>{
 const f=fixture();let called=false;
 try{
  assert.throws(()=>createKiloPrimaryBuilder(
   {...roles,builder:'paid/model'},models,new FreeQuotaGuard(f.base),
   async()=>{called=true;throw Error('wrong')}),/verified free/);
  assert.equal(called,false);
 }finally{f.close();}
});
test('actual Kilo CLI HTTP 429 blocks future attempts and never switches models',async()=>{
 const f=fixture();let calls=0;
 try{
  const quota=new FreeQuotaGuard(f.base);
  const builder=createKiloPrimaryBuilder(roles,models,quota,async input=>{
   calls++;
   assert.equal(input.model,roles.planner);
   throw Error('Kilo Gateway HTTP 429 rate limit');
  });
  await assert.rejects(builder.build(f.base,f.project,issue),/429/);
  assert.equal(quota.snapshot().blockedBy429,true);
  await assert.rejects(builder.build(f.base,f.project,issue),/Quota checkpoint required/);
  assert.equal(calls,1);
  assert.equal(f.git('branch','--show-current'),'main');
 }finally{f.close();}
});
