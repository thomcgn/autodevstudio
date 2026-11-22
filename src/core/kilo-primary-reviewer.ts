import type {KiloRoleModels} from './kilo-role-models.ts';
import type {KiloFreeModel} from './kilo-free-models.ts';
import {validateRoleModels} from './kilo-role-models.ts';
import {FreeQuotaGuard} from './free-quota-guard.ts';
import {createSelectedReviewerTransport} from './reviewer-provider-selection.ts';
import {createLocalOllamaReviewerChannel} from './local-ollama-reviewer.ts';
import {createReviewerGatewayTransport} from './reviewer-gateway-protocol.ts';
import {readLocalReviewFallback} from './local-review-fallback-settings.ts';
import {readLocalReviewCalibration} from './local-review-calibration-record.ts';
import {probeOllamaReadiness} from './ollama-readiness.ts';
import type {EvidenceOnlyReviewerTransport} from './evidence-only-reviewer.ts';

const LOCAL='qwen2.5-coder:3b';
/** Kilo free catalog is authoritative for planner/builder/reviewer models.
 * If not configured, pick preferred free model for Builder and the first
 * DIFFERENT verified-free model for independent text-only review.
 */
export function selectPrimaryKiloRoles(
  selected:KiloRoleModels|null,catalog:readonly KiloFreeModel[],
):KiloRoleModels{
  if(selected){
    const roles=validateRoleModels(selected,catalog);
    if(roles.reviewer===roles.builder)
      throw Error('Kilo reviewer must use a different model from Builder');
    return roles;
  }
  const builder=catalog.find(m=>m.preferred)??catalog[0];
  const reviewer=catalog.find(m=>m.id!==builder?.id);
  if(!builder||!reviewer)throw Error('At least two independently selected Kilo free models required');
  return validateRoleModels({
    planner:builder.id,builder:builder.id,reviewer:reviewer.id,
  },catalog);
}
export interface KiloPrimaryReviewer {
  transport:EvidenceOnlyReviewerTransport;
  canReview:()=>Promise<{ready:boolean;reason:string}>;
}
/** The Kilo Gateway, not Ollama, is ALWAYS attempted first when its quota
 * guard allows a request. Unknown upstream remaining is NOT presented as
 * verified: locally budget conservatively and record genuine HTTP 429.
 * Explicitly opted-in, calibrated local Qwen is a 429/offline fallback only.
 */
export function createKiloPrimaryReviewer(
  userData:string,projectId:string,roles:KiloRoleModels,
  catalog:readonly KiloFreeModel[],quota:FreeQuotaGuard,
  fetcher:typeof fetch=fetch,
):KiloPrimaryReviewer{
  const valid=validateRoleModels(roles,catalog);
  if(valid.reviewer===valid.builder)
    throw Error('Kilo reviewer cannot use Builder model');
  const kilo=createSelectedReviewerTransport({
    provider:'kilo-gateway',model:valid.reviewer,gatewayKey:()=>null,
    timeoutMs:120000,
    onBeforeRequest:()=>quota.recordAttempt('normal',false),
    onRateLimited:()=>quota.recordRateLimit(),
  },fetcher);
  const local=createSelectedReviewerTransport({
    provider:'ollama-local',model:LOCAL,timeoutMs:150000,
  },fetcher);
  let localReady=false;
  const fallbackEligible=async()=>{
    if(!readLocalReviewFallback(userData,projectId)||
      !readLocalReviewCalibration(userData,projectId))return false;
    const readiness=await probeOllamaReadiness(fetcher,5000,LOCAL);
    return readiness.ready;
  };
  return {
    canReview:async()=>{
      const decision=quota.decide('normal',false);
      if(decision.allowed)return {ready:true,reason:'Kilo free Reviewer ready to attempt'};
      localReady=await fallbackEligible();
      return localReady
        ?{ready:true,reason:'Kilo temporarily rate limited; approved Ollama fallback'}
        :{ready:false,reason:'Kilo free quota blocked; no calibrated local fallback'};
    },
    transport:async(request,signal)=>{
      const decision=quota.decide('normal',false);
      if(decision.allowed){
        try{return await kilo(request,signal)}
        catch(error){
          if(!(error instanceof Error&&
            error.message==='Kilo Gateway free rate limited (HTTP 429)'))
            throw error;
          if(signal?.aborted||!await fallbackEligible())throw error;
          return local(request,signal);
        }
      }
      if(!localReady||!await fallbackEligible())
        throw Error('Kilo free provider paused; no approved fallback');
      return local(request,signal);
    },
  };
}
