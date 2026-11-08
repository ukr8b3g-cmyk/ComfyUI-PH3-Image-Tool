import io, unittest
import numpy as np
from PIL import Image
from support import load,schema
exporting=load('exporting')
class ExportTests(unittest.TestCase):
    def fixture(self):
        image=Image.new('RGBA',(24,16),(240,80,20,255));image.putpixel((0,0),(12,34,56,0));image.putpixel((1,0),(240,80,20,128));return image
    def decode(self,opts):
        raw,mime=exporting.encode_image(self.fixture(),opts);return raw,mime,Image.open(io.BytesIO(raw))
    def test_png_is_lossless_at_all_compression_levels(self):
        expected=np.asarray(self.fixture());lengths=[]
        for level in [0,1,6,9]:
            raw,mime,img=self.decode({'format':'png','png_compression':level});self.assertEqual(mime,'image/png');np.testing.assert_array_equal(img,expected);lengths.append(len(raw))
        self.assertGreater(lengths[0],lengths[-1])
    def test_png_quality_setting_does_not_change_pixels(self):
        a,_,_=self.decode({'format':'png','quality':1});b,_,_=self.decode({'format':'png','quality':100});self.assertEqual(a,b)
    def test_lossless_webp_preserves_rgba(self):
        _,mime,image=self.decode({'format':'webp','webp_lossless':True});self.assertEqual(mime,'image/webp');np.testing.assert_array_equal(np.asarray(image.convert('RGBA')),np.asarray(self.fixture()))
    def test_lossy_webp_preserves_alpha(self):
        _,_,image=self.decode({'format':'webp','quality':45});np.testing.assert_array_equal(np.asarray(image.convert('RGBA'))[...,3],np.asarray(self.fixture())[...,3])
    def test_jpeg_flattens_against_selected_matte(self):
        _,mime,image=self.decode({'format':'jpeg','quality':100,'matte':'#ffffff'});self.assertEqual(mime,'image/jpeg');self.assertEqual(image.mode,'RGB');self.assertTrue(all(v>240 for v in image.getpixel((0,0))))
    def test_png_can_flatten_against_matte(self):
        _,_,image=self.decode({'format':'png','preserve_alpha':False,'matte':'#123456'});self.assertEqual(image.getpixel((0,0)),(18,52,86));self.assertEqual(image.mode,'RGB')
    def test_input_is_unchanged(self):
        src=self.fixture();before=src.tobytes();exporting.encode_image(src,{'format':'jpeg'});self.assertEqual(src.tobytes(),before)
    def test_invalid_options_refused(self):
        for value in [{'format':'gif'},{'quality':0},{'quality':101},{'png_compression':10},{'png_compression':True},{'webp_lossless':'true'},{'preserve_alpha':1},{'matte':'url(x)'},{'matte':'#ffffff00'}]:
            with self.subTest(value=value),self.assertRaises(schema.ToolError):exporting.encode_image(self.fixture(),value)
    def test_export_does_not_copy_private_metadata(self):
        src=self.fixture();src.info['parameters']='private prompt';raw,_=exporting.encode_image(src,{'format':'png'});self.assertNotIn(b'private prompt',raw)
