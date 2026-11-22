/** Sanitized, user-facing diagnostics for errors crossing Electron IPC.
 * Never render raw provider, Git, model or filesystem output in the UI.
 */
export type IssueFailureCode=
  'branch-protection'|'checkpoint'|'quota'|'provider'|'review'|'quality'|
  'repository'|'conflict'|'cancelled'|'publish'|'unknown';

export interface IssueFailure {
  code:IssueFailureCode;
  title:string;
  explanation:string;
  retry:'inspect-first'|'after-recovery'|'do-not-retry';
}
const RULES:ReadonlyArray<{match:RegExp;code:IssueFailureCode;title:string;
  explanation:string;retry:IssueFailure['retry']}>= [
  {match:/branch protection required|ruleset|protected branch/i,code:'branch-protection',
   title:'GitHub-Branch-Protection nicht bestätigt',
   explanation:'Der Start ist gesperrt. GitHub-Ruleset und Berechtigungen prüfen.',
   retry:'after-recovery'},
  {match:/checkpoint|drift|fingerprint|revision conflict|resume|project lock/i,
   code:'checkpoint',title:'Checkpoint oder Git-Zustand muss geprüft werden',
   explanation:'Branch, HEAD und gespeicherte Revision nicht verändern. Vor einer Wiederaufnahme Integrität prüfen.',
   retry:'inspect-first'},
  {match:/quota|429|rate.limit|retry.after|reserve|kontingent/i,code:'quota',
   title:'Modellkontingent oder Rate-Limit erreicht',
   explanation:'Der Lauf ist pausiert. Provider-Status und sicheren Wiederaufnahmezeitpunkt prüfen.',
   retry:'after-recovery'},
  {match:/kilo|provider|model|catalog|ollama|reviewer transport|gateway/i,
   code:'provider',title:'KI-Anbieter oder Modell nicht verfügbar',
   explanation:'Modellkonfiguration und Provider-Diagnose prüfen. Ein vorhandener Checkpoint bleibt maßgeblich.',
   retry:'inspect-first'},
  {match:/review.fail|reviewer|blocker/i,code:'review',
   title:'Review nicht erfolgreich',
   explanation:'Reviewer-Befund und Checkpoint prüfen; nicht am Review vorbei veröffentlichen.',
   retry:'inspect-first'},
  {match:/quality|typecheck|test fail|compile|lint|warning/i,code:'quality',
   title:'Qualitätsprüfung fehlgeschlagen',
   explanation:'Die fehlgeschlagenen Pflichtprüfungen untersuchen. Veröffentlichung bleibt gesperrt.',
   retry:'inspect-first'},
  {match:/repository|origin|cross.repo|unsafe path|not a git|issue not found/i,
   code:'repository',title:'Repository oder Issue-Zuordnung ungültig',
   explanation:'Ausgewähltes Repository, Git-Origin und Issue-Zuordnung kontrollieren.',
   retry:'inspect-first'},
  {match:/already active|another.*run|concurrent|busy|locked/i,code:'conflict',
   title:'Bereits ein Lauf aktiv',
   explanation:'Aktiven Lauf und Projektsperre prüfen. Keine zweite Bearbeitung starten.',
   retry:'inspect-first'},
  {match:/abort|cancel|signal/i,code:'cancelled',
   title:'Lauf abgebrochen',
   explanation:'Checkpoint und Git-Zustand prüfen, bevor die Arbeit fortgesetzt wird.',
   retry:'inspect-first'},
  {match:/publish|push|draft.pr|network|timed.out|timeout|503/i,code:'publish',
   title:'Veröffentlichung oder Netzwerk nicht bestätigt',
   explanation:'Vor einem Wiederholungsversuch prüfen, ob Commit, Push oder PR bereits erstellt wurde.',
   retry:'do-not-retry'},
];
export function classifyIssueFailure(error:unknown):IssueFailure {
  const message=error instanceof Error?error.message:typeof error==='string'?error:'';
  // Never expose the untrusted error.message: it may include secrets or paths.
  const found=RULES.find(rule=>rule.match.test(message.slice(0,4000)));
  if(found)return {code:found.code,title:found.title,
    explanation:found.explanation,retry:found.retry};
  return {code:'unknown',title:'Issue-Lauf unerwartet angehalten',
    explanation:'Ursache nicht klassifizierbar. Lokale Diagnose und Checkpoint prüfen; keinen neuen Lauf blind starten.',
    retry:'inspect-first'};
}
export function formatIssueFailure(error:unknown):string {
  const failure=classifyIssueFailure(error);
  return failure.title+' ['+failure.code+']. '+failure.explanation;
}
