import type { IssueTask, PlanResult, BuildResult, WorkflowAdapters } from './orchestrator.ts';
import type { StandaloneSafeAdapterConfig, SafeQualityExecutor } from './standalone-safe-adapters.ts';
import { createStandaloneSafeWorkflowAdapters } from './standalone-safe-adapters.ts';
import type { EvidenceCollector } from './review-evidence-verdict.ts';
import { collectReviewEvidence } from './review-evidence.ts';
import { runIsolatedQualityGates } from './isolated-quality-gates.ts';
import {
  createEvidenceOnlyReviewer, type EvidenceOnlyReviewerTransport,
} from './evidence-only-reviewer.ts';

/** Trusted stage handlers. They MUST be invoked under the owning project lock.
 * Reviewer is intentionally NOT supplied by the caller: it is always created
 * from evidence-only transport, never a normal Kilo reviewer agent.
 */
export interface EvidenceOnlyStages {
  planner(issue:IssueTask):Promise<PlanResult>;
  builder(issue:IssueTask,plan:PlanResult,feedback:string[]):Promise<BuildResult>;
  publish(issue:IssueTask):Promise<void>;
}
/** Future controller seam only. Supplying a transport function alone does not
 * prove OS isolation; the Main controller is responsible for attestation,
 * minimal credentials and provider-authenticated, tool-free execution.
 */
export function createEvidenceOnlyStandaloneWorkflow(
  config:StandaloneSafeAdapterConfig,
  stages:EvidenceOnlyStages,
  reviewerTransport:EvidenceOnlyReviewerTransport,
  quality:SafeQualityExecutor=runIsolatedQualityGates,
  collect:EvidenceCollector=collectReviewEvidence,
):WorkflowAdapters {
  if(typeof reviewerTransport!=='function')
    throw new Error('Independent model-only reviewer transport is mandatory');
  const reviewer=createEvidenceOnlyReviewer(reviewerTransport,config.signal);
  return createStandaloneSafeWorkflowAdapters(config,{
    planner:stages.planner,
    builder:stages.builder,
    reviewer,
    publish:stages.publish,
  },quality,collect);
}
