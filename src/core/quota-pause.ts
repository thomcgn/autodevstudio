import type {GitIdentity, CoreCheckpoint} from './checkpoint-store.ts';
import {loadCoreCheckpoint,saveCoreCheckpoint,assertCoreResumeEligible} from './checkpoint-store.ts';
import {inspectProjectLock} from './project-lock.ts';
import type {QuotaPhase,QuotaDecision} from './free-quota-guard.ts';
import {FreeQuotaGuard} from './free-quota-guard.ts';

export interface QuotaPauseResult {
  paused:true;
  issueNumber:number;
  stage:CoreCheckpoint['stage'];
  revision:number;
  quotaReason:'reserve'|'rate-limit'|'unknown-remaining';
  retryAt:number|null;
}
/** The caller must already hold the project lock and have saved a checkpoint.
 * No checkout, commit, publish or inference runs while entering pause.
 * Strict mode: an unknown provider remainder MUST create a pause.
 */
export function pauseForQuota(base:string,projectPath:string,lockToken:string,
  currentGit:GitIdentity,guard:FreeQuotaGuard,phase:QuotaPhase='normal'):QuotaPauseResult {
  const decision=guard.decide(phase,true);
  if(decision.allowed)throw Error('No quota pause required');
  const checkpoint=loadCoreCheckpoint(base,projectPath);
  if(!checkpoint)throw Error('Cannot pause without durable checkpoint');
  const owner=inspectProjectLock(base,projectPath);
  if(!owner||owner.token!==lockToken)throw Error('Quota pause requires owned project lock');
  if(checkpoint.git.head!==currentGit.head||checkpoint.git.branch!==currentGit.branch||
     checkpoint.git.worktreeHash!==currentGit.worktreeHash)
    throw Error('Repository drift before quota pause');
  const saved=saveCoreCheckpoint(base,projectPath,lockToken,{
    runId:checkpoint.runId,issueNumber:checkpoint.issueNumber,stage:checkpoint.stage,
    git:checkpoint.git,sessions:checkpoint.sessions,reviewPassed:checkpoint.reviewPassed,
    qualityPassed:checkpoint.qualityPassed,
  },checkpoint.revision);
  return {paused:true,issueNumber:saved.issueNumber,stage:saved.stage,revision:saved.revision,
    quotaReason:decision.reason as QuotaPauseResult['quotaReason'],retryAt:decision.retryAt};
}
/** An expired timer NEVER resumes work. Resume requires current quota permission,
 * exact saved revision, locked project and Git identity, and freshly
 * provider-verified remaining quota. Publish remains manual.
 */
export function assertQuotaResume(base:string,projectPath:string,lockToken:string,
  expectedRevision:number,currentGit:GitIdentity,guard:FreeQuotaGuard,
  phase:QuotaPhase='normal'):CoreCheckpoint {
  const owner=inspectProjectLock(base,projectPath);
  if(!owner||owner.token!==lockToken)throw Error('Resume requires owned project lock');
  const checkpoint=loadCoreCheckpoint(base,projectPath);
  if(!checkpoint||checkpoint.revision!==expectedRevision)throw Error('Stale quota checkpoint');
  assertCoreResumeEligible(checkpoint,projectPath,currentGit);
  const decision:QuotaDecision=guard.decide(phase,true);
  if(!decision.allowed)throw Error('Quota remains unavailable: '+decision.reason);
  return checkpoint;
}
