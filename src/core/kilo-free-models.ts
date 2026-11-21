const ENDPOINT='https://ai-gateway.kilo.ai/api/v1/models';
const ID=/^[a-zA-Z0-9][a-zA-Z0-9._/:-]{0,159}$/;
export interface KiloFreeModel { id:string; name:string; preferred:boolean }
export interface KiloFreeCatalog { models:KiloFreeModel[]; checkedAt:string }
const PREFERRED='nvidia/nemotron-3-ultra-550b-a55b:free';
const MAX_BYTES=1024*1024;
export function parseFreeModels(raw:unknown):KiloFreeModel[]{
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('Invalid model catalog');
  const data=(raw as Record<string,unknown>).data;
  if(!Array.isArray(data)||data.length>5000)throw Error('Invalid model list');
  const unique=new Map<string,KiloFreeModel>();
  for(const entry of data){
    if(!entry||typeof entry!=='object'||Array.isArray(entry))continue;
    const item=entry as Record<string,unknown>;
    const id=item.id;
    if(typeof id!=='string'||!ID.test(id))continue;
    // Explicit Kilo free IDs only. Never infer free from missing price metadata.
    if(id!=='kilo-auto/free'&&!id.endsWith(':free'))continue;
    // If pricing exists, nonzero/unknown costs disqualify the entry.
    const pricing=item.pricing;
    if(pricing!==undefined){
      if(!pricing||typeof pricing!=='object'||Array.isArray(pricing))continue;
      const p=pricing as Record<string,unknown>;
      if(!['prompt','completion'].every(k=>
        (typeof p[k]==='number'&&p[k]===0)||
        (typeof p[k]==='string'&&p[k].trim()!==''&&Number(p[k])===0)))continue;
    }
    const preferred=id===PREFERRED;
    const name=typeof item.name==='string'&&item.name.trim()?item.name.trim().slice(0,140):id;
    unique.set(id,{id,name,preferred});
  }
  return [...unique.values()].sort((a,b)=>Number(b.preferred)-Number(a.preferred)||
    Number(b.id==='kilo-auto/free')-Number(a.id==='kilo-auto/free')||a.name.localeCompare(b.name));
}
/** Read-only, no authentication, fixed HTTPS origin, bounded JSON response. */
export async function fetchKiloFreeModels(fetcher:typeof fetch=fetch):Promise<KiloFreeCatalog>{
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),12000);
  try{
    const response=await fetcher(ENDPOINT,{method:'GET',redirect:'error',signal:controller.signal});
    if(!response.ok)throw Error('Model catalog unavailable');
    const length=Number(response.headers.get('content-length'));
    if(Number.isFinite(length)&&length>MAX_BYTES)throw Error('Model catalog too large');
    if(!response.body)throw Error('Empty model catalog');
    const reader=response.body.getReader();
    const chunks:Uint8Array[]=[];let count=0;
    try{
      while(true){
        const part=await reader.read();
        if(part.done)break;
        count+=part.value.byteLength;
        if(count>MAX_BYTES)throw Error('Model catalog too large');
        chunks.push(part.value);
      }
    }finally{void reader.cancel().catch(()=>{});}
    let raw:unknown;
    try{raw=JSON.parse(Buffer.concat(chunks,count).toString('utf8'));}
    catch{throw Error('Invalid model catalog');}
    return {models:parseFreeModels(raw),checkedAt:new Date().toISOString()};
  }catch{throw Error('Kilo-Modellkatalog momentan nicht erreichbar');}
  finally{clearTimeout(timer);}
}
