import ts from 'typescript';

export type QualityPrinciple='clean-code'|'solid'|'dry'|'maintainability'|'security';
export interface CodeQualityFinding {
  principle:QualityPrinciple;
  rule:string;
  line:number;
  detail:string;
}
export interface CodeQualityAudit {
  passed:boolean;
  file:string;
  findings:CodeQualityFinding[];
  checked:['clean-code','solid','dry','security'];
}
/** Deterministic, dependency-free AST checks for an individual TypeScript/JS file.
 * These checks are evidence, not a proof of SOLID/DRY adherence. All findings
 * must have a bounded, reproducible location. The model's qualitative review
 * separately assesses abstractions, responsibilities and actual duplication.
 */
export function auditCodeSource(file:string,source:string):CodeQualityAudit {
  if(typeof source!=='string'||Buffer.byteLength(source,'utf8')>128*1024)
    throw Error('Code audit input too large');
  if(!/\.(?:ts|tsx|js|jsx)$/.test(file))
    throw Error('Unsupported source for code audit');
  const kind=file.endsWith('.tsx')?ts.ScriptKind.TSX:
    file.endsWith('.jsx')?ts.ScriptKind.JSX:
    file.endsWith('.ts')?ts.ScriptKind.TS:ts.ScriptKind.JS;
  const node=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,kind);
  const findings:CodeQualityFinding[]=[];
  const position=(offset:number)=>node.getLineAndCharacterOfPosition(offset).line+1;
  const add=(principle:QualityPrinciple,rule:string,offset:number,detail:string)=>{
    findings.push({principle,rule,line:position(offset),detail});
  };
  for(const diagnostic of (node as ts.SourceFile & {parseDiagnostics?: readonly ts.Diagnostic[]}).parseDiagnostics??[]){
    add('clean-code','syntax',diagnostic.start??0,
      'Code contains a TypeScript/JavaScript syntax error');
  }
  const lines=source.split(/\r?\n/);
  for(let i=0;i<lines.length;i++){
    if(/\/\/\s*@ts-(?:ignore|nocheck)\b/.test(lines[i]))
      add('clean-code','unsafe-suppression',
        node.getPositionOfLineAndCharacter(i,0),
        'Do not bypass the type system with ts-ignore or ts-nocheck');
    if(lines[i].length>160)
      add('maintainability','long-line',
        node.getPositionOfLineAndCharacter(i,0),
        'Line exceeds 160 characters');
  }
  const functions:ts.FunctionLikeDeclaration[]=[];
  function visit(item:ts.Node):void{
    if(ts.isFunctionDeclaration(item)||ts.isMethodDeclaration(item)||
      ts.isFunctionExpression(item)||ts.isArrowFunction(item)||
      ts.isConstructorDeclaration(item)||ts.isGetAccessorDeclaration(item)||
      ts.isSetAccessorDeclaration(item))
      functions.push(item);
    if(item.kind===ts.SyntaxKind.AnyKeyword)
      add('clean-code','explicit-any',item.getStart(node),
        'Replace any with a declared type or narrowed unknown');
    if(ts.isCallExpression(item)&&ts.isIdentifier(item.expression)&&
      item.expression.text==='eval')
      add('security','dynamic-eval',item.getStart(node),
        'Dynamic eval executes untrusted JavaScript');
    if(ts.isNewExpression(item)&&ts.isIdentifier(item.expression)&&
      item.expression.text==='Function')
      add('security','dynamic-function',item.getStart(node),
        'Constructing executable code from strings is unsafe');
    if(ts.isBinaryExpression(item)&&
      item.operatorToken.kind===ts.SyntaxKind.EqualsToken&&
      ts.isPropertyAccessExpression(item.left)&&item.left.name.text==='innerHTML')
      add('security','unsafe-html-assignment',item.getStart(node),
        'Direct innerHTML writes bypass safe DOM rendering');
    if(ts.isVariableDeclaration(item)&&ts.isIdentifier(item.name)&&
      /(?:api[_-]?key|secret|password|access[_-]?token|private[_-]?key)/i.test(item.name.text)&&
      item.initializer&&ts.isStringLiteral(item.initializer)){
      const value=item.initializer.text;
      if(value.length>=12&&!/^(?:example|placeholder|test|dummy|change[_-]?me)/i.test(value))
        add('security','hardcoded-credential',item.getStart(node),
          'Potential credential stored in a source literal');
    }
    ts.forEachChild(item,visit);
  }
  visit(node);
  for(const fn of functions){
    const start=position(fn.getStart(node)),end=position(fn.end);
    if(end-start+1>85)
      add('solid','oversized-function',fn.getStart(node),
        'Function exceeds 85 lines; examine single responsibility');
    let branches=0;
    const inspect=(item:ts.Node):void=>{
      if(item!==fn&&(ts.isFunctionDeclaration(item)||ts.isArrowFunction(item)||
        ts.isFunctionExpression(item)||ts.isMethodDeclaration(item)))return;
      if(ts.isIfStatement(item)||ts.isConditionalExpression(item)||
        ts.isForStatement(item)||ts.isForInStatement(item)||
        ts.isForOfStatement(item)||ts.isWhileStatement(item)||
        ts.isDoStatement(item)||ts.isCatchClause(item)||
        ts.isCaseClause(item))branches++;
      ts.forEachChild(item,inspect);
    };
    if(fn.body)inspect(fn.body);
    if(branches>14)
      add('clean-code','high-branch-count',fn.getStart(node),
        'Function exceeds 14 decision branches; consider decomposition');
  }
  // Only repeated blocks of meaningful source text are machine detectable.
  // Literal equality here does NOT imply abstraction is warranted.
  const blocks=new Map<string,number>();
  for(let i=0;i+5<lines.length;i++){
    const group=lines.slice(i,i+6).map(line=>line.trim()).filter(Boolean);
    if(group.length!==6||group.some(line=>line.length<8))continue;
    const signature=group.join('\n');
    const previous=blocks.get(signature);
    if(previous!==undefined&&i-previous>=6)
      add('dry','repeated-six-line-block',
        node.getPositionOfLineAndCharacter(i,0),
        'Six consecutive substantive lines repeat; evaluate duplication');
    else blocks.set(signature,i);
  }
  return {passed:findings.length===0,file,findings,
    checked:['clean-code','solid','dry','security']};
}
