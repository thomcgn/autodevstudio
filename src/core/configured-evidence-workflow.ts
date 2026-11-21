import type { WorkflowAdapters } from './orchestrator.ts';
import type { StandaloneSafeAdapterConfig, SafeQualityExecutor } from './standalone-safe-adapters.ts';
import type { EvidenceOnlyStages } from './evidence-only-standalone-workflow.ts';
import { createEvidenceOnlyStandaloneWorkflow } from './evidence-only-standalone-workflow.ts';
import type { EvidenceCollector } from './review-evidence-verdict.ts';
import { collectReviewEvidence } from './review-evidence.ts';
import { runIsolatedQualityGates } from './isolated-quality-gates.ts';
import {
  createSelectedReviewerTransport, type ReviewerProviderConfiguration,
} from './reviewer-provider-selection.ts';

/** Full, but intentionally STILL INERT, integration seam.
 *
 * The controller must hold the exclusive project lock, explicitly authorize
 * the issue/branch, scripts, provider and publishing callback, and never hand
 * untrusted renderer/issue input to this factory as authority.
 *
 * Production code should not inject the test-only quality/collector/fetch
 * overrides. This factory alone cannot authorize a run or provider billing.
 */
export function createConfiguredEvidenceWorkflow(
  config:StandaloneSafeAdapterConfig,
  stages:EvidenceOnlyStages,
  provider:ReviewerProviderConfiguration,
  quality:SafeQualityExecutor=runIsolatedQualityGates,
  collect:EvidenceCollector=collectReviewEvidence,
  fetcher:typeof fetch=fetch,
):WorkflowAdapters {
  const reviewerTransport=createSelectedReviewerTransport(provider,fetcher);
  return createEvidenceOnlyStandaloneWorkflow(config,stages,reviewerTransport,quality,collect);
}
