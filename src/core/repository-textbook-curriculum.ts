/* Deterministic, framework-aware concept index for repository textbooks.
 * Reads already verified source fragments only; no network, execution or LLM.
 */
export interface TextbookSource {readonly path:string;readonly content:string}
export interface ConceptEvidence {readonly path:string;readonly line:number;readonly excerpt:string}
export interface TextbookConcept {
 readonly id:string;readonly title:string;readonly language:string;
 readonly explanation:string;readonly prerequisites:readonly string[];
 readonly documentation:string;readonly evidence:readonly ConceptEvidence[];
}
export interface TextbookCurriculum {
 readonly concepts:readonly TextbookConcept[];
 readonly detectedLanguages:readonly string[];
 readonly analyzedFiles:number;
}
interface Definition {
 id:string;title:string;language:string;explanation:string;
 prerequisites:readonly string[];documentation:string;pattern:RegExp;
}
const JAVA='https://docs.oracle.com/en/java/javase/21/docs/api/';
const DEFINITIONS:readonly Definition[]=[
 {id:'java-classes',title:'Klassen und Objekte',language:'Java',
  explanation:'Eine Klasse beschreibt, welche Daten und Methoden zusammengehören.',
  prerequisites:[],documentation:'https://dev.java/learn/classes-objects/',
  pattern:/\b(?:public|private|protected)?\s*(?:abstract\s+|final\s+)?class\s+[A-Za-z_$][\w$]*/},
 {id:'java-generics',title:'Generics und Typparameter',language:'Java',
  explanation:'Typparameter legen fest, mit welchen Datentypen eine wiederverwendbare Klasse oder Methode arbeitet.',
  prerequisites:['java-classes'],documentation:'https://dev.java/learn/generics/',
  pattern:/\b(?:List|Set|Map|Optional|Collection|Stream|Class|Comparator|Repository)\s*<[^>]+>/},
 {id:'java-streams',title:'Stream-Verarbeitung',language:'Java',
  explanation:'Streams verarbeiten Elemente als Folge von Operationen; viele Zwischenschritte werden erst durch eine Endoperation ausgeführt.',
  prerequisites:['java-classes','java-generics'],documentation:JAVA+'java/util/stream/Stream.html',
  pattern:/\.stream\s*\(/},
 {id:'java-optional',title:'Optional und fehlende Werte',language:'Java',
  explanation:'Optional macht sichtbar, dass ein Ergebnis vorhanden sein kann oder fehlen darf.',
  prerequisites:['java-generics'],documentation:JAVA+'java/util/Optional.html',
  pattern:/\bOptional\s*</},
 {id:'spring-controller',title:'HTTP-Controller',language:'Java / Spring',
  explanation:'Controller verbinden eingehende HTTP-Anfragen mit Methoden der Anwendung.',
  prerequisites:['java-classes'],documentation:'https://docs.spring.io/spring-framework/reference/web/webmvc/mvc-controller.html',
  pattern:/@(?:RestController|GetMapping|PostMapping|PutMapping|DeleteMapping|PatchMapping)\b/},
 {id:'spring-transactions',title:'Datenbanktransaktionen',language:'Java / Spring',
  explanation:'Eine Transaktion fasst zusammengehörige Änderungen zu einer Einheit zusammen.',
  prerequisites:['java-classes'],documentation:'https://docs.spring.io/spring-framework/reference/data-access/transaction/declarative/annotations.html',
  pattern:/@Transactional\b/},
 {id:'typescript-types',title:'TypeScript-Typen',language:'TypeScript',
  explanation:'Typen beschreiben, welche Werte und Eigenschaften Code erwartet.',
  prerequisites:[],documentation:'https://www.typescriptlang.org/docs/handbook/2/everyday-types.html',
  pattern:/\b(?:interface|type)\s+[A-Za-z_$][\w$]*/},
 {id:'typescript-generics',title:'TypeScript-Generics',language:'TypeScript',
  explanation:'Generics verbinden wiederverwendbare Funktionen und Typdefinitionen mit konkreten Typen.',
  prerequisites:['typescript-types'],documentation:'https://www.typescriptlang.org/docs/handbook/2/generics.html',
  pattern:/\b(?:function|interface|type|class)\s+[A-Za-z_$][\w$]*\s*<\s*[A-Z][A-Za-z0-9_, ]*>/},
 {id:'react-state',title:'Zustand mit React Hooks',language:'TypeScript / React',
  explanation:'useState speichert Werte einer Komponente und veranlasst bei Änderungen eine neue Darstellung.',
  prerequisites:['typescript-types'],documentation:'https://react.dev/reference/react/useState',
  pattern:/\buseState\s*(?:<[^>\n]+>)?\s*\(/},
 {id:'sql-tables',title:'Relationale Tabellen',language:'SQL',
  explanation:'Tabellen speichern Datensätze mit Spalten und definierten Beziehungen.',
  prerequisites:[],documentation:'https://www.postgresql.org/docs/current/ddl-basics.html',
  pattern:/\bCREATE\s+TABLE\b/i},
];
function language(path:string):'Java'|'TypeScript'|'SQL'|null {
 if(/\.java$/i.test(path))return 'Java';
 if(/\.(?:ts|tsx)$/i.test(path))return 'TypeScript';
 if(/\.sql$/i.test(path))return 'SQL';
 return null;
}
function accepts(def:Definition,kind:'Java'|'TypeScript'|'SQL'):boolean{
 return kind==='Java'?def.language.startsWith('Java'):
  kind==='TypeScript'?def.language.startsWith('TypeScript'):def.language==='SQL';
}
function safePath(value:string):boolean{
 return value.length>0&&value.length<=240&&
  !value.startsWith('/')&&!value.includes('..')&&!value.includes('\\')&&
  /^[a-zA-Z0-9_./ -]+$/.test(value);
}
/** Never reports semantic certainty: regex matches are navigation leads,
 * not proof that a particular branch was executed at runtime.
 */
export function buildTextbookCurriculum(sources:readonly TextbookSource[]):TextbookCurriculum{
 const found=new Map<string,ConceptEvidence[]>();
 const languages=new Set<string>();
 const paths=new Set<string>();
 for(const source of sources){
  if(!safePath(source.path)||paths.has(source.path)||source.content.length>128_000)
   throw Error('Invalid textbook source input');
  paths.add(source.path);
  const kind=language(source.path);
  if(!kind)continue;
  languages.add(kind);
  const lines=source.content.split(/\r?\n/);
  for(let index=0;index<lines.length;index++){
   const original=lines[index];
   const line=original.trim();
   if(!line||line.startsWith('//')||line.startsWith('*')||line.startsWith('--'))continue;
   for(const definition of DEFINITIONS){
    if(!accepts(definition,kind)||!definition.pattern.test(line))continue;
    const matches=found.get(definition.id)??[];
    if(matches.length>=12)continue;
    matches.push({path:source.path,line:index+1,excerpt:line.slice(0,180)});
    found.set(definition.id,matches);
   }
  }
 }
 const concepts:TextbookConcept[]=DEFINITIONS.filter(definition=>found.has(definition.id))
  .map(({pattern:ignored,...definition})=>({
   ...definition,evidence:found.get(definition.id)??[],
  }));
 return {concepts,detectedLanguages:[...languages].sort(),analyzedFiles:paths.size};
}
function safeText(value:string):string{return value.replace(/[\\\r\n\[\]()<>*_`]/g,' ').slice(0,240)}
export function renderTextbookCurriculum(curriculum:TextbookCurriculum,repo:string,sha:string):string{
 if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)||! /^[a-f0-9]{40}$/i.test(sha))
  throw Error('Invalid textbook source revision');
 const lines=['## Begriffsregister und Lernpfad (aus Quellcode-Fundstellen)','',
  'Die folgenden Fundstellen wurden deterministisch erkannt. Treffer belegen die Verwendung einer Syntax, nicht die Ausführung eines Programmzweigs.',
  'Analysierte Dateien: '+curriculum.analyzedFiles+'; erkannte Sprachen: '+curriculum.detectedLanguages.join(', ')+'.',''];
 if(!curriculum.concepts.length)return [...lines,'Keine bekannten Sprachkonzepte in diesem Abschnitt erkannt.'].join('\n');
 for(const concept of curriculum.concepts){
  const deps=concept.prerequisites.filter(id=>curriculum.concepts.some(item=>item.id===id));
  lines.push('### '+safeText(concept.title),
   concept.explanation,
   deps.length?'**Zuerst lernen:** '+deps.map(id=>safeText(DEFINITIONS.find(x=>x.id===id)?.title??id)).join(', '):'**Voraussetzungen:** Keine aus diesem Register.',
   '**Offizielle Dokumentation:** '+concept.documentation,
   '**Echte Fundstellen:**');
  for(const match of concept.evidence){
   const url='https://github.com/'+repo+'/blob/'+sha+'/'+match.path+'#L'+match.line;
   lines.push('- [`'+safeText(match.path)+':'+match.line+'`]('+url+') — `'+safeText(match.excerpt)+'`');
  }
  lines.push('');
 }
 return lines.join('\n');
}
