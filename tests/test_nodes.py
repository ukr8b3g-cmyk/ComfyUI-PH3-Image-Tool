import tempfile
import unittest
from unittest.mock import patch
import numpy as np
import torch
from PIL import Image
from support import load, storage, document, generation, MODELS, NODE_NAMES

nodes=load('nodes')
class NodeTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.store=storage.Store(self.tmp.name);self.patch=patch.object(nodes,'get_store',return_value=self.store);self.patch.start()
    def tearDown(self):self.patch.stop();self.tmp.cleanup()
    def test_registration(self):
        self.assertEqual(set(nodes.NODE_CLASS_MAPPINGS),{'PH3ImageTool','PH3ImageToolAsset','PH3ImageToolResult','PH3ImageToolTextResult'})
    def test_capture_input_and_passthrough_without_project(self):
        result=nodes.PH3ImageTool().execute('',0,torch.ones((1,16,24,3)))
        self.assertEqual(tuple(result['result'][0].shape),(1,16,24,3));self.assertIn('ph3_input',result['ui'])
    def test_empty_node_fails_instead_of_silent_blank(self):
        with self.assertRaises(ValueError):nodes.PH3ImageTool().execute('',0)
    def test_committed_image_output_and_alpha(self):
        doc=document(24,16);doc['composite_asset']=self.store.put_image(Image.new('RGBA',(24,16),(20,30,40,128)))['asset'];rec=self.store.create(doc)
        result=nodes.PH3ImageTool().execute(rec['id'],0)['result'];self.assertEqual(tuple(result[0].shape),(1,16,24,3));self.assertAlmostEqual(result[1].mean().item(),128/255,places=5)
    def test_old_revision_not_executed(self):
        rec=self.store.create(document());self.store.save(rec['id'],rec['document'],0)
        with self.assertRaises(ValueError):nodes.PH3ImageTool().execute(rec['id'],0)
    def test_asset_is_rgb_with_transparency_flattened_for_model(self):
        asset=self.store.put_image(Image.new('RGBA',(8,8),(0,0,0,0)))['asset'];tensor=nodes.PH3ImageToolAsset().load(asset)[0]
        self.assertTrue(torch.all(tensor==1))
    def test_image_result_captures_job_without_changing_project(self):
        rec=self.store.create(document());job,_=generation.prepare_job(self.store,rec['id'],{'revision':0,'mode':'new'},MODELS,NODE_NAMES)
        result=nodes.PH3ImageToolResult().capture(torch.ones((1,64,64,3)),job['id'])
        self.assertEqual(result['ui']['ph3_job'],[job['id']]);self.assertEqual(self.store.read(rec['id']),rec)
    def test_nan_tensor_rejected(self):
        with self.assertRaises(ValueError):list(nodes.pil_images(torch.full((1,8,8,3),float('nan'))))
    def test_text_node_captures_only_text_requests(self):
        rec=self.store.create(document());job,_=generation.prepare_job(self.store,rec['id'],{'revision':0,'mode':'enhance'},MODELS,NODE_NAMES)
        nodes.PH3ImageToolTextResult().capture('Edit <Picture 1>. Add an apple.',job['id'])
        self.assertEqual(self.store.job(job['id'])['status'],'succeeded')
    def test_no_project_writes_for_blank_enhancer_output(self):
        rec=self.store.create(document());job,_=generation.prepare_job(self.store,rec['id'],{'revision':0,'mode':'enhance'},MODELS,NODE_NAMES)
        with self.assertRaises(ValueError):nodes.PH3ImageToolTextResult().capture(' ',job['id'])
        self.assertEqual(self.store.job(job['id'])['status'],'prepared')

    def test_native_enhancer_recovers_visual_sections_when_json_is_empty(self):
        project=self.store.create(document())
        raw=("subject_definitions:\n<Subject 1> is the red mug in <Picture 1>.\n\n"
             "summary:\n[keyframe completion] The mug is cobalt blue.\n\n"
             "retention_analysis:\nThe white interior and position are preserved.\n\n"
             'detailed_description:\nThe mug reads "ビクッ!!".\n\n'
             "overall_soundscape:\nSilence.\n\nnon_diegetic_music:\nNone.")
        request={"mode":"enhance","config":{"model_engine":generation.NATIVE_IMAGE}}
        expected=("<Subject 1> is the red mug in <Picture 1>.\n\nThe mug is cobalt blue.\n\n"
                  'The white interior and position are preserved.\n\nThe mug reads "ビクッ!!".')
        node=nodes.PH3ImageToolTextResult()
        for parsed,source,caption in (("",raw,expected),("Use the JSON caption",raw,"Use the JSON caption")):
            with self.subTest(parsed=parsed):
                job=self.store.create_job(project['id'],request)
                node.capture(parsed,job['id'],raw_text=source)
                self.assertEqual(self.store.job(job['id'])['text'],caption)
        for invalid in ("", '{"caption":"Wrong key"}', "summary:\nA blue mug.", raw+"x"*16000):
            with self.subTest(invalid=invalid[:40]):
                job=self.store.create_job(project['id'],request)
                with self.assertRaises(ValueError):
                    node.capture("",job['id'],raw_text=invalid)
                self.assertEqual(self.store.job(job['id'])['status'],'prepared')

if __name__=='__main__':unittest.main()
