import type { ReviewerGatewayChannel, ReviewerGatewayRequest, ReviewerGatewayResponse
} from './reviewer-gateway-protocol.ts';

const ENDPOINT='http://127.0.0.1:11434/api/chat';
const MODEL=/^[a-zA-Z0-9][a-zA-Z0-9._/:-]{0,127}$/;
const HEX32=/^[a-f0-9]{32}$/;
const HEX64=/^[a-f0-9]{64}$/;
export interface LocalOllamaConfig {
  /** Exact model known to be installed on this computer. Never from issues. */
  model:string;
  /** Long enough for CPU-only inference but still bounded. */
  timeoutMs?:number;
  maxCompletionTokens?:number;
}
type Fetcher=typeof fetch;
function validate(req:Readonly<ReviewerGatewayRequest>):void{
  if(!req||typeof req!=='object'||Object.keys(req).length!==6||
    Object.keys(req).some(key=>!['protocol','kind','requestId','issueNumber','fingerprint','prompt'].includes(key))||
    req.protocol!=='autodev-review-gateway-v1'||req.kind!=='review'||
    !HEX32.test(req.requestId)||!HEX64.test(req.fingerprint)||
    !Number.isSafeInteger(req.issueNumber)||req.issueNumber<1||
    typeof req.prompt!=='string'||!req.prompt.trim()||
    Buffer.byteLength(req.prompt,'utf8')>32*1024)
    throw new Error('Invalid local reviewer evidence envelope');
}
async function boundedBody(response:Response):Promise<unknown>{
  if(!response.body)throw new Error('Ollama returned empty response');
  const reader=response.body.getReader();
  const chunks:Uint8Array[]=[];
  let bytes=0;
  try{
    while(true){
      const data=await reader.read();
      if(data.done)break;
      bytes+=data.value.byteLength;
      if(bytes>64*1024)throw new Error('Ollama response exceeded limit');
      chunks.push(data.value);
    }
  }finally{void reader.cancel().catch(()=>{});}
  try{return JSON.parse(Buffer.concat(chunks,bytes).toString('utf8')) as unknown;}
  catch{throw new Error('Invalid Ollama JSON response');}
}
function extract(raw:unknown):string{
  if(!raw||typeof raw!=='object'||Array.isArray(raw))
    throw new Error('Invalid Ollama completion');
  const response=raw as Record<string,unknown>;
  const message=response.message;
  if(response.done!==true||!message||typeof message!=='object'||Array.isArray(message))
    throw new Error('Ollama completion unfinished');
  const r=message as Record<string,unknown>;
  if(r.role!=='assistant'||Object.prototype.hasOwnProperty.call(r,'tool_calls')||
    typeof r.content!=='string'||!r.content.trim()||
    Buffer.byteLength(r.content,'utf8')>32*1024)
    throw new Error('Ollama tools or invalid reviewer output');
  return r.content;
}

/** Local, credential-free reviewer model transport. The fixed 127.0.0.1
 * endpoint is independent of any user project, and tool calls are never
 * supplied or accepted. This module is intentionally NOT reachable from
 * renderer IPC until model capability and review policy are approved.
 *
 * WARNING: Local models are not assumed reliable independent reviewers;
 * normal evidence, lock, quality and PASS validation remain mandatory.
 */
export function createLocalOllamaReviewerChannel(
  config:LocalOllamaConfig,fetcher:Fetcher=fetch,
):ReviewerGatewayChannel{
  if(!MODEL.test(config.model)||config.model.includes('..')||
    config.model.includes('://')||config.model.includes('//')||
    !Number.isSafeInteger(config.timeoutMs??120000)||
    (config.timeoutMs??120000)<1000||(config.timeoutMs??120000)>180000||
    !Number.isSafeInteger(config.maxCompletionTokens??1200)||
    (config.maxCompletionTokens??1200)<128||(config.maxCompletionTokens??1200)>4096)
    throw new Error('Invalid local reviewer configuration');
  return async(request,signal)=>{
    validate(request);
    if(signal?.aborted)throw new Error('Local reviewer cancelled');
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),config.timeoutMs??120000);
    const onAbort=()=>controller.abort();
    signal?.addEventListener('abort',onAbort,{once:true});
    try{
      const response=await fetcher(ENDPOINT,{
        method:'POST',redirect:'error',headers:{'Content-Type':'application/json'},
        signal:controller.signal,
        body:JSON.stringify({
          model:config.model,stream:false,think:false,keep_alive:0,
          options:{num_predict:config.maxCompletionTokens??1200,temperature:0},
          messages:[
            {role:'system',content:'Independent reviewer. Do not use tools. Return only the requested review verdict. Do not claim tests were executed.'},
            {role:'user',content:request.prompt},
          ],
        }),
      });
      if(!response.ok)throw new Error('Ollama unavailable or rejected request (HTTP '+response.status+')');
      const output=extract(await boundedBody(response));
      const result:ReviewerGatewayResponse={
        protocol:'autodev-review-gateway-v1',kind:'review-result',
        requestId:request.requestId,issueNumber:request.issueNumber,
        fingerprint:request.fingerprint,output,
      };
      return result;
    }catch(error){
      if(controller.signal.aborted||signal?.aborted)
        throw new Error('Local reviewer cancelled or timed out');
      if(error instanceof Error&&/^(Ollama unavailable|Ollama returned|Ollama response|Invalid Ollama|Ollama completion|Ollama tools)/.test(error.message))
        throw error;
      throw new Error('Local reviewer transport failed');
    }finally{
      clearTimeout(timer);
      signal?.removeEventListener('abort',onAbort);
    }
  };
}
