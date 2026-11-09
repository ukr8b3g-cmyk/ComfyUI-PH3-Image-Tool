import sys,tempfile,types,unittest
from pathlib import Path
from unittest.mock import patch
from PIL import Image
from support import load,storage,document,generation
o=load('output_saving')
class OutputTests(unittest.TestCase):
 def test_defaults_and_invalid_directories(self):
  self.assertEqual(o.options({}),{'enabled':True,'directory':'','quality':80})
  for name in ['../outside','D:/outside','/outside','a/../b','a//b']:
   with self.assertRaises(Exception):o.options({'save_image_directory':name})
 def test_final_result_saves_webp_without_save_image_node_and_keeps_alpha(self):
  for enabled in [True,False]:
   with tempfile.TemporaryDirectory() as t:
    store=storage.Store(Path(t)/'store');rec=store.create(document(8,8));job=store.create_job(rec['id'],{'mode':'full','region':[0,0,8,8],'output_save':{'enabled':enabled,'directory':'pictures','quality':80}})
    out=Path(t)/'output';paths=types.SimpleNamespace(get_output_directory=lambda:str(out));img=Image.new('RGBA',(8,8),(230,20,10,120))
    with patch.dict(sys.modules,{'folder_paths':paths}):finished=generation.capture_images(store,job['id'],[img])
    self.assertEqual(finished['status'],'succeeded');self.assertEqual(len(finished['results']),1)
    files=list(out.rglob('*.webp'))
    self.assertEqual(len(files),1 if enabled else 0)
    if enabled:
     with Image.open(files[0]) as saved:self.assertEqual(saved.format,'WEBP');self.assertEqual(saved.getchannel('A').getextrema(),(120,120))
     self.assertEqual(files[0].name,Path(finished['results'][0]['saved_image']).name)
 def test_save_failures_keep_internal_generation_candidate(self):
  with tempfile.TemporaryDirectory() as t:
   store=storage.Store(Path(t)/'store');rec=store.create(document(8,8));blocked=Path(t)/'blocked';blocked.write_text('keep')
   job=store.create_job(rec['id'],{'mode':'full','region':[0,0,8,8],'output_save':{'enabled':True,'directory':'','quality':80}})
   with patch.dict(sys.modules,{'folder_paths':types.SimpleNamespace(get_output_directory=lambda:str(blocked))}):
    with self.assertRaises(Exception):generation.capture_images(store,job['id'],[Image.new('RGB',(8,8))])
   done=store.job(job['id']);self.assertEqual(done['status'],'succeeded');self.assertEqual(len(done['results']),1);self.assertIn('save failed',done['error'])
   self.assertEqual(blocked.read_text(),'keep')
 def test_existing_files_are_never_overwritten(self):
  with tempfile.TemporaryDirectory() as t:
   store=storage.Store(Path(t)/'store');asset=store.put_image(Image.new('RGB',(8,8)))['asset'];job={'id':'job','request':{'output_save':{'enabled':True,'directory':'','quality':80}}}
   for _ in range(2):o.save_candidates(store,job,[{'asset':asset}],Path(t)/'out')
   self.assertEqual(len(list((Path(t)/'out').glob('*.webp'))),2)
