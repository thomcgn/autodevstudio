import fs from 'node:fs';
import path from 'node:path';

const MAX_BYTES=256*1024;
const SUPPORTED=['typecheck','test','test:policy','test:unit','test:regression','test:coverage'] as const;

/** Conservative first-run policy. Quality scripts are chosen by trusted Studio
 * code, never from issue contents, model output, renderer input or arbitrary
 * package script names. Both typechecking and a test suite are required.
 * Every executable script still runs only inside the isolated quality sandbox.
 */
export function selectSafeQualityScripts(projectPath:string):string[]{
  const root=fs.realpathSync(projectPath);
  const file=path.join(root,'package.json');
  const stat=fs.lstatSync(file);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>MAX_BYTES)
    throw Error('Unsafe project package.json');
  const data:unknown=JSON.parse(fs.readFileSync(file,'utf8'));
  if(!data||typeof data!=='object'||Array.isArray(data))
    throw Error('Invalid package.json');
  const scripts=(data as Record<string,unknown>).scripts;
  if(!scripts||typeof scripts!=='object'||Array.isArray(scripts))
    throw Error('Missing package scripts');
  const scriptMap=scripts as Record<string,unknown>;
  const available=SUPPORTED.filter(name=>
    typeof scriptMap[name]==='string'&&scriptMap[name].trim().length>0);
  if(!available.includes('typecheck'))
    throw Error('Quality requires typecheck script');
  const test=available.find(name=>name==='test')??
    available.find(name=>name==='test:policy')??
    available.find(name=>name==='test:unit');
  if(!test)throw Error('Quality requires an approved test script');
  // If a project already declares dedicated regression/coverage scripts,
  // they become mandatory: a failure must block the reviewed issue PR.
  // Missing scripts are never fabricated and never considered "100% coverage".
  const extra=['test:regression','test:coverage']
    .filter(name=>available.includes(name as typeof SUPPORTED[number])&&name!==test);
  return ['typecheck',test,...extra];
}
