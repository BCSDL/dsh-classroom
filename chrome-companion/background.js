function checkPair(pair){const u=new URL(pair.origin);if(u.protocol!=='http:'||!['127.0.0.1','localhost'].includes(u.hostname)||u.username||u.password||u.pathname!=='/'||u.search||u.hash||!/^[a-f0-9]{32}$/.test(pair.id)||!/^[a-f0-9]{64}$/.test(pair.token))throw Error('连接码必须指向本机 DSH，且包含有效的记录编号和临时配对码');return {...pair,origin:u.origin};}
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
 (async()=>{
  if(message.type==='connect'){
   if(sender.tab)throw Error('Only the extension popup may initiate pairing');
   const pair=checkPair(message.pair);const [tab]=await chrome.tabs.query({active:true,currentWindow:true});if(!tab?.id||!/^https?:/.test(tab.url||''))throw Error('请在正常的视频网页里打开助手');
   await chrome.storage.session.set({binding:{...pair,tabId:tab.id}});await chrome.scripting.executeScript({target:{tabId:tab.id},files:['content.js']});const probe=await chrome.tabs.sendMessage(tab.id,{type:'probe'});return {ok:true,message:probe.videoFound?'已连接当前播放器，开始同步字幕与进度。':'已连接，但尚未找到可读播放器。先播放视频；若是内嵌页面，请打开 Panopto 独立播放器标签页再连接。'};
  }
  if(message.type==='disconnect'){await chrome.storage.session.remove('binding');return {ok:true};}
  if(message.type==='clock'){
   const {binding}=await chrome.storage.session.get('binding');if(!binding||sender.tab?.id!==binding.tabId)return {connected:false};
   const input=message.value;const value={capturedAt:input.capturedAt,playerTime:input.playerTime,playbackRate:input.playbackRate,paused:input.paused,caption:String(input.caption||'').slice(0,4000),sourcePage:input.sourcePage,kind:input.kind};
   const response=await fetch(binding.origin+'/api/classroom/watch/event',{method:'POST',credentials:'omit',headers:{'content-type':'application/json','authorization':'Bearer '+binding.token},body:JSON.stringify(value)});
   if(!response.ok){if(response.status===403)await chrome.storage.session.remove('binding');throw Error('本地 DSH 已停止、采集已结束或配对过期，请重新连接');}return {ok:true};
  }
  throw Error('Unknown companion request');
 })().then(reply,e=>reply({error:e.message}));return true;
});
chrome.tabs.onRemoved.addListener(async tabId=>{const {binding}=await chrome.storage.session.get('binding');if(binding?.tabId===tabId)await chrome.storage.session.remove('binding');});
