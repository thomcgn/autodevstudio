import { app, BrowserWindow, dialog, ipcMain, screen } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { assertRunApproved, type RunMode } from './run-policy';
import { RunHistory } from './run-history';
import { inspectProject } from './project-capabilities';
import { listIssues } from '../core/issues';
import { previewIssueQueue, issueStartReadiness } from '../core/issue-queue-preview';
import { implementIssueLocally } from '../core/local-issue-to-code';
import { runIssueToDraftPr, defaultIssueAutomationDependencies } from '../core/issue-draft-orchestrator';
import { createKiloPrimaryBuilder } from '../core/kilo-primary-builder';
import { createKiloPrimaryReviewer,selectPrimaryKiloRoles } from '../core/kilo-primary-reviewer';
import { loadCoreCheckpoint } from '../core/checkpoint-store';
import {captureGitIdentity} from '../core/git-identity';
import {previewCheckpointIssueStatus} from '../core/issue-status-policy';
import { publishVerifiedDraftPullRequest } from '../core/verified-draft-pr';
import { verifyGeneratedIssue } from '../core/verify-generated-issue';
import { createAttestedProjectReviewerTransport } from '../core/attested-project-reviewer';
import {assertSeniorStackPreflight,detectTechStackProfile} from '../core/tech-stack-profile';
import { WORKFLOW_STAGES } from '../core/workflow';
import { orchestrateIssue, createSimulationAdapters } from '../core/orchestrator';
import { inspectGitPreflight } from '../core/git-preflight';
import { assertBranchProtection } from '../core/branch-protection';
import {installRequiredIssueLabels} from '../core/issue-label-onboarding';
import { inspectLocalProviders } from '../core/provider-diagnostics';
import { inspectStandaloneStatus } from '../core/standalone-status';
import { indexPublicRepositoryHistory, parsePublicRepository, readGitHubPublicJson, walkPublicRepositoryHistory } from '../core/public-history';
import { generateHistoricalBook, mergeHistoricalBook } from '../core/historical-lessons';
import { saveHistoricalBook, loadHistoricalBook } from '../core/learning-store';
import { markdownToPrintHtml } from '../core/learning-pdf-html';
import {analyzeSourceWithOllama,analyzeHistoricalCommitWithOllama} from '../core/deep-learning-analysis';
import {createKiloLearningModel} from '../core/kilo-learning-gateway';
import {validateLearningProfile} from '../core/learning-assessment';
import {readCompletePublicHistory} from '../core/history-index-cache';
import { documentFinishedIssue } from '../core/learning-live';
import { probeBubblewrap } from '../core/bwrap-probe';
import { probeReadonlyReviewerTool } from '../core/reviewer-tool-probe';
import { probeIsolatedQualityRuntime } from '../core/isolated-quality-probe';
import { probeIsolatedQualityScript } from '../core/isolated-quality-script-probe';
import { probeFullStandalonePipeline } from '../core/full-pipeline-probe';
import { probeOfflineKiloRuntime } from '../core/offline-kilo-probe';
import { probeOfflineReviewerSandbox } from '../core/offline-reviewer-probe';
import { probeLocalReviewModel } from '../core/local-review-model-probe';
import { probeReviewerCalibration } from '../core/reviewer-calibration-probe';
import { recordLocalReviewCalibration } from '../core/local-review-calibration-record';
import { probeOllamaReadiness } from '../core/ollama-readiness';
import { fetchKiloFreeModels } from '../core/kilo-free-models';
import { FreeQuotaGuard } from '../core/free-quota-guard';
import { inspectFreeRunReadiness } from '../core/free-run-readiness';
import { previewFreeRoutes } from '../core/free-route-preview';
import { readLocalReviewFallback, writeLocalReviewFallback } from '../core/local-review-fallback-settings';
import { probeKiloReviewerCalibration } from '../core/kilo-reviewer-calibration-probe';
import { loadKiloRoles, saveKiloRoles } from '../core/kilo-role-models';

interface Project { id: string; name: string; path: string }
let window: BrowserWindow | null = null;
let active: ChildProcess | null = null;
let localCodeController: AbortController | null = null;
type StudioOperation='issue-auto-draft'|'issue-build'|'issue-review'|'draft-publish';
interface RunningStudioOperation { projectId:string; issueNumber:number; kind:StudioOperation }
let localCodeOwner:RunningStudioOperation|null=null;
let publishingOwner:RunningStudioOperation|null=null;
let publishingDraftPr=false;
let startingLegacyRun=false;
let learningController:AbortController|null=null;
let activeRun: string | null = null;
let activeInfo: { runId: string; projectId: string; mode: RunMode; startedAt: number } | null = null;
let pendingStop: NodeJS.Timeout | null = null;
const registry = (): string => path.join(app.getPath('userData'), 'projects.json');
const history = (): RunHistory => new RunHistory(app.getPath('userData'));
function emitRunEvent(event: Record<string, unknown>): void { send('run:event', event); }
function assertIssueStartReady(labels:readonly string[]):void {
  const readiness=issueStartReadiness(labels);
  if(!readiness.ready)throw Error('Issue triage required: '+readiness.reason);
}

function projects(): Project[] {
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(registry(), 'utf8'));
    return Array.isArray(raw) ? raw.filter((p): p is Project => typeof p?.id === 'string' && typeof p?.path === 'string' && typeof p?.name === 'string') : [];
  } catch { return []; }
}
function persist(list: Project[]): void {
  fs.mkdirSync(path.dirname(registry()), { recursive: true });
  const temp = `${registry()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(list, null, 2), { mode: 0o600 });
  fs.renameSync(temp, registry());
}
function send(channel: string, value: unknown): void {
  if (window && !window.isDestroyed()) window.webContents.send(channel, value);
}
function getProject(id: string): Project {
  const project = projects().find(p => p.id === id);
  if (!project) throw new Error('Project not found');
  const real = fs.realpathSync(project.path);
  if (!fs.statSync(real).isDirectory()) throw new Error('Selected project is not a directory');
  return { ...project, path: real };
}
type ControllerPhase = 'builder' | 'reviewer' | 'quality-gates' | 'finalize';
interface ControllerSnapshot {
  currentIssue: number | null;
  reviewIteration: number;
  processedIssues: number[];
  failedIssues: number[];
  checkpoint: { issueNumber: number; phase: ControllerPhase; reason: string; sessionId: string | null; timestamp: string } | null;
  hasState: boolean;
  updatedAt: number | null;
}
function safeJson(file: string): Record<string, unknown> | null {
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > 1024 * 1024) return null;
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch { return null; }
}
function numberArray(value: unknown): number[] {
  return Array.isArray(value) ? value.filter((n): n is number => Number.isSafeInteger(n) && n > 0).slice(0, 1000) : [];
}
function snapshot(id: string): ControllerSnapshot {
  const project = getProject(id);
  const file = path.join(project.path, '.autodev-state.json');
  const state = safeJson(file);
  // Controller stores its own checkpoint both in state and in a separate file.
  // The separate checkpoint wins if present; no prompt/credentials are exposed to renderer.
  const saved = safeJson(path.join(project.path, '.autodev-checkpoint.json'));
  const cp = saved ?? (state?.checkpoint && typeof state.checkpoint === 'object' && !Array.isArray(state.checkpoint) ? state.checkpoint as Record<string, unknown> : null);
  const phase = cp?.phase;
  const checkpoint = cp && typeof cp.issueNumber === 'number' &&
    (phase === 'builder' || phase === 'reviewer' || phase === 'quality-gates' || phase === 'finalize')
    ? { issueNumber: cp.issueNumber, phase: phase as ControllerPhase, reason: typeof cp.reason === 'string' ? cp.reason : 'unknown',
        sessionId: typeof cp.sessionId === 'string' ? cp.sessionId : null,
        timestamp: typeof cp.timestamp === 'string' ? cp.timestamp : '' } : null;
  let updatedAt: number | null = null;
  try { updatedAt = fs.statSync(file).mtimeMs; } catch { /* no saved state */ }
  return { currentIssue: Number.isSafeInteger(state?.currentIssue) ? state!.currentIssue as number : null,
    reviewIteration: typeof state?.reviewIteration === 'number' ? state.reviewIteration : 0,
    processedIssues: numberArray(state?.processedIssues), failedIssues: numberArray(state?.failedIssues),
    checkpoint, hasState: state !== null, updatedAt };
}
function terminate(): void {
  const child = active;
  if (!child) return;
  try {
    if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGTERM');
    else child.kill('SIGTERM');
  } catch { /* process may have exited */ }
  if (pendingStop) clearTimeout(pendingStop);
  pendingStop = setTimeout(() => {
    if (active === child) {
      try { if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); }
      catch { /* already exited */ }
    }
  }, 4000);
  pendingStop.unref();
}
/** Only issues from the selected project's verified GitHub origin may ever
 * be displayed or executed. gh's contextual repository selection is NOT an
 * authorization boundary, and issue text cannot redirect to another repo.
 */
async function listProjectIssues(projectPath:string) {
  const git=await inspectGitPreflight(projectPath);
  if(!git.remoteSlug)throw Error('Selected project must have a verified GitHub origin');
  return listIssues(projectPath,undefined,git.remoteSlug);
}
function createWindow(): void {
  // Fit within the usable display area including panels/taskbars. In
  // particular, 10-inch 1024x600 and 800x480 displays must not get an
  // oversized default window or an unshrinkable 820x560 minimum.
  const workArea=screen.getPrimaryDisplay().workAreaSize;
  const width=Math.max(640,Math.min(1160,workArea.width-24));
  const height=Math.max(400,Math.min(780,workArea.height-24));
  window = new BrowserWindow({ width, height, minWidth: 640, minHeight: 400,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
    backgroundColor: '#111827', title: 'AutoDev Studio' });
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) void window.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  else void window.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  window.on('closed', () => { window = null; });
}
app.whenReady().then(() => {
  history().recoverInterrupted();
  ipcMain.handle('core:local-review-fallback:get', (_event,id:string) => {
    if(typeof id!=='string')throw Error('Invalid project ID');
    const project=getProject(id);
    if(!inspectProject(project.path).isGitRepo)throw Error('Not a Git repository');
    return readLocalReviewFallback(app.getPath('userData'),id);
  });
  ipcMain.handle('core:local-review-fallback:set', (_event,id:string,enabled:unknown) => {
    if(typeof id!=='string')throw Error('Invalid project ID');
    const project=getProject(id);
    if(!inspectProject(project.path).isGitRepo)throw Error('Not a Git repository');
    return writeLocalReviewFallback(app.getPath('userData'),id,enabled);
  });
  ipcMain.handle('core:free-route-preview', async (_event,id:string) => {
    if(typeof id!=='string')throw Error('Invalid project ID');
    const project=getProject(id);
    if(!inspectProject(project.path).isGitRepo)throw Error('Not a Git repository');
    const enabled=readLocalReviewFallback(app.getPath('userData'),id);
    const roles=loadKiloRoles(app.getPath('userData'),id);
    const catalog=await fetchKiloFreeModels();
    const quota=new FreeQuotaGuard(app.getPath('userData')).snapshot();
    const ollama=enabled?await probeOllamaReadiness():{ready:false as const,reason:'unreachable' as const};
    return previewFreeRoutes(roles,catalog.models,quota,ollama,enabled);
  });
  ipcMain.handle('core:free-run-readiness', async (_event,id:string) => {
    if(typeof id!=='string')throw new Error('Invalid project ID');
    const project=getProject(id);
    if(!inspectProject(project.path).isGitRepo)throw new Error('Not a Git repository');
    const roles=loadKiloRoles(app.getPath('userData'),id);
    // Catalog lookup reads only public data; it never invokes free models.
    const catalog=await fetchKiloFreeModels();
    const quota=new FreeQuotaGuard(app.getPath('userData')).snapshot();
    return inspectFreeRunReadiness(roles,catalog.models,quota);
  });
  ipcMain.handle('core:kilo-free-usage', (_event,id:string) => {
    if(typeof id!=='string')throw new Error('Invalid project ID');
    const project=getProject(id);
    if(!inspectProject(project.path).isGitRepo)throw new Error('Not a Git repository');
    // This counts ONLY inference attempts through Studio's own gateway bridge.
    // It cannot observe Kilo CLI, browser, other devices or shared public IP.
    return new FreeQuotaGuard(app.getPath('userData')).snapshot();
  });
  let kiloCalibrationInProgress=false;
  ipcMain.handle('core:kilo-reviewer-calibrate', async (_event, id:string) => {
    if(typeof id!=='string')throw new Error('Invalid project ID');
    const project=getProject(id);
    if(!inspectProject(project.path).isGitRepo)throw new Error('Not a Git repository');
    if(kiloCalibrationInProgress)return {passed:false,reason:'quota-reserve'} as const;
    kiloCalibrationInProgress=true;
    try{
      const selected=loadKiloRoles(app.getPath('userData'),id);
      if(!selected)return {passed:false,reason:'model-unavailable'} as const;
      const catalog=await fetchKiloFreeModels();
      if(!catalog.models.some(item=>item.id===selected.reviewer))
        return {passed:false,reason:'model-unavailable'} as const;
      return await probeKiloReviewerCalibration(
        selected.reviewer,new FreeQuotaGuard(app.getPath('userData')));
    }catch{
      return {passed:false,reason:'transport-failed'} as const;
    }finally{kiloCalibrationInProgress=false;}
  });
  ipcMain.handle('core:kilo-role-models:get', (_event, id: string) => {
    if(typeof id!=='string')throw new Error('Invalid project ID');
    const project=getProject(id);
    if(!inspectProject(project.path).isGitRepo)throw new Error('Not a Git repository');
    return loadKiloRoles(app.getPath('userData'),id);
  });
  ipcMain.handle('core:kilo-role-models:save', async (_event, id: string, input: unknown) => {
    if(typeof id!=='string')throw new Error('Invalid project ID');
    const project=getProject(id);
    if(!inspectProject(project.path).isGitRepo)throw new Error('Not a Git repository');
    const catalog=await fetchKiloFreeModels();
    return saveKiloRoles(app.getPath('userData'),id,input as Parameters<typeof saveKiloRoles>[2],catalog.models);
  });
  ipcMain.handle('core:kilo-free-models', async (_event, id: string) => {
    if (typeof id !== 'string') throw new Error('Invalid project ID');
    const project = getProject(id);
    if (!inspectProject(project.path).isGitRepo) throw new Error('Not a Git repository');
    return fetchKiloFreeModels();
  });
  ipcMain.handle('core:ollama-readiness', async (_event, id: string) => {
    if (typeof id !== 'string') throw new Error('Invalid project ID');
    const project = getProject(id);
    if (!inspectProject(project.path).isGitRepo) throw new Error('Not a Git repository');
    return probeOllamaReadiness();
  });
  // Explicit user-triggered fixture only. Never reads a selected repository.
  let calibrationInProgress = false;
  ipcMain.handle('core:reviewer-calibration', async (_event, id: string) => {
    if (typeof id !== 'string') throw new Error('Invalid project ID');
    const project = getProject(id);
    if (!inspectProject(project.path).isGitRepo) throw new Error('Not a Git repository');
    if (calibrationInProgress) return {passed:false,reason:'busy'} as const;
    calibrationInProgress = true;
    try {
      const userData=app.getPath('userData');
      // A fresh attempt revokes any previous PASS before contacting the model.
      recordLocalReviewCalibration(userData,id,false);
      const result=await probeReviewerCalibration();
      if(result.passed===true&&result.reason==='passed')
        recordLocalReviewCalibration(userData,id,true);
      return result;
    } finally { calibrationInProgress = false; }
  });
  ipcMain.handle('core:local-model-probe', async (_event, id: string) => {
    if (typeof id !== 'string') throw new Error('Invalid project ID');
    const project = getProject(id);
    if (!inspectProject(project.path).isGitRepo) throw new Error('Not a Git repository');
    return probeLocalReviewModel();
  });
  ipcMain.handle('core:offline-reviewer-probe', async (_event, id: string) => {
    if (typeof id !== 'string') throw new Error('Invalid project ID');
    const project = getProject(id);
    if (!inspectProject(project.path).isGitRepo) throw new Error('Not a Git repository');
    return probeOfflineReviewerSandbox();
  });
  ipcMain.handle('core:offline-kilo-probe', async (_event, id: string) => {
    if (typeof id !== 'string') throw new Error('Invalid project ID');
    const project = getProject(id);
    if (!inspectProject(project.path).isGitRepo) throw new Error('Not a Git repository');
    return probeOfflineKiloRuntime();
  });
  ipcMain.handle('core:full-pipeline-probe', async (_event, id: string) => {
    if (typeof id !== 'string') throw new Error('Invalid project ID');
    const project = getProject(id);
    if (!inspectProject(project.path).isGitRepo) throw new Error('Not a Git repository');
    return probeFullStandalonePipeline();
  });
  ipcMain.handle('core:quality-script-probe', async (_event, id: string) => {
    if (typeof id !== 'string') throw new Error('Invalid project ID');
    const project = getProject(id);
    if (!inspectProject(project.path).isGitRepo) throw new Error('Not a Git repository');
    return probeIsolatedQualityScript();
  });
  ipcMain.handle('core:quality-probe', async (_event, id: string) => {
    if (typeof id !== 'string') throw new Error('Invalid project ID');
    const project = getProject(id);
    if (!inspectProject(project.path).isGitRepo) throw new Error('Not a Git repository');
    return probeIsolatedQualityRuntime();
  });
  ipcMain.handle('core:reviewer-probe', async (_event, id: string) => {
    if (typeof id !== 'string') throw new Error('Invalid project ID');
    const project = getProject(id);
    if (!inspectProject(project.path).isGitRepo) throw new Error('Not a Git repository');
    return probeReadonlyReviewerTool(project.path);
  });
  ipcMain.handle('core:sandbox-probe', async (_event, id: string) => {
    if (typeof id !== 'string') throw new Error('Invalid project ID');
    getProject(id);
    return probeBubblewrap();
  });
  ipcMain.handle('core:diagnostics', async (_event, id: string) => {
    if (typeof id !== 'string') throw new Error('Invalid project ID');
    const project = getProject(id);
    return inspectLocalProviders(project.path);
  });
  ipcMain.handle('core:activity', (_event,id:string) => {
    if(typeof id!=='string')throw Error('Invalid project ID');
    getProject(id);
    const operation=localCodeOwner ?? publishingOwner;
    if(operation)return {busy:true,kind:operation.kind,
      projectId:operation.projectId,issueNumber:operation.issueNumber} as const;
    if(active||startingLegacyRun)return {busy:true,kind:'legacy-run',
      projectId:activeInfo?.projectId??null,issueNumber:null} as const;
    return {busy:false,kind:null,projectId:null,issueNumber:null} as const;
  });
  ipcMain.handle('learning:deep-generate',async (_event,input:unknown,provider:unknown='ollama',consent:unknown=false,profileInput:unknown=null) => {
    const learningProfile=profileInput===null?undefined:validateLearningProfile(profileInput);
    if(typeof input!=='string'||input.length>250)throw Error('Invalid learning source');
    if(provider!=='ollama'&&provider!=='kilo')throw Error('Invalid learning provider');
    if(provider==='kilo'&&consent!==true)
      throw Error('Cloud analysis requires explicit source-upload consent');
    const modelName=provider==='kilo'?'kilo-auto/free':'qwen2.5-coder:3b';
    const snapshotMode=provider==='kilo'?'deep-kilo':'deep';
    const cloudModel=provider==='kilo'?createKiloLearningModel():undefined;
    if(learningController)throw Error('Learning analysis is already active');
    const controller=new AbortController();
    learningController=controller;
    const runId=randomUUID();
    const startedAt=Date.now();
    try{
      const index=await readCompletePublicHistory(app.getPath('userData'),input,{
        read:readGitHubPublicJson,signal:controller.signal,
        onProgress:(commitsSeen,page,finished)=>{
          send('learning:progress',{
            runId,repository:input,phase:'discovery',startedAt,
            completed:commitsSeen,total:0,
            current:'Git-Historie: '+commitsSeen+' Commits · Seite '+page+
              (finished?' · vollständig indexiert':' · lade weitere Seiten'),
            etaSeconds:null,preview:'',model:modelName,
          });
        },
      });
      const prior=loadHistoricalBook(app.getPath('userData'),index.repository,snapshotMode);
      const compatible=prior?.head===index.head&&
        prior.deepSummary?.model===modelName;
      let offset=compatible?(prior?.deepCursor?.nextOffset??0):0;
      let chapterIndex=compatible?(prior?.deepCursor?.chapterIndex??0):0;
      let filesAnalyzed=compatible?(prior?.deepSummary?.filesAnalyzed??0):0;
      let bookMarkdown=compatible?(prior?.bookMarkdown??''):'';
      let solutionsMarkdown=compatible?(prior?.solutionsMarkdown??''):'';
      let reportsMarkdown=compatible?(prior?.reportsMarkdown??''):'';
      let sourceComplete=compatible&&prior?.deepCursor===undefined&&
        prior?.deepSummary?.filesAnalyzed===prior?.deepSummary?.filesTotal;
      let summary=compatible?prior?.deepSummary:undefined;
      const chapterNumber=():number=>{
        let highest=0;
        for(const match of bookMarkdown.matchAll(/^## Kapitel (\\d+)/gm))
          highest=Math.max(highest,Number(match[1]));
        return highest;
      };
      const persist=(historyCursor?:{
        nextIndex:number;total:number;chapters:number;incomplete:number;model:string;
      })=>saveHistoricalBook(app.getPath('userData'),{
        repository:index.repository,head:index.head,license:index.licenseSpdx,
        lessons:[],bookMarkdown,solutionsMarkdown,reportsMarkdown,
        deepSummary:summary,
        deepCursor:sourceComplete?undefined:{
          nextOffset:offset,filesTotal:summary?.filesTotal??0,
          filesAnalyzed,filesSkipped:summary?.filesSkipped??0,
          model:modelName,chapterIndex,
        },
        historyCursor,
      },snapshotMode);
      while(!sourceComplete){
        if(controller.signal.aborted)throw Error('Learning analysis cancelled');
        const batchOffset=offset;
        const resumeContext=bookMarkdown.slice(0,3000);
        const result=await analyzeSourceWithOllama(index.repository,index.head,
          runId,startedAt,event=>send('learning:progress',{
            ...event,current:'Quelldateien ab '+(batchOffset+1)+' · '+event.current,
          }),controller.signal,{
            offset,resumeChapter:chapterIndex,resumeContext,learningProfile,
            chapterOffset:chapterNumber()-chapterIndex,
            onChapter:(chapter,completed,total,skipped)=>{
              if(controller.signal.aborted)throw Error('Learning analysis cancelled');
              bookMarkdown+=(bookMarkdown?'\n\n':'# Code-Lehrbuch: '+index.repository+'\n\n')+
                chapter.book;
              solutionsMarkdown+=(solutionsMarkdown?'\n\n':'# Musterlösungen\n\n')+
                chapter.solution;
              reportsMarkdown+=(reportsMarkdown?'\n\n':'# Quellen und Einschränkungen\n\n')+
                chapter.report;
              chapterIndex=completed;
              summary={model:modelName,filesAnalyzed,filesSkipped:skipped,
                filesTotal:total,complete:false};
              persist();
            },
            ...(cloudModel?{model:cloudModel,preflight:async()=>{},modelName}:{}),
            history:index.commits.map(commit=>({
              sha:commit.sha,title:commit.title,changedPaths:commit.changedPaths,
            })),
          });
        if(controller.signal.aborted)throw Error('Learning analysis cancelled');
        filesAnalyzed+=result.filesAnalyzed;
        sourceComplete=result.nextOffset===null;
        offset=result.nextOffset??0;
        chapterIndex=0;
        summary={model:result.model,filesAnalyzed,filesSkipped:result.filesSkipped,
          filesTotal:result.filesTotal,complete:result.complete};
        persist();
      }
      let historyNext=compatible&&prior?.historyCursor?.total===index.commits.length
        ?prior.historyCursor.nextIndex:0;
      let historyChapters=compatible&&prior?.historyCursor?.total===index.commits.length
        ?prior.historyCursor.chapters:0;
      let incomplete=compatible&&prior?.historyCursor?.total===index.commits.length
        ?prior.historyCursor.incomplete:0;
      const historyStartIndex=historyNext;
      const historyStartedAt=Date.now();
      for(let i=historyNext;i<index.commits.length;i++){
        if(controller.signal.aborted)throw Error('Learning analysis cancelled');
        const commit=index.commits[i];
        send('learning:progress',{
          runId,repository:index.repository,phase:'history',startedAt,
          completed:i,total:index.commits.length,
          current:'Historische Codeänderung '+(i+1)+'/'+index.commits.length+
            ' · '+commit.sha.slice(0,12),
          etaSeconds:i>historyStartIndex
            ?Math.round((Date.now()-historyStartedAt)/(i-historyStartIndex)*
              (index.commits.length-i)/1000):null,
          preview:reportsMarkdown.slice(-2500),
          model:modelName,
        });
        const history=await analyzeHistoricalCommitWithOllama(
          index.repository,commit.sha,chapterNumber()+1,controller.signal,
          cloudModel?{model:cloudModel}:{});
        if(controller.signal.aborted)throw Error('Learning analysis cancelled');
        if(history.bookMarkdown)
          bookMarkdown+='\n\n'+history.bookMarkdown;
        if(history.solutionsMarkdown)
          solutionsMarkdown+='\n\n'+history.solutionsMarkdown;
        reportsMarkdown+='\n\n'+history.reportsMarkdown;
        historyChapters+=history.chapters;
        if(!history.complete)incomplete++;
        historyNext=i+1;
        persist({nextIndex:historyNext,total:index.commits.length,
          chapters:historyChapters,incomplete,model:modelName});
      }
      const final=loadHistoricalBook(app.getPath('userData'),index.repository,snapshotMode);
      if(!final||final.head!==index.head)throw Error('Final learning snapshot is unavailable');
      send('learning:progress',{
        runId,repository:index.repository,phase:'finished',startedAt,
        completed:index.commits.length,total:index.commits.length,
        current:'Historie abgeschlossen · '+incomplete+' unvollständige Commit-Belege',
        etaSeconds:0,preview:reportsMarkdown.slice(-2500),model:modelName,
      });
      return {repository:final.repository,head:final.head,lessons:filesAnalyzed,
        bookMarkdown:final.bookMarkdown,solutionsMarkdown:final.solutionsMarkdown,
        reportsMarkdown:final.reportsMarkdown,deepAnalysis:{
          model:modelName,filesAnalyzed,
          filesSkipped:summary?.filesSkipped??0,
          complete:(summary?.complete??false)&&incomplete===0,
        }};
    }finally{
      if(learningController===controller)learningController=null;
    }
  });
  ipcMain.handle('learning:deep-cancel',()=>{
    if(!learningController)return false;
    learningController.abort();
    return true;
  });
  ipcMain.handle('learning:generate', async (_event, input: unknown,
    page:unknown=1,pinnedHead?:unknown) => {
    if(typeof input!=='string'||input.length>250||typeof page!=='number'||
      (pinnedHead!==undefined&&typeof pinnedHead!=='string'))
      throw Error('Invalid learning source');
    // Automatic bounded paging: persist each successful page so an API error
    // leaves the last verified Markdown snapshot recoverable.
    let lastSaved:ReturnType<typeof saveHistoricalBook>|null=null;
    const current=loadHistoricalBook(app.getPath('userData'),parsePublicRepository(input));
    const resume=current?.pagination?.hasMore===true&&
      current.pagination.pageSize===20&&current.lessonEntries.length===current.lessons;
    await walkPublicRepositoryHistory(input,{
      pageSize:20,
      startPage:resume?(current?.pagination?.page??0)+1:1,
      pinnedHead:resume?current?.head:undefined,
      initialCount:resume?(current?.pagination?.page??0)*20:0,
      collect:false,
      onPage:async index=>{
        const candidate=await generateHistoricalBook(index,readGitHubPublicJson);
        const previous=loadHistoricalBook(app.getPath('userData'),index.repository);
        if(previous&&previous.head===index.fixedHead&&previous.lessons>0&&
          previous.lessonEntries.length===0)
          throw Error('Previous learning snapshot lacks typed topic records: migration required');
        const prior=previous&&previous.head===index.fixedHead
          ?{repository:previous.repository,head:previous.head,
            license:previous.license,lessons:previous.lessonEntries,
            bookMarkdown:previous.bookMarkdown,
            solutionsMarkdown:previous.solutionsMarkdown,
            reportsMarkdown:previous.reportsMarkdown,
            caseStudies:previous.caseStudies}:null;
        const grown=mergeHistoricalBook(prior,candidate);
        grown.pagination={page:index.page,hasMore:index.hasMore,pageSize:20};
        lastSaved=saveHistoricalBook(app.getPath('userData'),grown);
      },
    });
    if(!lastSaved)throw Error('No history pages were analyzed');
    const saved=lastSaved as ReturnType<typeof saveHistoricalBook>;
    return {repository:saved.repository,head:saved.head,
      lessons:saved.lessons,bookMarkdown:saved.bookMarkdown,
      solutionsMarkdown:saved.solutionsMarkdown,reportsMarkdown:saved.reportsMarkdown,
      page:saved.pagination?.page,hasMore:saved.pagination?.hasMore};
  });
  ipcMain.handle('learning:load', (_event, repository: unknown, provider: unknown='ollama') => {
    if(typeof repository!=='string')throw Error('Invalid learning repository');
    if(provider!=='ollama'&&provider!=='kilo')throw Error('Invalid learning provider');
    const mode=provider==='kilo'?'deep-kilo':'deep';
    const saved=loadHistoricalBook(app.getPath('userData'),repository,mode)??
      loadHistoricalBook(app.getPath('userData'),repository);
    return saved?{repository:saved.repository,head:saved.head,
      lessons:saved.lessons,bookMarkdown:saved.bookMarkdown,
      solutionsMarkdown:saved.solutionsMarkdown,reportsMarkdown:saved.reportsMarkdown,
      page:saved.pagination?.page,hasMore:saved.pagination?.hasMore,
      deepAnalysis:saved.deepSummary?{
        model:saved.deepSummary.model,filesAnalyzed:saved.deepSummary.filesAnalyzed,
        filesSkipped:saved.deepSummary.filesSkipped,
        complete:saved.deepSummary.complete&&saved.historyCursor!==undefined&&
          saved.historyCursor.nextIndex===saved.historyCursor.total&&
          saved.historyCursor.incomplete===0,
      }:undefined}:null;
  });
  ipcMain.handle('learning:export',async (_event,repository:unknown,
    kind:unknown,format:unknown,mode:unknown='history') => {
    if(typeof repository!=='string'||!['book','solutions','reports'].includes(String(kind))||
       !['md','pdf'].includes(String(format))||
       !['history','deep'].includes(String(mode)))throw Error('Invalid learning export');
    const saved=loadHistoricalBook(app.getPath('userData'),repository,
      mode as 'history'|'deep');
    if(!saved)throw Error('No saved learning book found');
    const content=kind==='book'?saved.bookMarkdown:
      kind==='solutions'?saved.solutionsMarkdown:saved.reportsMarkdown;
    const filename=kind==='book'?'Lehrbuch':kind==='solutions'?'Musterloesungen':'Entwicklungsreports';
    const ext=format==='pdf'?'pdf':'md';
    const destination=await dialog.showSaveDialog(window!,{
      title:filename+' exportieren',defaultPath:filename+'.'+ext,
      filters:[{name:ext.toUpperCase(),extensions:[ext]}],
    });
    if(destination.canceled||!destination.filePath)return {exported:false} as const;
    if(format==='md'){
      fs.writeFileSync(destination.filePath,content,{encoding:'utf8'});
    }else{
      const html=markdownToPrintHtml(content,filename);
      const printWindow=new BrowserWindow({show:false,width:1000,height:1200,
        webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true}});
      try{
        await printWindow.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(html));
        const data=await printWindow.webContents.printToPDF({pageSize:'A4',
          printBackground:true,displayHeaderFooter:true,
          headerTemplate:'<span></span>',
          footerTemplate:'<div style="width:100%;font-size:8px;color:#777;text-align:center"><span class="pageNumber"></span> / <span class="totalPages"></span></div>'});
        fs.writeFileSync(destination.filePath,data);
      }finally{printWindow.destroy();}
    }
    return {exported:true} as const;
  });
  ipcMain.handle('learning:public-history', async (_event, input: unknown, limit: unknown) => {
    if(typeof input!=='string'||typeof limit!=='number')throw Error('Invalid history request');
    return indexPublicRepositoryHistory(input,undefined,limit);
  });
  ipcMain.handle('core:status', async (_event, id: string) => {
    if (typeof id !== 'string') throw new Error('Invalid project ID');
    const project = getProject(id);
    if (!inspectProject(project.path).isGitRepo) throw new Error('Not a Git repository');
    return inspectStandaloneStatus(app.getPath('userData'), project.path);
  });
  ipcMain.handle('core:preflight', async (_event, id: string) => {
    if (typeof id !== 'string') throw new Error('Invalid project ID');
    const project = getProject(id);
    return inspectGitPreflight(project.path);
  });
  ipcMain.handle('core:branch-protection', async (_event,id:string) => {
    if(typeof id!=='string')throw Error('Invalid project ID');
    const project=getProject(id);
    try{
      const evidence=await assertBranchProtection(project.path);
      return {protected:true,evidence} as const;
    }catch(error){
      return {protected:false,reason:error instanceof Error?error.message:
        'GitHub protection could not be verified'} as const;
    }
  });
  ipcMain.handle('core:tech-stack', (_event,id:unknown) => {
    if(typeof id!=='string')throw Error('Invalid project ID');
    const project=getProject(id);
    if(!inspectProject(project.path).isGitRepo)throw Error('Not a Git repository');
    return detectTechStackProfile(project.path);
  });
  ipcMain.handle('core:issue-labels:install', async (_event,id:unknown) => {
    if(typeof id!=='string')throw Error('Invalid project ID');
    if(active||localCodeController||publishingDraftPr)throw Error('Cannot change labels during active workflow');
    const project=getProject(id);
    if(!inspectProject(project.path).isGitRepo)throw Error('Not a Git repository');
    return installRequiredIssueLabels(project.path);
  });
  ipcMain.handle('core:issues', async (_event, id: string) => {
    if (typeof id !== 'string') throw new Error('Invalid project ID');
    const project = getProject(id);
    if (!inspectProject(project.path).isGitRepo) throw new Error('Not a Git repository');
    return listProjectIssues(project.path);
  });
  ipcMain.handle('core:issue-status-previews', async (_event,id:unknown) => {
    if(typeof id!=='string')throw Error('Invalid project ID');
    const project=getProject(id);
    if(!inspectProject(project.path).isGitRepo)throw Error('Not a Git repository');
    const checkpoint=loadCoreCheckpoint(app.getPath('userData'),project.path);
    if(!checkpoint)return [];
    const issues=await listProjectIssues(project.path);
    const issue=issues.find(item=>item.number===checkpoint.issueNumber);
    if(!issue)return [];
    let git=null;
    try{git=await captureGitIdentity(project.path);}
    catch{/* Git identity cannot be verified; preview fails closed. */}
    return [{issueNumber:issue.number,...previewCheckpointIssueStatus(
      project.path,issue.number,issue.labels,checkpoint,git)}];
  });
  ipcMain.handle('core:issue-queue', async (_event,id:string) => {
    if(typeof id!=='string')throw Error('Invalid project ID');
    const project=getProject(id);
    if(!inspectProject(project.path).isGitRepo)throw Error('Not a Git repository');
    const issues=await listProjectIssues(project.path);
    return previewIssueQueue(app.getPath('userData'),project.path,issues);
  });
  ipcMain.handle('core:workflow', () => WORKFLOW_STAGES);
  ipcMain.handle('core:issue-auto-draft', async (_event,id:string,issueNumber:number) => {
    if(active||localCodeController||publishingDraftPr)
      throw Error('Another Studio run is active');
    if(typeof id!=='string'||!Number.isSafeInteger(issueNumber)||issueNumber<1)
      throw Error('Invalid automated issue request');
    const project=getProject(id);
    if(!inspectProject(project.path).isGitRepo)
      throw Error('Not a Git repository');
    // Reserve this process immediately, before any asynchronous gh/catalog call.
    const controller=new AbortController();
    localCodeController=controller;
    localCodeOwner={projectId:id,issueNumber,kind:'issue-auto-draft'};
    try{
      await assertBranchProtection(project.path);
      const issues=await listProjectIssues(project.path);
      const issue=issues.find(item=>item.number===issueNumber);
      if(!issue)throw Error('Issue is not open or no longer available');
      const base=app.getPath('userData');
      const cp=loadCoreCheckpoint(base,project.path);
      if(cp && cp.issueNumber!==issue.number)
        throw Error('Another issue has a pending checkpoint');
      if(!cp)assertIssueStartReady(issue.labels);
      const scripts=assertSeniorStackPreflight(project.path).qualityScripts;
      const catalog=await fetchKiloFreeModels();
      const roles=selectPrimaryKiloRoles(loadKiloRoles(base,id),catalog.models);
      const quota=new FreeQuotaGuard(base);
      const kiloBuilder=createKiloPrimaryBuilder(roles,catalog.models,quota);
      const reviewer=createKiloPrimaryReviewer(base,id,roles,catalog.models,quota);
      const deps={...defaultIssueAutomationDependencies,
        build:kiloBuilder.build,repair:kiloBuilder.repair};
      const outcome=await runIssueToDraftPr(base,project.path,{
        number:issue.number,title:issue.title,body:issue.body,
      },reviewer.transport,scripts,controller.signal,
      stage=>send('issue:progress',{projectId:id,issueNumber,stage,time:Date.now()}),
      deps,reviewer.canReview);
      if(outcome.status!=='draft-created'||!outcome.draftUrl)return outcome;
      try{
        const result=await documentFinishedIssue(base,project.path,issueNumber,outcome.draftUrl,undefined,issue.title);
        return {...outcome,learningReport:result.recorded
          ?'saved' as const:'unavailable' as const};
      }catch{
        // Publishing already succeeded. A documentation error must never trigger a second push.
        return {...outcome,learningReport:'unavailable' as const};
      }
    }finally{
      if(localCodeController===controller){localCodeController=null;localCodeOwner=null;}
    }
  });
  ipcMain.handle('core:issue-to-code', async (_event, id:string, issueNumber:number) => {
    if(active||localCodeController||publishingDraftPr)throw Error('Another Studio run is active');
    if(typeof id!=='string'||!Number.isSafeInteger(issueNumber)||issueNumber<1)
      throw Error('Invalid issue-to-code request');
    const project=getProject(id);
    if(!inspectProject(project.path).isGitRepo)throw Error('Not a Git repository');
    // Authoritative issue fetched by Main: never trust renderer-supplied title,
    // code, file names, paths, or model instructions.
    const issues=await listProjectIssues(project.path);
    const issue=issues.find(x=>x.number===issueNumber);
    if(!issue)throw Error('Issue is not open or no longer available');
    if(!loadCoreCheckpoint(app.getPath('userData'),project.path))
      assertIssueStartReady(issue.labels);
    if(active||localCodeController||publishingDraftPr)throw Error('Another Studio run is active');
    const controller=new AbortController();
    localCodeController=controller;
    localCodeOwner={projectId:id,issueNumber,kind:'issue-build'};
    try{
      await assertBranchProtection(project.path);
      assertSeniorStackPreflight(project.path);
      const base=app.getPath('userData');
      const catalog=await fetchKiloFreeModels();
      const roles=selectPrimaryKiloRoles(loadKiloRoles(base,id),catalog.models);
      const builder=createKiloPrimaryBuilder(roles,catalog.models,new FreeQuotaGuard(base));
      return await builder.build(base,project.path,
        {number:issue.number,title:issue.title,body:issue.body},controller.signal);
    }finally{
      if(localCodeController===controller){localCodeController=null;localCodeOwner=null;}
    }
  });
  ipcMain.handle('core:issue-verify', async (_event,id:string,issueNumber:number) => {
    if(active||localCodeController||publishingDraftPr)throw Error('Another Studio run is active');
    if(typeof id!=='string'||!Number.isSafeInteger(issueNumber)||issueNumber<1)
      throw Error('Invalid issue verification request');
    const project=getProject(id);
    if(!inspectProject(project.path).isGitRepo)
      throw Error('Not a Git repository');
    const issues=await listProjectIssues(project.path);
    const issue=issues.find(item=>item.number===issueNumber);
    if(!issue)throw Error('Issue not found among open issues');
    const scripts=assertSeniorStackPreflight(project.path).qualityScripts;
    if(active||localCodeController||publishingDraftPr)throw Error('Another Studio run is active');
    const controller=new AbortController();
    localCodeController=controller;
    localCodeOwner={projectId:id,issueNumber,kind:'issue-review'};
    try{
      await assertBranchProtection(project.path);
      const base=app.getPath('userData');
      const catalog=await fetchKiloFreeModels();
      const roles=selectPrimaryKiloRoles(loadKiloRoles(base,id),catalog.models);
      const reviewer=createKiloPrimaryReviewer(base,id,roles,catalog.models,
        new FreeQuotaGuard(base));
      const ready=await reviewer.canReview();
      if(!ready.ready)throw Error(ready.reason);
      return await verifyGeneratedIssue(base,project.path,
        {number:issue.number,title:issue.title,body:issue.body},
        reviewer.transport,scripts,controller.signal);
    }finally{
      if(localCodeController===controller){localCodeController=null;localCodeOwner=null;}
    }
  });
  ipcMain.handle('core:issue-draft-pr', async (_event,id:string,issueNumber:number) => {
    if(active||localCodeController||publishingDraftPr)
      throw Error('Another Studio run is active');
    if(typeof id!=='string'||!Number.isSafeInteger(issueNumber)||issueNumber<1)
      throw Error('Invalid draft PR request');
    const project=getProject(id);
    if(!inspectProject(project.path).isGitRepo)
      throw Error('Not a Git repository');
    publishingDraftPr=true;
    publishingOwner={projectId:id,issueNumber,kind:'draft-publish'};
    try{
      await assertBranchProtection(project.path);
      assertSeniorStackPreflight(project.path);
      const issues=await listProjectIssues(project.path);
      if(!issues.some(item=>item.number===issueNumber))
        throw Error('Issue is not open or no longer available');
      return await publishVerifiedDraftPullRequest(app.getPath('userData'),
        project.path,issueNumber);
    } finally { publishingDraftPr=false;publishingOwner=null; }
  });
  ipcMain.handle('core:issue-to-code:cancel', () => {
    if(!localCodeController)return false;
    localCodeController.abort();
    return true;
  });
  ipcMain.handle('core:simulate', async (_event, projectId: string, issueNumber: number) => {
    if (typeof projectId !== 'string' || !Number.isSafeInteger(issueNumber) || issueNumber <= 0) {
      throw new Error('Invalid simulation request');
    }
    const project = getProject(projectId);
    if (!inspectProject(project.path).isGitRepo) throw new Error('Not a Git repository');
    // Obtain issue details in the trusted main process rather than accepting a renderer-supplied prompt.
    const issues = await listProjectIssues(project.path);
    const issue = issues.find(item => item.number === issueNumber);
    if (!issue) throw new Error('Issue not found among open issues');
    // Inert test adapters: no Kilo, Git commit, push or issue close.
    return orchestrateIssue(
      { number: issue.number, title: issue.title, body: issue.body },
      createSimulationAdapters({ failFirstReview: true }),
    );
  });
  ipcMain.handle('project:list', () => projects().map(project => {
    try { return { ...project, ...inspectProject(fs.realpathSync(project.path)) }; }
    catch { return { ...project, isGitRepo: false, hasCore: false }; }
  }));
  ipcMain.handle('history:list', (_event, id: string) => {
    if (typeof id !== 'string') throw new Error('Invalid project ID');
    getProject(id);
    return history().list(id);
  });
  ipcMain.handle('history:log', (_event, id: string, runId: string) => {
    if (typeof id !== 'string' || typeof runId !== 'string') throw new Error('Invalid history request');
    getProject(id);
    return history().getLog(id, runId);
  });
  ipcMain.handle('project:snapshot', (_event, id: string) => {
    if (typeof id !== 'string') throw new Error('Invalid project ID');
    return snapshot(id);
  });
  ipcMain.handle('project:add', async () => {
    const selection = await dialog.showOpenDialog(window!, { properties: ['openDirectory'] });
    if (selection.canceled || !selection.filePaths[0]) return null;
    const dir = fs.realpathSync(selection.filePaths[0]);
    if (!inspectProject(dir).isGitRepo) throw new Error('Select a Git repository root containing .git');
    const existing = projects();
    const present = existing.find(p => p.path === dir);
    if (present) return { ...present, ...inspectProject(dir) };
    const project = { id: randomUUID(), name: path.basename(dir), path: dir };
    persist([...existing, project]);
    return { ...project, ...inspectProject(dir) };
  });
  ipcMain.handle('project:remove', (_event, id: string) => {
    if (typeof id !== 'string') throw new Error('Invalid ID');
    if (active && activeRun?.startsWith(id + ':')) throw new Error('Stop the running process first');
    persist(projects().filter(p => p.id !== id));
    return true;
  });
  ipcMain.handle('run:start', async (_event, id: string, mode: RunMode, approval?: string) => {
    if (localCodeController||publishingDraftPr) throw new Error('A Studio issue run is active');
    if (active || startingLegacyRun) throw new Error('A run is already active');
    if (typeof id !== 'string') throw new Error('Invalid project ID');
    startingLegacyRun=true;
    try {
    const project = getProject(id);
    if (!inspectProject(project.path).hasCore) throw new Error('AutoDev Core is not installed in this project');
    // Main-process authorization is independent of the renderer.
    assertRunApproved(mode, project.name, approval);
    if (mode === 'execute') await assertBranchProtection(project.path);
    const bin = path.join(project.path, 'node_modules', '.bin', 'tsx');
    if (!fs.existsSync(bin)) throw new Error('Missing local tsx. Run npm install in the project.');
    const runId = randomUUID();
    const script = path.join(project.path, 'src/autodev/cli.ts');
    const args = mode === 'status' ? [script, 'status'] : [script, 'run', mode === 'execute' ? '--execute' : '--dry-run'];
    const startedAt = Date.now();
    history().start({ runId, projectId: id, projectName: project.name, mode, startedAt });
    let child: ChildProcess;
    try {
      child = spawn(bin, args, { cwd: project.path, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32', env: { ...process.env, FORCE_COLOR: '0' } });
    } catch (error) {
      history().append(runId, 'stderr', String(error));
      history().finish(runId, 1, null);
      throw error;
    }
    active = child;
    activeRun = `${id}:${runId}`;
    activeInfo = { runId, projectId: id, mode, startedAt };
    send('run:event', { runId, type: 'start', mode, project: project.name, projectId: id, time: activeInfo.startedAt });
    child.stdout?.on('data', (chunk: Buffer) => {
      const message = chunk.toString();
      try { history().append(runId, 'stdout', message); } catch (error) { console.error('Run history write failed', error); }
      emitRunEvent({ runId, type: 'stdout', message, time: Date.now() });
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      const message = chunk.toString();
      try { history().append(runId, 'stderr', message); } catch (error) { console.error('Run history write failed', error); }
      emitRunEvent({ runId, type: 'stderr', message, time: Date.now() });
    });
    child.on('error', error => {
      try { history().append(runId, 'stderr', error.message); } catch (failure) { console.error('Run history write failed', failure); }
      emitRunEvent({ runId, type: 'stderr', message: error.message, time: Date.now() });
    });
    child.on('close', (code, signal) => {
      if (pendingStop) { clearTimeout(pendingStop); pendingStop = null; }
      try { history().finish(runId, code, signal); } catch (error) { console.error('Run history finalize failed', error); }
      if (active === child) { active = null; activeRun = null; activeInfo = null; }
      send('run:event', { runId, type: 'exit', code, signal, time: Date.now() });
    });
    return { runId };
    } finally {
      startingLegacyRun=false;
    }
  });
  ipcMain.handle('run:stop', () => { if (!active) return false; terminate(); return true; });
  ipcMain.handle('run:active', () => Boolean(active));
  ipcMain.handle('run:info', () => activeInfo ? { ...activeInfo } : null);
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('before-quit', () => {localCodeController?.abort();terminate();});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
