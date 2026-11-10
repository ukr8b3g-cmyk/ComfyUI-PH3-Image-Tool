"""Offline Chromium UI regression with real CPU storage and simulated generation.
No network browser navigation, no live ComfyUI, no model inference.
Requires an already-installed Playwright and Chromium in the TEST environment only.
"""
from __future__ import annotations
import argparse
import base64
import io
import json
from pathlib import Path
import re
import sys
import tempfile
import time
import uuid
from PIL import Image, ImageDraw
from playwright.sync_api import sync_playwright
from browser_modules import install_module_routes,launch_browser

sys.path.insert(0,str(Path(__file__).parent))
from support import ROOT, storage, generation, processing, schema, load
exporting=load('exporting')

MODELS={'diffusion_models':['minimax/minimax_h3_fl2va_pruned_int8_convrot.safetensors'],
 'text_encoders':['p-h3-image_text_encoder_int8_convrot.safetensors','p-h3-image_prompt_upsampler_w4a8.safetensors'],
 'vae':['p-h3-image_vae_int8_convrot.safetensors'],'loras':['P-H3-Image/p-h3-image_lora_bf16.safetensors'],
 'samplers':['er_sde','euler'],'missing_nodes':[],'enhancer_available':True,'cutout':{'onnx_available':False,'model_available':False}}
NODES=set(generation.CORE_NODES)|{'TextGenerateV2','PH3ImageToolAsset','PH3ImageToolResult','PH3ImageToolTextResult'}

class Harness:
    def __init__(self,root):self.store=storage.Store(root);self.pending={};self.delay=.2;self.graphs=[]
    def rpc(self,op,path,data=None):
        store=self.store;value=None;binary=None
        try:
            if op=='upload':
                raw=base64.b64decode(data['base64']);value=store.import_archive(raw) if path=='/import' else store.put_image(raw)
            elif op=='queue':
                graph=data;self.graphs.append(graph);job_id=graph['90']['inputs']['job_id'];key=str(uuid.uuid4());self.pending[job_id]=(time.monotonic()+self.delay,key)
                value={'prompt_id':key,'number':0}
            elif op=='history':value={}
            elif op=='queueState':value={'queue_running':[],'queue_pending':[]}
            elif op=='deleteQueued':value={}
            elif op=='archive':binary=store.export(path)
            elif op=='encode':binary=exporting.encode_image(store.image(data['asset']),data)[0]
            elif path=='/capabilities':value={**MODELS,'storage':str(store.root)}
            elif path=='/projects' and op=='get':value=store.projects()
            elif path=='/projects' and op=='post':
                doc=data.get('document') or schema.default_document(data.get('width',1024),data.get('height',1024))
                doc['settings'].update(locale='ja',locale_mode='ja',save_generated_images=False,unet_name=MODELS['diffusion_models'][0],clip_name=MODELS['text_encoders'][0],vae_name=MODELS['vae'][0],lora_name=MODELS['loras'][0],enhancer_name=MODELS['text_encoders'][1],random_seed=False)
                value=store.create(doc)
            elif path=='/process':
                image=store.image(data['asset'])
                if data['action']=='comic':out=processing.comic(image,data.get('preset','manga'),data.get('strength',1))
                elif data['method']=='color':out=processing.color_cutout(image,data.get('tolerance',32),data.get('seed'))
                elif data['method']=='selection':out=processing.selection_cutout(image,store.image(data['mask_asset']).getchannel('R'))
                else:raise ValueError('No optional AI cutout runtime in test')
                value=store.put_image(out)
            elif path.startswith('/projects/'):
                bits=path.split('/');key=bits[2]
                if path.endswith('/prepare'):
                    job,graph=generation.prepare_job(store,key,data,MODELS,NODES);value={'job':job,'prompt':graph}
                elif path.endswith('/jobs'):value=store.jobs(key)
                elif op=='get':value=store.read(key)
                elif op=='put':value=store.save(key,data['document'],data['revision'])
            elif path.startswith('/jobs/'):
                key=path.split('/')[2]
                if path.endswith('/state'):value=store.mark_job(key,data)
                else:
                    if key in self.pending and time.monotonic()>=self.pending[key][0]:
                        job=store.job(key);req=job['request']
                        if req['mode']=='enhance':store.finish_job(key,text='Edit <Picture 1>. Add one red apple. [SIMULATED CPU TEST]')
                        else:
                            size=tuple(req['generation_size']);out=store.image(req['crop_asset']).resize(size) if req.get('crop_asset') else Image.new('RGBA',size,'#66a99a');out=out.copy();draw=ImageDraw.Draw(out)
                            draw.ellipse((size[0]*.3,size[1]*.25,size[0]*.7,size[1]*.7),fill='#d3334c');generation.capture_images(store,key,[out])
                        del self.pending[key]
                    value=store.job(key)
            if value is None and binary is None:raise ValueError(f'Unhandled test RPC {op} {path}')
            assets={p.stem:'data:image/png;base64,'+base64.b64encode(p.read_bytes()).decode() for p in (store.root/'assets').glob('*.png')}
            return {'value':value,'assets':assets,'binary':base64.b64encode(binary).decode() if binary else None}
        except Exception as exc:return {'error':str(exc)}


def bundle_modules(page):
    return install_module_routes(page)

BRIDGE='''
const assets=new Map(),memory=new Map();
Object.defineProperty(window,'localStorage',{value:{getItem:k=>memory.get(k)||null,setItem:(k,v)=>memory.set(k,v),removeItem:k=>memory.delete(k)},configurable:true});
async function call(op,path,data=null){const r=await window.ph3TestRPC(op,path,data);if(r.error)throw Error(r.error);for(const [k,v]of Object.entries(r.assets||{}))assets.set(k,v);return r;}
const bytes64=bytes=>{let s='';for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(s);};
window.ph3UploadCount=0;window.ph3UploadCompleted=0;window.ph3HoldUploadAt=0;window.ph3ReleaseUpload=null;
const client={get:async p=>(await call('get',p)).value,post:async(p,d)=>(await call('post',p,d)).value,put:async(p,d)=>(await call('put',p,d)).value,
 upload:async(blob,name='image.png',path='/assets')=>{if(++window.ph3UploadCount===window.ph3HoldUploadAt)await new Promise(resolve=>window.ph3ReleaseUpload=()=>{window.ph3ReleaseUpload=null;resolve();});const result=(await call('upload',path,{base64:bytes64(new Uint8Array(await blob.arrayBuffer())),name})).value;window.ph3UploadCompleted++;return result;},
 assetURL:k=>{if(!assets.has(k))throw Error('Missing test asset '+k);return assets.get(k);},
 encode:async options=>new Blob([Uint8Array.from(atob((await call('encode','',options)).binary),c=>c.charCodeAt(0))],{type:'image/'+options.format}),
 archive:async id=>new Blob([Uint8Array.from(atob((await call('archive',id)).binary),c=>c.charCodeAt(0))],{type:'application/zip'}),
 queue:async graph=>(await call('queue','',graph)).value,history:async id=>(await call('history',id)).value,
 queueState:async()=>(await call('queueState','')).value,deleteQueued:async id=>(await call('deleteQueued',id)).value};
window.ph3Client=client;
const {openStudio}=await import(MODULE_URL);
window.ph3Editor=await openStudio({client,onApply:r=>window.ph3Applied=r});
window.ph3Open=async id=>{window.ph3Editor=await openStudio({client,projectId:id,onApply:r=>window.ph3Applied=r});};
'''


def main(output):
    output.mkdir(parents=True,exist_ok=True);checks=[];errors=[]
    with tempfile.TemporaryDirectory() as temp:
        harness=Harness(Path(temp)/'store');fixture=Image.new('RGBA',(320,240),'#6dafa1');fixture_path=Path(temp)/'fixture.png';fixture.save(fixture_path)
        with sync_playwright() as p:
            browser=launch_browser(p);page=browser.new_page(viewport={'width':1440,'height':1000},locale='ja-JP',accept_downloads=True)
            page.set_default_timeout(8000);page.on('pageerror',lambda e:errors.append(str(e)));page.on('dialog',lambda dialog:dialog.accept())
            page.expose_function('ph3TestRPC',harness.rpc)
            css=(ROOT/'web'/'style.css').read_text(encoding='utf8');page.set_content('<html><head><meta charset="utf-8"><link data-ph3-tool><style>'+css+'</style></head><body style="background:#111"></body></html>')
            page.evaluate('async MODULE_URL=>{'+BRIDGE+'}',bundle_modules(page))
            page.wait_for_selector('.ph3-tool[open]');checks.append('current versioned ES modules open the editor through offline routes')
            def snap():return page.evaluate('window.ph3Editor.snapshot()')
            def click(key,scope='.ph3-tool'):page.locator(f'{scope} [data-i18n="{key}"]').first.click()
            def ready():page.wait_for_function('!document.querySelector(".ph3-top [data-i18n=save]").disabled')
            def slider(value):
                control=page.locator('.ph3-panel[data-panel=properties] [data-property=opacity] input[type=range]');box=control.bounding_box();y=box['y']+box['height']/2
                page.mouse.move(box['x']+box['width']-7,y);page.mouse.down();page.mouse.move(box['x']+7+(box['width']-14)*value,y,steps=12);page.mouse.up();return float(control.input_value())
            with page.expect_file_chooser() as fc:click('image','.ph3-left')
            fc.value.set_files(str(fixture_path));page.wait_for_function('window.ph3Editor.snapshot().layers.length===1');ready();assert snap()['width']==320;checks.append('PNG import retains its image layer')
            click('addText','.ph3-left');page.get_by_role('textbox',name='文字',exact=True).fill('PH3編集テスト');page.get_by_role('textbox',name='文字',exact=True).press('Tab');ready();assert len(snap()['layers'])==2
            click('save','.ph3-top');ready();opacity=slider(.4);assert abs(opacity-.4)<.03;page.wait_for_function('(value)=>window.ph3Editor.snapshot().layers[1].opacity===value',arg=opacity);checks.append('first mouse-dragged opacity change after Save/Apply affects the current selected layer')
            click('undo','.ph3-top');page.wait_for_function('window.ph3Editor.snapshot().layers[1].opacity===1');click('redo','.ph3-top');page.wait_for_function('(value)=>window.ph3Editor.snapshot().layers[1].opacity===value',arg=opacity);checks.append('one Undo/Redo reverses only that opacity edit')
            click('layers','.ph3-tabs');page.locator('.ph3-layer-title').first.click();click('properties','.ph3-tabs')
            click('save','.ph3-top');ready()
            page.locator('.ph3-panel[data-panel=properties] input[type=color]').first.evaluate("el=>{el.value='#00ff00';el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));}")
            page.wait_for_function("window.ph3Editor.snapshot().layers[1].fill==='#00ff00'");checks.append('first color change after Save/Apply affects the current layer')
            page.screenshot(path=str(output/'save-then-edit.png'));(output/'save-then-edit.json').write_text(json.dumps(snap(),ensure_ascii=False,indent=2),encoding='utf8')
            # Subtract/intersect are unavailable until a selection exists.
            assert page.locator('.ph3-selection-operations button[data-operation=subtract]').is_disabled()
            assert page.locator('.ph3-selection-operations button[data-operation=intersect]').is_disabled()
            page.locator('[data-tool=rect]').click();area=page.locator('.ph3-canvas').bounding_box();page.mouse.move(area['x']+area['width']*.2,area['y']+area['height']*.2);page.mouse.down();page.mouse.move(area['x']+area['width']*.6,area['y']+area['height']*.6,steps=5);page.mouse.up();ready();page.wait_for_function('!!ph3Editor.snapshot().selection_asset')
            for mode in ['add','subtract','intersect','replace']:
                page.locator('.ph3-selection-operations button[data-operation='+mode+']').click();assert page.locator('.ph3-selection-operations button[aria-pressed=true]').get_attribute('data-operation')==mode
            click('clear','.ph3-left');ready()
            checks.append('four current selection mode buttons are mutually exclusive')
            click('generationTab','.ph3-tabs');page.get_by_label('原文',exact=True).fill('Add one red apple.');page.get_by_role('combobox',name='生成範囲',exact=True).select_option('new');count=len(snap()['layers']);click('generate','.ph3-panel[data-panel=generate]');ready()
            page.wait_for_function(f'window.ph3Editor.snapshot().layers.length==={count+1}',timeout=15000);checks.append('simulated generation adds a candidate layer without replacing existing text or image')
            harness.delay=1.8;count=len(snap()['layers']);click('generate','.ph3-panel[data-panel=generate]');ready();click('addText','.ph3-left');page.wait_for_timeout(4000);assert len(snap()['layers'])==count+1;checks.append('editing during a delayed simulated generation preserves the edit and prevents stale auto-adoption')
            click('save','.ph3-top');ready();saved=page.evaluate('window.ph3Applied');assert saved['document']['layers']==snap()['layers']
            click('close','.ph3-top');page.evaluate('id=>window.ph3Open(id)',saved['id']);ready();assert snap()['layers']==saved['document']['layers'];checks.append('close/reopen retains editable text, image and changed properties')
            with page.expect_download() as dl:click('portable','.ph3-top')
            archive=output/'test-project.ph3tool';dl.value.save_as(str(archive));original=snap();original_id=saved['id'];click('openProject','.ph3-top')
            with page.expect_file_chooser() as fc:click('importProject','.ph3-modal')
            fc.value.set_files(str(archive));ready();page.wait_for_function('!document.querySelector(".ph3-overlay")');assert snap()['layers']==original['layers'];assert len(harness.store.projects())==2;checks.append('real Export project and Import project buttons roundtrip every editable layer')
            # Re-imported text remains editable and Undo/Redo leaves all other layers intact.
            click('layers','.ph3-tabs');page.locator('.ph3-layer-title').first.click();click('properties','.ph3-tabs');before_edit=snap();text_id=before_edit['layers'][-1]['id'];textbox=page.get_by_role('textbox',name='文字',exact=True);textbox.fill('再読込後も編集可能');textbox.press('Tab');ready();after_edit=snap();assert after_edit['layers'][-1]['text']=='再読込後も編集可能';assert after_edit['layers'][:-1]==before_edit['layers'][:-1]
            click('undo','.ph3-top');assert snap()['layers']==before_edit['layers'];click('redo','.ph3-top');assert snap()['layers']==after_edit['layers'];checks.append('imported text stays editable with one Undo/Redo and unchanged sibling layers')
            page.screenshot(path=str(output/'imported-editable.png'))
            # Hold the second upload in the actual Apply pipeline (original source),
            # close the filter via its header, then release the browser-side gate.
            click('layers','.ph3-tabs');page.locator('.ph3-layer-title').last.click();before_close=snap();click('comic','.ph3-left');click('comicFilter','.ph3-modal')
            page.locator('.ph3-processing .ph3-modal-actions .primary').wait_for(state='visible');page.wait_for_function('!document.querySelector(".ph3-processing .ph3-modal-actions .primary").disabled')
            page.evaluate('window.ph3UploadCount=0;window.ph3UploadCompleted=0;window.ph3HoldUploadAt=2');page.locator('.ph3-processing .ph3-modal-actions .primary').click();page.wait_for_function('typeof window.ph3ReleaseUpload==="function"')
            page.screenshot(path=str(output/'filter-upload-pending.png'));page.locator('.ph3-processing .ph3-modal-header [data-ph3-close]').click();page.evaluate('window.ph3ReleaseUpload()');page.wait_for_function('window.ph3UploadCompleted===2');assert snap()==before_close;checks.append('closing the manga filter during original-source upload prevents late adoption')
            (output/'filter-close-race.json').write_text(json.dumps({'before':before_close,'after':snap(),'uploads_completed':2,'unchanged':True},ensure_ascii=False,indent=2),encoding='utf8');page.screenshot(path=str(output/'filter-closed-unchanged.png'))
            # The positive control proves Apply still works when the dialog stays open.
            page.evaluate('window.ph3HoldUploadAt=0');click('comic','.ph3-left');click('comicFilter','.ph3-modal');page.wait_for_function('!document.querySelector(".ph3-processing .ph3-modal-actions .primary").disabled');page.locator('.ph3-processing .ph3-modal-actions .primary').click();ready();page.wait_for_function(f'window.ph3Editor.snapshot().layers.length==={len(before_close["layers"])+1}');checks.append('keeping the filter open still applies one new layer')
            page.screenshot(path=str(output/'editor.png'))
            # Boundary fixture uses tiny images: actual UI import/export/re-import
            # for 256 layers and 1,025 assets, without large-canvas allocations.
            assets=[harness.store.put_image(Image.new('RGBA',(2,2),(i%256,i//256,31,128)))['asset'] for i in range(1025)]
            boundary=schema.default_document(2,2);boundary['title']='Archive boundary 256 layers / 1025 assets';boundary['settings'].update(locale='ja',locale_mode='ja',save_generated_images=False);boundary['composite_asset']=assets[-1]
            boundary['layers']=[{'id':schema.uid(),'name':f'Layer {i+1}','type':'image','asset':assets[4*i],'mask_asset':assets[4*i+1],'processing':{'source_asset':assets[4*i+2],'raw_asset':assets[4*i+3]},'x':0,'y':0,'w':2,'h':2,'visible':True,'opacity':1} for i in range(256)]
            record=harness.store.create(boundary);boundary_path=output/'boundary-fixture.ph3tool';boundary_path.write_bytes(harness.store.export(record['id']))
            click('openProject','.ph3-top')
            with page.expect_file_chooser() as fc:click('importProject','.ph3-modal')
            fc.value.set_files(str(boundary_path));page.wait_for_function('window.ph3Editor.snapshot().layers.length===256');ready();assert snap()['layers']==boundary['layers']
            with page.expect_download() as dl:click('portable','.ph3-top')
            boundary_export=output/'boundary-export.ph3tool';dl.value.save_as(str(boundary_export));boundary_saved=snap();click('openProject','.ph3-top')
            with page.expect_file_chooser() as fc:click('importProject','.ph3-modal')
            fc.value.set_files(str(boundary_export));ready();page.wait_for_function('!document.querySelector(".ph3-overlay")');assert snap()['layers']==boundary_saved['layers'];assert schema.asset_ids(snap())==schema.asset_ids(boundary_saved);assert len(schema.asset_ids(snap()))==1025;checks.append('256 layers and 1025 images export and re-import through actual browser controls with all asset references intact')
            page.screenshot(path=str(output/'boundary-reimported.png'));(output/'boundary-roundtrip.json').write_text(json.dumps({'layers':256,'assets':len(schema.asset_ids(snap())),'export_bytes':boundary_export.stat().st_size,'layer_json_equal':True,'asset_ids_equal':True},indent=2),encoding='utf8')
            assert not errors,errors;checks.append('no unhandled browser exceptions');browser.close()
    result={'environment':'Offline Chromium with real CPU storage and canvas; no ComfyUI or GPU inference','checks':checks,'passed':len(checks),'page_errors':errors,'gpu_tested':False,'live_comfyui_tested':False}
    (output/'browser-results.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf8');print(json.dumps(result,ensure_ascii=False,indent=2))

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--output',default=str(ROOT/'verification'/'browser'));args=parser.parse_args();main(Path(args.output))
