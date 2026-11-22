/* Pure, deterministic rendering of verified development lessons into a growing Markdown book.
 * Never executes source code, touches Git, writes files, or treats repository content as instructions.
 */
export interface LearningSource {
  title:string;
  url:string;
  verified:boolean;
}
export interface LearningExercise {
  question:string;
  solution:string;
  explanation:string;
}
export interface LearningSnippet { language:string; code:string; explanation:string }
export interface LearningEntry {
  key:string;
  topic:string;
  topicTitle:string;
  title:string;
  repo:string;
  issueNumber:number;
  commitSha:string;
  changedPaths:readonly string[];
  plainExplanation:string;
  technicalExplanation:string;
  whatChanged:string;
  why:string;
  rationaleEvidence:'documented'|'reconstructed';
  manualSteps:readonly string[];
  snippets:readonly LearningSnippet[];
  exercises:readonly LearningExercise[];
  references:readonly LearningSource[];
  qualityVerified:boolean;
}
export interface LearningBook {
  textbookMarkdown:string;
  solutionsMarkdown:string;
  reportsMarkdown:string;
  topics:readonly string[];
  lessonCount:number;
}
const SLUG=/^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const REPOSITORY=/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/;
const SHA=/^[0-9a-f]{40}$/i;
const LANGUAGE=/^[a-zA-Z0-9+#.-]{1,24}$/;
const MAX_TEXT=10_000;
function textValue(value:string,name:string):string {
  if(typeof value!=='string'||!value.trim()||value.length>MAX_TEXT)
    throw Error('Invalid learning entry: '+name);
  return value.trim();
}
function safeLine(value:string):string {
  return value.replace(/\r\n?/g,'\n').replace(/[<>]/g,char=>char==='<'?'&lt;':'&gt;')
    .replace(/\\/g,'\\\\').replace(/([*_[\]`])/g,'\\$1');
}
function safeParagraph(value:string):string {
  return safeLine(value).split('\n').map(s=>s.replace(/^([ \t]*)(#{1,6}|>|[-+]|\d+\.)\s/g,'$1\\$2 ')).join('\n');
}
function safeUrl(value:string):string {
  let parsed:URL;
  try{parsed=new URL(value);}catch{throw Error('Invalid reference URL');}
  if(parsed.protocol!=='https:'||!parsed.hostname||parsed.username||parsed.password)
    throw Error('Invalid reference URL');
  return parsed.toString();
}
function codeBlock(snippet:LearningSnippet):string {
  if(!LANGUAGE.test(snippet.language)||typeof snippet.code!=='string'||
    !snippet.code.trim()||snippet.code.length>20_000)
    throw Error('Invalid code example');
  const longest=Math.max(0,...Array.from(snippet.code.matchAll(/`+/g),m=>m[0].length));
  const fence='`'.repeat(Math.max(3,longest+1));
  return fence+snippet.language+'\n'+snippet.code.trimEnd()+'\n'+fence;
}
function validateEntry(entry:LearningEntry):void {
  if(!SLUG.test(entry.key)||!SLUG.test(entry.topic))throw Error('Invalid learning topic/key');
  for(const [name,value] of [
    ['title',entry.title],['topicTitle',entry.topicTitle],['plainExplanation',entry.plainExplanation],
    ['technicalExplanation',entry.technicalExplanation],['whatChanged',entry.whatChanged],['why',entry.why],
  ] as const)textValue(value,name);
  if(!REPOSITORY.test(entry.repo)||!SHA.test(entry.commitSha)||
    !Number.isSafeInteger(entry.issueNumber)||entry.issueNumber<1||!entry.qualityVerified)
    throw Error('Unverified or invalid learning evidence');
  if(entry.rationaleEvidence!=='documented'&&entry.rationaleEvidence!=='reconstructed')
    throw Error('Invalid decision evidence');
  if(!Array.isArray(entry.changedPaths)||entry.changedPaths.length===0||
    entry.changedPaths.some(p=>typeof p!=='string'||p.length>250||
      p.startsWith('/')||p.includes('..')||p.includes('\\')||p.trim()===''))
    throw Error('Invalid evidence path');
  if(!Array.isArray(entry.manualSteps)||entry.manualSteps.length===0||
    !Array.isArray(entry.snippets)||!Array.isArray(entry.exercises)||
    entry.exercises.length===0||!Array.isArray(entry.references))
    throw Error('Missing educational content');
  for(const step of entry.manualSteps)textValue(step,'manual step');
  for(const snippet of entry.snippets){textValue(snippet.explanation,'snippet explanation');codeBlock(snippet);}
  for(const exercise of entry.exercises){
    textValue(exercise.question,'exercise');textValue(exercise.solution,'solution');
    textValue(exercise.explanation,'solution explanation');
  }
  for(const reference of entry.references){textValue(reference.title,'source title');safeUrl(reference.url);
    if(typeof reference.verified!=='boolean')throw Error('Invalid reference verification');}
}
function evidenceLink(entry:LearningEntry):string {
  return 'https://github.com/'+entry.repo+'/commit/'+entry.commitSha;
}
function report(entry:LearningEntry):string {
  return [
    '### '+safeLine(entry.title),
    '- Issue: [#'+entry.issueNumber+'](https://github.com/'+entry.repo+'/issues/'+entry.issueNumber+')',
    '- Geprüfter Commit: ['+entry.commitSha.slice(0,12)+']('+evidenceLink(entry)+')',
    '- Betroffene Dateien: '+entry.changedPaths.map(p=>'`'+p.replace(/`/g,'')+'`').join(', '),
    '- Entscheidungsgrund: '+(entry.rationaleEvidence==='documented'
      ?'in Quellen dokumentiert':'didaktische Rekonstruktion, keine belegte historische Absicht'),
    '- Was wurde geändert? '+safeParagraph(entry.whatChanged),
    '- Warum dieser Ansatz? '+safeParagraph(entry.why),
  ].join('\n');
}
/** Replacing a topic uses stable entry keys, never append-only duplicates. */
export function upsertLearningEntry(existing:readonly LearningEntry[],incoming:LearningEntry):LearningEntry[]{
  validateEntry(incoming);
  const matched=existing.find(e=>e.key===incoming.key);
  if(matched&&(matched.repo!==incoming.repo||matched.issueNumber!==incoming.issueNumber))
    throw Error('Learning key collision across source projects/issues');
  return [...existing.filter(e=>e.key!==incoming.key),incoming];
}
export function buildLearningBook(entries:readonly LearningEntry[]):LearningBook {
  const seen=new Set<string>();
  for(const entry of entries){
    validateEntry(entry);
    if(seen.has(entry.key))throw Error('Duplicate learning entry: '+entry.key);
    seen.add(entry.key);
  }
  const sorted=[...entries].sort((a,b)=>
    a.topic.localeCompare(b.topic,'en')||a.key.localeCompare(b.key,'en'));
  const topics=[...new Set(sorted.map(e=>e.topic))];
  const headings=new Map<string,string>();
  for(const entry of sorted){
    const earlier=headings.get(entry.topic);
    if(earlier!==undefined&&earlier!==entry.topicTitle)throw Error('Conflicting topic title');
    headings.set(entry.topic,entry.topicTitle);
  }
  const book=['# Programmieren verstehen','',
    'Thematisch gegliedertes Lehrbuch – erstellt aus nachweislich geprüften Commits.',
    'Fachbegriffe werden zuerst einfach, anschließend technisch erklärt.',
    'Die Übungslösungen stehen ausschließlich in einer eigenen Datei.','',
    '## Inhaltsverzeichnis',
    ...topics.map((topic,i)=>(i+1)+'. '+safeLine(headings.get(topic)??topic)),
  ];
  const solutions=['# Musterlösungen zum Programmierlehrbuch','',
    'Die Lösungen sind bewusst getrennt, damit du die Aufgaben zuerst selbst bearbeiten kannst.'];
  const reports=['# Nachvollziehbare Entwicklungsreports','',
    'Fakten stammen aus verlinkten Commits; nicht belegte Motive sind als Rekonstruktion gekennzeichnet.'];
  for(const topic of topics){
    const lessons=sorted.filter(e=>e.topic===topic);
    book.push('','## '+safeLine(headings.get(topic)??topic));
    solutions.push('','## '+safeLine(headings.get(topic)??topic));
    reports.push('','## '+safeLine(headings.get(topic)??topic));
    for(const entry of lessons){
      book.push('','### '+safeLine(entry.title),
        '#### Einfach erklärt',safeParagraph(entry.plainExplanation),
        '#### Technische Vertiefung',safeParagraph(entry.technicalExplanation),
        '#### So setzt du es selbst um',
        ...entry.manualSteps.map((step,i)=>(i+1)+'. '+safeParagraph(step)),
        '#### Codebeispiele');
      if(entry.snippets.length===0)book.push('Noch kein geprüftes Codebeispiel vorhanden.');
      for(const snippet of entry.snippets)book.push('',codeBlock(snippet),
        safeParagraph(snippet.explanation));
      book.push('','#### Übe selbst',
        ...entry.exercises.map((exercise,i)=>(i+1)+'. '+safeParagraph(exercise.question)),
        '','#### Offizielle Quellen und Nachweise');
      for(const source of entry.references)book.push('- ['+safeLine(source.title)+']('+safeUrl(source.url)+')'+
        (source.verified?'':' **(Link noch nicht geprüft)**'));
      book.push('- [Implementierung: '+entry.commitSha.slice(0,12)+']('+evidenceLink(entry)+')',
        '- Ausführliche Änderungserklärung: siehe Entwicklungsreports.');
      solutions.push('','### '+safeLine(entry.title),
        ...entry.exercises.flatMap((exercise,i)=>[
          '#### Aufgabe '+(i+1),safeParagraph(exercise.question),
          '**Musterlösung:**',safeParagraph(exercise.solution),
          '**Warum funktioniert es?** '+safeParagraph(exercise.explanation),
        ]));
      reports.push('',report(entry));
    }
  }
  return {textbookMarkdown:book.join('\n')+'\n',
    solutionsMarkdown:solutions.join('\n')+'\n',
    reportsMarkdown:reports.join('\n')+'\n',topics,lessonCount:sorted.length};
}