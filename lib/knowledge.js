import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {join,resolve,relative,isAbsolute,basename,extname} from 'node:path';
import {WorkerClient} from './worker-client.js';
import {fileURLToPath} from 'node:url';

// Reuse the published MIT data engine, not its standalone HTTP surface.
// All classroom access stays behind DSH's existing authenticated Connection.
const engineBase=new URL('.',import.meta.resolve('dsh-knowledge-base-local/kb'));
const {KnowledgeStore}=await import(new URL('src/store.js',engineBase));
const {normalizeSettings}=await import(new URL('src/settings.js',engineBase));
const {parseDocFile}=await import(new URL('src/util.js',engineBase));
const hash=value=>createHash('sha256').update(value).digest('hex');
const inside=(root,path)=>{const part=relative(root,path);return part===''||(!isAbsolute(part)&&part!=='..'&&!part.startsWith('..\\')&&!part.startsWith('../'));};
async function json(path,fallback){try{return JSON.parse(await fs.readFile(path,'utf8'));}catch(e){if(e.code==='ENOENT')return fallback;throw e;}}
async function atomic(path,value){const temporary=path+'.'+randomUUID()+'.tmp';await fs.writeFile(temporary,JSON.stringify(value,null,2));await fs.rename(temporary,path);}

export class ClassroomKnowledge {
 constructor(config,{embedder}={}){
  this.config=config;this.root=resolve(config.dataDirectory,'knowledge');this.registryPath=join(this.root,'classroom-sources.json');
  this.store=new KnowledgeStore(normalizeSettings({rootDir:this.root,vectorMode:'local',watch:{enabled:false},mcp:{enabled:false},chunkSize:1400,chunkOverlap:160}));
  this.embedder=embedder||new WorkerClient(config,fileURLToPath(new URL('../backend/embedder.py',import.meta.url)));
  this.vectorCache=new Map();this.serial=Promise.resolve();this.ready=this.load();this.ready.catch(error=>console.error('classroom knowledge:',error.message));
 }
 async load(){await fs.mkdir(this.root,{recursive:true});await this.store.init();await fs.mkdir(join(this.root,'assets'),{recursive:true});await fs.mkdir(join(this.root,'semantic'),{recursive:true});this.registry=await json(this.registryPath,{version:1,documents:{},keys:{},assets:{}});}
 queue(task){const result=this.serial.then(task);this.serial=result.catch(()=>{});return result;}
 async save(){const content=JSON.parse(JSON.stringify(this.registry));this.saves=(this.saves||Promise.resolve()).catch(()=>{}).then(()=>atomic(this.registryPath,content));return this.saves;}
 collection(context){return context?.projectDirectory?'project-'+hash(process.platform==='win32'?context.projectDirectory.toLowerCase():context.projectDirectory).slice(0,16):'unbound';}
 async preserve(source){
  await this.ready;source=await fs.realpath(source);const info=await fs.stat(source);if(!info.isFile())throw Error('原始资料不是文件');
  const root=await fs.realpath(this.root),assets=await fs.realpath(join(root,'assets'));if(!inside(root,assets))throw Error('知识库资料目录越界');
  if(inside(assets,source))return {path:source,asset:basename(source),bytes:info.size,originalName:this.registry.assets[basename(source)]?.originalName};
  if((await fs.statfs(assets)).bavail*(await fs.statfs(assets)).bsize<info.size+64*1024*1024)throw Error('知识库磁盘剩余空间不足，原始资料未移动');
  const digest=createHash('sha256');for await(const chunk of createReadStream(source))digest.update(chunk);const sha=digest.digest('hex');
  const name=sha+extname(source).toLowerCase().replace(/[^a-z0-9.]/g,'').slice(0,12),target=join(assets,name);
  try{await fs.access(target);}catch(e){if(e.code!=='ENOENT')throw e;const temporary=target+'.'+randomUUID()+'.part';await fs.copyFile(source,temporary);await fs.rename(temporary,target);}
  const originalName=inside(resolve(this.config.dataDirectory,'imports'),source)?basename(source).replace(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}-/i,''):basename(source);
  this.registry.assets[name]={name,sha256:sha,bytes:info.size,originalName,savedAt:Date.now()};await this.save();
  return {path:target,asset:name,sha256:sha,bytes:info.size,originalName};
 }
 async upsert(key,{title,text,source,context,kind='evidence',tags=[]}){
  const digest=hash(text),prior=this.registry.keys[key];let meta=prior&&this.registry.documents[prior];
  if(meta?.deleted)return meta;
  if(meta?.disabled){await this.store.restore(meta.id);meta.disabled=false;await this.save();}
  if(meta?.semantic&&meta.hash===digest&&meta.title===title&&JSON.stringify(meta.source)===JSON.stringify(source))return meta;
  const input={title,text,collection:this.collection(context),tags:['classroom',kind,...tags],source,dedupe:false};
  const document=meta?await this.store.update({...input,id:meta.id}):await this.store.add(input);
  let semantic=meta?.hash===digest&&meta?.semantic;
  try{if(!semantic){const index=await this.store.loadIndex(document.id),rows=[];for(let offset=0;offset<index.chunks.length;offset+=12){const chunks=index.chunks.slice(offset,offset+12),vectors=(await this.embedder.call('embed',{texts:chunks.map(c=>c.text)})).vectors;for(let i=0;i<chunks.length;i++)rows.push({chunk:chunks[i].i,vector:vectors[i]});}await atomic(join(this.root,'semantic',document.id+'.json'),rows);this.vectorCache.set(document.id,rows);semantic=true;}this.embeddingError=null;}catch(e){semantic=false;this.embeddingError=e.message;}
  meta={id:document.id,key,title,hash:digest,source,kind,collection:input.collection,projectDirectory:context?.projectDirectory,semantic:!!semantic,updated:Date.now()};
  this.registry.keys[key]=document.id;this.registry.documents[document.id]=meta;await this.save();return meta;
 }
 async sync(job,binding){return this.queue(async()=>{
  await this.ready;if(job.kind==='question')return;
  const directory=join(this.config.dataDirectory,'jobs',job.id),context=binding||{};
  // Older recordings can outlive a manually moved upload. Preserve their
  // surviving transcript and report the absent original, without blocking
  // indexing of every later course.
  const missingSources=[],replacements={};const keep=async path=>{try{return await this.preserve(path);}catch(error){if(error.code!=='ENOENT')throw error;missingSources.push(basename(path));return null;}};
  for(const path of [job.source,...(job.materials||[]).map(x=>x.path)].filter(Boolean)){const kept=await keep(path);if(kept&&kept.path!==path)replacements[path]=kept.path;}
  if(['live','watch'].includes(job.kind)&&['complete','error','cancelled','paused'].includes(job.state)&&Object.keys(job.chunks||{}).length&&this.worker){const audio=await this.worker.call('audio',{id:job.id});const kept=await this.preserve(audio.path);job={...job,source:kept.path};}
  if(Object.keys(replacements).length&&this.worker){await this.worker.call('adopt_sources',{id:job.id,replacements});job={...job,source:replacements[job.source]||job.source,materials:(job.materials||[]).map(m=>({...m,path:replacements[m.path]||m.path}))};}
  const sourceBase={jobId:job.id,title:job.title,projectDirectory:context.projectDirectory,sessionId:context.sessionId,
   asset:job.source&&inside(join(this.root,'assets'),job.source)?basename(job.source):undefined};
  let count=0;const active=new Set();
  const add=async(key,text,source,kind='evidence')=>{
   if(!text?.trim())return;
   for(let offset=0;offset<text.length;offset+=1800){const origin=`${job.id}:${key}:${offset}`;active.add(origin);await this.upsert(origin,{title:job.title+' · '+key,text:text.slice(offset,offset+2000),source:{...sourceBase,...source,textOffset:offset},context,kind});count++;}
  };
  const originals=[job.source,...(job.materials||[]).map(m=>m.path)].filter(Boolean).map(path=>this.registry.assets[basename(path)]?.originalName||basename(path));
  await add('inventory',`${job.title}\n原始资料 Original sources: ${originals.join(', ')||'持续录音片段'}\n处理状态 Extraction state: ${job.state||'saved'}${job.error?'\n提取失败/尚未完成，请勿推断文件内容：'+job.error:''}${missingSources.length?'\n原始文件缺失，已有转写仍保留 Missing originals: '+missingSources.join(', '):''}`,{kind:'catalog',extractionState:job.state,error:job.error,missingSources},'catalog');
  for(const name of (await fs.readdir(join(directory,'results'))).filter(n=>/^\d{8}\.json$/.test(n)).sort()){
   const item=await json(join(directory,'results',name),{}),segments=item.segments||[];
   await add('audio:'+name,segments.map(s=>`[${s.start.toFixed(1)}–${s.end.toFixed(1)}] ${job.speakerNames?.[s.speaker]||s.speaker}: ${s.text}`).join('\n'),{kind:'transcript',time:segments[0]?.start||item.offset||0,end:segments.at(-1)?.end,chunk:item.index},'transcript');
   if(!item.analysisStale)await add('translation:'+name,item.analysis,{kind:'translation',time:item.offset||0,chunk:item.index},'analysis');
  }
  const materials=join(directory,'materials.jsonl');
  try{for(const line of (await fs.readFile(materials,'utf8')).split(/\r?\n/).filter(Boolean)){const item=JSON.parse(line);let asset;const originalAsset=this.registry.assets[item.source?.source]?item.source.source:sourceBase.asset;if(item.source?.image)asset=(await this.preserve(item.source.image)).asset;else asset=originalAsset;await add('material:'+item.key,(item.source?.text||'')+'\n'+(item.analysis||''),{kind:'material',...item.source,...asset?{asset}:{},...originalAsset?{originalAsset}:{}},'material');}}catch(e){if(e.code!=='ENOENT')throw e;}
  try{for(const name of (await fs.readdir(join(directory,'frames'))).filter(n=>n.endsWith('.json'))){const item=await json(join(directory,'frames',name),{});const kept=item.image?await this.preserve(item.image):null;await add('frame:'+name,item.analysis,{kind:'frame',time:item.offset??item.captureSeconds,frame:item.index,playerTime:item.playerSeconds,...kept?{asset:kept.asset}:{}},'frame');}}catch(e){if(e.code!=='ENOENT')throw e;}
  for(const note of job.notes||[])await add('note:'+note.id,note.text,{kind:note.kind||'note',time:note.time,page:note.page,material:note.source},'note');
  if(!job.summaryStale)await add('summary',job.deepSummary||job.summary,{kind:'summary'},'summary');
  for(const meta of Object.values(this.registry.documents))if(meta.source?.jobId===job.id&&!active.has(meta.key)&&!meta.deleted&&!meta.disabled){await this.store.remove(meta.id);meta.disabled=true;await this.save();}
  for(const path of [job.source,...(job.materials||[]).map(x=>x.path)].filter(Boolean))if(!missingSources.includes(basename(path)))await this.preserve(path);
  return {indexed:count,embeddingError:this.embeddingError};
 });}
 allowed(meta,context,scope){return !!meta&&!meta.deleted&&!meta.disabled&&(scope==='all'||meta.collection===this.collection(context));}
 async list(context,args={}){await this.ready;return {root:this.root,engine:'dsh-knowledge-base-local@1.2.5',embedding:'multilingual-e5-small-int8 / CPU',embeddingError:this.embeddingError||null,documents:Object.values(this.registry.documents).filter(m=>this.allowed(m,context,args.scope)).map(({vector,...m})=>m),assets:Object.keys(this.registry.assets).length};}
 async read(context,args){await this.ready;const meta=this.registry.documents[args.id];if(!this.allowed(meta,context,args.scope))throw Error('知识条目不属于当前范围或已删除');if(args.full&&meta.kind==='note'){const manifest=await this.store.loadManifest(),content=await this.store.readDocBody(this.store.findDoc(manifest,args.id));return {id:args.id,title:meta.title,content:content.slice(0,200000),truncated:content.length>200000,source:meta.source,kind:meta.kind};}return {...await this.store.read({id:args.id,offset:args.offset,limit:args.limit}),source:meta.source,kind:meta.kind};}
 async noteVersion(context,args){await this.ready;const meta=this.registry.documents[args.id];if(!this.allowed(meta,context,args.scope)||meta.kind!=='note'||meta.source?.jobId)throw Error('请选择独立知识笔记；课堂笔记请在原记录中管理');const directory=join(this.root,'versions',meta.id);let versions=[];try{versions=(await fs.readdir(directory)).filter(n=>n.endsWith('.md')).sort().reverse();}catch(e){if(e.code!=='ENOENT')throw e;}if(!args.version)return {versions};if(!versions.includes(args.version))throw Error('无效历史版本');const actual=await fs.realpath(join(directory,args.version));if(!inside(await fs.realpath(join(this.root,'versions')),actual))throw Error('版本路径越界');const parsed=parseDocFile(await fs.readFile(actual,'utf8'));return this.editNote(context,{...args,text:this.store.decodeBody(parsed.body,meta.id)});}
 async search(context,args){
  await this.ready;const query=String(args.query||'').trim().slice(0,4000);if(!query)throw Error('请输入检索内容');
  const lexical=await this.store.search({query,collection:args.scope==='all'?'':this.collection(context),limit:50,mode:'lexical'});
  const lex=new Map(lexical.results.map(x=>[x.docId,x]));let vector;
  try{vector=(await this.embedder.call('embed',{texts:[query],query:true})).vectors[0];this.embeddingError=null;}catch(e){this.embeddingError=e.message;}
  const hits=[];
  for(const meta of Object.values(this.registry.documents)){
   if(!this.allowed(meta,context,args.scope))continue;
   const match=lex.get(meta.id);let similarity=0,bestChunk=match?.chunk;
   if(meta.kind==='catalog'&&!match)continue;
   if(vector&&meta.semantic){let rows=this.vectorCache.get(meta.id);if(!rows){rows=await json(join(this.root,'semantic',meta.id+'.json'),[]);if(this.vectorCache.size>5000)this.vectorCache.clear();this.vectorCache.set(meta.id,rows);}for(const row of rows)if(row.vector?.length===vector.length){const score=row.vector.reduce((sum,v,i)=>sum+v*vector[i],0);if(score>similarity){similarity=score;if(!match)bestChunk=row.chunk;}}}
   // E5 cosine is not a calibrated relevance probability; lexical evidence remains visible.
   if(!match&&(!vector||similarity<0.78))continue;
   hits.push({id:meta.id,title:meta.title,source:meta.source,kind:meta.kind,chunk:bestChunk,similarity,lexical:match?.score||0,score:(match?.score||0)+Math.max(0,similarity-.75)*2});
  }
  hits.sort((a,b)=>b.score-a.score);const results=[];
  for(const hit of hits.slice(0,Math.min(30,Math.max(1,args.limit||8)))){const doc=await this.store.read({id:hit.id,chunk:hit.chunk,limit:100});results.push({...hit,content:doc.content,offset:doc.offset,totalLines:doc.totalLines});}
  return {query,mode:vector?'BM25 + multilingual CPU embeddings':'BM25',warning:this.embeddingError||null,results};
 }
 async addNote(context,args){return this.queue(async()=>{await this.ready;const text=String(args.text||'').trim();if(text.length>200000)throw Error('笔记超过 20 万字符，请作为文件导入以保留全文');if(!text)throw Error('笔记内容不能为空');return this.upsert('manual:'+randomUUID(),{title:String(args.title||text.split(/\r?\n/).find(line=>line.trim())?.replace(/^#+\s*/, '').slice(0,80)||'课程笔记').slice(0,120),text,context,kind:'note',source:{kind:'note',created:Date.now()},tags:args.tags||[]});});}
 async editNote(context,args){return this.queue(async()=>{await this.ready;const meta=this.registry.documents[args.id];if(!this.allowed(meta,context,args.scope)||meta.kind!=='note'||meta.source?.jobId)throw Error('请在原课堂记录中编辑该笔记；此处只编辑独立知识笔记');const text=String(args.text||'').trim();if(text.length>200000)throw Error('笔记过长，请作为文件导入；旧笔记保持');if(!text)throw Error('笔记不能为空');const result=await this.upsert(meta.key,{title:args.title||meta.title,text,source:meta.source,context:{projectDirectory:meta.projectDirectory},kind:'note'});return {id:result.id,updated:true,warning:this.embeddingError||null};});}
 async setJobDeleted(id,deleted){return this.queue(async()=>{await this.ready;for(const meta of Object.values(this.registry.documents)){if(meta.source?.jobId!==id||!!meta.deleted===deleted)continue;if(!meta.disabled){if(deleted)await this.store.remove(meta.id);else await this.store.restore(meta.id);}meta.deleted=deleted;await this.save();}});}
 async cleanupAssets(args={}){return this.queue(async()=>{await this.ready;const days=Math.max(1,Number(args.days)||30),used=new Set();for(const meta of Object.values(this.registry.documents))for(const asset of [meta.source?.asset,meta.source?.originalAsset].filter(Boolean))used.add(asset);if(this.worker)for(const job of await this.worker.call('list'))for(const source of [job.source,...(job.materials||[]).map(m=>m.path)].filter(Boolean))used.add(basename(source));const candidates=Object.values(this.registry.assets).filter(a=>!used.has(a.name)&&Date.now()-a.savedAt>days*86400000);if(!args.apply)return {days,files:candidates.length,bytes:candidates.reduce((n,a)=>n+a.bytes,0),policy:'Only unreferenced originals older than the selected days; no scheduled automatic deletion.'};if(args.confirm!=='清理未引用资料')throw Error('需要输入“清理未引用资料”确认');const root=await fs.realpath(join(this.root,'assets'));for(const asset of candidates){if(!/^[a-f0-9]{64}(?:\.[a-z0-9.]{1,12})?$/.test(asset.name))throw Error('无效资料编号');const path=await fs.realpath(join(root,asset.name));if(!inside(root,path))throw Error('清理路径越界');await fs.unlink(path);delete this.registry.assets[asset.name];}await this.save();return {removed:candidates.length,days};});}
 async purgeJob(id){return this.queue(async()=>{await this.ready;for(const meta of Object.values(this.registry.documents)){if(meta.source?.jobId!==id)continue;if(!meta.deleted)throw Error('请先将记录移入回收区');await this.store.purge(meta.id);delete this.registry.keys[meta.key];delete this.registry.documents[meta.id];await this.save();}});}
 async syncUnbound(worker,bindings){await this.ready;this.lastUnbound||=new Map();for(const job of await worker.call('list')){if(bindings[job.id]||job.kind==='question')continue;const signature=JSON.stringify([job.updated,job.revision,job.completedChunks,job.state]);if(this.lastUnbound.get(job.id)===signature)continue;try{await this.sync(job);this.lastUnbound.set(job.id,signature);}catch(error){console.error('classroom legacy record indexing:',job.id,error.message);}}}
 async mergeBackup(context,path){return this.queue(async()=>{await this.ready;const actual=await fs.realpath(path),staging=await fs.realpath(join(this.config.dataDirectory,'restore-staging'));if(!inside(staging,actual))throw Error('无效备份暂存目录');const registry=await json(join(actual,'classroom-sources.json'),null);if(!registry?.documents)throw Error('备份缺少知识元数据');const store=new KnowledgeStore(normalizeSettings({rootDir:actual}));await store.init();for(const name of Object.keys(registry.assets||{})){if(!/^[a-f0-9]{64}(?:\.[a-z0-9.]{1,12})?$/.test(name))throw Error('备份原始文件编号无效');await this.preserve(join(actual,'assets',name));this.registry.assets[name]={...registry.assets[name],name};}let imported=0;for(const meta of Object.values(registry.documents)){if(meta.deleted||meta.disabled)continue;const manifest=await store.loadManifest();const doc={content:await store.readDocBody(store.findDoc(manifest,meta.id))};await this.upsert('restored:'+this.collection(context)+':'+meta.id,{title:meta.title,text:doc.content,kind:meta.kind,source:{...meta.source,restored:true},context});imported++;}await this.save();return {imported,merged:true,originalsPreserved:true};});}
 async asset(context,args){await this.ready;const doc=await this.read(context,args),source=doc.source;if(doc.kind==='note'&&!source.jobId){const root=await fs.realpath(join(this.root,'docs')),path=await fs.realpath(this.store.docFile(args.id));if(!inside(root,path))throw Error('笔记文件越界');return {path,name:doc.title.replace(/[<>:"/\\|?*]/g,'_')+'.md'};}const originalAsset=source.originalAsset||source.asset;if(originalAsset){if(!/^[a-f0-9]{64}(?:\.[a-z0-9.]{1,12})?$/.test(originalAsset))throw Error('无效资料编号');const root=await fs.realpath(join(this.root,'assets')),path=await fs.realpath(join(root,originalAsset));if(!inside(root,path))throw Error('资料路径越界');return {path,name:this.registry.assets[originalAsset]?.originalName||originalAsset};}const jobId=source.jobId;if(!jobId)throw Error('此条目没有原始媒体附件');
  const job=await json(join(this.config.dataDirectory,'jobs',jobId,'job.json'),null);if(!job)throw Error('原始记录不在活动区');const path=job.source||job.materials?.[0]?.path;if(!path)throw Error('此条目没有单个原始文件');const root=await fs.realpath(join(this.root,'assets')),real=await fs.realpath(path);if(!inside(root,real))throw Error('资料尚未保存至知识库，请等待入库完成');return {path:real,name:this.registry.assets[basename(real)]?.originalName||basename(real)};
 }
 close(){this.embedder.close();}
}

