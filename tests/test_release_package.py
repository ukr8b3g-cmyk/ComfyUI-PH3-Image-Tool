import hashlib,tempfile,unittest,zipfile
from pathlib import Path
from support import load

release=load('tools.release_package')

class PackageTests(unittest.TestCase):
 def fixture(self,root):
  files={'pyproject.toml':b'[project]\nversion = "0.9.0"\n','web/file.mjs':'export const text="日本語";\r\n'.encode('utf8')}
  for name,raw in files.items():
   path=root/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(raw)
  (root/'MANIFEST.sha256').write_text(''.join(hashlib.sha256(raw).hexdigest()+'  '+name+'\n' for name,raw in files.items()),encoding='utf8')
  return files
 def test_deterministic_install_folder_and_exact_bytes(self):
  with tempfile.TemporaryDirectory() as temp:
   root=Path(temp);files=self.fixture(root);path=release.build(root);first=path.read_bytes();release.build(root);self.assertEqual(path.read_bytes(),first)
   with zipfile.ZipFile(path) as archive:
    self.assertEqual(len(archive.namelist()),len(files)+1)
    for name,raw in files.items():self.assertEqual(archive.read('ComfyUI-PH3-Image-Tool/'+name),raw)
 def test_manifest_mismatch_prevents_packaging(self):
  with tempfile.TemporaryDirectory() as temp:
   root=Path(temp);self.fixture(root);(root/'web/file.mjs').write_text('changed')
   with self.assertRaises(ValueError):release.build(root)
