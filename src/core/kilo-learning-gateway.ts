import type {LocalModel} from './deep-learning-analysis.ts';

const URL='https://ai-gateway.kilo.ai/api/v1/chat/completions';
const FREE='kilo-auto/free';
const MAX_REQUEST=28_000;
const MAX_RESPONSE=65_536;
const TIMEOUT=120_000;
interface KiloModelOptions {
 model?:string;
 fetcher?:typeof fetch;
 readKey?:()=>string|null;
}
/** Deliberately text-only. No CLI, tools, repository mount, redirects or Git writes.
 * Only called after the UI explicitly opts in to uploading source excerpts.
 */
export function createKiloLearningModel(options:KiloModelOptions={}):LocalModel {
 const model=options.model??FREE;
 if(model!==FREE&&!/^[a-zA-Z0-9._/-]+:free$/.test(model))
  throw Error('Only verified Kilo free models are permitted for learning');
 const fetcher=options.fetcher??fetch;
 const readKey=options.readKey??(()=>process.env.KILO_API_KEY??null);
 return async(system,prompt,signal,onPulse)=>{
  if(signal.aborted)throw Error('Kilo learning request cancelled');
  if(Buffer.byteLength(system+'\n'+prompt,'utf8')>MAX_REQUEST)
   throw Error('Kilo learning prompt exceeds safe size');
  const key=readKey();
  if(key!==null&&!/^[!-~]{10,4096}$/.test(key))
   throw Error('Invalid local Kilo API key configuration');
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),TIMEOUT);
  const abort=()=>controller.abort();
  signal.addEventListener('abort',abort,{once:true});
  try{
   onPulse?.(1);
   const response=await fetcher(URL,{
    method:'POST',redirect:'error',signal:controller.signal,
    headers:{
     'Content-Type':'application/json','Accept':'application/json',
     ...(key?{'Authorization':'Bearer '+key}:{}),
    },
    body:JSON.stringify({
     model,stream:false,tool_choice:'none',temperature:0,max_tokens:2400,
     messages:[{role:'system',content:system},{role:'user',content:prompt}],
    }),
   });
   if(response.status===429)throw Error('Kilo free quota exceeded (HTTP 429)');
   if(response.status===401||response.status===403)
    throw Error('Kilo access denied; check account and credentials');
   if(!response.ok)throw Error('Kilo cloud HTTP '+response.status);
   if(!response.body)throw Error('Empty Kilo cloud response');
   const reader=response.body.getReader();
   const parts:Uint8Array[]=[];
   let bytes=0;
   try{
    while(true){
     const next=await reader.read();
     if(next.done)break;
     bytes+=next.value.byteLength;
     if(bytes>MAX_RESPONSE)throw Error('Kilo cloud response exceeds safe size');
     parts.push(next.value);
    }
   }finally{void reader.cancel().catch(()=>{});}
   let data:unknown;
   try{data=JSON.parse(Buffer.concat(parts,bytes).toString('utf8')) as unknown;}
   catch{throw Error('Malformed Kilo cloud response');}
   if(!data||typeof data!=='object'||Array.isArray(data))
    throw Error('Invalid Kilo cloud response');
   const choices=(data as Record<string,unknown>).choices;
   if(!Array.isArray(choices)||choices.length!==1)
    throw Error('Invalid Kilo cloud completion');
   const choice=choices[0] as Record<string,unknown>|null;
   const message=choice?.message as Record<string,unknown>|undefined;
   if(!choice||choice.finish_reason!=='stop'||!message||
    message.role!=='assistant'||Object.hasOwn(message,'tool_calls')||
    typeof message.content!=='string'||message.content.length>16_000||
    !message.content.trim())throw Error('Untrusted or truncated Kilo completion');
   onPulse?.(2);
   return message.content;
  }catch(error){
   if(signal.aborted||controller.signal.aborted)
    throw Error('Kilo learning cancelled or timed out');
   if(error instanceof Error&&/^(Kilo free quota|Kilo access|Kilo cloud HTTP|Empty Kilo|Kilo cloud response|Malformed Kilo|Invalid Kilo|Untrusted or truncated Kilo)/.test(error.message))
    throw error;
   throw Error('Kilo cloud request failed');
  }finally{
   clearTimeout(timeout);
   signal.removeEventListener('abort',abort);
  }
 };
}
