import type {EvidenceOnlyReviewerTransport} from './evidence-only-reviewer.ts';
import type {KiloRoleModels} from './kilo-role-models.ts';
import type {KiloFreeModel} from './kilo-free-models.ts';
import type {OllamaReadinessResult} from './ollama-readiness.ts';
import type {FreeQuotaGuard} from './free-quota-guard.ts';
import {readLocalReviewFallback} from './local-review-fallback-settings.ts';
import {readLocalReviewCalibration} from './local-review-calibration-record.ts';
import {createStrictReviewerFailoverTransport} from './strict-reviewer-failover.ts';

const LOCAL_MODEL='qwen2.5-coder:3b';
/** Trusted internal factory inputs; do not accept a renderer-supplied model,
 * calibration flag, quota, endpoint URL, or reviewer permissions.
 */
export interface ProjectReviewerFailoverInputs {
  userData:string;
  projectId:string;
  roles:KiloRoleModels;
  freeCatalog:readonly KiloFreeModel[];
  quota:FreeQuotaGuard;
  ollamaReadiness:OllamaReadinessResult;
}

/** Constructs only a model-only evidence transport, not an executable job.
 * The gate values come from real project-scoped persisted opt-in/calibration
 * and the exact local HTTP adapter, never from loose UI booleans.
 *
 * The actual controller must STILL acquire the project lock, validate Git
 * identity, authorize data disclosure, and enforce Quality/PASS before any
 * issue data reaches this transport. This factory does none of those steps.
 */
export function createAttestedProjectReviewerTransport(
  input:ProjectReviewerFailoverInputs,
  fetcher:typeof fetch=fetch,
):EvidenceOnlyReviewerTransport {
  if(!input||!input.roles||!input.quota||!Array.isArray(input.freeCatalog))
    throw Error('Invalid attested reviewer configuration');
  // A controller may hold a transport across several issues. Recheck the
  // project-scoped opt-in and expiring calibration immediately before EVERY
  // evidence request: disabling the fallback cannot leave a stale, approved
  // transport in memory. This only creates a model transport, not a job.
  return (request,signal)=>{
    if(signal?.aborted)throw Error('Review cancelled before attestation');
    const enabled=readLocalReviewFallback(input.userData,input.projectId);
    const calibrationPassed=readLocalReviewCalibration(input.userData,input.projectId);
    const transport=createStrictReviewerFailoverTransport({
      kiloModel:input.roles.reviewer,
      builderModel:input.roles.builder,
      freeCatalog:input.freeCatalog,
      quota:input.quota,
      local:{
        enabled,
        model:LOCAL_MODEL,
        ready:input.ollamaReadiness.ready===true&&input.ollamaReadiness.reason==='ready',
        calibrationPassed,
        // The channel is a fixed loopback model-only HTTP transport; no tools,
        // filesystem access, dynamic endpoint or process launch.
        toolFreeTransportApproved:true,
      },
    },fetcher);
    return transport(request,signal);
  };
}
