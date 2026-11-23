/** Local, stack-specific knowledge assessment. No model call and no remote transfer. */
export type LearningStack='fundamentals'|'java'|'spring'|'typescript'|'react'|'sql';
export type LearningLevel='beginner'|'foundation'|'intermediate';
export interface LearningAnswer {readonly questionId:string;readonly choice:number}
export interface LearningProfile {
 readonly version:1;readonly levels:Readonly<Record<LearningStack,LearningLevel>>;
 readonly scores:Readonly<Record<LearningStack,number>>;
 readonly assessedAt:number;
}
export interface LearningQuestion {
 readonly id:string;readonly stack:LearningStack;readonly prompt:string;
 readonly answers:readonly [string,string,string];readonly correct:number;
 readonly explanation:string;
}
export const LEARNING_QUESTIONS:readonly LearningQuestion[]=[
 {id:'fund-1',stack:'fundamentals',prompt:'Wozu dient eine Variable?',answers:['Sie speichert einen Wert','Sie startet einen Server','Sie erzeugt einen Button'],correct:0,explanation:'Eine Variable hält einen Wert, auf den das Programm später zugreifen kann.'},
 {id:'fund-2',stack:'fundamentals',prompt:'Was macht eine Bedingung (if)?',answers:['Sie speichert Bilder','Sie führt Code abhängig von einer Prüfung aus','Sie löscht den Code'],correct:1,explanation:'Mit if entscheidet ein Programm anhand einer Bedingung.'},
 {id:'java-1',stack:'java',prompt:'Was beschreibt eine Java-Klasse?',answers:['Ein Datenbankpasswort','Eine Vorlage für Objekte und Verhalten','Eine Internetadresse'],correct:1,explanation:'Klassen fassen Zustand und Methoden zusammen.'},
 {id:'java-2',stack:'java',prompt:'Was bedeutet List<String>?',answers:['Eine Liste von Textwerten','Genau ein Text','Ein Text mit HTML'],correct:0,explanation:'Der Typparameter String legt fest, welche Elemente die Liste enthält.'},
 {id:'java-3',stack:'java',prompt:'Was macht eine Stream-Pipeline?',answers:['Sie startet den Computer','Sie verarbeitet Elemente mit aufeinanderfolgenden Operationen','Sie öffnet eine Datei automatisch'],correct:1,explanation:'Stream-Operationen können filtern, sortieren oder Werte umwandeln.'},
 {id:'spring-1',stack:'spring',prompt:'Welche Aufgabe hat ein REST-Controller?',answers:['HTTP-Anfragen empfangen','Java-Code in HTML übersetzen','Passwörter anzeigen'],correct:0,explanation:'Ein Controller nimmt eine Anfrage an und delegiert die Verarbeitung.'},
 {id:'spring-2',stack:'spring',prompt:'Wozu dient @Transactional?',answers:['Eine Webseite einfärben','Zusammengehörige Datenbankänderungen als Transaktion behandeln','Eine Java-Liste sortieren'],correct:1,explanation:'Transaktionen unterstützen die gemeinsame Ausführung oder Rücknahme von Änderungen.'},
 {id:'ts-1',stack:'typescript',prompt:'Was beschreibt ein TypeScript-Typ?',answers:['Welche Werte erwartet werden','Wie schnell das Netzwerk ist','Wie viele Tabs der Browser hat'],correct:0,explanation:'Typen helfen, falsche Werte schon beim Entwickeln zu erkennen.'},
 {id:'ts-2',stack:'typescript',prompt:'Was bewirkt das ? bei name?: string?',answers:['name muss vorhanden sein','name ist optional','name ist immer eine Zahl'],correct:1,explanation:'Eine optionale Eigenschaft kann fehlen.'},
 {id:'react-1',stack:'react',prompt:'Wofür dient useState in React?',answers:['Für Datenbankmigrationen','Für den Zustand einer Komponente','Für Java-Vererbung'],correct:1,explanation:'useState merkt sich einen Wert über Renderdurchläufe.'},
 {id:'react-2',stack:'react',prompt:'Warum verwendet React Komponenten?',answers:['Um UI in wiederverwendbare Teile zu gliedern','Um SQL direkt auszuführen','Um jede Datei zu verschlüsseln'],correct:0,explanation:'Komponenten teilen die Oberfläche in verständliche Teile.'},
 {id:'sql-1',stack:'sql',prompt:'Was ist ein Fremdschlüssel in einer relationalen Datenbank?',answers:['Ein CSS-Selektor','Ein Verweis auf einen Datensatz in einer anderen Tabelle','Ein HTTP-Header'],correct:1,explanation:'Fremdschlüssel verknüpfen Tabellen und unterstützen referenzielle Integrität.'},
 {id:'sql-2',stack:'sql',prompt:'Was macht SELECT in SQL?',answers:['Datensätze abfragen','Eine React-App starten','Eine Java-Klasse erzeugen'],correct:0,explanation:'SELECT liest ausgewählte Daten aus einer Datenbank.'},
];
export const LEARNING_STACKS:readonly LearningStack[]=['fundamentals','java','spring','typescript','react','sql'];
export function evaluateLearningProfile(answers:readonly LearningAnswer[],now:number):LearningProfile {
 if(!Number.isSafeInteger(now)||now<0)throw Error('Invalid assessment timestamp');
 const given=new Map<string,number>();
 for(const answer of answers){
  const question=LEARNING_QUESTIONS.find(q=>q.id===answer.questionId);
  if(!question||!Number.isInteger(answer.choice)||answer.choice<0||answer.choice>=question.answers.length||
    given.has(question.id))throw Error('Invalid assessment answer');
  given.set(question.id,answer.choice);
 }
 if(given.size!==LEARNING_QUESTIONS.length)throw Error('Incomplete assessment');
 const scores={} as Record<LearningStack,number>;
 const levels={} as Record<LearningStack,LearningLevel>;
 for(const stack of LEARNING_STACKS){
  const questions=LEARNING_QUESTIONS.filter(q=>q.stack===stack);
  const correct=questions.filter(q=>given.get(q.id)===q.correct).length;
  const percent=Math.round(correct*100/questions.length);
  scores[stack]=percent;
  levels[stack]=percent===100?'intermediate':percent>=50?'foundation':'beginner';
 }
 return {version:1,levels,scores,assessedAt:now};
}
export function validateLearningProfile(input:unknown):LearningProfile {
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Invalid learning profile');
 const profile=input as Partial<LearningProfile>;
 if(profile.version!==1||!Number.isSafeInteger(profile.assessedAt)||profile.assessedAt < 0||
  !profile.levels||!profile.scores)throw Error('Invalid learning profile');
 for(const stack of LEARNING_STACKS){
  if(!['beginner','foundation','intermediate'].includes(profile.levels[stack])||
   !Number.isInteger(profile.scores[stack])||profile.scores[stack]<0||profile.scores[stack]>100)
   throw Error('Invalid learning profile');
 }
 return profile as LearningProfile;
}
export function learningInstructions(profile:LearningProfile):string {
 const validated=validateLearningProfile(profile);
 const names:Record<LearningStack,string>={fundamentals:'Programmierung',java:'Java',spring:'Spring Boot',
  typescript:'TypeScript',react:'React',sql:'SQL'};
 return LEARNING_STACKS.map(stack=>names[stack]+': '+validated.levels[stack]).join('; ')+
  '. Anfänger: erkläre jedes neue Konzept vor seiner Verwendung; arbeite mit konkreten Alltagsbeispielen. '+
  'Fachbegriffe nur nach verständlicher Einführung. Mittelstufe: erkläre neue Konzepte und echten Code schrittweise. '+
  'Auch bei höherem Niveau niemals unerklärte, stackfremde Konzepte voraussetzen.';
}
