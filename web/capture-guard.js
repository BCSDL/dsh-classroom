// Keep collection visible and persistent; never claim a browser tab survives closing.
export function captureGuard(notice){
 let active=false,lock=null,last=performance.now(),timer=null;
 const acquire=async()=>{if(active&&document.visibilityState==='visible')try{lock=await navigator.wakeLock?.request('screen');}catch{}};
 document.addEventListener('visibilitychange',()=>{if(active){acquire();if(document.hidden)notice('录音页已在后台；浏览器或系统休眠仍可能中断采集。音频块会保存在本地等待提交。');}});
 window.addEventListener('offline',()=>{if(active)notice('网络连接中断，继续保存本地音频队列，恢复后重试提交。');});
 return {async start(){active=true;await acquire();try{await navigator.storage?.persist?.();}catch{}last=performance.now();timer=setInterval(()=>{const now=performance.now();if(now-last>15000)notice('检测到采集页长时间暂停，可能发生休眠或后台节流，请检查录音连续性。');last=now;},5000);},async stop(){active=false;clearInterval(timer);await lock?.release().catch(()=>{});lock=null;}};
}
