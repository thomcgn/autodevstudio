import fs from 'node:fs';
import path from 'node:path';

export type QuotaSource='provider-verified'|'local-observation'|'unknown';
export type QuotaPhase='normal'|'finalize';
export type PauseReason='reserve'|'rate-limit'|'unknown-remaining';
export interface QuotaSnapshot {
  source:QuotaSource;
  limit:number;
  reserve:number;
  usedLocal:number;
  remainingVerified:number|null;
  resetAt:number|null;
  blockedBy429:boolean;
  observedAt:number;
}
export interface QuotaDecision {
  allowed:boolean;
  reason:'allowed'|PauseReason;
  retryAt:number|null;
}
export const HOURLY_LIMIT=200;
export const RESERVED_REQUESTS=10;
const HOUR=60*60*1000;
const MAX_STATE_BYTES=8192;
type Stored={events:number[]; observedAt:number; verified:{remaining:number;resetAt:number|null}|null; blockedUntil:number|null; rateLimited:boolean};
function empty():Stored{return {events:[],observedAt:0,verified:null,blockedUntil:null,rateLimited:false};}
function finiteInt(value:unknown):value is number{return typeof value==='number'&&Number.isSafeInteger(value)&&value>=0;}
function trim(state:Stored,now:number):Stored {
  return {...state,events:state.events.filter(t=>finiteInt(t)&&t<=now&&t>now-HOUR)};
}
function statePath(userData:string):string{return path.join(userData,'free-quota.json');}
/** Globally shared IP-limit counter per Studio installation, not per project or model.
 * Local observation is NEVER represented as an authoritative provider counter.
 */
export class FreeQuotaGuard {
  private readonly userData:string;
  private readonly clock:()=>number;
  constructor(userData:string,clock:()=>number=Date.now){this.userData=userData;this.clock=clock;}
  private load():Stored{
    const file=statePath(this.userData);
    try{fs.statSync(file);}
    catch(error){
      if((error as NodeJS.ErrnoException).code==='ENOENT')return empty();
      throw Error('Quota state inaccessible: manual recovery required');
    }
    try{
      if(fs.statSync(file).size>MAX_STATE_BYTES)throw Error('Invalid quota state');
      const raw:unknown=JSON.parse(fs.readFileSync(file,'utf8'));
      if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('Invalid quota state');
      const obj=raw as Record<string,unknown>;
      if(!Array.isArray(obj.events)||obj.events.length>HOURLY_LIMIT+100||
        !obj.events.every(finiteInt)||!finiteInt(obj.observedAt))throw Error('Invalid quota state');
      const v=obj.verified;
      const verified=v&&typeof v==='object'&&!Array.isArray(v)&&
        finiteInt((v as Record<string,unknown>).remaining)&&
        ((v as Record<string,unknown>).resetAt===null||finiteInt((v as Record<string,unknown>).resetAt))
        ?v as Stored['verified']:null;
      return {events:obj.events as number[],observedAt:obj.observedAt as number,
        verified,blockedUntil:finiteInt(obj.blockedUntil)?obj.blockedUntil:null,
        rateLimited:obj.rateLimited===true};
    }catch{throw Error('Quota state corrupt: manual recovery required');}
  }
  private persist(state:Stored):void{
    fs.mkdirSync(this.userData,{recursive:true,mode:0o700});
    const target=statePath(this.userData),temp=target+'.tmp';
    fs.writeFileSync(temp,JSON.stringify(state),{mode:0o600});
    fs.renameSync(temp,target);
  }
  snapshot():QuotaSnapshot {
    const now=this.clock(),state=trim(this.load(),now);
    const fresh=state.verified!==null&&state.observedAt>0&&now-state.observedAt<HOUR&&
      (state.verified.resetAt===null||state.verified.resetAt>now);
    return {source:fresh?'provider-verified':state.observedAt>0?'local-observation':'unknown',
      limit:HOURLY_LIMIT,reserve:RESERVED_REQUESTS,usedLocal:state.events.length,
      remainingVerified:fresh?state.verified!.remaining:null,
      resetAt:state.blockedUntil&&state.blockedUntil>now?state.blockedUntil:fresh?state.verified!.resetAt:null,
      blockedBy429:state.rateLimited,
      observedAt:state.observedAt};
  }
  decide(phase:QuotaPhase):QuotaDecision {
    const state=this.snapshot(),now=this.clock();
    if(state.blockedBy429)return {allowed:false,reason:'rate-limit',retryAt:state.resetAt};
    // A reset deadline does not PROVE quota has recovered. An actual successful
    // provider response must re-establish availability before continuing.
    const available=state.remainingVerified;
    if(available!==null&&available<=(phase==='normal'?RESERVED_REQUESTS:0))
      return {allowed:false,reason:'reserve',retryAt:state.resetAt};
    if(state.usedLocal>=(phase==='normal'?HOURLY_LIMIT-RESERVED_REQUESTS:HOURLY_LIMIT))
      return {allowed:false,reason:'reserve',retryAt:state.resetAt};
    // Unknown upstream IP usage: don't claim remaining; do not auto-resume a
    // paused job from an inferred hourly window.
    return {allowed:true,reason:'allowed',retryAt:null};
  }
  /** Call immediately BEFORE a Kilo inference session: no retries or model switching. */
  recordAttempt(phase:QuotaPhase='normal'):void {
    const decision=this.decide(phase);
    if(!decision.allowed)throw Error('Quota checkpoint required: '+decision.reason);
    const now=this.clock(),state=trim(this.load(),now);
    state.events.push(now);
    state.observedAt=now;
    if(state.verified)state.verified.remaining=Math.max(0,state.verified.remaining-1);
    this.persist(state);
  }
  /** Only explicitly authenticated provider usage is allowed to set remaining.
   * Raw model outputs, CLI stderr and invented reset times cannot do so.
   */
  recordProviderQuota(remaining:number,resetAt:number|null):void {
    if(!finiteInt(remaining)||remaining>HOURLY_LIMIT||
      (resetAt!==null&&(!finiteInt(resetAt)||resetAt<=this.clock()||resetAt>this.clock()+2*HOUR)))
      throw Error('Invalid provider quota telemetry');
    const now=this.clock(),state=trim(this.load(),now);
    state.observedAt=now;state.verified={remaining,resetAt};
    state.rateLimited=false;state.blockedUntil=null;
    this.persist(state);
  }
  /** HTTP 429 is authoritative exhaustion. Retry-After can supply a minimum
   * delay but does not authorize automatic retry after expiration.
   */
  recordRateLimit(retryAfterMs:number|null=null):void {
    if(retryAfterMs!==null&&(!finiteInt(retryAfterMs)||retryAfterMs>2*HOUR))
      throw Error('Invalid retry interval');
    const now=this.clock(),state=trim(this.load(),now);
    state.rateLimited=true;state.blockedUntil=retryAfterMs===null?null:now+retryAfterMs;
    state.verified=null;state.observedAt=now;
    this.persist(state);
  }
  /** Clears a 429 ONLY after provider evidence of recovery, never from local time alone. */
  recoverFromVerifiedProvider(remaining:number,resetAt:number|null):void {
    if(remaining<=0)throw Error('Quota not recovered');
    this.recordProviderQuota(remaining,resetAt);
  }
}
