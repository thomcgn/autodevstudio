import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { acquireProjectLock } from './project-lock.ts';
import { orchestrateIssue } from './orchestrator.ts';
import {
  createStandaloneSafeWorkflowAdapters, type SafeQualityExecutor,
} from './standalone-safe-adapters.ts';
import { runIsolatedQualityGates } from './isolated-quality-gates.ts';
import { collectReviewEvidence } from './review-evidence.ts';
import type { EvidenceCollector } from './review-evidence-verdict.ts';

const exec=promisify(execFile);
export interface FullPipelineProbeResult {
  passed:boolean;
  reason:'passed'|'unsupported-platform'|'setup-failed'|'pipeline-failed';
}
export interface FullPipelineProbeDependencies {
  /** For hermetic CI ONLY. Production UI always uses real sandbox implementations. */
  quality?:SafeQualityExecutor;
  collect?:EvidenceCollector;
}
async function fixtureGit(repo:string,home:string):Promise<void>{
  const git=async(args:string[])=>{
    await exec('/usr/bin/git',args,{
      cwd:repo,timeout:10000,maxBuffer:4096,encoding:'utf8',
      windowsHide:true,shell:false,
      env:{PATH:'/usr/bin:/bin',HOME:home,GIT_CONFIG_NOSYSTEM:'1',
        GIT_CONFIG_GLOBAL:'/dev/null',GIT_TERMINAL_PROMPT:'0'},
    });
  };
  await git(['init','-b','autodev/issue-1']);
  fs.writeFileSync(path.join(repo,'package.json'),JSON.stringify({
    name:'autodev-pipeline-smoke',version:'1.0.0',private:true,
    scripts:{'studio-smoke':'node -e "process.stdout.write(\'ok\')"'},
  }),{mode:0o600});
  await git(['add','--','package.json']);
  await git(['-c','user.name=AutoDev Fixture','-c','user.email=fixture@invalid.local',
    'commit','-m','Disposable fixture']);
}
/** Full LOCAL integration proof with no real model, no project changes,
 * no network and no remote publication. A temporary Git repository is created
 * and a fixed npm script executed through Bubblewrap.
 * Any failure is reported as a constant status without leaking paths, logs,
 * provider credentials or model text. Always cleans up and releases lock.
 */
export async function probeFullStandalonePipeline(
  deps:FullPipelineProbeDependencies={},
):Promise<FullPipelineProbeResult>{
  if(process.platform!=='linux')
    return {passed:false,reason:'unsupported-platform'};
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'autodev-pipeline-smoke-'));
  const projectPath=path.join(base,'repo');
  let lock:ReturnType<typeof acquireProjectLock>|null=null;
  let prepared=false;
  try{
    fs.mkdirSync(projectPath);
    await fixtureGit(projectPath,base);
    prepared=true;
    lock=acquireProjectLock(base,projectPath);
    let published=false;
    const adapters=createStandaloneSafeWorkflowAdapters({
      projectPath,lockBase:base,lockToken:lock.record.token,
      scripts:['studio-smoke'],timeoutMs:10000,
    },{
      planner:async()=>({summary:'Check disposable fixture',steps:['Read Git','Run test']}),
      builder:async()=>({summary:'No modifications necessary'}),
      reviewer:async(_issue,_plan,_build,evidence)=>{
        if(evidence.identity.branch!=='autodev/issue-1' ||
            !/^[a-f0-9]{64}$/.test(evidence.fingerprint))
          return {verdict:'FAIL' as const,blockers:1,feedback:'Fixture evidence mismatch'};
        return {verdict:'PASS' as const,blockers:0,summary:'Fixture checked'};
      },
      publish:async()=>{published=true;}, // Never sends a network request.
    },deps.quality??runIsolatedQualityGates,deps.collect??collectReviewEvidence);
    const outcome=await orchestrateIssue(
      {number:1,title:'Local sandbox integration',body:'Fixed fixture only'},
      adapters,{maxFixAttempts:0},
    );
    return outcome.state.stage==='done'&&published
      ? {passed:true,reason:'passed'}
      : {passed:false,reason:'pipeline-failed'};
  }catch{
    return {passed:false,reason:prepared?'pipeline-failed':'setup-failed'};
  }finally{
    try{lock?.release()}catch{/* preserve lock error; fixture is disposable */}
    fs.rmSync(base,{recursive:true,force:true});
  }
}
