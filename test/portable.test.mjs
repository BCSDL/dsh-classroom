import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ClassroomKnowledge} from '../lib/knowledge.js';

test('portable merge preserves versions, trash and originals without duplicating repeated restores',async t=>{
 const root=await fs.mkdtemp(join(tmpdir(),'classroom-portable-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const embedder={call:async(_,{texts})=>({vectors:texts.map(()=>[1,0])}),close(){}};
 const source=new ClassroomKnowledge({dataDirectory:join(root,'source')},{embedder}),target=new ClassroomKnowledge({dataDirectory:join(root,'target')},{embedder});await Promise.all([source.ready,target.ready]);
 const context={projectDirectory:join(root,'project')},note=await source.addNote(context,{title:'Versions',text:'Original energy notes'}),deleted=await source.addNote(context,{title:'Discarded',text:'Deleted notes'});
 await source.editNote(context,{id:note.id,text:'Revised energy notes'});
 await source.manage(context,{ids:[deleted.id],action:'trash',confirm:'移入笔记回收区'});
 const original=join(root,'lesson.pdf');await fs.writeFile(original,'%PDF-original');await source.preserve(original);
 const staging=join(root,'target/restore-staging/fixture');await fs.cp(source.root,staging,{recursive:true});
 const first=await target.mergeBackup(context,staging);assert.equal(first.imported,2);assert.equal(first.trashed,1);assert.ok(first.histories>=1);
 const restored=first.idMap[note.id],history=await target.noteVersion(context,{id:restored});
 await target.noteVersion(context,{id:restored,version:history.versions.find(x=>x.startsWith('imported-'))});
 assert.equal((await target.read(context,{id:restored,full:true})).content,'Original energy notes');
 const again=await target.mergeBackup(context,staging);assert.equal(again.idMap[note.id],restored);assert.equal((await target.list(context)).total,1);
 await target.manage(context,{ids:[first.idMap[deleted.id]],action:'restore',confirm:'恢复知识笔记'});assert.equal((await target.list(context)).total,2);
 await assert.rejects(target.manage({projectDirectory:'elsewhere'},{ids:[restored],action:'trash',confirm:'移入笔记回收区'}),/当前项目/);
});
