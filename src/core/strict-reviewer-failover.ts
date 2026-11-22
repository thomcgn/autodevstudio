import type {EvidenceOnlyReviewerTransport} from './evidence-only-reviewer.ts';
import type {KiloFreeModel} from './kilo-free-models.ts';
import type {FreeQuotaGuard} from './free-quota-guard.ts';
import {createSelectedReviewerTransport} from './reviewer-provider-selection.ts';

const LOCAL_MODEL='qwen2.5-coder:3b';
export interface StrictReviewerFailoverConfig {
  /** All fields MUST come from trusted Main orchestration, never a renderer,
   * GitHub issue, model output or an unverified cached catalog.
   */
  kiloModel:string;
  builderModel:string;
  freeCatalog:readonly KiloFreeModel[];
  quota:FreeQuotaGuard;
  local:{
    enabled:boolean;
    model:string;
    ready:boolean;
    calibrationPassed:boolean;
    /** Only when the controller has verified the tool-free channel. */
    toolFreeTransportApproved:boolean;
  };
}
export type ReviewerFailoverReason=
  'cloud-unavailable'|'local-not-approved'|'reviewer-model-not-independent';

function isVerifiedFreeModel(model:string,catalog:readonly KiloFreeModel[]):boolean{
  return (model==='kilo-auto/free'||model.endsWith(':free'))&&
    catalog.some(entry=>entry.id===model);
}
function mayUseLocal(config:StrictReviewerFailoverConfig):boolean{
  return config.local.enabled===true&&
    config.local.model===LOCAL_MODEL&&
    config.local.ready===true&&
    config.local.calibrationPassed===true&&
    config.local.toolFreeTransportApproved===true&&
    config.local.model!==config.builderModel;
}
/** Builds a provider transport ONLY; cannot publish, commit, launch tools or
 * authorize the release of repository data. Production callers must hold
 * the project lock, authorize the issue and evidence disclosure, and validate
 * Git/reviewer/quality gates independently.
 *
 * Never switches from Kilo to another Kilo free model to escape the shared IP
 * limit. Local fallback is only for a separately opted-in, calibrated,
 * tool-free reviewer, not Planner or Builder.
 */
export function createStrictReviewerFailoverTransport(
  config:StrictReviewerFailoverConfig,
  fetcher:typeof fetch=fetch,
):EvidenceOnlyReviewerTransport {
  if(!config||!config.quota||!config.local||!Array.isArray(config.freeCatalog))
    throw Error('Invalid reviewer failover configuration');
  const kiloEligible=isVerifiedFreeModel(config.kiloModel,config.freeCatalog)&&
    config.kiloModel!==config.builderModel;
  const localEligible=mayUseLocal(config);
  const localTransport=localEligible?createSelectedReviewerTransport({
    provider:'ollama-local',model:LOCAL_MODEL,timeoutMs:150000,
  },fetcher):null;
  const cloudTransport=kiloEligible?createSelectedReviewerTransport({
    provider:'kilo-gateway',model:config.kiloModel,gatewayKey:()=>null,
    timeoutMs:120000,
    onBeforeRequest:()=>config.quota.recordAttempt('normal',true),
    onRateLimited:()=>config.quota.recordRateLimit(),
  },fetcher):null;

  return async(request,signal)=>{
    if(signal?.aborted)throw Error('Review cancelled before provider selection');
    const quota=config.quota.decide('normal',true);
    if(!quota.allowed||!cloudTransport){
      if(localTransport)return localTransport(request,signal);
      if(!cloudTransport&&config.kiloModel===config.builderModel)
        throw Error('Reviewer model not independent');
      throw Error('No approved reviewer provider available');
    }
    try{
      return await cloudTransport(request,signal);
    }catch(error){
      // A genuine HTTP 429 is the ONLY cloud failure that may switch provider
      // inside a request. Invalid responses, timeouts and authorization errors
      // must stop for human investigation.
      const rateLimited=error instanceof Error&&
        error.message==='Kilo Gateway free rate limited (HTTP 429)';
      if(rateLimited&&localTransport&&!signal?.aborted)
        return localTransport(request,signal);
      throw error;
    }
  };
}
