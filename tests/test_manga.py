import tempfile
import unittest
import io
import numpy as np
from PIL import Image, ImageDraw
from support import load,storage,document,generation,MODELS,NODE_NAMES

manga=load('manga')
ref=load('manga_reference')

def fixture(w=512,h=320):
    values=np.tile(np.linspace(0,255,w,dtype=np.uint8),(h,1))
    img=Image.fromarray(values).convert('RGBA')
    d=ImageDraw.Draw(img);d.rectangle((w//5,h//5,w//2,h*4//5),fill='white',outline='black',width=3)
    d.line((20,30,w-30,h-20),fill='black',width=2)
    return img

class MangaTests(unittest.TestCase):
    def test_imported_presets_are_captured_without_changing_ph3_sampling(self):
        with tempfile.TemporaryDirectory() as tmp:
            store=storage.Store(tmp);asset=store.put_image(fixture(128,96))['asset']
            doc=document();layer={'id':'b'*32,'type':'image','asset':asset,'x':0,'y':0,'w':128,'h':96,'visible':True,'locked':False}
            doc['layers']=[layer];rec=store.create(doc)
            payload={'revision':0,'mode':'manga','source_asset':asset,'source_layer_id':layer['id']}
            for preset,black in [('standard',.3),('bold',.4)]:
                job,graph=generation.prepare_job(store,rec['id'],{**payload,'manga_preset':preset},MODELS,NODE_NAMES)
                self.assertEqual(job['request']['manga_preset'],preset)
                self.assertEqual(job['request']['manga_settings']['screen_lines'],250)
                self.assertEqual(job['request']['manga_settings']['black_point'],black)
                self.assertIn('<Picture 1>',graph['6']['inputs']['prompt'])
                self.assertNotIn('<image1>',graph['6']['inputs']['prompt'])
            with self.assertRaises(ValueError):
                generation.prepare_job(store,rec['id'],{**payload,'manga_preset':'unknown'},MODELS,NODE_NAMES)

    def test_matches_upstream_on_opaque_image(self):
        img=fixture();p=manga.options({'screen_lines':80})
        expected=ref.finish(np.asarray(img)[...,:3],p['screen_lines'],p['white_point'],p['black_point'],p['light_tone'],p['dark_tone'],p['gradation'],None,.3,p['white_lines'])
        _,flat,_=manga.finish_layers(img,p)
        np.testing.assert_array_equal(np.asarray(flat)[...,0],expected.astype(np.uint8)*255)

    def test_screen_strips_have_no_seams(self):
        import cv2
        cover=np.random.default_rng(5).random((223,343),dtype=np.float32)
        np.testing.assert_array_equal(manga.screen(cover,7.3,cv2,rows=37),ref.print_screen(cover,7.3))

    def test_alpha_partition_recompose_and_white_surfaces(self):
        img=fixture();a=np.tile(np.arange(256,dtype=np.uint8), (320,2));img.putalpha(Image.fromarray(a))
        before=img.tobytes();layers,flat,_=manga.finish_layers(img)
        np.testing.assert_array_equal(np.asarray(flat)[...,3],a)
        summed=sum(np.asarray(x)[...,3].astype(np.int32) for x in layers.values())
        np.testing.assert_array_equal(summed,a)
        self.assertEqual(img.tobytes(),before)
        white=Image.new('RGBA',(128,128),(255,255,255,200))
        parts,out,_=manga.finish_layers(white)
        self.assertEqual(out.getpixel((64,64)),(255,255,255,200))
        self.assertEqual(parts['paper'].getpixel((64,64)),(255,255,255,200))

    def test_hidden_rgb_has_no_effect(self):
        img=fixture();a=np.full((320,512),255,np.uint8);a[:,:100]=0;img.putalpha(Image.fromarray(a))
        other=np.array(img);other[:,:100,:3]=[255,0,0]
        _,x,_=manga.finish_layers(img);_,y,_=manga.finish_layers(Image.fromarray(other))
        self.assertEqual(x.tobytes(),y.tobytes())

    def test_small_images_and_validation(self):
        for size in [(1,1),(8,11),(63,96)]:
            _,out,p=manga.finish_layers(Image.new('RGBA',size,'white'));self.assertEqual(out.size,size)
        for p in [{'white_point':.3,'black_point':.3},{'gradation':float('nan')},{'light_tone':.8,'dark_tone':.1},{'screen_lines':40.5}]:
            with self.assertRaises(ValueError):manga.options(p)

    def test_finished_alpha_survives_lossless_encoding_in_memory(self):
        img=fixture(128,96);img.putalpha(Image.new('L',img.size,128))
        _,flat,_=manga.finish_layers(img)
        for fmt in ('png','webp'):
            blob,_=load('exporting').encode_image(flat,{'format':fmt,'preserve_alpha':True,'webp_lossless':True})
            decoded=Image.open(io.BytesIO(blob)).convert('RGBA')
            self.assertEqual(decoded.tobytes(),flat.tobytes())

    def test_manga_generation_and_portable_assets(self):
        with tempfile.TemporaryDirectory() as tmp:
            store=storage.Store(tmp);img=fixture(128,96);img.putalpha(Image.new('L',img.size,128));asset=store.put_image(img)['asset']
            doc=document();doc['prompt']['original']='';layer={'id':'b'*32,'type':'image','asset':asset,'x':0,'y':0,'w':128,'h':96,'visible':True,'locked':False}
            doc['layers']=[layer];rec=store.create(doc)
            job,graph=generation.prepare_job(store,rec['id'],{'revision':0,'mode':'manga','source_asset':asset,'source_layer_id':layer['id']},MODELS,NODE_NAMES)
            self.assertIn('black-and-white manga',graph['6']['inputs']['prompt'])
            self.assertEqual(graph['20']['inputs']['asset_id'],job['request']['crop_asset'])
            generation.capture_images(store,job['id'],[Image.new('RGB',(128,96),'white')])
            result=store.job(job['id'])['results'][0]
            self.assertEqual(len(result['layers']),4)
            self.assertEqual(store.image(result['asset']).getchannel('A').getextrema(),(128,128))
            self.assertNotEqual(result['raw_asset'],result['source_asset'])
            doc['layers'] += [{**layer,'id':str(i)*32,'asset':item['asset'],'processing':{'source_asset':result['source_asset']}} for i,item in enumerate(result['layers'],1)]
            store.save(rec['id'],doc,0);copy=store.import_archive(store.export(rec['id']))
            self.assertEqual(len(copy['document']['layers']),5)
            self.assertEqual(store.read(rec['id'])['document']['layers'][0],layer)

if __name__=='__main__':unittest.main()
