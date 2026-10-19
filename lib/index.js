import z from '@deepseek-ai/schemastery';
import {defineTool} from '@deepseek-ai/dsh-tools';
import fs from 'node:fs/promises';
import {createWriteStream,createReadStream,readFileSync} from 'node:fs';
import {Readable, Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {homedir} from 'node:os';
import {join, basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {WorkerClient} from './worker-client.js';
import {registerDocumentTools,applyToolDiscipline} from './tool-discipline.js';
import {registerWatchRoutes} from './watch-routes.js';
import {ClassroomProjects} from './projects.js';
import {createUserMessage} from '@deepseek-ai/dsh-llm';

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
  maxEvidenceRetries:z.number().min(0).max(3).default(2)
});
const operations=new Set(['status','list','get','start_file','create_live','append','finish','enhance','cancel','resume','document','audio','create_watch','watch_event','watch_frame','watch_status']);

export function apply(ctx, config) {
  const runtime=join(homedir(),'.local-ai-tools','classroom');
  const resolved={...config,
    pythonExecutable:config.pythonExecutable||join(runtime,process.platform==='win32'?'Scripts/python.exe':'bin/python'),
    modelsDirectory:config.modelsDirectory||join(runtime,'models'),
    dataDirectory:config.dataDirectory||join(process.env.DSH_HOME||join(homedir(),'.dsh'),'classroom')};
  const worker=new WorkerClient(resolved,fileURLToPath(new URL('../backend/worker.py',import.meta.url)));
  let projects;
  ctx.inject(['sessionController'],scope=>{
    projects=new ClassroomProjects({worker,dataDirectory:resolved.dataDirectory,
      session:async id=>(await scope.sessionController.inspect(id)).meta,
      notify:async(id,key,text)=>{
        const prior=await scope.sessionController.inspect(id);
        if(prior.events.some(event=>event.type==='user/message'&&event.data.source?.summary===key))return;
        const agent=await scope.sessionController.resolveAgent(id);
        agent.session.append('user/message',createUserMessage({content:[{type:'text',text}],source:{kind:'classroom',form:'notice',summary:key}}),{surfaceOp:'append'});
      }});
    const timer=setInterval(()=>projects.tick().catch(error=>console.error('classroom archive:',error.message)),3000);
    scope.on('dispose',()=>{clearInterval(timer);projects=undefined;});
  });
  const scopedCall=async(operation,args={},sessionId)=>{
    if(sessionId){if(!projects)throw Error('会话服务尚未就绪，请稍后重试');return projects.run(operation,args,sessionId);}
    return worker.call(operation,args);
  };
  ctx.on('dispose',()=>worker.close());
  registerDocumentTools(ctx,worker);
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
    description:'Classroom tasks bound to this conversation and actual workspace. Operations: open/status/list/search/get/start_file/finish/enhance/cancel/resume/document/audio. open args:{mode:"record"|"watch"} opens the in-chat panel; the human grants microphone/tab sharing there. search args:{query,limit} finds project records. start_file args:{path,title,options:{language:"en"|"zh"|"auto",quality:"turbo"|"large-v3",translate:true,summarize:true},materials:[{kind:"document"|"video",path}]}. Paths may be workspace-relative. Results archive under workspace/课堂记录 and post a completion notice to the originating conversation. args is a JSON object string. get takes id,offset,limit; enhance takes id,materials. Jobs return immediately; never claim completion until get confirms it.',
    parameters:{operation:{type:'string',required:true},args:{type:'string',description:'JSON object; default {}'}},
    output:{schema:{type:'string'},render:(_args,value)=>[{type:'text',text:value}]},
    async execute(args,exec){if(!operations.has(args.operation)&&!['open','search'].includes(args.operation))throw new Error('Unknown classroom operation');return JSON.stringify(await scopedCall(args.operation,JSON.parse(args.args||'{}'),exec?.agent?.session?.header?.id));}
  })),'classroom tool');
  ctx.inject(['webServer','connection'],web=>{
    const watchPairs=registerWatchRoutes(web,worker);
    web.effect(()=>web.connection.fetch.register({path:'/api/classroom/session',methods:['GET'],requestBody:'buffered',fetch:async request=>{
      try{if(!projects)throw Error('会话服务尚未就绪');return Response.json(await projects.info(new URL(request.url).searchParams.get('sessionId')));}catch(error){return Response.json({error:error.message},{status:400});}
    }}),'classroom session context');
    web.effect(()=>web.connection.fetch.register({path:'/api/classroom/session-ui.js',methods:['GET'],requestBody:'buffered',fetch:async()=>new Response(await fs.readFile(new URL('../web/session-ui.js',import.meta.url)),{headers:{'content-type':'application/javascript; charset=utf-8','cache-control':'no-store'}})}),'classroom project UI');
    for(const [path,url] of [['marked',import.meta.resolve('marked')],['purify',new URL('./purify.es.mjs',import.meta.resolve('dompurify'))]]){
      web.effect(()=>web.connection.fetch.register({path:`/api/classroom/${path}.js`,methods:['GET'],requestBody:'buffered',fetch:async()=>new Response(await fs.readFile(new URL(url)),{headers:{'content-type':'application/javascript; charset=utf-8','cache-control':'no-store'}})}),'classroom renderer');
    }
    web.effect(()=>web.webServer.register({kind:'exact',path:'/classroom',handler:async(req,res)=>{
      const rejected=web.connection.requestRejection(req);
      if(rejected){res.writeHead(rejected);res.end('请先在同一个浏览器打开 DSH 的启动链接。');return;}
      const html=await fs.readFile(new URL('../web/index.html',import.meta.url));
      res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(html);
    }}),'classroom UI');
    web.effect(()=>web.connection.fetch.register({path:'/api/classroom/rpc',methods:['POST'],requestBody:'buffered',fetch:async request=>{
      try{const body=await request.json();if(!operations.has(body.operation)&&!['open','search'].includes(body.operation))return Response.json({error:'Unknown operation'},{status:400});const result=await scopedCall(body.operation,body.args||{},body.sessionId);if(['finish','cancel'].includes(body.operation))watchPairs.revoke(body.args?.id);return Response.json({result});}
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
      const subtitle=new URL(request.url).searchParams.get('format')==='srt';
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
