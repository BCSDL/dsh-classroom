import fs from 'node:fs/promises';
import {join,relative,isAbsolute,extname,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';

const terminal=new Set(['complete','cancelled','error','paused']);
const inside=(root,path)=>{const part=relative(root,path);return part===''||(!isAbsolute(part)&&part!=='..'&&!part.startsWith('..\\')&&!part.startsWith('../'));};
const slug=value=>String(value||'课堂记录').replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_').replace(/[. ]+$/g,'').slice(0,70)||'课堂记录';
export class ClassroomProjects {
 constructor({worker,dataDirectory,session,notify}){Object.assign(this,{worker,dataDirectory,session,notify});this.path=join(dataDirectory,'project-bindings.json');this.rows={};this.contexts=new Map();this.openRequests=new Map();this.serial=Promise.resolve();this.ready=this.load();}
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
 async allowed(id,context){await this.ready;const binding=this.rows[id];if(!binding||binding.projectDirectory!==context.projectDirectory)throw Error('该记录不属于当前项目；请切换到所属项目对话');return binding;}
 async run(operation,args={},sessionId){
  await this.ready;
  const context=await this.context(sessionId);
  if(operation==='open'){const request={id:randomUUID(),mode:args.mode==='watch'?'watch':'record'};this.openRequests.set(sessionId,request);return {...context,openRequested:request,url:'/classroom?sessionId='+encodeURIComponent(sessionId)};}
  if(operation==='search')return this.search(context,args.query,args.limit);
  if(operation==='list'){const all=await this.worker.call('list');return all.filter(j=>this.rows[j.id]?.projectDirectory===context.projectDirectory).map(j=>({...j,project:this.rows[j.id]}));}
  if(operation==='status')return {...await this.worker.call('status'),...context,outputDirectory:join(context.projectDirectory,'课堂记录')};
  if(args.id)await this.allowed(args.id,context);
  if(operation==='resume'){const binding=this.rows[args.id];binding.notified=false;binding.revision=(binding.revision||0)+1;await this.save();}
  const creates=['start_file','create_live','create_watch','enhance'].includes(operation);
  if(creates){
   const parent=join(context.projectDirectory,'课堂记录');await fs.mkdir(parent,{recursive:true});if(!inside(context.projectDirectory,await fs.realpath(parent)))throw Error('课堂记录目录指向项目外部');
   // Resolve relative source paths against the actual Session cwd, never the server cwd.
   args={...args};if(args.path)args.path=resolve(context.projectDirectory,args.path);if(args.materials)args.materials=args.materials.map(m=>({...m,path:resolve(context.projectDirectory,m.path)}));
   const job=await this.worker.call(operation,args);const binding=await this.bind(job,context);
   try{await this.send(binding,'started',`已开始课堂任务：${job.title}\n\n保存位置：${join(context.projectDirectory,'课堂记录',binding.folder)}\n\n任务编号：${job.id}。完成后纪要、逐字稿、字幕和证据会归档到这里。`);}catch(e){binding.notificationError=e.message;await this.save();}
   return {...job,project:binding,outputDirectory:join(context.projectDirectory,'课堂记录',binding.folder)};
  }
  const result=await this.worker.call(operation,args);
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
  for(const name of ['materials.jsonl'])try{await this.copy(join(source,name),target,name);}catch(e){if(e.code!=='ENOENT')throw e;}
  if(['live','watch'].includes(job.kind)&&Object.keys(job.chunks||{}).length){const audio=await this.worker.call('audio',{id:job.id});await this.copy(audio.path,target,'录音'+extname(audio.path));}
  await this.write(target,'记录信息.json',JSON.stringify({id:job.id,title:job.title,kind:job.kind,state:job.state,sessionId:binding.sessionId,projectDirectory:binding.projectDirectory,source:job.source,parentId:job.parentId,materials:job.materials,visualCoverage:job.visualCoverage,error:job.error,archivedAt:new Date().toISOString()},null,2));
  return target;
 }
 async tick(){
  if(this.busy)return;this.busy=true;
  try{await this.ready;for(const binding of Object.values(this.rows)){
   if(binding.notified)continue;
   try{
    const job=await this.worker.call('get',{id:binding.id,limit:1});binding.state=job.state;binding.phase=job.phase;if(!terminal.has(job.state))continue;
    const target=await this.archive(job,binding);
    const links=['纪要.md','逐字稿.md','字幕.srt'].map(name=>`[${name}](<${join(target,name).replaceAll('\\','/')}>)`).join(' · ');
    await this.send(binding,'finished',`课堂任务${job.state==='complete'?'已完成':'已停止（'+job.state+'）'}：${job.title}\n\n${job.deepSummary||job.summary||job.error||'已保存现有结果。'}\n\n${links}\n\n保存位置：${target}\n\n任务编号：${job.id}。可继续查询该记录，或加入课件生成增强版。`);
    binding.notified=true;binding.archivedAt=Date.now();binding.archiveDirectory=target;binding.summary=(job.deepSummary||job.summary||job.error||'').slice(0,4000);delete binding.archiveError;delete binding.notificationError;await this.save();
   }catch(e){binding.archiveError=e.message;}
  }}finally{this.busy=false;}
 }
 async search(context,query,limit=15){
  if(typeof query!=='string'||!query.trim())throw Error('请输入要查找的课程内容');query=query.trim().toLowerCase();const results=[];
  for(const binding of Object.values(this.rows).filter(x=>x.projectDirectory===context.projectDirectory).reverse()){
   let text='';try{const target=await this.checkedDirectory(binding);text=(await fs.readFile(join(target,'纪要.md'),'utf8')).slice(0,2_000_000);}catch{}
   const index=text.toLowerCase().indexOf(query);if(index<0&&!binding.title.toLowerCase().includes(query))continue;
   results.push({id:binding.id,title:binding.title,directory:join(context.projectDirectory,'课堂记录',binding.folder),excerpt:text.slice(Math.max(0,index-180),Math.max(0,index)+700)});
   if(results.length>=Math.min(30,Math.max(1,Number(limit)||15)))break;
  }
  return {query,projectDirectory:context.projectDirectory,results};
 }
 async info(sessionId){await this.ready;const context=await this.context(sessionId);return {...context,outputDirectory:join(context.projectDirectory,'课堂记录'),openRequested:this.openRequests.get(sessionId),jobs:Object.values(this.rows).filter(x=>x.projectDirectory===context.projectDirectory)};}
 async artifact(id,sessionId,name){const context=await this.context(sessionId),binding=await this.allowed(id,context);if(!['纪要.md','逐字稿.md','字幕.srt','记录信息.json'].includes(name))throw Error('无效的结果文件');const target=await this.checkedDirectory(binding);const file=await fs.realpath(join(target,name));if(!inside(target,file))throw Error('文件指向归档目录外部');return fs.readFile(file);}
}
