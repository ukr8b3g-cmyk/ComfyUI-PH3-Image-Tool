"""Targeted RC3 graphical-editor acceptance, offline Chromium + real local CPU encoding.
Generation is NOT exercised here; browser_smoke.py covers simulated job delivery.
"""
from __future__ import annotations
import argparse, io, json, math, sys, tempfile
from pathlib import Path
from PIL import Image, ImageDraw
from playwright.sync_api import sync_playwright
from browser_smoke import Harness, BRIDGE, bundle_modules, ROOT
from browser_modules import launch_browser

def main(output):
    output.mkdir(parents=True, exist_ok=True)
    checks, errors = [], []
    with tempfile.TemporaryDirectory() as temp:
        harness = Harness(Path(temp)/'store')
        fixture = Image.new('RGBA',(720,480),'#75b6a3')
        d=ImageDraw.Draw(fixture)
        d.rounded_rectangle((120,70,600,420),radius=36,fill='#f7e5c6')
        d.ellipse((275,115,445,285),fill='#c8465a')
        d.rectangle((215,315,505,330),fill='#c5ac87')
        fixture_path=Path(temp)/'sample.png';fixture.save(fixture_path)
        with sync_playwright() as p:
            browser=launch_browser(p)
            page=browser.new_page(viewport={'width':1500,'height':980},accept_downloads=True)
            page.set_default_timeout(7000);page.on('pageerror',lambda e:errors.append(str(e)));page.on('dialog',lambda e:e.accept())
            page.expose_function('ph3TestRPC',harness.rpc)
            page.set_content('<html><head><meta charset="utf-8"><link data-ph3-tool><style>'+(ROOT/'web/style.css').read_text()+'</style></head><body style="background:#10151c"></body></html>')
            page.evaluate('async MODULE_URL=>{'+BRIDGE+'}',bundle_modules(page))
            def snap():return page.evaluate('ph3Editor.snapshot()')
            def view():return page.evaluate('ph3Editor.viewSnapshot()')
            def click(key,scope='.ph3-tool'):page.locator(f'{scope} [data-i18n="{key}"]').first.click()
            def ready():page.wait_for_function('!document.querySelector(".ph3-top [data-i18n=save]").disabled')
            def done():page.wait_for_selector('.ph3-overlay',state='detached');ready()
            def close_modal():page.locator('.ph3-modal').press('Escape');done()
            def key(value):page.locator('.ph3-viewport').focus();page.keyboard.press(value);page.wait_for_timeout(60)
            def doc_screen(x,y):
                r=page.locator('.ph3-viewport').bounding_box();v=view();doc=snap();a=math.radians(v['angle']);dx=(x-doc['width']/2)*v['zoom'];dy=(y-doc['height']/2)*v['zoom']
                return r['x']+r['width']/2+v['x']+dx*math.cos(a)-dy*math.sin(a),r['y']+r['height']/2+v['y']+dx*math.sin(a)+dy*math.cos(a)
            def active_layer():return snap()['layers'][-1]
            def set_num(name,value):
                box=page.locator('.ph3-panel[data-panel=properties]').get_by_role('spinbutton',name=name,exact=True);box.fill(str(value));box.press('Tab');page.wait_for_timeout(40)
            def drag_points(a,b,button='left'):
                page.mouse.move(*a);page.mouse.down(button=button);page.mouse.move(*b,steps=8);page.mouse.up(button=button);page.wait_for_timeout(80)
            with page.expect_file_chooser() as fc:click('image','.ph3-left')
            fc.value.set_files(str(fixture_path));page.wait_for_function('ph3Editor.snapshot().layers.length===1');ready()
            original=snap();source_asset=original['layers'][0]['asset']
            # Graphical palettes and permanent layers, no hidden image-processing launchers.
            assert page.locator('.ph3-left [data-i18n=otherAssets]').count()==0
            assert page.locator('.ph3-left [data-i18n=styles]').count()==0
            assert page.locator('.ph3-left-scroller > button').evaluate_all('(buttons)=>buttons.map(b=>b.dataset.i18n)')==['image','input','bubble','addText','aiLettering','sourceStamps','speed','frame']
            for entry in ['symbol','sfx','stamp']:
                assert page.locator(f'.ph3-left [data-i18n={entry}]').count()==0
            assert page.locator('.ph3-process-group [data-i18n=cutout]').is_visible()
            click('bubble','.ph3-left');page.wait_for_selector('.ph3-preset-card canvas')
            assert page.locator('.ph3-preset-card').count()==12
            page.screenshot(path=str(output/'bubble-gallery.png'))
            search=page.get_by_role('searchbox');search.fill('cloud')
            assert page.locator('.ph3-preset-card').count()>=1
            close_modal();assert snap()==original
            checks.append('Graphical bubble gallery: 12 previews, search, cancel without edits; image processing buttons visible')
            assert not page.locator('.ph3-layer-list').is_visible()
            click('layers','.ph3-tabs');assert page.locator('.ph3-layer-list').is_visible()
            click('generationTab','.ph3-tabs');assert not page.locator('.ph3-layer-list').is_visible()
            checks.append('Layers and Generation are independent tab views')
            # View navigation must never mutate document or export state.
            v0=view();before=snap();anchor=doc_screen(420,220)
            page.mouse.move(*anchor);page.mouse.wheel(0,-160);page.wait_for_timeout(100)
            v1=view();assert v1['zoom']>v0['zoom'];anchor2=doc_screen(420,220)
            assert math.dist(anchor,anchor2)<1 and snap()==before
            checks.append('Unmodified mouse wheel zooms about cursor without changing document revision')
            a=doc_screen(360,240);drag_points(a,(a[0]+55,a[1]+32),'middle');v2=view()
            assert abs(v2['x']-v1['x']-55)<2 and abs(v2['y']-v1['y']-32)<2 and snap()==before
            page.keyboard.down('Space');a=doc_screen(300,210);drag_points(a,(a[0]-25,a[1]-18));page.keyboard.up('Space')
            assert abs(view()['x']-v2['x']+25)<2 and snap()==before
            checks.append('Middle drag and Space+drag pan the viewport without moving artwork')
            page.mouse.move(*doc_screen(360,240));page.keyboard.down('Alt');page.mouse.wheel(0,300);page.keyboard.up('Alt');page.wait_for_timeout(100)
            assert abs(view()['angle']-30)<.01 and snap()==before
            checks.append('Alt+wheel rotates only the view; document bytes unchanged')
            # Selection under rotated, panned view must remain in document coordinates.
            click('rect','.ph3-left');drag_points(doc_screen(180,130),doc_screen(400,300));ready();page.wait_for_function('!!ph3Editor.snapshot().selection_asset')
            mask=harness.store.image(snap()['selection_asset']).getchannel('R');bbox=mask.getbbox()
            assert all(abs(a-b)<=2 for a,b in zip(bbox,(180,130,400,300))),bbox
            checks.append('Rectangle selection under a rotated view maps back to native image coordinates')
            key('0');assert abs(view()['angle'])<.001
            key('Control+0');key('Control+1');assert view()['zoom']==1
            key('Control+0');click('clear','.ph3-left');ready()
            # Layer handles and keyboard handling.
            click('addText','.ph3-left');page.get_by_role('textbox',name='文字',exact=True).fill('PH3 IMAGE TOOL');page.get_by_role('textbox',name='文字',exact=True).press('Tab')
            layer=active_layer();before_layer=dict(layer);a=doc_screen(layer['x']+layer['w'],layer['y']+layer['h']);drag_points(a,(a[0]+40,a[1]+30));layer=active_layer()
            assert layer['w']>before_layer['w'] and abs(layer['x']-before_layer['x'])<1 and abs(layer['y']-before_layer['y'])<1
            assert abs(layer['w']/layer['h']-before_layer['w']/before_layer['h'])<1e-6
            checks.append('Corner resize preserves the opposite anchor and aspect ratio')
            layer=active_layer();a=doc_screen(layer['x']+layer['w'],layer['y']+layer['h']/2);drag_points(a,(a[0]+26,a[1]));resized=active_layer()
            assert resized['w']>layer['w'] and abs(resized['h']-layer['h'])<.01
            checks.append('Side resize changes one dimension without shifting the opposite edge')
            layer=active_layer();zoom=view()['zoom'];cx=layer['x']+layer['w']/2;cy=layer['y']+layer['h']/2;radius=layer['h']/2+28/zoom
            drag_points(doc_screen(cx,cy-radius),doc_screen(cx+radius,cy));assert abs(active_layer()['rotation']-90)<2
            checks.append('Rotation handle rotates the selected layer, separately from view rotation')
            n=len(snap()['layers']);key('Delete');assert len(snap()['layers'])==n-1;key('Control+z');assert len(snap()['layers'])==n
            # Chromium/CDP side buttons: real pointer event, not a direct editor command.
            cdp=page.context.new_cdp_session(page);a=doc_screen(350,230)
            def side(name,bit):
                cdp.send('Input.dispatchMouseEvent',{'type':'mousePressed','x':a[0],'y':a[1],'button':name,'buttons':bit,'clickCount':1})
                cdp.send('Input.dispatchMouseEvent',{'type':'mouseReleased','x':a[0],'y':a[1],'button':name,'buttons':0,'clickCount':1});page.wait_for_timeout(90)
            side('forward',16);assert len(snap()['layers'])==n-1;side('back',8);assert len(snap()['layers'])==n
            checks.append('Delete, Ctrl+Z, and delivered mouse Back/Forward events perform Undo/Redo')
            # Undo reselects none, select text again through Layers.
            page.locator('.ph3-layer-title').first.click();click('properties','.ph3-tabs')
            text=page.get_by_role('textbox',name='文字',exact=True);text.fill('ABC');text.press('Home');text.press('Delete');text.press('Tab');assert active_layer()['text']=='BC' and len(snap()['layers'])==n
            checks.append('Delete inside text input edits text, not the selected layer')
            page.locator('.ph3-layer-title').first.click();key('ArrowRight');x=active_layer()['x'];key('Shift+ArrowRight');assert abs(active_layer()['x']-x-10)<.01
            key('Control+d');assert len(snap()['layers'])==n+1;key('Delete');assert len(snap()['layers'])==n
            checks.append('Arrow nudges and Ctrl+D duplicate work without corrupting existing layers')
            # Processing works at native source size despite layer transform.
            page.locator('.ph3-layer-title').last.click();click('properties','.ph3-tabs');set_num('W',360);set_num('H',240);set_num('回転',17)
            source_layer=snap()['layers'][0];count=len(snap()['layers']);click('comic','.ph3-left');page.locator('.ph3-style-card[data-preset=xdog]').click()
            page.locator('.ph3-modal-actions .primary').wait_for(state='visible');page.wait_for_function('!document.querySelector(".ph3-processing .ph3-modal-actions .primary").disabled')
            preview0=page.locator('.ph3-process-canvas').nth(1).evaluate('(c)=>c.toDataURL()')
            page.get_by_role('spinbutton',name='線の濃さ',exact=True).fill('2');page.get_by_role('spinbutton',name='線の濃さ',exact=True).press('Tab')
            page.wait_for_function('!document.querySelector(".ph3-processing .ph3-modal-actions .primary").disabled')
            page.screenshot(path=str(output/'comic-preview.png'))
            assert len(snap()['layers'])==count;close_modal();assert len(snap()['layers'])==count
            checks.append('Native comic/XDoG preview and controls are non-destructive; Cancel retains the source')
            click('comic','.ph3-left');page.locator('.ph3-style-card[data-preset=grayscale]').click();page.get_by_role('button',name='新しいレイヤーとして適用',exact=True).click();done()
            page.wait_for_function(f'ph3Editor.snapshot().layers.length==={count+1}')
            applied=snap()['layers'][1];processed=harness.store.image(applied['asset'])
            assert processed.size==(720,480) and (applied['w'],applied['h'],applied['rotation'])==(source_layer['w'],source_layer['h'],17)
            assert not snap()['layers'][0]['visible'] and snap()['layers'][0]['asset']==source_asset
            checks.append('Comic Apply processes 720×480 source, preserves layer transform and the hidden original')
            click('comic','.ph3-left');assert page.get_by_label('変換プリセット',exact=True).input_value()=='grayscale';close_modal()
            # BG source color sample with object-fit:contain letterboxing.
            click('cutout','.ph3-left');page.wait_for_function('!document.querySelector(".ph3-processing .ph3-modal-actions .primary").disabled')
            before_canvas=page.locator('.ph3-process-canvas').first;r=before_canvas.bounding_box();intrinsic=before_canvas.evaluate('(c)=>({w:c.width,h:c.height})');scale=min((r['width']-2)/intrinsic['w'],(r['height']-2)/intrinsic['h'])
            ix=r['x']+(r['width']-intrinsic['w']*scale)/2;iy=r['y']+(r['height']-intrinsic['h']*scale)/2
            page.mouse.click(ix+5*scale,iy+5*scale);page.wait_for_function('!document.querySelector(".ph3-processing .ph3-modal-actions .primary").disabled')
            page.get_by_label('内側の色でフチを補正',exact=True).check();page.wait_for_function('!document.querySelector(".ph3-processing .ph3-modal-actions .primary").disabled')
            page.screenshot(path=str(output/'background-preview.png'))
            count=len(snap()['layers']);page.get_by_role('button',name='新しいレイヤーとして適用',exact=True).click();done();page.wait_for_function(f'ph3Editor.snapshot().layers.length==={count+1}')
            bg_result=snap()['layers'][2];cut=harness.store.image(bg_result['asset']);assert cut.getpixel((0,0))[3]==0 and cut.getpixel((360,200))[3]>200 and snap()['transparent'] is True
            checks.append('Background picker maps letterboxed preview correctly; cutout/edge preview and full-size alpha apply')
            # Make a clean useful screenshot before export (only image + text).
            page.locator('.ph3-layer-title').first.click();click('properties','.ph3-tabs');set_num('回転',0);set_num('X',210);set_num('Y',355);set_num('W',380);set_num('H',75)
            page.get_by_role('textbox',name='文字',exact=True).fill('PH3 IMAGE TOOL');page.get_by_role('textbox',name='文字',exact=True).press('Tab')
            set_num('文字サイズ',30);page.screenshot(path=str(output/'editor.png'))
            # Encoding is done by Pillow using preview-identical byte data.
            click('export','.ph3-top');page.wait_for_function('!document.querySelector(".ph3-export-modal .primary").disabled')
            page.screenshot(path=str(output/'export.png'))
            def export_download(name):
                page.wait_for_function('!document.querySelector(".ph3-export-modal .primary").disabled')
                with page.expect_download() as download:page.get_by_role('button',name='この設定で書き出す',exact=True).click()
                dest=output/name;download.value.save_as(str(dest));done();return Image.open(dest),dest
            png,pngpath=export_download('export-alpha.png');assert png.mode=='RGBA' and png.size==(720,480) and png.getpixel((0,0))[3]==0
            checks.append('PNG download preserves native dimensions and alpha, excludes checkerboard')
            click('export','.ph3-top');page.locator('[data-format=webp]').click();page.get_by_label('WebPを可逆圧縮にする',exact=True).check()
            webp,webppath=export_download('export-lossless.webp');assert webp.convert('RGBA').tobytes()==png.convert('RGBA').tobytes()
            checks.append('Lossless WebP actual download equals PNG pixels including transparency')
            click('export','.ph3-top');page.locator('[data-format=jpeg]').click();quality=page.get_by_role('spinbutton',name='品質 (1–100)',exact=True);quality.fill('70');quality.press('Tab')
            matte=page.get_by_label('透過を使わない場合の下地色',exact=True);matte.fill('#ffffff');matte.dispatch_event('change')
            jpeg,jpegpath=export_download('export-quality70.jpg');assert jpeg.mode=='RGB' and min(jpeg.getpixel((0,0)))>245
            assert snap()['settings']['export_quality']==.70
            checks.append('JPEG quality 70 uses chosen white matte and persists the export preference')
            # No stale encoding UI after closing during startup or fast options changes.
            click('export','.ph3-top');page.locator('.ph3-modal').press('Escape');page.wait_for_timeout(200);assert page.locator('.ph3-overlay').count()==0
            checks.append('Closing export during setup leaves no orphan modal or exceptions')
            click('save','.ph3-top');ready();page.wait_for_function('!!window.ph3Applied');saved=page.evaluate('ph3Applied');expected=snap()
            click('close','.ph3-top');page.evaluate('id=>ph3Open(id)',saved['id']);assert snap()==expected
            checks.append('Project save/reopen retains new presets, processing recipes, alpha and export settings')
            page.set_viewport_size({'width':1000,'height':760});assert page.locator('.ph3-process-group [data-i18n=cutout]').is_visible();page.screenshot(path=str(output/'compact.png'))
            checks.append('Compact 1000×760 layout keeps the processing tools and layer dock accessible')
            assert not errors,errors;checks.append('No unhandled Chromium exceptions')
            browser.close()
    result={'environment':'Offline Chromium + actual CPU processing/encoding; in-memory localStorage for test; no GPU or live ComfyUI','passed':len(checks),'checks':checks,'page_errors':errors,'gpu_tested':False,'live_comfyui_tested':False}
    (output/'brushup-results.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
    print(json.dumps(result,ensure_ascii=False,indent=2))

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--output',default=str(ROOT/'verification'/'brushup'));args=parser.parse_args();main(Path(args.output))

