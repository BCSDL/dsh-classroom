import test from 'node:test';import assert from 'node:assert/strict';import {knowledgeIntake} from '../lib/knowledge-intake.js';
test('ordinary documents and photos do not enter classroom knowledge',()=>{assert.deepEqual(knowledgeIntake('读取这个PDF并评选最佳照片'),{search:false,importUploads:false});});
test('course requests and already bound classroom sessions retain knowledge intake',()=>{assert.equal(knowledgeIntake('整理课程课件').importUploads,true);assert.equal(knowledgeIntake('继续分析',true).search,true);});
test('explicit refusal to import overrides a classroom binding',()=>{assert.deepEqual(knowledgeIntake('不导入课堂知识库，不开始课程或录音',true),{search:false,importUploads:false});});
