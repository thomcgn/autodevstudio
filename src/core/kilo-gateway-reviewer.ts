import type { ReviewerGatewayChannel, ReviewerGatewayRequest,
  ReviewerGatewayResponse } from './reviewer-gateway-protocol.ts';

const URL='https://ai-gateway.kilo.ai/api/v1/chat/completions';
const MAX_PROMPT_BYTES=32*1024;
const MAX_HTTP_BYTES=64*1024;
const MAX_OUTPUT_BYTES=32*1024;
const MODEL=/^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._/:+-]{1,160}$/;
const ID=/^[a-f0-9]{32}$/;
const HASH=/^[a-f0-9]{64}$/;

export interface KiloGatewayConfig {
  model:string;
  /** Invoked only in trusted Main, never stored in renderer or request.
   * This is a gateway API key, NOT necessarily the CLI login/session token.
   */
  readGatewayApiKey:()=>string|null;
  /** Trusted per-request quota boundaries; never accepts model-provided counts. */
  onBeforeRequest?:()=>void;
  onRateLimited?:()=>void;
  timeoutMs?:number;
  maxCompletionTokens?:number;
}
type Fetcher=typeof fetch;
function validate(config:KiloGatewayConfig):void {
  if(!MODEL.test(config.model)||config.model.includes('..'))
    throw new Error('Invalid Kilo Gateway model');
  const timeout=config.timeoutMs??60000;
  const tokens=config.maxCompletionTokens??1200;
  if(!Number.isSafeInteger(timeout)||timeout<1000||timeout>120000||
    !Number.isSafeInteger(tokens)||tokens<128||tokens>4096)
    throw new Error('Invalid reviewer Gateway limits');
}
function requireReview(request:Readonly<ReviewerGatewayRequest>):void {
  const keys=Object.keys(request);
  if(keys.length!==6||!keys.every(k=>[
    'protocol','kind','requestId','issueNumber','fingerprint','prompt'].includes(k))||
    request.protocol!=='autodev-review-gateway-v1'||request.kind!=='review'||
    !ID.test(request.requestId)||!HASH.test(request.fingerprint)||
    !Number.isSafeInteger(request.issueNumber)||request.issueNumber<1||
    typeof request.prompt!=='string'||!request.prompt.trim()||
    Buffer.byteLength(request.prompt,'utf8')>MAX_PROMPT_BYTES)
    throw new Error('Invalid evidence-only review envelope');
}
async function readBoundedJson(response:Response):Promise<unknown>{
  if(!response.body)throw new Error('Empty Gateway response');
  const reader=response.body.getReader();
  const pieces:Uint8Array[]=[];
  let size=0;
  try{
    while(true){
      const part=await reader.read();
      if(part.done)break;
      size+=part.value.byteLength;
      if(size>MAX_HTTP_BYTES)throw new Error('Gateway response exceeds limit');
      pieces.push(part.value);
    }
  }finally{void reader.cancel().catch(()=>{});}
  const payload=Buffer.concat(pieces,size).toString('utf8');
  try{return JSON.parse(payload) as unknown;}
  catch{throw new Error('Invalid Gateway JSON response');}
}
function outputOnly(raw:unknown):string{
  if(!raw||typeof raw!=='object'||Array.isArray(raw))
    throw new Error('Invalid Gateway completion');
  const body=raw as Record<string,unknown>;
  const choices=body.choices;
  if(!Array.isArray(choices)||choices.length!==1)
    throw new Error('Reviewer completion must have one choice');
  const choice=choices[0] as Record<string,unknown>|undefined;
  const msg=choice?.message;
  if(!msg||typeof msg!=='object'||Array.isArray(msg)||
    (msg as Record<string,unknown>).role!=='assistant'||
    Object.prototype.hasOwnProperty.call(msg,'tool_calls')||
    choice?.finish_reason!=='stop')
    throw new Error('Reviewer returned tools, truncated or invalid answer');
  const content=(msg as Record<string,unknown>).content;
  if(typeof content!=='string'||!content.trim()||
    Buffer.byteLength(content,'utf8')>MAX_OUTPUT_BYTES)
    throw new Error('Reviewer output missing or oversized');
  return content;
}

/** Controlled TEXT-ONLY Kilo Gateway adapter. The fixed endpoint, no tool
 * definitions, tool_choice:none, no redirects and capped response mean the
 * model cannot instruct this transport to run code or open arbitrary URLs.
 *
 * This is an OPTIONAL transport. It is not wired into production IPC until
 * credentials, user consent and policy are separately approved.
 */
export function createKiloGatewayReviewerChannel(
  config:KiloGatewayConfig,
  fetcher:Fetcher=fetch,
):ReviewerGatewayChannel{
  validate(config);
  if(typeof config.readGatewayApiKey!=='function')
    throw new Error('Trusted Gateway key provider required');
  return async(request,signal)=>{
    requireReview(request);
    if(signal?.aborted)throw new Error('Reviewer Gateway request cancelled');
    const key=config.readGatewayApiKey();
    const free=config.model==='kilo-auto/free'||config.model.endsWith(':free');
    if ((!key&&!free)||(key!==null&&!/^[!-~]{10,4096}$/.test(key)))
      throw new Error('Kilo Gateway API key unavailable');
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),config.timeoutMs??60000);
    const onAbort=()=>controller.abort();
    signal?.addEventListener('abort',onAbort,{once:true});
    try{
      config.onBeforeRequest?.();
      const response=await fetcher(URL,{
        method:'POST',
        redirect:'error',
        headers:{
          ...(key?{'Authorization':'Bearer '+key}:{}),
          'Content-Type':'application/json',
          'Accept':'application/json',
        },
        body:JSON.stringify({
          model:config.model,stream:false,tool_choice:'none',
          max_tokens:config.maxCompletionTokens??1200,
          messages:[
            {role:'system',content:'You are an independent code reviewer. No tools, commands or file access. Follow the requested structured verdict. Never claim you ran tests.'},
            {role:'user',content:request.prompt},
          ],
        }),
        signal:controller.signal,
      });
      if(response.status===429){
        config.onRateLimited?.();
        throw new Error('Kilo Gateway free rate limited (HTTP 429)');
      }
      if(!response.ok)
        throw new Error('Kilo Gateway request rejected (HTTP '+response.status+')');
      const text=outputOnly(await readBoundedJson(response));
      const answer:ReviewerGatewayResponse={
        protocol:'autodev-review-gateway-v1',kind:'review-result',
        requestId:request.requestId,issueNumber:request.issueNumber,
        fingerprint:request.fingerprint,output:text,
      };
      return answer;
    }catch(error){
      // Never return fetch errors that could contain headers or private paths.
      if(controller.signal.aborted||signal?.aborted)
        throw new Error('Reviewer Gateway request cancelled or timed out');
      if(error instanceof Error&&
        /^(Quota checkpoint required|Kilo Gateway free rate limited|Kilo Gateway request rejected|Gateway response exceeds|Invalid Gateway JSON|Empty Gateway|Invalid Gateway completion|Reviewer completion|Reviewer returned|Reviewer output)/.test(error.message))
        throw error;
      throw new Error('Reviewer Gateway transport failed');
    }finally{
      clearTimeout(timer);
      signal?.removeEventListener('abort',onAbort);
    }
  };
}
