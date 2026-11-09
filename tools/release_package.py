"""Verify the manifest and build a deterministic, installable release ZIP."""
from pathlib import Path, PurePosixPath
import argparse
import hashlib
import re
import zipfile

ROOT=Path(__file__).resolve().parents[1]

def manifest_files(root=ROOT):
    files={}
    for line in (root/'MANIFEST.sha256').read_text(encoding='utf8').splitlines():
        digest,name=line.split('  ',1);path=PurePosixPath(name)
        if not re.fullmatch('[0-9a-f]{64}',digest) or path.is_absolute() or '..' in path.parts or name in files:
            raise ValueError('Invalid manifest entry: '+name)
        raw=(root/name).read_bytes()
        if hashlib.sha256(raw).hexdigest()!=digest:raise ValueError('Manifest mismatch: '+name)
        files[name]=raw
    files['MANIFEST.sha256']=(root/'MANIFEST.sha256').read_bytes()
    return files

def build(root=ROOT):
    version=re.search(r'^version\s*=\s*"([^"]+)"', (root/'pyproject.toml').read_text(),re.M).group(1)
    files=manifest_files(root);out=root/'dist';out.mkdir(exist_ok=True)
    path=out/f'ComfyUI-PH3-Image-Tool-v{version}.zip'
    with zipfile.ZipFile(path,'w',compression=zipfile.ZIP_STORED) as archive:
        for name,raw in sorted(files.items()):
            info=zipfile.ZipInfo('ComfyUI-PH3-Image-Tool/'+name,(1980,1,1,0,0,0))
            info.compress_type=zipfile.ZIP_STORED;info.external_attr=0o100644<<16
            archive.writestr(info,raw)
    with zipfile.ZipFile(path) as archive:
        assert len(archive.namelist())==len(files)
        for name,raw in files.items():assert archive.read('ComfyUI-PH3-Image-Tool/'+name)==raw,name
    digest=hashlib.sha256(path.read_bytes()).hexdigest()
    checksum=out/'SHA256SUMS.txt';checksum.write_bytes(f'{digest}  {path.name}\n'.encode())
    print(f'{len(files)} files verified; {path.name}; SHA256 {digest}')
    return path

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--check',action='store_true');args=parser.parse_args()
    if args.check:print(f'{len(manifest_files())} manifest files verified')
    else:build()
