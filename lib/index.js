import z from '@deepseek-ai/schemastery';
import {defineTool} from '@deepseek-ai/dsh-tools';
import fs from 'node:fs/promises';
import {createWriteStream,createReadStream,readFileSync} from 'node:fs';
import {Readable, Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {homedir} from 'node:os';
import {join, basename,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {WorkerClient} from './worker-client.js';
import {registerDocumentTools,applyToolDiscipline,currentFiles} from './tool-discipline.js';
import {registerPhotoTools} from './photo-tools.js';
import {registerWatchRoutes} from './watch-routes.js';
import {ClassroomProjects} from './projects.js';
import {createUserMessage} from '@deepseek-ai/dsh-llm';
import {classroomNotifier} from './notifications.js';
import {ClassroomKnowledge} from './knowledge.js';
import {installChatCoordination} from './chat-gpu.js';

export const name='classroom';
export const inject=['tools'];
export const Config=z.object({
  pythonExecutable:z.string().default(''),
  modelsDirectory:z.string().default(''),
  dataDirectory:z.string().default(''),
  ffmpegExecutable:z.string().default(''),
  ollamaURL:z.string().default('http://127.0.0.1:11434'),
  model:z.string().default('gemma4:12b-it-qat'),
  maxUploadGiB:z.number().min(1).max(128).default(32),
  toolDiscipline:z.boolean().default(true),
  coordinateChatGPU:z.boolean().default(true),
  adaptiveRequestContext:z.boolean().default(true),
  maxRequestContext:z.number().min(8192).max(262144).default(262144),
  minLLMFreeMiB:z.number().min(1024).max(32768).default(10240),
  maxEvidenceRetries:z.number().min(0).max(3).default(2)
});
const operations=new Set(['status','list','get','start_file','create_live','append','finish','enhance','cancel','resume','document','audio','create_watch','watch_event','watch_frame','watch_status','watch_primary','delete','restore','trash_list','purge','rename','auto_title','create_material','review_edit','speaker_name','speaker_merge','speaker_assign','note_save','note_delete','course_options','resummarize','history','review_restore','doctor','native_devices','native_start','native_stop','annotation_save','annotation_path','alignment_confirm','selected_export','batch_records']);
const knowledgeOperations=new Set(['knowledge_list','knowledge_search','knowledge_read','knowledge_note','knowledge_edit','knowledge_ask','knowledge_answer','knowledge_import','knowledge_restore','knowledge_cleanup','knowledge_versions','knowledge_manage','knowledge_align']);

export function apply(ctx, config) {
  const runtime=join(homedir(),'.local-ai-tools','classroom');
  const resolved={...config,
    pythonExecutable:config.pythonExecutable||join(runtime,process.platform==='win32'?'Scripts/python.exe':'bin/python'),
    modelsDirectory:config.modelsDirectory||join(runtime,'models'),
    dataDirectory:config.dataDirectory||join(process.env.DSH_HOME||join(homedir(),'.dsh'),'classroom')};
  const worker=new WorkerClient(resolved,fileURLToPath(new URL('../backend/worker.py',import.meta.url)));
  const knowledge=new ClassroomKnowledge(resolved);knowledge.worker=worker;
  const chatGPU=installChatCoordination(ctx,worker,config.coordinateChatGPU!==false);let ticking=false;
  let projects;
  ctx.inject(['sessionController'],scope=>{
    projects=new ClassroomProjects({worker,knowledge,dataDirectory:resolved.dataDirectory,
      session:async id=>(await scope.sessionController.inspect(id)).meta,
      notify:classroomNotifier(scope.sessionController,createUserMessage)});
    const timer=setInterval(async()=>{if(ticking)return;ticking=true;try{if(!chatGPU.busy&&Date.now()-chatGPU.lastActivity>3000)for(const job of await worker.call('list'))if(job.deferredImport&&job.state==='paused')await worker.call('resume',{id:job.id});await projects?.tick();}catch(error){console.error('classroom archive:',error.message);}finally{ticking=false;}},3000);
    scope.on('dispose',()=>{clearInterval(timer);projects=undefined;});
  });
  const scopedCall=async(operation,args={},sessionId)=>{
    if(knowledgeOperations.has(operation)){
      if(sessionId&&!projects)throw Error('会话服务尚未就绪');
      const context=sessionId?await projects.context(sessionId):undefined;
      if(operation==='knowledge_restore'){
        if(args.confirm!=='合并知识备份')throw Error('请输入“合并知识备份”确认导入');
        if(projects?.restoring)throw Error('已有备份合并正在进行，请等待完成');
        if(projects)projects.restoring=true;
        try{
          const start=Date.now();while(projects?.busy){if(Date.now()-start>90000)throw Error('课堂正在归档，请稍后重试恢复');await new Promise(resolve=>setTimeout(resolve,250));}
          const staging=await worker.call('knowledge_restore',{path:args.path}),result=await knowledge.mergeBackup(context,staging.path);
          if(sessionId){
            const jobs=new Map();for(const record of result.records)if(!projects.rows[record.id]){const job=await worker.call('get',{id:record.id,limit:1});jobs.set(record.id,job);await projects.bind(job,context);}
            const depth=id=>{let n=0,seen=new Set();while(jobs.get(id)?.parentId){if(seen.has(id))throw Error('备份记录依赖出现循环');seen.add(id);id=jobs.get(id).parentId;n++;}return n;};
            for(const record of result.records.filter(r=>r.deleted&&!projects.rows[r.id].deleted).sort((a,b)=>depth(b.id)-depth(a.id)))await projects.recycle(record.id,context);
          }
          return {...result,integrityVerified:staging.verifiedFiles,warning:staging.warning};
        }finally{if(projects)projects.restoring=false;}
      }
      if(operation==='knowledge_import'){
        const kept=await knowledge.preserve(resolve(context?.projectDirectory||process.cwd(),args.path));await knowledge.ready;
        knowledge.registry.ingests||={};const key=knowledge.collection(context)+':'+kept.asset;
        if(knowledge.registry.ingests[key]){try{return {...await worker.call('get',{id:knowledge.registry.ingests[key],limit:1}),deduplicated:true};}catch{delete knowledge.registry.ingests[key];}}
        const media=await worker.call('probe_media',{path:kept.path}),audio=media.audio||media.video;
        const command=audio?'start_file':'create_material',options={language:'en',quality:'large-v3',translate:true,summarize:true};
        const input={path:kept.path,title:args.title||kept.originalName||'知识资料',autoTitle:true,defer:!!args.defer,options,materials:media.video?[{kind:'video',path:kept.path,name:args.title||kept.originalName}]:[]};
        const job=sessionId?await projects.run(command,input,sessionId):await worker.call(command,input);
        knowledge.registry.ingests[key]=job.id;await knowledge.save();return job;
      }
      if(operation==='knowledge_cleanup')return knowledge.cleanupAssets(args);
      if(operation==='knowledge_align'){if(sessionId)await projects.allowed(args.id,context);return knowledge.align(await worker.call('get',{id:args.id,limit:1}),context);}
      if(operation==='knowledge_list')return knowledge.list(context,args);
      if(operation==='knowledge_search')return knowledge.search(context,args);
      if(operation==='knowledge_read')return knowledge.read(context,args);
      if(operation==='knowledge_note')return knowledge.addNote(context,args);
      if(operation==='knowledge_edit')return knowledge.editNote(context,args);
      if(operation==='knowledge_versions')return knowledge.noteVersion(context,args);
      if(operation==='knowledge_manage')return knowledge.manage(context,args);
      if(operation==='knowledge_answer')return sessionId?projects.run('get',{id:args.id},sessionId):worker.call('get',{id:args.id});
      const evidence=await knowledge.search(context,{...args,query:args.question,limit:8});
      if(!evidence.results.length)return {state:'complete',answer:'没有检索到足够的保存资料，请先导入课程内容。No saved supporting evidence was found.',citations:[]};
      const job=await worker.call('ask_evidence',{question:args.question,evidence:evidence.results.map(({id,title,source,content})=>({id,title,source,content:content.slice(0,2400)}))});
      if(sessionId)await projects.bind(job,context);return job;
    }
    if(sessionId){if(!projects)throw Error('会话服务尚未就绪，请稍后重试');return projects.run(operation,args,sessionId);}
    if(['delete','restore','trash_list','purge'].includes(operation)){if(!projects)throw Error('会话服务尚未就绪');await projects.ready;if(operation==='delete')return projects.recycle(args.id);if(operation==='restore')return projects.restore(args.id);if(operation==='purge')return projects.purge(args.id,args.confirm);return Object.values(projects.rows).filter(b=>b.deleted);}
    if(['rename','auto_title'].includes(operation)&&projects?.rows[args.id]?.sessionId)return projects.run(operation,args,projects.rows[args.id].sessionId);
    return worker.call(operation,args);
  };
  ctx.on('dispose',()=>{worker.close();knowledge.close();});
  ctx.effect(()=>ctx.tools.register(defineTool({name:'classroom_knowledge',description:'Persistent classroom knowledge with original sources. operation search/read/list/note/import/ask/answer. import args:{attachment:"exact uploaded filename"} or {path,title}; saves an original copy and queues extraction, not immediate completion. search args:{query,scope:"project"|"all",limit:8}; read:{id,offset:1,limit:100}; note:{title,text,tags:[]}; ask:{question,scope}; answer:{id:returnedQuestionJobId} polls an asynchronous grounded answer. Default project scope; use all only when the human asks across courses/projects. Read source evidence before asserting facts; missing results are not proof. args is a JSON object string.',parameters:{operation:{type:'string',required:true},args:{type:'string'}},output:{schema:{type:'string'},render:(_a,value)=>[{type:'text',text:value}]},async execute(args,exec){const operation='knowledge_'+args.operation;if(!knowledgeOperations.has(operation)||['knowledge_manage','knowledge_restore','knowledge_cleanup'].includes(operation))throw Error('请在知识库界面执行管理操作');const input=JSON.parse(args.args||'{}');if(operation==='knowledge_import'&&input.attachment){const matches=currentFiles(exec.agent).filter(f=>f.name===input.attachment);if(matches.length!==1)throw Error('需要当前消息中的确切附件名称');const attachment=ctx.get('attachments');input.path=attachment?.fileHostPath(matches[0]);input.title=input.attachment;if(!input.path)throw Error('附件暂时没有可读本地路径');}return JSON.stringify(await scopedCall(operation,input,exec?.agent?.session?.header?.id));}})),'classroom knowledge');
  registerDocumentTools(ctx,worker);
  registerPhotoTools(ctx,worker);
  ctx.effect(()=>ctx.tools.register(defineTool({name:'watch_playback',description:'Read actual saved Chrome playback analysis, captions and frame evidence. The human first selects a Chrome tab at /classroom/watch. This tool does not open hidden media URLs or grant screen sharing. Supply the actual watch job id; offset/limit paginate saved frames. Player timestamps may be unknown; capture timestamps are separate.',parameters:{id:{type:'string',required:true},offset:{type:'integer'},limit:{type:'integer'}},output:{schema:{type:'string'},render:(_a,value)=>[{type:'text',text:value}]},async execute(args){const job=await worker.call('get',{id:args.id,limit:10});const watch=await worker.call('watch_status',{id:args.id,offset:args.offset||0,limit:args.limit||10});return JSON.stringify({job,...watch});}})),'saved playback analysis');
  if(config.toolDiscipline)ctx.inject(['systemPrompt','attachments'],scope=>applyToolDiscipline(scope,config));
  ctx.inject(['skills'],skillContext=>{
   for(const skillName of ['classroom','local-tools','review-agent']){
    const path=fileURLToPath(new URL(`../skills/${skillName}/SKILL.md`,import.meta.url));
    const content=readFileSync(path,'utf8').replace(/^---[\s\S]*?---\s*/, '');
    skillContext.effect(()=>skillContext.skills.register({name:skillName,
      description:skillName==='classroom'?'Analyze local classroom recordings with bilingual notes, speaker labels, slides and video evidence.':skillName==='review-agent'?'Review code changes for actionable bugs with source lines.':'Use local code, web, document and plugin tools; keep DSH and CLI homes separate.',
      source:'bundled',path,content,resourceBase:{kind:'directory',path:fileURLToPath(new URL(`../skills/${skillName}/`,import.meta.url))}}),skillName+' skill');
   }
  });
  ctx.effect(()=>ctx.tools.register(defineTool({
    name:'classroom',
    description:'Classroom tasks in this conversation/workspace. Operations: open/status/list/search/get/start_file/create_material/finish/enhance/cancel/resume/document/audio/rename/auto_title/delete/trash_list/restore/doctor. Review operations: review_edit {id,chunk,segment,text,revision}; speaker_name {id,speaker,name}; speaker_merge {id,source,target}; speaker_assign {id,start,end,target}; note_save {id,text,time,page?,source?}; note_delete {id,noteId}; resummarize {id}; history {id}; review_restore {id,snapshot}. Use classroom_knowledge for persistent recall. Hardware capture requires explicit human action in the UI. open args:{mode:"record"|"watch"|"library"}; the human grants capture there. search args:{query,limit}. start_file args:{path,title?,autoTitle?,options:{language:"en"|"zh"|"auto",quality:"turbo"|"large-v3",translate:true,summarize:true},materials:[{kind:"document"|"video",path}]}. Omit title for content-based naming. rename takes id,title; auto_title takes id and queues content naming. delete takes id and moves a stopped record/cache/generated outputs to a recoverable bin; original input files are preserved. Only delete records the human asks to delete. restore takes id. Paths may be workspace-relative. Output: workspace/课堂记录. args is a JSON object string. get takes id,offset,limit; enhance takes id,materials. Jobs return immediately; never claim completion until get confirms it.',
    parameters:{operation:{type:'string',required:true},args:{type:'string',description:'JSON object; default {}'}},
    output:{schema:{type:'string'},render:(_args,value)=>[{type:'text',text:value}]},
    async execute(args,exec){if(['native_start','purge','batch_records','selected_export'].includes(args.operation))throw Error('请在课堂界面选择设备开始录音，或在回收区明确确认永久删除');if(!operations.has(args.operation)&&!['open','search'].includes(args.operation))throw new Error('Unknown classroom operation');return JSON.stringify(await scopedCall(args.operation,JSON.parse(args.args||'{}'),exec?.agent?.session?.header?.id));}
  })),'classroom tool');
  ctx.inject(['webServer','connection'],web=>{
    const watchPairs=registerWatchRoutes(web,worker);
    web.effect(()=>web.connection.fetch.register({path:'/api/classroom/annotation',methods:['GET'],requestBody:'buffered',fetch:async request=>{try{const q=new URL(request.url).searchParams,id=q.get('id');if(q.get('sessionId'))await projects.allowed(id,await projects.context(q.get('sessionId')));const result=await worker.call('annotation_path',{id,noteId:q.get('noteId')});return new Response(Readable.toWeb(createReadStream(result.path)),{headers:{'content-type':'image/png','cache-control':'no-store','x-content-type-options':'nosniff'}});}catch(error){return Response.json({error:error.message},{status:400});}}}),'classroom annotations');
    web.effect(()=>web.connection.fetch.register({path:'/api/classroom/selected-export',methods:['POST'],requestBody:'buffered',fetch:async request=>{try{const form=await request.formData(),ids=JSON.parse(form.get('ids')),sessionId=form.get('sessionId');if(!sessionId)throw Error('请选择项目对话后导出');const result=await projects.run('selected_export',{ids},sessionId);return new Response(Readable.toWeb(createReadStream(result.path)),{headers:{'content-type':'application/zip','content-disposition':'attachment; filename="classroom-selected.zip"'}});}catch(error){return Response.json({error:error.message},{status:400});}}}),'classroom batch export');
    web.effect(()=>web.connection.fetch.register({path:'/api/classroom/knowledge/backup',methods:['POST'],requestBody:'buffered',fetch:async()=>{try{const result=await knowledge.queue(async()=>{await knowledge.ready;return worker.call('knowledge_backup');});return new Response(Readable.toWeb(createReadStream(result.path)),{headers:{'content-type':'application/zip','content-disposition':'attachment; filename="classroom-knowledge.zip"'}});}catch(error){return Response.json({error:error.message},{status:400});}}}),'knowledge portable backup');
    web.effect(()=>web.connection.fetch.register({path:'/api/classroom/knowledge/asset',methods:['GET'],requestBody:'buffered',fetch:async request=>{try{const q=new URL(request.url).searchParams,context=q.get('sessionId')?await projects.context(q.get('sessionId')):undefined;const asset=await knowledge.asset(context,{id:q.get('id'),scope:q.get('scope'),preview:q.get('preview')==='1'});return new Response(Readable.toWeb(createReadStream(asset.path)),{headers:{'content-type':q.get('preview')==='1'?({'png':'image/png','jpg':'image/jpeg','jpeg':'image/jpeg','webp':'image/webp'}[asset.path.split('.').at(-1)]||'application/octet-stream'):'application/octet-stream','content-disposition':`${q.get('preview')==='1'?'inline':'attachment'}; filename*=UTF-8''${encodeURIComponent(asset.name)}`,'x-content-type-options':'nosniff'}});}catch(error){return Response.json({error:error.message},{status:400});}}}),'knowledge original sources');
    for(const [path,file]of [['/api/classroom/studio-ui.js','../web/studio-ui.js'],['/api/classroom/workspace-ui.js','../web/workspace-ui.js'],['/api/classroom/capture-guard.js','../web/capture-guard.js']])web.effect(()=>web.connection.fetch.register({path,methods:['GET'],requestBody:'buffered',fetch:async()=>new Response(await fs.readFile(new URL(file,import.meta.url)),{headers:{'content-type':'application/javascript; charset=utf-8','cache-control':'no-store'}})}),'classroom studio assets');
    web.effect(()=>web.connection.fetch.register({path:'/api/classroom/session',methods:['GET'],requestBody:'buffered',fetch:async request=>{
      try{if(!projects)throw Error('会话服务尚未就绪');return Response.json(await projects.info(new URL(request.url).searchParams.get('sessionId')));}catch(error){return Response.json({error:error.message},{status:400});}
    }}),'classroom session context');
    web.effect(()=>web.connection.fetch.register({path:'/api/classroom/session-ui.js',methods:['GET'],requestBody:'buffered',fetch:async()=>new Response(await fs.readFile(new URL('../web/session-ui.js',import.meta.url)),{headers:{'content-type':'application/javascript; charset=utf-8','cache-control':'no-store'}})}),'classroom project UI');
    web.effect(()=>web.connection.fetch.register({path:'/api/classroom/artifact',methods:['GET'],requestBody:'buffered',fetch:async request=>{
      try{if(!projects)throw Error('会话服务尚未就绪');const q=new URL(request.url).searchParams;return new Response(await projects.artifact(q.get('id'),q.get('sessionId'),q.get('name')),{headers:{'content-type':'text/plain; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});}catch(error){return Response.json({error:error.message},{status:400});}
    }}),'classroom project artifacts');
    for(const [path,url] of [['marked',import.meta.resolve('marked')],['purify',new URL('./purify.es.mjs',import.meta.resolve('dompurify'))]]){
      web.effect(()=>web.connection.fetch.register({path:`/api/classroom/${path}.js`,methods:['GET'],requestBody:'buffered',fetch:async()=>new Response(await fs.readFile(new URL(url)),{headers:{'content-type':'application/javascript; charset=utf-8','cache-control':'no-store'}})}),'classroom renderer');
    }
    for(const path of ['/classroom','/classroom/library'])web.effect(()=>web.webServer.register({kind:'exact',path,handler:async(req,res)=>{
      const rejected=web.connection.requestRejection(req);
      if(rejected){res.writeHead(rejected);res.end('请先在同一个浏览器打开 DSH 的启动链接。');return;}
      const html=await fs.readFile(new URL('../web/index.html',import.meta.url));
      res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(html);
    }}),'classroom UI');
    web.effect(()=>web.connection.fetch.register({path:'/api/classroom/rpc',methods:['POST'],requestBody:'buffered',fetch:async request=>{
      try{const body=await request.json();if(!operations.has(body.operation)&&!knowledgeOperations.has(body.operation)&&!['open','search'].includes(body.operation))return Response.json({error:'Unknown operation'},{status:400});const result=await scopedCall(body.operation,body.args||{},body.sessionId);if(['finish','cancel'].includes(body.operation))watchPairs.revoke(body.args?.id);return Response.json({result});}
      catch(error){return Response.json({error:error.message},{status:400});}
    }}),'classroom API');
    web.effect(()=>web.connection.fetch.register({path:'/api/classroom/upload',methods:['POST'],requestBody:'streaming',fetch:async request=>{
      const url=new URL(request.url);
      const filename=basename((url.searchParams.get('name')||'audio.wav').replaceAll('\\','/')).replace(/[^\p{L}\p{N}._ -]/gu,'_').slice(-160);
      const directory=join(resolved.dataDirectory,'imports');await fs.mkdir(directory,{recursive:true});
      const target=join(directory,randomUUID()+'-'+filename);const temporary=target+'.part';
      let bytes=0;
      const limiter=new Transform({transform(chunk,_encoding,callback){bytes+=chunk.length;callback(bytes>resolved.maxUploadGiB*1024**3?new Error('文件超过上传限制'):null,chunk);}});
      try{if(!request.body)throw new Error('Empty upload');await pipeline(Readable.fromWeb(request.body),limiter,createWriteStream(temporary,{flags:'wx'}));await fs.rename(temporary,target);return Response.json({path:target,bytes});}
      catch(error){await fs.rm(temporary,{force:true});return Response.json({error:error.message},{status:400});}
    }}),'classroom uploads');
    web.effect(()=>web.connection.fetch.register({path:'/api/classroom/report',methods:['GET'],requestBody:'buffered',fetch:async request=>{
      const id=new URL(request.url).searchParams.get('id');
      if(!/^[a-f0-9]{32}$/.test(id||''))return new Response('Invalid id',{status:400});
      const query=new URL(request.url).searchParams,format=query.get('format');
      if(['docx','pdf'].includes(format)){try{if(query.get('sessionId'))await projects.allowed(id,await projects.context(query.get('sessionId')));const result=await worker.call('export_document',{id,format});return new Response(Readable.toWeb(createReadStream(result.path)),{headers:{'content-type':format==='pdf'?'application/pdf':'application/vnd.openxmlformats-officedocument.wordprocessingml.document','content-disposition':`attachment; filename="classroom.${format}"`}});}catch(error){return Response.json({error:error.message},{status:400});}}
      const subtitle=format==='srt';
      const filename=subtitle?'transcript.srt':'report.md';
      try{return new Response(await fs.readFile(join(resolved.dataDirectory,'jobs',id,filename)), {headers:{'content-type':'text/plain; charset=utf-8','content-disposition':`attachment; filename="classroom-${filename}"`}});}
      catch{return new Response('报告尚未生成',{status:404});}
    }}),'classroom reports');
    web.effect(()=>web.connection.fetch.register({path:'/api/classroom/audio',methods:['GET'],requestBody:'buffered',fetch:async request=>{
      const id=new URL(request.url).searchParams.get('id');
      if(!/^[a-f0-9]{32}$/.test(id||''))return new Response('Invalid id',{status:400});
      try{
        const {path}=await worker.call('audio',{id});const {size}=await fs.stat(path);
        let start=0,end=size-1;const range=request.headers.get('range');
        if(range){const match=/^bytes=(\d+)-(\d*)$/.exec(range);if(!match)return new Response('Invalid range',{status:416});start=Number(match[1]);end=match[2]?Math.min(Number(match[2]),end):end;}
        if(start>end||start>=size)return new Response('Invalid range',{status:416,headers:{'content-range':`bytes */${size}`}});
        const extension=path.split('.').pop().toLowerCase();
        const mime={wav:'audio/wav',m4a:'audio/mp4',mp4:'video/mp4',mp3:'audio/mpeg',ogg:'audio/ogg',flac:'audio/flac',webm:'video/webm'}[extension]||'application/octet-stream';
        const headers={'content-type':mime,'accept-ranges':'bytes','content-length':String(end-start+1)};
        if(range)headers['content-range']=`bytes ${start}-${end}/${size}`;
        return new Response(Readable.toWeb(createReadStream(path,{start,end})),{status:range?206:200,headers});
      }catch(error){return new Response(error.message,{status:409});}
    }}),'classroom playback');
    // The browser half contributes the Session-scoped composer button.
  });
}
