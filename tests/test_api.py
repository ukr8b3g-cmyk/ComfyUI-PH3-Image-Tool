import io
import tempfile
import unittest
from aiohttp import web, FormData
from aiohttp.test_utils import TestClient, TestServer
from PIL import Image, ImageChops
from support import load,storage,document,MODELS,NODE_NAMES,NATIVE_MODELS,generation,schema

api=load('api')

class APITests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.store=storage.Store(self.tmp.name);routes=web.RouteTableDef()
        self.catalog={**MODELS,'missing_nodes':[],'cutout':{}}
        self.nodes=NODE_NAMES.copy()
        api.register_routes(routes,lambda:self.store,lambda:self.catalog,lambda:self.nodes)
        app=web.Application(client_max_size=260*1024*1024);app.add_routes(routes);self.client=TestClient(TestServer(app));await self.client.start_server()
    async def asyncTearDown(self):await self.client.close();self.tmp.cleanup()
    async def create(self):
        response=await self.client.post('/ph3_image_tool/projects',json={'document':document()});self.assertEqual(response.status,200);return await response.json()
    async def test_capability_version_matches_distribution(self):
        from support import ROOT
        import re
        metadata = (ROOT / 'pyproject.toml').read_text(encoding='utf-8')
        version = re.search(r'^version\s*=\s*"([^"]+)"', metadata, re.MULTILINE).group(1)
        response = await self.client.get('/ph3_image_tool/capabilities')
        self.assertEqual((await response.json())['version'], version)

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

    async def test_reblend_adjusts_existing_selection_inside_its_boundary_without_a_job(self):
        doc = document(192, 160)
        source = Image.new('RGB', (192, 160), (90, 105, 120))
        mask = Image.new('L', source.size, 0)
        mask.paste(255, (40, 30, 152, 138))
        doc['selection_asset'] = self.store.put_image(mask)['asset']
        source_asset = self.store.put_image(source)['asset']
        record = self.store.create(doc)
        url = '/ph3_image_tool/projects/' + record['id']
        prepared = await self.client.post(url + '/prepare', json={
            'revision': 0, 'mode': 'selection', 'source_asset': source_asset,
        })
        self.assertEqual(prepared.status, 200)
        request = (await prepared.json())['job']['request']
        self.assertEqual(request['selection_asset'], doc['selection_asset'])
        self.assertEqual(request['selection_feather'], doc['settings']['feather'])
        x, y, w, h = request['region']
        crop = (x, y, x + w, y + h)
        selected = mask.crop(crop)
        patch = Image.new('RGB', (w, h), (104, 118, 131))
        patch.paste((207, 29, 25), (41 - x, 69 - y, 55 - x, 90 - y))
        result_asset = self.store.put_image(patch)['asset']
        payload = {key: request[key] for key in ('region', 'source_asset', 'mask_asset', 'selection_asset')}
        payload.update(result_asset=result_asset, feather=request['selection_feather'], color_strength=0)
        jobs = self.store.jobs(record['id'])
        assets = set((self.store.root / 'assets').iterdir())
        endpoint = '/ph3_image_tool/selection/reblend'
        preview = await self.client.post(endpoint, json={**payload, 'preview': True})
        self.assertEqual((preview.status, preview.content_type), (200, 'image/png'))
        before = Image.open(io.BytesIO(await preview.read()))
        self.assertEqual(before.getchannel('A').tobytes(), self.store.image(payload['mask_asset']).getchannel('R').tobytes())
        self.assertEqual(set((self.store.root / 'assets').iterdir()), assets)

        response = await self.client.post(endpoint, json={**payload, 'feather': 16, 'color_strength': 85})
        self.assertEqual(response.status, 200)
        result = await response.json()
        adjusted = self.store.image(result['asset']).convert('RGB')
        alpha = self.store.image(result['mask_asset']).getchannel('R')
        original = source.crop(crop)
        edge, center, red = (48 - x, 50 - y), (96 - x, 85 - y), (49 - x, 80 - y)
        self.assertLess(adjusted.getpixel(edge)[0], patch.getpixel(edge)[0])
        self.assertEqual(adjusted.getpixel(center), patch.getpixel(center))
        self.assertEqual(adjusted.getpixel(red), patch.getpixel(red))
        self.assertLess(alpha.getpixel(edge), before.getchannel('A').getpixel(edge))
        composite = Image.composite(adjusted, original, alpha)
        diff = ImageChops.difference(composite, original)
        self.assertIsNone(Image.composite(Image.new('RGB', patch.size), diff, selected).getbbox())

        legacy = await self.client.post(endpoint, json={**payload, 'selection_asset': None, 'feather': 0})
        self.assertEqual(await legacy.json(), {'asset': result_asset, 'mask_asset': request['mask_asset']})
        self.assertEqual(self.store.jobs(record['id']), jobs)
        self.assertEqual(self.store.read(record['id']), record)

    async def test_legacy_tight_crop_matches_full_selection_at_interior_and_canvas_edges(self):
        source = Image.new('RGB', (96, 96), (100, 100, 100))
        patch = Image.new('RGB', (48, 48), (110, 110, 110))
        mask = Image.new('L', patch.size, 255)
        asset = lambda image: self.store.put_image(image)['asset']
        payload = dict(source_asset=asset(source), result_asset=asset(patch), mask_asset=asset(mask),
                       feather=8, color_strength=100)
        async def apply(data):
            response = await self.client.post('/ph3_image_tool/selection/reblend', json=data)
            self.assertEqual(response.status, 200)
            return await response.json()

        for x, y in [(24, 24), (0, 0), (48, 48)]:
            with self.subTest(origin=(x, y)):
                selection = Image.new('L', source.size)
                selection.paste(mask, (x, y))
                data = dict(payload, region=[x, y, *mask.size])
                legacy = await apply(data)
                self.assertEqual(legacy, await apply(dict(data, selection_asset=asset(selection))))
                edge = (47 if x == 0 else 0, 24)
                alpha = self.store.image(legacy['mask_asset']).getchannel('R')
                self.assertLess(alpha.getpixel(edge), 255)
                self.assertEqual(alpha.getpixel((24, 24)), 255)
                if x == 0:
                    self.assertEqual(alpha.getpixel((0, 24)), 255)
                rgb = self.store.image(legacy['asset'])
                self.assertLess(rgb.getpixel(edge)[0], 110)
                self.assertEqual(rgb.getpixel((24, 24))[0], 110)

    async def test_native_oversize_references_return_a_reason_without_creating_jobs(self):
        self.catalog.update(NATIVE_MODELS)
        self.nodes.update(generation.NATIVE_NODES)
        thin = self.store.put_image(Image.new('RGB', (128, 1), 'red'))['asset']
        base = self.store.put_image(Image.new('RGB', (128, 96), 'white'))['asset']
        mask = Image.new('L', (128, 96), 0)
        mask.paste(255, (0, 48, 128, 49))
        selection = self.store.put_image(mask)['asset']
        image_layer = schema.uid()
        for mode, source, expected in [('selection', base, 'selection'),
                                       ('full', base, 'additional'),
                                       ('lettering', thin, 'lettering')]:
            with self.subTest(mode=mode):
                doc = document()
                doc['settings'].update(model_engine=generation.NATIVE_IMAGE,
                    h3_image_unet_name=NATIVE_MODELS['diffusion_models'][0],
                    h3_image_clip_name=NATIVE_MODELS['text_encoders'][0],
                    h3_image_vae_name=NATIVE_MODELS['vae'][0], context=0, feather=0)
                request = {'mode': mode, 'revision': 0, 'source_asset': source}
                if mode == 'selection':
                    doc['selection_asset'] = selection
                if mode == 'full':
                    doc['references'] = [{'asset': base, 'role': 'appearance'}, {'asset': thin, 'role': 'appearance'}]
                if mode == 'lettering':
                    doc['layers'] = [{'id': image_layer, 'type': 'image', 'asset': thin, 'x': 0, 'y': 0, 'w': 128, 'h': 1}]
                    request.update(lettering={'text': 'ビクッ!!', 'use_reference': True, 'reference_kind': 'layer'},
                                   reference_layer_id=image_layer)
                record = self.store.create(doc)
                url = '/ph3_image_tool/projects/'+record['id']
                response = await self.client.post(url+'/prepare', json=request)
                self.assertEqual(response.status, 400)
                error = (await response.json())['error']
                self.assertEqual(error['code'], 'NATIVE_REFERENCE_TOO_LARGE')
                self.assertEqual(error['details']['source'], expected)
                self.assertEqual(error['details']['index'], 2 if expected == 'additional' else None)
                self.assertEqual((error['details']['width'], error['details']['height']), (131072, 1024))
                self.assertEqual(self.store.jobs(record['id']), [])
                if mode == 'selection':
                    doc['settings']['context'] = .25
                    saved = self.store.save(record['id'], doc, 0)
                    response = await self.client.post(url+'/prepare', json={**request, 'revision': saved['revision']})
                    self.assertEqual(response.status, 200)
                    self.assertEqual((await response.json())['prompt']['6']['class_type'], 'MiniMaxH3ImageConditioning')

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
