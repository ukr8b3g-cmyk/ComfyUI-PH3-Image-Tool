import copy
import unittest
from support import schema as s, generation as g, document, MODELS

class PrimaryLoraTests(unittest.TestCase):
    def graph(self,settings):
        return g.build_graph({'id':'test','request':{'mode':'new','config':g.model_config(settings,MODELS),'instruction':'test','generation_size':[128,96]}})
    def test_default_and_legacy(self):
        doc=document();self.assertEqual(doc['settings']['ph3_lora_strength'],1.0)
        doc['settings'].pop('ph3_lora_strength')
        self.assertEqual(self.graph(doc['settings'])['2']['inputs']['strength_model'],1.0)
    def test_value_roundtrip_and_graph(self):
        for value in [0,.5,1,1.25,-10,10]:
            doc=document();doc['settings']['ph3_lora_strength']=value
            self.assertEqual(s.validate_document(doc)['settings']['ph3_lora_strength'],value)
            self.assertEqual(self.graph(doc['settings'])['2']['inputs']['strength_model'],value)
    def test_invalid_rejected_at_save_and_queue(self):
        for value in [True,None,'1',float('nan'),float('inf'),-10.1,10.1]:
            doc=document();doc['settings']['ph3_lora_strength']=value
            with self.assertRaises(s.ToolError):s.validate_document(doc)
            with self.assertRaises(s.ToolError):g.model_config(doc['settings'],MODELS)
    def test_independent_extra_slots(self):
        doc=document();doc['settings']['ph3_lora_strength']=.6
        doc['settings']['extra_loras']=[{'enabled':True,'name':MODELS['loras'][0],'strength':.2},{'enabled':True,'name':MODELS['loras'][0],'strength':.8}]
        original=copy.deepcopy(doc['settings']['extra_loras']);graph=self.graph(doc['settings'])
        self.assertEqual([graph[k]['inputs']['strength_model'] for k in ['2','30','31']],[.6,.2,.8])
        self.assertEqual(doc['settings']['extra_loras'],original)
if __name__=='__main__':unittest.main()
