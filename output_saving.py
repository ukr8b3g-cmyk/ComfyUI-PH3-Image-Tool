"""Optional WebP copies of finished candidates beneath ComfyUI's output directory."""
from pathlib import Path
import re
from .schema import ToolError

def options(settings):
    enabled=settings.get('save_generated_images',True)
    directory=settings.get('save_image_directory','')
    if not isinstance(enabled,bool) or not isinstance(directory,str) or len(directory)>200:
        raise ToolError('INVALID_OUTPUT','Invalid image output settings')
    directory=directory.strip().replace('\\','/')
    if directory and (directory.startswith('/') or any(p in ('','.','..') for p in directory.split('/')) or re.search(r'[:<>"|?*\x00-\x1f]',directory)):
        raise ToolError('INVALID_OUTPUT','Use a subfolder under ComfyUI output, without absolute paths or ..')
    quality=settings.get('export_quality',.8)
    if isinstance(quality,bool) or not isinstance(quality,(int,float)) or not .1<=quality<=1:raise ToolError('INVALID_OUTPUT','Invalid WebP quality')
    result={'enabled':enabled,'directory':directory,'quality':round(quality*100)}
    location=settings.get('output_location','')
    if location:
        from .schema import identifier
        result['location']=identifier(location)
    return result

def save_candidates(store,job,results,output_root=None):
    config=job['request'].get('output_save',{'enabled':False,'directory':''})
    config=options({'save_generated_images':config['enabled'],'save_image_directory':config['directory'],'export_quality':config.get('quality',80)/100,'output_location':config.get('location','')})
    if not config['enabled']:return results
    if output_root is None:
        from .output_locations import resolve
        output_root=resolve(store,config.get('location',''))
    root=Path(output_root).resolve();directory=(root/config['directory']).resolve()
    if not directory.is_relative_to(root):raise ToolError('INVALID_OUTPUT','Output subfolder escapes the output directory')
    directory.mkdir(parents=True,exist_ok=True)
    for index,result in enumerate(results):
        image=store.image(result['asset']);stem=f"PH3-Image-Tool_{job['id']}_{index+1:02d}"
        for counter in range(10000):
            path=directory/(stem+(f'_{counter}' if counter else '')+'.webp')
            try:stream=path.open('xb')
            except FileExistsError:continue
            try:
                with stream:image.save(stream,format='WEBP',quality=config['quality'],lossless=False)
            except Exception:
                path.unlink(missing_ok=True);raise
            result['saved_image']=path.relative_to(root).as_posix();break
        else:raise ToolError('OUTPUT_FULL','Could not allocate an output filename')
    return results
