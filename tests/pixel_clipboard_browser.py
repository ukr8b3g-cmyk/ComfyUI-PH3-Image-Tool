"""Real editor keys, canvas pixels, persistence and labelled-palette acceptance.
Uses the existing isolated CPU/browser harness, never live model inference.
"""
from pathlib import Path
import json,tempfile,argparse,base64,io
from PIL import Image,ImageDraw
from playwright.sync_api import sync_playwright
from browser_smoke import Harness,BRIDGE,bundle_modules,ROOT
from browser_modules import launch_browser

def main(output):
 output.mkdir(parents=True,exist_ok=True);checks=[];errors=[]
 with tempfile.TemporaryDirectory() as tmp, sync_playwright() as p:
  harness=Harness(Path(tmp)/'store');image=Image.new('RGBA',(96,64),'#2b7f65');ImageDraw.Draw(image).rectangle((16,12,47,39),fill='#ef733e');path=Path(tmp)/'fixture.png';image.save(path)
  browser=launch_browser(p)
  try:
   page=browser.new_page(viewport={'width':1440,'height':1000},locale='ja-JP',accept_downloads=True);page.set_default_timeout(8000)
   page.on('pageerror',lambda e:errors.append(str(e)));page.on('dialog',lambda d:d.accept());page.expose_function('ph3TestRPC',harness.rpc)
   css=(ROOT/'web/style.css').read_text(encoding='utf8');page.set_content('<html><head><meta charset="utf-8"><link data-ph3-tool><style>'+css+'</style></head><body style="background:#111"></body></html>')
   page.evaluate('async MODULE_URL=>{'+BRIDGE+'}',bundle_modules(page));page.wait_for_selector('.ph3-tool[open]')
   def snap():return page.evaluate('window.ph3Editor.snapshot()')
   def click(key,scope='.ph3-tool'):page.locator(f'{scope} [data-i18n="{key}"]').first.click()
   def ready():page.wait_for_function('!document.querySelector(".ph3-top [data-i18n=save]").disabled')
   def select_region():
    click('layers','.ph3-tabs');page.locator('.ph3-layer-title').last.click();page.locator('[data-tool=rect]').click();r=page.locator('.ph3-canvas').bounding_box()
    page.mouse.move(r['x']+r['width']/6,r['y']+r['height']*12/64);page.mouse.down();page.mouse.move(r['x']+r['width']/2,r['y']+r['height']*40/64,steps=8);page.mouse.up()
    page.wait_for_function('Boolean(window.ph3Editor.snapshot().selection_asset)');ready();page.locator('.ph3-viewport').focus()
   def undo():click('undo','.ph3-top');ready()
   def redo():click('redo','.ph3-top');ready()
   with page.expect_file_chooser() as fc:click('image','.ph3-left')
   fc.value.set_files(str(path));page.wait_for_function('window.ph3Editor.snapshot().layers.length===1');ready();original=snap()['layers'][0];settings=snap()['settings']
   select_region();before=snap();page.keyboard.press('Control+c');page.wait_for_function('document.querySelector(".ph3-status").textContent.includes("コピー済み")');ready();assert snap()==before
   page.keyboard.press('Control+v');page.wait_for_function('window.ph3Editor.snapshot().layers.length===2');ready()
   pasted=snap()['layers'][-1];assert (pasted['x'],pasted['y'],pasted['w'],pasted['h'])==(16,12,32,28),pasted
   assert harness.store.image(pasted['asset']).size==(32,28);assert snap()['layers'][0]==original;assert snap()['selection_asset'] is None
   checks.append('real Ctrl+C/V copies only 32x28 selected pixels, preserves source, selects a new layer and clears selection')
   undo();assert snap()['layers']==before['layers'];assert snap()['selection_asset']==before['selection_asset'];redo();assert snap()['layers'][-1]==pasted
   checks.append('paste Undo/Redo restores both source layers and the selection in one step')
   # Move the selected paste by a real arrow key; Undo/Redo cannot alter siblings.
   page.locator('.ph3-viewport').focus();page.keyboard.press('ArrowRight');assert snap()['layers'][-1]['x']==17;undo();assert snap()['layers'][-1]['x']==16;redo();assert snap()['layers'][0]==original
   checks.append('pasted layer moves immediately; movement Undo/Redo leaves its source unchanged')
   undo();undo();select_region();page.keyboard.press('Control+j');page.wait_for_function('window.ph3Editor.snapshot().layers.length===2');ready();assert snap()['layers'][-1]['w']==32
   undo();assert snap()['layers']==[original]
   # J must not replace the earlier internal clipboard.
   click('editMenu','.ph3-top');click('pastePixels','.ph3-modal');page.wait_for_function('window.ph3Editor.snapshot().layers.length===2');ready();assert snap()['layers'][-1]['asset']==pasted['asset'];undo()
   checks.append('Ctrl+J duplicates selection without changing the clipboard; one Undo removes only the duplicate')
   select_region();before_cut=snap();page.keyboard.press('Control+x');page.wait_for_function('Boolean(window.ph3Editor.snapshot().layers[0].mask_asset)');ready();cut=snap()['layers'][0]
   mask=harness.store.image(cut['mask_asset']).getchannel('R');assert mask.getpixel((20,20))==0 and mask.getpixel((0,0))==255;assert cut['asset']==original['asset']
   page.keyboard.press('Control+v');page.wait_for_function('window.ph3Editor.snapshot().layers.length===2');ready();after=snap()
   undo();assert len(snap()['layers'])==1 and snap()['layers'][0]['mask_asset']==cut['mask_asset'];undo();assert snap()['layers']==[original];redo();redo();assert snap()['layers']==after['layers']
   checks.append('Cut/Paste and two Undo/Redo operations preserve original asset and restore exact masks and layers')
   # Guard typing and locked targets before saving the final edit.
   click('properties','.ph3-tabs');name=page.locator('.ph3-panel[data-panel=properties] [data-property=name] input')
   if name.count():
    name.fill('貼付テスト');name.press('Control+a');name.press('Control+c');ready();assert len(snap()['layers'])==2
   click('save','.ph3-top');ready();record=page.evaluate('window.ph3Applied');assert snap()['settings']==settings
   with page.expect_download() as dl:click('portable','.ph3-top')
   archive=output/'pixel-edit.ph3tool';dl.value.save_as(str(archive));saved=snap();assert saved['layers']==record['document']['layers']
   click('close','.ph3-top');page.evaluate('id=>window.ph3Open(id)',record['id']);ready();assert snap()['layers']==saved['layers'];assert snap()['settings']==settings
   click('layers','.ph3-tabs');page.locator('.ph3-layer-title').first.click();page.locator('.ph3-viewport').focus();page.keyboard.press('ArrowDown');edited=snap();assert edited['layers'][-1]['y']==saved['layers'][-1]['y']+1
   undo();assert snap()['layers']==saved['layers'];redo();assert snap()['layers']==edited['layers']
   checks.append('Save/close/reopen keeps pixels and model/seed settings; reloaded layers remain editable with Undo/Redo')
   click('openProject','.ph3-top')
   with page.expect_file_chooser() as fc:click('importProject','.ph3-modal')
   fc.value.set_files(str(archive));page.wait_for_function('!document.querySelector(".ph3-overlay")');ready();assert snap()['layers']==saved['layers']
   checks.append('portable project roundtrip preserves the clipped image, source and cut mask')
   page.set_viewport_size({'width':900,'height':640});page.wait_for_timeout(150)
   layout=page.evaluate('''()=>{const l=document.querySelector('.ph3-left'),s=document.querySelector('.ph3-left-scroller'),b=document.querySelector('[data-tool=rect]'),label=b.querySelector('.ph3-button-label'),style=getComputedStyle(label);return {width:l.getBoundingClientRect().width,content:s.scrollHeight,viewport:s.clientHeight,label_visible:style.display!=='none'&&style.visibility!=='hidden'&&label.getBoundingClientRect().height>0,selection_controls_left:Boolean(document.querySelector('.ph3-left [data-i18n=clear]'))}}''')
   assert layout['width']>96 and layout['label_visible'] and layout['selection_controls_left'],layout
   for b in page.locator('.ph3-left button').all():assert b.get_attribute('aria-label') and b.get_attribute('title')
   page.screenshot(path=str(output/'restored-ja.png'));checks.append('900x640: original labelled palette restored; selection controls remain on the left and tool help is retained')
   def data_url(image):
    data=io.BytesIO();image.save(data,format='PNG');return 'data:image/png;base64,'+base64.b64encode(data.getvalue()).decode()
   rgba=data_url(Image.new('RGBA',(2,2),(240,80,20,255)));soft=data_url(Image.new('RGBA',(2,2),(128,128,128,255)))
   pixels=page.evaluate('''async images=>{
    const {capturePixels,erasedMask}=await import('http://ph3-test.invalid/modules/pixel-clipboard.mjs');
    const {RasterCache}=await import('http://ph3-test.invalid/modules/render.mjs');
    const cache=new RasterCache(k=>images[k]),layer={id:'soft',type:'image',asset:'rgba',mask_asset:'soft',x:0,y:0,w:2,h:2,rotation:90,visible:true,opacity:.2};
    const doc={width:2,height:2,layers:[layer]},selection=new Uint8ClampedArray(4).fill(128);
    const clip=await capturePixels(doc,layer,selection,cache),bitmap=await createImageBitmap(clip.blob),c=document.createElement('canvas');c.width=2;c.height=2;c.getContext('2d').drawImage(bitmap,0,0);bitmap.close();
    const alphas=[...c.getContext('2d').getImageData(0,0,2,2).data].filter((v,i)=>i%4===3);
    const erased=await createImageBitmap(await erasedMask(doc,layer,selection,cache));c.getContext('2d').clearRect(0,0,2,2);c.getContext('2d').drawImage(erased,0,0);erased.close();const red=c.getContext('2d').getImageData(0,0,2,2).data[0];
    const empty=await capturePixels(doc,layer,new Uint8ClampedArray(4),cache);cache.dispose();return {alphas,red,empty};
   }''',{'rgba':rgba,'soft':soft})
   assert pixels=={'alphas':[64,64,64,64],'red':64,'empty':None},pixels
   checks.append('rotated soft mask x soft selection applies alpha once; Cut preserves remaining mask; empty selection is no-op')
   assert not errors,errors
  finally:browser.close()
 result={'passed':len(checks),'checks':checks,'page_errors':errors,'layout':layout,'models_and_seed_preserved':True,'live_comfyui':False,'gpu':False}
 (output/'results.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf8');print(json.dumps(result,ensure_ascii=False))
if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('--output',required=True);main(Path(parser.parse_args().output))
