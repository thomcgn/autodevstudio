import type {PublicHistoryIndex,GitHubHistoryRead} from './public-history.ts';
import {analyzeDevelopmentDecision,renderDevelopmentCaseStudies,type DevelopmentDecision} from './development-case-studies.ts';

export interface HistoricalLesson {
  key:string;title:string;plain:string;technical:string;
  language:string;example:string;exercise:string;solution:string;
  sourceTitle:string;sourceUrl:string;commits:string[];paths:string[];
}
export interface HistoricalBook {
  repository:string;head:string;license:string|null;lessons:HistoricalLesson[];
  bookMarkdown:string;solutionsMarkdown:string;reportsMarkdown:string;
  pagination?:{page:number;hasMore:boolean;pageSize?:number};
  caseStudies?:DevelopmentDecision[];
  deepCursor?:{nextOffset:number;filesTotal:number;filesAnalyzed:number;
    filesSkipped:number;model:string;chapterIndex?:number};
  deepSummary?:{model:string;filesAnalyzed:number;filesSkipped:number;complete:boolean;filesTotal:number};
  historyCursor?:{nextIndex:number;total:number;chapters:number;incomplete:number;model:string};
}
type Concept=Omit<HistoricalLesson,'commits'|'paths'> & {match:RegExp};
const concepts:readonly Concept[]=[
  {key:'java-generics',title:'Java: Generics',match:/\b(?:List|Map|Set|Optional)<[A-Za-z?]/,
   plain:'Eine Liste ist wie eine beschriftete Kiste. List<String> darf nur Texte aufnehmen.',
   technical:'Ein Typparameter schützt bereits beim Kompilieren vor unerlaubten Elementtypen.',
   language:'java',example:'import java.util.List;\nList<String> namen = List.of("Ada", "Kim");',
   exercise:'Erstelle eine Liste mit drei Tiernamen.',solution:'List<String> tiere = List.of("Katze", "Hund", "Fuchs");',
   sourceTitle:'Java List<E> API',sourceUrl:'https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/List.html'},
  {key:'java-streams',title:'Java: Streams',match:/\.(?:stream|filter|map|toList)\s*\(/,
   plain:'Ein Stream ist wie ein Förderband: Jedes Element kann geprüft oder verändert werden.',
   technical:'Zwischenoperationen wie filter sind lazy. Eine Terminaloperation löst die Pipeline aus.',
   language:'java',example:'import java.util.List;\nList<Integer> gerade = List.of(1,2,3,4).stream().filter(n -> n%2==0).toList();',
   exercise:'Filtere Zahlen größer als fünf.',solution:'List<Integer> gross = List.of(2,7,9).stream().filter(n -> n>5).toList();',
   sourceTitle:'Java Stream API',sourceUrl:'https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/stream/Stream.html'},
  {key:'react-state',title:'React: useState',match:/\buseState\s*(?:<[^>]+>)?\s*\(/,
   plain:'State ist das Gedächtnis einer Komponente. Bei Änderungen zeigt React einen neuen Wert an.',
   technical:'Der Hook gibt State und eine Setter-Funktion zurück. State nicht direkt ändern.',
   language:'tsx',example:'const [zahl, setZahl] = useState(0);\n<button onClick={() => setZahl(z => z+1)}>{zahl}</button>',
   exercise:'Schreibe eine Schaltfläche, die auf 0 zurücksetzt.',solution:'<button onClick={() => setZahl(0)}>Reset</button>',
   sourceTitle:'React useState',sourceUrl:'https://react.dev/reference/react/useState'},
  {key:'ts-interface',title:'TypeScript: Interfaces',match:/\binterface\s+[A-Za-z][A-Za-z0-9_]*\s*(?:extends\s+\w+\s*)?\{/,
   plain:'Ein Interface ist ein Steckbrief: Es beschreibt die Eigenschaften eines Objekts.',
   technical:'Interfaces definieren strukturelle Typen. Externe Daten brauchen zusätzlich Laufzeitvalidierung.',
   language:'typescript',example:'interface Mensch { name: string; alter: number }\nconst ada: Mensch = {name:"Ada",alter:30};',
   exercise:'Ergänze die Eigenschaft aktiv vom Typ boolean.',solution:'interface Mensch { name: string; alter: number; aktiv: boolean }',
   sourceTitle:'TypeScript Object Types',sourceUrl:'https://www.typescriptlang.org/docs/handbook/2/objects.html'},
  {key:'async-await',title:'JavaScript: async/await',match:/\b(?:await\s+[A-Za-z]|async\s+(?:function|\())/,
   plain:'Einige Aufgaben brauchen Zeit. await wartet auf das Ergebnis einer Promise.',
   technical:'async-Funktionen liefern ein Promise; await unterbricht nur die aktuelle asynchrone Funktion.',
   language:'typescript',example:'async function antwort(): Promise<number> { return 42; }\nconst zahl = await antwort();',
   exercise:'Erstelle eine asynchrone Funktion, die 7 zurückgibt.',solution:'async function sieben(): Promise<number> { return 7; }',
   sourceTitle:'MDN async function',sourceUrl:'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/async_function'},
  {key:'testing',title:'Automatische Tests',match:/\b(?:assert\.(?:equal|strictEqual|deepEqual)|expect\s*\(|test\s*\()/,
   plain:'Ein Test kontrolliert, ob ein Programm das erwartete Ergebnis liefert.',
   technical:'Regressionstests prüfen festgelegtes Verhalten und müssen bei jeder Änderung erneut laufen.',
   language:'typescript',example:'import assert from "node:assert/strict";\nassert.equal(2+2,4);',
   exercise:'Teste, ob 3*3 den Wert 9 hat.',solution:'assert.equal(3*3,9);',
   sourceTitle:'Node assert',sourceUrl:'https://nodejs.org/api/assert.html'},
  {key:'spring-di',title:'Spring: Dependency Injection',match:/@(?:Service|Component|RestController|Autowired)\b/,
   plain:'Spring kann Objekte selbst erstellen und an andere Teile der Anwendung weitergeben.',
   technical:'Komponenten werden vom Spring-Container verwaltet. Constructor Injection macht Abhängigkeiten explizit und gut testbar.',
   language:'java',example:'import org.springframework.stereotype.Service;\n@Service\nclass Begruessung {\n  String hallo() { return "Hallo"; }\n}',
   exercise:'Markiere eine Klasse als Spring-Service.',solution:'@Service\nclass NachrichtenService {}',
   sourceTitle:'Spring: Classpath Scanning',sourceUrl:'https://docs.spring.io/spring-framework/reference/core/beans/classpath-scanning.html'},
  {key:'electron-ipc',title:'Electron: Sicher zwischen Prozessen sprechen',match:/\b(?:ipcMain\.handle|ipcRenderer\.invoke)\s*\(/,
   plain:'In Electron arbeiten Fenster und Hauptprogramm getrennt. Sie senden einander gezielte Nachrichten.',
   technical:'IPC verbindet Renderer und Main. Die API nur über einen begrenzten Preload freigeben; Eingaben im Main-Prozess prüfen.',
   language:'typescript',example:'ipcMain.handle("app:version", () => "1.0");\n// Über eine freigegebene Preload-Funktion im Renderer abrufen.',
   exercise:'Erstelle einen IPC-Handler, der 42 zurückgibt.',solution:'ipcMain.handle("app:antwort", () => 42);',
   sourceTitle:'Electron IPC Tutorial',sourceUrl:'https://www.electronjs.org/docs/latest/tutorial/ipc'},
  {key:'rust-results',title:'Rust: Option und Result verstehen',match:/\b(?:Result|Option)<|\b(?:Some|None|Ok|Err)\s*\(/,
   plain:'Rust nutzt besondere Werte, um auszudrücken: Ein Ergebnis ist da, fehlt oder ein Fehler ist passiert.',
   technical:'Option<T> kann Some(T) oder None sein; Result<T,E> kann Ok(T) oder Err(E) sein. Fehler lassen sich ausdrücklich behandeln.',
   language:'rust',example:'fn teilen(a:i32,b:i32)->Option<i32> {\n  if b == 0 { None } else { Some(a/b) }\n}',
   exercise:'Was gibt teilen(4, 0) zurück?',solution:'None',
   sourceTitle:'Rust Book: Error Handling',sourceUrl:'https://doc.rust-lang.org/book/ch09-02-recoverable-errors-with-result.html'},
  {key:'python-types',title:'Python: Type Hints',match:/\bdef\s+\w+\([^)\n]*:\s*\w+[^)\n]*\)\s*->\s*\w+|\b(?:list|dict|set)\[(?:str|int|float)\]/,
   plain:'Type Hints sind Notizen zu den erwarteten Datentypen einer Python-Funktion.',
   technical:'Python prüft Typannotationen nicht automatisch zur Laufzeit. Statische Werkzeuge können sie analysieren.',
   language:'python',example:'def verdoppeln(n: int) -> int:\n    return n * 2',
   exercise:'Schreibe die Funktion quadrat mit einem int als Ein- und Rückgabe.',solution:'def quadrat(n: int) -> int:\n    return n * n',
   sourceTitle:'Python Typing Documentation',sourceUrl:'https://docs.python.org/3/library/typing.html'},
];
interface LearningNotes {
  glossary:readonly string[];
  questions:readonly {question:string;answer:string}[];
}
const learningNotes:Record<string,LearningNotes>={
 'git-history':{
  glossary:['Commit: ein gespeicherter Änderungsschritt im Versionsverlauf.',
   'Diff: eine Anzeige, welche Zeilen hinzugefügt oder entfernt wurden.'],
  questions:[{question:'Was zeigt git show --stat?',
    answer:'Eine Zusammenfassung der Dateien und der Anzahl geänderter Zeilen.'},
   {question:'Beweist ein Commit-Titel, warum eine Entscheidung getroffen wurde?',
    answer:'Nein. Er ist ein Hinweis, kein unabhängiger Beleg für die Motivation.'}]},
 'spring-di':{
  glossary:['Dependency Injection: ein Objekt erhält seine benötigten Abhängigkeiten von außen.',
   'Container: Spring verwaltet und verbindet die Komponenten.'],
  questions:[{question:'Wer verwaltet mit @Service markierte Klassen?',
    answer:'Der Spring-Container.'},
   {question:'Warum ist Constructor Injection oft sinnvoll?',
    answer:'Abhängigkeiten sind explizit und lassen sich leichter testen.'}]},
 'electron-ipc':{
  glossary:['Renderer: der Prozess, der die Benutzeroberfläche darstellt.',
   'IPC: Nachrichtenkommunikation zwischen Prozessen.'],
  questions:[{question:'Wofür wird ipcMain.handle verwendet?',
    answer:'Für die Bearbeitung freigegebener Anfragen im Main-Prozess.'},
   {question:'Warum dürfen Renderer nicht beliebige Main-Aktionen auslösen?',
    answer:'Weil eine begrenzte und geprüfte Schnittstelle Sicherheitsrisiken reduziert.'}]},
 'rust-results':{
  glossary:['Option: Wert oder kein Wert.',
   'Result: Erfolg oder Fehler mit erklärbaren Varianten.'],
  questions:[{question:'Wann verwendet man None?',
    answer:'Wenn bei einer Option kein Wert vorhanden ist.'},
   {question:'Wie wird ein Fehler bei Result ausgedrückt?',
    answer:'Mit der Variante Err(error).'}]},
 'python-types':{
  glossary:['Typannotationen: Angaben über erwartete Datenarten.',
   'Statische Typprüfung: Analyse von Code ohne dessen Ausführung.'],
  questions:[{question:'Was bedeutet -> int hinter einer Python-Funktion?',
    answer:'Der vorgesehene Rückgabetyp ist int.'},
   {question:'Erzwingt Python diese Angabe automatisch?',
    answer:'Nein. Ein separates Prüfwerkzeug kann sie kontrollieren.'}]},

 'java-generics':{
  glossary:['Typparameter: ein Platzhalter für einen Datentyp, zum Beispiel String.',
   'Compiler: ein Programm, das den geschriebenen Code vor dem Start prüft.'],
  questions:[{question:'Was bedeutet String in List<String>?',
    answer:'Die Liste darf Elemente des Typs String enthalten.'},
   {question:'Wann findet der Compiler einen falschen Elementtyp?',
    answer:'Bei der Übersetzung beziehungsweise Typprüfung, noch vor dem Programmstart.'}]},
 'java-streams':{
  glossary:['Stream: eine Folge von Elementen, die du verarbeiten kannst.',
   'Filter: eine Regel, die nur passende Elemente durchlässt.'],
  questions:[{question:'Welche Zahlen bleiben bei filter(n -> n > 5) übrig?',
    answer:'Nur Zahlen, die größer als 5 sind.'},
   {question:'Warum endet die Beispiel-Pipeline mit toList()?',
    answer:'toList sammelt die durchgelassenen Elemente als Liste.'}]},
 'react-state':{
  glossary:['Komponente: ein wiederverwendbarer Teil der Oberfläche.',
   'State: veränderbare Daten, die React zur Darstellung verwendet.'],
  questions:[{question:'Wofür wird setZahl benötigt?',
    answer:'Damit React erfährt, dass der State geändert werden soll.'},
   {question:'Warum nicht zahl direkt verändern?',
    answer:'React erkennt und verarbeitet State-Änderungen über die Setter-Funktion.'}]},
 'ts-interface':{
  glossary:['Interface: eine Beschreibung der Form eines Objekts.',
   'Typprüfung: Kontrolle, ob Werte zu ihrer erwarteten Datenform passen.'],
  questions:[{question:'Was heißt alter: number?',
    answer:'Die Eigenschaft alter soll eine Zahl sein.'},
   {question:'Prüft ein Interface automatisch unbekannte JSON-Daten?',
    answer:'Nein. Externe Eingaben brauchen zusätzlich eine Laufzeitprüfung.'}]},
 'async-await':{
  glossary:['Promise: ein Objekt für ein später verfügbares Ergebnis.',
   'await: ein Schlüsselwort, das auf die Erfüllung einer Promise wartet.'],
  questions:[{question:'Was gibt eine async-Funktion zurück?',
    answer:'Eine Promise für das spätere Ergebnis.'},
   {question:'Hält await das gesamte Programm an?',
    answer:'Nein. Es unterbricht die jeweilige asynchrone Funktion.'}]},
 'testing':{
  glossary:['Assertion: eine Überprüfung, ob ein tatsächlicher Wert erwartet ist.',
   'Regression: ein Fehler, bei dem vorher funktionierendes Verhalten wieder kaputtgeht.'],
  questions:[{question:'Was passiert, wenn eine Assertion fehlschlägt?',
    answer:'Der Test meldet einen Fehlschlag.'},
   {question:'Warum sollten Tests nach Änderungen erneut laufen?',
    answer:'Damit neue Änderungen keine vorhandenen Funktionen beschädigen.'}]},
};
function rec(x:unknown):Record<string,unknown>|null{
 return x!==null&&typeof x==='object'&&!Array.isArray(x)?x as Record<string,unknown>:null;
}
function additions(detail:unknown):string {
 const files=rec(detail)?.files;
 if(!Array.isArray(files))return '';
 const lines:string[]=[];
 for(const f of files.slice(0,40)){
  const file=rec(f);if(!file||typeof file.patch!=='string'||file.patch.length>12000)continue;
  if(!/\.(java|tsx?|jsx?|mjs|cjs|rs|py)$/.test(String(file.filename)))continue;
  for(const line of file.patch.split('\n'))
   if(line.startsWith('+')&&!line.startsWith('+++')&&line.length<400)lines.push(line.slice(1));
 }
 return lines.join('\n').slice(0,12000);
}
function safe(x:string):string{return x.replace(/</g,'&lt;').replace(/>/g,'&gt;')
 .replace(/\r/g,'').replace(/^\s*#/gm,'\\#');}
function code(x:string,lang:string):string{return '~~~'+lang+'\n'+x+'\n~~~';}
/** Generate original example lessons only where verified commit diff contains a recognizable syntax.
 * No automated claim about original author's intentions or code quality is made.
 */
export async function generateHistoricalBook(
 index:PublicHistoryIndex,read:GitHubHistoryRead,
):Promise<HistoricalBook>{
 if(index.readOnly!==true||!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(index.repository)||
 !/^[0-9a-f]{40}$/i.test(index.fixedHead))throw Error('Invalid historical source');
 const grouped=new Map<string,HistoricalLesson>();
 const studies:DevelopmentDecision[]=[];
 for(const commit of index.commits){
  if(!/^[0-9a-f]{40}$/i.test(commit.sha))throw Error('Invalid commit SHA');
  const detail=await read('repos/'+index.repository+'/commits/'+commit.sha);
  const added=additions(detail);
  studies.push(analyzeDevelopmentDecision({
    repository:index.repository,sha:commit.sha,title:commit.title,
    paths:commit.changedPaths,detail,
  }));
  for(const concept of concepts){
   if(!concept.match.test(added))continue;
   const lesson=grouped.get(concept.key)??{...concept,commits:[],paths:[]};
   lesson.commits.push(commit.sha);
   for(const path of commit.changedPaths)
    if(lesson.paths.length<12&&!lesson.paths.includes(path))lesson.paths.push(path);
   grouped.set(concept.key,lesson);
  }
 }
 if(index.commits.length>0){
  grouped.set('git-history',{
   key:'git-history',title:'Git: Änderungen nachverfolgen',
   plain:'Git speichert die Entwicklung eines Programms als einzelne Änderungsschritte. So kannst du sehen, wann etwas verändert wurde.',
   technical:'Ein Commit hat eine eindeutige SHA. git show zeigt dazu die Änderung und --stat die betroffenen Dateien. Daraus lässt sich nicht automatisch die Absicht der Person beweisen.',
   language:'shell',example:'git show --stat <COMMIT-SHA>',
   exercise:'Wie findest du heraus, welche Dateien ein Commit verändert hat?',
   solution:'git show --stat <COMMIT-SHA>',
   sourceTitle:'Git-Dokumentation: git-show',sourceUrl:'https://git-scm.com/docs/git-show',
   commits:index.commits.slice(0,3).map(item=>item.sha),
   paths:[...new Set(index.commits.flatMap(item=>item.changedPaths))].slice(0,20),
  });
 }
 const lessons=[...grouped.values()].sort((a,b)=>a.key.localeCompare(b.key,'en'));

 return renderHistoricalBook(index,lessons,studies);
}
/** Render the same certified source records in a stable thematic order. */
export function renderHistoricalBook(
 index:Pick<PublicHistoryIndex,'repository'|'fixedHead'|'licenseSpdx'>,
 lessons:HistoricalLesson[],
 caseStudies:readonly DevelopmentDecision[]=[],
):HistoricalBook {
 const book=['# Programmieren verstehen: '+safe(index.repository),'',
  '## Beleglage',
  'Die Git-Grundlagen stützen sich auf tatsächliche Commits. Zusätzliche Sprachkapitel entstehen nur bei erkannten Syntaxmustern in Git-Diffs. Alle Beispiele sind eigenständige Übungen.',
  'Die ursprüngliche Absicht und die Qualität des fremden Codes sind ohne zusätzliche Belege **nicht bestätigt**.',
  'Die Übungsbeispiele verwenden Java 21 bzw. modernes TypeScript/React. Ein historisches Projekt kann andere Sprach- und Framework-Versionen einsetzen.',
  'Commit-Stand: '+index.fixedHead+' · Lizenz: '+(index.licenseSpdx??'nicht verifiziert'),'',
  '## Inhaltsverzeichnis',...(caseStudies.length?['1. Entwicklungsentscheidungen: vom Problem zur Lösung']:[]),
  ...lessons.map((l,i)=>(i+1+(caseStudies.length?1:0))+'. '+l.title)];
 const solutions=['# Getrennte Musterlösungen – '+safe(index.repository)];
 const reports=['# Quellen- und Entwicklungsreport – '+safe(index.repository),
  'Fakten sind als Commit-Links belegt. Eine historische Motivationsbehauptung wird nicht abgeleitet.'];
 if(caseStudies.length){
  const cases=renderDevelopmentCaseStudies(caseStudies);
  book.push('',cases.book);
  reports.push('',cases.reports);
 }
 for(const l of lessons){
  book.push('','## '+l.title,'','### Einfach erklärt',l.plain,
   '','### Technische Vertiefung',l.technical,
   '','### Von Hand umsetzen',
   '1. Lies das Beispiel und tippe es in einer eigenen Übungsdatei ab.',
   '2. Verändere die Daten und untersuche die Ausgabe.',
   '3. Vergleiche die Beobachtung mit der verlinkten Dokumentation.',
   '','### Beispiel',code(l.example,l.language),
   '','### Fachbegriffe',
   ...(learningNotes[l.key]?.glossary??['Dieses Konzept hat noch kein geprüftes Glossar.'])
      .map(term=>'- '+term),
   '','### Kontrollfragen',
   ...(learningNotes[l.key]?.questions??[]).map((q,i)=>(i+1)+'. '+q.question),
   '','### Übung',l.exercise,
   '','### Offizielle Dokumentation',
   '- ['+l.sourceTitle+']('+l.sourceUrl+')',
   ...l.commits.map(sha=>'- [Historischer Beleg '+sha.slice(0,12)+
    '](https://github.com/'+index.repository+'/commit/'+sha+')'));
  solutions.push('','## '+l.title,'',code(l.solution,l.language),
   '','### Antworten auf die Kontrollfragen',
   ...(learningNotes[l.key]?.questions??[]).map((q,i)=>(i+1)+'. '+q.answer));
  reports.push('','## '+l.title,l.key==='git-history'
    ?'Beobachtet: nachweisbare Commits und betroffene Pfade; kein Programmierkonzept behauptet.'
    :'Beobachtet: passendes Syntaxmuster im hinzugefügten Git-Diff.',
   'Interpretation: Das Kapitel erklärt das Konzept, **nicht** die Absicht der Entwicklung.',
   'Dateien: '+l.paths.join(', '),
   ...l.commits.map(sha=>'- https://github.com/'+index.repository+'/commit/'+sha));
 }
 if(!lessons.length)book.push('','Keine unterstützten Syntaxmuster erkannt; es wird kein Kapitel erfunden.');
 return {repository:index.repository,head:index.fixedHead,license:index.licenseSpdx,lessons,
  bookMarkdown:book.join('\n')+'\n',solutionsMarkdown:solutions.join('\n')+'\n',
  reportsMarkdown:reports.join('\n')+'\n',caseStudies:[...caseStudies]};
}
/** Keep old lessons and their provenance when subsequent commit pages are imported. */
export function mergeHistoricalBook(
 previous:HistoricalBook|null,incoming:HistoricalBook,
):HistoricalBook{
 if(!previous)return incoming;
 if(previous.repository!==incoming.repository)
  throw Error('Cross-repository textbook merge forbidden');
 const merged=new Map<string,HistoricalLesson>();
 for(const lesson of [...previous.lessons,...incoming.lessons]){
  const original=merged.get(lesson.key);
  if(!original){merged.set(lesson.key,{...lesson,commits:[...lesson.commits],paths:[...lesson.paths]});continue;}
  merged.set(lesson.key,{...lesson,
   commits:[...new Set([...original.commits,...lesson.commits])],
   paths:[...new Set([...original.paths,...lesson.paths])].slice(0,50)});
 }
 const caseMap=new Map<string,DevelopmentDecision>();
 for(const item of [...(previous.caseStudies??[]),...(incoming.caseStudies??[])])
  caseMap.set(item.repository+'/'+item.sha,item);
 return renderHistoricalBook({
  repository:incoming.repository,fixedHead:incoming.head,licenseSpdx:incoming.license??previous.license,
 },[...merged.values()].sort((a,b)=>a.key.localeCompare(b.key,'en')),
 [...caseMap.values()]);
}
