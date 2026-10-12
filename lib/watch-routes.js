import fs from 'node:fs/promises';
import {randomBytes} from 'node:crypto';

export class PairRegistry {
 constructor(now=()=>Date.now()){this.now=now;this.entries=new Map();}
 create(id){this.revoke(id);for(const [key,value]of this.entries)if(value.expires<this.now())this.entries.delete(key);const token=randomBytes(32).toString('hex');const value={id,expires:this.now()+16*60*60*1000};this.entries.set(token,value);return {token,...value};}
 resolve(token){const value=this.entries.get(token);return value&&value.expires>this.now()?value:undefined;}
 revoke(id){for(const[key,value]of this.entries)if(value.id===id)this.entries.delete(key);}
}
export function validExtensionOrigin(origin){return !origin||/^chrome-extension:\/\/[a-p]{32}$/.test(origin);}
export function registerWatchRoutes(web,worker){
 const pairs=new PairRegistry();web.on('dispose',()=>pairs.entries.clear());
 for(const [route,file,mime]of [['/classroom/watch','../web/watch.html','text/html'],['/api/classroom/watch-client.js','../web/watch-client.js','application/javascript'],['/api/classroom/watch-utils.js','../web/watch-utils.js','application/javascript']]){
  web.effect(()=>web.webServer.register({kind:'exact',path:route,handler:async(req,res)=>{
   const rejected=web.connection.requestRejection(req);if(rejected){res.writeHead(rejected);res.end('请先打开 DSH 启动链接。');return;}
   res.writeHead(200,{'content-type':mime+'; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(await fs.readFile(new URL(file,import.meta.url)));
  }}),'Chrome capture asset');
 }
 web.effect(()=>web.connection.fetch.register({path:'/api/classroom/watch/pair',methods:['POST'],requestBody:'buffered',fetch:async request=>{
  try{const {id}=await request.json();const job=await worker.call('get',{id,limit:1});if(job.kind!=='watch'||job.recordingFinished)throw Error('请选择正在采集的 Chrome 记录');return Response.json(pairs.create(id));}catch(e){return Response.json({error:e.message},{status:400});}
 }}),'caption pairing');
 // Explicit, scoped local capability for the user-invoked Chrome companion.
 // No cookies, project files, media URLs or model access are exposed here.
 web.effect(()=>web.webServer.register({kind:'exact',path:'/api/classroom/watch/event',handler:async(req,res)=>{
  const origin=req.headers.origin||'';
  if(!validExtensionOrigin(origin)){res.writeHead(403);res.end('Origin denied');return;}
  const cors=origin?{'access-control-allow-origin':origin,'vary':'Origin'}:{};
  if(req.method==='OPTIONS'){res.writeHead(204,{...cors,'access-control-allow-methods':'POST','access-control-allow-headers':'authorization,content-type','access-control-max-age':'300'});res.end();return;}
  const binding=pairs.resolve((req.headers.authorization||'').replace(/^Bearer /,''));
  if(req.method!=='POST'||!binding){res.writeHead(403,cors);res.end('Invalid or expired pairing');return;}
  try{
   let size=0,parts=[];for await(const part of req){size+=part.length;if(size>32768)throw Error('Caption payload too large');parts.push(part);}
   const input=JSON.parse(Buffer.concat(parts).toString('utf8'));
   const result=await worker.call('watch_event',{id:binding.id,capturedAt:input.capturedAt,playerTime:input.playerTime,playbackRate:input.playbackRate,paused:input.paused,caption:input.caption,sourcePage:input.sourcePage,kind:input.kind});
   res.writeHead(200,{...cors,'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(result));
  }catch(e){res.writeHead(400,{...cors,'content-type':'application/json'});res.end(JSON.stringify({error:e.message}));}
 }}),'paired visible captions');
 web.effect(()=>web.connection.fetch.register({path:'/api/classroom/watch/frame',methods:['GET'],requestBody:'buffered',fetch:async request=>{
  try{const url=new URL(request.url);const {path}=await worker.call('watch_frame_path',{id:url.searchParams.get('id'),index:Number(url.searchParams.get('index'))});return new Response(await fs.readFile(path),{headers:{'content-type':'image/jpeg','cache-control':'private, max-age=300'}});}catch(e){return Response.json({error:e.message},{status:404});}
 }}),'capture frame evidence');
 return pairs;
}
