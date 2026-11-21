import type { IssueTask, QualityResult } from './orchestrator.ts';
import type { QualityGateConfig } from './quality-gates.ts';
import type { ReviewEvidence } from './review-evidence.ts';
import type { EvidenceAwareWorkflowAdapters } from './integrity-guarded-adapters.ts';
import { createIntegrityGuardedAdapters } from './integrity-guarded-adapters.ts';
import { collectReviewEvidence } from './review-evidence.ts';
import { runIsolatedQualityGates } from './isolated-quality-gates.ts';
import type { WorkflowAdapters } from './orchestrator.ts';
import type { EvidenceCollector } from './review-evidence-verdict.ts';

export interface IsolatedQualityWorkflowConfig {
  /** The caller owns an exclusive per-project lock and explicitly approves scripts. */
  projectPath: string;
  scripts: readonly string[];
  timeoutMs: number;
  signal?: AbortSignal;
  /** Optional bounded log sink, never pass raw output to a model. */
  onQualityOutput?: QualityGateConfig['onOutput'];
}

type ReviewerAndBuildAdapters = Omit<EvidenceAwareWorkflowAdapters, 'quality'>;
export type QualityGateExecutor = (config: QualityGateConfig) => Promise<QualityResult>;

/** Connect the already tested isolated npm runner to the evidence-bound issue
 * workflow. Real production controllers MUST supply a separately isolated
 * reviewer, a lock and an authorized publish callback: this factory does not
 * authenticate a model or unlock a workflow.
 *
 * No fallback to host npm. A failed quality run never publishes. The evidence
 * guard re-collects the repository fingerprint after scripts have completed.
 */
export function createIsolatedQualityWorkflowAdapters(
  config: IsolatedQualityWorkflowConfig,
  adapters: ReviewerAndBuildAdapters,
  quality: QualityGateExecutor = runIsolatedQualityGates,
  collect: EvidenceCollector = collectReviewEvidence,
): WorkflowAdapters {
  if (!Array.isArray(config.scripts) || config.scripts.length === 0)
    throw new Error('Explicitly approved isolated quality scripts required');
  if (adapters.quality !== undefined)
    throw new Error('Quality callback must be supplied by isolated controller only');
  return createIntegrityGuardedAdapters(
    config.projectPath,
    {
      ...adapters,
      async quality(_issue: IssueTask) {
        return quality({
          cwd: config.projectPath,
          scripts: [...config.scripts],
          timeoutMs: config.timeoutMs,
          signal: config.signal,
          onOutput: config.onQualityOutput,
        });
      },
    },
    config.signal,
    collect,
  );
}
