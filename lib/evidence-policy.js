export const unstableMemory=/(?:最近.{0,12}(?:月|照片)|last month|no photos|latest.*(?:file|photo)|(?:tool|read_document).{0,35}(?:fails|unavailable|sandbox error)|cannot get property|文件夹.{0,24}(?:没有|最新|最早)|当前时间)/i;
export function sanitizeMemory(messages){
 let removed=0;
 const clean=text=>text.split('\n').filter(line=>{if(unstableMemory.test(line)){removed++;return false;}return true;}).join('\n')+'\n[记忆时效检查] 文件列表、日期范围和工具故障不是永久事实；当前时间、当前工具 schema 和本轮实际结果优先。';
 const cleaned=messages.map(message=>{
  if(!['runtime-context','dsh-memory','memory'].includes(message.source?.kind))return message;
  const replacements=[];
  const sections=message.source.sections?.map(section=>{if(section.name!=='dsh-memory')return section;const text=clean(section.text);replacements.push([section.text,text]);return {...section,text};});
  return {...message,source:{...message.source,...sections?{sections}:{}},content:message.content.map(part=>{
   if(part.type!=='text'||!part.text.includes('# DSH memory'))return part;
   if(replacements.length){let text=part.text;for(const[before,after]of replacements)text=text.replace(before,after);return {...part,text};}
   const split=part.text.indexOf('# DSH memory');return {...part,text:part.text.slice(0,split)+clean(part.text.slice(split))};
  })};
 });return {messages:cleaned,removed};
}
export function responseData(result){
 for(const part of result.content||[])if(part.type==='text')try{const data=JSON.parse(part.text);return data;}catch{}
 return null;
}
export function photoSignature(args){
 const ordered=value=>Array.isArray(value)?value.map(ordered):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,ordered(value[key])])):value;
 return JSON.stringify(ordered(args));
}
export function repeatedPhotoCall(state,args){
 if((state?.photoCalls?.get(photoSignature(args))||0)<2)return '';
 const next={scan:'已有清单，继续 sheet 看图。',list:'清单已经返回，继续 sheet 或 inspect 实际图片。',sheet:'图片已交付，继续 review 保存评语。',inspect:'图片已交付，继续 review 保存评语。',review:'评分已保存，调用 result 取报告并回答。',result:'报告已返回，根据已有报告回答并说明覆盖范围。'};
 return '同一图片工具参数已经成功执行两次，停止无意义重复。'+(next[args.operation]||'按已有结果继续。');
}
export function observeEvidence(state,exec,result){
 if(result.isError)return;
 const value=responseData(result),text=(result.content||[]).filter(p=>p.type==='text').map(p=>p.text).join('\n');
 if(exec.name==='photo_catalog'&&value){
  state.photoCalls||=new Map();const signature=photoSignature(exec.arguments);state.photoCalls.set(signature,(state.photoCalls.get(signature)||0)+1);
  if(exec.arguments.operation==='scan')state.photo=value;
  if(value.imagesReturned)state.visualImages=(state.visualImages||0)+value.items.length;
  if(['review','result'].includes(exec.arguments.operation))state.photoResult=value;
  if(value.complete)state.directoryComplete=true;
 }
 if(result.content?.some(c=>c.type==='image'))state.visualImages=(state.visualImages||0)+(exec.name==='photo_catalog'?0:result.content.filter(c=>c.type==='image').length);
 if(value?.truncated===true||value?.textTruncated===true||/\.\.\.\s*\(truncated|truncated,\s*\d+\+?\s*items/i.test(text))state.incomplete=true;
 if(exec.name==='read_document'&&value?.path){
  state.documentReads||=new Map();const ranges=state.documentReads.get(value.path)||[];
  ranges.push({start:value.offset||0,end:(value.offset||0)+(value.pages?.length||0),last:!value.truncated&&!value.textTruncated});state.documentReads.set(value.path,ranges);
 }
}
export function semanticProblem(state,answer=''){
 const currentYear=String(state.currentYear||new Date().getFullYear());
 const year=/(?:当前|现在|今天)(?:[^。\n]{0,18}?)(20\d{2})\s*年/.exec(answer);
 if(year&&year[1]!==currentYear)return '当前年份与本轮 tool_context 不一致。读取真实时间，用程序计算日期窗口，不得用文件名年份充当现在。';
 const absentYear=/(?:没有|不存在)[^。\n]{0,10}(20\d{2})年[^。\n]{0,8}(?:照片|图片)/.exec(answer)?.[1];
 const incorrectNone=state.photo?.complete&&((absentYear&&(state.photo.byYear?.[absentYear]||0)>0)||(state.needsPhotos&&state.photo.selectedCount>0&&/完全没有|没有任何.{0,12}(?:照片|图片)/.test(answer)));
 if(incorrectNone&&!/错误|不正确|说错|有误|并非没有|不是没有/.test(answer))return '当前完整清单存在符合条件/该年份的图片，答复却宣称没有。以清单 selectedCount、byYear、window 和日期来源为准。';
 if(state.needsPhotos){
  if(!state.photo)return '图片目录尚无完整清单。调用 photo_catalog scan，不能只凭被截断的目录列表判断全目录。';
  if(!state.photo.complete)return '图片目录枚举存在错误，不能声称已检查全部。修复具体错误或明确说明不完整。';
  if(state.photo.selectedCount===0)return '';
  if(!state.visualImages)return '尚未实际交付任何图片给模型。调用 photo_catalog sheet/inspect 看图；文件名、字节大小或清单不能评价画面。';
  if(!state.photoResult||!state.photoResult.reviewed)return '看图后需 photo_catalog review 保存可见内容评语，再 result 获取评分依据与覆盖范围，不得只口头声称评选完成。';
  if(!state.photoResult.eligibleForCompleteSelection&&!/候选|暂定|部分|未(?:能|完成|看完|审阅|覆盖)|尚未|已(?:看过|审阅|查看|检查)的|未审阅/.test(answer))return '并未审阅完当前筛选范围。使用 result.selectionLabel 和覆盖数字，明确是已审阅候选中的推荐，不得说全目录最佳。';
 }
 if(state.needsVisual&&!state.needsPhotos&&!state.visualImages)return '尚未读取用户请求评价的实际图片。使用 read_document({path/attachment,images:true})，不能仅凭文件名判断或拒绝评图。';
 if(state.incomplete&&!state.directoryComplete&&(state.needsFull||/全部.{0,8}(?:看|读|查)|完整.{0,8}(?:看|读|查)|完全没有|没有任何|最晚只|全部文件|所有文件都/.test(answer))){
  const reads=[...(state.documentReads?.values()||[])];
  const complete=reads.length&&reads.every(ranges=>{let end=0,last=false;for(const r of ranges.sort((a,b)=>a.start-b.start)){if(r.start>end)return false;end=Math.max(end,r.end);last||=r.last;}return last;});
  if(!complete)return '工具结果明确截断，尚无完整覆盖证据。继续分页/完整枚举，或明确限制结论范围；不得把当前页当作全部。';
 }
 return '';
}
