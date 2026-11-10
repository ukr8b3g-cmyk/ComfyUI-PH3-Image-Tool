"""Isolated real-browser command eligibility and mask-pixel acceptance."""
from pathlib import Path
import argparse,json,tempfile
from PIL import Image
from playwright.sync_api import sync_playwright
from browser_smoke import Harness,BRIDGE,bundle_modules,ROOT
from browser_modules import launch_browser

def main(output):
 output.mkdir(parents=True,exist_ok=True);checks=[];errors=[]
 with tempfile.TemporaryDirectory() as temp,sync_playwright() as p:
  harness=Harness(Path(temp)/'store');path=Path(temp)/'original.png';Image.new('RGBA',(96,64),(35,127,101,255)).save(path);browser=launch_browser(p)
  try:
   page=browser.new_page(viewport={'width':1440,'height':1000},locale='ja-JP');page.on('pageerror',lambda e:errors.append(str(e)));page.on('dialog',lambda e:e.accept());page.expose_function('ph3TestRPC',harness.rpc)
   page.set_content('<html><head><link data-ph3-tool><style>'+(ROOT/'web/style.css').read_text(encoding='utf8')+'</style></head><body></body></html>');page.evaluate('async MODULE_URL=>{'+BRIDGE+'}',bundle_modules(page))
   def button(key,scope='.ph3-tool'):return page.locator(f'{scope} button[data-i18n="{key}"]').first
   def click(key,scope='.ph3-tool'):button(key,scope).click()
   def ready():page.wait_for_function('!document.querySelector(".ph3-top [data-i18n=save]").disabled')
   def snap():return page.evaluate('ph3Editor.snapshot()')
   def select():
    page.locator('[data-tool=rect]').click();b=page.locator('.ph3-canvas').bounding_box();page.mouse.move(b['x']+b['width']*.25,b['y']+b['height']*.25);page.mouse.down();page.mouse.move(b['x']+b['width']*.75,b['y']+b['height']*.75,steps=5);page.mouse.up();ready();page.wait_for_function('!!ph3Editor.snapshot().selection_asset')
   def pixels():return page.evaluate('''async()=>{const {RasterCache,exportCanvas}=await import('http://ph3-test.invalid/modules/render.mjs');const cache=new RasterCache(k=>ph3Client.assetURL(k));const c=await exportCanvas(ph3Editor.snapshot(),cache,{background:false});const values=[...c.getContext('2d').getImageData(0,0,c.width,c.height).data];cache.dispose();return values;}''')
   click('layers','.ph3-tabs')
   for key in ['duplicate','remove','up','down','mergeVisible']:assert button(key,'.ph3-panel[data-panel=layers]').is_disabled(),key
   click('editMenu','.ph3-top');assert button('pastePixels','.ph3-modal').is_disabled();assert button('pastePixels','.ph3-modal').get_attribute('title');page.locator('.ph3-modal-header [data-ph3-close]').click();checks.append('empty layer/edit commands are disabled with reasons')
   with page.expect_file_chooser() as fc:click('image','.ph3-left')
   fc.value.set_files(str(path));ready();base=snap()['layers'][0]['id'];click('properties','.ph3-tabs')
   assert button('maskLayer').is_disabled();assert button('clearLayerMask').is_disabled();assert button('clear').is_disabled();checks.append('no selection / no mask do not offer active mask or deselect actions')
   select();assert button('maskLayer').is_enabled();click('maskLayer');ready();rgba=pixels();assert rgba[3]==0 and rgba[(32*96+48)*4+3]==255;assert button('clearLayerMask').is_enabled();checks.append('masking an original image really hides outside pixels and enables mask removal')
   click('clearLayerMask');ready();assert pixels()[3]==255;assert button('clearLayerMask').is_disabled();checks.append('mask removal restores original pixels and becomes disabled again')
   page.locator('.ph3-viewport').focus();page.keyboard.press('Control+j');ready();page.wait_for_function('ph3Editor.snapshot().layers.length===2');copy=snap()['layers'][-1]['id'];click('layers','.ph3-tabs');page.locator(f'.ph3-layer[data-layer-id="{base}"] button').first.click();page.locator(f'.ph3-layer[data-layer-id="{copy}"] .ph3-layer-title').click();click('properties','.ph3-tabs')
   assert button('maskLayer').is_disabled();assert button('clearLayerMask').is_disabled();before=pixels();assert before[3]==0;checks.append('pasted cutout is already transparent; without a new selection both mask actions are disabled')
   select();click('maskLayer');ready();assert pixels()==before;checks.append('reapplying the identical selection to a cutout is visually identical, not a missing processing path')
   click('layers','.ph3-tabs');assert button('up','.ph3-panel[data-panel=layers]').is_disabled();assert button('down','.ph3-panel[data-panel=layers]').is_enabled();page.locator(f'.ph3-layer[data-layer-id="{copy}"] button').nth(1).click();ready();assert button('remove','.ph3-panel[data-panel=layers]').is_disabled();checks.append('front edge and locked-layer mutations are disabled')
   page.screenshot(path=str(output/'availability.png'));assert not errors,errors
  finally:browser.close()
 result={'passed':len(checks),'checks':checks,'page_errors':errors,'live_comfyui':False,'gpu':False};(output/'results.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf8');print(json.dumps(result,ensure_ascii=False))
if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('--output',required=True);main(Path(parser.parse_args().output))
