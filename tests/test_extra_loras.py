import copy
import unittest
from support import schema as s, generation as g, document, MODELS

class ExtraLoraTests(unittest.TestCase):
    def available(self):
        result=copy.deepcopy(MODELS);result['loras'] += ['style/a.safetensors','detail/b.safetensors'];return result
    def graph(self,settings):
        return g.build_graph({'id':'test','request':{'mode':'new','config':g.model_config(settings,self.available()),'instruction':'test','generation_size':[128,96]}})
    def test_default_and_legacy_do_not_add_loaders(self):
        settings=document()['settings'];self.assertEqual(len(settings['extra_loras']),2)
        self.assertTrue(all(not slot['enabled'] for slot in settings['extra_loras']))
        for legacy in [False,True]:
            cfg=copy.deepcopy(settings)
            if legacy:cfg.pop('extra_loras')
            graph=self.graph(cfg);self.assertNotIn('30',graph);self.assertEqual(graph['3']['inputs']['model'],['2',0])
    def test_two_slots_chain_in_order_and_keep_primary(self):
        settings=document()['settings'];settings['extra_loras']=[{'enabled':True,'name':'style/a.safetensors','strength':.75},{'enabled':True,'name':'detail/b.safetensors','strength':-.25}]
        graph=self.graph(settings)
        self.assertEqual(graph['2']['inputs']['lora_name'],MODELS['loras'][0]);self.assertEqual(graph['2']['inputs']['strength_model'],1)
        self.assertEqual(graph['30']['inputs'],dict(model=['2',0],lora_name='style/a.safetensors',strength_model=.75))
        self.assertEqual(graph['31']['inputs']['model'],['30',0]);self.assertEqual(graph['31']['inputs']['strength_model'],-.25)
        self.assertEqual(graph['3']['inputs']['model'],['31',0])
    def test_disabled_none_and_zero_never_load(self):
        for slot in [{'enabled':False,'name':'missing','strength':1},{'enabled':True,'name':'','strength':1},{'enabled':True,'name':'missing','strength':0}]:
            settings=document()['settings'];settings['extra_loras']=[slot];self.assertNotIn('30',self.graph(settings))
    def test_active_missing_model_is_rejected(self):
        settings=document()['settings'];settings['extra_loras']=[{'enabled':True,'name':'../outside.safetensors','strength':1}]
        with self.assertRaises(s.ToolError):self.graph(settings)
    def test_bad_slots_rejected_before_queue_and_save(self):
        for slots in [{},[{}, {}, {}],[{'enabled':'true'}],[{'strength':True}],[{'strength':float('nan')}],[{'strength':11}],[{'name':[]}]]:
            with self.subTest(slots=slots):
                doc=document();doc['settings']['extra_loras']=slots
                with self.assertRaises(s.ToolError):s.validate_document(doc)
                with self.assertRaises(s.ToolError):g.model_config(doc['settings'],self.available())
    def test_document_roundtrip_preserves_disabled_choice(self):
        doc=document();doc['settings']['extra_loras'][1].update(name='detail/b.safetensors',strength=.3)
        self.assertEqual(s.validate_document(doc)['settings']['extra_loras'][1],doc['settings']['extra_loras'][1])

if __name__=='__main__':unittest.main()
