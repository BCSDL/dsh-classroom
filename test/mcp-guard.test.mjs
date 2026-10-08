import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {fileURLToPath} from 'node:url';
test('resource discovery responds even when upstream ignores it, while tools pass through',async()=>{
 const code="require('readline').createInterface({input:process.stdin}).on('line',l=>{let q=JSON.parse(l);if(q.method==='tools/list')console.log(JSON.stringify({jsonrpc:'2.0',id:q.id,result:{tools:[{name:'fixture',inputSchema:{type:'object'}}]}}));});";
 const proc=spawn(process.execPath,[fileURLToPath(new URL('../scripts/mcp-guard.mjs',import.meta.url)),process.execPath,'-e',code],{stdio:['pipe','pipe','pipe']});
 const received=new Map();const done=new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error('Protocol discovery hung')),3000);
  createInterface({input:proc.stdout}).on('line',l=>{let value=JSON.parse(l);received.set(value.id,value);if(received.size===3){clearTimeout(timer);resolve();}});
 });
 try{for(const[id,method]of[[1,'resources/list'],[2,'resources/templates/list'],[3,'tools/list']])proc.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method})+'\n');await done;assert.deepEqual(received.get(1).result,{resources:[]});assert.deepEqual(received.get(2).result,{resourceTemplates:[]});assert.equal(received.get(3).result.tools[0].name,'fixture');}
 finally{proc.stdin.end();proc.kill();}
});
