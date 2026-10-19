export function classroomNotifier(controller,createMessage){
 return async(id,key,text)=>{
  const prior=await controller.inspect(id);
  if(prior.events.some(event=>event.type==='user/message'&&event.data.source?.summary===key))return;
  const result=await controller.resolveAgent(id);
  if(result.error)throw result.error;
  if(!result.agent?.session)throw Error('当前对话不可写入，结果已经保留，稍后重试通知');
  result.agent.session.append('user/message',createMessage({content:[{type:'text',text}],source:{kind:'classroom',form:'notice',summary:key}}),{surfaceOp:'append'});
 };
}
