import test from 'node:test';
import assert from 'node:assert/strict';
import {applyToolDiscipline,registerDocumentTools,currentFiles,missingEvidence} from '../lib/tool-discipline.js';

function harness(){
 const handlers={},definitions=new Map(),calls=[],steering=[];
 const agent={session:{header:{cwd:process.cwd()},snapshotEvents:()=>[]},steer:m=>steering.push(m)};
 const ctx={effect(fn){return fn();},on(name,fn){handlers[name]=fn;},systemPrompt:{section(){}},get(){return {fileHostPath:()=>'/fixture.pdf',async *readFileStream(){yield new Uint8Array([1]);}}},tools:{register(d){definitions.set(d.name,d);return ()=>{};},schemas(){return [...definitions.values()].map(({name,description,parameters})=>({name,description,parameters}));},async execute(exec){calls.push(exec);let result;
  try{const d=definitions.get(exec.name);if(!d)throw Error('Unknown tool');const value=await d.execute(exec.arguments,exec);result={isError:false,content:d.output.render(exec.arguments,value)};}catch(error){result={isError:true,content:[{type:'text',text:error.message}]};}
  handlers['tools/result']?.(exec,result);return result;
 }}};
 return {ctx,handlers,agent,calls,steering};
}
const signal=()=>new AbortController().signal;
const user=content=>({source:{kind:'user'},content});
test('native attachments are read before first inference and exposed as durable evidence',async()=>{
 const h=harness();let reads=0;
 registerDocumentTools(h.ctx,{async call(op,args){reads++;assert.equal(op,'document');assert.equal(args.path,'/fixture.pdf');return {pages:[{page:1,text:'Verified calculus lesson'}],truncated:false};}});
 applyToolDiscipline(h.ctx,{maxEvidenceRetries:2});
 const messages=[user([{type:'file',attachment:{name:'lesson.pdf',attachmentId:'abc',bytes:1}}])];
 const result=await h.handlers['agent/pre-step']({agent:h.agent,messages,turn:1,signal:signal()},async()=>({kind:'enter',messages}));
 assert.equal(reads,1);assert.deepEqual(h.calls.map(c=>c.name),['tool_context','read_document']);
 assert.ok(result.messages.some(m=>JSON.stringify(m).includes('Verified calculus lesson')));
 assert.equal(currentFiles(h.agent)[0].name,'lesson.pdf');
 await h.handlers['agent/turn-stopping']({agent:h.agent,turn:1,signal:signal()});assert.equal(h.steering.length,0);
});
test('failed tools remain errors and evidence retries are bounded',async()=>{
 const h=harness();registerDocumentTools(h.ctx,{async call(){throw Error('corrupt PDF');}});applyToolDiscipline(h.ctx,{maxEvidenceRetries:2});
 const messages=[user([{type:'file',attachment:{name:'bad.pdf',attachmentId:'abc',bytes:1}}])];
 const result=await h.handlers['agent/pre-step']({agent:h.agent,messages,turn:1,signal:signal()},async()=>({kind:'enter',messages}));
 assert.ok(result.messages.some(m=>JSON.stringify(m).includes('isError=true')));
 for(let i=0;i<5;i++)await h.handlers['agent/turn-stopping']({agent:h.agent,turn:1,signal:signal()});
 assert.equal(h.steering.length,2);
});
test('a new attachment-free turn cannot reuse stale uploads',async()=>{
 const h=harness();applyToolDiscipline(h.ctx,{maxEvidenceRetries:2});
 for(const [turn,content]of [[1,[{type:'file',attachment:{name:'old.pdf'}}]],[2,[{type:'text',text:'你好'}]]]){
  const messages=[user(content)];await h.handlers['agent/pre-step']({agent:h.agent,messages,turn,signal:signal()},async()=>({kind:'enter',messages}));
 }
 assert.deepEqual(currentFiles(h.agent),[]);assert.equal(h.calls.filter(c=>c.name==='tool_context').length,2);
});
test('write results invalidate evidence until the same file is reread; failures do not verify edits',async()=>{
 const h=harness();applyToolDiscipline(h.ctx,{maxEvidenceRetries:2});const messages=[user([{type:'text',text:'修改代码'}])];
 await h.handlers['agent/pre-step']({agent:h.agent,messages,turn:1,signal:signal()},async()=>({kind:'enter',messages}));
 const emit=(name,isError=false)=>h.handlers['tools/result']({agent:h.agent,name,arguments:{file_path:'main.py'}},{isError,content:[{type:'text',text:'result'}]});
 emit('write');emit('read',true);await h.handlers['agent/turn-stopping']({agent:h.agent,turn:1,signal:signal()});assert.equal(h.steering.length,1);
 emit('read');await h.handlers['agent/turn-stopping']({agent:h.agent,turn:1,signal:signal()});assert.equal(h.steering.length,1);
});
test('missing source checks do not confuse an environment probe with web evidence',()=>{
 assert.match(missingEvidence({needsWeb:true,web:false,failures:0,successes:0,dirty:new Set()}),/联网/);
 assert.equal(missingEvidence({needsWeb:true,web:true,failures:0,successes:1,dirty:new Set()}),'');
 assert.match(missingEvidence({needsTaskEvidence:true,successes:0,failures:0,dirty:new Set()}),/任务工具/);
});
test('failed calls receive current tool schema without changing their error outcome',async()=>{
 const h=harness();applyToolDiscipline(h.ctx,{maxEvidenceRetries:2});
 const result=await h.handlers['tools/post-execute']({agent:h.agent,name:'tool_context',signal:signal()},{isError:true},async()=>({kind:'accept'}));
 assert.equal(result.kind,'accept');assert.ok(JSON.stringify(result.additionalContexts).includes('tool_context'));
 const help=h.calls.length;const schema=await h.ctx.tools.execute({agent:h.agent,name:'tool_help',arguments:{name:'tool_context'},signal:signal()});
 assert.equal(schema.isError,false);assert.ok(schema.content[0].text.includes('parameters'));assert.equal(h.calls.length,help+1);
});
