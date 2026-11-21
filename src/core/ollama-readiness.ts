const ENDPOINT = 'http://127.0.0.1:11434/api/tags';
const MODEL = 'qwen2.5-coder:3b';
export interface OllamaReadinessResult {
  ready: boolean;
  reason: 'ready'|'unreachable'|'http-error'|'invalid-response'|'model-missing'|'timeout';
}

/** Explicit opt-in offline-local preflight, separate from model inference.
 * Only GET /api/tags on fixed loopback; reads no project files or credentials.
 * Never reveals installed model names or raw response bodies to the UI.
 */
export async function probeOllamaReadiness(
  fetcher:typeof fetch=fetch,
  timeoutMs=5000,
):Promise<OllamaReadinessResult> {
  if(!Number.isSafeInteger(timeoutMs)||timeoutMs<100||timeoutMs>10000)
    throw new Error('Invalid preflight timeout');
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try {
    const response=await fetcher(ENDPOINT,{method:'GET',redirect:'error',signal:controller.signal});
    if(!response.ok)return {ready:false,reason:'http-error'};
    const length=Number(response.headers.get('content-length'));
    if(Number.isFinite(length)&&length>64*1024)
      return {ready:false,reason:'invalid-response'};
    if(!response.body)return {ready:false,reason:'invalid-response'};
    const reader=response.body.getReader();
    const chunks:Uint8Array[]=[];
    let bytes=0;
    try {
      while(true){
        const item=await reader.read();
        if(item.done)break;
        bytes+=item.value.byteLength;
        if(bytes>64*1024)return {ready:false,reason:'invalid-response'};
        chunks.push(item.value);
      }
    }finally{void reader.cancel().catch(()=>{});}
    let data:unknown;
    try{data=JSON.parse(Buffer.concat(chunks,bytes).toString('utf8'));}
    catch{return {ready:false,reason:'invalid-response'};}
    if(!data||typeof data!=='object'||Array.isArray(data))
      return {ready:false,reason:'invalid-response'};
    const models=(data as Record<string,unknown>).models;
    if(!Array.isArray(models)||!models.every(item=>
      item&&typeof item==='object'&&!Array.isArray(item)&&
      typeof (item as Record<string,unknown>).name==='string'))
      return {ready:false,reason:'invalid-response'};
    return models.some(item=>(item as {name:string}).name===MODEL)
      ?{ready:true,reason:'ready'}
      :{ready:false,reason:'model-missing'};
  }catch{
    return {ready:false,reason:controller.signal.aborted?'timeout':'unreachable'};
  }finally{clearTimeout(timer);}
}
