import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {randomUUID} from 'node:crypto';
export class WorkerClient {
  constructor(config, script) { this.config=config; this.script=script; this.pending=new Map(); }
  start() {
    if(this.child) return;
    const child=spawn(this.config.pythonExecutable,[this.script],{windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,PYTHONUTF8:'1',DSH_CLASSROOM_CONFIG:JSON.stringify(this.config)}});
    this.child=child;
    let diagnostic='';
    child.stderr.on('data',chunk=>{diagnostic=(diagnostic+chunk.toString()).slice(-4000);});
    createInterface({input:child.stdout}).on('line',line=>{
      try{const data=JSON.parse(line);const waiter=this.pending.get(data.id);if(!waiter)return;this.pending.delete(data.id);clearTimeout(waiter.timer);data.error?waiter.reject(new Error(data.error)):waiter.resolve(data.result);}
      catch{/* Libraries occasionally print to stdout; ignore nonprotocol lines. */}
    });
    const fail=error=>{if(this.child!==child)return;this.child=null;for(const waiter of this.pending.values()){clearTimeout(waiter.timer);waiter.reject(error);}this.pending.clear();};
    child.on('error',error=>fail(new Error('语音运行时不可用，请运行 scripts/setup.ps1。'+error.message)));
    child.on('exit',code=>fail(new Error(`语音运行时已退出 (${code})。${diagnostic}`)));
  }
  async call(operation,args={}) {
    this.start();
    const id=randomUUID();
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('请求超时；已保存的后台任务可继续查询。'));},120000);
      this.pending.set(id,{resolve,reject,timer});
      this.child.stdin.write(JSON.stringify({id,operation,args})+'\n',error=>{if(error){clearTimeout(timer);this.pending.delete(id);reject(error);}});
    });
  }
  close() {this.child?.kill();}
}
