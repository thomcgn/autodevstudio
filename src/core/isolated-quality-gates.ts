import { runTrustedQualityGates, type QualityGateConfig, type QualityScriptRunner } from './quality-gates.ts';
import { runIsolatedNpmScript } from './isolated-quality.ts';
import type { QualityResult } from './orchestrator.ts';

/** The only trusted quality-gate entrypoint intended for future standalone runs.
 * Never falls back to host npm when Bubblewrap is missing or a sandbox fails.
 * This does not authorize execution: the controller must still validate the
 * selected project, hold the lock and explicitly approve the requested scripts.
 *
 * A runner can be injected by tests only; production callers must omit it.
 */
export async function runIsolatedQualityGates(
  config: QualityGateConfig,
  runner: QualityScriptRunner = runIsolatedNpmScript,
): Promise<QualityResult> {
  if (process.platform !== 'linux') {
    return {passed:false,feedback:'Isolated quality gates require Linux'};
  }
  if (config.signal?.aborted) {
    return {passed:false,feedback:'Isolated quality gates cancelled'};
  }
  return runTrustedQualityGates(config,runner);
}
