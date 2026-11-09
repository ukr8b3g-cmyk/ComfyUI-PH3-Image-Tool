"""Explicit-consent download of the one supported ISNet model. No inference downloads."""
from pathlib import Path
import hashlib
import os
import tempfile
import threading
from urllib.request import urlopen
from .schema import ToolError

URL = 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-general-use.onnx'
SIZE = 178648008
SHA256 = '60920e99c45464f2ba57bee2ad08c919a52bbf852739e96947fbb4358c0d964a'
_lock = threading.Lock()

def status(path):
    return {'model':'isnet-general-use.onnx','model_available':Path(path).is_file(),
            'bytes':SIZE,'source':URL,'destination':'ComfyUI/models/rembg/isnet-general-use.onnx'}

def download(path, confirmed=False):
    if confirmed is not True:
        raise ToolError('CONSENT_REQUIRED','Confirm the ISNet model download first.',403)
    path=Path(path)
    with _lock:
        if path.is_file():return status(path)
        path.parent.mkdir(parents=True,exist_ok=True)
        temp=None
        try:
            with tempfile.NamedTemporaryFile(dir=path.parent,prefix='.isnet-',suffix='.part',delete=False) as f:
                temp=Path(f.name);digest=hashlib.sha256();length=0
                with urlopen(URL,timeout=60) as response:
                    while True:
                        block=response.read(1024*1024)
                        if not block:break
                        length+=len(block)
                        if length>SIZE:raise ValueError('Model size exceeds expected size')
                        f.write(block);digest.update(block)
            if length!=SIZE or digest.hexdigest()!=SHA256:raise ValueError('Model checksum mismatch')
            os.replace(temp,path);return status(path)
        except Exception as error:
            raise ToolError('MODEL_DOWNLOAD_FAILED','ISNet download failed or checksum did not match. Retry the download.',502) from error
        finally:
            if temp is not None:temp.unlink(missing_ok=True)
