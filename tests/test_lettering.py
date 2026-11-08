import copy
import tempfile
import unittest
import numpy as np
from PIL import Image, ImageDraw
from support import load, schema as s, storage as st, generation as g, document, MODELS, NODE_NAMES
l = load('lettering')

class LetteringTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.store=st.Store(self.tmp.name)
        doc=document();doc['prompt']['original']='';doc['layers']=[dict(id=s.uid(),type='text',x=10,y=20,w=60,h=24,text='ビクッ!!',rotation=0,visible=True,opacity=1)]
        doc['settings']['ph3_lora_strength']=.65
        doc['references']=[dict(asset=self.store.put_image(Image.new('RGB',(64,64),'red'))['asset'])]
        self.record=self.store.create(doc);self.target=doc['layers'][0]['id']
    def tearDown(self):self.tmp.cleanup()
    def prepare(self,opts=None,**extra):
        payload=dict(revision=self.record['revision'],mode='lettering',source_layer_id=self.target,lettering=dict(text='ビクッ!!',preset='angular',**(opts or {})))
        payload.update(extra);return g.prepare_job(self.store,self.record['id'],payload,MODELS,NODE_NAMES)
    def test_t2i_default_ignores_page_references_and_supplied_source(self):
        job,graph=self.prepare(source_asset='invalid-ignored')
        self.assertFalse(job['request']['lettering']['use_reference']);self.assertIsNone(job['request']['source_asset'])
        self.assertEqual(job['request']['references'],[]);self.assertNotIn('20',graph)
        self.assertFalse(any(k.startswith('images.') for k in graph['6']['inputs']))
        self.assertIn('"ビクッ!!"',graph['6']['inputs']['prompt']);self.assertEqual(graph['2']['inputs']['strength_model'],.65)
        self.assertEqual(job['request']['canvas'],[128,96]);self.assertGreater(job['request']['generation_size'][0],128)
    def test_source_text_reference_can_have_material_dimensions(self):
        ref=self.store.put_image(Image.new('RGB',(320,192),'white'))['asset']
        job,graph=self.prepare(dict(use_reference=True,reference_kind='text'),source_asset=ref)
        self.assertEqual(graph['20']['inputs']['asset_id'],ref);self.assertEqual(graph['6']['inputs']['images.image_1'],['20',0])
        self.assertNotIn('images.image_2',graph['6']['inputs']);self.assertIn('<Picture 1>',job['request']['instruction'])
        self.assertEqual(job['request']['source_layer']['text'],'ビクッ!!')
    def test_image_reference_selection_is_validated(self):
        ref=self.store.put_image(Image.new('RGBA',(32,64),'blue'))['asset'];layer=dict(id=s.uid(),type='image',asset=ref,x=0,y=0,w=32,h=64)
        doc=self.record['document'];doc['layers'].append(layer);self.record=self.store.save(self.record['id'],doc,0)
        job,_=self.prepare(dict(use_reference=True,reference_kind='layer'),reference_layer_id=layer['id'],source_asset=ref)
        self.assertEqual(job['request']['reference_layer']['asset'],ref)
        with self.assertRaises(s.ToolError):self.prepare(dict(use_reference=True,reference_kind='layer'),reference_layer_id=s.uid(),source_asset=ref)
    def test_candidate_reference_uses_original_result_of_same_project(self):
        first,_=self.prepare();im=Image.new('RGB',(128,96),'white');ImageDraw.Draw(im).rectangle((30,30,80,60),fill='black')
        completed=g.capture_images(self.store,first['id'],[im]);job,graph=self.prepare(dict(use_reference=True,reference_kind='candidate'),reference_job_id=first['id'],reference_index=0)
        self.assertEqual(graph['20']['inputs']['asset_id'],completed['results'][0]['raw_asset'])
        other=self.store.create(document())
        with self.assertRaises(s.ToolError):g.prepare_job(self.store,other['id'],dict(revision=0,mode='lettering',lettering=dict(text='ドン',use_reference=True,reference_kind='candidate'),reference_job_id=first['id']),MODELS,NODE_NAMES)
    def test_missing_reference_and_bad_options_do_not_create_job(self):
        with self.assertRaises(s.ToolError):self.prepare(dict(use_reference=True))
        for opts in [None,[],dict(text=''),dict(text='x'*129),dict(text='x',vertical='true'),dict(text='x',preset='unknown'),dict(text='x',reference_kind='unknown'),dict(text='x',transparent=1)]:
            with self.subTest(opts=opts),self.assertRaises(s.ToolError):l.options(opts)
    def test_followup_without_selected_text_inherits_source_and_parent_provenance(self):
        first,_=self.prepare();im=Image.new('RGB',(128,96),'white');ImageDraw.Draw(im).rectangle((30,30,80,60),fill='black')
        completed=g.capture_images(self.store,first['id'],[im])
        job,_=self.prepare(dict(use_reference=True,reference_kind='candidate',style='cute',decoration='spiky'),source_layer_id=None,reference_job_id=first['id'])
        self.assertEqual(job['request']['parent_job_id'],first['id']);self.assertEqual(job['request']['parent_result_index'],0)
        self.assertEqual(job['request']['source_layer']['id'],self.target);self.assertEqual(job['request']['source_asset'],completed['results'][0]['raw_asset'])
    def test_vertical_prompt_groups_punctuation_and_preserves_combining_marks(self):
        opts=l.options(dict(text='ビクッ!!',vertical=True));p=l.prompt(opts)
        self.assertIn('["ビ","ク","ッ","!!"]',p);self.assertIn('upright',p);self.assertNotIn('<Picture 1>',p)
        self.assertEqual(l.vertical_units('ヒ\u3099クッ！！'),['ヒ\u3099','ク','ッ','！！'])
        self.assertEqual(l.material_size(opts),(768,1280))
    def test_all_presets_have_specific_english_instructions(self):
        for preset in l.PRESETS:
            opts=l.options(dict(text='ドン!',preset=preset));p=l.prompt(opts)
            self.assertIn('"ドン!"',p);self.assertIn('generous empty margins',p)
            self.assertIn(l.STYLES[opts['style']]['style'],p);self.assertIn(l.DECORATIONS[opts['decoration']]['style'],p)
    def test_letter_transparency_clears_white_holes_and_near_white(self):
        image=Image.new('RGBA',(128,96),(254,254,254,255));d=ImageDraw.Draw(image);d.rectangle((30,20,90,70),fill='black');d.rectangle((45,35,75,55),fill='white')
        out,clipped=l.finish(image,l.options(dict(text='ロ')));self.assertFalse(clipped)
        self.assertEqual(out.getpixel((0,0))[3],0);self.assertEqual(out.getpixel((out.width//2,out.height//2))[3],0)
        self.assertEqual(max(out.getchannel('A').getdata()),255)
    def test_bubble_retains_white_inside_and_clears_only_exterior(self):
        image=Image.new('RGB',(128,96),'white');ImageDraw.Draw(image).rectangle((20,20,108,76),outline='black',width=3)
        out,_=l.finish(image,l.options(dict(text='ドン',preset='spiky')))
        self.assertEqual(out.getpixel((0,0))[3],0);self.assertEqual(out.getpixel((out.width//2,out.height//2)),(255,255,255,255))
    def test_capture_keeps_raw_and_adds_placed_processed_asset(self):
        job,_=self.prepare();image=Image.new('RGB',(320,192),'white');ImageDraw.Draw(image).rectangle((90,70,230,120),fill='black')
        done=g.capture_images(self.store,job['id'],[image]);item=done['results'][0]
        self.assertNotEqual(item['asset'],item['raw_asset']);self.assertEqual(self.store.image(item['raw_asset']).size,(320,192))
        self.assertLess(self.store.image(item['asset']).width,320);self.assertGreater(item['w'],0);self.assertLessEqual(item['x']+item['w'],128)
        self.assertEqual(self.store.read(self.record['id'])['document']['layers'][0]['visible'],True)
    def test_transparency_off_and_clipping_and_empty_results(self):
        image=Image.new('RGB',(128,96),'white');ImageDraw.Draw(image).rectangle((0,20,40,60),fill='black')
        out,clipped=l.finish(image,l.options(dict(text='x',transparent=False)));self.assertTrue(clipped);self.assertEqual(out.getchannel('A').getextrema(),(255,255))
        with self.assertRaises(s.ToolError):l.finish(Image.new('RGB',(128,96),'white'),l.options(dict(text='x')))

if __name__=='__main__':unittest.main()
