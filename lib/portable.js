import fs from 'node:fs/promises';
import {join,resolve,relative,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
const base=new URL('.',import.meta.resolve('dsh-knowledge-base-local/kb'));
const {KnowledgeStore}=await import(new URL('src/store.js',base));
const {normalizeSettings}=await import(new URL('src/settings.js',base));
const {parseDocFile,formatDocFile}=await import(new URL('src/util.js',base));
const inside=(root,path)=>{const part=relative(root,path);return !isAbsolute(part)&&part!=='..'&&!part.startsWith('../')&&!part.startsWith('..\\');};
const sha=text=>createHash('sha256').update(text).digest('hex');

export async function mergePortable(k,context,path){return k.queue(async()=>{
 await k.ready;const actual=await fs.realpath(path),staging=await fs.realpath(join(k.config.dataDirectory,'restore-staging'));
 if(!inside(staging,actual)||staging===actual)throw Error('无效备份暂存目录');
 const registry=JSON.parse(await fs.readFile(join(actual,'classroom-sources.json'),'utf8'));
 if(!registry?.documents)throw Error('备份缺少知识元数据');
 const seen=new Set();for(const meta of Object.values(registry.documents)){if(!meta||!/^[a-zA-Z0-9_-]{1,160}$/.test(meta.id||'')||seen.has(meta.id))throw Error('备份知识编号无效或重复');seen.add(meta.id);}
 const store=new KnowledgeStore(normalizeSettings({rootDir:actual}));await store.init();
 for(const name of Object.keys(registry.assets||{})){
  if(!/^[a-f0-9]{64}(?:\.[a-z0-9.]{1,12})?$/.test(name))throw Error('备份原始文件编号无效');
  const source=await fs.realpath(join(actual,'assets',name));if(!inside(join(actual,'assets'),source))throw Error('原始资料越界');
  const kept=await k.preserve(source);if(kept.asset!==name)throw Error('原始资料哈希与文件名不一致');
  k.registry.assets[name]={...registry.assets[name],name};
 }
 const records=k.worker?await k.worker.call('restore_records',{path:actual,scope:k.collection(context)}):{mapping:{},records:[]};
 let imported=0,histories=0,trashed=0;const idMap={},manifest=await store.loadManifest();
 for(const meta of Object.values(registry.documents)){
  let text;if(meta.deleted||meta.disabled){const path=await fs.realpath(join(actual,'trash',meta.id,'doc.md'));if(!inside(join(actual,'trash'),path))throw Error('回收内容越界');text=store.decodeBody(parseDocFile(await fs.readFile(path,'utf8')).body,meta.id);}
  else text=await store.readDocBody(store.findDoc(manifest,meta.id));
  const source={...meta.source,restored:true};
  if(source.jobId){source.originalJobId=source.jobId;source.jobId=records.mapping[source.jobId];source.sessionId=context?.sessionId;source.projectDirectory=context?.projectDirectory;}
  if(source.image)delete source.image; // The immutable image asset is portable; old machine paths are not.
  const origin=source.jobId?':'+source.jobId:'';
  const doc=await k.upsert('restored:'+k.collection(context)+':'+meta.id+origin,{title:meta.title,text,kind:meta.kind,source,context});
  idMap[meta.id]=doc.id;
  const versionRoot=join(actual,'versions',meta.id);let files=[];
  try{files=await fs.readdir(versionRoot);}catch(e){if(e.code!=='ENOENT')throw e;}
  for(const name of files){
   if(!/^[a-zA-Z0-9_.-]+\.md$/.test(name))throw Error('备份版本名称无效');
   const path=await fs.realpath(join(versionRoot,name));if(!inside(versionRoot,path))throw Error('版本文件越界');
   const body=store.decodeBody(parseDocFile(await fs.readFile(path,'utf8')).body,meta.id);
   const destination=join(k.root,'versions',doc.id);await fs.mkdir(destination,{recursive:true});
   const filename='imported-'+name.slice(0,-3)+'-'+sha(body).slice(0,10)+'.md';
   await fs.writeFile(join(destination,filename),formatDocFile({...doc,source,id:doc.id},k.store.encodeBody(body,doc.id)),{flag:'wx'}).catch(e=>{if(e.code!=='EEXIST')throw e;});histories++;
  }
  if((meta.deleted||meta.disabled)&&!doc.deleted&&!doc.disabled){await k.store.remove(doc.id);doc.deleted=!!meta.deleted;doc.disabled=!!meta.disabled;trashed++;}
  imported++;
 }
 await k.save();return {imported,histories,trashed,merged:true,originalsPreserved:true,records:records.records,idMap};
});}

export async function manageNotes(k,context,args){return k.queue(async()=>{
 await k.ready;const ids=[...new Set(args.ids||[])];if(!ids.length||ids.length>200)throw Error('请选择 1–200 条独立笔记');
 if(!['trash','restore'].includes(args.action))throw Error('只支持移入回收区或恢复');
 if(args.confirm!==(args.action==='trash'?'移入笔记回收区':'恢复知识笔记'))throw Error('需要明确确认所选笔记操作');
 const targets=ids.map(id=>k.registry.documents[id]);
  if(targets.some(meta=>!meta||meta.kind!=='note'||meta.source?.jobId||meta.source?.originalJobId||meta.collection!==k.collection(context)))throw Error('只能管理当前项目的独立知识笔记');
 let changed=0;for(const meta of targets){
  if(args.action==='trash'&&!meta.deleted){await k.store.remove(meta.id);meta.deleted=true;changed++;}
  else if(args.action==='restore'&&meta.deleted){await k.store.restore(meta.id);meta.deleted=false;changed++;}
 }
 await k.save();return {changed};
});}
