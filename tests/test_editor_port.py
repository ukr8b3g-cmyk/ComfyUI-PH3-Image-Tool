import unittest
from unittest.mock import patch
from support import load,document,schema

class EditorPortTests(unittest.TestCase):
    def test_font_catalog_does_not_expose_paths(self):
        fonts=load('font_catalog')
        with patch.object(fonts,'system_fonts',return_value=[{'id':'a'*20,'family':'Sample','path':'private.ttf'}]):
            self.assertEqual(fonts.public_fonts(),[{'id':'a'*20,'family':'Sample'}])
            self.assertIsNone(fonts.font_by_id('../private.ttf'))
    def test_saved_typography_roundtrip(self):
        doc=document();doc['layers']=[{'id':'a'*32,'type':'text','x':0,'y':0,'w':300,'h':500,'fontId':'b'*20,'fontScaleX':125,'fontScaleY':90,'tracking':100,'text':'「こんにちは！」','vertical':True}]
        self.assertEqual(schema.validate_document(doc),doc)
        doc['layers'][0]['fontId']='../private.ttf'
        with self.assertRaises(schema.ToolError):schema.validate_document(doc)
    def test_nonfinite_typography_rejected(self):
        doc=document();doc['layers']=[{'id':'a'*32,'type':'text','x':0,'y':0,'w':300,'h':500,'fontScaleX':float('inf')}]
        with self.assertRaises(schema.ToolError):schema.validate_document(doc)
