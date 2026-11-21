import { randomBytes } from 'node:crypto';
import type { EvidenceOnlyReviewerTransport } from './evidence-only-reviewer.ts';
import {
  createReviewerGatewayTransport,
} from './reviewer-gateway-protocol.ts';
import { createKiloGatewayReviewerChannel } from './kilo-gateway-reviewer.ts';
import { createLocalOllamaReviewerChannel } from './local-ollama-reviewer.ts';

export type ReviewerProviderConfiguration =
  | {provider:'kilo-gateway'; model:string; gatewayKey:()=>string|null; timeoutMs?:number; onBeforeRequest?:()=>void; onRateLimited?:()=>void}
  | {provider:'ollama-local'; model:string; timeoutMs?:number};

/** Provider choice belongs to the trusted Main process only, never issue
 * content, Git diff, agent output or renderer-supplied URLs/credentials.
 * There is deliberately NO provider fallback or automatic cloud escalation.
 */
export function createSelectedReviewerTransport(
  config:ReviewerProviderConfiguration,
  fetcher:typeof fetch=fetch,
  requestIdFactory:()=>string=()=>randomBytes(16).toString('hex'),
):EvidenceOnlyReviewerTransport{
  const channel=config.provider==='kilo-gateway'
    ?createKiloGatewayReviewerChannel({
      model:config.model,
      readGatewayApiKey:config.gatewayKey,
      timeoutMs:config.timeoutMs,
      onBeforeRequest:config.onBeforeRequest,
      onRateLimited:config.onRateLimited,
    },fetcher)
    :config.provider==='ollama-local'
      ?createLocalOllamaReviewerChannel({
        model:config.model,timeoutMs:config.timeoutMs,
      },fetcher)
      :null;
  if(!channel)throw new Error('Unsupported reviewer transport');
  return createReviewerGatewayTransport(channel,requestIdFactory);
}
