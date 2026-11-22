/** Offline-only HTML print view. No arbitrary HTML or remote resources. */
function escape(value:string):string{
 return value.replace(/&/g,'&amp;').replace(/</g,'&lt;')
  .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function inline(value:string):string{
 const escaped=escape(value);
 return escaped.replace(/\[([^\]\n]{1,180})\]\((https:\/\/[^\s)\n]{1,1500})\)/g,
  (_match,label:string,url:string)=>'<a href="'+url.replace(/&/g,'&amp;').replace(/"/g,'&quot;')+
   '">'+label+'</a>');
}
export function markdownToPrintHtml(markdown:string,title='Programmierlehrbuch'):string{
 if(typeof markdown!=='string'||markdown.length>2_000_000)throw Error('Document exceeds print limit');
 const out:string[]=[];
 let inCode=false;
 let codeLines:string[]=[];
 let inList=false;
 const closeList=():void=>{if(inList){out.push('</ol>');inList=false;}};
 for(const raw of markdown.replace(/\r\n?/g,'\n').split('\n')){
  const fence=/^~~~([A-Za-z0-9+#.-]*)\s*$/.exec(raw);
  if(fence){
   if(inCode){
    out.push('<pre><code>'+escape(codeLines.join('\n'))+'</code></pre>');
    codeLines=[];inCode=false;
   }else{closeList();inCode=true;}
   continue;
  }
  if(inCode){codeLines.push(raw);continue;}
  if(!raw.trim()){closeList();continue;}
  const heading=/^(#{1,6})\s+(.+)$/.exec(raw);
  if(heading){closeList();const level=heading[1].length;
   out.push('<h'+level+'>'+inline(heading[2])+'</h'+level+'>');continue;}
  const ordered=/^\d+\.\s+(.+)$/.exec(raw);
  if(ordered){if(!inList){out.push('<ol>');inList=true;}
   out.push('<li>'+inline(ordered[1])+'</li>');continue;}
  closeList();
  if(raw.startsWith('- ')){out.push('<p class="bullet">• '+inline(raw.slice(2))+'</p>');continue;}
  out.push('<p>'+inline(raw)+'</p>');
 }
 closeList();
 if(inCode)throw Error('Unclosed Markdown code block');
 return '<!doctype html><html lang="de"><head><meta charset="utf-8">'+
  '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src \'none\';">'+
  '<title>'+escape(title)+'</title><style>'+
  '@page{size:A4;margin:19mm 17mm 19mm 17mm}body{font-family:Arial,sans-serif;color:#192335;'+
  'font-size:10.5pt;line-height:1.48}h1{font-size:24pt;color:#152a48}h2{font-size:17pt;'+
  'break-before:page;color:#173653}h3{font-size:13.5pt;margin-top:15pt}h4{font-size:11pt}'+
  'h1,h2,h3,h4{break-after:avoid}p,li{orphans:3;widows:3}pre{font-family:monospace;'+
  'font-size:8.5pt;white-space:pre-wrap;overflow-wrap:anywhere;background:#f1f3f6;'+
  'padding:10px;border-left:3px solid #53677d;break-inside:avoid}a{color:#174d83}'+
  'ol{padding-left:23px}.bullet{margin:5px 0}</style></head><body>'+
  out.join('\n')+'</body></html>';
}