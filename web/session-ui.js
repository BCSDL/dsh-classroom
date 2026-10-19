export const sessionId=new URL(location.href).searchParams.get('sessionId');
export async function classroomRPC(operation,args={}){
 const response=await fetch('/api/classroom/rpc',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({operation,args,...sessionId?{sessionId}:{}})});
 const body=await response.json();if(body.error)throw Error(body.error);return body.result;
}
export function installProjectUI(){
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
