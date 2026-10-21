import test from 'node:test';import assert from 'node:assert/strict';
import {installChatCoordination} from '../lib/chat-gpu.js';
test('chat reserves the classroom GPU before inference and releases on durable assistant settlement',async()=>{
 const handlers=new Map(),calls=[];const ctx={on(name,fn){handlers.set(name,fn);}};
 const worker={child:{},async call(operation,args){calls.push({operation,...args});return {ready:true};}};
 const session={},agent={session};const status=installChatCoordination(ctx,worker);
 try{await handlers.get('agent/pre-step')({agent,signal:new AbortController().signal},async()=>{assert.equal(calls[0].operation,'chat_begin');return {kind:'enter'};});assert.equal(status.busy,true);handlers.get('session/event')(session,{type:'assistant/message'});await Promise.resolve();assert.equal(calls.at(-1).operation,'chat_end');handlers.get('agent/turn-stopping')({agent});assert.equal(status.busy,false);}finally{handlers.get('dispose')();}
});
test('a missing optional worker does not break ordinary DSH chat, but a busy running worker failure blocks unsafe inference',async()=>{
 const setup=worker=>{const h=new Map();installChatCoordination({on:(name,fn)=>h.set(name,fn)},worker);return h;};
 const missing=setup({child:null,call:async()=>{throw Error('runtime unavailable');}});let entered=false;
 try{await missing.get('agent/pre-step')({agent:{},signal:new AbortController().signal},async()=>{entered=true;return {kind:'enter'};});assert.equal(entered,true);}finally{missing.get('dispose')();}
 const running=setup({child:{},call:async()=>{throw Error('cannot safely acquire');}});entered=false;
 try{await assert.rejects(running.get('agent/pre-step')({agent:{},signal:new AbortController().signal},async()=>{entered=true;return {kind:'enter'};}),/cannot safely acquire/);assert.equal(entered,false);}finally{running.get('dispose')();}
});
