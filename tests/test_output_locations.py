import json,tempfile,unittest,types,sys
from pathlib import Path
from unittest.mock import patch
from PIL import Image
from support import load,storage,document
from aiohttp import web
from aiohttp.test_utils import TestClient,TestServer

locations=load('output_locations');saving=load('output_saving');lettering=load('lettering');schema=load('schema')

class FolderAndPlacementTests(unittest.TestCase):
 def test_choose_folder_persists_locally_and_projects_only_contain_opaque_id(self):
  with tempfile.TemporaryDirectory() as temp:
   store=storage.Store(Path(temp)/'store');dest=Path(temp)/'chosen';dest.mkdir()
   chosen=locations.choose(store,str(dest));self.assertEqual(locations.choose(store,str(dest)),chosen)
   doc=document();doc['settings']['output_location']=chosen['id'];self.assertNotIn(str(dest),json.dumps(schema.validate_document(doc)))
   self.assertEqual(locations.resolve(storage.Store(store.root),chosen['id']),dest.resolve())
   asset=store.put_image(Image.new('RGBA',(8,8),(10,20,30,100)))['asset']
   saving.save_candidates(store,{'id':'test','request':{'output_save':saving.options(doc['settings']|{'save_generated_images':True})}},[{'asset':asset}])
   self.assertEqual(len(list(dest.glob('*.webp'))),1)
 def test_folder_navigation_and_invalid_location(self):
  with tempfile.TemporaryDirectory() as temp:
   folder=Path(temp);(folder/'child').mkdir();(folder/'file.txt').write_text('keep')
   info=locations.folders(str(folder));self.assertEqual([x['name'] for x in info['folders']],['child'])
   store=storage.Store(folder/'store')
   with self.assertRaises(Exception):locations.choose(store,str(folder/'file.txt'))
   with self.assertRaises(Exception):locations.resolve(store,'a'*32)
 def test_lettering_fits_selection_box_without_clipping_or_changing_text(self):
  for size in [(1024,512),(512,1024)]:
   req={'placement_box':[20,30,100,80]};result=lettering.placement(req,size)
   self.assertGreaterEqual(result['x'],20);self.assertGreaterEqual(result['y'],30)
   self.assertLessEqual(result['x']+result['w'],120);self.assertLessEqual(result['y']+result['h'],110)
   self.assertAlmostEqual(result['w']/result['h'],size[0]/size[1])
 def test_language_default_and_override_validation(self):
  self.assertEqual(schema.default_document()['settings']['locale_mode'],'auto')
  doc=document();doc['settings']['locale_mode']='fr'
  with self.assertRaises(Exception):schema.validate_document(doc)
 def test_archive_roundtrip_retains_adjustment_sources_masks_paint_and_text(self):
  with tempfile.TemporaryDirectory() as temp:
   store=storage.Store(Path(temp)/'store');doc=document(8,8)
   source=store.put_image(Image.new('RGBA',(8,8),(100,60,30,200)))['asset']
   adjusted=store.put_image(Image.new('RGBA',(8,8),(100,90,30,200)))['asset']
   mask=store.put_image(Image.new('RGB',(8,8),'white'))['asset']
   paint=store.put_image(Image.new('RGBA',(8,8),(255,0,0,100)))['asset']
   def image(asset,**extra):return dict(id=schema.uid(),type='image',x=0,y=0,w=8,h=8,rotation=0,opacity=1,visible=True,asset=asset,**extra)
   doc['layers']=[image(source),image(adjusted,retouch={'type':'hue_saturation','settings':{'hue':30},'source_asset':source,'mask_asset':mask}),image(paint,paint=True),dict(id=schema.uid(),type='text',text='keep editable',x=0,y=0,w=8,h=8,rotation=0,opacity=1,visible=True)]
   doc['layers'][0]['visible']=False;record=store.create(doc)
   other=storage.Store(Path(temp)/'other');reopened=other.import_archive(store.export(record['id']))
   self.assertEqual(reopened['document']['layers'],doc['layers'])
   self.assertEqual(other.image(source).getpixel((0,0)),(100,60,30,200))
   self.assertEqual(other.image(paint).getchannel('A').getextrema(),(100,100))

class FolderAPITests(unittest.IsolatedAsyncioTestCase):
 async def test_navigation_registration_and_cross_origin_rejection(self):
  from support import MODELS,NODE_NAMES
  with tempfile.TemporaryDirectory() as temp:
   root=Path(temp);store=storage.Store(root/'store');(root/'pictures').mkdir()
   routes=web.RouteTableDef();load('api').register_routes(routes,lambda:store,lambda:MODELS,lambda:NODE_NAMES)
   app=web.Application();app.add_routes(routes)
   with patch.object(locations,'default_output',return_value=root):
    async with TestClient(TestServer(app)) as client:
     reply=await client.get('/ph3_image_tool/output/locations');self.assertEqual(reply.status,200)
     self.assertEqual((await reply.json())['default'],str(root))
     reply=await client.post('/ph3_image_tool/output/folders',json={'path':str(root)});self.assertEqual(reply.status,200)
     self.assertIn('pictures',[p['name'] for p in (await reply.json())['folders']])
     reply=await client.post('/ph3_image_tool/output/locations',json={'path':str(root/'pictures')});self.assertEqual(reply.status,200)
     choice=await reply.json();self.assertEqual(locations.resolve(store,choice['id']),root/'pictures')
     reply=await client.post('/ph3_image_tool/output/locations',json={'path':str(root)},headers={'Origin':'https://foreign.invalid'});self.assertEqual(reply.status,403)

class LetteringRegionTests(unittest.TestCase):
 def test_prepare_captures_region_and_rejects_outside_canvas(self):
  from support import generation,MODELS,NODE_NAMES
  with tempfile.TemporaryDirectory() as temp:
   store=storage.Store(temp);record=store.create(document())
   payload={'revision':0,'mode':'lettering','lettering':{'text':'ビクッ!!'},'placement_box':[10,20,80,40]}
   job,_=generation.prepare_job(store,record['id'],payload,MODELS,NODE_NAMES)
   self.assertEqual(job['request']['placement_box'],[10,20,80,40])
   self.assertEqual(job['request']['lettering']['text'],'ビクッ!!')
   payload['placement_box']=[100,20,80,40]
   with self.assertRaises(Exception):generation.prepare_job(store,record['id'],payload,MODELS,NODE_NAMES)
