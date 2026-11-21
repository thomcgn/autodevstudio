// Browser-level smoke tests for the ACTUAL React UI, modeled on LaceFrame.
// No host projects, Kilo provider, Bubblewrap, IPC, GitHub, or model calls.
// Preload's window.studio boundary is replaced before React loads.
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

const server=await createServer({
  configFile:'vite.renderer.config.ts',
  server:{host:'127.0.0.1',port:0,strictPort:false},
  clearScreen:false,
  logLevel:'error',
});
let browser;
const errors=[];
const project={id:'fixture-repo',name:'autodev-studio',path:'/tmp/autodev-ui-fixture',
  isGitRepo:true,hasCore:false};
const secondary={id:'fixture-other',name:'another-repo',path:'/tmp/another-ui-fixture',
  isGitRepo:true,hasCore:false};
const success={
  diagnostics:{kiloInstalled:true,kiloVersion:'7.8.27',supportedFlags:['--model','--agent'],
    kiloRunCommandReady:true,agentCatalogReadable:true,agentCatalogProblem:null,
    sandboxTool:'bwrap',sandboxToolAvailable:true,ghInstalled:true,ghAuthenticated:true,
    checkedAt:'2026-01-01'},
  sandboxProbe:{available:true,isolated:true,reason:'passed',detail:null,exitCode:0},
  reviewerProbe:{supported:true,passed:true,reason:'passed',detail:null},
  qualityProbe:{supported:true,passed:true,reason:'passed',stage:null,detail:null,exitCode:null},
  qualityScriptProbe:{passed:true,reason:'passed'},
  fullPipelineProbe:{passed:true,reason:'passed'},
  offlineKiloProbe:{passed:true,reason:'passed',stage:null,detail:null,exitCode:null},
  offlineReviewerProbe:{passed:true,reason:'passed',stage:null,detail:null,exitCode:null},
};
const names=[
  'Sandbox testen','Reviewer-Tool testen','Quality-Sandbox testen',
  'Quality-Skript testen','Gesamtworkflow testen','Kilo-Laufzeit testen',
  'Reviewer-Sandbox testen',
];
async function fixture(page){
  await page.addInitScript(({project,secondary,success})=>{
    const calls=[];
    const overrides={};
    window.__uiSmoke={calls,overrides};
    const respond=async key=>{
      calls.push(key);
      const value=Object.prototype.hasOwnProperty.call(overrides,key)?overrides[key]:success[key];
      if(value instanceof Error)throw value;
      return structuredClone(value);
    };
    window.studio={
      projects:async()=>[project,secondary],
      runInfo:async()=>null,
      onEvent:()=>()=>{},
      snapshot:async()=>({currentIssue:null,reviewIteration:0,processedIssues:[],failedIssues:[],
        checkpoint:null,hasState:false,updatedAt:null}),
      studioStatus:async()=>({git:{root:project.path,branch:'main',head:'a'.repeat(40),
          remoteSlug:null,clean:true,canExecute:false,reasons:[]},
        lock:{held:false,startedAt:null},checkpoint:null,executionEnabled:false}),
      history:async()=>[],
      diagnostics:()=>respond('diagnostics'),
      sandboxProbe:()=>respond('sandboxProbe'),
      reviewerProbe:()=>respond('reviewerProbe'),
      qualityProbe:()=>respond('qualityProbe'),
      qualityScriptProbe:()=>respond('qualityScriptProbe'),
      fullPipelineProbe:()=>respond('fullPipelineProbe'),
      offlineKiloProbe:()=>respond('offlineKiloProbe'),
      offlineReviewerProbe:()=>respond('offlineReviewerProbe'),
      addProject:async()=>null,removeProject:async()=>true,
      gitPreflight:async()=>({root:project.path,branch:'main',head:'a'.repeat(40),
        remoteSlug:null,clean:true,canExecute:false,reasons:[]}),
      issues:async()=>[],workflowStages:async()=>[],simulateIssue:async()=>null,
      historyLog:async()=>'',runInfo:async()=>null,start:async()=>{throw Error('not authorized');},
      stop:async()=>false,active:async()=>false,
    };
  },{project,secondary,success});
  await page.goto('http://127.0.0.1:'+server.httpServer.address().port);
  await page.getByRole('button',{name:'Agenten',exact:true}).click();
  await page.getByRole('heading',{name:'Agentensteuerung'}).waitFor();
}
async function click(page,name){
  const button=page.getByRole('button',{name,exact:true});
  await button.waitFor();
  assert.equal(await button.isEnabled(),true,name+' must be enabled');
  await button.click();
  await page.waitForFunction(key=>window.__uiSmoke.calls.includes(key),
    ({'Umgebung prüfen':'diagnostics','Sandbox testen':'sandboxProbe',
      'Reviewer-Tool testen':'reviewerProbe','Quality-Sandbox testen':'qualityProbe',
      'Quality-Skript testen':'qualityScriptProbe','Gesamtworkflow testen':'fullPipelineProbe',
      'Kilo-Laufzeit testen':'offlineKiloProbe','Reviewer-Sandbox testen':'offlineReviewerProbe'})[name]);
}
async function fullChain(page){
  await click(page,'Umgebung prüfen');
  for(const name of names)await click(page,name);
}
try {
  await server.listen();
  browser=await chromium.launch({headless:true});
  const context=await browser.newContext({viewport:{width:1160,height:780}});
  const page=await context.newPage();
  page.on('pageerror',error=>errors.push(error.message));
  await fixture(page);
  await page.getByRole('button',{name:'Sandbox testen',exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Sandbox testen',exact:true}).isDisabled(),true);
  await fullChain(page);
  for(const sentence of [
    'Schreibschutz und Start in Testumgebung bestätigt',
    'Git-Prozess isoliert gestartet','npm in isolierter Testumgebung gestartet',
    'Testskript isoliert ausgeführt','Lokaler Trockenlauf erfolgreich',
    'Kilo-Version und Run-Aufrufsyntax offline geprüft','Reviewer-CLI isoliert',
  ])assert.equal(await page.getByText(sentence,{exact:false}).count()>0,true,sentence);
  assert.equal(await page.getByText('Legacy-Agentenlauf').count(),0);
  // An invalid Kilo result must NOT make the independent reviewer button vanish.
  await page.evaluate(()=>{
    window.__uiSmoke.overrides.offlineKiloProbe={
      passed:false,reason:'sandbox-failed',stage:'help',detail:'process-exit',exitCode:254};
  });
  await click(page,'Kilo-Laufzeit testen');
  await page.getByText('Kilo: CLI-Hilfe fehlgeschlagen',{exact:false}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Reviewer-Sandbox testen'}).isVisible(),true);
  // Failure status is visible, sanitized and cannot silently enable production.
  await page.evaluate(()=>{
    window.__uiSmoke.overrides.offlineReviewerProbe={
      passed:false,reason:'sandbox-failed',stage:'policy',
      detail:'permission-or-config',exitCode:1};
  });
  await click(page,'Reviewer-Sandbox testen');
  await page.getByText('Reviewer-Sandbox: Reviewer-Konfiguration fehlgeschlagen',{exact:false}).waitFor();
  const text=await page.locator('body').innerText();
  assert.equal(text.includes('/home/tom/.local/npm'),false);
  // Switching projects resets all probe state and does not carry PASS badges across projects.
  await page.getByRole('button',{name:/another-repo/}).click();
  await page.getByRole('button',{name:'Agenten',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'Reviewer-Sandbox testen'}).count(),0);
  assert.equal(await page.getByRole('button',{name:'Sandbox testen'}).isDisabled(),true);
  assert.deepEqual(errors,[]);
  console.log('PASS: real React clicks, IPC mocks, stages, failures, project reset and no legacy run');
}finally{
  await browser?.close();
  await server.close();
}
