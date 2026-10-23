import test from 'node:test';
import assert from 'node:assert/strict';
import {dateWindow,photoRequest,registerPhotoTools} from '../lib/photo-tools.js';
import {sanitizeMemory,observeEvidence,semanticProblem,repeatedPhotoCall} from '../lib/evidence-policy.js';

test('month windows clamp calendar days and distinguish previous month from trailing month',()=>{
 assert.equal(dateWindow('recent_month',new Date('2026-03-31T12:00:00Z')).start,'2026-02-28');
 assert.equal(dateWindow('recent_month',new Date('2024-03-31T12:00:00Z')).start,'2024-02-29');
 assert.equal(dateWindow('previous_month',new Date('2026-10-23T01:00:00Z')).end,'2026-09-30');
 assert.equal(dateWindow('recent_month',new Date('2026-10-23T01:00:00Z')).end,'2026-10-23');
 assert.equal(dateWindow('recent_month',new Date('2026-10-22T23:30:00Z'),'Europe/London').end,'2026-10-23');
});
test('actual user Windows path survives spaces and Chinese instruction suffix',()=>{
 assert.deepEqual(photoRequest('在D:\\ZenlessZoneZero Game\\ScreenShot中寻找最佳照片，还有最近1个月拍的最佳照片'),{path:'D:\\ZenlessZoneZero Game\\ScreenShot',window:'recent_month'});
 assert.equal(photoRequest('查看 "C:\\我的照片\\集合" 上个月最佳照片').window,'previous_month');
});
test('truncated directory results cannot support exhaustive negative claims',()=>{
 const state={};observeEvidence(state,{name:'mcp__windows__FileSystem',arguments:{mode:'list'}},{content:[{type:'text',text:'Directory: D:\\Photos\n... (truncated, 500+ items)'}]});
 assert.match(semanticProblem(state,'完全没有2026年的照片'),/截断/);
 assert.equal(semanticProblem(state,'当前页只列出部分文件，尚未检查全部目录。'),'');
});
test('photos require full inventory, delivered pixels, persisted reviews and qualified coverage',()=>{
 const state={needsPhotos:true};assert.match(semanticProblem(state,'完成'),/完整清单/);
 state.photo={complete:true,selectedCount:131};assert.match(semanticProblem(state,'没有任何2026年的照片'),/存在/);
 assert.match(semanticProblem(state,'无法判断最佳照片'),/尚未实际/);state.visualImages=12;
 assert.match(semanticProblem(state,'最佳是第一张'),/review/);state.photoResult={reviewed:12,eligibleForCompleteSelection:false};
 assert.match(semanticProblem(state,'已评选出整个文件夹最佳照片'),/未审阅完/);
 assert.equal(semanticProblem(state,'以下是已审阅候选中的暂定推荐，尚未覆盖所有131张。'),'');
 state.photoResult.eligibleForCompleteSelection=true;assert.equal(semanticProblem(state,'本次范围内的最佳候选'),'');
});
test('memory filtering removes transient assertions but preserves preferences and user text',()=>{
 const text='# DSH memory\n- User prefers Chinese.\n- read_document fails with a sandbox error.\n- no photos from the last month are present.';
 const result=sanitizeMemory([{source:{kind:'runtime-context'},content:[{type:'text',text}]},{source:{kind:'user'},content:[{type:'text',text}]}]);
 assert.equal(result.removed,2);assert.ok(result.messages[0].content[0].text.includes('prefers Chinese'));assert.equal(result.messages[1].content[0].text,text);
});
test('current date cannot be replaced by the newest filename year',()=>{
 assert.match(semanticProblem({currentYear:2026},'基于当前日期（2025年1月）筛选'),/年份/);
 assert.equal(semanticProblem({currentYear:2026},'这些文件来自2025年1月。'),'');
});
test('runtime memory section metadata stays consistent with filtered content',()=>{
 const memory='# DSH memory\n- User prefers Chinese.\n- read_document fails with a sandbox error.';
 const result=sanitizeMemory([{source:{kind:'runtime-context',sections:[{name:'dsh-memory',text:memory}]},content:[{type:'text',text:'Runtime context\n\n'+memory}]}]);
 assert.equal(result.removed,1);assert.ok(result.messages[0].content[0].text.includes(result.messages[0].source.sections[0].text));
});
test('individual attached image evaluation needs pixels but no directory catalog',()=>{
 assert.match(semanticProblem({needsVisual:true,needsPhotos:false},'无法判断图片好看吗'),/实际图片/);
 assert.equal(semanticProblem({needsVisual:true,needsPhotos:false,visualImages:1},'这张图的主体清晰。'),'');
});
test('photo tool compiles against the real DSH tool schema DSL',()=>{
 let registered;
 registerPhotoTools({effect:f=>f(),tools:{register:d=>{registered=d;return ()=>{};}}},{});
 assert.equal(registered.name,'photo_catalog');
});
test('repeated photo calls are bounded without blocking distinct pages or first retry',()=>{
 const state={},args={operation:'list',catalog:'id',offset:0},result={content:[{type:'text',text:'{}'}]};
 observeEvidence(state,{name:'photo_catalog',arguments:args},result);assert.equal(repeatedPhotoCall(state,args),'');
 observeEvidence(state,{name:'photo_catalog',arguments:args},result);assert.match(repeatedPhotoCall(state,{offset:0,catalog:'id',operation:'list'}),/停止/);
 assert.equal(repeatedPhotoCall(state,{...args,offset:12}),'');
});
test('a followup correction cannot deny a year present in the actual full inventory',()=>{
 const state={photo:{complete:true,selectedCount:131,byYear:{2024:285,2025:1800,2026:1265}},needsPhotos:false};
 assert.match(semanticProblem(state,'实际情况：完全没有2026年的照片。'),/存在/);
 assert.equal(semanticProblem(state,'此前“没有2026年的照片”的说法错误，实际有2026年的图片。'),'');
 assert.equal(semanticProblem(state,'没有2023年的照片。'),'');
});
