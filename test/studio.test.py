import importlib.util
import json
import os
import tempfile
import unittest
import zipfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

class StudioTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        os.environ['DSH_CLASSROOM_CONFIG']=json.dumps({'dataDirectory':self.tmp.name})
        spec=importlib.util.spec_from_file_location('studio_worker',Path(__file__).parents[1]/'backend/worker.py')
        self.w=importlib.util.module_from_spec(spec);spec.loader.exec_module(self.w)
        self.job=self.w.dispatch('create_live',{'title':'Physics','options':{'translate':False,'summarize':False}})
        self.id=self.job['id'];self.w.update(self.id,state='complete')
        self.path=self.w.job_dir(self.id)/'results/00000000.json'
        self.w.atomic_json(self.path,{'index':0,'offset':0,'segments':[{'start':0,'end':10,'speaker':'Speaker 1','text':'Kinetic energy wrong text','words':[{'start':0,'end':5,'speaker':'Speaker 1','text':'Kinetic '},{'start':5,'end':10,'speaker':'Speaker 1','text':'energy'}]}]})
    def tearDown(self):self.tmp.cleanup()
    def test_correction_preserves_history_and_rejects_stale_revision(self):
        result=self.w.dispatch('review_edit',{'id':self.id,'chunk':0,'segment':0,'text':'Kinetic energy equals half mv squared','revision':0})
        self.assertTrue(result['summaryStale']);self.assertEqual(result['revision'],1)
        with self.assertRaisesRegex(ValueError,'其他窗口'):self.w.dispatch('speaker_name',{'id':self.id,'speaker':'Speaker 1','name':'Professor','revision':0})
        history=self.w.dispatch('history',{'id':self.id})['revisions'];self.assertEqual(len(history),1)
        self.w.dispatch('review_restore',{'id':self.id,'snapshot':history[0]})
        self.assertEqual(self.w.dispatch('get',{'id':self.id})['results'][0]['segments'][0]['text'],'Kinetic energy wrong text')
    def test_word_aligned_speaker_split_and_names_keep_original_keys(self):
        self.w.dispatch('speaker_assign',{'id':self.id,'start':5,'end':10,'target':'Speaker 2'})
        self.w.dispatch('speaker_name',{'id':self.id,'speaker':'Speaker 2','name':'Student'})
        segments=self.w.dispatch('get',{'id':self.id})['results'][0]['segments']
        self.assertEqual([s['speaker'] for s in segments],['Speaker 1','Speaker 2']);self.assertEqual(segments[1]['speakerName'],'Student')
    def test_notes_export_and_negative_time_rejection(self):
        self.w.dispatch('note_save',{'id':self.id,'text':'复习动能公式','time':3,'page':2})
        self.assertIn('复习动能公式',(self.w.job_dir(self.id)/'report.md').read_text(encoding='utf-8'))
        with self.assertRaises(ValueError):self.w.dispatch('note_save',{'id':self.id,'text':'invalid','time':-1})
    def test_full_course_reduction_visits_early_and_late_raw_sources(self):
        for index in range(40):self.w.atomic_json(self.path.with_name(f'{index:08d}.json'),{'index':index,'segments':[{'start':index*60,'end':index*60+20,'speaker':'Speaker 1','text':f'UNIQUE_{index} '+('course evidence '*100)}]})
        calls=[]
        def llm(prompt,**_):calls.append(prompt);return 'Bilingual study notes [audio:0] [audio:39]'
        with patch.object(self.w,'ollama',side_effect=llm):list(self.w.studio.summarize(SimpleNamespace(**vars(self.w)),self.id))
        self.assertTrue(any('UNIQUE_0' in p for p in calls));self.assertTrue(any('UNIQUE_39' in p for p in calls));self.assertGreater(self.w.read_job(self.id)['summaryCoverage']['levels'],1)
    def test_backup_restore_rejects_zip_traversal_and_keeps_existing_data(self):
        root=Path(self.tmp.name);evil=root/'evil.zip'
        with zipfile.ZipFile(evil,'w')as out:out.writestr('../outside.txt','bad')
        with self.assertRaisesRegex(ValueError,'越界'):self.w.dispatch('knowledge_restore',{'path':str(evil)})
        self.assertFalse((root/'outside.txt').exists());self.assertTrue(self.path.exists())
    def test_source_adoption_rejects_external_paths(self):
        with self.assertRaises(ValueError):self.w.dispatch('adopt_sources',{'id':self.id,'replacements':{'old':str(self.path)}})
    def test_multiple_player_clocks_remain_independent(self):
        job=self.w.dispatch('create_watch',{'captureStartedAt':1000000});identifier=job['id']
        for player,second in [('f0:v0',10),('f0:v1',200)]:self.w.dispatch('watch_event',{'id':identifier,'playerId':player,'capturedAt':1000000,'playerTime':second,'caption':player})
        self.w.dispatch('watch_primary',{'id':identifier,'playerId':'f0:v1'})
        self.assertEqual(self.w.watch_service().clock(identifier,1001000)['playerTime'],201)
        self.assertEqual(self.w.watch_service().clock(identifier,1001000,'f0:v0')['playerTime'],11)
        self.assertEqual(len(self.w.dispatch('watch_status',{'id':identifier})['players']),2)
    def test_answer_without_valid_citation_is_not_presented_as_supported(self):
        task=self.w.dispatch('ask_evidence',{'question':'Why?','evidence':[{'id':'actual','content':'A fact'}]})
        with patch.object(self.w,'ollama',return_value=json.dumps({'answer':'invented','citations':[99]})):self.w.studio.answer(SimpleNamespace(**vars(self.w)),task['id'])
        answer=self.w.read_job(task['id']);self.assertEqual(answer['citations'],[]);self.assertNotIn('invented',answer['answer'])
    def test_chat_gpu_lease_requeues_without_losing_audio_work(self):
        self.w.dispatch('chat_begin',{'token':'chat-test'})
        self.w.enqueue('live',self.id,0)
        queued=self.w.TASKS.get_nowait()
        self.assertFalse(self.w.reserve_task(queued));self.assertEqual(self.w.TASKS.qsize(),1)
        self.assertIn(('live',self.id,0),self.w.PENDING_TASKS)
        self.w.dispatch('chat_end',{'token':'chat-test'})
        queued=self.w.TASKS.get_nowait();self.assertTrue(self.w.reserve_task(queued))
        self.assertEqual(self.w.CURRENT_JOB,self.id)
        self.w.RUNNER_ACTIVE=False;self.w.CURRENT_JOB=None;self.w.TASKS.task_done()
    @unittest.skipUnless(os.name=='nt','Windows-specific process lifecycle')
    def test_native_capture_job_kills_only_its_owned_child_on_handle_close(self):
        import subprocess,sys
        from native_capture import protect_child
        child=subprocess.Popen([sys.executable,'-c','import time;time.sleep(60)'],creationflags=subprocess.CREATE_NO_WINDOW)
        try:
            handle,kernel=protect_child(child);kernel.CloseHandle(handle)
            self.assertIsNotNone(child.wait(timeout=10))
        finally:
            if child.poll() is None:child.kill();child.wait()

if __name__=='__main__':unittest.main()
