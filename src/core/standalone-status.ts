import { inspectGitPreflight, type GitPreflight } from './git-preflight.ts';
import { inspectProjectLock, projectLockDirectoryExists } from './project-lock.ts';
import { loadCoreCheckpoint, type CoreCheckpoint, type GitIdentity } from './checkpoint-store.ts';
import { captureGitIdentity } from './git-identity.ts';

export interface CheckpointRecovery {
  state:'none'|'locked'|'inspect'|'manual';
  identityMatches:boolean|null;
  reason:string;
  automaticResume:false;
}
/** Read-only assessment. Even matching identity is not permission to run.
 * A publish checkpoint may represent a completed external side effect.
 */
export function assessCheckpointRecovery(
  checkpoint:CoreCheckpoint|null,lockHeld:boolean,identity:GitIdentity|null,
):CheckpointRecovery {
  if(lockHeld)return {state:'locked',identityMatches:null,
    reason:'Projektlock aktiv oder verwaist: zuerst laufenden Prozess prüfen',automaticResume:false};
  if(!checkpoint)return {state:'none',identityMatches:null,
    reason:'Kein gespeicherter Issue-Lauf',automaticResume:false};
  if(checkpoint.stage==='publish')
    return {state:'manual',identityMatches:null,
      reason:'Publish-Checkpoint: Ein Commit, Push oder Draft-PR kann bereits existieren. GitHub und lokalen Git-Stand vor jeder Wiederholung abgleichen',
      automaticResume:false};
  if(checkpoint.stage==='done')
    return {state:'manual',identityMatches:null,
      reason:'Abgeschlossener Checkpoint wurde noch nicht abgeglichen. PR und Issue-Abschluss prüfen; keine neue Bearbeitung starten',
      automaticResume:false};
  if(checkpoint.stage==='blocked')
    return {state:'manual',identityMatches:null,
      reason:'Workflow wurde als BLOCKED gespeichert. Der konkrete ursprüngliche Fehler ist im Checkpoint nicht enthalten. Laufprotokoll, Git-Stand und Review-/Quality-Befunde prüfen; kein automatischer Reset',
      automaticResume:false};
  if(!identity)return {state:'manual',identityMatches:null,
    reason:'Git-Identität kann nicht sicher geprüft werden',automaticResume:false};
  if(checkpoint.stage==='build'&&!checkpoint.sessions.builder)
    return {state:'manual',identityMatches:null,
      reason:'Builder-Checkpoint ohne überprüfbare Kilo-Session-ID. Ein automatisches Resume könnte einen zweiten Builder starten; zuerst Laufprotokoll prüfen',
      automaticResume:false};
  if(checkpoint.stage==='review'&&!checkpoint.sessions.reviewer)
    return {state:'manual',identityMatches:null,
      reason:'Review-Checkpoint ohne überprüfbare Reviewer-Session-ID. Nicht blind neu starten; Git- und Review-Evidenz zuerst prüfen',
      automaticResume:false};
  const matches=checkpoint.git.branch===identity.branch &&
    checkpoint.git.head===identity.head &&
    checkpoint.git.worktreeHash===identity.worktreeHash &&
    checkpoint.git.branch===`autodev/issue-${checkpoint.issueNumber}`;
  return matches
    ?{state:'inspect',identityMatches:true,
      reason:'Git-Zustand passt zum Checkpoint. Vor manueller Fortsetzung Schutz, Review und Quality erneut prüfen',
      automaticResume:false}
    :{state:'manual',identityMatches:false,
      reason:'Git-Zustand weicht vom Checkpoint ab. Kein Reset, Commit oder erneuter Push ohne Prüfung',
      automaticResume:false};
}
export interface StandaloneStatus {
  git: GitPreflight;
  lock: { held: boolean; startedAt: string | null };
  checkpoint: {
    issueNumber: number; stage: string; revision: number;
    savedAt: string; reviewPassed: boolean; qualityPassed: boolean;
  } | null;
  recovery: CheckpointRecovery;
  executionEnabled: false;
}

/** Read-only status for any Git repository. Never assumes a legacy in-project core.
 * Malformed checkpoints fail closed: report an error, never silently clear them.
 * Tokens and role session IDs must not be exposed to the renderer.
 */
export async function inspectStandaloneStatus(base: string, projectPath: string): Promise<StandaloneStatus> {
  const git = await inspectGitPreflight(projectPath);
  const lock = inspectProjectLock(base, projectPath);
  const checkpoint = loadCoreCheckpoint(base, projectPath);
  const locked=projectLockDirectoryExists(base,projectPath);
  let identity:GitIdentity|null=null;
  if(checkpoint&&!locked&&!['publish','done','blocked'].includes(checkpoint.stage)){
    try{identity=await captureGitIdentity(projectPath);}
    catch{identity=null;}
  }
  return {
    git,
    lock: { held: locked, startedAt: lock?.startedAt ?? null },
    recovery: assessCheckpointRecovery(checkpoint,locked,identity),
    checkpoint: checkpoint ? {
      issueNumber: checkpoint.issueNumber, stage: checkpoint.stage,
      revision: checkpoint.revision, savedAt: checkpoint.savedAt,
      reviewPassed: checkpoint.reviewPassed, qualityPassed: checkpoint.qualityPassed,
    } : null,
    executionEnabled: false,
  };
}
