// Optional stdio adapter for older MCP servers that ignore resource discovery.
// The upstream server and its data are left untouched.
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
const [command,...args]=process.argv.slice(2);
if(!command){console.error('Usage: node mcp-guard.mjs <server command> [arguments]');process.exit(2);}
const child=spawn(command,args,{stdio:['pipe','pipe','inherit'],windowsHide:true});
const pending=new Map();
const send=value=>process.stdout.write(JSON.stringify(value)+'\n');
const error=(id,message,code=-32603)=>send({jsonrpc:'2.0',id,error:{code,message}});
createInterface({input:process.stdin}).on('line',line=>{
 let request;try{request=JSON.parse(line);}catch{error(null,'Invalid JSON',-32700);return;}
 if(request.method==='resources/list'){send({jsonrpc:'2.0',id:request.id,result:{resources:[]}});return;}
 if(request.method==='resources/templates/list'){send({jsonrpc:'2.0',id:request.id,result:{resourceTemplates:[]}});return;}
 if(request.id!==undefined){
  const timeout=request.method==='tools/call'?300000:30000;
  pending.set(request.id,setTimeout(()=>{pending.delete(request.id);error(request.id,'Upstream MCP request timed out');},timeout));
 }
 if(child.stdin.writable)child.stdin.write(line+'\n');
 else if(request.id!==undefined)error(request.id,'Upstream MCP server is unavailable');
}).on('close',()=>{child.stdin.end();child.kill();});
createInterface({input:child.stdout}).on('line',line=>{
 let response;try{response=JSON.parse(line);}catch{console.error('Ignored non-JSON upstream stdout');return;}
 if(response.id!==undefined){clearTimeout(pending.get(response.id));pending.delete(response.id);}
 send(response);
});
const failed=message=>{for(const[id,timer]of pending){clearTimeout(timer);error(id,message);}pending.clear();};
child.on('error',err=>{failed('Cannot start MCP server: '+err.message);process.exitCode=1;});
child.on('exit',code=>{failed('Upstream MCP server exited');process.exit(code??1);});
