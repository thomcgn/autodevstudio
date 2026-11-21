import { calibrateReviewer, type CalibrationResult } from './reviewer-calibration.ts';
import { createSelectedReviewerTransport } from './reviewer-provider-selection.ts';

const MODEL = 'qwen2.5-coder:3b';

/** Explicit local model-only calibration. Two fixed synthetic examples;
 * never access project files, GitHub, credentials or Kilo Gateway.
 * Not an authorization to review or publish real repository changes.
 */
export async function probeReviewerCalibration(
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<CalibrationResult> {
  if (process.platform !== 'linux')
    return {passed:false,reason:'invalid-response'};
  try {
    const transport = createSelectedReviewerTransport({
      provider:'ollama-local',model:MODEL,timeoutMs:150000,
    },fetcher);
    return await calibrateReviewer(transport,signal);
  } catch {
    return {passed:false,reason: signal?.aborted ? 'cancelled' : 'invalid-response'};
  }
}
