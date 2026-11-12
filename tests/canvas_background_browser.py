"""Chromium checks for generation scope, editable backgrounds, and real export/node pixels."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import tempfile
from unittest.mock import patch

import numpy as np
from PIL import Image, ImageDraw
from playwright.sync_api import expect, sync_playwright

from browser_smoke import BRIDGE, MODELS, NODES, ROOT, Harness, bundle_modules, launch_browser
from support import NATIVE_MODELS, generation, load, schema

nodes = load('nodes')


def main(output):
    output.mkdir(parents=True, exist_ok=True)
    checks = []
    errors = []
    with tempfile.TemporaryDirectory() as directory, sync_playwright() as playwright:
        folder = Path(directory)
        models = {**MODELS, **NATIVE_MODELS, 'native_enhancer_available': True}
        available = NODES | set(generation.NATIVE_NODES) | {'JsonExtractString'}
        harness = Harness(folder / 'store', models, available)
        doc = schema.default_document(160, 128)
        doc['settings'].update(
            model_engine=generation.NATIVE_IMAGE,
            h3_image_unet_name=NATIVE_MODELS['diffusion_models'][0],
            h3_image_clip_name=NATIVE_MODELS['text_encoders'][0],
            h3_image_vae_name=NATIVE_MODELS['vae'][0],
            h3_image_enhancer_name=NATIVE_MODELS['text_encoders'][1],
            auto_apply=False, locale='ja', locale_mode='ja',
            save_generated_images=False, random_seed=False,
        )
        record = harness.store.create(doc)
        image_path = folder / 'foreground.png'
        image = Image.new('RGBA', (160, 128))
        ImageDraw.Draw(image).rectangle((40, 28, 108, 96), fill='#db3244')
        image.save(image_path)

        browser = launch_browser(playwright)
        page = browser.new_page(viewport={'width': 1360, 'height': 900}, locale='ja-JP', accept_downloads=True)
        page.set_default_timeout(12000)
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.expose_function('ph3TestRPC', harness.rpc)
        css = (ROOT / 'web' / 'style.css').read_text(encoding='utf-8')
        page.set_content('<meta charset="utf-8"><link data-ph3-tool><style>' + css + '</style>')
        bridge = BRIDGE.replace('openStudio({client,onApply:', 'openStudio({client,projectId,onApply:', 1)
        page.evaluate('async ({MODULE_URL,projectId})=>{' + bridge + '}',
                      {'MODULE_URL': bundle_modules(page), 'projectId': record['id']})

        editor = page.locator('.ph3-tool[open]')
        scope = editor.locator('select[data-i18n-label=mode]')
        gen = editor.locator('[data-panel=generate]')
        props = editor.locator('[data-panel=properties]')
        layers = editor.locator('[data-panel=layers]')
        base = layers.locator('.ph3-layer-background')
        save = editor.locator('.ph3-top [data-i18n=save]')
        type_select = props.locator('[data-i18n-label=backgroundType]')
        snap = lambda: page.evaluate('ph3Editor.snapshot()')

        def tab(name):
            editor.locator(f'button[data-tab={name}]').click()

        def auto_mode(label):
            expect(scope).to_have_value('auto')
            expect(scope).to_have_attribute('title', f'自動 ({label})')

        def edit_background():
            tab('layers')
            expect(layers.locator('.ph3-layer-list + .ph3-layer-background')).to_be_visible()
            base.get_by_role('button', name='キャンバス背景', exact=True).click()
            expect(type_select).to_be_visible()

        def color(key, value):
            control = props.locator(f'input[data-i18n-label={key}]')
            control.evaluate('''(input,value)=>{
                input.value=value;
                input.dispatchEvent(new Event('input',{bubbles:true}));
                input.dispatchEvent(new Event('change',{bubbles:true}));
            }''', value)

        def wait_for_colors(minimum):
            page.wait_for_function('''count=>{
                const canvas=document.querySelector('.ph3-canvas');
                const pixels=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
                const colors=new Set();
                for(let i=0;i<pixels.length;i+=4){
                  colors.add(pixels[i]*65536+pixels[i+1]*256+pixels[i+2]);
                  if(colors.size>=count)return true;
                }
                return false;
            }''', arg=minimum)

        def prepare(key, expected):
            tab('generate')
            if snap()['prompt']['source'] != 'original':
                gen.locator('select[data-i18n-label=prompt]').select_option('original')
            gen.get_by_role('textbox', name='原文', exact=True).fill('Edit the image.')
            count = len(harness.graphs)
            gen.locator(f'button[data-i18n={key}]').click()
            page.wait_for_function('!document.querySelector(".ph3-top [data-i18n=save]").disabled')
            assert len(harness.graphs) == count + 1
            graph = harness.graphs[-1]
            job = harness.store.job(graph['90']['inputs']['job_id'])
            request = job['request']
            if key == 'enhance':
                assert request['mode'] == 'enhance' and request['enhance_scope'] == expected
                assert ('images.image1' in graph['2']['inputs']) == (expected != 'new')
                assert request['mask_asset'] is None
            else:
                assert request['mode'] == expected
                assert bool(request['mask_asset']) == (expected == 'selection')
            assert bool(request['crop_asset']) == (expected != 'new')
            if expected == 'selection':
                x, y, w, h = request['region']
                assert x > 0 and y > 0 and w < 160 and h < 128, request['region']
            return request

        auto_mode('白紙から生成')
        edit_background()
        expect(type_select).to_have_value('solid')
        color('background', '#e8f5ff')
        page.wait_for_function('''()=>{
            const context=document.querySelector('.ph3-canvas').getContext('2d');
            return [...context.getImageData(0,0,1,1).data].join(',')==='232,245,255,255';
        }''')
        for pattern in ('linear-gradient', 'radial-gradient', 'halftone', 'parallel-lines', 'checker'):
            previous_canvas = page.locator('.ph3-canvas').evaluate('canvas=>canvas.toDataURL()')
            type_select.select_option(pattern)
            page.wait_for_function('type=>ph3Editor.snapshot().background_pattern?.type===type', arg=pattern)
            page.wait_for_function('before=>document.querySelector(".ph3-canvas").toDataURL()!==before', arg=previous_canvas)
            wait_for_colors(2)
        color('backgroundPatternColor', '#25478a')
        recipe = snap()['background_pattern']
        editor.locator('.ph3-top [data-i18n=undo]').click()
        page.wait_for_function('ph3Editor.snapshot().background_pattern?.color==="#111111"')
        editor.locator('.ph3-top [data-i18n=redo]').click()
        page.wait_for_function('ph3Editor.snapshot().background_pattern?.color==="#25478a"')
        assert not snap()['layers'] and snap()['background_pattern'] == recipe
        checks.append('Solid and five patterned backgrounds draw in the bottom row, with editable colors and one Undo/Redo')

        prepare('generate', 'new')
        prepare('enhance', 'new')
        auto_mode('白紙から生成')
        checks.append('A patterned background alone resolves to New for both image and AI prompt generation')

        with page.expect_file_chooser() as chooser:
            editor.locator('.ph3-left button[data-i18n=image]').click()
        chooser.value.set_files(str(image_path))
        page.wait_for_function('ph3Editor.snapshot().layers.length===1')
        auto_mode('画像全体を編集')
        prepare('generate', 'full')
        prepare('enhance', 'full')
        editor.locator('button[data-tool=rect]').click()
        auto_mode('画像全体を編集')
        box = editor.locator('.ph3-canvas').bounding_box()
        page.mouse.move(box['x'] + box['width'] * .37, box['y'] + box['height'] * .35)
        page.mouse.down()
        page.mouse.move(box['x'] + box['width'] * .58, box['y'] + box['height'] * .55, steps=5)
        page.mouse.up()
        page.wait_for_function('!!ph3Editor.snapshot().selection_asset')
        auto_mode('選択範囲を編集')
        prepare('generate', 'selection')
        prepare('enhance', 'selection')
        checks.append('Both generation buttons use the full image until a real selection is made, then the selection crop')

        scope.select_option('full')
        editor.locator('button[data-tool=ellipse]').click()
        expect(scope).to_have_value('full')
        prepare('generate', 'full')
        prepare('enhance', 'full')
        tab('layers')
        image_eye = layers.locator('.ph3-layer-list .ph3-layer').first.locator('button').first
        image_eye.click()
        expect(scope).to_have_value('full')
        expect(gen.locator('[data-i18n=generate]')).to_be_disabled()
        tab('generate')
        scope.select_option('auto')
        auto_mode('白紙から生成')
        tab('layers')
        image_eye.click()
        auto_mode('選択範囲を編集')
        editor.locator('.ph3-left button[data-i18n=clear]').click()
        page.wait_for_function('!ph3Editor.snapshot().selection_asset')
        auto_mode('画像全体を編集')
        checks.append('Manual scope wins over tool/visibility changes; returning to Auto follows visible layers and deselection')

        def save_to_node():
            previous = page.evaluate('window.ph3Applied?.revision ?? 0')
            save.click()
            page.wait_for_function('previous=>ph3Applied.revision>previous', arg=previous)
            expect(save).to_be_enabled()
            return page.evaluate('ph3Applied')

        def node_pixels(saved):
            with patch.object(nodes, 'get_store', return_value=harness.store):
                result = nodes.PH3ImageTool().execute(saved['id'], saved['revision'])['result']
            rgb, alpha, selection = result
            assert tuple(rgb.shape) == (1, 128, 160, 3) and tuple(alpha.shape) == (1, 128, 160)
            assert not selection.any()
            return np.rint(np.dstack((rgb[0].numpy(), alpha[0].numpy())) * 255).astype('uint8')

        def export(format_name, destination, alpha):
            editor.locator('.ph3-top button[data-i18n=export]').click()
            modal = editor.locator('.ph3-export-modal')
            modal.locator(f'[data-format={format_name}]').click()
            preserve = modal.locator('input[data-i18n-label=preserveAlpha]')
            assert preserve.is_checked() == alpha
            if format_name == 'webp':
                modal.locator('input[data-i18n-label=webpLossless]').check()
            download = modal.get_by_role('button', name='この設定で書き出す', exact=True)
            expect(download).to_be_enabled()
            with page.expect_download() as event:
                download.click()
            event.value.save_as(output / destination)
            with Image.open(output / destination) as rendered:
                assert rendered.format == format_name.upper()
                return np.asarray(rendered.convert('RGBA'))

        visible = save_to_node()
        assert visible['document']['background_pattern'] == recipe
        visible_pixels = node_pixels(visible)
        assert np.all(visible_pixels[..., 3] == 255)
        assert tuple(visible_pixels[45, 80]) == (219, 50, 68, 255)
        assert len({tuple(visible_pixels[1, x]) for x in range(100)}) == 2
        assert np.array_equal(export('png', 'visible-background.png', False), visible_pixels)
        checks.append('Visible pattern and foreground match pixel for pixel between PNG export and the actual node output')

        tab('layers')
        base.get_by_role('button', name='キャンバス背景を隠す').click()
        hidden = save_to_node()
        assert hidden['document']['transparent'] and hidden['document']['background_pattern'] == recipe
        hidden_pixels = node_pixels(hidden)
        assert hidden_pixels[0, 0, 3] == 0 and hidden_pixels[45, 80, 3] == 255
        for format_name in ('png', 'webp'):
            exported = export(format_name, f'transparent-background.{format_name}', True)
            assert np.array_equal(exported[..., 3], hidden_pixels[..., 3])
            opaque = hidden_pixels[..., 3] == 255
            assert np.array_equal(exported[opaque], hidden_pixels[opaque])
        hidden = save_to_node()
        checks.append('Hiding the background preserves editable settings; transparent PNG, lossless WebP and node alpha agree')

        editor.locator('.ph3-top button[data-i18n=close]').click()
        expect(editor).to_have_count(0)
        page.evaluate('id=>ph3Open(id)', hidden['id'])
        edit_background()
        assert snap()['background_pattern'] == recipe and snap()['transparent']
        expect(type_select).to_have_value('checker')
        tab('layers')
        base.get_by_role('button', name='キャンバス背景を表示').click()
        assert snap()['background_pattern'] == recipe and not snap()['transparent']
        reopened = save_to_node()
        assert np.array_equal(node_pixels(reopened), visible_pixels)
        archive = harness.store.export(reopened['id'])
        portable = harness.store.import_archive(archive)
        assert portable['document']['background_pattern'] == recipe
        assert np.array_equal(node_pixels(portable), visible_pixels)
        checks.append('Saved projects and portable archives retain the background recipe, visibility and node pixels after reload')

        page.set_viewport_size({'width': 920, 'height': 680})
        tab('layers')
        expect(base).to_be_visible()
        page.screenshot(path=str(output / 'canvas-background-layer.png'))
        edit_background()
        page.screenshot(path=str(output / 'canvas-background-editor.png'))
        english_doc = reopened['document']
        english_doc['settings'].update(locale='en', locale_mode='en')
        english = harness.store.create(english_doc)
        editor.locator('.ph3-top button[data-i18n=close]').click()
        expect(editor).to_have_count(0)
        page.evaluate('id=>ph3Open(id)', english['id'])
        expect(scope).to_have_attribute('title', 'Auto (Edit entire image)')
        tab('layers')
        base.get_by_role('button', name='Canvas Background', exact=True).click()
        expect(props.get_by_role('combobox', name='Background type')).to_have_value('checker')
        checks.append('Japanese and English labels remain usable at a narrow viewport')
        assert not errors, errors
        browser.close()

    result = {'environment': 'Isolated Chromium, real storage/encoding and PH3 node execution, simulated generation',
              'passed': len(checks), 'checks': checks}
    (output / 'results.json').write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', required=True, type=Path)
    main(parser.parse_args().output)
