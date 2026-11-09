import io
import tempfile
import unittest
from aiohttp import web, FormData
from aiohttp.test_utils import TestClient, TestServer
from PIL import Image
from support import load,storage,document,MODELS,NODE_NAMES

api=load('api')

class APITests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.store=storage.Store(self.tmp.name);routes=web.RouteTableDef()
        catalog={**MODELS,'missing_nodes':[],'cutout':{}}
        api.register_routes(routes,lambda:self.store,lambda:catalog,lambda:NODE_NAMES)
        app=web.Application(client_max_size=260*1024*1024);app.add_routes(routes);self.client=TestClient(TestServer(app));await self.client.start_server()
    async def asyncTearDown(self):await self.client.close();self.tmp.cleanup()
    async def create(self):
        response=await self.client.post('/ph3_image_tool/projects',json={'document':document()});self.assertEqual(response.status,200);return await response.json()
    async def test_create_save_conflict(self):
        rec=await self.create();url='/ph3_image_tool/projects/'+rec['id'];body={'revision':0,'document':rec['document']}
        self.assertEqual((await self.client.put(url,json=body)).status,200)
        self.assertEqual((await self.client.put(url,json=body)).status,409)
    async def test_new_canvas_cap_and_legacy_document_import(self):
        for width,height in [(2049,1),(1,2049)]:
            response=await self.client.post('/ph3_image_tool/projects',json={'width':width,'height':height})
            self.assertEqual(response.status,400);self.assertEqual((await response.json())['error']['code'],'CANVAS_LIMIT')
        response=await self.client.post('/ph3_image_tool/projects',json={'width':2048,'height':2048})
        self.assertEqual(response.status,200)
        # Metadata-only legacy copy: do not allocate a large raster.
        response=await self.client.post('/ph3_image_tool/projects',json={'document':document(2049,1)})
        self.assertEqual(response.status,200);record=await response.json()
        saved=await self.client.put('/ph3_image_tool/projects/'+record['id'],json={'revision':record['revision'],'document':record['document']})
        self.assertEqual(saved.status,200)
    async def test_cross_origin_write_refused(self):
        r=await self.client.post('/ph3_image_tool/projects',json={},headers={'Origin':'https://evil.example'})
        self.assertEqual(r.status,403);self.assertEqual(self.store.projects(),[])
    async def test_same_origin_allowed(self):
        base=str(self.client.make_url('/')).rstrip('/')
        r=await self.client.post('/ph3_image_tool/projects',json={},headers={'Origin':base});self.assertEqual(r.status,200)
    async def test_asset_upload_and_fetch(self):
        buf=io.BytesIO();Image.new('RGB',(24,20),'red').save(buf,format='PNG');form=FormData();form.add_field('file',buf.getvalue(),filename='../../unsafe.png',content_type='image/png')
        r=await self.client.post('/ph3_image_tool/assets',data=form);self.assertEqual(r.status,200);info=await r.json()
        response=await self.client.get('/ph3_image_tool/assets/'+info['asset']);self.assertEqual(response.status,200);self.assertEqual(response.content_type,'image/png')
    async def test_missing_asset_404(self):
        self.assertEqual((await self.client.get('/ph3_image_tool/assets/'+'a'*64)).status,404)
    async def test_invalid_id_refused(self):
        self.assertEqual((await self.client.get('/ph3_image_tool/projects/not-a-project')).status,400)
    async def test_prepare_and_state(self):
        rec=await self.create();r=await self.client.post('/ph3_image_tool/projects/'+rec['id']+'/prepare',json={'revision':0,'mode':'new'})
        self.assertEqual(r.status,200);prepared=await r.json();self.assertIn('prompt',prepared)
        job=prepared['job'];r=await self.client.post('/ph3_image_tool/jobs/'+job['id']+'/state',json={'prompt_id':'abc-123','status':'queued'})
        self.assertEqual(r.status,200);self.assertEqual((await r.json())['status'],'queued')
    async def test_explicit_image_export(self):
        info=self.store.put_image(Image.new('RGBA',(24,20),(255,0,0,0)))
        for kind,mime in [('png','image/png'),('webp','image/webp'),('jpeg','image/jpeg')]:
            r=await self.client.post('/ph3_image_tool/encode',json={'asset':info['asset'],'format':kind,'webp_lossless':True})
            self.assertEqual(r.status,200);self.assertEqual(r.content_type,mime)
            image=Image.open(io.BytesIO(await r.read()));self.assertEqual(image.size,(24,20))
    async def test_export_validates_options_and_origin(self):
        info=self.store.put_image(Image.new('RGB',(24,20),'blue'))
        r=await self.client.post('/ph3_image_tool/encode',json={'asset':info['asset'],'format':'gif'})
        self.assertEqual(r.status,400)
        r=await self.client.post('/ph3_image_tool/encode',json={'asset':info['asset']},headers={'Origin':'https://other.example'})
        self.assertEqual(r.status,403)
    async def test_unknown_process_refused(self):
        info=self.store.put_image(Image.new('RGB',(24,20),'blue'))
        r=await self.client.post('/ph3_image_tool/process',json={'asset':info['asset'],'action':'exec'})
        self.assertEqual(r.status,400)
    async def test_manga_finish_returns_layers_without_mutating_project(self):
        rec=await self.create();info=self.store.put_image(Image.new('RGBA',(128,96),(255,255,255,128)))
        r=await self.client.post('/ph3_image_tool/process',json={'asset':info['asset'],'action':'manga_finish','settings':{'screen_lines':80}})
        self.assertEqual(r.status,200);result=await r.json();self.assertEqual(len(result['layers']),4)
        self.assertEqual(self.store.image(result['asset']).getpixel((64,48)),(255,255,255,128))
        self.assertEqual(self.store.read(rec['id']),rec)
        bad=await self.client.post('/ph3_image_tool/process',json={'asset':info['asset'],'action':'manga_finish','settings':{'black_point':.8,'white_point':.3}})
        self.assertEqual(bad.status,400)
    async def test_malformed_json_refused(self):
        r=await self.client.post('/ph3_image_tool/projects',data='{oops',headers={'Content-Type':'application/json'})
        self.assertEqual(r.status,400)
    async def test_archive_roundtrip_via_http(self):
        rec=await self.create();r=await self.client.get('/ph3_image_tool/projects/'+rec['id']+'/export');blob=await r.read();form=FormData();form.add_field('file',blob,filename='copy.ph3tool')
        imported=await self.client.post('/ph3_image_tool/import',data=form);self.assertEqual(imported.status,200);new=await imported.json();self.assertNotEqual(new['id'],rec['id'])

    async def test_lettering_finish_preview_save_and_reject_stale_geometry(self):
        rec=await self.create();lettering=load('lettering');generation=load('generation')
        opts=lettering.options(dict(text='ビクッ!!',style='cute'))
        job,_=generation.prepare_job(self.store,rec['id'],dict(revision=0,mode='lettering',lettering=opts),MODELS,NODE_NAMES)
        image=Image.new('RGB',(240,160),'white');from PIL import ImageDraw
        ImageDraw.Draw(image).rectangle((50,40,180,120),fill='black');generation.capture_images(self.store,job['id'],[image])
        url='/ph3_image_tool/projects/'+rec['id']+'/lettering/finish'
        payload=dict(reference_job_id=job['id'],lettering=dict(opts,color_mode='gradient'))
        response=await self.client.post(url,json=payload);self.assertEqual(response.status,200);self.assertIn('asset',await response.json())
        response=await self.client.post(url,json=dict(payload,save=True,revision=0));self.assertEqual(response.status,200);saved=(await response.json())['job'];self.assertTrue(saved['request']['finish_only']);self.assertEqual(saved['request']['config']['seed'],job['request']['config']['seed'])
        self.assertEqual((await self.client.post(url,json=dict(payload,save=True,revision=5))).status,409)
        self.assertEqual((await self.client.post(url,json=dict(payload,lettering=dict(opts,decoration='spiky')))).status,400)
        self.assertEqual(self.store.read(rec['id']),rec)
    async def test_lettering_capabilities_include_independent_style_and_decoration(self):
        response=await self.client.get('/ph3_image_tool/capabilities');data=await response.json()
        self.assertTrue(data['lettering_finishing']);self.assertTrue({'pop','cute','fancy'}<={x['id'] for x in data['lettering_styles']})
        self.assertTrue({'none','spiky','wavy'}<={x['id'] for x in data['lettering_decorations']})

if __name__=='__main__':unittest.main()
