import type { WorkflowAdapters, IssueTask, PlanResult, BuildResult, ReviewResult } from './orchestrator.ts';
import type { ReviewEvidence } from './review-evidence.ts';
import { collectReviewEvidence } from './review-evidence.ts';
import {
  reviewEvidenceBound, assertBoundReviewStillCurrent,
  type BoundReviewVerdict, type EvidenceCollector,
} from './review-evidence-verdict.ts';

export interface EvidenceAwareWorkflowAdapters extends Omit<WorkflowAdapters,'reviewer'> {
  /** The reviewer receives the *verified* evidence, not a builder's claims.
   * Implementation must use an independent, OS-isolated reviewer transport.
   */
  reviewer(issue: IssueTask, plan: PlanResult, build: BuildResult, evidence: Readonly<ReviewEvidence>): Promise<ReviewResult>;
}

/** Connects independently verified reviewer evidence with the workflow stages.
 *
 * - Every builder attempt invalidates the previous approval.
 * - A PASS must match unchanged Git evidence before & after the reviewer.
 * - Quality must not change Git evidence, including tracked/untracked content.
 * - Publish requires both a fresh PASS and a completed successful quality gate.
 *
 * This is a defense-in-depth adapter, NOT a permission to run Kilo or publish.
 * The trusted controller must supply independently isolated reviewer execution,
 * project-lock ownership, authorization and safe publish implementation.
 */
export function createIntegrityGuardedAdapters(
  projectPath: string,
  adapters: EvidenceAwareWorkflowAdapters,
  signal?: AbortSignal,
  collect: EvidenceCollector = collectReviewEvidence,
): WorkflowAdapters {
  let approval: BoundReviewVerdict | null = null;
  let qualityApproved = false;
  let activeIssue: number | null = null;
  const invalidate = (): void => {
    approval = null;
    qualityApproved = false;
  };
  const ensureActive = (): void => {
    if (signal?.aborted) throw new Error('Workflow cancelled');
  };
  const requireApproval = async (number: number): Promise<void> => {
    ensureActive();
    if (!approval || activeIssue !== number) throw new Error('No current reviewer PASS');
    await assertBoundReviewStillCurrent(projectPath,number,approval,signal,collect);
    ensureActive();
  };
  return {
    planner: async issue => {
      invalidate();
      activeIssue=issue.number;
      ensureActive();
      return adapters.planner(issue);
    },
    builder: async (issue,plan,feedback) => {
      invalidate();
      if (activeIssue!==issue.number) throw new Error('Issue changed during builder phase');
      ensureActive();
      return adapters.builder(issue,plan,feedback);
    },
    reviewer: async (issue,plan,build) => {
      invalidate();
      if (activeIssue!==issue.number) throw new Error('Issue changed during reviewer phase');
      ensureActive();
      const bound=await reviewEvidenceBound(projectPath,issue.number,
        evidence=>adapters.reviewer(issue,plan,build,evidence),signal,collect);
      if (bound.verdict.verdict === 'PASS') approval=bound;
      return bound.verdict;
    },
    quality: async issue => {
      qualityApproved=false;
      await requireApproval(issue.number);
      const result=await adapters.quality(issue);
      ensureActive();
      if (!result.passed) return result;
      // Running project scripts can change tracked/untracked files: revoke PASS.
      await requireApproval(issue.number);
      qualityApproved=true;
      return result;
    },
    publish: async issue => {
      if (!qualityApproved) throw new Error('Publish requires successful quality gate');
      await requireApproval(issue.number);
      // A publication is single-use. On failure, recovery must be explicit.
      invalidate();
      ensureActive();
      await adapters.publish(issue);
    },
  };
}
