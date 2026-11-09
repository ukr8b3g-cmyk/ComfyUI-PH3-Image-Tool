import hashlib,io,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
from aiohttp import web
from aiohttp.test_utils import TestClient,TestServer
from support import load,storage
m=load('cutout_model');api=load('api')
class DownloadTests(unittest.TestCase):
 def test_no_consent_does_not_touch_disk_or_network(self):
  with tempfile.TemporaryDirectory() as t,patch.object(m,'urlopen') as network:
   p=Path(t)/'models/model.onnx'
   for consent in [False,None,'true',1]:
    with self.assertRaises(Exception):m.download(p,consent)
   self.assertFalse(p.parent.exists());network.assert_not_called()
 def test_existing_model_is_reused_without_network(self):
  with tempfile.TemporaryDirectory() as t,patch.object(m,'urlopen') as network:
   p=Path(t)/'model.onnx';p.write_bytes(b'existing');self.assertTrue(m.download(p,True)['model_available']);self.assertEqual(p.read_bytes(),b'existing');network.assert_not_called()
 def test_verified_download_is_atomic_and_partial_is_removed(self):
  data=b'test model'
  with tempfile.TemporaryDirectory() as t,patch.object(m,'SIZE',len(data)),patch.object(m,'SHA256',hashlib.sha256(data).hexdigest()),patch.object(m,'urlopen',return_value=io.BytesIO(data)):
   p=Path(t)/'model.onnx';self.assertTrue(m.download(p,True)['model_available']);self.assertEqual(p.read_bytes(),data);self.assertEqual(list(Path(t).glob('*.part')),[])
 def test_bad_or_interrupted_download_never_installs_partial_file(self):
  for payload in [b'bad',b'x'*20]:
   with tempfile.TemporaryDirectory() as t,patch.object(m,'SIZE',10),patch.object(m,'urlopen',return_value=io.BytesIO(payload)):
    p=Path(t)/'model.onnx'
    with self.assertRaises(Exception):m.download(p,True)
    self.assertFalse(p.exists());self.assertEqual(list(Path(t).iterdir()),[])
class RouteTests(unittest.IsolatedAsyncioTestCase):
 async def test_consent_and_origin_required_and_status_is_read_only(self):
  with tempfile.TemporaryDirectory() as t:
   p=Path(t)/'model.onnx';routes=web.RouteTableDef();api.register_routes(routes,lambda:storage.Store(Path(t)/'store'),lambda:{},lambda:[],lambda:p)
   app=web.Application();app.add_routes(routes)
   async with TestClient(TestServer(app)) as client:
    with patch.object(m,'urlopen') as network:
     self.assertEqual((await client.get('/ph3_image_tool/cutout/model')).status,200)
     self.assertEqual((await client.post('/ph3_image_tool/cutout/model/download',json={})).status,403)
     self.assertEqual((await client.post('/ph3_image_tool/cutout/model/download',json={'confirmed':True},headers={'Origin':'https://other.example'})).status,403)
     self.assertFalse(p.exists());network.assert_not_called()
