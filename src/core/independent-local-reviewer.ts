import {probeOllamaReadiness} from './ollama-readiness.ts';
import {createSelectedReviewerTransport} from './reviewer-provider-selection.ts';
import {calibrateReviewer} from './reviewer-calibration.ts';
import type {EvidenceOnlyReviewerTransport} from './evidence-only-reviewer.ts';

/** The Qwen 2.5 Coder 3B Builder may never review its own code.
 * Granite is a different model family and separately installed local model,
 * and so has no Kilo cloud quota. It is NOT guaranteed to be a good reviewer:
 * calibration, evidence binding, static audit and isolated tests still apply.
 */
export const OFFLINE_REVIEWER_MODEL='granite3.3:2b' as const;
export const OFFLINE_BUILDER_MODEL='qwen2.5-coder:3b' as const;
export interface IndependentReviewerSession {
  transport:EvidenceOnlyReviewerTransport;
  canReview:()=>Promise<{ready:boolean;reason:string}>;
}
export interface IndependentReviewerDependencies {
  modelReady:()=>Promise<boolean>;
  calibrate:(transport:EvidenceOnlyReviewerTransport,signal?:AbortSignal)=>Promise<boolean>;
  transport:EvidenceOnlyReviewerTransport;
}
export function createIndependentLocalReviewerSession(
  signal?:AbortSignal,
  dependencies?:IndependentReviewerDependencies,
):IndependentReviewerSession {
  if(OFFLINE_REVIEWER_MODEL===String(OFFLINE_BUILDER_MODEL))
    throw Error('Local reviewer must not be the builder model');
  const transport=dependencies?.transport??createSelectedReviewerTransport({
    provider:'ollama-local',model:OFFLINE_REVIEWER_MODEL,timeoutMs:180000,
  });
  let approved=false;
  let pending:Promise<{ready:boolean;reason:string}>|null=null;
  const check=async():Promise<{ready:boolean;reason:string}>=>{
    if(signal?.aborted)return {ready:false,reason:'Reviewer calibration cancelled'};
    if(approved)return {ready:true,reason:'Independent Granite reviewer calibrated'};
    const ready=dependencies
      ?await dependencies.modelReady()
      :(await probeOllamaReadiness(fetch,5000,OFFLINE_REVIEWER_MODEL)).ready;
    if(!ready)return {ready:false,reason:
      'Independent reviewer not installed. Install once with: ollama pull granite3.3:2b'};
    const passed=dependencies
      ?await dependencies.calibrate(transport,signal)
      :(await calibrateReviewer(transport,signal)).passed;
    if(!passed)return {ready:false,reason:
      'Independent Granite reviewer failed synthetic PASS/FAIL calibration; no code will be approved'};
    if(signal?.aborted)return {ready:false,reason:'Reviewer calibration cancelled'};
    approved=true;
    return {ready:true,reason:'Independent Granite reviewer calibrated'};
  };
  return {
    transport:async(request,requestSignal)=>{
      // Never let the model process real issue data unless both synthetic
      // cases have been passed in THIS execution session.
      if(!approved)throw Error('Independent reviewer must pass calibration first');
      if(signal?.aborted||requestSignal?.aborted)throw Error('Reviewer cancelled');
      return transport(request,requestSignal??signal);
    },
    canReview:()=>{
      if(pending)return pending;
      pending=check().finally(()=>{pending=null});
      return pending;
    },
  };
}
