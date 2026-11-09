"""Server-local output folders. Portable projects store opaque IDs, never paths."""
from pathlib import Path
import os
import string
from .schema import ToolError, identifier, uid


def default_output():
    import folder_paths
    return Path(folder_paths.get_output_directory()).resolve()


def _read(store):
    import json
    path=store.root/'output_locations.json'
    if not path.exists():return {}
    return json.loads(path.read_text(encoding='utf8'))


def resolve(store, location=''):
    if not location:return default_output()
    identifier(location)
    value=_read(store).get(location)
    if not value:raise ToolError('OUTPUT_LOCATION_MISSING','Choose an output folder on this ComfyUI computer')
    return Path(value).resolve()


def locations(store):
    return {'default':str(default_output()),'locations':[{'id':key,'path':value} for key,value in _read(store).items()]}


def choose(store, path):
    if not isinstance(path,str) or len(path)>4096:raise ToolError('INVALID_OUTPUT','Invalid output folder')
    dest=Path(path).expanduser().resolve()
    if not dest.is_dir():raise ToolError('INVALID_OUTPUT','Choose an existing folder')
    with store.lock:
        data=_read(store)
        key=next((k for k,v in data.items() if v==str(dest)),None) or uid()
        data[key]=str(dest)
        if len(data)>256:raise ToolError('OUTPUT_LOCATION_LIMIT','Too many registered output folders')
        import json
        store._write(store.root/'output_locations.json',json.dumps(data,ensure_ascii=False).encode('utf8'))
    return {'id':key,'path':str(dest)}


def folders(path=''):
    if not path:
        roots=[Path(c+':/') for c in string.ascii_uppercase if Path(c+':/').is_dir()] if os.name=='nt' else [Path('/'),Path.home()]
        return {'path':'','parent':None,'folders':[{'name':str(p),'path':str(p)} for p in roots]}
    if not isinstance(path,str) or len(path)>4096:raise ToolError('INVALID_OUTPUT','Invalid folder')
    dest=Path(path).expanduser().resolve()
    try:
        if not dest.is_dir():raise ToolError('INVALID_OUTPUT','Folder does not exist')
        children=[]
        for p in dest.iterdir():
            try:
                if p.is_dir():children.append({'name':p.name,'path':str(p)})
            except OSError:pass
    except PermissionError:raise ToolError('FOLDER_ACCESS','Cannot open this folder')
    return {'path':str(dest),'parent':str(dest.parent) if dest.parent!=dest else '', 'folders':sorted(children,key=lambda p:p['name'].casefold())[:2000]}
