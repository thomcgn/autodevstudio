/** Free-provider admission control for managed requests.
 * No Kilo quota endpoint is currently documented: local counts are estimates,
 * NEVER represented as a server-confirmed remaining balance.
 * Stops before reserve rather than guessing an exact reset or spending paid credits.
 */
export const KILO_FREE_HOURLY_LIMIT=200;
export const KILO_FINALIZATION_RESERVE=10; // 5%, including potential model-assisted wrap-up
export type QuotaPurpose='work'|'finalize';
export interface RateLimitEvidence {
  limit:number;
  remaining:number;
  resetAt:number|null;
  observedAt:number;
  source:'provider';
}
export interface FreeQuotaSnapshot {
  source:'provider'|'local-estimate'|'unknown';
  limit:number;
  remaining:number|null;
  reserve:number;
  workAllowed:boolean;
  finalizationAllowed:boolean;
  pauseUntil:number|null;
  reason:'ready'|'reserve'|'exhausted'|'rate-limited'|'unknown-quota';
}
/** Only trusted, explicitly named response headers are evidence of server quota.
 * Absent headers are NOT interpreted as unlimited or zero remaining.
 */
export function parseQuotaHeaders(headers:Pick<Headers,'get'>,now=Date.now()):RateLimitEvidence|null {
  const limitText=headers.get('x-ratelimit-limit');
  const remainText=headers.get('x-ratelimit-remaining');
  if(limitText===null||remainText===null||!/^[0-9]+$/.test(limitText)||!/^[0-9]+$/.test(remainText))return null;
  const limit=Number(limitText),remaining=Number(remainText);
  if(!Number.isSafeInteger(limit)||limit<1||limit>100000||!Number.isSafeInteger(remaining)||remaining>limit)return null;
  const reset=headers.get('x-ratelimit-reset');
  let resetAt:null|number=null;
  if(reset!==null&&/^[0-9]+$/.test(reset)){
    const value=Number(reset);
    // Providers variously expose seconds or milliseconds; reject ambiguous/implausible offsets.
    const timestamp=value<1e11?value*1000:value;
    if(Number.isSafeInteger(timestamp)&&timestamp>now&&timestamp<=now+24*60*60*1000)resetAt=timestamp;
  }
  return {limit,remaining,resetAt,observedAt:now,source:'provider'};
}
export function parseRetryAfter(headers:Pick<Headers,'get'>,now=Date.now()):number|null {
  const value=headers.get('retry-after');
  if(!value)return null;
  let duration:number;
  if(/^[0-9]+$/.test(value))duration=Number(value)*1000;
  else duration=Date.parse(value)-now;
  if(!Number.isFinite(duration)||duration<0||duration>24*60*60*1000)return null;
  return now+Math.max(1000,Math.ceil(duration));
}
export class FreeQuotaGate {
  private readonly accepted:number[]=[];
  private evidence:RateLimitEvidence|null=null;
  private acceptedSequence=0;
  private evidenceSequence=0;
  private blockedUntil:number|null=null;
  private readonly limit:number;
  private readonly reserve:number;
  constructor(limit=KILO_FREE_HOURLY_LIMIT,reserve=KILO_FINALIZATION_RESERVE){
    this.limit=limit;
    this.reserve=reserve;
    if(!Number.isSafeInteger(limit)||limit<=0||!Number.isSafeInteger(reserve)||reserve<0||reserve>=limit)
      throw Error('Invalid free-quota policy');
  }
  observe(headers:Pick<Headers,'get'>,now=Date.now()):void {
    const evidence=parseQuotaHeaders(headers,now);
    if(evidence){this.evidence=evidence;this.evidenceSequence=this.acceptedSequence;}
  }
  recordAccepted(now=Date.now()):void {
    this.prune(now);
    this.accepted.push(now);
    this.acceptedSequence.value++;
    // Provider measurements may be stale after another request: do not double count
    // requests already made before the last observation.
  }
  reject429(headers:Pick<Headers,'get'>,now=Date.now()):void {
    const retry=parseRetryAfter(headers,now);
    // Without a reset contract, block for a conservative hour; NEVER automatically probe
    // the limited model to find the precise reset time.
    this.blockedUntil=retry??now+60*60*1000;
    const evidence=parseQuotaHeaders(headers,now);
    if(evidence){this.evidence=evidence;this.evidenceSequence=this.acceptedSequence.value;}
  }
  status(now=Date.now()):FreeQuotaSnapshot {
    this.prune(now);
    const recent=this.evidence&&now-this.evidence.observedAt<=60_000?this.evidence:null;
    const limit=recent?.limit??this.limit;
    const reserve=Math.min(this.reserve,limit-1);
    // Count events by occurrence order, not millisecond timestamps: a request
    // accepted in the same millisecond as a quota observation still consumes quota.
    const afterEvidence=recent?this.acceptedSequence.value-this.evidenceSequence:0;
    const remaining=recent
      ?Math.max(0,recent.remaining-afterEvidence)
      :Math.max(0,limit-this.accepted.length);
    const pause=this.blockedUntil!==null&&this.blockedUntil>now?this.blockedUntil:null;
    const source=recent?'provider':this.accepted.length?'local-estimate':'unknown';
    // Estimates are only local admission control, never an accurate provider balance.
    const reason=pause?'rate-limited':remaining===0?'exhausted':remaining<=reserve?'reserve':source==='unknown'?'unknown-quota':'ready';
    return {source,limit,remaining:source==='unknown'?null:remaining,reserve,
      workAllowed:!pause&&remaining>reserve&&source!=='unknown',
      finalizationAllowed:!pause&&remaining>0&&source!=='unknown',
      pauseUntil:pause,reason};
  }
  /** A deliberate opt-in local-budget mode allows small work only after the
   * managed process has recorded usage. A fresh process with no provider
   * evidence starts UNKNOWN and cannot claim available quota.
   */
  assertAllowed(purpose:QuotaPurpose,now=Date.now()):void {
    const snapshot=this.status(now);
    if(!(purpose==='work'?snapshot.workAllowed:snapshot.finalizationAllowed))
      throw new QuotaPauseError(snapshot);
  }
  private prune(now:number):void {
    while(this.accepted.length&&(this.accepted[0]<=now-3_600_000))this.accepted.shift();
    if(this.blockedUntil!==null&&this.blockedUntil<=now)this.blockedUntil=null;
  }
}
export class QuotaPauseError extends Error {
  readonly name='QuotaPauseError';
  readonly snapshot:FreeQuotaSnapshot;
  constructor(snapshot:FreeQuotaSnapshot){
    super('Free-provider quota not confirmed; checkpoint and suspend safely');
    this.snapshot=snapshot;
  }
}
