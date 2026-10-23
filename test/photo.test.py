import importlib.util
import json
import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import patch
from PIL import Image

spec=importlib.util.spec_from_file_location('photo_evidence',Path(__file__).parents[1]/'backend/photo_evidence.py')
photo=importlib.util.module_from_spec(spec);spec.loader.exec_module(photo)


class PhotoTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name);self.source=self.root/'photos';self.source.mkdir()
    def tearDown(self):self.tmp.cleanup()
    def image(self,name):
        path=self.source/name;Image.new('RGB',(60,40),'red').save(path);return path
    def scan(self,**extra):
        return photo.dispatch(self.root,'scan',{'path':str(self.source),'now':'2026-10-23T01:00:00Z','scope':'course',**extra})
    def call(self,op,catalog,**extra):return photo.dispatch(self.root,op,{'catalog':catalog,'scope':'course',**extra})
    def test_complete_inventory_over_500_and_calendar_window_pagination(self):
        base=datetime(2024,1,1)
        for n in range(505):self.image((base+timedelta(minutes=n)).strftime('%Y%m%d%H%M%S')+'.png')
        self.image('20260923000000.png');self.image('20261023000000.png');self.image('unknown.png')
        result=self.scan(window={'kind':'recent_month','start':'2026-09-23','end':'2026-10-23'})
        self.assertEqual(result['totalImages'],508);self.assertEqual(result['selectedCount'],2);self.assertEqual(result['undatedCount'],1);self.assertTrue(result['complete'])
        first=self.call('list',result['id'],limit=1);last=self.call('list',result['id'],offset=first['nextOffset'],limit=1)
        self.assertTrue(first['pageTruncated']);self.assertIsNone(last['nextOffset']);self.assertNotEqual(first['items'][0]['id'],last['items'][0]['id'])
    def test_no_scoring_unseen_and_larger_preview_required_for_complete_selection(self):
        self.image('20261022000000.png');catalog=self.scan()['id'];item=self.call('list',catalog)['items'][0]['id']
        review={'id':item,'score':8,'reason':'A visible red image with a simple uncluttered layout.'}
        with self.assertRaisesRegex(ValueError,'未实际'):self.call('review',catalog,reviews=[review])
        sheet=self.call('sheet',catalog);self.assertTrue(Path(sheet['imagePaths'][0]).is_file())
        with self.assertRaises(ValueError):self.call('review',catalog,reviews=[review])
        self.call('delivered',catalog,ids=[item],viewKind='sheet');result=self.call('review',catalog,reviews=[review]);self.assertFalse(result['eligibleForCompleteSelection'])
        self.call('inspect',catalog,ids=[item]);self.call('delivered',catalog,ids=[item],viewKind='inspect')
        self.assertTrue(self.call('result',catalog)['eligibleForCompleteSelection'])
    def test_partial_review_is_explicit_and_changed_image_invalidates_receipt(self):
        self.image('20261022000000.png');self.image('20261021000000.png');catalog=self.scan()['id'];item=self.call('list',catalog)['items'][0]
        self.call('sheet',catalog);self.call('delivered',catalog,ids=[item['id']],viewKind='sheet')
        result=self.call('review',catalog,reviews=[{'id':item['id'],'score':7,'reason':'The red region fills the frame and has clear edges.'}])
        self.assertEqual(result['unreviewed'],1);self.assertIn('暂定',result['selectionLabel'])
        (self.source/item['name']).write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError,'改变'):self.call('result',catalog)
    def test_catalog_does_not_cross_project_scope_or_traverse_identifier(self):
        catalog=self.scan()['id']
        with self.assertRaisesRegex(ValueError,'当前项目'):photo.dispatch(self.root,'list',{'catalog':catalog,'scope':'different'})
        with self.assertRaises(ValueError):self.call('list','../../outside')
    def test_unreadable_directory_never_becomes_complete_empty_inventory(self):
        with patch.object(photo.os,'scandir',side_effect=PermissionError('denied')):result=self.scan()
        self.assertFalse(result['complete']);self.assertTrue(result['errors'])

if __name__=='__main__':unittest.main()
