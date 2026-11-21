// Native Electron smoke based on LaceFrame's packaged-app Playwright tests.
// Launches a packaged, REAL Electron executable and interacts through real IPC.
// The only project is a disposable Git fixture; no models, agents or pushes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { _electron as electron } from '@playwright/test';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'autodev-native-smoke-'));
const project=path.join(root,'project');
fs.mkdirSync(project);
execFileSync('git',['init','-q'],{cwd:project,timeout:5000,
  env:{PATH:'/usr/bin:/bin',HOME:root,GIT_CONFIG_NOSYSTEM:'1'}});
const output=path.resolve('out');
function executable(){
  const dirs=fs.readdirSync(output,{withFileTypes:true})
    .filter(d=>d.isDirectory()&&d.name.endsWith('-linux-x64'));
  assert.equal(dirs.length,1,'Expected exactly one packaged Linux Electron app');
  const dir=path.join(output,dirs[0].name);
  // Electron ships multiple ELF helpers (crashpad, sandbox, etc.).
  // Only the application executable is a valid smoke-test target.
  for(const name of ['autodev-studio','AutoDev Studio']){
    const file=path.join(dir,name);
    if(fs.existsSync(file)&&fs.statSync(file).isFile()&&
      (fs.statSync(file).mode&0o111)!==0 &&
      fs.readFileSync(file).subarray(0,4).equals(Buffer.from([0x7f,0x45,0x4c,0x46])))
      return file;
  }
  throw new Error('Packaged app executable not found (helper binaries excluded)');
}
let app;
const pageErrors=[];
try{
  const env={...process.env};
  delete env.ELECTRON_RUN_AS_NODE;
  // Keep the app profile separate from all personal Kilo/GitHub data.
  app=await electron.launch({
    executablePath:executable(),
    args:['--user-data-dir='+path.join(root,'profile')],
    env:{...env,HOME:root,XDG_CONFIG_HOME:path.join(root,'config'),
      XDG_CACHE_HOME:path.join(root,'cache')},
  });
  let page=await app.firstWindow();
  page.on('pageerror',error=>pageErrors.push(error.message));
  await page.getByText('AutoDev Studio',{exact:false}).first().waitFor();
  const prefs=await app.evaluate(({BrowserWindow})=>{
    const window=BrowserWindow.getAllWindows()[0];
    return window.webContents.getLastWebPreferences();
  });
  assert.equal(prefs.contextIsolation,true);
  assert.equal(prefs.nodeIntegration,false);
  assert.equal(prefs.sandbox,true);
  const exposed=await page.evaluate(()=>({
    node:typeof window.require,
    bridge:typeof window.studio,
    invoke:typeof window.studio.projects,
  }));
  assert.deepEqual(exposed,{node:'undefined',bridge:'object',invoke:'function'});
  const userData=await app.evaluate(({app})=>app.getPath('userData'));
  assert.ok(userData.startsWith(root), 'The smoke must use an isolated profile');
  fs.mkdirSync(userData,{recursive:true});
  fs.writeFileSync(path.join(userData,'projects.json'),
    JSON.stringify([{id:'native-fixture',name:'Native Fixture',path:project}]),
    {mode:0o600});
  await page.reload();
  await page.getByRole('button',{name:/Native Fixture/}).waitFor();
  await page.getByRole('button',{name:'Agenten',exact:true}).click();
  await page.getByRole('heading',{name:'Agentensteuerung'}).waitFor();
  assert.equal(await page.getByText('Legacy-Agentenlauf').count(),0);
  assert.equal(await page.getByRole('button',{name:'Sandbox testen'}).isDisabled(),true);
  // Real main-process IPC, including authorization checks; no Kilo launched.
  const list=await page.evaluate(()=>window.studio.projects());
  assert.equal(list.length,1);
  assert.equal(list[0].path,project);
  const rejected=await page.evaluate(async()=>{
    try{await window.studio.offlineReviewerProbe('not-a-project');return false;}
    catch{return true;}
  });
  assert.equal(rejected,true,'Invalid project ID must be rejected in Main');
  // Calibration must reject unauthorized identifiers before touching Ollama.
  const calibrationRejected=await page.evaluate(async()=>{
    try{await window.studio.reviewerCalibration('not-a-project');return false;}
    catch{return true;}
  });
  assert.equal(calibrationRejected,true,'Calibration requires registered Git project ID');
  const ollamaRejected=await page.evaluate(async()=>{
    try{await window.studio.ollamaReadiness('not-a-project');return false;}
    catch{return true;}
  });
  assert.equal(ollamaRejected,true,'Ollama preflight requires registered Git project ID');
  const catalogRejected=await page.evaluate(async()=>{
    try{await window.studio.kiloFreeModels('not-a-project');return false;}
    catch{return true;}
  });
  assert.equal(catalogRejected,true,'Kilo catalog requires registered Git project ID');
  const roleReadRejected=await page.evaluate(async()=>{
    try{await window.studio.kiloRoleModels('not-a-project');return false;}
    catch{return true;}
  });
  assert.equal(roleReadRejected,true);
  const roleWriteRejected=await page.evaluate(async()=>{
    try{await window.studio.saveKiloRoleModels('not-a-project',{planner:'x',builder:'x',reviewer:'x'});return false;}
    catch{return true;}
  });
  assert.equal(roleWriteRejected,true);
  const kiloCalibrateRejected=await page.evaluate(async()=>{
    try{await window.studio.kiloReviewerCalibrate('not-a-project');return false;}
    catch{return true;}
  });
  assert.equal(kiloCalibrateRejected,true,'Cloud Kilo calibration requires registered Git project ID');
  const quotaRejected=await page.evaluate(async()=>{
    try{await window.studio.kiloFreeUsage('not-a-project');return false;}
    catch{return true;}
  });
  assert.equal(quotaRejected,true,'Kilo quota visibility requires registered project ID');
  const readinessRejected=await page.evaluate(async()=>{
    try{await window.studio.freeRunReadiness('not-a-project');return false;}
    catch{return true;}
  });
  assert.equal(readinessRejected,true,'Free run readiness requires registered Git project ID');
  assert.deepEqual(pageErrors,[]);
  console.log('PASS: packaged Electron, preload, IPC, sandbox preferences, fixture UI, authorization');
}finally{
  await app?.close();
  fs.rmSync(root,{recursive:true,force:true});
}
