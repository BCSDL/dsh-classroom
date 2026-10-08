import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {WorkerClient} from '../lib/worker-client.js';
test('missing runtime returns an actionable error without crashing the host',async()=>{
 const worker=new WorkerClient({pythonExecutable:'does-not-exist-classroom-executable'},'worker.py');
 await assert.rejects(worker.call('status'),/运行时|spawn|ENOENT/);worker.close();
});
test('worker routes simultaneous responses to their callers',async()=>{
 const root=await mkdtemp(join(tmpdir(),'classroom-test-'));const path=join(root,'worker.mjs');
 await writeFile(path,"import {createInterface} from 'node:readline';createInterface({input:process.stdin}).on('line',line=>{let q=JSON.parse(line);console.log(JSON.stringify({id:q.id,result:q.operation}));});");
 const worker=new WorkerClient({pythonExecutable:process.execPath},path);
 try{assert.deepEqual(await Promise.all([worker.call('first'),worker.call('second')]),['first','second']);}
 finally{worker.close();await rm(root,{recursive:true,force:true});}
});
