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
  issues:[],
  issueStatusPreviews:[],
  issueQueue:{previewOnly:true,executionEnabled:false,readyToStart:false,nextIssueNumber:null,
    reason:'No eligible open issues',queue:[]},
  studioStatus:{git:{root:project.path,branch:'main',head:'a'.repeat(40),
    remoteSlug:null,clean:true,canExecute:false,reasons:[]},
    lock:{held:false,startedAt:null},checkpoint:null,
    recovery:{state:'none',identityMatches:null,reason:'Kein gespeicherter Issue-Lauf',automaticResume:false},
    executionEnabled:false},
  diagnostics:{kiloInstalled:true,kiloVersion:'7.8.27',supportedFlags:['--model','--agent'],
    kiloRunCommandReady:true,agentCatalogReadable:true,agentCatalogProblem:null,
    sandboxTool:'bwrap',sandboxToolAvailable:true,ghInstalled:true,ghAuthenticated:true,
    checkedAt:'2026-01-01'},
  studioActivity:{busy:false,kind:null,projectId:null,issueNumber:null},
  learningBook:{repository:'example/studio',head:'a'.repeat(40),lessons:1,page:1,hasMore:true,
    bookMarkdown:'# Programmieren verstehen\n\n## Java: Generics\nEinfach erklärt',
    solutionsMarkdown:'# Musterlösungen',reportsMarkdown:'# Quellen'},
  publicRepoHistory:{repository:'example/studio',defaultBranch:'main',page:1,hasMore:true,
    fixedHead:'a'.repeat(40),licenseSpdx:'MIT',readOnly:true,requiresInterpretation:true,
    commits:[{sha:'b'.repeat(40),title:'feat: introduce typed list',
      committedAt:'2026-11-01T10:00:00Z',changedPaths:['src/list.ts'],
      pathsComplete:true,evidenceUrl:'https://github.com/example/studio/commit/'+'b'.repeat(40)}]},
  branchProtection:{protected:true,evidence:{repository:'example/studio',branch:'main',rulesetId:111,requiredChecks:['typecheck'],verifiedAt:'2026-11-22T00:00:00.000Z'}},
  sandboxProbe:{available:true,isolated:true,reason:'passed',detail:null,exitCode:0},
  reviewerProbe:{supported:true,passed:true,reason:'passed',detail:null},
  qualityProbe:{supported:true,passed:true,reason:'passed',stage:null,detail:null,exitCode:null},
  qualityScriptProbe:{passed:true,reason:'passed'},
  fullPipelineProbe:{passed:true,reason:'passed'},
  offlineKiloProbe:{passed:true,reason:'passed',stage:null,detail:null,exitCode:null},
  offlineReviewerProbe:{passed:true,reason:'passed',stage:null,detail:null,exitCode:null},
  localModelProbe:{passed:true,reason:'passed'},
  reviewerCalibration:{passed:true,reason:'passed'},
  ollamaReadiness:{ready:true,reason:'ready'},
  kiloRoleModels:null,
  kiloReviewerCalibration:{passed:true,reason:'passed'},
  localReviewFallback:false,
  freeRoutePreview:{previewOnly:true,executionEnabled:false,ollamaReady:true,
    localFallbackEnabled:true,roles:[
      {role:'planner',preferredModel:'kilo-auto/free',route:'paused',model:null,reason:'kilo-quota-unverified'},
      {role:'builder',preferredModel:'kilo-auto/free',route:'paused',model:null,reason:'kilo-quota-unverified'},
      {role:'reviewer',preferredModel:'kilo-auto/free',route:'ollama-candidate',model:'qwen2.5-coder:3b',reason:'candidate-only'}]},
  freeRunReadiness:{roles:[
    {role:'planner',model:'nvidia/nemotron-3-ultra-550b-a55b:free',reason:'remaining-unknown'},
    {role:'builder',model:'nvidia/nemotron-3-ultra-550b-a55b:free',reason:'remaining-unknown'},
    {role:'reviewer',model:'kilo-auto/free',reason:'remaining-unknown'}],
    modelAndQuotaReady:false,executionEnabled:false,countedLocally:2,remainingVerified:null},
  kiloFreeUsage:{source:'local-observation',limit:200,reserve:10,usedLocal:2,remainingVerified:null,resetAt:null,blockedBy429:false,observedAt:1},
  saveKiloRoleModels:null,
  kiloFreeModels:{checkedAt:'2026-11-21T00:00:00.000Z',models:[
    {id:'nvidia/nemotron-3-ultra-550b-a55b:free',name:'NVIDIA Nemotron 3 Ultra',preferred:true},
    {id:'kilo-auto/free',name:'Auto Free',preferred:false}]},
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
      onIssueProgress:()=>()=>{},
      snapshot:async()=>({currentIssue:null,reviewIteration:0,processedIssues:[],failedIssues:[],
        checkpoint:null,hasState:false,updatedAt:null}),
      studioActivity:()=>respond('studioActivity'),
      studioStatus:()=>respond('studioStatus'),
      history:async()=>[],
      diagnostics:()=>respond('diagnostics'),
      sandboxProbe:()=>respond('sandboxProbe'),
      reviewerProbe:()=>respond('reviewerProbe'),
      qualityProbe:()=>respond('qualityProbe'),
      qualityScriptProbe:()=>respond('qualityScriptProbe'),
      fullPipelineProbe:()=>respond('fullPipelineProbe'),
      offlineKiloProbe:()=>respond('offlineKiloProbe'),
      offlineReviewerProbe:()=>respond('offlineReviewerProbe'),
      localModelProbe:()=>respond('localModelProbe'),
      reviewerCalibration:()=>respond('reviewerCalibration'),
      ollamaReadiness:()=>respond('ollamaReadiness'),
      kiloFreeModels:()=>respond('kiloFreeModels'),
      kiloRoleModels:()=>respond('kiloRoleModels'),
      kiloReviewerCalibrate:()=>respond('kiloReviewerCalibration'),
      freeRunReadiness:()=>respond('freeRunReadiness'),
      localReviewFallback:()=>respond('localReviewFallback'),
      setLocalReviewFallback:async(_id,enabled)=>{calls.push('setLocalReviewFallback');return enabled;},
      freeRoutePreview:()=>respond('freeRoutePreview'),
      kiloFreeUsage:()=>respond('kiloFreeUsage'),
      saveKiloRoleModels:async(_id,roles)=>{calls.push('saveKiloRoleModels');return structuredClone(roles);},
      addProject:async()=>null,removeProject:async()=>true,
      gitPreflight:async()=>({root:project.path,branch:'main',head:'a'.repeat(40),
        remoteSlug:null,clean:true,canExecute:false,reasons:[]}),
      issues:()=>respond('issues'),issueQueue:()=>respond('issueQueue'),
      issueStatusPreviews:()=>respond('issueStatusPreviews'),
      installIssueLabels:async()=>({repository:'example/studio',protectedBranch:'main',created:['status:ready'],alreadyPresent:[],total:16}),
      publicRepoHistory:()=>respond('publicRepoHistory'),
      generateLearningBook:()=>respond('learningBook'),
      loadLearningBook:()=>respond('learningBook'),
      exportLearningBook:async()=>({exported:true}),
      branchProtection:()=>respond('branchProtection'),
      workflowStages:async()=>[],simulateIssue:async()=>null,
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
      'Kilo-Laufzeit testen':'offlineKiloProbe','Reviewer-Sandbox testen':'offlineReviewerProbe',
      'Lokales Review-Modell testen':'localModelProbe',
      'Reviewer kalibrieren (2 Modellanfragen)':'reviewerCalibration',
      'Ollama-Verbindung prüfen':'ollamaReadiness',
      'Free-Modelle laden':'kiloFreeModels',
      'Kilo-Free-Reviewer kalibrieren':'kiloReviewerCalibration',
      'Kilo-Requests anzeigen':'kiloFreeUsage',
      'Modell-/Kontingentbereitschaft prüfen':'freeRunReadiness',
      'Provider-Fallback simulieren':'freeRoutePreview'})[name]);
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
  await page.getByRole('button',{name:'Übersicht',exact:true}).click();
  await page.getByText('Wiederaufnahme: Keine Wiederaufnahme nötig',{exact:false}).waitFor();
  await page.getByRole('button',{name:'Agenten',exact:true}).click();
  await page.evaluate(()=>{
    window.__uiSmoke.overrides.studioActivity={
      busy:true,kind:'issue-review',projectId:'fixture-other',issueNumber:5};
  });
  await page.getByRole('button',{name:'Issues',exact:true}).click();
  await page.getByText('Studio-Prozess belegt',{exact:true}).waitFor();
  await page.getByText('anderes Projekt',{exact:false}).first().waitFor();
  await page.evaluate(()=>{
    window.__uiSmoke.overrides.issues=[{
      number:5,title:'Core integration',body:'Tracking only',
      url:'https://github.com/example/studio/issues/5',
      labels:['priority:p1','status:blocked'],
    }];
    window.__uiSmoke.overrides.issueQueue={
      previewOnly:true,executionEnabled:false,readyToStart:false,
      nextIssueNumber:null,reason:'No eligible open issues',
      queue:[{number:5,title:'Core integration',priority:1,state:'held',
        reason:'Issue status is status:blocked; manual triage or recovery required',
        triage:{source:'github-labels',evidence:['Explicit GitHub priority: P1',
          'Workflow: status:blocked'],dependencyIssues:[],proposalOnly:true,
          confidence:'limited'}}],
    };
  });
  await page.getByRole('button',{name:'Aktualisieren',exact:true}).click();
  await page.getByText('BLOCKED – Issue gesperrt',{exact:true}).waitFor();
  await page.evaluate(()=>{
    window.__uiSmoke.overrides.issueStatusPreviews=[{
      issueNumber:5,current:'status:blocked',proposed:null,
      allowed:false,provenance:'none',reason:'Blocked status requires an explicit recovery decision',
    }];
  });
  await page.getByRole('button',{name:'Aktualisieren',exact:true}).click();
  await page.getByText('Checkpoint → GitHub-Status (nur Vorschau)',{exact:true}).waitFor();
  await page.getByText('Blocked status requires an explicit recovery decision',{exact:true}).waitFor();
  await page.getByText('Priorisierung: P1 · zurückgestellt · Begründung').click();
  await page.getByText('Explicit GitHub priority: P1',{exact:true}).waitFor();
  await page.getByText('Sperrgrund:',{exact:false}).first().waitFor();
  await page.getByText('Das Label enthält keinen konkreten technischen Fehlergrund',{exact:false}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Issue → Draft-PR'}).isDisabled(),true);
  await page.evaluate(()=>{
    window.__uiSmoke.overrides.studioStatus={
      git:{root:'/tmp/autodev-ui-fixture',branch:'autodev/issue-5',
        head:'a'.repeat(40),remoteSlug:null,clean:false,canExecute:false,reasons:[]},
      lock:{held:false,startedAt:null},
      checkpoint:{issueNumber:5,stage:'blocked',revision:3,savedAt:'2026-11-22T12:00:00Z',
        reviewPassed:false,qualityPassed:false},
      recovery:{state:'manual',identityMatches:null,
        reason:'Workflow wurde als BLOCKED gespeichert. Der konkrete ursprüngliche Fehler ist im Checkpoint nicht enthalten.',
        automaticResume:false},
      executionEnabled:false,
    };
  });
  await page.getByRole('button',{name:'Aktualisieren',exact:true}).click();
  await page.getByText('CHECKPOINT / PROJEKTSPERRE',{exact:false}).waitFor();
  await page.getByText('Der konkrete ursprüngliche Fehler ist im Checkpoint nicht enthalten',{exact:false}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Issue → Draft-PR'}).isDisabled(),true);
  await page.evaluate(()=>{
    delete window.__uiSmoke.overrides.studioStatus;
    delete window.__uiSmoke.overrides.studioActivity;
    delete window.__uiSmoke.overrides.issues;
    delete window.__uiSmoke.overrides.issueQueue;
    delete window.__uiSmoke.overrides.issueStatusPreviews;
  });
  await page.getByRole('button',{name:'Aktualisieren',exact:true}).click();
  await page.getByRole('button',{name:'Fehlende GitHub-Labels einrichten'}).waitFor();
  await page.getByRole('button',{name:'Fehlende GitHub-Labels einrichten'}).click();
  await page.getByText('1 fehlende Labels in example/studio angelegt.',{exact:false}).waitFor();
  await page.getByRole('button',{name:'Lehrbuch',exact:true}).click();
  await page.getByPlaceholder('owner/repo oder https://github.com/owner/repo').fill('example/studio');
  await page.getByRole('button',{name:'Historie lesen',exact:true}).click();
  await page.getByText('feat: introduce typed list',{exact:true}).waitFor();
  await page.getByText('Quellenindex, noch kein fertiges Lehrbuch',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Lehrbuch erstellen'}).click();
  await page.getByText('Dein Lehrbuch – example/studio',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Weitere 12 Commits analysieren'}).click();
  await page.getByText('Weitere Commits geprüft.',{exact:false}).waitFor();
  await page.getByRole('button',{name:'Lehrbuch als PDF'}).click();
  await page.getByText('Export erfolgreich gespeichert.',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Agenten',exact:true}).click();
  await page.getByRole('button',{name:'Sandbox testen',exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Sandbox testen',exact:true}).isDisabled(),true);
  // Real local inference is self-contained: its button MUST be available
  // without re-clicking all seven independent sandbox readiness probes.
  const localModelButton=page.getByRole('button',{name:'Lokales Review-Modell testen',exact:true});
  assert.equal(await localModelButton.isVisible(),true);
  assert.equal(await localModelButton.isEnabled(),true);
  await click(page,'Kilo-Requests anzeigen');
  await page.getByText('2 von 200 lokal erfassten Gateway-Versuchen',{exact:false}).waitFor();
  await page.getByText('tatsächliches IP-Restkontingent unbekannt',{exact:false}).waitFor();
  await click(page,'Free-Modelle laden');
  await page.locator('strong').filter({hasText:'NVIDIA Nemotron 3 Ultra'}).first().waitFor();
  await page.getByLabel('Modell für reviewer').selectOption('kilo-auto/free');
  await page.getByRole('button',{name:'Rollenzuordnung speichern'}).click();
  await page.getByText('Rollenzuordnung gespeichert',{exact:false}).waitFor();
  const localChoice=page.getByRole('checkbox',{name:'Lokalen Ollama-Reviewer als Fallback zulassen',exact:false});
  assert.equal(await localChoice.isChecked(),false);
  await localChoice.check();
  await page.waitForFunction(()=>window.__uiSmoke.calls.includes('setLocalReviewFallback'));
  assert.equal(await localChoice.isChecked(),true);
  await click(page,'Provider-Fallback simulieren');
  await page.getByText('Lokaler Reviewer wäre ein Fallback-Kandidat',{exact:false}).waitFor();
  await page.getByText('Nur Simulation. Auch ein lokaler Kandidat',{exact:false}).waitFor();
  await click(page,'Modell-/Kontingentbereitschaft prüfen');
  assert.equal(await page.getByText('Echte Kilo-Restquote nicht verfügbar',{exact:false}).count(),3);
  await page.getByText('Produktive Ausführung weiterhin gesperrt',{exact:false}).waitFor();
  await click(page,'Kilo-Free-Reviewer kalibrieren');
  await page.getByText('Kilo-Reviewer hat zwei synthetische PASS/FAIL-Fälle richtig erkannt',{exact:false}).waitFor();
  await page.evaluate(()=>{
    window.__uiSmoke.overrides.kiloReviewerCalibration={passed:false,reason:'rate-limit',caseNumber:1};
  });
  await click(page,'Kilo-Free-Reviewer kalibrieren');
  await page.getByText('Kilo-Free-Limit erreicht (HTTP 429)',{exact:false}).waitFor();
  assert.equal(await page.getByLabel('Modell für builder').inputValue(),'nvidia/nemotron-3-ultra-550b-a55b:free');
  // Agent role dropdowns must never overflow into the second model card column.
  const geometry=await page.evaluate(()=>{
    const panel=document.querySelector('.role-assignment-panel');
    const catalog=document.querySelector('[aria-label="Kostenlose Kilo-Modelle"]');
    const view=document.querySelector('.agents');
    return {panelWidth:panel.getBoundingClientRect().width,
      catalogWidth:catalog.getBoundingClientRect().width,
      overflow:view.scrollWidth>view.clientWidth+1,
      allSelectorsInside:[...panel.querySelectorAll('select')].every(node=>
        node.getBoundingClientRect().right<=panel.getBoundingClientRect().right+1)};
  });
  assert.equal(geometry.overflow,false,'Agent view must not scroll horizontally');
  assert.ok(geometry.panelWidth>=geometry.catalogWidth-2,'Role settings span catalog width');
  assert.equal(geometry.allSelectorsInside,true,'All role dropdowns fit their container');

  assert.equal(await page.getByText('nvidia/nemotron-3-ultra-550b-a55b:free',{exact:true}).count(),1);
  await click(page,'Ollama-Verbindung prüfen');
  await page.getByText('Ollama erreichbar · qwen2.5-coder:3b installiert',{exact:false}).waitFor();
  await click(page,'Lokales Review-Modell testen');
  await page.getByText('Ollama-Modell antwortet strukturiert',{exact:false}).waitFor();
  const calibrationButton=page.getByRole('button',{name:'Reviewer kalibrieren (2 Modellanfragen)',exact:true});
  assert.equal(await calibrationButton.isEnabled(),true);
  await click(page,'Reviewer kalibrieren (2 Modellanfragen)');
  await page.getByText('Zwei künstliche Fälle korrekt',{exact:false}).waitFor();
  await fullChain(page);
  for(const sentence of [
    'Schreibschutz und Start in Testumgebung bestätigt',
    'Git-Prozess isoliert gestartet','npm in isolierter Testumgebung gestartet',
    'Testskript isoliert ausgeführt','Lokaler Trockenlauf erfolgreich',
    'Kilo-Version und Run-Aufrufsyntax offline geprüft','Reviewer-CLI isoliert',
    'Ollama-Modell antwortet strukturiert',
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
  // The model call is deliberate, not on page load or workspace selection.
  await page.evaluate(()=>{
    window.__uiSmoke.overrides.localModelProbe={passed:false,reason:'invalid-verdict'};
  });
  await click(page,'Lokales Review-Modell testen');
  await page.getByText('Modellantwort entspricht noch nicht dem Reviewer-Format',{exact:false}).waitFor();
  await page.evaluate(()=>{
    window.__uiSmoke.overrides.reviewerCalibration={passed:false,reason:'wrong-verdict'};
  });
  await click(page,'Reviewer kalibrieren (2 Modellanfragen)');
  await page.getByText('Modell hat mindestens einen Fall falsch bewertet',{exact:false}).waitFor();
  await page.evaluate(()=>{
    window.__uiSmoke.overrides.reviewerCalibration={passed:false,reason:'timeout',caseNumber:1};
  });
  await click(page,'Reviewer kalibrieren (2 Modellanfragen)');
  await page.getByText('Ollama-Zeitlimit erreicht',{exact:false}).waitFor();
  await page.evaluate(()=>{
    window.__uiSmoke.overrides.reviewerCalibration={passed:false,reason:'model-unavailable',caseNumber:1};
  });
  await click(page,'Reviewer kalibrieren (2 Modellanfragen)');
  await page.getByText('Ollama hat die Modellanfrage abgelehnt',{exact:false}).waitFor();
  await page.evaluate(()=>{
    window.__uiSmoke.overrides.reviewerCalibration={passed:false,reason:'transport-failed',caseNumber:1};
  });
  await click(page,'Reviewer kalibrieren (2 Modellanfragen)');
  await page.getByText('Ollama-Verbindung oder HTTP-Antwort fehlgeschlagen',{exact:false}).waitFor();
  await page.evaluate(()=>{
    window.__uiSmoke.overrides.reviewerCalibration={passed:false,reason:'invalid-response',caseNumber:2};
  });
  await click(page,'Reviewer kalibrieren (2 Modellanfragen)');
  await page.getByText('Modellantwort nicht im geforderten Reviewer-JSON-Format (Testfall 2/2)',{exact:false}).waitFor();
  await page.evaluate(()=>{
    window.__uiSmoke.overrides.ollamaReadiness={ready:false,reason:'model-missing'};
  });
  await click(page,'Ollama-Verbindung prüfen');
  await page.getByText('Ollama erreichbar, aber qwen2.5-coder:3b fehlt',{exact:false}).waitFor();
  await page.evaluate(()=>{
    window.__uiSmoke.overrides.ollamaReadiness={ready:false,reason:'unreachable'};
  });
  await click(page,'Ollama-Verbindung prüfen');
  await page.getByText('Ollama auf 127.0.0.1:11434 nicht erreichbar',{exact:false}).waitFor();
  await page.evaluate(()=>{
    window.__uiSmoke.overrides.kiloFreeModels=new Error('network');
  });
  await click(page,'Free-Modelle laden');
  await page.getByText('Kilo-Modellkatalog derzeit nicht erreichbar',{exact:false}).waitFor();
  // Switching projects resets all probe state and does not carry PASS badges across projects.
  await page.getByRole('button',{name:/another-repo/}).click();
  await page.getByRole('button',{name:'Agenten',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'Reviewer-Sandbox testen'}).count(),0);
  assert.equal(await page.getByRole('button',{name:'Sandbox testen'}).isDisabled(),true);
  assert.equal(await page.getByText('Kalibrierung fehlgeschlagen',{exact:false}).count(),0);
  assert.deepEqual(errors,[]);
  console.log('PASS: real React clicks, IPC mocks, stages, failures, project reset and no legacy run');
}finally{
  await browser?.close();
  await server.close();
}
