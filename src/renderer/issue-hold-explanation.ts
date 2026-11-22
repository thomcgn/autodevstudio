/** UI-only explanations of *verified* GitHub workflow labels.
 * These messages never imply that a checkpoint may be deleted or resumed.
 */
export interface IssueHoldExplanation {
  title:string;
  why:string;
  next:string;
  severity:'blocked'|'waiting';
}
export function explainIssueHold(
  labels:readonly string[],queueReason:string|undefined,
):IssueHoldExplanation|null {
  const values=labels.map(label=>label.trim().toLowerCase());
  const has=(label:string):boolean=>values.includes(label);
  if(has('status:blocked')||has('blocked'))
    return {title:'BLOCKED – Issue gesperrt',
      why:'Das Issue ist auf GitHub als blockiert markiert. Das Label enthält keinen konkreten technischen Fehlergrund.',
      next:'Issue-Beschreibung, Abhängigkeiten und Laufdiagnose prüfen. Erst nach dokumentierter Freigabe wieder auf status:ready setzen.',
      severity:'blocked'};
  if(has('manual-only')||has('do-not-automate'))
    return {title:'Manuelle Bearbeitung erforderlich',
      why:'Das Issue ist ausdrücklich von automatischer Ausführung ausgeschlossen.',
      next:'GitHub-Issue und Freigabeentscheidung prüfen; AutoDev darf diese Markierung nicht umgehen.',
      severity:'blocked'};
  if(has('needs-triage')||has('needs-discussion')||has('status:triage'))
    return {title:'Triage ausstehend',
      why:'Anforderungen, Risiko oder Abhängigkeiten sind noch nicht ausreichend geklärt.',
      next:'Issue prüfen, Priorität festlegen und anschließend ausdrücklich für die Entwicklung freigeben.',
      severity:'waiting'};
  if(has('status:in-progress')||has('status:planning')||has('status:review')||has('status:approved'))
    return {title:'Kein neuer Lauf freigegeben',
      why:'Das Issue besitzt bereits einen laufenden oder abgeschlossenen Workflowstatus. Ein Statuslabel allein beweist keinen aktiven Prozess.',
      next:'Vorhandenen Checkpoint, Review und PR überprüfen, statt einen zweiten Lauf zu beginnen.',
      severity:'waiting'};
  if(has('status:backlog')||has('status:done'))
    return {title:'Nicht für neuen Lauf freigegeben',
      why:'Das Issue ist noch im Backlog oder bereits als abgeschlossen gekennzeichnet.',
      next:'Für einen neuen Lauf muss nach Triage explizit status:ready vorliegen.',
      severity:'waiting'};
  if(queueReason&&!has('status:ready'))
    return {title:'Triage-Labels unvollständig',
      why:'Genau ein gültiger status:*-Wert und ein priority:p0–p3-Wert sind erforderlich.',
      next:'Fehlende oder widersprüchliche GitHub-Labels korrigieren und erneut aktualisieren.',
      severity:'waiting'};
  if(queueReason&&/priority|workflow status|blocked/i.test(queueReason))
    return {title:'Issue noch nicht startfähig',
      why:'Die GitHub-Triage ist widersprüchlich oder enthält eine zusätzliche Sperrmarkierung.',
      next:'Status, Priorität und manuelle Sperrmarkierungen prüfen.',
      severity:'waiting'};
  return null;
}
