import type {QuotaDecision,QuotaPhase} from './free-quota-guard.ts';

export type ProviderKind='kilo'|'ollama'|'direct';
export type AgentPhase='plan'|'build'|'review'|'finalize';
export interface FreeProvider {
  /** Trusted Main-process registry entry; never supplied from Issue text. */
  id:string;
  kind:ProviderKind;
  model:string;
  /** Verified by provider catalog or local readiness, not a label in the prompt. */
  zeroCostVerified:boolean;
  ready:boolean;
  /** External and Kilo providers must report their own quota status.
   * Ollama has no per-hour network quota, but must pass local readiness.
   */
  quota:'available'|'limited'|'exhausted'|'unknown';
  /** Supports the operation and was explicitly enabled by the user. */
  roles:readonly AgentPhase[];
  /** Separate read-only transport without tools, mandatory for reviewers. */
  reviewerIsolated:boolean;
}
export interface RoutingRequest {
  phase:AgentPhase;
  preferredId:string;
  builderProviderId?:string;
  builderModel?:string;
  candidates:readonly FreeProvider[];
  kiloQuota:QuotaDecision;
}
export type RouteResult =
  | {kind:'selected';providerId:string;providerKind:ProviderKind;model:string;fallback:boolean}
  | {kind:'paused';reason:'no-free-provider'|'quota-unavailable'|'independent-reviewer-unavailable'};

/** Policy only; never invokes a model. Kilo free models share ONE per-IP
 * quota: changing their model ID MUST NOT bypass a global 429/reserve stop.
 * Alternates must have genuinely independent quotas (direct provider or local).
 */
export function chooseFreeProvider(request:RoutingRequest):RouteResult {
  if(!['plan','build','review','finalize'].includes(request.phase)||
     !request.preferredId||!Array.isArray(request.candidates)||
     request.candidates.length>40)
    throw Error('Invalid provider routing request');
  const matching=request.candidates.filter(p=>
    typeof p.id==='string'&&p.id.length>0&&
    p.zeroCostVerified===true&&p.ready===true&&
    (p.quota==='available'||(p.kind==='ollama'&&p.quota==='unknown'))&&
    p.roles.includes(request.phase)&&
    (request.phase!=='review'||(
      p.reviewerIsolated===true&&
      !(p.id===request.builderProviderId&&p.model===request.builderModel))));
  // Prefer explicitly chosen model, fall back only within policy-approved,
  // available independent providers; never switch Kilo models after 429.
  const order=matching.slice().sort((a,b)=>
    Number(b.id===request.preferredId)-Number(a.id===request.preferredId));
  let blockedKilo=false,blockedReviewer=false;
  for(const candidate of order){
    if(candidate.kind==='kilo'&&!request.kiloQuota.allowed){
      blockedKilo=true;
      continue;
    }
    if(request.phase==='review'&&!candidate.reviewerIsolated){
      blockedReviewer=true;
      continue;
    }
    return {kind:'selected',providerId:candidate.id,providerKind:candidate.kind,
      model:candidate.model,fallback:candidate.id!==request.preferredId};
  }
  if(request.phase==='review'&&(blockedReviewer||
     request.candidates.some(p=>p.zeroCostVerified&&p.ready&&p.roles.includes('review')&&
       (!p.reviewerIsolated||(p.id===request.builderProviderId&&p.model===request.builderModel)))))
    return {kind:'paused',reason:'independent-reviewer-unavailable'};
  return {kind:'paused',reason:blockedKilo?'quota-unavailable':'no-free-provider'};
}

/** The controller must checkpoint before returning a paused result and must
 * revalidate provider availability, quota and repository identity on resume.
 * This selector is NOT permission to execute or publish.
 */
export function quotaPhaseFor(stage:AgentPhase):QuotaPhase {
  return stage==='finalize'?'finalize':'normal';
}
