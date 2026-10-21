import fs from 'node:fs/promises';
import {join,relative,isAbsolute,extname,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';

const terminal=new Set(['complete','cancelled','error','paused']);
const inside=(root,path)=>{const part=relative(root,path);return part===''||(!isAbsolute(part)&&part!=='..'&&!part.startsWith('..\\')&&!part.startsWith('../'));};
const slug=value=>String(value||'课堂记录').replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_').replace(/[. ]+$/g,'').slice(0,70)||'课堂记录';
export async function moveDirectory(source,destination){for(let attempt=0;;attempt++){try{return await fs.rename(source,destination);}catch(e){if(e.code==='EXDEV')return copyAcrossVolumes(source,destination);if(attempt>=6||!['EPERM','EACCES','EBUSY'].includes(e.code))throw e;await new Promise(resolve=>setTimeout(resolve,Math.min(30*2**attempt,500)));}}}
async function digest(path){const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);return hash.digest('hex');}
async function copyAcrossVolumes(source,destination){
 source=await fs.realpath(source);destination=resolve(destination);if(inside(source,destination))throw Error('移动目标不能位于源目录内');
 await fs.mkdir(destination);const actual=await fs.realpath(destination);if(actual!==destination)throw Error('移动目标出现链接');
 const copy=async(from,to)=>{for(const entry of await fs.readdir(from,{withFileTypes:true})){if(entry.isSymbolicLink())throw Error('跨卷移动拒绝符号链接');const a=join(from,entry.name),b=join(to,entry.name);if(entry.isDirectory()){await fs.mkdir(b);await copy(a,b);}else if(entry.isFile()){await fs.copyFile(a,b,1);if(await digest(a)!==await digest(b))throw Error('跨卷复制校验失败，源文件保留');}else throw Error('不支持的目录条目');}};
 try{await copy(source,destination);}catch(e){if(await fs.realpath(destination)===actual)await fs.rm(destination,{recursive:true,force:true});throw e;}
 if(await fs.realpath(source)!==source)throw Error('源目录位置发生变化，未删除源目录');
 const tomb=source+'.moved-'+randomUUID();
 try{await fs.rename(source,tomb);}catch(error){await fs.rm(destination,{recursive:true,force:true});throw error;}
 // Both the verified destination and any undeletable tomb remain complete.
 // Never report a failed partial source deletion as a failed move to callers.
 await fs.rm(tomb,{recursive:true}).catch(error=>console.error('classroom cross-volume cleanup pending:',tomb,error.message));
}
export class ClassroomProjects {
 constructor({worker,dataDirectory,session,notify,knowledge}){Object.assign(this,{worker,dataDirectory,session,notify,knowledge});this.path=join(dataDirectory,'project-bindings.json');this.rows={};this.contexts=new Map();this.openRequests=new Map();this.serial=Promise.resolve();this.ready=this.load();}
 async load(){try{this.rows=JSON.parse(await fs.readFile(this.path,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}}
 async save(){const content=JSON.stringify(this.rows,null,2);this.serial=this.serial.catch(()=>{}).then(async()=>{await fs.mkdir(this.dataDirectory,{recursive:true});const tmp=this.path+'.'+randomUUID()+'.tmp';await fs.writeFile(tmp,content);await fs.rename(tmp,this.path);});return this.serial;}
 async context(sessionId){
  if(typeof sessionId!=='string'||!sessionId||sessionId.length>200)throw Error('请先选择一个真实对话');
  if(!this.contexts.has(sessionId)){
   const promise=(async()=>{const header=await this.session(sessionId);if(!header?.cwd)throw Error('当前对话没有实际项目目录，请先在 DSH 中选择工作目录');const root=await fs.realpath(header.cwd);if(!(await fs.stat(root)).isDirectory())throw Error('项目目录不可用');return {sessionId,projectDirectory:root};})();
   this.contexts.set(sessionId,promise);promise.catch(()=>this.contexts.delete(sessionId));
  }
  return this.contexts.get(sessionId);
 }
 async checkRoot(binding){const actual=await fs.realpath(binding.projectDirectory);if(actual!==binding.projectDirectory)throw Error('项目目录位置已改变，请重新绑定');return actual;}
 async checkedDirectory(binding,create=false){
  const root=await this.checkRoot(binding),parent=join(root,'课堂记录');
  if(create)await fs.mkdir(parent,{recursive:true});
  if(!inside(root,await fs.realpath(parent)))throw Error('课堂记录目录指向项目外部，已停止归档');
  const target=join(parent,binding.folder);
  if(create)await fs.mkdir(target,{recursive:true});
  if(!inside(parent,await fs.realpath(target)))throw Error('任务目录指向项目外部，已停止归档');
  return target;
 }
 async bind(job,context){
  await this.ready;
  const binding={...context,id:job.id,title:job.title,folder:new Date(job.created*1000).toISOString().slice(0,10)+'-'+slug(job.title)+'-'+job.id,created:Date.now(),notified:false};
  await this.checkedDirectory(binding,true);this.rows[job.id]=binding;await this.save();return binding;
 }
 async allowed(id,context){await this.ready;const binding=this.rows[id];if(!binding||binding.deleted||binding.projectDirectory!==context.projectDirectory)throw Error('该记录不属于当前项目或已经删除；请切换项目或先恢复');return binding;}
 async run(operation,args={},sessionId){
  await this.ready;
  const context=await this.context(sessionId);
  if(operation==='trash_list')return Object.values(this.rows).filter(b=>b.deleted&&b.projectDirectory===context.projectDirectory);
  if(operation==='delete')return this.recycle(args.id,context);
  if(operation==='restore')return this.restore(args.id,context);
  if(operation==='purge')return this.purge(args.id,args.confirm,context);
  if(operation==='open'){const request={id:randomUUID(),mode:['watch','library'].includes(args.mode)?args.mode:'record'};this.openRequests.set(sessionId,request);return {...context,openRequested:request,url:'/classroom?sessionId='+encodeURIComponent(sessionId)};}
  if(operation==='search')return this.search(context,args.query,args.limit);
  if(operation==='list'){const all=await this.worker.call('list');return all.filter(j=>!this.rows[j.id]?.deleted&&this.rows[j.id]?.projectDirectory===context.projectDirectory).map(j=>({...j,project:this.rows[j.id]}));}
  if(operation==='status')return {...await this.worker.call('status'),...context,outputDirectory:join(context.projectDirectory,'课堂记录')};
  if(operation==='batch_records'){
   const ids=[...new Set(args.ids||[])];if(!ids.length||ids.length>200)throw Error('请选择 1–200 条记录');
   if(!['delete','restore'].includes(args.action)||args.confirm!==(args.action==='delete'?'移入记录回收区':'恢复课堂记录'))throw Error('需要确认批量操作');
   for(const id of ids){const b=this.rows[id];if(!b||b.projectDirectory!==context.projectDirectory)throw Error('记录不属于当前项目');}
   const results=[];for(const id of ids)try{results.push(await (args.action==='delete'?this.recycle(id,context):this.restore(id,context)));}catch(e){results.push({id,error:e.message});}return {results};
  }
  if(operation==='selected_export'){for(const id of args.ids||[])await this.allowed(id,context);return this.worker.call(operation,args);}
  if(args.id)await this.allowed(args.id,context);
  if(operation==='resume'){const binding=this.rows[args.id];binding.notified=false;binding.revision=(binding.revision||0)+1;await this.save();}
  const creates=['start_file','create_live','create_watch','enhance','create_material','native_start'].includes(operation);
  if(creates){
   const parent=join(context.projectDirectory,'课堂记录');await fs.mkdir(parent,{recursive:true});if(!inside(context.projectDirectory,await fs.realpath(parent)))throw Error('课堂记录目录指向项目外部');
   // Resolve relative source paths against the actual Session cwd, never the server cwd.
   args={...args};if(args.path)args.path=resolve(context.projectDirectory,args.path);if(args.materials)args.materials=args.materials.map(m=>({...m,path:resolve(context.projectDirectory,m.path)}));
   if(this.knowledge){if(args.path){const kept=await this.knowledge.preserve(args.path);args.path=kept.path;args.originalName=kept.originalName;}if(args.materials){const kept=[];for(const m of args.materials){const asset=await this.knowledge.preserve(m.path);kept.push({...m,path:asset.path,name:m.name||asset.originalName});}args.materials=kept;}}
   const job=await this.worker.call(operation,args);let binding;
   try{binding=await this.bind(job,context);}catch(error){if(operation==='native_start')await this.worker.call('native_stop',{id:job.id}).catch(stopError=>console.error('classroom recording rollback:',stopError.message));throw error;}
   try{await this.send(binding,'started',`已开始课堂任务：${job.title}\n\n保存位置：${join(context.projectDirectory,'课堂记录',binding.folder)}\n\n任务编号：${job.id}。完成后纪要、逐字稿、字幕和证据会归档到这里。`);}catch(e){binding.notificationError=e.message;await this.save();}
   return {...job,project:binding,outputDirectory:join(context.projectDirectory,'课堂记录',binding.folder)};
  }
  const result=await this.worker.call(operation,args);
  if(['rename','auto_title','review_edit','speaker_name','speaker_merge','speaker_assign','note_save','note_delete','resummarize','review_restore','annotation_save','alignment_confirm','course_options'].includes(operation)){const binding=this.rows[args.id];binding.title=result.title;binding.notified=false;binding.revision=(binding.revision||0)+1;await this.save();}
  return args.id?{...result,project:this.rows[args.id]}:result;
 }
 async send(binding,phase,text){
  if(!this.notify)return;
  await this.notify(binding.sessionId,`classroom:${binding.id}:${phase}:${binding.revision||0}`,text);
 }
 async write(target,name,content){
  const path=join(target,name);
  try{if((await fs.lstat(path)).isSymbolicLink())throw Error('输出文件是链接，已停止写入');}catch(e){if(e.code!=='ENOENT')throw e;}
  const tmp=path+'.'+randomUUID()+'.tmp';await fs.writeFile(tmp,content);await fs.rename(tmp,path);
 }
 async copy(source,target,name){
  const path=join(target,name);try{if((await fs.lstat(path)).isSymbolicLink())throw Error('输出文件是链接，已停止写入');}catch(e){if(e.code!=='ENOENT')throw e;}
  const tmp=path+'.'+randomUUID()+'.tmp';await fs.copyFile(source,tmp,1);await fs.rename(tmp,path);
 }
 async archive(job,binding){
  const folder=new Date(job.created*1000).toISOString().slice(0,10)+'-'+slug(job.title)+'-'+job.id;
  if(folder!==binding.folder){const old=await this.checkedDirectory(binding,true),parent=join(binding.projectDirectory,'课堂记录'),next=resolve(parent,folder);if(!inside(parent,next))throw Error('标题目录越界');try{await fs.lstat(next);throw Error('新的归档目录已经存在');}catch(e){if(e.code!=='ENOENT')throw e;}await moveDirectory(old,next);binding.folder=folder;binding.title=job.title;await this.save();}
  const target=await this.checkedDirectory(binding,true),source=join(this.dataDirectory,'jobs',job.id);
  for(const [from,to]of [['report.md','纪要.md'],['transcript.srt','字幕.srt']]){
   try{await this.copy(join(source,from),target,to);}catch(e){if(e.code!=='ENOENT')throw e;}
  }
  const transcript=[];let offset=0;
  do{const page=await this.worker.call('get',{id:job.id,offset,limit:100});for(const item of page.results||[])for(const segment of item.segments||[])transcript.push(`[${segment.start.toFixed(1)}–${segment.end.toFixed(1)}] ${segment.speaker}: ${segment.text}`);offset=page.hasMore?page.nextOffset:0;}while(offset);
  await this.write(target,'逐字稿.md',`# ${job.title}\n\n`+transcript.join('\n\n'));
  try{
   const frames=await fs.readdir(join(source,'frames'));const frameTarget=join(target,'画面证据');await fs.mkdir(frameTarget,{recursive:true});if(!inside(target,await fs.realpath(frameTarget)))throw Error('画面目录指向项目外部');
   for(const name of frames)if(/^[\w.-]+\.(jpg|jpeg|png|json)$/i.test(name))await this.copy(join(source,'frames',name),frameTarget,name);
  }catch(e){if(e.code!=='ENOENT')throw e;}
  const copyEvidence=async(from,to,depth=0)=>{
   if(depth>8)throw Error('证据目录层级异常');await fs.mkdir(to,{recursive:true});if(!inside(target,await fs.realpath(to)))throw Error('证据目录指向项目外部');
   for(const entry of await fs.readdir(from,{withFileTypes:true})){
    if(entry.isSymbolicLink())throw Error('证据中出现链接，已停止复制');
    if(entry.isDirectory())await copyEvidence(join(from,entry.name),join(to,entry.name),depth+1);
    else if(entry.isFile()&&/\.(jpg|jpeg|png|json|jsonl|md)$/i.test(entry.name))await this.copy(join(from,entry.name),to,entry.name);
   }
  };
  try{await copyEvidence(join(source,'evidence'),join(target,'课件证据'));}catch(e){if(e.code!=='ENOENT')throw e;}
  try{await copyEvidence(join(source,'annotations'),join(target,'手写与截图批注'));}catch(e){if(e.code!=='ENOENT')throw e;}
  for(const name of ['materials.jsonl'])try{await this.copy(join(source,name),target,name);}catch(e){if(e.code!=='ENOENT')throw e;}
  if(['live','watch'].includes(job.kind)&&Object.keys(job.chunks||{}).length){const audio=await this.worker.call('audio',{id:job.id});await this.copy(audio.path,target,'录音'+extname(audio.path));}
  await this.write(target,'记录信息.json',JSON.stringify({id:job.id,title:job.title,kind:job.kind,state:job.state,sessionId:binding.sessionId,projectDirectory:binding.projectDirectory,source:job.source,parentId:job.parentId,materials:job.materials,visualCoverage:job.visualCoverage,error:job.error,archivedAt:new Date().toISOString()},null,2));
  return target;
 }
 async tick(){
  if(this.busy||this.restoring)return;this.busy=true;
  try{await this.ready;for(const binding of Object.values(this.rows)){
   if(binding.deleted||binding.deleting)continue;
   try{
    const job=await this.worker.call('get',{id:binding.id,limit:1});binding.state=job.state;binding.phase=job.phase;binding.titleError=job.titleError;
    if(this.knowledge){const signature=JSON.stringify([job.updated,job.revision,job.completedChunks,job.state,job.title]);if(signature!==binding.knowledgeRevision){try{binding.knowledge=await this.knowledge.sync(job,binding);binding.knowledgeRevision=signature;delete binding.knowledgeError;}catch(e){binding.knowledgeError=e.message;}await this.save();}}
    if(binding.notified)continue;
    if(job.deferredImport)continue;
    if(!terminal.has(job.state)||job.titlePending||job.titleMode==='auto'&&!job.titleAttempted&&!job.titleError&&job.state==='complete')continue;
    const target=await this.archive(job,binding);
    const links=['纪要.md','逐字稿.md','字幕.srt'].map(name=>`[${name}](<${join(target,name).replaceAll('\\','/')}>)`).join(' · ');
    await this.send(binding,'finished',`课堂任务${job.state==='complete'?'已完成':'已停止（'+job.state+'）'}：${job.title}\n\n${job.deepSummary||job.summary||job.error||'已保存现有结果。'}\n\n${links}\n\n保存位置：${target}\n\n任务编号：${job.id}。可继续查询该记录，或加入课件生成增强版。`);
    binding.notified=true;binding.archivedAt=Date.now();binding.archiveDirectory=target;binding.summary=(job.deepSummary||job.summary||job.error||'').slice(0,4000);delete binding.archiveError;delete binding.notificationError;await this.save();
   }catch(e){binding.archiveError=e.message;}
  }if(this.knowledge)await this.knowledge.syncUnbound(this.worker,this.rows);}finally{this.busy=false;}
 }
 async search(context,query,limit=15){
  if(typeof query!=='string'||!query.trim())throw Error('请输入要查找的课程内容');query=query.trim().toLowerCase();const results=[];
  for(const binding of Object.values(this.rows).filter(x=>!x.deleted&&x.projectDirectory===context.projectDirectory).reverse()){
   let text='';try{const target=await this.checkedDirectory(binding);text=(await fs.readFile(join(target,'纪要.md'),'utf8')).slice(0,2_000_000);}catch{}
   const index=text.toLowerCase().indexOf(query);if(index<0&&!binding.title.toLowerCase().includes(query))continue;
   results.push({id:binding.id,title:binding.title,directory:join(context.projectDirectory,'课堂记录',binding.folder),excerpt:text.slice(Math.max(0,index-180),Math.max(0,index)+700)});
   if(results.length>=Math.min(30,Math.max(1,Number(limit)||15)))break;
  }
  return {query,projectDirectory:context.projectDirectory,results};
 }
 async info(sessionId){await this.ready;const context=await this.context(sessionId);return {...context,outputDirectory:join(context.projectDirectory,'课堂记录'),openRequested:this.openRequests.get(sessionId),jobs:Object.values(this.rows).filter(x=>!x.deleted&&x.projectDirectory===context.projectDirectory),trash:Object.values(this.rows).filter(x=>x.deleted&&x.projectDirectory===context.projectDirectory)};}
 async recycle(id,context){
  await this.ready;if(!/^[a-f0-9]{32}$/.test(id||''))throw Error('无效记录编号');
  let binding=context?await this.allowed(id,context):this.rows[id];if(binding?.deleted)throw Error('记录已经在回收区');
  if(this.busy)throw Error('正在保存记录，请稍后重试删除');
  const job=await this.worker.call('get',{id,limit:1});
  const root=await fs.realpath(this.dataDirectory),jobs=await fs.realpath(join(root,'jobs')),source=await fs.realpath(join(jobs,id));
  if(!inside(root,jobs)||!inside(jobs,source))throw Error('缓存目录越界');
  let archive;if(binding?.projectDirectory)try{archive=await this.checkedDirectory(binding);}catch(e){if(e.code!=='ENOENT')throw e;}
  const bin=join(root,'recycle-bin');await fs.mkdir(bin,{recursive:true});if(!inside(root,await fs.realpath(bin)))throw Error('回收区目录越界');
  const destination=resolve(bin,id+'-'+randomUUID());if(!inside(bin,destination))throw Error('回收目标越界');await fs.mkdir(destination);
  binding||={id,title:job.title,sessionId:null,projectDirectory:null};binding.deleting=true;
  let movedCache=false,movedArchive=false;
  try{await this.worker.call('prepare_delete',{id});await moveDirectory(source,join(destination,'cache'));movedCache=true;if(archive){await moveDirectory(archive,join(destination,'outputs'));movedArchive=true;}
   await this.knowledge?.setJobDeleted(id,true);Object.assign(binding,{deleted:true,deleting:false,trashDirectory:destination,archiveDirectory:archive||binding.archiveDirectory,deletedAt:Date.now()});this.rows[id]=binding;await this.save();return {id,deleted:true,recoverable:true,originalInputsPreserved:true};
  }catch(e){if(movedArchive)await moveDirectory(join(destination,'outputs'),archive).catch(()=>{});if(movedCache)await moveDirectory(join(destination,'cache'),source).catch(()=>{});await this.worker.call('restore_delete',{id}).catch(()=>{});binding.deleting=false;binding.deleted=false;throw e;}
 }
 async restore(id,context){
  await this.ready;const binding=this.rows[id];if(!binding?.deleted||context&&binding.projectDirectory!==context.projectDirectory)throw Error('当前项目的回收区中没有这条记录');
  const root=await fs.realpath(this.dataDirectory),bin=await fs.realpath(binding.trashDirectory);if(!inside(root,bin))throw Error('回收区目录越界');
  const jobs=await fs.realpath(join(root,'jobs')),target=resolve(jobs,id);if(!inside(root,jobs)||!inside(jobs,target))throw Error('恢复目标越界');
  const fromCache=await fs.realpath(join(bin,'cache'));if(!inside(bin,fromCache))throw Error('回收缓存越界');
  let archiveTarget;if(binding.projectDirectory){const parent=join(await this.checkRoot(binding),'课堂记录');await fs.mkdir(parent,{recursive:true});if(!inside(binding.projectDirectory,await fs.realpath(parent)))throw Error('归档目录越界');archiveTarget=resolve(parent,binding.folder);if(!inside(parent,archiveTarget))throw Error('归档恢复越界');}
  for(const path of [target,archiveTarget].filter(Boolean)){try{await fs.lstat(path);throw Error('恢复位置已经存在文件，请先处理冲突');}catch(e){if(e.code!=='ENOENT')throw e;}}
  await moveDirectory(fromCache,target);
  try{await this.worker.call('restore_delete',{id});if(archiveTarget){try{const archived=await fs.realpath(join(bin,'outputs'));if(!inside(bin,archived))throw Error('回收文件越界');await moveDirectory(archived,archiveTarget);}catch(e){if(e.code!=='ENOENT')throw e;}}
   await this.knowledge?.setJobDeleted(id,false);binding.deleted=false;delete binding.deleting;delete binding.knowledgeRevision;await this.save();return {id,restored:true};
  }catch(e){await this.worker.call('prepare_delete',{id}).catch(()=>{});await moveDirectory(target,join(bin,'cache')).catch(()=>{});binding.deleted=true;throw e;}
 }
 async purge(id,confirm,context){await this.ready;const binding=this.rows[id];if(!binding?.deleted||context&&binding.projectDirectory!==context.projectDirectory)throw Error('只能永久删除当前范围回收区内的记录');if(confirm!==binding.title)throw Error('需要输入该记录的完整标题确认永久删除');const root=await fs.realpath(join(this.dataDirectory,'recycle-bin')),target=await fs.realpath(binding.trashDirectory);if(!inside(root,target)||root===target)throw Error('回收区路径越界');await this.knowledge?.purgeJob(id);await fs.rm(target,{recursive:true});delete this.rows[id];await this.save();return {id,purged:true,originalKnowledgeAssetsPreserved:true};}
 async artifact(id,sessionId,name){const context=await this.context(sessionId),binding=await this.allowed(id,context);if(!['纪要.md','逐字稿.md','字幕.srt','记录信息.json'].includes(name))throw Error('无效的结果文件');const target=await this.checkedDirectory(binding);const file=await fs.realpath(join(target,name));if(!inside(target,file))throw Error('文件指向归档目录外部');return fs.readFile(file);}
}
