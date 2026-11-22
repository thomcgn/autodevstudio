import type {PublicHistoryIndex,GitHubHistoryRead} from './public-history.ts';

export interface HistoricalLesson {
  key:string;title:string;plain:string;technical:string;
  language:string;example:string;exercise:string;solution:string;
  sourceTitle:string;sourceUrl:string;commits:string[];paths:string[];
}
export interface HistoricalBook {
  repository:string;head:string;license:string|null;lessons:HistoricalLesson[];
  bookMarkdown:string;solutionsMarkdown:string;reportsMarkdown:string;
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
];
function rec(x:unknown):Record<string,unknown>|null{
 return x!==null&&typeof x==='object'&&!Array.isArray(x)?x as Record<string,unknown>:null;
}
function additions(detail:unknown):string {
 const files=rec(detail)?.files;
 if(!Array.isArray(files))return '';
 const lines:string[]=[];
 for(const f of files.slice(0,40)){
  const file=rec(f);if(!file||typeof file.patch!=='string'||file.patch.length>12000)continue;
  if(!/\.(java|tsx?|jsx?|mjs|cjs)$/.test(String(file.filename)))continue;
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
 for(const commit of index.commits.slice(0,12)){
  if(!/^[0-9a-f]{40}$/i.test(commit.sha))throw Error('Invalid commit SHA');
  const added=additions(await read('repos/'+index.repository+'/commits/'+commit.sha));
  for(const concept of concepts){
   if(!concept.match.test(added))continue;
   const lesson=grouped.get(concept.key)??{...concept,commits:[],paths:[]};
   lesson.commits.push(commit.sha);
   for(const path of commit.changedPaths)
    if(lesson.paths.length<12&&!lesson.paths.includes(path))lesson.paths.push(path);
   grouped.set(concept.key,lesson);
  }
 }
 const lessons=[...grouped.values()].sort((a,b)=>a.key.localeCompare(b.key,'en'));
 const book=['# Programmieren verstehen: '+safe(index.repository),'',
  '## Beleglage',
  'Die Kapitel beruhen auf erkannten Syntaxmustern in Git-Diffs. Beispiele sind eigens erstellte Übungen, keine Kopien des Projektcodes.',
  'Die ursprüngliche Absicht und die Qualität des fremden Codes sind ohne zusätzliche Belege **nicht bestätigt**.',
  'Commit-Stand: '+index.fixedHead+' · Lizenz: '+(index.licenseSpdx??'nicht verifiziert'),'',
  '## Inhaltsverzeichnis',...lessons.map((l,i)=>(i+1)+'. '+l.title)];
 const solutions=['# Getrennte Musterlösungen – '+safe(index.repository)];
 const reports=['# Quellen- und Entwicklungsreport – '+safe(index.repository),
  'Fakten sind als Commit-Links belegt. Eine historische Motivationsbehauptung wird nicht abgeleitet.'];
 for(const l of lessons){
  book.push('','## '+l.title,'','### Einfach erklärt',l.plain,
   '','### Technische Vertiefung',l.technical,
   '','### Von Hand umsetzen',
   '1. Lies das Beispiel und tippe es in einer eigenen Übungsdatei ab.',
   '2. Verändere die Daten und untersuche die Ausgabe.',
   '3. Vergleiche die Beobachtung mit der verlinkten Dokumentation.',
   '','### Beispiel',code(l.example,l.language),
   '','### Übung',l.exercise,
   '','### Offizielle Dokumentation',
   '- ['+l.sourceTitle+']('+l.sourceUrl+')',
   ...l.commits.map(sha=>'- [Historischer Beleg '+sha.slice(0,12)+
    '](https://github.com/'+index.repository+'/commit/'+sha+')'));
  solutions.push('','## '+l.title,'',code(l.solution,l.language));
  reports.push('','## '+l.title,'Beobachtet: passendes Syntaxmuster im hinzugefügten Git-Diff.',
   'Interpretation: Das Kapitel erklärt das Konzept, **nicht** die Absicht der Entwicklung.',
   'Dateien: '+l.paths.join(', '),
   ...l.commits.map(sha=>'- https://github.com/'+index.repository+'/commit/'+sha));
 }
 if(!lessons.length)book.push('','Keine unterstützten Syntaxmuster erkannt; es wird kein Kapitel erfunden.');
 return {repository:index.repository,head:index.fixedHead,license:index.licenseSpdx,lessons,
  bookMarkdown:book.join('\n')+'\n',solutionsMarkdown:solutions.join('\n')+'\n',
  reportsMarkdown:reports.join('\n')+'\n'};
}