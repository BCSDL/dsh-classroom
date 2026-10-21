export const sessionId=new URL(location.href).searchParams.get('sessionId');
export async function classroomRPC(operation,args={}){
 const response=await fetch('/api/classroom/rpc',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({operation,args,...sessionId?{sessionId}:{}})});
 const body=await response.json();if(body.error)throw Error(body.error);return body.result;
}
export function installProjectUI({getSelected=()=>null,changed=()=>{}}={}){
 const management=document.createElement('section'),row=document.createElement('div'),feedback=document.createElement('p'),trash=document.createElement('div');row.style.cssText='display:flex;gap:8px;flex-wrap:wrap';
 for(const [operation,label]of [['rename','修改标题'],['auto_title','根据内容命名'],['delete','删除记录'],['trash_list','回收区']]){const button=document.createElement('button');button.textContent=label;button.onclick=async()=>{try{button.disabled=true;feedback.textContent='';if(operation==='trash_list'){const items=await classroomRPC('trash_list');trash.replaceChildren();for(const item of items){const line=document.createElement('p'),restore=document.createElement('button');line.textContent=item.title+' ';restore.textContent='恢复';restore.onclick=async()=>{try{await classroomRPC('restore',{id:item.id});line.remove();await changed();feedback.textContent='记录已恢复。';}catch(e){feedback.textContent=e.message;}};const purge=document.createElement('button');purge.textContent='永久删除';purge.onclick=async()=>{const confirm=prompt('永久删除这条回收记录和生成缓存，无法恢复。原始知识资料保留。请输入完整标题：'+item.title);if(confirm!==item.title)return;try{await classroomRPC('purge',{id:item.id,confirm});line.remove();await changed();feedback.textContent='记录和生成缓存已永久删除。';}catch(e){feedback.textContent=e.message;}};line.append(restore,purge);trash.append(line);}if(!items.length)trash.textContent='回收区为空。';return;}
 const id=getSelected();if(!id)throw Error('请先在下方选择一条记录');const args={id};if(operation==='delete'&&!confirm('删除选中的课堂记录及生成结果？它们会移入可恢复的回收区，原始导入文件保留。'))return;if(operation==='rename'){const title=prompt('输入新的课程标题');if(title===null)return;args.title=title;}
 await classroomRPC(operation,args);await changed(operation,id);feedback.textContent=operation==='delete'?'已移入回收区，可以恢复。':operation==='auto_title'?'已安排根据内容生成标题。':'标题已更新。';
 }catch(e){feedback.textContent=e.message;}finally{button.disabled=false;}};row.append(button);}
 management.append(row,feedback,trash);document.querySelector('main').prepend(management);
 if(!sessionId)return;
 for(const a of document.querySelectorAll('a[href="/classroom"],a[href="/classroom/watch"]'))a.href+='?sessionId='+encodeURIComponent(sessionId)+(new URL(location.href).searchParams.has('embedded')?'&embedded=1':'');
 if(new URL(location.href).searchParams.has('embedded'))for(const a of document.querySelectorAll('a[href="/"]'))a.hidden=true;
 const section=document.createElement('section');section.setAttribute('aria-label','项目归档与检索');
 const heading=document.createElement('h2');heading.textContent='当前对话的课程资料';const path=document.createElement('p');path.textContent='正在确认实际保存目录…';path.style.overflowWrap='anywhere';
 const input=document.createElement('input');input.placeholder='查找当前项目的课程内容';input.setAttribute('aria-label','检索课程记录');input.style.cssText='width:min(95%,380px);margin-right:8px';
 const button=document.createElement('button');button.textContent='查找';const results=document.createElement('div');
 button.onclick=async()=>{try{button.disabled=true;const data=await classroomRPC('search',{query:input.value});results.replaceChildren();for(const item of data.results){const box=document.createElement('article'),title=document.createElement('strong'),text=document.createElement('pre');title.textContent=item.title;text.textContent=item.excerpt+'\n\n'+item.directory;box.append(title,text);results.append(box);}if(!data.results.length)results.textContent='没有找到匹配记录。';}catch(e){results.textContent=e.message;}finally{button.disabled=false;}};
 section.append(heading,path,input,button,results);document.querySelector('main').prepend(section);
 fetch('/api/classroom/session?sessionId='+encodeURIComponent(sessionId)).then(r=>r.json()).then(value=>{path.textContent=value.error||'保存位置：'+value.outputDirectory+'。结果会回到发起任务的对话。';}).catch(e=>path.textContent=e.message);
}
