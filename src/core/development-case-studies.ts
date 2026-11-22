/** Evidence-backed explanations of actual changes. Commit assertions are not proof of quality.
 * Never executes project code or treats commit content as instructions.
 */
export interface DevelopmentDecision {
 sha:string;title:string;repository:string;paths:readonly string[];
 pattern:string;intent:string;implementation:string;reasoning:string;
 alternative:string;tradeoff:string;verification:string;documented:boolean;
}
type Matcher={
 id:string;regex:RegExp;implementation:string;reasoning:string;
 alternative:string;tradeoff:string;verification:string;
};
const patterns:readonly Matcher[]=[
 {id:'idempotency',regex:/idempoten|wiederhol|verloren.{0,35}antwort|Idempotency-Key|idempotencyKey|operation_key/i,
 implementation:'Der Client sendet einen stabilen Idempotency-Key; das Backend erkennt frühere Operationen und kann eine frühere Antwort zurückgeben, statt dieselbe Geschäftsaktion noch einmal auszuführen.',
 reasoning:'Eine verlorene HTTP-Antwort bedeutet nicht, dass der Server die Buchung nicht ausgeführt hat. Der gleiche Request muss ohne doppelte Wirkung wiederholt werden können.',
 alternative:'Einen POST nach einem Timeout einfach erneut senden wäre leichter, kann aber doppelte Buchungen verursachen. Nur den Frontend-Button zu sperren reicht nach einem Reload nicht aus.',
 tradeoff:'Operation-Keys und Ergebnisse müssen konsistent gespeichert werden. Unterschiedliche Request-Inhalte mit gleichem Schlüssel sind explizit zu behandeln.',
 verification:'Zweimal denselben Request senden, dazwischen die Antwort verlieren lassen, und prüfen, dass der Datenbankeffekt nur einmal eintritt; verspätete Wiederholungen gesondert testen.'},
 {id:'optimistic-locking',regex:/expectedRevision|@Version|OptimisticLocking|veraltet.{0,45}formular|konkurrierend/i,
 implementation:'Die beim Lesen erhaltene Revision wird bei einer Änderung wieder mitgeschickt. Eine veraltete Revision wird mit HTTP 409 Conflict zurückgewiesen.',
 reasoning:'Ohne Versionsvergleich kann ein später gespeichertes Formular die zwischenzeitlichen Änderungen einer anderen Person unbemerkt überschreiben.',
 alternative:'Last-write-wins ist einfacher, verliert aber Änderungen. Eine Datenbanksperre während der gesamten Formularbearbeitung ist für Webanwendungen wenig praktikabel.',
 tradeoff:'Clients benötigen Revisionsfelder und einen verständlichen Konfliktablauf. Nach einem 409 müssen Änderungen erneut verglichen werden.',
 verification:'Datensatz in zwei Sitzungen öffnen; Sitzung A speichern und B mit der vorherigen Revision absenden. B muss einen Konflikt erhalten, und die Daten von A müssen erhalten bleiben.'},
 {id:'session-upgrade',regex:/Refresh.Sitzung|Refresh.Token|widerruf|revok.*token|refresh_tokens/i,
 implementation:'Alte Refresh-Sitzungen werden bei einer Sicherheitsmigration ungültig; neue Sitzungen benötigen eine getrennte und wiederholbare Behandlung.',
 reasoning:'Sonst können alte Sitzungen möglicherweise neue Authentifizierungs- oder Sicherheitsregeln umgehen.',
 alternative:'Bestehende Tokens unverändert weiterverwenden minimiert erneute Anmeldungen, kann aber die alten Sicherheitsannahmen beibehalten.',
 tradeoff:'Aktive Benutzer müssen sich eventuell neu anmelden; Migration und Wiederholung dürfen keine frisch ausgestellten Sessions widerrufen.',
 verification:'Token vor und nach der Migration testen; denselben Migrationsschritt erneut durchführen und sicherstellen, dass neue Anmeldungen gültig bleiben.'},
 {id:'api-portability',regex:/portabhängig|relative Serveradresse|127\.0\.0\.1:18081|openapi.{0,40}server/i,
 implementation:'Der API-Vertrag wird von einer festen lokalen Portnummer auf eine zur Laufzeitumgebung passende relative Serveradresse umgestellt.',
 reasoning:'Lokale Entwicklung, CI und produktive Umgebungen verwenden unterschiedliche Hosts und Ports; eine hartcodierte URL driftet leicht auseinander.',
 alternative:'Je Umgebung eine feste URL zu hinterlegen ist möglich, erhöht aber Konfigurationsaufwand und Fehleranfälligkeit.',
 tradeoff:'Bei Reverse Proxies und Pfadpräfixen müssen die tatsächlich erzeugten URLs weiterhin getestet werden.',
 verification:'API-Vertrag mit zwei verschiedenen Hosts oder Ports ausführen; die generierten URLs müssen korrekt aufgelöst werden.'},
 {id:'docker-hardening',regex:/docker.harden|Healthcheck|Nicht.Root|Schreibschutz|read_only:|HEALTHCHECK/i,
 implementation:'Container werden mit geringeren Rechten, geeigneten Healthchecks und kontrollierter Startreihenfolge betrieben.',
 reasoning:'Begrenzte Rechte und sichtbare Healthchecks reduzieren Betriebsrisiken und machen Ausfälle besser nachvollziehbar.',
 alternative:'Root-Betrieb und beschreibbares Root-Dateisystem sind unkomplizierter, vergrößern aber potenzielle Auswirkungen von Fehlern.',
 tradeoff:'Notwendige Schreibpfade müssen ausdrücklich freigegeben werden; Start- und Healthcheck-Zeiten brauchen belastbare Grenzen.',
 verification:'Container ohne Root und mit schreibgeschütztem Dateisystem starten; Healthchecks und notwendige Schreibpfade prüfen.'},
];
function rec(value:unknown):Record<string,unknown>|null {
 return value!==null&&typeof value==='object'&&!Array.isArray(value)
  ?value as Record<string,unknown>:null;
}
function compact(value:string,max=600):string{
 return value.replace(/[\u0000-\u001f]+/g,' ').replace(/\s+/g,' ').trim().slice(0,max);
}
function patches(detail:unknown):string{
 const files=rec(detail)?.files;
 if(!Array.isArray(files))return '';
 const lines:string[]=[];
 for(const value of files.slice(0,40)){
  const file=rec(value);
  if(typeof file?.patch!=='string'||file.patch.length>16000)continue;
  for(const line of file.patch.split('\n')){
   if(line.startsWith('+')&&!line.startsWith('+++')&&line.length<350)
    lines.push(line.slice(1));
  }
 }
 return lines.join('\n').slice(0,25000);
}
export function analyzeDevelopmentDecision(source:{
 repository:string;sha:string;title:string;paths:readonly string[];detail:unknown;
}):DevelopmentDecision {
 if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(source.repository)||
    !/^[0-9a-f]{40}$/i.test(source.sha))throw Error('Invalid commit provenance');
 const message=rec(rec(source.detail)?.commit)?.message;
 const stated=compact(typeof message==='string'?message:source.title,700);
 const diff=patches(source.detail);
 const matched=patterns.find(p=>p.regex.test(stated)||p.regex.test(diff));
 const fileList=[...new Set(source.paths.filter(p=>typeof p==='string'&&p.length<250))].slice(0,18);
 return {repository:source.repository,sha:source.sha,
  title:compact(source.title,180)||'Unbenannter Entwicklungsschritt',
  paths:fileList,pattern:matched?.id??'generic-diff',documented:stated.length>20,
  intent:stated||'Kein dokumentierter Auftrag im Commit verfügbar.',
  implementation:matched?.implementation??('Geänderte Dateien: '+(fileList.join(', ')||
   'keine vollständige Dateiliste')+'. Eine konkrete Implementierungsentscheidung kann hier nicht zuverlässig aus den Metadaten abgeleitet werden.'),
  reasoning:matched?.reasoning??'Die fachliche Entscheidung ist aus den vorhandenen Quellen nicht sicher ableitbar. Die tatsächlichen Änderungen und Tests im Commit prüfen.',
  alternative:matched?.alternative??'Keine belegte Alternative dokumentiert; eine Alternative wäre hier Spekulation.',
  tradeoff:matched?.tradeoff??'Unbekannt; die technischen Risiken müssen anhand des vollständigen Diffs und der Tests untersucht werden.',
  verification:matched?.verification??'Commit-Diff und vorhandene Tests lesen und das geänderte Verhalten isoliert reproduzieren.',
 };
}
function safe(value:string):string {
 return value.replace(/[\r\n]+/g,' ').replace(/</g,'&lt;').replace(/>/g,'&gt;')
  .replace(/[\\*_|\[\]]/g,' ').slice(0,1200);
}
export function renderDevelopmentCaseStudies(cases:readonly DevelopmentDecision[]):{
 book:string;reports:string
}{
 const book=['## Fallstudien: Warum und wie wurde FassWerk beziehungsweise das Projekt verändert?','',
  'Commit-Nachrichten sind dokumentierte Aussagen. Die technische Einordnung und hypothetische Alternativen sind keine nachgewiesenen Gedanken der Entwickler.'];
 const reports=['## Entwicklungsfallstudien: Herkunft und Grenzen der Aussagen'];
 for(const item of cases.slice(0,100)){
  const url='https://github.com/'+item.repository+'/commit/'+item.sha;
  book.push('','### '+safe(item.title),
   '**Originalbeleg:** [Commit '+item.sha.slice(0,12)+']('+url+')',
   '**Ausgangsproblem / im Commit beschriebenes Ziel:** '+safe(item.intent),
   '**Wie wurde es umgesetzt?** '+safe(item.implementation),
   '**Warum ist das technisch sinnvoll? (Einordnung)** '+safe(item.reasoning),
   '**Welche Alternativen wären denkbar?** '+safe(item.alternative),
   '**Nachteile und Abwägungen:** '+safe(item.tradeoff),
   '**Wie prüfst du das selbst?** '+safe(item.verification),
   '**Betroffene Dateien:** '+safe(item.paths.join(', ')||'Keine Dateiliste'));
  reports.push('','### '+safe(item.title),'- Originalcommit: '+url,
   '- Quellenstatus: '+(item.documented?'Commit-Beschreibung vorhanden':'nur begrenzte Metadaten'),
   '- Analysiertes technisches Muster: '+item.pattern,
   '- Die Alternative ist ein didaktischer Vergleich, kein historisches Entscheidungsprotokoll.');
 }
 return {book:book.join('\n')+'\n',reports:reports.join('\n')+'\n'};
}
