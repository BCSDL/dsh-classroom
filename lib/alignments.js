import fs from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';

export async function alignCourse(k,job,context){
 await k.sync(job,context);
 const pages=new Map(),timeline=new Map(),folder=join(k.config.dataDirectory,'jobs',job.id);
 for(const meta of Object.values(k.registry.documents)){
  if(!k.allowed(meta,context,'project')||meta.source?.jobId!==job.id||meta.source.kind!=='material'||!meta.source.page)continue;
  const key=meta.source.source+':'+meta.source.page,page=pages.get(key)||{key,docId:meta.id,source:meta.source.source,page:meta.source.page,text:'',name:k.registry.assets[meta.source.originalAsset||meta.source.asset]?.originalName||meta.title};
  page.text+='\n'+(await k.store.read({id:meta.id,limit:100})).content;pages.set(key,page);
 }
 for(const name of (await fs.readdir(join(folder,'results'))).filter(n=>/^\d{8}\.json$/.test(n)).sort())for(const s of JSON.parse(await fs.readFile(join(folder,'results',name))).segments||[]){
  const key=Math.floor(s.start/30),group=timeline.get(key)||{start:s.start,end:s.end,text:''};
  group.end=Math.max(group.end,s.end);group.text+=' '+s.text;timeline.set(key,group);
 }
 const blocks=[...timeline.values()].sort((a,b)=>a.start-b.start),material=[...pages.values()].sort((a,b)=>a.source.localeCompare(b.source)||a.page-b.page);
 const signature=createHash('sha256').update(JSON.stringify([material,blocks])).digest('hex'),cache=join(k.root,'alignment-'+job.id+'.json');
 try{const previous=JSON.parse(await fs.readFile(cache));if(previous.signature===signature)return {...previous,pages:previous.pages.map(page=>({...page,confirmed:(job.alignments||[]).find(x=>x.key===page.key)}))};}catch(e){if(e.code!=='ENOENT'&&!(e instanceof SyntaxError))throw e;}
 async function embeddings(texts,query){const vectors=[];for(let at=0;at<texts.length;at+=12)vectors.push(...(await k.embedder.call('embed',{query,texts:texts.slice(at,at+12).map(x=>x.slice(0,6000))})).vectors);return vectors;}
 let vectors=[],queries=[],warning;
 if(material.length&&blocks.length)try{vectors=await embeddings(blocks.map(x=>x.text),false);queries=await embeddings(material.map(x=>x.text),true);}catch(e){warning=e.message;}
 const output=[];for(const[i,page]of material.entries()){
  const candidates=[];if(queries[i])for(const[j,block]of blocks.entries()){const score=queries[i].reduce((sum,v,at)=>sum+v*vectors[j][at],0);if(score>=.78)candidates.push({...block,score});}
  candidates.sort((a,b)=>b.score-a.score);
  output.push({...page,text:page.text.slice(0,6000),candidates:candidates.slice(0,3),confirmed:(job.alignments||[]).find(x=>x.key===page.key)});
  if(i%20===0)await new Promise(resolve=>setImmediate(resolve));
 }
 const result={signature,mode:queries.length?'multilingual CPU semantic candidates':'manual',warning,pages:output,notice:'语义分数不是准确率；请回听后确认。已确认关联由人工保存。'};
 await fs.writeFile(cache,JSON.stringify(result));return result;
}
