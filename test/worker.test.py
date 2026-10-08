import importlib.util
import json
import os
import tempfile
import unittest
from pathlib import Path

class WorkerTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        os.environ['DSH_CLASSROOM_CONFIG'] = json.dumps({'dataDirectory': self.temporary.name})
        spec = importlib.util.spec_from_file_location('classroom_worker', Path(__file__).parents[1] / 'backend/worker.py')
        self.worker = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.worker)
    def tearDown(self):
        self.temporary.cleanup()
    def test_upload_retry_is_idempotent_and_recoverable(self):
        source = Path(self.temporary.name) / 'test.wav'
        source.write_bytes(b'RIFFfixture')
        job = self.worker.dispatch('create_live', {'title': 'Fixture'})
        args = {'id': job['id'], 'index': 0, 'offset': 0, 'path': str(source)}
        self.assertFalse(self.worker.dispatch('append', args)['duplicate'])
        self.assertTrue(self.worker.dispatch('append', args)['duplicate'])
        self.worker.recover()
        saved = self.worker.read_job(job['id'])
        self.assertEqual(saved['state'], 'paused')
        self.assertEqual(Path(saved['chunks']['0']['path']).read_bytes(), b'RIFFfixture')
    def test_job_path_cannot_escape_data_directory(self):
        for identifier in ['../private', '/', 'x' * 32, None]:
            with self.assertRaises(ValueError):
                self.worker.job_dir(identifier)
    def test_document_reports_preview_truncation(self):
        source = Path(self.temporary.name) / 'notes.md'
        source.write_text(('Important source text\n' * 1200), encoding='utf-8')
        result = self.worker.dispatch('document', {'path': str(source), 'limit': 1})
        self.assertTrue(result['truncated'])
        self.assertEqual(len(result['pages']), 1)
    def test_speaker_label_uses_maximum_time_overlap(self):
        turns = [{'start': 0, 'end': 2, 'speaker': 'Speaker 1'}, {'start': 2, 'end': 5, 'speaker': 'Speaker 2'}]
        self.assertEqual(self.worker.label_word(1.9, 2.8, turns), 'Speaker 2')
        self.assertEqual(self.worker.label_word(8, 9, turns), '未知说话人')

if __name__ == '__main__':
    unittest.main()
