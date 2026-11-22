import {captureGitIdentity} from './git-identity.ts';
import {loadCoreCheckpoint,saveCoreCheckpoint,type GitIdentity} from './checkpoint-store.ts';
import {inspectProjectLock} from './project-lock.ts';
import {requireReviewedEvidenceProof} from './review-approval-proof.ts';
import {runTrustedQualityGates,type QualityScriptRunner} from './quality-gates.ts';
import {runIsolatedNpmScript} from './isolated-quality.ts';
import {auditReviewedSource,type ReviewedSourceAudit} from './audit-reviewed-source.ts';
import {writeQualityRunReport,type QualityRunReport} from './quality-report.ts';

export interface VerifiedQualityResult {
  kind:'quality-passed'|'quality-failed';
  issueNumber:number;
  checkpointRevision:number;
  reviewedFingerprint:string;
  feedback?:string;
  publishAuthorized:false;
}
export interface QualityGateDependencies {
  capture:(projectPath:string)=>Promise<GitIdentity>;
  runScript:QualityScriptRunner;
  audit:(projectPath:string)=>Promise<ReviewedSourceAudit>;
}
const defaultDependencies:QualityGateDependencies={
  capture:captureGitIdentity,runScript:runIsolatedNpmScript,
  audit:auditReviewedSource,
};
const same=(a:GitIdentity,b:GitIdentity):boolean=>
  a.head===b.head&&a.branch===b.branch&&a.worktreeHash===b.worktreeHash;

/** Executes explicitly selected npm scripts in the existing isolated quality
 * sandbox, with NO network and read-only Git metadata. Refuses to trust a
 * reviewPassed boolean without the persisted evidence fingerprint proof.
 * Never commits/pushes/publishes. A model cannot select a script.
 *
 * Quality succeeds only if no script modifies the exact reviewed tree.
 * Any crash or failed test leaves reviewPassed true, qualityPassed false.
 */
export async function verifyQualityForReviewedIssue(
  base:string,projectPath:string,lockToken:string,expectedRevision:number,
  approvedScripts:readonly string[],signal?:AbortSignal,
  dependencies:QualityGateDependencies=defaultDependencies,
):Promise<VerifiedQualityResult>{
  if(signal?.aborted)throw Error('Quality cancelled');
  const owner=inspectProjectLock(base,projectPath);
  if(!owner||owner.token!==lockToken)throw Error('Quality gate requires owned project lock');
  const cp=loadCoreCheckpoint(base,projectPath);
  if(!cp||cp.revision!==expectedRevision||cp.stage!=='quality'||
     !cp.reviewPassed||cp.qualityPassed)
    throw Error('Quality checkpoint missing, stale or already completed');
  const gitBefore=await dependencies.capture(projectPath);
  if(!same(cp.git,gitBefore))throw Error('Repository drift before quality');
  const proof=requireReviewedEvidenceProof(base,projectPath,cp,gitBefore);
  const record=(outcome:'passed'|'failed',feedback:string,findings:ReviewedSourceAudit['findings'],revision:number)=>{
    const report:QualityRunReport={
      schemaVersion:1,issueNumber:cp.issueNumber,runId:cp.runId,
      reviewFingerprint:proof.evidenceFingerprint,checkpointRevision:revision,
      outcome,checks:['clean-code','solid','dry','security',...approvedScripts],
      findings:findings.slice(0,40),feedback:feedback.slice(0,1200),
      recordedAt:new Date().toISOString(),
    };
    writeQualityRunReport(base,projectPath,lockToken,report);
  };
  if(signal?.aborted)throw Error('Quality cancelled');
  const audit=await dependencies.audit(projectPath);
  if(!audit.passed){
    const feedback='Clean Code/SOLID/DRY/Security: '+audit.findings.slice(0,5)
      .map(f=>f.rule+' at '+audit.changedFile+':'+f.line).join('; ');
    record('failed',feedback,audit.findings,expectedRevision);
    return {
      kind:'quality-failed',issueNumber:cp.issueNumber,
      checkpointRevision:expectedRevision,reviewedFingerprint:proof.evidenceFingerprint,
      feedback,publishAuthorized:false,
    };
  }
  const result=await runTrustedQualityGates({
    cwd:projectPath,scripts:approvedScripts,timeoutMs:120000,signal,
  },dependencies.runScript);
  if(signal?.aborted)throw Error('Quality cancelled');
  const gitAfter=await dependencies.capture(projectPath);
  if(!same(gitAfter,gitBefore))throw Error('Quality scripts modified the reviewed Git tree');
  const ownerAfter=inspectProjectLock(base,projectPath);
  if(!ownerAfter||ownerAfter.token!==lockToken)
    throw Error('Quality project lock was lost');
  const cpAfter=loadCoreCheckpoint(base,projectPath);
  if(!cpAfter||cpAfter.revision!==expectedRevision||
    cpAfter.runId!==cp.runId||cpAfter.issueNumber!==cp.issueNumber||
    cpAfter.stage!=='quality'||!cpAfter.reviewPassed||
    cpAfter.qualityPassed||!same(cpAfter.git,gitAfter))
    throw Error('Quality checkpoint changed during tests');
  // Re-read the durable receipt after scripts. Scripts are untrusted project
  // programs, including ones which return exit 0.
  requireReviewedEvidenceProof(base,projectPath,cpAfter,gitAfter);
  if(!result.passed){
    record('failed',result.feedback??'Quality scripts failed',[],expectedRevision);
    return {
      kind:'quality-failed',issueNumber:cp.issueNumber,
      checkpointRevision:expectedRevision,reviewedFingerprint:proof.evidenceFingerprint,
      feedback:result.feedback,publishAuthorized:false,
    };
  }
  const next=saveCoreCheckpoint(base,projectPath,lockToken,{
    runId:cp.runId,issueNumber:cp.issueNumber,stage:'quality',
    git:gitAfter,sessions:cp.sessions,reviewPassed:true,qualityPassed:true,
  },expectedRevision);
  record('passed','Static analysis and required scripts passed',[],next.revision);
  return {
    kind:'quality-passed',issueNumber:cp.issueNumber,
    checkpointRevision:next.revision,reviewedFingerprint:proof.evidenceFingerprint,
    publishAuthorized:false,
  };
}
