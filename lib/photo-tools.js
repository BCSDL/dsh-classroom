import {defineTool} from '@deepseek-ai/dsh-tools';
import fs from 'node:fs/promises';
import {isAbsolute,resolve,basename} from 'node:path';

export function dateWindow(kind='all',now=new Date(),timeZone='Europe/London'){
 const today=new Intl.DateTimeFormat('sv-SE',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
 if(kind==='all')return {kind,start:null,end:null,timeZone,asOf:now.toISOString()};
 if(!['recent_month','previous_month'].includes(kind))throw Error('window 只支持 all/recent_month/previous_month');
 const[y,m,d]=today.split('-').map(Number),last=new Date(Date.UTC(y,m-1,0)),py=last.getUTCFullYear(),pm=last.getUTCMonth()+1;
 const iso=(year,month,day)=>`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
 return {kind,start:iso(py,pm,kind==='previous_month'?1:Math.min(d,last.getUTCDate())),
  end:kind==='previous_month'?iso(py,pm,last.getUTCDate()):today,timeZone,asOf:now.toISOString(),semantics:'inclusive local calendar dates'};
}
export function photoRequest(text){
 if(!/照片|图片|截图|photos?|images?|screenshots?/i.test(text))return null;
 const quoted=/["“`]([a-z]:[\\/][^"”`\r\n]+)["”`]/i.exec(text);
 const plain=/([a-z]:[\\/][^\r\n]*?)(?=(?:中|里|内)(?:寻找|查找|挑选|找|选)|\s+(?:中|里|内)?(?:寻找|查找|挑选|找|选)|[，,。；;]|$)/i.exec(text);
 const path=(quoted?.[1]||plain?.[1])?.trim();if(!path)return null;
 return {path,window:/最近\s*(?:1|一|一个)?\s*月|最近\s*(?:1|一|一个)\s*个月|近一个月|last\s+month|past\s+month/i.test(text)?'recent_month':/上个月|上一月|previous month/i.test(text)?'previous_month':'all'};
}
export function sessionZone(agent){
 const events=agent?.session?.snapshotEvents?.()||[];
 return [...events].reverse().find(x=>x.type==='user/message'&&x.data?.source?.kind==='user')?.data?.source?.clientTimeZone||'Europe/London';
}
export function registerPhotoTools(ctx,worker){
 ctx.effect(()=>ctx.tools.register(defineTool({name:'photo_catalog',
  description:'Read-only complete image inventory and visual review. scan {path,window:"recent_month"|"previous_month"|"all",recursive:false,dateBasis:"filename"}; never infer dates yourself. list {catalog,offset,limit}; sheet {catalog,offset} returns 12 actual thumbnails; inspect {catalog,ids:[1..3 real IDs]} returns larger actual images. review {catalog,reviews:[{id,score:0..10,reason:"specific visible evidence"}]} only after sheet/inspect. result {catalog,limit:3} returns persisted ranking, coverage and honest selectionLabel. All selection needs actual images, not filenames or bytes. Only claim a complete selection if eligibleForCompleteSelection=true; otherwise explicitly limit claims to reviewed candidates. No deletion/moving originals. Current date is sampled by the tool, not supplied by the model.',
  parameters:{operation:{type:'string',required:true},path:{type:'string'},catalog:{type:'string'},window:{type:'string'},recursive:{type:'boolean'},dateBasis:{type:'string'},offset:{type:'integer'},limit:{type:'integer'},ids:{type:'array',items:{type:'string'}},reviews:{type:'array',items:{type:'object',properties:{id:{type:'string'},score:{type:'number'},reason:{type:'string'}},required:['id','score','reason']}}},
  output:{schema:{type:'string'},render:(_args,value)=>JSON.parse(value).content},
  async execute(args,exec){
   exec.signal.throwIfAborted();if(!['scan','list','sheet','inspect','review','result'].includes(args.operation))throw Error('使用 scan/list/sheet/inspect/review/result');
   const cwd=exec.agent?.session?.header?.cwd||process.cwd(),input={...args,scope:resolve(cwd)};
   if(args.operation==='scan'){
    if(!args.path)throw Error('scan 需要实际目录 path');input.path=isAbsolute(args.path)?args.path:resolve(cwd,args.path);
    if(!['filename','mtime'].includes(args.dateBasis||'filename'))throw Error('dateBasis 只能是 filename 或 mtime；mtime 不代表拍摄时间');
    input.window=dateWindow(args.window||'all',new Date(),sessionZone(exec.agent));input.now=input.window.asOf;
   }
   const result=await worker.call('photo_evidence',{...input,action:args.operation});exec.signal.throwIfAborted();
   const images=[];
   if(result.imagePaths?.length){
    const store=ctx.get('attachments');if(!store)throw Error('缺少图片附件服务，未登记已看图');
    for(const path of result.imagePaths){const attachment=await store.saveImage({data:await fs.readFile(path),mediaType:'image/jpeg',name:basename(path)});images.push({type:'image',attachment});}
    exec.signal.throwIfAborted();await worker.call('photo_evidence',{action:'delivered',catalog:args.catalog,scope:resolve(cwd),ids:result.items.map(x=>x.id),viewKind:args.operation});
    result.imagesReturned=images.length;
   }
   return JSON.stringify({content:[{type:'text',text:JSON.stringify(result)},...images]});
  }
 })),'photo inventory and evidence');
}
