window.__ModuleLoader__.load({id:'dsh-classroom',factory:(require)=>{
 const React=require('react');
 const panels=new Map();
 function open(sessionId,mode='record'){
  let panel=panels.get(sessionId);
  if(!panel){
   const root=document.createElement('section');root.setAttribute('aria-label','当前对话的课堂任务');root.style.cssText='position:fixed;right:12px;top:100px;bottom:20px;width:min(780px,95vw);z-index:2000;background:#111827;border:1px solid #475569;border-radius:12px;box-shadow:0 12px 55px #0008;display:flex;flex-direction:column;overflow:hidden';
   const bar=document.createElement('div');bar.style.cssText='display:flex;gap:8px;padding:10px;background:#1e293b;color:white;align-items:center;flex-wrap:wrap';
   const label=document.createElement('strong');label.textContent='当前对话 · 课堂';bar.append(label);
   const frames={};
   for(const [key,title,url]of [['record','录音 / 文件','/classroom'],['watch','Chrome 视频','/classroom/watch']]){
    const button=document.createElement('button');button.textContent=title;button.style.cssText='border:1px solid #64748b;padding:6px;background:#334155;color:white;border-radius:6px;cursor:pointer';button.onclick=()=>show(key);bar.append(button);
    frames[key]={url,node:null};
   }
   const collapse=document.createElement('button');collapse.textContent='收起（继续运行）';collapse.style.cssText='margin-left:auto;padding:6px;cursor:pointer';collapse.onclick=()=>root.style.display='none';bar.append(collapse);root.append(bar);
   const body=document.createElement('div');body.style.cssText='flex:1;min-height:0';root.append(body);
   function show(key){
    if(!frames[key].node){const frame=document.createElement('iframe');frame.title='当前对话的课堂'+key;frame.src=frames[key].url+'?embedded=1&sessionId='+encodeURIComponent(sessionId);frame.allow='microphone; display-capture';frame.style.cssText='width:100%;height:100%;border:0';body.append(frame);frames[key].node=frame;}
    for(const[k,item]of Object.entries(frames))if(item.node)item.node.style.display=k===key?'block':'none';
   }
   document.body.append(root);panel={root,show};panels.set(sessionId,panel);
  }
  for(const[id,p]of panels)p.root.style.display=id===sessionId?'flex':'none';panel.show(mode);
 }
 function apply(ctx){
  function ClassroomButton({sessionId}){
   const[error,setError]=React.useState('');
   React.useEffect(()=>{let active=true,last=sessionStorage.getItem('classroom-open-'+sessionId);const poll=async()=>{try{const r=await fetch('/api/classroom/session?sessionId='+encodeURIComponent(sessionId));const value=await r.json();if(!active)return;if(value.error){setError(value.error);return;}setError('');if(value.openRequested&&value.openRequested.id!==last){last=value.openRequested.id;sessionStorage.setItem('classroom-open-'+sessionId,last);open(sessionId,value.openRequested.mode);}}catch(e){if(active)setError(e.message);}};poll();const timer=setInterval(poll,5000);return()=>{active=false;clearInterval(timer);for(const p of panels.values())p.root.style.display='none';};},[sessionId]);
   return React.createElement('button',{type:'button',title:error||'当前对话的录音、课程文件与 Chrome 视频',onClick:()=>open(sessionId),style:{background:'#2563eb',color:'white',border:0,borderRadius:7,padding:'6px 12px',cursor:'pointer'}},'课堂');
  }
  ctx.slots.inject('conversation.input.left',()=>ctx.slots.register({name:'conversation.input.left',id:'classroom',order:50,inject:sessionId=>({sessionId})},ClassroomButton));
  function ClassroomResults({sessionId}){
   const[jobs,setJobs]=React.useState([]),[trash,setTrash]=React.useState([]),[showTrash,setShowTrash]=React.useState(false),[revision,setRevision]=React.useState(0);
   React.useEffect(()=>{let active=true;const poll=async()=>{try{const r=await fetch('/api/classroom/session?sessionId='+encodeURIComponent(sessionId)),data=await r.json();if(active){setJobs((data.jobs||[]).filter(j=>j.sessionId===sessionId).slice(-5).reverse());setTrash((data.trash||[]).filter(j=>j.sessionId===sessionId));}}catch{}};poll();const timer=setInterval(poll,5000);return()=>{active=false;clearInterval(timer);};},[sessionId,revision]);
   if(!jobs.length&&!trash.length)return null;
   const h=React.createElement;
   const action=(operation,job)=>async()=>{try{const args={id:job.id};if(operation==='delete'&&!confirm('删除“'+job.title+'”及其生成结果？移入回收区后可以恢复，原始导入文件保留。'))return;if(operation==='rename'){const title=prompt('新的课程标题',job.title);if(title===null)return;args.title=title;}const r=await fetch('/api/classroom/rpc',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({operation,args,sessionId})}),data=await r.json();if(data.error)throw Error(data.error);setRevision(n=>n+1);}catch(e){alert(e.message);}};
   const controls=job=>h('span',null,...[['rename','改名'],['auto_title','自动命名'],['delete','删除']].map(([op,label])=>h('button',{key:op,type:'button',onClick:action(op,job),style:{marginLeft:8,cursor:'pointer'}},label)));
   return h('details',{open:true,style:{width:'calc(100% - 32px)',maxWidth:760,boxSizing:'border-box',margin:'6px auto',padding:10,border:'1px solid #64748b',borderRadius:9,maxHeight:240,overflow:'auto',fontSize:13}},
    h('summary',{style:{cursor:'pointer',fontWeight:600}},'课堂任务与结果'),
    ...jobs.map(job=>h('article',{key:job.id,style:{borderTop:'1px solid #64748b',padding:'8px 0'}},h('strong',null,job.title+' · '+(job.notified?'已归档':job.state==='complete'?'正在归档':job.phase||'处理中')),controls(job),job.summary&&h('p',{style:{whiteSpace:'pre-wrap'}},job.summary.slice(0,600)),job.archiveError&&h('p',null,'归档待重试：'+job.archiveError),job.titleError&&h('p',null,'自动标题：'+job.titleError),job.notified&&h('div',null,...['纪要.md','逐字稿.md','字幕.srt'].map(name=>h('a',{key:name,href:'/api/classroom/artifact?'+new URLSearchParams({sessionId,id:job.id,name}),target:'_blank',rel:'noopener',style:{marginRight:12,color:'#60a5fa'}},name))),h('p',{style:{overflowWrap:'anywhere',margin:'5px 0'}},'保存位置：'+(job.archiveDirectory||job.projectDirectory+'\\课堂记录\\'+job.folder)))),
    trash.length>0&&h('button',{type:'button',onClick:()=>setShowTrash(v=>!v)},'回收区（'+trash.length+'）'),showTrash&&trash.map(job=>h('p',{key:job.id},job.title,h('button',{type:'button',onClick:action('restore',job)},'恢复'))));
  }
  ctx.slots.inject('conversation.input.dock',()=>ctx.slots.register({name:'conversation.input.dock',id:'classroom-results',order:50,inject:sessionId=>({sessionId})},ClassroomResults));
  ctx.on('dispose',()=>{for(const p of panels.values())p.root.remove();panels.clear();});
 }
 return {inject:['slots'],apply};
}});
