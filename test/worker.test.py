import importlib.util
import json
import os
import tempfile
import unittest
from unittest.mock import patch
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
        source.write_text(''.join(f'Important source text {i}\n' for i in range(1200)), encoding='utf-8')
        result = self.worker.dispatch('document', {'path': str(source), 'limit': 1})
        self.assertTrue(result['truncated'])
        self.assertEqual(len(result['pages']), 1)
        continuation = self.worker.dispatch('document', {'path': str(source), 'limit': 1, 'offset': result['nextOffset']})
        self.assertEqual(continuation['offset'], 1)
        self.assertNotEqual(continuation['pages'][0]['text'], result['pages'][0]['text'])

    def test_code_extensions_use_contents_and_preserve_unicode(self):
        extensions = ['py', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'java', 'kt', 'kts', 'c', 'h',
                      'cpp', 'hpp', 'cs', 'fs', 'go', 'rs', 'rb', 'php', 'swift', 'sql', 'sh',
                      'ps1', 'bat', 'cmd', 'html', 'css', 'scss', 'vue', 'svelte', 'r', 'lua',
                      'pl', 'dart', 'json', 'yaml', 'yml', 'toml', 'xml', 'ini', 'gradle', 'ipynb']
        for extension in extensions:
            with self.subTest(extension=extension):
                source = Path(self.temporary.name) / ('fixture.' + extension)
                source.write_text('const fixture = "中文 English 7319";\n', encoding='utf-8')
                result = self.worker.dispatch('document', {'path': str(source), 'limit': 1})
                self.assertIn('中文 English 7319', result['pages'][0]['text'])
        opaque = Path(self.temporary.name) / 'opaque.ts'
        opaque.write_bytes(b'fake\0binary')
        with self.assertRaisesRegex(ValueError, '二进制'):
            self.worker.dispatch('document', {'path': str(opaque)})
    def test_speaker_label_uses_maximum_time_overlap(self):
        turns = [{'start': 0, 'end': 2, 'speaker': 'Speaker 1'}, {'start': 2, 'end': 5, 'speaker': 'Speaker 2'}]
        self.assertEqual(self.worker.label_word(1.9, 2.8, turns), 'Speaker 2')
        self.assertEqual(self.worker.label_word(8, 9, turns), '未知说话人')

    def test_live_tasks_preempt_file_continuations_and_deduplicate(self):
        self.assertTrue(self.worker.enqueue('file', 'file-job', 1))
        self.assertTrue(self.worker.enqueue('live', 'live-job', 0))
        self.assertFalse(self.worker.enqueue('live', 'live-job', 0))
        self.assertEqual(self.worker.TASKS.get()[2:], ('live', 'live-job', 0))
        self.assertEqual(self.worker.TASKS.get()[2:], ('file', 'file-job', 1))

    def test_utf16_source_code_is_text(self):
        source = Path(self.temporary.name) / 'code.ps1'
        source.write_text('Write-Output "课堂"', encoding='utf-16')
        result = self.worker.dispatch('document', {'path': str(source)})
        self.assertIn('课堂', result['pages'][0]['text'])

    def test_active_recording_cannot_be_enhanced(self):
        job = self.worker.dispatch('create_live', {})
        with self.assertRaisesRegex(ValueError, '结束录音'):
            self.worker.dispatch('enhance', {'id': job['id']})

    def test_windows_sharing_violation_retries_without_deleting_checkpoint(self):
        destination = Path(self.temporary.name) / 'state.json'
        destination.write_text('{"old": true}', encoding='utf-8')
        original = Path.replace
        attempts = []
        def replace(path, target):
            attempts.append(path)
            if len(attempts) == 1:
                self.assertTrue(json.loads(destination.read_text())['old'])
                raise PermissionError('Temporary Windows sharing violation')
            return original(path, target)
        with patch.object(Path, 'replace', replace):
            self.worker.atomic_json(destination, {'new': True})
        self.assertEqual(len(attempts), 2)
        self.assertEqual(json.loads(destination.read_text()), {'new': True})

if __name__ == '__main__':
    unittest.main()
