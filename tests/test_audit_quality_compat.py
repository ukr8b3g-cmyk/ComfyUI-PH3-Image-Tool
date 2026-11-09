import hashlib,json,tempfile,unittest
from pathlib import Path
from PIL import Image
from support import load,storage,document

exporting=load('exporting');saving=load('output_saving');schema=load('schema')
class QualityCompatibilityTests(unittest.TestCase):
 def test_quality_boundaries_support_export_save_reopen_archive_and_auto_save(self):
  with tempfile.TemporaryDirectory() as temp:
   store=storage.Store(Path(temp)/'store');image=Image.new('RGBA',(8,8),(80,40,20,128));asset=store.put_image(image)['asset']
   for auto in [False,True]:
    for quality in [1,5,9,10,80,100]:
     doc=document(8,8);doc['settings'].update(export_quality=quality/100,save_generated_images=auto)
     raw,mime=exporting.encode_image(image,{'format':'webp','quality':quality});self.assertTrue(raw);self.assertEqual(mime,'image/webp')
     rec=store.create(doc);self.assertEqual(store.read(rec['id'])['document']['settings']['export_quality'],quality/100)
     rec=store.save(rec['id'],doc,rec['revision']);other=storage.Store(Path(temp)/f'copy-{auto}-{quality}');self.assertEqual(other.import_archive(store.export(rec['id']))['document']['settings']['export_quality'],quality/100)
     output=Path(temp)/f'output-{auto}-{quality}';saving.save_candidates(store,{'id':'test','request':{'output_save':saving.options(doc['settings'])}},[{'asset':asset}],output)
     self.assertEqual(len(list(output.glob('*.webp'))),int(auto))
 def test_legacy_low_quality_record_opens_without_disk_rewrite(self):
  with tempfile.TemporaryDirectory() as temp:
   store=storage.Store(temp);doc=document(8,8);rec=store.create(doc);path=Path(temp)/'projects'/f"{rec['id']}.json";old=json.loads(path.read_text());old['document']['settings']['export_quality']=.05;path.write_text(json.dumps(old),encoding='utf8');before=path.read_bytes()
   self.assertEqual(store.read(rec['id'])['document']['settings']['export_quality'],.05);self.assertEqual(path.read_bytes(),before)
 def test_new_canvas_limit_does_not_reject_larger_existing_document_metadata(self):
  doc=document(2049,1);self.assertEqual(schema.validate_document(doc)['width'],2049)
 def test_final_missing_job_update_cannot_overwrite_stored_completion(self):
  with tempfile.TemporaryDirectory() as temp:
   store=storage.Store(temp);rec=store.create(document(8,8));job=store.create_job(rec['id'],{'mode':'full'});store.mark_job(job['id'],{'prompt_id':'own','status':'queued'})
   asset=store.put_image(Image.new('RGB',(8,8),'red'))['asset'];store.finish_job(job['id'],results=[{'asset':asset}])
   patch={'status':'failed','error':'Queue entry removed externally','suppress_auto':True,'only_if_unfinished':True,'expected_prompt_id':'own'}
   result=store.mark_job(job['id'],patch);self.assertEqual(result['status'],'succeeded');self.assertEqual(result['results'][0]['asset'],asset);self.assertFalse(result.get('suppress_auto',False));self.assertNotEqual(result.get('error'),'Queue entry removed externally')
 def test_prompt_identity_guard_and_confirmed_missing_job(self):
  with tempfile.TemporaryDirectory() as temp:
   store=storage.Store(temp);rec=store.create(document(8,8));job=store.create_job(rec['id'],{'mode':'full'});store.mark_job(job['id'],{'prompt_id':'own','status':'queued'})
   patch={'status':'failed','error':'Queue entry removed externally','suppress_auto':True,'only_if_unfinished':True,'expected_prompt_id':'other'}
   self.assertEqual(store.mark_job(job['id'],patch)['status'],'queued');patch['expected_prompt_id']='own';self.assertEqual(store.mark_job(job['id'],patch)['status'],'failed')
 def test_baked_adjustment_provenance_assets_survive_archive_roundtrip(self):
  with tempfile.TemporaryDirectory() as temp:
   store=storage.Store(Path(temp)/'store');source=store.put_image(Image.new('RGB',(8,8),'gray'))['asset'];result=store.put_image(Image.new('RGB',(8,8),'green'))['asset'];painted=store.put_image(Image.new('RGB',(8,8),'red'))['asset'];doc=document(8,8)
   doc['layers']=[dict(id=schema.uid(),type='image',asset=painted,x=0,y=0,w=8,h=8,rotation=0,opacity=1,visible=True,paint=True,retouch_history=[{'type':'fill','source_asset':source,'result_asset':result,'settings':{'color':'#00ff00'}}])]
   record=store.create(doc);other=storage.Store(Path(temp)/'other');copy=other.import_archive(store.export(record['id']));self.assertEqual(copy['document']['layers'],doc['layers']);self.assertEqual(other.image(result).getpixel((0,0)),(0,128,0,255))
