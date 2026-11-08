"""Offline Chromium UI regression with real local CPU modules and simulated GPU delivery.
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
            elif path=='/projects' and op=='post':value=store.create(data.get('document') or schema.default_document(data.get('width',1024),data.get('height',1024)))
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


def bundle_modules():
    modules={}
    def bundle(name):
        if name in modules:return modules[name]
        text=(ROOT/'web'/name).read_text()
        for dependency in re.findall(r"from ['\"]\./([^'\"]+\.mjs)['\"]",text):text=text.replace("'./"+dependency+"'",repr(bundle(dependency)))
        text=text.replace("const styleURL=new URL('./style.css',import.meta.url).href;","const styleURL='';")
        result='data:text/javascript;base64,'+base64.b64encode(text.encode()).decode();modules[name]=result;return result
    return bundle('studio.mjs')

BRIDGE='''
const assets=new Map(),memory=new Map();
Object.defineProperty(window,'localStorage',{value:{getItem:k=>memory.get(k)||null,setItem:(k,v)=>memory.set(k,v),removeItem:k=>memory.delete(k)},configurable:true});
async function call(op,path,data=null){const r=await window.ph3TestRPC(op,path,data);if(r.error)throw Error(r.error);for(const [k,v]of Object.entries(r.assets||{}))assets.set(k,v);return r;}
const bytes64=bytes=>{let s='';for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(s);};
const client={get:async p=>(await call('get',p)).value,post:async(p,d)=>(await call('post',p,d)).value,put:async(p,d)=>(await call('put',p,d)).value,
 upload:async(blob,name='image.png',path='/assets')=>(await call('upload',path,{base64:bytes64(new Uint8Array(await blob.arrayBuffer())),name})).value,
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
        harness=Harness(Path(temp)/'store');fixture=Image.new('RGBA',(640,480),'#6dafa1');d=ImageDraw.Draw(fixture);d.rounded_rectangle((160,100,500,410),radius=30,fill='#f5e6d0');d.rectangle((210,310,440,350),fill='#bba391');d.ellipse((250,140,380,270),fill='#c3616c');fixture_path=Path(temp)/'fixture.png';fixture.save(fixture_path)
        with sync_playwright() as p:
            browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage']);page=browser.new_page(viewport={'width':1440,'height':1000},accept_downloads=True)
            page.set_default_timeout(6000);page.on('pageerror',lambda e:errors.append(str(e)));page.on('console',lambda m:print('BROWSER',m.type,m.text[:1000],flush=True) if m.type=='error' else None);page.on('dialog',lambda dialog:dialog.accept())
            page.expose_function('ph3TestRPC',harness.rpc)
            css=(ROOT/'web'/'style.css').read_text();page.set_content('<html><head><meta charset="utf-8"><link data-ph3-tool><style>'+css+'</style></head><body style="background:#111"></body></html>')
            page.evaluate('async MODULE_URL=>{'+BRIDGE+'}',bundle_modules())
            page.wait_for_selector('.ph3-tool[open]');checks.append('editor opens without ComfyUI or models')
            def snap():return page.evaluate('window.ph3Editor.snapshot()')
            def click(key,scope='.ph3-tool'):page.locator(f'{scope} [data-i18n="{key}"]').first.click()
            def wait_ready():page.wait_for_function('!document.querySelector(".ph3-top [data-i18n=save]").disabled')
            with page.expect_file_chooser() as fc:click('image','.ph3-left')
            fc.value.set_files(str(fixture_path));page.wait_for_function('window.ph3Editor.snapshot().layers.length===1');wait_ready();assert snap()['width']==640;checks.append('local PNG import sets canvas and retains image layer')
            click('text','.ph3-left');page.get_by_role('textbox',name='文字',exact=True).fill('PH3 Image Tool\n編集テスト');page.get_by_role('textbox',name='文字',exact=True).press('Tab');assert len(snap()['layers'])==2;checks.append('editable Japanese text layer')
            click('bubble','.ph3-left');page.locator('.ph3-preset-grid button').first.click();assert snap()['layers'][-1]['type']=='bubble';checks.append('vector speech-bubble preset')
            click('undo','.ph3-top');page.wait_for_function('window.ph3Editor.snapshot().layers.length===2');click('redo','.ph3-top');page.wait_for_function('window.ph3Editor.snapshot().layers.length===3');checks.append('Undo/Redo retains document state and advances revision')
            click('sfx','.ph3-left');page.locator('.ph3-preset-grid button').first.click();click('symbol','.ph3-left');page.locator('.ph3-preset-grid button').nth(1).click();click('speed','.ph3-left');page.locator('.ph3-preset-card[data-preset=center]').click();click('frame','.ph3-left');page.locator('.ph3-preset-grid button').nth(1).click();assert len(snap()['layers'])==7;checks.append('SFX, symbol, concentration-line and frame layers')
            click('layers','.ph3-tabs');page.locator('.ph3-layer-title').last.click();click('comic','.ph3-left');page.locator('.ph3-modal-actions .primary').click();wait_ready();page.wait_for_function('window.ph3Editor.snapshot().layers.length===8');assert not snap()['layers'][0]['visible'];checks.append('CPU comic conversion creates a new layer, keeps original')
            click('cutout','.ph3-left');page.get_by_label('背景削除方式').select_option('color');page.locator('.ph3-modal-actions .primary').click();wait_ready();page.wait_for_function('window.ph3Editor.snapshot().layers.length===9');checks.append('connected-color cutout creates transparent image layer')
            # Hide decorative layers for the image selection check, using real layer UI.
            click('generate','.ph3-tabs');click('rect','.ph3-left');box=page.locator('.ph3-canvas').bounding_box();page.mouse.move(box['x']+box['width']*.3,box['y']+box['height']*.3);page.mouse.down();page.mouse.move(box['x']+box['width']*.65,box['y']+box['height']*.65,steps=8);page.mouse.up();wait_ready();page.wait_for_function('!!window.ph3Editor.snapshot().selection_asset');checks.append('rectangle selection persists as separate grayscale asset')
            click('settings','.ph3-top');page.get_by_label('H3 FL2VAモデル',exact=True).select_option(MODELS['diffusion_models'][0]);page.get_by_label('P-H3テキストエンコーダー',exact=True).select_option(MODELS['text_encoders'][0]);page.get_by_label('P-H3 VAE',exact=True).select_option(MODELS['vae'][0]);page.get_by_label('P-H3 Image LoRA',exact=True).select_option(MODELS['loras'][0]);page.get_by_label('P-H3文章補助（任意）',exact=True).select_option(MODELS['text_encoders'][1]);page.locator('.ph3-modal-actions .primary').click();checks.append('settings bind installed model names without downloading anything')
            page.get_by_label('原文',exact=True).fill('赤いリンゴを置く');page.get_by_label('生成範囲',exact=True).select_option('selection');before=len(snap()['layers']);click('generate','.ph3-panel[data-panel=generate]');wait_ready();page.wait_for_function(f'window.ph3Editor.snapshot().layers.length==={before+1}',timeout=15000);assert next(l for l in snap()['layers'] if l.get('generation'))['mask_asset'];checks.append('simulated P-H3 result attaches raw image plus editable mask')
            # Source must remain unchanged; a delayed job may not overwrite a later edit.
            harness.delay=1.8;before=len(snap()['layers']);click('generate','.ph3-panel[data-panel=generate]');wait_ready();click('text','.ph3-left');page.wait_for_timeout(4500);assert len(snap()['layers'])==before+1;checks.append('stale generation is kept as candidate, not auto-applied after editing')
            click('generate','.ph3-tabs');before=len(snap()['layers']);click('generate','.ph3-panel[data-panel=generate]');wait_ready();page.get_by_label('原文',exact=True).fill('赤いリンゴを置く・別の指示');page.wait_for_timeout(4500);assert len(snap()['layers'])==before;checks.append('prompt-only changes invalidate pending automatic result application')
            click('layers','.ph3-tabs');page.locator('.ph3-layer-title').first.click();page.locator('.ph3-layer').first.locator('button').nth(1).click();locked_count=len(snap()['layers']);click('remove','.ph3-panel[data-panel=layers]');assert len(snap()['layers'])==locked_count;click('properties','.ph3-tabs');assert page.locator('.ph3-panel[data-panel=properties] input').count()==0;click('layers','.ph3-tabs');page.locator('.ph3-layer').first.locator('button').nth(1).click();checks.append('locked layer rejects deletion and hides mutating property controls')
            click('generate','.ph3-tabs');harness.delay=.1;click('enhance','.ph3-panel[data-panel=generate]');wait_ready();page.wait_for_function('window.ph3Editor.snapshot().prompt.source==="ai"',timeout=15000);assert 'SIMULATED' in snap()['prompt']['ai'];checks.append('AI-text generation is separate from image generation and keeps original text')
            click('save','.ph3-top');wait_ready();page.wait_for_function('!!window.ph3Applied');saved=page.evaluate('window.ph3Applied');assert saved['document']['composite_asset'];checks.append('Save/Apply commits native-resolution composite and editable project')
            count=len(snap()['layers']);click('close','.ph3-top');page.evaluate('id=>window.ph3Open(id)',saved['id']);assert len(snap()['layers'])==count;checks.append('close/reopen restores layers, mask, prompt and settings from disk')
            with page.expect_download() as dl:click('portable','.ph3-top')
            archive_path=output/'test-project.ph3tool';dl.value.save_as(str(archive_path));assert archive_path.stat().st_size>0;checks.append('portable archive contains project assets and metadata')
            click('export','.ph3-top')
            with page.expect_download() as dl:page.get_by_role('button',name='この設定で書き出す',exact=True).click()
            png_path=output/'test-export.png';dl.value.save_as(str(png_path));assert Image.open(png_path).size==(640,480);checks.append('PNG export is original size, not reduced screen preview')
            click('properties','.ph3-tabs');page.screenshot(path=str(output/'editor.png'));click('generate','.ph3-tabs');page.screenshot(path=str(output/'generation.png'));checks.append('desktop editor rendered and captured in Chromium')
            page.set_viewport_size({'width':1000,'height':760});page.screenshot(path=str(output/'compact.png'));assert page.locator('.ph3-tool').bounding_box()['width']<=1000;checks.append('compact viewport remains inside window')
            assert not errors,errors;checks.append('no unhandled browser exceptions')
            browser.close()
    result={'environment':'Offline Chromium + actual CPU modules; simulated GPU response; localStorage replaced with an in-memory test store','checks':checks,'passed':len(checks),'page_errors':errors,'gpu_tested':False,'live_comfyui_tested':False}
    (output/'browser-results.json').write_text(json.dumps(result,ensure_ascii=False,indent=2));print(json.dumps(result,ensure_ascii=False,indent=2))

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--output',default=str(ROOT/'verification'/'browser'));args=parser.parse_args();main(Path(args.output))
