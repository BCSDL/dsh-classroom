import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,relative} from 'node:path';
import vm from 'node:vm';
import {ClassroomProjects} from '../lib/projects.js';
import {classroomNotifier} from '../lib/notifications.js';

async function fixture(t){
 const base=await fs.mkdtemp(join(tmpdir(),'classroom-project-test-'));t.after(async()=>{const real=resolve(base),part=relative(resolve(tmpdir()),real);assert(part&&!part.startsWith('..'));await fs.rm(real,{recursive:true,force:true});});
 const a=join(base,'project-a'),b=join(base,'project-b'),data=join(base,'cache');await fs.mkdir(a);await fs.mkdir(b);const jobs=new Map(),notices=[];let sequence=0;
 const worker={async call(operation,args={}){
  if(['start_file','create_live','create_watch','enhance'].includes(operation)){const id=(++sequence).toString(16).padStart(32,'0'),job={id,title:args.title||'Kinetic energy',kind:operation==='start_file'?'file':'live',state:'queued',created:Date.now()/1000,source:args.path,results:[{segments:[{start:1,end:4,speaker:'Speaker 1',text:'kinetic energy formula'}]}]};jobs.set(id,job);return structuredClone(job);}
  if(operation==='list')return [...jobs.values()].map(value=>structuredClone(value));
  if(operation==='get')return {...structuredClone(jobs.get(args.id)),hasMore:false,nextOffset:1};
  if(operation==='status')return {modelsReady:true};
  throw Error('Unexpected '+operation);
 }};
 const service=new ClassroomProjects({worker,dataDirectory:data,session:async id=>{if(id==='missing')throw Error('Missing Session');return {cwd:id==='b'?b:a};},notify:async(...args)=>notices.push(args)});await service.ready;
 async function complete(id){const j=jobs.get(id);j.state='complete';j.summary='动能 kinetic energy';const src=join(data,'jobs',id);await fs.mkdir(join(src,'frames'),{recursive:true});await fs.writeFile(join(src,'report.md'),'# Kinetic energy\nE = 0.5 m v²');await fs.writeFile(join(src,'transcript.srt'),'1\n00:00:01,000 --> 00:00:04,000\nkinetic energy');await fs.writeFile(join(src,'frames','0001.jpg'),'fixture');}
 return {base,a,b,data,jobs,notices,worker,service,complete};
}
test('workspace-relative sources bind to originating session and produce searchable project artifacts',async t=>{
 const f=await fixture(t);const job=await f.service.run('start_file',{path:'lecture.m4a',title:'../Energy: lesson'},'a');assert.equal(f.jobs.get(job.id).source,join(f.a,'lecture.m4a'));assert.equal(job.project.sessionId,'a');
 await f.complete(job.id);await f.service.tick();await f.service.tick();const binding=f.service.rows[job.id];assert(binding.notified);assert((await fs.readFile(join(binding.archiveDirectory,'逐字稿.md'),'utf8')).includes('kinetic energy'));assert.equal(await fs.readFile(join(binding.archiveDirectory,'画面证据','0001.jpg'),'utf8'),'fixture');assert.equal(f.notices.length,2);assert.equal(f.notices[1][0],'a');
 assert.equal((await f.service.run('search',{query:'v²'},'a')).results.length,1);assert.equal((await f.service.run('search',{query:'energy'},'b')).results.length,0);assert.equal((await f.service.run('list',{},'a')).length,1);await assert.rejects(f.service.run('get',{id:job.id},'b'),/不属于/);
});
test('bindings survive restart without reposting an already completed notice',async t=>{const f=await fixture(t);const job=await f.service.run('start_file',{path:'x'},'a');await f.complete(job.id);await f.service.tick();const reopened=new ClassroomProjects({worker:f.worker,dataDirectory:f.data,session:async()=>({cwd:f.a}),notify:()=>{throw Error('duplicate notification');}});await reopened.ready;await reopened.tick();assert.equal(reopened.rows[job.id].notified,true);});
test('artifact reads are bounded to named files in the owning project',async t=>{const f=await fixture(t);const job=await f.service.run('start_file',{path:'x'},'a');await f.complete(job.id);await f.service.tick();assert((await f.service.artifact(job.id,'a','纪要.md')).toString().includes('Kinetic'));await assert.rejects(f.service.artifact(job.id,'b','纪要.md'),/不属于/);await assert.rejects(f.service.artifact(job.id,'a','../private'),/无效/);});
test('archive failures retain source results and can be retried',async t=>{const f=await fixture(t);const job=await f.service.run('start_file',{path:'x'},'a');await f.complete(job.id);const binding=f.service.rows[job.id];await fs.rm(join(f.a,'课堂记录',binding.folder),{recursive:true});await fs.writeFile(join(f.a,'课堂记录',binding.folder),'blocked');await f.service.tick();assert(binding.archiveError);assert(!binding.notified);assert.equal(f.jobs.get(job.id).state,'complete');await fs.unlink(join(f.a,'课堂记录',binding.folder));await f.service.tick();assert(binding.notified);});
test('an external directory junction is rejected before an inference task is created',async t=>{const f=await fixture(t);await fs.symlink(f.b,join(f.a,'课堂记录'),'junction');await assert.rejects(f.service.run('start_file',{path:'x'},'a'),/项目外部/);assert.equal(f.jobs.size,0);});
test('conversation open requests do not invoke microphone or inference automatically',async t=>{const f=await fixture(t);const result=await f.service.run('open',{mode:'watch'},'a');assert.equal(result.openRequested.mode,'watch');assert.equal(f.jobs.size,0);assert.equal((await f.service.info('a')).openRequested.id,result.openRequested.id);await assert.rejects(f.service.info('missing'),/Missing/);});
test('browser plugin uses the session slot injection seam',async()=>{
 let module;const registrations=[];vm.runInNewContext(await fs.readFile(new URL('../lib/client.js',import.meta.url),'utf8'),{window:{__ModuleLoader__:{load:value=>module=value}}});const exported=module.factory(()=>({}));exported.apply({slots:{inject:(_name,fn)=>fn(),register:entry=>registrations.push(entry)},on(){}});assert.equal(registrations[0].name,'conversation.input.left');assert.equal(registrations[0].inject('session-a').sessionId,'session-a');assert.equal(registrations[1].name,'conversation.input.dock');assert.equal(module.id,'dsh-classroom');
});
test('notification adapter handles the actual controller result and deduplicates persisted notices',async()=>{
 const events=[],calls=[];const controller={inspect:async()=>({events}),resolveAgent:async()=>({agent:{session:{append:(type,data,intent)=>{events.push({type,data});calls.push(intent);}}}})};
 const notify=classroomNotifier(controller,value=>value);await notify('a','key','Ready');await notify('a','key','Duplicate');assert.equal(events.length,1);assert.equal(events[0].data.content[0].text,'Ready');assert.deepEqual(calls[0],{surfaceOp:'append'});
 await assert.rejects(classroomNotifier({...controller,resolveAgent:async()=>({error:Error('Writer unavailable')})},value=>value)('a','different-key','text'),/Writer unavailable/);
});
