import z from '@deepseek-ai/schemastery';
import {defineTool} from '@deepseek-ai/dsh-tools';
import fs from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {Readable, Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {homedir} from 'node:os';
import {join, basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {WorkerClient} from './worker-client.js';

export const name='classroom';
export const inject=['tools'];
export const Config=z.object({
  pythonExecutable:z.string().default(''),
  modelsDirectory:z.string().default(''),
  dataDirectory:z.string().default(''),
  ffmpegExecutable:z.string().default(''),
  ollamaURL:z.string().default('http://127.0.0.1:11434'),
  model:z.string().default('gemma4:12b-it-qat'),
  maxUploadGiB:z.number().min(1).max(128).default(32)
});
const operations=new Set(['status','list','get','start_file','create_live','append','finish','enhance','cancel','resume','document']);

export function apply(ctx, config) {
  const runtime=join(homedir(),'.local-ai-tools','classroom');
  const resolved={...config,
    pythonExecutable:config.pythonExecutable||join(runtime,process.platform==='win32'?'Scripts/python.exe':'bin/python'),
    modelsDirectory:config.modelsDirectory||join(runtime,'models'),
    dataDirectory:config.dataDirectory||join(process.env.DSH_HOME||join(homedir(),'.dsh'),'classroom')};
  const worker=new WorkerClient(resolved,fileURLToPath(new URL('../backend/worker.py',import.meta.url)));
  ctx.on('dispose',()=>worker.close());
  ctx.effect(()=>ctx.tools.register(defineTool({
    name:'classroom',
    description:'Local recordings and file analysis. Operations: status/list/get/start_file/create_live/finish/enhance/cancel/resume/document. args is a JSON object string. start_file takes path,title,options(language en/zh/auto, quality turbo/large-v3,translate,summarize),materials[{kind:document|video,path}]. enhance takes id,materials. get takes id,offset,limit. document takes path,limit and returns page text/image paths. Browser UI is /classroom on the existing DSH URL. Jobs persist and return immediately; poll get for results.',
    parameters:{operation:{type:'string',required:true},args:{type:'string',description:'JSON object; default {}'}},
    output:{schema:{type:'string'},render:(_args,value)=>[{type:'text',text:value}]},
    async execute(args){if(!operations.has(args.operation))throw new Error('Unknown classroom operation');return JSON.stringify(await worker.call(args.operation,JSON.parse(args.args||'{}')));}
  })),'classroom tool');
  ctx.inject(['webServer','connection'],web=>{
    web.effect(()=>web.webServer.register({kind:'exact',path:'/classroom',handler:async(req,res)=>{
      const rejected=web.connection.requestRejection(req);
      if(rejected){res.writeHead(rejected);res.end('请先在同一个浏览器打开 DSH 的启动链接。');return;}
      const html=await fs.readFile(new URL('../web/index.html',import.meta.url));
      res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(html);
    }}),'classroom UI');
    web.effect(()=>web.connection.fetch.register({path:'/api/classroom/rpc',methods:['POST'],requestBody:'buffered',fetch:async request=>{
      try{const body=await request.json();if(!operations.has(body.operation))return Response.json({error:'Unknown operation'},{status:400});return Response.json({result:await worker.call(body.operation,body.args||{})});}
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
      try{return new Response(await fs.readFile(join(resolved.dataDirectory,'jobs',id,'report.md')), {headers:{'content-type':'text/markdown; charset=utf-8','content-disposition':'attachment; filename="classroom-report.md"'}});}
      catch{return new Response('报告尚未生成',{status:404});}
    }}),'classroom reports');
    // Add a small launcher through the supported index injection seam.
    web.effect(()=>web.webServer.tapIndex(html=>html.replace('</body>','<a href="/classroom" target="_blank" rel="noopener" style="position:fixed;bottom:16px;right:80px;z-index:1000;background:#2563eb;color:#fff;padding:9px 14px;border-radius:8px;text-decoration:none;font:14px sans-serif">课堂纪要</a></body>')),'classroom launcher');
  });
}
