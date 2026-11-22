import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {assertBranchProtection,type BranchProtectionEvidence} from './branch-protection.ts';

const exec=promisify(execFile);
interface LabelDefinition {name:string;color:string;description:string}
export interface LabelOnboardingResult {
 repository:string;protectedBranch:string;created:readonly string[];
 alreadyPresent:readonly string[];total:number;
}
export type GitHubLabelRunner=(args:readonly string[],cwd:string)=>Promise<string>;
const gh:GitHubLabelRunner=async(args,cwd)=>
 (await exec('gh',[...args],{cwd,encoding:'utf8',timeout:20_000,
  maxBuffer:2_000_000,windowsHide:true,shell:false,
  env:{...process.env,GH_PROMPT_DISABLED:'1',GIT_TERMINAL_PROMPT:'0'}})).stdout;
export const REQUIRED_ISSUE_LABELS:readonly LabelDefinition[]=[
 {name:'status:backlog',color:'8b949e',description:'Erfasst, noch nicht freigegeben'},
 {name:'status:triage',color:'d4a72c',description:'Klärung und Risikobewertung erforderlich'},
 {name:'status:ready',color:'238636',description:'Geprüft, bereit für einen neuen Issue-Lauf'},
 {name:'status:planning',color:'0969da',description:'Planner aktiv; noch keine Codefreigabe'},
 {name:'status:in-progress',color:'0969da',description:'Builder arbeitet am Issue'},
 {name:'status:review',color:'8250df',description:'Unabhängiger Review und QM ausstehend'},
 {name:'status:approved',color:'1a7f37',description:'Review und Quality PASS für nachgewiesene Revision'},
 {name:'status:blocked',color:'cf222e',description:'Sicherheit, Abhängigkeit oder Fehler verhindert Ausführung'},
 {name:'status:done',color:'6e7781',description:'Abschluss nach verifiziertem PR und Issue-Status'},
 {name:'priority:p0',color:'b60205',description:'Kritisch, Datenverlust oder Sicherheitsrisiko'},
 {name:'priority:p1',color:'d93f0b',description:'Hohe Priorität'},
 {name:'priority:p2',color:'fbca04',description:'Normale Priorität'},
 {name:'priority:p3',color:'c2e0c6',description:'Niedrige Priorität'},
 {name:'needs-triage',color:'d4a72c',description:'Anforderungen unklar; menschliche Triage notwendig'},
 {name:'blocked',color:'cf222e',description:'Explizite manuelle Sperre'},
 {name:'manual-only',color:'6e7781',description:'Keine automatische Entwicklung erlaubt'},
] as const;
interface ExistingLabel {name:string;color:string;description:string}
function parseExisting(raw:string):Map<string,ExistingLabel>{
 let source:unknown;
 try{source=JSON.parse(raw);}catch{throw Error('GitHub label response malformed');}
 if(!Array.isArray(source)||source.length>=1000)
  throw Error('GitHub label list incomplete or invalid');
 const found=new Map<string,ExistingLabel>();
 for(const item of source){
  if(!item||typeof item!=='object'||Array.isArray(item))
   throw Error('Invalid GitHub label');
  const x=item as Record<string,unknown>;
  if(typeof x.name!=='string'||typeof x.color!=='string'||
    (x.description!==null&&typeof x.description!=='string')||!/^[a-fA-F0-9]{6}$/.test(x.color))
    throw Error('Invalid GitHub label metadata');
  const key=x.name.toLowerCase();
  if(found.has(key))throw Error('Duplicate GitHub label');
  found.set(key,{name:x.name,color:x.color.toLowerCase(),description:typeof x.description==='string'?x.description:''});
 }
 return found;
}
/** Must only be invoked from the authorized selected project in Main.
 * No issue changes, no renaming existing labels, and no blind retries.
 */
export async function installRequiredIssueLabels(
 projectPath:string,runner:GitHubLabelRunner=gh,
 protect:(path:string)=>Promise<BranchProtectionEvidence>=assertBranchProtection,
):Promise<LabelOnboardingResult>{
 const verified=await protect(projectPath);
 if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(verified.repository))
  throw Error('Cannot verify selected repository');
 const repository=verified.repository;
 const before=parseExisting(await runner(['label','list','--repo',repository,
  '--limit','1000','--json','name,color,description'],projectPath));
 const existing:string[]=[];
 const missing:LabelDefinition[]=[];
 const mismatch:string[]=[];
 for(const label of REQUIRED_ISSUE_LABELS){
  const current=before.get(label.name.toLowerCase());
  if(!current){missing.push(label);continue;}
  if(current.color!==label.color||current.description!==label.description)
   mismatch.push(label.name);
  else existing.push(label.name);
 }
 if(mismatch.length)throw Error('Conflicting existing label definitions: '+
  mismatch.join(', ')+'; resolve manually before onboarding');
 const created:string[]=[];
 for(const label of missing){
  // Safe to retry only by re-reading the server after a failure; never force-update.
  await runner(['label','create',label.name,'--repo',repository,
   '--color',label.color,'--description',label.description],projectPath);
  created.push(label.name);
 }
 return {repository,protectedBranch:verified.branch,created,
  alreadyPresent:existing,total:REQUIRED_ISSUE_LABELS.length};
}
