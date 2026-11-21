import type {KiloRoleModels} from './kilo-role-models.ts';
import type {KiloFreeModel} from './kilo-free-models.ts';
import type {QuotaSnapshot} from './free-quota-guard.ts';
import type {OllamaReadinessResult} from './ollama-readiness.ts';
import {chooseFreeProvider,type FreeProvider,type AgentPhase} from './free-provider-router.ts';

export interface ProviderRoutePreview {
  previewOnly:true;
  executionEnabled:false;
  ollamaReady:boolean;
  localFallbackEnabled:boolean;
  roles:Array<{role:'planner'|'builder'|'reviewer';preferredModel:string|null;
    route:'kilo-candidate'|'ollama-candidate'|'paused';
    model:string|null;
    reason:'kilo-quota-unverified'|'kilo-quota-exhausted'|'model-not-free'|
      'local-not-enabled'|'local-unavailable'|'reviewer-not-isolated'|
      'no-provider'|'candidate-only'}>;
}
/** A dry run of model routing, not authorization to execute.
 * Local fallback is ONLY a read-only reviewer transport; never a writable
 * builder without sandbox checks. Local readiness does NOT prove review
 * calibration or permission to send private project files.
 */
export function previewFreeRoutes(
  roles:KiloRoleModels|null,
  catalog:readonly KiloFreeModel[],
  quota:QuotaSnapshot,
  ollama:OllamaReadinessResult,
  localFallbackEnabled:boolean,
):ProviderRoutePreview {
  const free=new Set(catalog.map(m=>m.id));
  const kiloQuota=quota.blockedBy429?
    {allowed:false as const,reason:'rate-limit' as const,retryAt:quota.resetAt}:
    quota.source!=='provider-verified'||quota.remainingVerified===null?
      {allowed:false as const,reason:'unknown-remaining' as const,retryAt:null}:
      quota.remainingVerified<=quota.reserve||quota.usedLocal>=quota.limit-quota.reserve?
        {allowed:false as const,reason:'reserve' as const,retryAt:quota.resetAt}:
        {allowed:true as const,reason:'allowed' as const,retryAt:null};
  const ollamaReady=ollama.ready===true;
  const result=(['planner','builder','reviewer'] as const).map(role=>{
    const model=roles?.[role]??null;
    const phase:AgentPhase=role==='planner'?'plan':role==='builder'?'build':'review';
    const kiloValid=!!model&&free.has(model);
    // Other Kilo free-model IDs cannot bypass the shared per-IP quota.
    const candidates:FreeProvider[]=[
      ...(kiloValid?[{
        id:'kilo-'+role,kind:'kilo' as const,model:model!,
        zeroCostVerified:true,ready:true,quota:'available' as const,
        roles:[phase],reviewerIsolated:role==='reviewer',
      }]:[]),
      ...(role==='reviewer'&&localFallbackEnabled&&ollamaReady?[{
        id:'local-reviewer',kind:'ollama' as const,model:'qwen2.5-coder:3b',
        zeroCostVerified:true,ready:true,quota:'unknown' as const,
        roles:['review' as const],reviewerIsolated:true,
      }]:[]),
    ];
    const selected=chooseFreeProvider({
      phase,preferredId:'kilo-'+role,candidates,kiloQuota,
      builderProviderId:'kilo-builder',builderModel:roles?.builder,
    });
    if(selected.kind==='selected') {
      return {
        role,preferredModel:model,
        route:selected.providerKind==='ollama'?'ollama-candidate' as const:'kilo-candidate' as const,
        model:selected.model,reason:'candidate-only' as const,
      };
    }
    const reason= !model||!kiloValid?'model-not-free' as const:
      !kiloQuota.allowed&&role!=='reviewer'?
        quota.blockedBy429?'kilo-quota-exhausted' as const:'kilo-quota-unverified' as const:
      role==='reviewer'&&!localFallbackEnabled?'local-not-enabled' as const:
      role==='reviewer'&&!ollamaReady?'local-unavailable' as const:
      role==='reviewer'&&model===roles?.builder?'reviewer-not-isolated' as const:
      !kiloQuota.allowed?'kilo-quota-unverified' as const:'no-provider' as const;
    return {role,preferredModel:model,route:'paused' as const,model:null,reason};
  });
  return {previewOnly:true,executionEnabled:false,ollamaReady,
    localFallbackEnabled,roles:result};
}
