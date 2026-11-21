import type {WorkflowAdapters,IssueTask} from './orchestrator.ts';
import {FreeQuotaGate,QuotaPauseError,type FreeQuotaSnapshot} from './free-quota-gate.ts';

export type PendingStage='plan'|'build'|'review';
export interface QuotaPauseRecord {
  issueNumber:number;
  stage:PendingStage;
  /** No fabricated reset time: null is legitimate. */
  pauseUntil:number|null;
  source:FreeQuotaSnapshot['source'];
  reason:FreeQuotaSnapshot['reason'];
}
/** Application controller MUST persist and lock an identity-validated checkpoint
 * on onPause before exposing a resumable status. This wrapper itself has no
 * filesystem, Git or publishing privileges; it never retries automatically.
 */
export function guardWorkflowWithQuota(
  adapters:WorkflowAdapters,
  quota:FreeQuotaGate,
  onPause:(record:QuotaPauseRecord)=>Promise<void>,
):WorkflowAdapters {
  if(typeof onPause!=='function')throw Error('Checkpoint callback required');
  const gate=async(stage:PendingStage,issue:IssueTask)=>{
    try{quota.assertAllowed('work');}
    catch(error){
      if(!(error instanceof QuotaPauseError))throw error;
      const snapshot=error.snapshot;
      await onPause({
        issueNumber:issue.number,stage,
        pauseUntil:snapshot.pauseUntil,
        reason:snapshot.reason,source:snapshot.source,
      });
      throw error; // never continue to next agent after checkpoint
    }
  };
  return {
    async planner(issue){await gate('plan',issue);return adapters.planner(issue);},
    async builder(issue,plan,feedback){await gate('build',issue);return adapters.builder(issue,plan,feedback);},
    async reviewer(issue,plan,build){await gate('review',issue);return adapters.reviewer(issue,plan,build);},
    quality:issue=>adapters.quality(issue),
    publish:issue=>adapters.publish(issue),
  };
}
