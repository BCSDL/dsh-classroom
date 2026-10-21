const el=(tag,text,props={})=>Object.assign(document.createElement(tag),{...(text!==undefined?{textContent:text}:{}),...props});
const row=(...nodes)=>{const node=el('div',undefined,{className:'row'});node.append(...nodes);return node;};
const input=(label,tag='input')=>el(tag,undefined,{ariaLabel:label,placeholder:label});
const group=(title,...nodes)=>{const node=el('details');node.append(el('summary',title),...nodes);return node;};
const url=(path,args,sessionId)=>path+'?'+new URLSearchParams({...args,...sessionId?{sessionId}:{}});

export function installWorkspaceUI({host,rpc,sessionId,getSelected,updated,seek,currentTime=()=>0,setStatus}){
 const action=(label,callback)=>{const b=el('button',label,{type:'button'});b.onclick=async()=>{b.disabled=true;try{await callback();}catch(error){setStatus(error.message);}finally{b.disabled=false;}};return b;};
 const required=()=>{const id=getSelected();if(!id)throw Error('请先选择一条课堂记录');return id;};
 let shown,selectedJob;const template=el('select',undefined,{ariaLabel:'课堂复习模板'});
 for(const[value,label]of [['lecture','课堂学习笔记'],['cornell','康奈尔笔记'],['exam','考前复习与自测'],['problems','解题与推导'],['meeting','会议纪要']])template.append(el('option',label,{value}));
 host.append(group('复习模板',row(template,action('保存复习模板',async()=>{await rpc('course_options',{id:required(),template:template.value});setStatus('模板已保存，结束课堂后可按完整资料重新生成。');}),action('按模板生成完整复习笔记',async()=>{await rpc('course_options',{id:required(),template:template.value});await rpc('resummarize',{id:required()});await updated();setStatus('已排队生成复习笔记，原始资料保留。');}))));

 // A separate ink layer makes the eraser preserve the screenshot beneath it.
 const canvas=el('canvas',undefined,{width:1000,height:600,ariaLabel:'手写和截图批注画布'}),background=el('canvas',undefined,{width:1000,height:600}),ink=el('canvas',undefined,{width:1000,height:600});
 canvas.style.cssText='width:100%;height:auto;background:white;touch-action:none;border:1px solid #64748b;cursor:crosshair';
 const color=input('画笔颜色');color.type='color';color.value='#ef4444';const width=input('画笔粗细');width.type='number';width.min='1';width.max='40';width.value='4';width.style.width='70px';
 const erase=input('橡皮擦');erase.type='checkbox';const image=input('导入截图到画布');image.type='file';image.accept='image/*';
 const text=input('批注说明（可选）','textarea'),second=input('批注对应录音秒数'),page=input('批注课件页码');second.type=page.type='number';second.min='0';second.value='0';page.min='1';
 const analyze=input('保存后识别手写或截图');analyze.type='checkbox';analyze.checked=true;
 let drawing=false,last,undo=[];
 const render=()=>{const c=canvas.getContext('2d');c.fillStyle='white';c.fillRect(0,0,1000,600);c.drawImage(background,0,0);c.drawImage(ink,0,0);};
 const checkpoint=()=>{undo.push(ink.getContext('2d').getImageData(0,0,1000,600));if(undo.length>12)undo.shift();};
 const point=e=>{const r=canvas.getBoundingClientRect();return {x:(e.clientX-r.left)*1000/r.width,y:(e.clientY-r.top)*600/r.height};};
 canvas.onpointerdown=e=>{checkpoint();drawing=true;last=point(e);canvas.setPointerCapture(e.pointerId);const c=ink.getContext('2d');c.globalCompositeOperation=erase.checked?'destination-out':'source-over';c.strokeStyle=color.value;c.lineWidth=Math.max(1,Math.min(40,Number(width.value)||4));c.lineCap=c.lineJoin='round';c.beginPath();c.moveTo(last.x,last.y);c.lineTo(last.x+.1,last.y+.1);c.stroke();render();};
 canvas.onpointermove=e=>{if(!drawing)return;const p=point(e),c=ink.getContext('2d');c.beginPath();c.moveTo(last.x,last.y);c.lineTo(p.x,p.y);c.stroke();last=p;render();};
 canvas.onpointerup=canvas.onpointercancel=()=>drawing=false;
 async function loadImage(blob){if(blob.size>20*1024**2)throw Error('截图超过 20 MiB，请先缩小');const bitmap=await createImageBitmap(blob);try{if(bitmap.width*bitmap.height>24000000)throw Error('截图像素过大，请先缩小');background.getContext('2d').clearRect(0,0,1000,600);ink.getContext('2d').clearRect(0,0,1000,600);const scale=Math.min(1000/bitmap.width,600/bitmap.height);background.getContext('2d').drawImage(bitmap,(1000-bitmap.width*scale)/2,(600-bitmap.height*scale)/2,bitmap.width*scale,bitmap.height*scale);undo=[];render();}finally{bitmap.close();}}
 image.onchange=()=>image.files[0]&&loadImage(image.files[0]).catch(error=>setStatus(error.message));
 const drawings=el('div');
 const capture=action('截取屏幕截图',async()=>{let stream;try{stream=await navigator.mediaDevices.getDisplayMedia({video:true,audio:false});const video=el('video',undefined,{muted:true});video.srcObject=stream;await video.play();const c=el('canvas',undefined,{width:video.videoWidth,height:video.videoHeight});c.getContext('2d').drawImage(video,0,0);await loadImage(await new Promise(resolve=>c.toBlob(resolve,'image/png')));second.value=String(currentTime()||0);}finally{stream?.getTracks().forEach(t=>t.stop());}});
 host.append(group('手写与截图批注',el('p','可在白板手写，或导入/截取截图后标注。截屏由你在 Chrome 中选择共享范围；批注按 PNG 保存，支持本次绘制撤销。'),row(image,capture),row(color,width,el('label','橡皮擦 '),erase,action('撤销笔画',async()=>{const previous=undo.pop();if(!previous)return;ink.getContext('2d').putImageData(previous,0,0);render();}),action('清除笔画',()=>{checkpoint();ink.getContext('2d').clearRect(0,0,1000,600);render();}),action('清空画布',()=>{background.getContext('2d').clearRect(0,0,1000,600);ink.getContext('2d').clearRect(0,0,1000,600);undo=[];render();})),canvas,text,row(second,page,action('使用当前回听时间',()=>second.value=String(currentTime()||0)),el('label','保存后识别 '),analyze),action('保存批注到当前课堂',async()=>{const id=required(),blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));const response=await fetch('/api/classroom/upload?name=annotation.png',{method:'POST',body:blob}),upload=await response.json();if(upload.error)throw Error(upload.error);await rpc('annotation_save',{id,path:upload.path,text:text.value,time:Number(second.value),page:page.value?Number(page.value):undefined,analyze:analyze.checked});setStatus('批注已保存；启用识别时会排队分析，分析结果随后入库。');await updated();}),drawings));render();

 const alignment=el('div');
 async function loadAlignment(){const id=required();setStatus('正在用 CPU 匹配课件与转写，首次计算可能稍久…');const result=await rpc('knowledge_align',{id});alignment.replaceChildren(el('p',result.notice+(result.warning?'；'+result.warning:'')));
  for(const material of result.pages){const card=el('article'),body=el('div'),preview=el('img',undefined,{src:url('/api/classroom/knowledge/asset',{id:material.docId,preview:'1'},sessionId),alt:material.name+' 第 '+material.page+' 页',loading:'lazy'});preview.style.cssText='max-width:100%;max-height:650px;object-fit:contain';
   card.append(el('h3',material.name+' · 第 '+material.page+' 页'));body.append(el('p',material.text.slice(0,900)));
   const start=input('关联起始秒数'),end=input('关联结束秒数');start.type=end.type='number';start.min=end.min='0';
   if(material.confirmed){start.value=material.confirmed.start;end.value=material.confirmed.end;body.append(el('strong','已人工确认：'+start.value+'–'+end.value+' 秒'));}
   for(const candidate of material.candidates)body.append(action('回听候选 '+candidate.start.toFixed(1)+'–'+candidate.end.toFixed(1)+' 秒',()=>{start.value=candidate.start;end.value=candidate.end;seek(candidate.start);}),el('p',candidate.text.slice(0,650)));
   if(!material.candidates.length)body.append(el('p','没有足够相近的转写候选，可回听后填写时间。只有课件时请先创建包含录音与课件的增强版。'));
   body.append(row(start,end,action('确认这页对应时间',async()=>{if(!start.value||!end.value)throw Error('请填写起止秒数，或先选择回听候选');await rpc('alignment_confirm',{id,source:material.source,page:material.page,start:Number(start.value),end:Number(end.value)});await loadAlignment();await updated();})));
   const split=row(preview,body);split.classList.add('alignment-grid');card.append(split);alignment.append(card);
  }if(!result.pages.length)alignment.append(el('p','当前记录没有可关联的课件页。请加入 PDF/课件生成增强版后再匹配。'));setStatus('匹配已完成；候选需要回听确认。');
 }
 host.append(group('课件与录音同步复习',action('加载课件与转写对应',loadAlignment),alignment));

 const kind=el('select',undefined,{ariaLabel:'批量管理对象'});for(const[value,label]of [['records','课堂记录'],['notes','独立知识笔记']])kind.append(el('option',label,{value}));
 const trash=input('查看回收区');trash.type='checkbox';const query=input('按标题筛选资料'),list=el('div'),all=input('全选当前页');all.type='checkbox';let offset=0,chosen=new Set(),items=[],total=0;
 async function load(){chosen.clear();all.checked=false;list.replaceChildren();
  if(kind.value==='records'){items=(await rpc(trash.checked?'trash_list':'list')).filter(x=>x.title.toLowerCase().includes(query.value.toLowerCase())).sort((a,b)=>(b.created||0)-(a.created||0));total=items.length;items=items.slice(offset,offset+50);}
  else{const result=await rpc('knowledge_list',{kind:'note',trash:trash.checked,query:query.value});items=result.documents.filter(x=>!x.source?.jobId&&!x.source?.originalJobId);total=items.length;items=items.slice(offset,offset+50);}
  for(const item of items){const check=input('选择 '+item.title);check.type='checkbox';check.dataset.id=item.id;check.onchange=()=>check.checked?chosen.add(item.id):chosen.delete(item.id);list.append(row(check,el('span',item.title),el('small',kind.value==='records'?(item.phase||item.state||'回收区'):new Date(item.updated).toLocaleString())));}
  info.textContent=`第 ${offset+1}–${offset+items.length} 条 / 共 ${total} 条；每页最多 50 条。`;if(!items.length)list.append(el('p','当前筛选下没有资料。'));
 }
 all.onchange=()=>{chosen.clear();for(const check of list.querySelectorAll('input[type=checkbox]')){check.checked=all.checked;if(check.checked)chosen.add(check.dataset.id);}};
 const info=el('p');kind.onchange=trash.onchange=()=>{offset=0;load().catch(error=>setStatus(error.message));};
 async function manage(){if(!chosen.size)throw Error('请先选择资料');const restoring=trash.checked,confirmText=kind.value==='records'?(restoring?'恢复课堂记录':'移入记录回收区'):(restoring?'恢复知识笔记':'移入笔记回收区');if(!confirm(confirmText+' '+chosen.size+' 条？原始资料保留。'))return;
  const result=await rpc(kind.value==='records'?'batch_records':'knowledge_manage',{ids:[...chosen],action:restoring?'restore':kind.value==='records'?'delete':'trash',confirm:confirmText});const errors=result.results?.filter(x=>x.error)||[];setStatus(errors.length?'部分记录未操作：'+errors.map(x=>x.error).join('；'):'所选资料已处理。');await load();await updated();
 }
 host.append(group('资料多选与批量整理',row(kind,el('label','回收区 '),trash,query,action('筛选 / 刷新资料',()=>{offset=0;return load();})),row(el('label','全选当前页 '),all,action('回收 / 恢复所选',manage),action('导出所选资料',async()=>{if(!chosen.size||trash.checked)throw Error('请选择活动资料；回收资料请先恢复');if(kind.value==='records'){const form=el('form',undefined,{action:'/api/classroom/selected-export',method:'POST',target:'_blank'});for(const[name,value]of [['ids',JSON.stringify([...chosen])],['sessionId',sessionId||'']])form.append(el('input',undefined,{type:'hidden',name,value}));document.body.append(form);form.submit();form.remove();}else{let text='';for(const id of chosen){const doc=await rpc('knowledge_read',{id,full:true});text+='# '+doc.title+'\n\n'+doc.content+'\n\n';}const link=el('a',undefined,{href:URL.createObjectURL(new Blob([text],{type:'text/markdown;charset=utf-8'})),download:'课堂知识笔记.md'});link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);}})),info,list,row(action('上一页',()=>{offset=Math.max(0,offset-50);return load();}),action('下一页',()=>{if(offset+50<total)offset+=50;return load();}))));
 const style=el('style','.alignment-grid{display:grid;grid-template-columns:minmax(180px,1fr) minmax(220px,1fr);align-items:start}.alignment-grid>div{min-width:0}.alignment-grid button{margin:5px}small{color:#94a3b8}@media(max-width:750px){.alignment-grid{grid-template-columns:1fr}}');document.head.append(style);
 return {options:()=>({template:template.value}),show(job){selectedJob=job;if(shown!==job.id){shown=job.id;template.value=job.options?.template||'lecture';alignment.replaceChildren();}drawings.replaceChildren();for(const note of job.notes||[])if(note.image){const image=el('img',undefined,{src:url('/api/classroom/annotation',{id:job.id,noteId:note.id},sessionId),alt:note.text,loading:'lazy'});image.style.maxWidth='260px';drawings.append(el('h4',note.text+' · '+note.time+' 秒'),image,el('p',note.analysis||note.analysisError||('识别状态：'+note.analysisState)));}}};
}
