import importlib.util
import io
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

    def test_cleanup_releases_only_our_configured_model_lease(self):
        self.worker.OLLAMA_LEASE = 'our-lease'
        models = [{'name': self.worker.MODEL, 'expires_at': 'our-lease'},
                  {'name': 'unrelated:latest', 'expires_at': 'other-lease'}]
        with patch.object(self.worker, 'ollama_models', return_value=models), \
             patch.object(self.worker.urllib.request, 'urlopen', return_value=io.BytesIO(b'{}')) as opened:
            self.assertTrue(self.worker.release_ollama_model())
        request = opened.call_args.args[0]
        self.assertEqual(json.loads(request.data), {'model': self.worker.MODEL, 'keep_alive': 0, 'stream': False})
        self.assertIsNone(self.worker.OLLAMA_LEASE)

    def test_cleanup_does_not_unload_a_lease_refreshed_by_chat(self):
        self.worker.OLLAMA_LEASE = 'our-lease'
        with patch.object(self.worker, 'ollama_models', return_value=[{'name': self.worker.MODEL, 'expires_at': 'chat-lease'}]), \
             patch.object(self.worker.urllib.request, 'urlopen') as opened:
            self.assertFalse(self.worker.release_ollama_model())
            opened.assert_not_called()

    def test_asr_pressure_does_not_unload_other_models(self):
        with patch.object(self.worker, 'ollama_models', return_value=[{'name': 'unrelated:latest'}]), \
             patch.object(self.worker.urllib.request, 'urlopen') as opened:
            self.assertFalse(self.worker.release_ollama_model(for_asr=True))
            opened.assert_not_called()

    def test_asr_pressure_releases_shared_classroom_model(self):
        with patch.object(self.worker, 'ollama_models', return_value=[{'name': self.worker.MODEL, 'expires_at': 'chat-lease'}]), \
             patch.object(self.worker.urllib.request, 'urlopen', return_value=io.BytesIO(b'{}')):
            self.assertTrue(self.worker.release_ollama_model(for_asr=True))

    def test_asr_shortage_is_bounded_and_recoverable(self):
        job = self.worker.dispatch('create_live', {})
        with patch.object(self.worker, 'gpu_free', return_value=100), \
             patch.object(self.worker, 'release_ollama_model') as release, \
             patch.object(self.worker.time, 'monotonic', side_effect=[0, 121]):
            with self.assertRaisesRegex(RuntimeError, '120 秒'):
                self.worker.ensure_asr_memory(4000, job['id'])
            release.assert_called_once_with(for_asr=True)
        self.assertTrue((self.worker.job_dir(job['id']) / 'job.json').exists())

    def test_asr_does_not_unload_gemma_when_memory_suffices(self):
        with patch.object(self.worker, 'gpu_free', return_value=8000), \
             patch.object(self.worker, 'release_ollama_model') as release:
            self.worker.ensure_asr_memory(4000, 'unused')
            release.assert_not_called()

    def test_idle_cleanup_failure_does_not_crash_runner(self):
        with patch.object(self.worker, 'release_asr_models') as asr, \
             patch.object(self.worker, 'release_ollama_model', side_effect=OSError('offline')), \
             patch.object(self.worker.sys, 'stderr', io.StringIO()):
            self.worker.release_idle_models()
            asr.assert_called_once()

    def test_finish_after_last_processed_chunk_enqueues_cleanup(self):
        job = self.worker.dispatch('create_live', {})
        self.assertEqual(self.worker.dispatch('finish', {'id': job['id']})['state'], 'complete')
        self.assertEqual(self.worker.TASKS.get()[2], 'cleanup')

if __name__ == '__main__':
    unittest.main()
