import io,json,tempfile,unittest,zipfile
from unittest.mock import patch
from PIL import Image
from support import storage,schema,document

class ArchiveBoundaryTests(unittest.TestCase):
 def setUp(self):self.temp=tempfile.TemporaryDirectory();self.store=storage.Store(self.temp.name)
 def tearDown(self):self.temp.cleanup()
 def test_256_layers_1025_images_export_import_roundtrip(self):
  assets=[self.store.put_image(Image.new('RGBA',(2,2),(i%256,i//256,31,128)))['asset'] for i in range(1025)]
  doc=document(2,2);doc['composite_asset']=assets[-1];doc['layers']=[{'id':schema.uid(),'type':'image','asset':assets[4*i],'mask_asset':assets[4*i+1],'processing':{'source_asset':assets[4*i+2],'raw_asset':assets[4*i+3]},'x':0,'y':0,'w':2,'h':2,'visible':True,'opacity':1} for i in range(256)]
  record=self.store.create(doc);raw=self.store.export(record['id']);self.assertEqual(len(zipfile.ZipFile(io.BytesIO(raw)).infolist()),1026)
  imported=self.store.import_archive(raw);self.assertEqual(imported['document'],doc);self.assertEqual(len(schema.asset_ids(imported['document'])),1025)
 def test_export_and_import_share_entry_limit(self):
  doc=document(2,2);doc['references']=[{'asset':self.store.put_image(Image.new('RGB',(2,2),color))['asset']} for color in ['red','green','blue']];record=self.store.create(doc);raw=self.store.export(record['id'])
  with patch.object(storage,'MAX_ARCHIVE_ENTRIES',3):
   with self.assertRaises(schema.ToolError):self.store.export(record['id'])
   with self.assertRaises(schema.ToolError):self.store.import_archive(raw)
 def test_zip_overhead_is_included_in_export_limit(self):
  record=self.store.create(document(2,2));doc_bytes=json.dumps(record['document'],ensure_ascii=False).encode();raw=self.store.export(record['id']);self.assertGreater(len(raw),len(doc_bytes))
  with patch.object(storage,'MAX_ARCHIVE',len(doc_bytes)+1):
   with self.assertRaises(schema.ToolError):self.store.export(record['id'])
   with self.assertRaises(schema.ToolError):self.store.import_archive(raw)
 def test_each_exported_image_respects_import_image_limit(self):
  asset=self.store.put_image(Image.new('RGB',(2,2),'red'))['asset'];doc=document(2,2);doc['composite_asset']=asset;record=self.store.create(doc)
  with patch.object(storage,'MAX_UPLOAD',1):
   with self.assertRaises(schema.ToolError):self.store.export(record['id'])
