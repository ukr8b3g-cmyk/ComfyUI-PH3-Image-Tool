import concurrent.futures
import hashlib
import io
import json
import math
from pathlib import Path
import tempfile
import threading
import unittest
import zipfile
import numpy as np
from PIL import Image, ImageDraw
from support import schema as s, storage as st, generation as g, processing as p, document, MODELS, NODE_NAMES, NATIVE_MODELS


class SchemaTests(unittest.TestCase):
    def test_default_roundtrip(self):
        doc=document();self.assertEqual(s.validate_document(doc),doc)
    def test_reject_wrong_version(self):
        doc=document();doc['version']=99
        with self.assertRaises(s.ToolError):s.validate_document(doc)
    def test_reject_zero_nan_infinite_boolean_dimensions(self):
        for width in [0,-1,9000,float('nan'),float('inf'),True,'128']:
            with self.subTest(width=width),self.assertRaises(s.ToolError):s.dimensions(width,96)
    def test_pixel_limit(self):
        with self.assertRaises(s.ToolError):s.dimensions(8192,8192)
    def test_duplicate_layers(self):
        layer={'id':s.uid(),'type':'text','x':0,'y':0,'w':20,'h':20,'text':'Hi'}
        doc=document();doc['layers']=[layer,layer.copy()]
        with self.assertRaises(s.ToolError):s.validate_document(doc)
    def test_asset_paths_are_identifiers_not_paths(self):
        for key in ['../../x','/tmp/x','C:\\Windows','a'*65,'0'*63,None]:
            with self.subTest(key=key),self.assertRaises(s.ToolError):s.identifier(key,'asset')
    def test_prompt_bound(self):
        doc=document();doc['prompt']['original']='x'*16001
        with self.assertRaises(s.ToolError):s.validate_document(doc)
    def test_too_many_refs(self):
        doc=document();doc['references']=[{'asset':'a'*64}]*8
        with self.assertRaises(s.ToolError):s.validate_document(doc)
    def test_unknown_layer(self):
        doc=document();doc['layers']=[{'id':s.uid(),'type':'script'}]
        with self.assertRaises(s.ToolError):s.validate_document(doc)
    def test_nonfinite_nested(self):
        doc=document();doc['settings']['bad']=math.nan
        with self.assertRaises(s.ToolError):s.validate_document(doc)


class StoreTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.store=st.Store(self.tmp.name)
    def tearDown(self):self.tmp.cleanup()
    def make(self):
        doc=document();image=self.store.put_image(Image.new('RGBA',(128,96),(10,20,30,180)))
        doc['composite_asset']=image['asset'];return self.store.create(doc)
    def test_content_addressed_immutable(self):
        a=self.store.put_image(Image.new('RGB',(10,10),'red'));b=self.store.put_image(Image.new('RGB',(10,10),'red'))
        self.assertEqual(a,b);self.assertEqual(len(list((Path(self.tmp.name)/'assets').iterdir())),1)
    def test_bad_image(self):
        with self.assertRaises(s.ToolError):self.store.put_image(b'not an image')
    def test_compare_and_swap(self):
        record=self.make();updated=self.store.save(record['id'],record['document'],0)
        self.assertEqual(updated['revision'],1)
        with self.assertRaises(s.ToolError):self.store.save(record['id'],record['document'],0)
        self.assertEqual(self.store.read(record['id']),updated)
    def test_concurrent_save_exactly_one_wins(self):
        record=self.make();barrier=threading.Barrier(2)
        def save(_):
            barrier.wait()
            try:self.store.save(record['id'],record['document'],0);return True
            except s.ToolError:return False
        with concurrent.futures.ThreadPoolExecutor(2) as pool:results=list(pool.map(save,range(2)))
        self.assertEqual(sum(results),1)
    def test_save_missing_asset_keeps_old_document(self):
        record=self.make();doc=record['document'].copy();doc['composite_asset']='a'*64
        with self.assertRaises(s.ToolError):self.store.save(record['id'],doc,0)
        self.assertEqual(self.store.read(record['id']),record)
    def test_export_import(self):
        record=self.make();archive=self.store.export(record['id']);copy=self.store.import_archive(archive)
        self.assertNotEqual(record['id'],copy['id']);self.assertEqual(record['document'],copy['document'])
    def test_corrupt_archive_does_not_create_project(self):
        with self.assertRaises(s.ToolError):self.store.import_archive(b'bad zip')
        self.assertEqual(self.store.projects(),[])
    def test_path_traversal_rejected(self):
        out=io.BytesIO()
        with zipfile.ZipFile(out,'w') as z:z.writestr('project.json',json.dumps(document()));z.writestr('../escape.png',b'x')
        with self.assertRaises(s.ToolError):self.store.import_archive(out.getvalue())
    def test_hash_mismatch(self):
        record=self.make();doc=record['document'];out=io.BytesIO()
        with zipfile.ZipFile(out,'w') as z:z.writestr('project.json',json.dumps(doc));z.writestr('assets/'+doc['composite_asset']+'.png',b'bad')
        with self.assertRaises(s.ToolError):self.store.import_archive(out.getvalue())
    def test_job_states_are_idempotent(self):
        record=self.make();job=self.store.create_job(record['id'],{'mode':'enhance'})
        self.store.mark_job(job['id'],{'status':'queued','prompt_id':'valid-job'})
        self.store.finish_job(job['id'],text='hello');self.store.mark_job(job['id'],{'status':'queued','suppress_auto':True})
        self.assertEqual(self.store.job(job['id'])['status'],'succeeded')
        self.assertTrue(self.store.job(job['id'])['suppress_auto'])
    def test_corrupted_project_not_overwritten(self):
        record=self.make();path=self.store._path('projects',record['id']);path.write_text('{broken')
        with self.assertRaises(s.ToolError):self.store.save(record['id'],record['document'],0)
        self.assertEqual(path.read_text(),'{broken')


class GenerationTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.store=st.Store(self.tmp.name)
        pixels=np.arange(128*96*4,dtype=np.uint8).reshape(96,128,4);pixels[...,3]=255
        self.source=Image.fromarray(pixels);self.info=self.store.put_image(self.source)
        self.mask=Image.new('L',(128,96),0);ImageDraw.Draw(self.mask).rectangle((35,20,65,55),fill=255)
        doc=document();doc['selection_asset']=self.store.put_image(self.mask)['asset'];doc['settings']['feather']=4
        self.record=self.store.create(doc)
    def tearDown(self):self.tmp.cleanup()
    def prepare(self,mode='selection',models=None,nodes=None):
        return g.prepare_job(self.store,self.record['id'],{'revision':self.record['revision'],'mode':mode,'source_asset':self.info['asset']},models or MODELS,nodes or NODE_NAMES)
    def test_graph_is_standard_sampler_no_nested_engine(self):
        job,graph=self.prepare();names={node['class_type'] for node in graph.values()}
        self.assertIn('SamplerCustomAdvanced',names);self.assertIn('PH3ImageConditioning',names)
        self.assertEqual(graph['3']['inputs']['shift_video'],1)
        self.assertEqual(graph['9']['inputs']['sampler_name'],'er_sde')
        self.assertIn('images.image_1',graph['6']['inputs'])
        self.assertEqual(graph['90']['inputs']['job_id'],job['id'])
    def test_new_graph_has_no_source_or_reference(self):
        job,graph=self.prepare('new');self.assertNotIn('images.image_1',graph['6']['inputs'])
        self.assertFalse(job['request']['references'])
    def test_native_image_graph_uses_distilled_sampler_and_its_own_models(self):
        doc = self.record['document']
        doc['settings'].update(model_engine=g.NATIVE_IMAGE,
                               h3_image_unet_name=NATIVE_MODELS['diffusion_models'][0],
                               h3_image_clip_name=NATIVE_MODELS['text_encoders'][0],
                               h3_image_vae_name=NATIVE_MODELS['vae'][0])
        self.record = self.store.save(self.record['id'], doc, self.record['revision'])
        nodes = set(g.NATIVE_NODES) | {'PH3ImageToolAsset', 'PH3ImageToolResult'}
        job, graph = self.prepare('new', models=NATIVE_MODELS, nodes=nodes)
        self.assertEqual(graph['6']['class_type'], 'MiniMaxH3ImageConditioning')
        self.assertNotIn('images.image_1', graph['6']['inputs'])
        self.assertNotIn('lora_name', job['request']['config'])
        sampler = graph['11']
        self.assertEqual(sampler['class_type'], 'KSampler')
        self.assertEqual([sampler['inputs'][key] for key in ('steps', 'cfg', 'sampler_name', 'scheduler')],
                         [6, 1.0, 'euler', 'simple'])
        self.assertEqual(sampler['inputs']['latent_image'], ['6', 1])
        job, graph = self.prepare('selection', models=NATIVE_MODELS, nodes=nodes)
        self.assertTrue(job['request']['mask_asset'])
        self.assertGreater(job['request']['generation_size'][0], job['request']['region'][2])
        self.assertLessEqual(math.prod(job['request']['generation_size']), 1_000_000)
        self.assertEqual(graph['6']['inputs']['images.image_1'], ['20', 0])
        self.assertTrue(graph['6']['inputs']['prompt'].startswith('Edit <Picture 1>. '))
        self.assertEqual(graph['6']['inputs']['vae'], ['5', 0])
        with self.assertRaisesRegex(s.ToolError, 'MiniMaxH3ImageConditioning'):
            self.prepare(models=NATIVE_MODELS, nodes=nodes - {'MiniMaxH3ImageConditioning'})
    def test_text_enhance_does_not_generate_image(self):
        job,graph=self.prepare('enhance');names={x['class_type'] for x in graph.values()}
        self.assertIn('TextGenerateV2',names);self.assertNotIn('SamplerCustomAdvanced',names);self.assertNotIn('UNETLoader',names)
    def test_native_prompt_enhancer_uses_its_own_model_and_expanded_caption(self):
        doc = self.record['document']
        enhancer = NATIVE_MODELS['text_encoders'][1]
        doc['settings'].update(model_engine=g.NATIVE_IMAGE, h3_image_enhancer_name=enhancer)
        self.record = self.store.save(self.record['id'], doc, self.record['revision'])
        payload = {'mode': 'enhance', 'revision': self.record['revision'], 'source_asset': self.info['asset']}
        nodes = set(g.ENHANCER_NODES) | {'JsonExtractString'}
        _, graph = g.prepare_job(self.store, self.record['id'], {**payload, 'enhance_scope': 'new'}, NATIVE_MODELS, nodes)
        self.assertEqual(graph['1']['inputs']['clip_name'], enhancer)
        self.assertNotIn('images.image1', graph['2']['inputs'])
        self.assertEqual(graph['3']['inputs'], {'json_string': ['2', 0], 'key': 'expanded_caption'})
        self.assertEqual(graph['90']['inputs']['text'], ['3', 0])
        job, graph = g.prepare_job(self.store, self.record['id'], {**payload, 'enhance_scope': 'selection'}, NATIVE_MODELS, nodes)
        self.assertEqual(graph['2']['inputs']['images.image1'], ['20', 0])
        self.assertLess(job['request']['region'][2], doc['width'])
        self.assertIn('editing the first image', graph['2']['inputs']['prompt'])
    def test_reference_numbering_matches_model(self):
        doc=self.record['document'];doc['references']=[{'asset':self.info['asset'],'role':'outfit'}]
        self.record=self.store.save(self.record['id'],doc,0)
        job,graph=self.prepare('full');self.assertIn('images.image_2',graph['6']['inputs']);self.assertIn('<Picture 2>',job['request']['instruction'])
    def test_crop_padding_and_grid(self):
        job,_=self.prepare();x,y,w,h=job['request']['region'];gw,gh=job['request']['generation_size']
        self.assertLess(x,35);self.assertLess(y,20);self.assertGreater(w,31);self.assertEqual(gw%32,0);self.assertEqual(gh%32,0)
    def test_outside_selection_exactly_unchanged(self):
        job,_=self.prepare();finished=g.capture_images(self.store,job['id'],[Image.new('RGB',(64,64),'red')]);item=finished['results'][0]
        overlay=Image.new('RGBA',self.source.size);overlay.paste(self.store.image(item['asset']),(item['x'],item['y']))
        merged=Image.alpha_composite(self.source,overlay)
        outside=np.asarray(self.mask)==0
        np.testing.assert_array_equal(np.asarray(merged)[outside],np.asarray(self.source)[outside])
        self.assertTrue(np.any(np.asarray(merged)[~outside]!=np.asarray(self.source)[~outside]))
    def test_mask_and_raw_generation_remain_separate(self):
        job,_=self.prepare();done=g.capture_images(self.store,job['id'],[Image.new('RGB',(32,32),'blue')])
        self.assertTrue(self.store.image(done['request']['mask_asset']))
        self.assertNotEqual(done['results'][0]['asset'],done['results'][0]['raw_asset'])
        self.assertEqual(self.store.read(self.record['id']),self.record)
    def test_missing_model_rejected(self):
        bad={**MODELS,'loras':[]}
        with self.assertRaises(s.ToolError):self.prepare(models=bad)
    def test_missing_core_node_rejected(self):
        with self.assertRaises(s.ToolError):self.prepare(nodes=NODE_NAMES-{'PH3ImageConditioning'})
    def test_stale_project_rejected(self):
        self.store.save(self.record['id'],self.record['document'],0)
        with self.assertRaises(s.ToolError):self.prepare()
    def test_empty_selection_rejected(self):
        doc=self.record['document'];doc['selection_asset']=self.store.put_image(Image.new('L',(128,96),0))['asset'];self.record=self.store.save(self.record['id'],doc,0)
        with self.assertRaises(s.ToolError):self.prepare()
    def test_bad_mask_size_rejected(self):
        doc=self.record['document'];doc['selection_asset']=self.store.put_image(Image.new('L',(64,64),255))['asset'];self.record=self.store.save(self.record['id'],doc,0)
        with self.assertRaises(s.ToolError):self.prepare()
    def test_bad_seed_rejected(self):
        for seed in ['-1','18446744073709551615','nan']:
            with self.subTest(seed=seed),self.assertRaises(s.ToolError):g.model_config({**self.record['document']['settings'],'seed':seed},MODELS)
    def test_sigma_validation(self):
        for value in ['1, nan, 0','1, .5, .6, 0','1, 0','0.9, .5, 0','1, .5, -1']:
            with self.subTest(value=value),self.assertRaises(s.ToolError):g.checked_sigmas(value)
    def test_resizing_does_not_center_crop(self):
        job,_=self.prepare('full');gen=Image.new('RGB',(32,32),'white');ImageDraw.Draw(gen).rectangle((0,0,3,31),fill='black')
        done=g.capture_images(self.store,job['id'],[gen]);out=self.store.image(done['results'][0]['asset']);self.assertEqual(out.size,(128,96));self.assertLess(out.getpixel((0,50))[0],5);self.assertGreater(out.getpixel((127,50))[0],250)


class ProcessingTests(unittest.TestCase):
    def test_every_comic_preset_keeps_alpha_and_dimensions(self):
        image=Image.new('RGBA',(64,64),(120,80,200,90))
        for preset in p.COMIC_PRESETS:
            with self.subTest(preset=preset):
                result=p.comic(image,preset);self.assertEqual(result.size,image.size);self.assertEqual(result.getchannel('A').tobytes(),image.getchannel('A').tobytes())
    def test_comic_zero_strength_is_identity(self):
        image=Image.new('RGBA',(32,32),(56,87,123,190));self.assertEqual(p.comic(image,strength=0).tobytes(),image.tobytes())
    def test_connected_color_only(self):
        image=Image.new('RGBA',(20,20),'green');draw=ImageDraw.Draw(image);draw.rectangle((5,5,14,14),fill='red');draw.rectangle((8,8,10,10),fill='green')
        out=p.color_cutout(image,0);self.assertEqual(out.getpixel((0,0))[3],0);self.assertEqual(out.getpixel((9,9))[3],255);self.assertEqual(out.getpixel((6,6))[3],255)
    def test_selection_multiplies_existing_alpha(self):
        result=p.selection_cutout(Image.new('RGBA',(8,8),(20,40,60,128)),Image.new('L',(8,8),128));self.assertEqual(result.getpixel((0,0))[3],64)
    def test_no_ai_dependency_autoinstall(self):
        from unittest.mock import patch
        with patch.object(p,'onnx_available',return_value=False),self.assertRaises(s.ToolError):p.isnet_cutout(Image.new('RGB',(5,5)),Path('/missing/model.onnx'))
    def test_bad_cutout_method_does_not_change_source(self):
        image=Image.new('RGBA',(5,5),'white');before=image.tobytes()
        with self.assertRaises(s.ToolError):p.color_cutout(image,-1)
        self.assertEqual(image.tobytes(),before)

if __name__=='__main__':unittest.main()
