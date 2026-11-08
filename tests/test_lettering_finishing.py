import tempfile
import unittest
import numpy as np
from PIL import Image, ImageDraw
from support import load, storage as st, schema as s, document
l=load('lettering')

class FinishingTests(unittest.TestCase):
    def opts(self,**kw):return l.options(dict(text='ビクッ!!',**kw))
    def sample(self):
        im=Image.new('RGB',(240,160),'white');d=ImageDraw.Draw(im);d.rectangle((50,40,90,120),fill='black');d.rectangle((130,40,170,120),fill='black');return im
    def test_new_styles_and_legacy_defaults_and_no_bubble_contradiction(self):
        for style in ('pop','cute','fancy'):
            for decoration in ('none','spiky','vibration','wavy'):
                opts=self.opts(style=style,decoration=decoration,vertical=True);p=l.prompt(opts)
                self.assertIn('"ビクッ!!"',p);self.assertIn('exactly two stems and exactly two dots',p)
                if decoration=='spiky':self.assertNotIn('Do not add a surrounding bubble',p)
        self.assertEqual(self.opts(preset='round')['style'],'pop');self.assertEqual(self.opts(preset='spiky')['decoration'],'spiky')
        self.assertFalse(self.opts()['use_reference'])
    def test_invalid_options_rejected(self):
        for k,v in [('style',[]),('decoration','x'),('color_mode','x'),('color','red'),('gradient_end','#00ff'),('gradient_direction','x'),('tremble_strength',float('nan')),('tremble_strength',2)]:
            with self.subTest(k=k),self.assertRaises(s.ToolError):self.opts(**{k:v})
    def test_color_and_gradient_keep_the_exact_alpha(self):
        im=self.sample();black,_=l.finish(im,self.opts());solid,_=l.finish(im,self.opts(color_mode='solid',color='#ff0000'))
        self.assertTrue(np.array_equal(np.asarray(black.getchannel('A')),np.asarray(solid.getchannel('A'))))
        rgb=np.asarray(solid);self.assertTrue((rgb[rgb[...,3]>0,:3]==[255,0,0]).all())
        for direction in ('horizontal','vertical','diagonal'):
            out,_=l.finish(im,self.opts(color_mode='gradient',color='#ff0000',gradient_end='#0000ff',gradient_direction=direction));arr=np.asarray(out)
            self.assertTrue(np.array_equal(arr[...,3],np.asarray(black)[...,3]));ink=arr[arr[...,3]>200,:3]
            self.assertGreater(int(ink[:,0].max())-int(ink[:,0].min()),200);self.assertGreater(int(ink[:,2].max())-int(ink[:,2].min()),200)
    def test_bubble_outer_antialias_is_black_not_white_and_inside_is_opaque(self):
        hi=Image.new('RGB',(960,640),'white');d=ImageDraw.Draw(hi);d.ellipse((60,40,900,600),outline='black',width=16);d.rectangle((300,220,400,420),fill='black');im=hi.resize((240,160),Image.Resampling.LANCZOS)
        out,_=l.finish(im,self.opts(decoration='spiky',color_mode='solid',color='#ff0000'));a=np.asarray(out)
        partial=(a[...,3]>0)&(a[...,3]<255);self.assertTrue(partial.any());self.assertTrue((a[partial,:3]==0).all())
        self.assertTrue(((a[...,0]==255)&(a[...,1]==255)&(a[...,2]==255)&(a[...,3]==255)).any())
        self.assertTrue(((a[...,0]==255)&(a[...,1]==0)&(a[...,2]==0)&(a[...,3]==255)).any())
        self.assertTrue((a[...,3]==0).any())
    def test_color_does_not_leak_into_a_thick_bubble_rim(self):
        im=Image.new('RGB',(240,160),'white');d=ImageDraw.Draw(im);d.rectangle((10,10,230,150),outline='black',width=20);d.rectangle((80,60,100,100),fill='black')
        out,_=l.finish(im,self.opts(decoration='spiky',color_mode='solid',color='#ff0000'));a=np.asarray(out)
        red=(a[...,0]>a[...,1])&(a[...,3]>0);self.assertEqual(int(red.sum()),21*41)
        self.assertTrue(((a[...,0]==0)&(a[...,1]==0)&(a[...,2]==0)&(a[...,3]==255)).any())
    def test_tremble_is_repeatable_strength_controlled_and_retains_components(self):
        im=self.sample();normal,_=l.finish(im,self.opts());zero,_=l.finish(im,self.opts(decoration='wavy',tremble_strength=0));wave,_=l.finish(im,self.opts(decoration='wavy',tremble_strength=1));again,_=l.finish(im,self.opts(decoration='wavy',tremble_strength=1))
        self.assertEqual(normal.tobytes(),zero.tobytes());self.assertEqual(wave.tobytes(),again.tobytes());self.assertNotEqual(wave.tobytes(),normal.tobytes())
        # Empty central band stays empty: two disconnected strokes cannot gain punctuation.
        a=np.asarray(wave.getchannel('A'));self.assertFalse((a[:,55:70]>0).any());self.assertGreater(a.sum(),.9*np.asarray(normal.getchannel('A')).sum())
    def test_refinish_is_nondestructive_validates_geometry_project_and_revision(self):
        with tempfile.TemporaryDirectory() as tmp:
            store=st.Store(tmp);rec=store.create(document());req=dict(mode='lettering',lettering=self.opts(),canvas=[128,96],source_layer=None,canvas_revision=0,document_revision=0,config={'seed':42})
            job=store.create_job(rec['id'],req);raw=store.put_image(self.sample())['asset'];source=store.finish_job(job['id'],results=[dict(asset=raw,raw_asset=raw)])
            payload=dict(reference_job_id=source['id'],reference_index=0,lettering=self.opts(color_mode='gradient'))
            count=len(store.jobs(rec['id']));preview=l.refinish(store,rec['id'],payload);self.assertEqual(len(store.jobs(rec['id'])),count);self.assertEqual(preview['raw_asset'],raw)
            saved=l.refinish(store,rec['id'],dict(payload,save=True,revision=0))['job'];self.assertEqual(saved['status'],'succeeded');self.assertTrue(saved['request']['finish_only']);self.assertEqual(saved['request']['parent_job_id'],source['id']);self.assertEqual(saved['results'][0]['raw_asset'],raw)
            self.assertEqual(store.read(rec['id']),rec);self.assertEqual(store.job(source['id']),source)
            for bad in [dict(payload,save=True,revision=5),dict(payload,lettering=self.opts(decoration='spiky')),dict(payload,reference_index=1)]:
                with self.assertRaises(s.ToolError):l.refinish(store,rec['id'],bad)
            other=store.create(document())
            with self.assertRaises(s.ToolError):l.refinish(store,other['id'],payload)
    def test_refinish_captures_adopted_parent_and_current_canvas_for_placement(self):
        with tempfile.TemporaryDirectory() as tmp:
            store=st.Store(tmp);rec=store.create(document());req=dict(mode='lettering',lettering=self.opts(),canvas=[128,96],source_layer=None,canvas_revision=0,document_revision=0,config={'seed':42})
            job=store.create_job(rec['id'],req);raw=store.put_image(self.sample())['asset'];store.finish_job(job['id'],results=[dict(asset=raw,raw_asset=raw)])
            doc=rec['document'];doc.update(width=64,height=64);layer=dict(id=s.uid(),type='image',asset=raw,x=4,y=8,w=40,h=20,rotation=30,generation=dict(job_id=job['id'],result_index=0));doc['layers']=[layer];store.save(rec['id'],doc,0)
            child=l.refinish(store,rec['id'],dict(reference_job_id=job['id'],lettering=self.opts(color_mode='solid'),save=True,revision=1))['job']
            self.assertEqual(child['request']['parent_layer']['id'],layer['id']);self.assertEqual(child['request']['canvas'],[64,64]);result=child['results'][0]
            self.assertLessEqual(result['x']+result['w'],64);self.assertLessEqual(result['y']+result['h'],64)

if __name__=='__main__':unittest.main()
