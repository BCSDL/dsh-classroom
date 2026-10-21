import {randomUUID} from 'node:crypto';

// Coordinate DSH inference through public events; never patch the host loop.
// Original audio capture continues while GPU transcription waits for a chat.
export function installChatCoordination(ctx,worker,enabled=true){
 const active=new Set(),leases=new Map();let lastActivity=Date.now(),lastRelease=0,warned=false;
 const release=agent=>{const lease=leases.get(agent);if(!lease)return;leases.delete(agent);lastRelease=Date.now();void worker.call('chat_end',{token:lease.token}).catch(()=>{});};
 ctx.on('agent/pre-step',async(payload,next)=>{
  active.add(payload.agent);lastActivity=Date.now();
  if(enabled){
   // Let a queued short audio step run between tool/inference steps.
   if(Date.now()-lastRelease<200)await new Promise(resolve=>setTimeout(resolve,200));
   const lease={token:randomUUID()};leases.set(payload.agent,lease);const started=Date.now();
   try{while(true){payload.signal?.throwIfAborted();const state=await worker.call('chat_begin',{token:lease.token});if(state.ready)break;if(Date.now()-started>180000)throw Error('课堂推理尚未结束，请稍后重试；原始资料已保留');await new Promise(resolve=>setTimeout(resolve,500));}}
   catch(error){release(payload.agent);if(payload.signal?.aborted||worker.child){active.delete(payload.agent);throw error;}if(!warned){console.error('classroom chat GPU coordination unavailable (no running worker):',error.message);warned=true;}}
  }
  try{const decision=await next();if(decision.kind!=='enter'){release(payload.agent);active.delete(payload.agent);}return decision;}
  catch(error){release(payload.agent);active.delete(payload.agent);throw error;}
 });
 ctx.on('session/event',(session,event)=>{
  if(!['assistant/message','assistant/attempt','step/end','turn/end'].includes(event.type))return;
  for(const agent of active)if(agent?.session===session){release(agent);if(event.type==='turn/end')active.delete(agent);}
 });
 ctx.on('agent/turn-stopping',({agent})=>{release(agent);active.delete(agent);lastActivity=Date.now();});
 const timer=setInterval(()=>{for(const lease of leases.values())void worker.call('chat_begin',{token:lease.token}).catch(()=>{});},30000);timer.unref?.();
 ctx.on('dispose',()=>{clearInterval(timer);leases.clear();active.clear();});
 return {get busy(){return active.size>0;},get lastActivity(){return lastActivity;}};
}
