/* Read-only, commit-pinned repository stack discovery for the learner assessment. */
import {parsePublicRepository} from './public-history.ts';
import {readSourceGitHub,type GitHubReader} from './deep-learning-analysis.ts';
import type {LearningStack} from './learning-assessment.ts';
type JsonObject=Record<string,unknown>;
function record(input:unknown):JsonObject|null{
 return input!==null&&typeof input==='object'&&!Array.isArray(input)?input as JsonObject:null;
}
export async function detectRepositoryLearningStacks(
 input:string,head:string,read:GitHubReader=readSourceGitHub,
):Promise<readonly LearningStack[]>{
 const repository=parsePublicRepository(input);
 if(!/^[a-f0-9]{40}$/i.test(head))throw Error('Invalid stack scan revision');
 const commit=record(await read('repos/'+repository+'/git/commits/'+head));
 const treeSha=record(commit?.tree)?.sha;
 if(typeof treeSha!=='string'||!/^[a-f0-9]{40}$/i.test(treeSha))
  throw Error('Invalid stack scan tree');
 const tree=record(await read('repos/'+repository+'/git/trees/'+treeSha+'?recursive=1'));
 if(tree?.truncated!==false||!Array.isArray(tree?.tree))
  throw Error('Incomplete stack scan tree');
 const paths=new Set(tree.tree.map(item=>record(item)?.path).filter((value):value is string=>typeof value==='string'));
 const stacks=new Set<LearningStack>(['fundamentals']);
 if([...paths].some(p=>p.endsWith('.java')||p.endsWith('pom.xml')||/build\.gradle(?:\.kts)?$/.test(p)))stacks.add('java');
 if([...paths].some(p=>p.endsWith('.sql')))stacks.add('sql');
 if([...paths].some(p=>/\.(?:ts|tsx)$/.test(p)))stacks.add('typescript');
 if([...paths].some(p=>/\.(?:jsx|tsx)$/.test(p)||/(?:^|\/)react(?:\/|$)/i.test(p)))stacks.add('react');
 if([...paths].some(p=>/\/src\/main\/java\//.test(p)||/spring/i.test(p)))stacks.add('spring');
 return [...stacks];
}
