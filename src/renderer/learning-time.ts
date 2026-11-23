/** Display elapsed and estimated remaining durations as HH:MM:SS. */
export function formatLearningDuration(seconds:number):string {
 if(!Number.isFinite(seconds)||seconds<0)return '00:00:00';
 const whole=Math.floor(seconds);
 const hours=Math.floor(whole/3600);
 const minutes=Math.floor((whole%3600)/60);
 const remainder=whole%60;
 return [hours,minutes,remainder].map(value=>String(value).padStart(2,'0')).join(':');
}
/** A progress ETA is a snapshot at receivedAt; keep it counting down between events.
 * Unknown estimates must stay unknown, not falsely show zero.
 */
export function formatRemainingEta(
 estimateSeconds:number|null|undefined,receivedAt:number,now:number,
):string {
 if(estimateSeconds===null||estimateSeconds===undefined||
  !Number.isFinite(estimateSeconds)||estimateSeconds<0||
  !Number.isFinite(receivedAt)||receivedAt<=0)return 'noch nicht messbar';
 const elapsed=Math.max(0,Math.floor((now-receivedAt)/1000));
 return formatLearningDuration(Math.max(0,Math.ceil(estimateSeconds)-elapsed));
}
