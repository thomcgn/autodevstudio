import type {KiloRoleModels} from './kilo-role-models.ts';
import type {KiloFreeModel} from './kilo-free-models.ts';
import type {QuotaSnapshot} from './free-quota-guard.ts';

export type ReadinessReason=
  'ready'|'not-configured'|'model-no-longer-free'|'429-blocked'|
  'remaining-unknown'|'reserve-protected'|'reviewer-not-independent';
export interface RoleReadiness {
  role:'planner'|'builder'|'reviewer';
  model:string|null;
  reason:ReadinessReason;
}
export interface FreeRunReadiness {
  roles:RoleReadiness[];
  modelAndQuotaReady:boolean;
  /** No model selection, quota evidence or preview can authorize production. */
  executionEnabled:false;
  countedLocally:number;
  remainingVerified:number|null;
}
const ROLES=['planner','builder','reviewer'] as const;
/** Pure Main-side preflight. Never fetches credentials, starts agents, sends
 * data to a model, changes Git, or confuses local observed requests with
 * authoritative remaining quota. The independent Reviewer additionally
 * requires a distinct model from Builder for this first safe route.
 */
export function inspectFreeRunReadiness(
  assigned:KiloRoleModels|null,freeModels:readonly KiloFreeModel[],quota:QuotaSnapshot,
):FreeRunReadiness {
  const verified=new Set(freeModels.map(item=>item.id));
  const reasons:RoleReadiness[]=ROLES.map(role=>{
    const model=assigned?.[role]??null;
    let reason:ReadinessReason='ready';
    if(!model)reason='not-configured';
    else if(!verified.has(model))reason='model-no-longer-free';
    else if(role==='reviewer'&&model===assigned?.builder)reason='reviewer-not-independent';
    else if(quota.blockedBy429)reason='429-blocked';
    else if(quota.remainingVerified===null||quota.source!=='provider-verified')
      reason='remaining-unknown';
    else if(quota.remainingVerified<=quota.reserve||
      quota.usedLocal>=quota.limit-quota.reserve)reason='reserve-protected';
    return {role,model,reason};
  });
  return {roles:reasons,modelAndQuotaReady:reasons.every(item=>item.reason==='ready'),
    executionEnabled:false,countedLocally:quota.usedLocal,
    remainingVerified:quota.remainingVerified};
}
