import {marked} from '/api/classroom/marked.js';
import DOMPurify from '/api/classroom/purify.js';
import {pcmWav,cropBounds,frameDifference,clockLabel} from '/api/classroom/watch-utils.js';
const $=id=>document.getElementById(id);
const markdown=text=>DOMPurify.sanitize(marked.parse(text||''),{FORBID_TAGS:['img','iframe','video','audio','form','svg','math'],FORBID_ATTR:['style']});
let jobId=null,selected=null,stream=null,audio=null,processor=null,running=false,stopping=false;
let audioParts=[],audioSamples=0,totalSamples=0,audioIndex=0,frameIndex=0,frameTimer=null,pumping=null;
let captureStart=0,audioBase=0,lastFrameAt=0,lastFingerprint=null,crop={x:0,y:0,w:1,h:1},drag=null,frameOffset=0;
const saving=new Set();const canvas=document.createElement('canvas'),small=document.createElement('canvas');small.width=64;small.height=40;
const dbReady=new Promise((resolve,reject)=>{const r=indexedDB.open('dsh-classroom-watch-pending',1);r.onupgradeneeded=()=>r.result.createObjectStore('pending',{keyPath:'key'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
async function store(mode,fn){const db=await dbReady;return new Promise((resolve,reject)=>{const tx=db.transaction('pending',mode);const q=fn(tx.objectStore('pending'));let result;q.onsuccess=()=>result=q.result;tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('本地缓存保存失败'));});}
async function rpc(operation,args={}){const r=await fetch('/api/classroom/rpc',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({operation,args})});const v=await r.json();if(v.error)throw Error(v.error);return v.result;}
async function upload(blob,name){const r=await fetch('/api/classroom/upload?name='+encodeURIComponent(name),{method:'POST',body:blob});const v=await r.json();if(v.error)throw Error(v.error);return v.path;}
function error(e){$('error').textContent=e.message||String(e);}
function saveTask(promise){saving.add(promise);promise.catch(error).finally(()=>saving.delete(promise));return promise;}
async function pump(){if(pumping)return pumping;pumping=(async()=>{while(true){const items=await store('readonly',s=>s.getAll());if(!items.length)return;items.sort((a,b)=>a.id.localeCompare(b.id)||a.order-b.order);for(const item of items){
 if(item.kind==='finish'){await rpc('finish',{id:item.id});}
 else{if(!item.path){item.path=await upload(item.blob,`${item.kind}-${item.index}.${item.kind==='frame'?'jpg':'wav'}`);await store('readwrite',s=>s.put(item));}
 await rpc(item.kind==='frame'?'watch_frame':'append',{id:item.id,index:item.index,path:item.path,capturedAt:item.capturedAt,offset:item.offset});}
 await store('readwrite',s=>s.delete(item.key));
}}})();try{await pumping;}finally{pumping=null;}}
async function flushAudio(){if(!audioSamples)return;const count=audioSamples,parts=audioParts;audioSamples=0;audioParts=[];const index=audioIndex++;const offset=audioBase+totalSamples/audio.sampleRate;totalSamples+=count;await store('readwrite',s=>s.put({key:jobId+'-audio-'+index,id:jobId,kind:'audio',index,order:offset,offset,capturedAt:captureStart+offset*1000,blob:pcmWav(parts,count,audio.sampleRate)}));pump().catch(error);}
async function snapshot(force=false){
 if(!running||!$('video').videoWidth)return;
 const now=Date.now(),minimum=Math.max(5,Number($('interval').value)||12)*1000;
 if(!force&&now-lastFrameAt<minimum)return;
 const pending=await store('readonly',s=>s.getAll());if(pending.filter(p=>p.kind==='frame').length>=120){$('notice').textContent='画面上传积压，暂缓新增画面；音频仍持续保存。请检查本地服务。';return;}
 const video=$('video'),r=cropBounds(crop,video.videoWidth,video.videoHeight),scale=Math.min(1,1600/Math.max(r.w,r.h));canvas.width=Math.max(1,Math.round(r.w*scale));canvas.height=Math.max(1,Math.round(r.h*scale));canvas.getContext('2d').drawImage(video,r.x,r.y,r.w,r.h,0,0,canvas.width,canvas.height);
 const c=small.getContext('2d',{willReadFrequently:true});c.drawImage(canvas,0,0,64,40);const fingerprint=c.getImageData(0,0,64,40).data;
 if(!force&&now-lastFrameAt<60000&&frameDifference(lastFingerprint,fingerprint)<.035)return;
 const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.88));if(!blob)throw Error('Chrome 没有返回可采集的画面');
 lastFingerprint=new Uint8ClampedArray(fingerprint);lastFrameAt=now;const index=frameIndex++;
 await store('readwrite',s=>s.put({key:jobId+'-frame-'+index,id:jobId,kind:'frame',index,order:(now-captureStart)/1000,capturedAt:now,blob}));pump().catch(error);
}
async function newPair(){const r=await fetch('/api/classroom/watch/pair',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:jobId})});const v=await r.json();if(v.error)throw Error(v.error);$('pair').value=JSON.stringify({origin:location.origin,id:jobId,token:v.token});}
async function start(){
 if(running)return;const pending=await store('readonly',s=>s.getAll());if(pending.length)throw Error('上次采集还有未提交资料，请等待重试完成后再开始。');
 $('error').textContent='';$('start').disabled=true;
 try{
  if(!navigator.mediaDevices?.getDisplayMedia)throw Error('请使用桌面 Chrome，并从 localhost/127.0.0.1 打开 DSH。');
  stream=await navigator.mediaDevices.getDisplayMedia({video:{displaySurface:'browser',frameRate:{ideal:5,max:8}},audio:true,selfBrowserSurface:'exclude',systemAudio:'exclude'});
  captureStart=Date.now();const job=await rpc('create_watch',{title:$('title').value||'Chrome 课堂视频',captureStartedAt:captureStart,sourcePage:$('sourcePage').value,options:{language:$('language').value,translate:$('translate').checked,summarize:$('summarize').checked}});
  jobId=job.id;audioParts=[];audioSamples=0;totalSamples=0;audioIndex=0;frameIndex=0;lastFingerprint=null;lastFrameAt=0;running=true;
  $('video').srcObject=stream;await $('video').play();
  if(stream.getAudioTracks().length){audio=new AudioContext({sampleRate:16000});await audio.resume();audioBase=(Date.now()-captureStart)/1000;const source=audio.createMediaStreamSource(stream);processor=audio.createScriptProcessor(4096,1,1);const silence=audio.createGain();silence.gain.value=0;source.connect(processor);processor.connect(silence);silence.connect(audio.destination);processor.onaudioprocess=e=>{if(!running)return;const part=new Float32Array(e.inputBuffer.getChannelData(0));audioParts.push(part);audioSamples+=part.length;if(audioSamples>=audio.sampleRate*15)saveTask(flushAudio());};}
  $('stop').disabled=false;$('snapshot').disabled=false;$('newPair').disabled=false;$('copyPair').disabled=false;$('calibrate').disabled=false;
  $('notice').textContent=stream.getAudioTracks().length?'正在采集标签页画面与声音。请保持本页打开。':'仅采集画面：没有共享音频；字幕助手仍可提供原字幕。需要转写时重新共享并勾选音频。';
  stream.getVideoTracks()[0].addEventListener('ended',()=>{if(running)stop().catch(error);},{once:true});
  frameTimer=setInterval(()=>saveTask(snapshot()),1500);await newPair();await snapshot(true);await refresh();await show(job.id);
 }catch(e){running=false;stream?.getTracks().forEach(t=>t.stop());processor?.disconnect();await audio?.close();$('start').disabled=false;throw e;}
}
async function stop(){if(stopping||!running)return;stopping=true;running=false;clearInterval(frameTimer);$('stop').disabled=true;processor?.disconnect();stream?.getTracks().forEach(t=>t.stop());try{if(audio)await flushAudio();await Promise.all([...saving]);await store('readwrite',s=>s.put({key:jobId+'-finish',id:jobId,kind:'finish',order:Number.MAX_SAFE_INTEGER}));await pump();$('notice').textContent='采集已结束，已保存资料会继续分析；此页可继续查看进度。';}finally{if(audio)await audio.close();audio=null;processor=null;stopping=false;$('start').disabled=false;for(const name of ['snapshot','newPair','copyPair','calibrate'])$(name).disabled=true;}}
async function refresh(){const jobs=(await rpc('list')).filter(j=>j.kind==='watch');const current=$('jobs').value;$('jobs').replaceChildren();for(const job of jobs){const o=document.createElement('option');o.value=job.id;o.textContent=job.title+' · '+job.state;$('jobs').append(o);}if(jobs.some(j=>j.id===current))$('jobs').value=current;if(selected&&jobs.some(j=>j.id===selected))$('jobs').value=selected;}
async function show(id,more=false){if(!id)return;const changed=selected!==id;selected=id;if(changed||!more){frameOffset=0;$('frames').replaceChildren();}const job=await rpc('get',{id,limit:100}),watch=await rpc('watch_status',{id,offset:frameOffset,limit:20});
 $('phase').textContent=`${job.state} · ${job.phase||''}\n音频完成 ${job.completedChunks||0}/${Object.keys(job.chunks).length} 段；画面完成 ${watch.completedFrames}/${watch.totalFrames}，等待 ${watch.pendingFrames}`+(job.error?'\n'+job.error:'');
 $('summary').innerHTML=markdown(job.summary||'尚无摘要');$('transcript').textContent=job.results.flatMap(i=>i.segments.map(s=>`[采集 ${clockLabel(s.start)}${s.sourceStart==null?'':' / 课程 '+clockLabel(s.sourceStart)}] ${s.speaker}: ${s.text}`)).join('\n');
 $('captions').textContent=watch.captions.map(c=>`[${c.player==null?'采集 '+clockLabel((c.captured-job.captureStartedAt)/1000):'课程 '+clockLabel(c.player)}] ${c.caption}`).join('\n');const clock=watch.latestClock;
 $('clock').textContent=clock?.player!=null?`最近课程进度 ${clockLabel(clock.player)} · ${clock.rate} 倍速 · ${clock.paused?'暂停':'播放'}；锚点 ${Math.round((Date.now()-clock.captured)/1000)} 秒前`:'课程进度：未同步，当前只使用采集时间。';
 for(const frame of watch.frames){const box=document.createElement('article');box.className='frame';const heading=document.createElement('h3');heading.textContent=`采集 ${clockLabel(frame.captureSeconds)}${frame.playerSeconds==null?'':' / 课程 '+clockLabel(frame.playerSeconds)} · ${frame.state}`;const img=document.createElement('img');img.loading='lazy';img.alt='实际采集的课件/视频画面';img.src=`/api/classroom/watch/frame?id=${id}&index=${frame.index}`;box.append(heading,img);if(frame.analysis){const body=document.createElement('div');body.innerHTML=markdown(`**可见文字**\n\n${frame.onScreenText||''}\n\n**字幕取样**\n\n${frame.visibleCaptions||''}\n\n${frame.analysis}`);box.append(body);}$('frames').append(box);}
 frameOffset=watch.nextOffset;$('more').hidden=!watch.hasMore;$('report').href='/api/classroom/report?id='+id;$('report').hidden=!(watch.completedFrames||job.completedChunks||watch.captions.length);$('report').download='chrome-classroom-report.md';
}
function drawCrop(){const r=$('selection');r.hidden=crop.w===1&&crop.h===1;r.style.left=crop.x*100+'%';r.style.top=crop.y*100+'%';r.style.width=crop.w*100+'%';r.style.height=crop.h*100+'%';}
$('video').addEventListener('pointerdown',e=>{if(!running)return;const r=$('video').getBoundingClientRect();drag={x:(e.clientX-r.left)/r.width,y:(e.clientY-r.top)/r.height};$('video').setPointerCapture(e.pointerId);});
$('video').addEventListener('pointerup',e=>{if(!drag)return;const r=$('video').getBoundingClientRect(),x=(e.clientX-r.left)/r.width,y=(e.clientY-r.top)/r.height;if(Math.abs(x-drag.x)>.03&&Math.abs(y-drag.y)>.03)crop={x:Math.min(x,drag.x),y:Math.min(y,drag.y),w:Math.abs(x-drag.x),h:Math.abs(y-drag.y)};drag=null;lastFingerprint=null;drawCrop();});
$('resetCrop').onclick=()=>{crop={x:0,y:0,w:1,h:1};lastFingerprint=null;drawCrop();};$('start').onclick=()=>start().catch(error);$('stop').onclick=()=>stop().catch(error);$('snapshot').onclick=()=>saveTask(snapshot(true));$('newPair').onclick=()=>newPair().catch(error);$('copyPair').onclick=()=>navigator.clipboard.writeText($('pair').value).catch(error);
$('calibrate').onclick=()=>rpc('watch_event',{id:jobId,capturedAt:Date.now(),playerTime:Number($('playerTime').value),playbackRate:Number($('rate').value),paused:$('paused').checked,kind:'manual'}).catch(error);
$('jobs').onchange=()=>show($('jobs').value).catch(error);$('refresh').onclick=()=>refresh().then(()=>show($('jobs').value)).catch(error);$('resume').onclick=()=>selected&&rpc('resume',{id:selected}).then(()=>show(selected)).catch(error);$('more').onclick=()=>show(selected,true).catch(error);
$('enhance').onclick=async()=>{try{if(!selected)throw Error('请选择已结束的采集记录');$('enhance').disabled=true;const materials=[];for(const file of $('materials').files){const path=await upload(file,file.name);materials.push({kind:file.type.startsWith('video/')?'video':'document',path});}const child=await rpc('enhance',{id:selected,materials});$('notice').textContent='增强版已创建：'+child.title+'。在课堂纪要页面查看进度与结果。';}catch(e){error(e);}finally{$('enhance').disabled=false;}};
window.addEventListener('beforeunload',e=>{if(running){e.preventDefault();e.returnValue='';}});
async function tick(){try{await pump();if(selected)await show(selected);await refresh();}catch(e){error(e);}finally{setTimeout(tick,5000);}}
rpc('status').then(s=>{$('notice').textContent=s.modelsReady?'本地语音模型已就绪，可选择 Chrome 视频。':'语音模型未就绪；画面可分析，转写需先准备模型。';return refresh();}).then(()=>show($('jobs').value)).catch(error).finally(()=>setTimeout(tick,5000));
