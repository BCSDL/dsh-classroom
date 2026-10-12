import importlib.util
import json
import os
import tempfile
import unittest
from pathlib import Path
from PIL import Image


class WatchTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        os.environ['DSH_CLASSROOM_CONFIG'] = json.dumps({'dataDirectory': self.tmp.name})
        spec = importlib.util.spec_from_file_location('watch_test_worker', Path(__file__).parents[1] / 'backend/worker.py')
        self.w = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.w)
        self.job = self.w.dispatch('create_watch', {'captureStartedAt': 1000000, 'sourcePage': 'https://school.test/player?token=private'})
        self.id = self.job['id']
        self.watch = self.w.watch_service()

    def tearDown(self):
        self.tmp.cleanup()

    def event(self, offset, player, rate=1, paused=False, caption=''):
        return self.w.dispatch('watch_event', {'id': self.id, 'capturedAt': 1000000 + offset * 1000, 'playerTime': player, 'playbackRate': rate, 'paused': paused, 'caption': caption})

    def test_pause_seek_speed_and_stale_clock_are_not_capture_time(self):
        self.event(1, 31)
        self.assertAlmostEqual(self.watch.clock(self.id, 1002500)['playerTime'], 32.5)
        self.event(3, 33, paused=True)
        self.assertEqual(self.watch.clock(self.id, 1005000)['playerTime'], 33)
        self.event(6, 300, rate=2)
        self.assertEqual(self.watch.clock(self.id, 1008000)['playerTime'], 304)
        self.assertIsNone(self.watch.clock(self.id, 1020000))
        value = self.watch.decorate(self.id, {'segments': [{'start': 1.5, 'end': 7}]})
        self.assertIsNone(value['segments'][0]['sourceEnd'])
        self.assertIn('sourceTimingWarning', value['segments'][0])

    def test_events_are_durable_idempotent_and_status_is_bounded(self):
        self.assertFalse(self.event(1, 1, caption='真实字幕')['duplicate'])
        self.assertTrue(self.event(1, 1, caption='真实字幕')['duplicate'])
        for i in range(2, 150):
            self.event(i, i, caption='line '+str(i))
        status = self.watch.status(self.id)
        self.assertEqual(len(status['captions']), 30)
        self.assertEqual(status['latestClock']['player'], 149)
        self.assertNotIn('token=', self.w.read_job(self.id)['sourcePage'])

    def test_finished_capture_waits_for_frames_and_retry_keeps_evidence(self):
        source = Path(self.tmp.name) / 'frame.png'
        Image.new('RGB', (320, 180), 'blue').save(source)
        args = {'id': self.id, 'index': 0, 'path': str(source), 'capturedAt': 1002000}
        self.assertFalse(self.w.dispatch('watch_frame', args)['duplicate'])
        digest = self.w.job_dir(self.id).joinpath('frames/00000000.jpg').read_bytes()
        self.assertTrue(self.w.dispatch('watch_frame', args)['duplicate'])
        Image.new('RGB', (320, 180), 'red').save(source)
        with self.assertRaisesRegex(ValueError, '拒绝覆盖'):
            self.w.dispatch('watch_frame', args)
        self.w.dispatch('finish', {'id': self.id})
        self.assertNotEqual(self.w.read_job(self.id)['state'], 'complete')
        self.watch.w.ollama = lambda *a, **k: json.dumps({'onScreenText': 'Fixture', 'visibleCaptions': '', 'analysis': 'Fixture visual analysis'})
        self.watch.process_frame(self.id, 0)
        self.assertEqual(self.w.read_job(self.id)['state'], 'complete')
        self.assertEqual(self.w.job_dir(self.id).joinpath('frames/00000000.jpg').read_bytes(), digest)
        self.assertIn('Fixture visual analysis', self.w.job_dir(self.id).joinpath('report.md').read_text(encoding='utf-8'))
        with self.assertRaisesRegex(ValueError, '采集已结束'):
            self.event(10, 10)

    def test_invalid_identifier_or_numeric_metadata_is_rejected(self):
        with self.assertRaises(ValueError):
            self.w.dispatch('watch_status', {'id': '../other'})
        for value in [float('nan'), float('inf'), -1]:
            with self.assertRaises(ValueError):
                self.event(1, value)
        with self.assertRaises(ValueError):
            self.event(1, 1, rate=0)

    def test_restart_resumes_pending_frames_without_overwriting_completed_results(self):
        image = Path(self.tmp.name) / 'frame.png'
        Image.new('RGB', (10, 10), 'green').save(image)
        self.w.dispatch('watch_frame', {'id': self.id, 'index': 0, 'path': str(image)})
        self.w.recover()
        self.assertEqual(self.w.read_job(self.id)['state'], 'paused')
        self.assertEqual(self.watch.resume(self.id), 1)


if __name__ == '__main__':
    unittest.main()
