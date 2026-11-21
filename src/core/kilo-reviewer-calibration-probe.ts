import {calibrateReviewer,type CalibrationResult} from './reviewer-calibration.ts';
import {createSelectedReviewerTransport} from './reviewer-provider-selection.ts';
import {FreeQuotaGuard} from './free-quota-guard.ts';

const FREE=/^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._/:-]+:free$/;
/** User-clicked, cloud-only calibration with two fixed synthetic diffs.
 * The selected model is revalidated against the live free catalog by Main
 * before calling this function; no project data, files, credentials or tools.
 * This never grants permission to review actual repository changes.
 */
export async function probeKiloReviewerCalibration(
 model:string,guard:FreeQuotaGuard,fetcher:typeof fetch=fetch,
 signal?:AbortSignal,
):Promise<CalibrationResult> {
 if(model!=='kilo-auto/free'&&!FREE.test(model))
   return {passed:false,reason:'model-unavailable'};
 const quota=guard.decide('normal');
 if(!quota.allowed)return {passed:false,reason:quota.reason==='rate-limit'?'rate-limit':'quota-reserve'};
 try{
   const transport=createSelectedReviewerTransport({
     provider:'kilo-gateway',model,gatewayKey:()=>null,timeoutMs:120000,
     onBeforeRequest:()=>guard.recordAttempt('normal'),
     onRateLimited:()=>guard.recordRateLimit(),
   },fetcher);
   return await calibrateReviewer(transport,signal);
 }catch(error){
   if(signal?.aborted)return {passed:false,reason:'cancelled'};
   return {passed:false,reason:'transport-failed'};
 }
}
