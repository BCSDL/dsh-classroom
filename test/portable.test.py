import hashlib
from contextlib import closing
import importlib.util
import json
import os
import sqlite3
import tempfile
import unittest
import zipfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch


class PortableTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        os.environ['DSH_CLASSROOM_CONFIG'] = json.dumps({'dataDirectory': str(self.root)})
        spec = importlib.util.spec_from_file_location('portable_worker', Path(__file__).parents[1] / 'backend/worker.py')
        self.w = importlib.util.module_from_spec(spec); spec.loader.exec_module(self.w)
        self.knowledge = self.root / 'knowledge'; self.knowledge.mkdir()
        (self.knowledge / 'classroom-sources.json').write_text('{"documents":{},"assets":{}}', encoding='utf-8')
        self.job = self.w.dispatch('create_live', {'title': 'Fixture', 'options': {'summarize': False}})
        self.id = self.job['id']; self.w.update(self.id, state='complete')
    def tearDown(self):
        self.tmp.cleanup()
    def test_integrity_rejects_modified_files_before_target_merge(self):
        archive = self.w.dispatch('knowledge_backup', {})
        bad = self.root / 'bad.zip'
        with zipfile.ZipFile(archive['path']) as original, zipfile.ZipFile(bad, 'w') as edited:
            for item in original.infolist():
                edited.writestr(item.filename, b'changed' if item.filename == 'classroom-sources.json' else original.read(item))
        with self.assertRaisesRegex(ValueError, '完整性'):
            self.w.dispatch('knowledge_restore', {'path': str(bad)})
        self.assertEqual((self.knowledge / 'classroom-sources.json').read_text(), '{"documents":{},"assets":{}}')
        self.assertFalse(list((self.root / 'restore-staging').glob('*')))
    def test_active_capture_and_insufficient_disk_do_not_produce_backups(self):
        self.w.update(self.id, nativeCapture=True)
        with self.assertRaisesRegex(ValueError, '录音'):
            self.w.dispatch('knowledge_backup', {})
        self.w.update(self.id, nativeCapture=False)
        with patch('portable_archive.shutil.disk_usage', return_value=SimpleNamespace(free=1)):
            with self.assertRaisesRegex(ValueError, '空间'):
                self.w.dispatch('knowledge_backup', {})
        self.assertFalse(list((self.root / 'exports').glob('*.zip*')))
    def test_backup_write_failure_removes_partial_and_retains_sources(self):
        before=(self.knowledge/'classroom-sources.json').read_bytes()
        with patch('portable_archive.zipfile.ZipFile.open', side_effect=OSError(28,'disk full')):
            with self.assertRaises(OSError):self.w.dispatch('knowledge_backup', {})
        self.assertFalse(list((self.root/'exports').glob('*.part')))
        self.assertEqual((self.knowledge/'classroom-sources.json').read_bytes(),before)
    def test_record_and_wal_clock_restore_get_new_ids_and_rebased_paths(self):
        image=self.w.job_dir(self.id)/'frames'/'0.jpg';image.parent.mkdir();image.write_bytes(b'frame')
        self.w.update(self.id,notes=[{'id':'n1','image':str(image)}])
        db=sqlite3.connect(self.w.job_dir(self.id)/'capture.sqlite');db.execute('PRAGMA journal_mode=WAL')
        db.execute('CREATE TABLE frames(idx INTEGER,path TEXT)');db.execute('INSERT INTO frames VALUES(0,?)',(str(image),));db.commit()
        try:archive=self.w.dispatch('knowledge_backup',{})
        finally:db.close()
        staged=self.w.dispatch('knowledge_restore',{'path':archive['path']})
        self.assertGreater(staged['verifiedFiles'],2)
        result=self.w.dispatch('restore_records',{'path':staged['path'],'scope':'another-project'})
        new=result['mapping'][self.id];self.assertNotEqual(new,self.id)
        job=self.w.read_job(new);self.assertTrue(Path(job['notes'][0]['image']).is_file())
        with closing(sqlite3.connect(self.w.job_dir(new)/'capture.sqlite')) as restored:
            self.assertEqual(restored.execute('SELECT path FROM frames').fetchone()[0],job['notes'][0]['image'])
        again=self.w.dispatch('restore_records',{'path':staged['path'],'scope':'another-project'})
        self.assertEqual(again['mapping'][self.id],new)
        self.assertEqual(self.w.TASKS.qsize(),0)

if __name__ == '__main__': unittest.main()
