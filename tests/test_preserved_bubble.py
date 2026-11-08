import unittest,tempfile
import numpy as np
from PIL import Image,ImageDraw
from support import load,storage,document,generation,MODELS,NODE_NAMES
l=load('lettering')
class PreserveTests(unittest.TestCase):
 def test_pixels_preserved_and_generated_interior_marks_removed(self):
  source=Image.new('RGB',(150,100),'white');ImageDraw.Draw(source).rectangle((40,35,100,65),fill='black')
  frame=Image.new('RGB',(240,160),'white');d=ImageDraw.Draw(frame);d.ellipse((20,20,220,140),outline='black',width=3);d.text((110,70),'BAD',fill='black')
  opts=l.options(dict(text='ビクッ!!',decoration='spiky'))
  result,clipped,rect=l.compose_preserved_bubble(frame,source,opts);glyph,_=l.finish(source,dict(opts,decoration='none'))
  expected=Image.alpha_composite(Image.new('RGBA',glyph.size,'white'),glyph)
  self.assertEqual(result.crop((rect['x'],rect['y'],rect['x']+rect['w'],rect['y']+rect['h'])).tobytes(),expected.tobytes());self.assertFalse(clipped);self.assertEqual(result.getchannel('A').getextrema(),(0,255))
 def test_job_sends_no_source_to_ai_and_keeps_immutable_source(self):
  with tempfile.TemporaryDirectory() as tmp:
   store=storage.Store(tmp);rec=store.create(document());im=Image.new('RGB',(150,100),'white');ImageDraw.Draw(im).rectangle((40,35,100,65),fill='black');asset=store.put_image(im)['asset']
   parent=store.create_job(rec['id'],dict(mode='lettering'));store.finish_job(parent['id'],results=[dict(asset=asset,raw_asset=asset)])
   job,graph=generation.prepare_job(store,rec['id'],dict(revision=0,mode='lettering',reference_job_id=parent['id'],lettering=dict(text='ビクッ!!',decoration='spiky',use_reference=True,reference_kind='candidate')),MODELS,NODE_NAMES)
   self.assertEqual(job['request']['preserved_lettering_asset'],asset);self.assertNotIn('20',graph);self.assertIn('empty spiky',graph['6']['inputs']['prompt']);self.assertNotIn('ビクッ',graph['6']['inputs']['prompt'])
if __name__=='__main__':unittest.main()
