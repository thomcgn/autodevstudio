import type { WorkflowAdapters, QualityResult } from './orchestrator.ts';
import type { EvidenceAwareWorkflowAdapters } from './integrity-guarded-adapters.ts';
import type { QualityGateConfig } from './quality-gates.ts';
import type { EvidenceCollector } from './review-evidence-verdict.ts';
import { collectReviewEvidence } from './review-evidence.ts';
import {
  createIsolatedQualityWorkflowAdapters, type IsolatedQualityWorkflowConfig,
} from './isolated-quality-workflow.ts';
import { runIsolatedQualityGates } from './isolated-quality-gates.ts';
import {
  createProjectLockGuardedAdapters, assertWorkflowLockOwned,
  type OwnedWorkflowLock,
} from './project-lock-guarded-adapters.ts';

export interface StandaloneSafeAdapterConfig extends IsolatedQualityWorkflowConfig {
  /** Acquired with acquireProjectLock; controller keeps ownership until run ends. */
  lockBase: string;
  lockToken: string;
}
type TrustedCoreAdapters = Omit<EvidenceAwareWorkflowAdapters,'quality'>;
export type SafeQualityExecutor = (config: QualityGateConfig) => Promise<QualityResult>;

/** This composes ALL mandatory Stage guards for the future standalone controller:
 *
 * owned project lock -> independently reviewed evidence snapshot ->
 * isolated npm gates -> revalidate evidence -> single-use publication.
 *
 * This function does NOT itself authorize a model, create a project branch,
 * access credentials, start Kilo or enable remote publishing. The caller must
 * still supply a sandboxed and independently audited reviewer and a separately
 * approved publish implementation.
 *
 * Optional dependencies are used only by hermetic tests. Production callers
 * should not pass these overrides.
 */
export function createStandaloneSafeWorkflowAdapters(
  config: StandaloneSafeAdapterConfig,
  adapters: TrustedCoreAdapters,
  quality: SafeQualityExecutor = runIsolatedQualityGates,
  collect: EvidenceCollector = collectReviewEvidence,
): WorkflowAdapters {
  const lock: OwnedWorkflowLock = {
    base: config.lockBase, projectPath: config.projectPath,
    token: config.lockToken,
  };
  assertWorkflowLockOwned(lock);
  const guardedQuality = createIsolatedQualityWorkflowAdapters(config,adapters,quality,collect);
  return createProjectLockGuardedAdapters(lock,guardedQuality);
}
