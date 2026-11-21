import type {
  EvidenceOnlyReviewerRequest, EvidenceOnlyReviewerTransport,
} from './evidence-only-reviewer.ts';

const HASH=/^[a-f0-9]{64}$/;
const TOKEN=/^[a-f0-9]{32}$/;
const MAX_PROMPT_BYTES=32*1024;
const MAX_REVIEW_BYTES=32*1024;
const PROTOCOL='autodev-review-gateway-v1' as const;

/** Untrusted code/issue text is sent to the broker ONLY as a bounded prompt.
 * The protocol has no fields for filesystem paths, credentials, URL selection,
 * arbitrary tools, terminal commands, or network requests.
 */
export interface ReviewerGatewayRequest {
  protocol:typeof PROTOCOL;
  kind:'review';
  requestId:string;
  issueNumber:number;
  fingerprint:string;
  prompt:string;
}
export interface ReviewerGatewayResponse {
  protocol:typeof PROTOCOL;
  kind:'review-result';
  requestId:string;
  issueNumber:number;
  fingerprint:string;
  output:string;
}
export interface ReviewerGatewayChannel {
  /** A future independently isolated, authenticated transport.
   * Passing a callback does not establish process isolation or trust.
   */
  (request:Readonly<ReviewerGatewayRequest>,signal?:AbortSignal):Promise<unknown>;
}
const keys=(value:Record<string,unknown>,allowed:string[]):boolean=>
  Object.keys(value).length===allowed.length&&Object.keys(value).every(key=>allowed.includes(key));
function record(value:unknown):Record<string,unknown>{
  if(!value||typeof value!=='object'||Array.isArray(value))
    throw new Error('Invalid reviewer gateway envelope');
  return value as Record<string,unknown>;
}
export function createReviewerGatewayRequest(
  review:Readonly<EvidenceOnlyReviewerRequest>,requestId:string,
):ReviewerGatewayRequest {
  if(!TOKEN.test(requestId)||!HASH.test(review.fingerprint)||
    !Number.isSafeInteger(review.issueNumber)||review.issueNumber<=0 ||
    typeof review.prompt!=='string'||!review.prompt.trim()||
    Buffer.byteLength(review.prompt,'utf8')>MAX_PROMPT_BYTES)
    throw new Error('Invalid reviewer gateway request');
  return {
    protocol:PROTOCOL,kind:'review',requestId,
    issueNumber:review.issueNumber,fingerprint:review.fingerprint,prompt:review.prompt,
  };
}
/** Exact-match response prevents stale, wrong-issue and cross-request answers.
 * Unknown fields (including tool requests/commands) are not silently ignored.
 * Parsing does NOT prove that the transport, model or its provider is trusted.
 */
export function acceptReviewerGatewayResponse(
  raw:unknown,request:Readonly<ReviewerGatewayRequest>,
):string{
  const response=record(raw);
  if(!keys(response,['protocol','kind','requestId','issueNumber','fingerprint','output'])||
    response.protocol!==PROTOCOL||response.kind!=='review-result'||
    response.requestId!==request.requestId||
    response.issueNumber!==request.issueNumber||
    response.fingerprint!==request.fingerprint ||
    typeof response.output!=='string'||!response.output.trim()||
    Buffer.byteLength(response.output,'utf8')>MAX_REVIEW_BYTES)
    throw new Error('Reviewer gateway response invalid, stale or unauthorized');
  return response.output;
}
export function createReviewerGatewayTransport(
  channel:ReviewerGatewayChannel,randomRequestId:()=>string,
):EvidenceOnlyReviewerTransport{
  if(typeof channel!=='function'||typeof randomRequestId!=='function')
    throw new Error('Reviewer gateway channel is required');
  return async (review,signal)=>{
    if(signal?.aborted)throw new Error('Reviewer gateway cancelled');
    const request=createReviewerGatewayRequest(review,randomRequestId());
    const result=await channel(request,signal);
    if(signal?.aborted)throw new Error('Reviewer gateway cancelled');
    return acceptReviewerGatewayResponse(result,request);
  };
}
