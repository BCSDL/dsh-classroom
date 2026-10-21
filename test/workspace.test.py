import importlib.util
import json
import os
import shutil
import tempfile
import unittest
import wave
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

class WorkspaceTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name)
        os.environ['DSH_CLASSROOM_CONFIG']=json.dumps({'dataDirectory':str(self.root)})
        spec=importlib.util.spec_from_file_location('workspace_worker',Path(__file__).parents[1]/'backend/worker.py')
        self.w=importlib.util.module_from_spec(spec);spec.loader.exec_module(self.w)
        job=self.w.dispatch('create_live',{'title':'Physics','options':{'translate':False,'summarize':False}});self.id=job['id'];self.w.update(self.id,state='complete')
    def tearDown(self):self.tmp.cleanup()
    def test_template_changes_cache_and_retains_existing_terms(self):
        self.w.dispatch('course_options',{'id':self.id,'terms':'eigenvalue','keywords':['energy']})
        self.w.dispatch('note_save',{'id':self.id,'text':'Kinetic energy is one half m v squared.'})
        with patch.object(self.w,'ollama',return_value='Faithful summary') as model:
            list(self.w.studio.summarize(SimpleNamespace(**vars(self.w)),self.id))
            self.w.dispatch('course_options',{'id':self.id,'template':'cornell'})
            list(self.w.studio.summarize(SimpleNamespace(**vars(self.w)),self.id))
            self.assertEqual(model.call_count,2);self.assertIn('Cornell',model.call_args.args[0])
        self.assertEqual(self.w.read_job(self.id)['options']['terms'],'eigenvalue')
        self.assertEqual(self.w.read_job(self.id)['options']['keywords'],['energy'])
        with self.assertRaises(ValueError):self.w.dispatch('course_options',{'id':self.id,'template':'arbitrary'})
    def test_note_deletion_can_be_reversed_without_reverting_transcript(self):
        self.w.dispatch('note_save',{'id':self.id,'text':'remember this'})
        note=self.w.read_job(self.id)['notes'][0]
        self.w.dispatch('note_delete',{'id':self.id,'noteId':note['id']})
        history=self.w.dispatch('history',{'id':self.id})['revisions']
        self.w.dispatch('review_restore',{'id':self.id,'snapshot':history[0]})
        self.assertEqual(self.w.read_job(self.id)['notes'][0]['text'],'remember this')
    def test_annotation_is_saved_transcribed_and_exported_without_reading_external_paths(self):
        from PIL import Image
        imports=self.root/'imports';imports.mkdir();source=imports/'input.png';Image.new('RGB',(80,40),'white').save(source)
        with self.assertRaises(ValueError):self.w.dispatch('annotation_save',{'id':self.id,'path':str(self.root/'outside.png')})
        job=self.w.dispatch('annotation_save',{'id':self.id,'path':str(source),'text':'Formula','time':2,'analyze':False})
        note=job['notes'][0];self.assertTrue(Path(note['image']).exists());self.assertEqual(self.w.TASKS.qsize(),0)
        with patch.object(self.w,'ollama',return_value='Visible formula: E=0.5mv²'):
            self.w.workspace.analyze_annotation(SimpleNamespace(**vars(self.w)),self.id,note['id'])
        self.assertIn('0.5',self.w.read_job(self.id)['notes'][0]['analysis'])
        doc=self.w.dispatch('export_document',{'id':self.id,'format':'docx'})
        import zipfile
        with zipfile.ZipFile(doc['path'])as archive:self.assertTrue(any(x.startswith('word/media/')for x in archive.namelist()))
    def test_alignment_requires_real_source_and_keeps_manual_confirmation(self):
        source=self.root/'lesson.pdf';source.write_bytes(b'fixture');self.w.update(self.id,materials=[{'kind':'document','path':str(source)}])
        with self.assertRaises(ValueError):self.w.dispatch('alignment_confirm',{'id':self.id,'source':'invented.pdf','page':1,'start':5,'end':7})
        job=self.w.dispatch('alignment_confirm',{'id':self.id,'source':'lesson.pdf','page':1,'start':5,'end':7})
        self.assertTrue(job['alignments'][0]['verified']);self.assertEqual(job['alignments'][0]['method'],'human-confirmed')
    def test_interrupted_native_capture_recovers_closed_unacknowledged_audio_on_explicit_resume(self):
        source=self.w.job_dir(self.id)/'inputs'/'native-00000000.wav'
        with wave.open(str(source),'wb')as audio:audio.setnchannels(1);audio.setsampwidth(2);audio.setframerate(16000);audio.writeframes(b'\0\0'*1600)
        self.w.update(self.id,state='recording',nativeCapture=True)
        self.w.recover();job=self.w.read_job(self.id)
        self.assertFalse(job['nativeCapture']);self.assertEqual(job['state'],'paused');self.assertEqual(self.w.TASKS.qsize(),0)
        with patch.object(self.w,'normalize',side_effect=lambda a,b,*args,**kw:shutil.copyfile(a,b)):
            job=self.w.dispatch('resume',{'id':self.id})
        self.assertTrue(job['recordingFinished']);self.assertEqual(job['recoveredNativeChunks'],1)
        self.assertTrue(Path(job['chunks']['0']['path']).exists())

if __name__=='__main__':unittest.main()
