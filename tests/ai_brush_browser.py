"""Check brush selection, queue preparation and masked adoption in Chromium."""

import argparse
import json
import tempfile
from pathlib import Path

from PIL import Image
from playwright.sync_api import expect, sync_playwright

from browser_smoke import BRIDGE, MODELS, NODES, ROOT, Harness, bundle_modules, launch_browser
from support import NATIVE_MODELS, generation


def main(output, native=False):
    checks = []
    errors = []
    with tempfile.TemporaryDirectory() as temp, sync_playwright() as playwright:
        folder = Path(temp)
        models = dict(MODELS)
        if native:
            for key, names in NATIVE_MODELS.items():
                models[key] = [*models.get(key, []), *names]
            models['native_enhancer_available'] = True
            alternate = 'models/minimax_h3_image_pruned_bf16.safetensors'
            models['diffusion_models'].append(alternate)
            models['schedulers'] = ['simple', 'normal']
        harness = Harness(folder / 'store', models, NODES | set(generation.NATIVE_NODES) | {'JsonExtractString'})
        image = folder / 'source.png'
        Image.new('RGB', (320, 240), '#56a887').save(image)
        browser = launch_browser(playwright)
        page = browser.new_page(viewport={'width': 1280, 'height': 900}, locale='ja-JP')
        page.set_default_timeout(8000)
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.expose_function('ph3TestRPC', harness.rpc)
        css = (ROOT / 'web' / 'style.css').read_text(encoding='utf-8')
        page.set_content('<meta charset="utf-8"><link data-ph3-tool><style>' + css + '</style>')
        page.evaluate('async MODULE_URL=>{' + BRIDGE + '}', bundle_modules(page))

        editor = page.locator('.ph3-tool[open]')
        generate_panel = editor.locator('[data-panel=generate]')
        scope = generate_panel.get_by_role('combobox', name='生成範囲', exact=True)
        generate = generate_panel.locator('[data-i18n=generate]')
        save = editor.locator('.ph3-top [data-i18n=save]')
        if native:
            editor.locator('.ph3-top [data-i18n=settings]').click()
            settings = editor.locator('.ph3-modal')
            engine = settings.locator('[data-i18n-label=modelEngine]')
            engine.select_option(generation.NATIVE_IMAGE)
            fields = settings.locator('[data-model=minimax_h3_image]')
            expect(fields.locator('[data-i18n-label=unet]')).to_have_value(NATIVE_MODELS['diffusion_models'][0])
            expect(fields.locator('[data-i18n-label=clip]')).to_have_value(NATIVE_MODELS['text_encoders'][0])
            expect(fields.locator('[data-i18n-label=vae]')).to_have_value(NATIVE_MODELS['vae'][0])
            expect(settings.locator('[data-model=ph3]')).to_be_hidden()
            enhancer = fields.locator('[data-i18n-label=upsampler]')
            expect(enhancer).to_have_value('')
            enhancer.select_option(NATIVE_MODELS['text_encoders'][1])
            fields.locator('[data-i18n-label=unet]').select_option(alternate)
            fields.locator('summary').click()
            steps = fields.locator('[data-i18n-label=steps]')
            expect(steps).to_have_value('6')
            steps.fill('8');steps.press('Tab')
            fields.locator('[data-i18n-label=scheduler]').select_option('normal')
            settings.locator('.ph3-modal-actions button.primary').click()
            expect(settings).to_have_count(0)
            assert page.evaluate('ph3Editor.snapshot().settings.unet_name') == MODELS['diffusion_models'][0]
            expect(generate).to_have_accessible_name('画像を生成')
            checks.append('Native image model settings choose installed files and preserve the P-H3 configuration')
        with page.expect_file_chooser() as choice:
            editor.locator('.ph3-left [data-i18n=image]').click()
        choice.value.set_files(str(image))
        page.wait_for_function('ph3Editor.snapshot().width===320 && ph3Editor.snapshot().layers.length===1')
        expect(save).to_be_enabled()
        original = page.evaluate('ph3Editor.snapshot().layers[0]')

        editor.locator('[data-tab=layers]').click()
        viewbar = editor.locator('.ph3-viewbar')
        sidebar = editor.locator('.ph3-left')
        for tool in ('move', 'hand'):
            expect(viewbar.locator(f'button[data-tool={tool}]')).to_be_visible()
            expect(sidebar.locator(f'button[data-tool={tool}]')).to_have_count(0)
        expect(sidebar.locator('button[data-tool=paint]')).to_be_visible()
        brush = sidebar.get_by_role('button', name='AIブラシ', exact=True)
        brush.click()
        expect(brush).to_have_attribute('aria-pressed', 'true')
        expect(scope).to_have_value('selection')
        expect(generate).to_be_disabled()
        checks.append('AI brush opens the partial generation panel; generation waits for a selection')

        def stroke(x):
            canvas = editor.locator('.ph3-canvas').bounding_box()
            screen_x = canvas['x'] + canvas['width'] * x
            page.mouse.move(screen_x, canvas['y'] + canvas['height'] * .35)
            page.mouse.down()
            page.mouse.move(screen_x, canvas['y'] + canvas['height'] * .55, steps=8)
            page.mouse.up()
            expect(save).to_be_enabled()
            return page.evaluate('ph3Editor.snapshot().selection_asset')

        size = viewbar.locator('.ph3-brush-size input[type=number]')
        viewport = editor.locator('.ph3-viewport')
        box = viewport.bounding_box()
        x, y = box['x'] + box['width'] / 2, box['y'] + box['height'] / 2

        def resize_brush(cancel=False):
            page.mouse.move(x, y)
            page.keyboard.down('Alt')
            page.mouse.down(button='right')
            page.mouse.move(x + 20, y, steps=4)
            page.keyboard.up('Alt')
            if cancel:
                viewport.press('Escape')
            page.mouse.up(button='right')

        expect(size).to_have_value('32')
        resize_brush()
        expect(size).to_have_value('52')
        sidebar.locator('button[data-tool=brush]').click()
        expect(size).to_have_value('32')
        viewport.press('BracketRight')
        expect(size).to_have_value('38')
        resize_brush()
        expect(size).to_have_value('58')
        resize_brush(cancel=True)
        expect(size).to_have_value('58')
        assert page.evaluate('ph3Editor.snapshot().selection_asset') is None
        brush.click()
        expect(size).to_have_value('52')
        checks.append('Navigation tools are above the canvas; sidebar brushes resize independently by keyboard and right drag, with Escape cancel')
        size.fill('18');size.press('Tab')
        first = stroke(.4)
        assert first and harness.store.image(first).getchannel('R').getpixel((115,110)) == 0
        scope.select_option('full')
        size.fill('42');size.press('Tab')
        selection_asset = stroke(.6)
        expect(scope).to_have_value('selection')
        selected = harness.store.image(selection_asset).getchannel('R')
        assert [selected.getpixel((x, 110)) for x in (128, 160, 192)] == [255, 0, 255]
        assert selected.getpixel((208,110)) == 255
        assert page.evaluate('ph3Editor.snapshot().layers') == [original]
        assert not harness.graphs
        checks.append('Two strokes add distinct regions without modifying pixels or queuing generation')

        editor.locator('.ph3-top [data-i18n=undo]').click()
        page.wait_for_function('asset=>ph3Editor.snapshot().selection_asset!==asset', arg=selection_asset)
        editor.locator('.ph3-top [data-i18n=redo]').click()
        page.wait_for_function('asset=>ph3Editor.snapshot().selection_asset===asset', arg=selection_asset)
        expect(save).to_be_enabled()
        checks.append('Undo and redo restore the brush selection')

        editor.locator('.ph3-viewport').press('Delete')
        page.wait_for_function('!!ph3Editor.snapshot().layers[0].mask_asset')
        deleted = page.evaluate('ph3Editor.snapshot().layers[0]')
        expect(save).to_be_enabled()
        editor.locator('.ph3-viewport').press('Delete')
        expect(save).to_be_enabled()
        assert page.evaluate('ph3Editor.snapshot().layers') == [deleted]
        assert harness.store.image(deleted['mask_asset']).getchannel('R').getpixel((128,110)) == 0
        editor.locator('.ph3-top [data-i18n=undo]').click()
        page.wait_for_function('!ph3Editor.snapshot().layers[0].mask_asset')
        expect(save).to_be_enabled()
        checks.append('Repeated Delete changes one layer mask and Undo restores it')

        generate_panel.get_by_role('textbox', name='原文', exact=True).fill('Add two small red highlights.')
        if native:
            generate_panel.locator('[data-i18n=enhance]').click()
            page.wait_for_function('ph3Editor.snapshot().prompt.source === "ai"', timeout=15000)
            enhance = harness.graphs[0]
            assert enhance['1']['inputs']['clip_name'] == NATIVE_MODELS['text_encoders'][1]
            assert enhance['3']['class_type'] == 'JsonExtractString'
            assert enhance['2']['inputs']['images.image1'] == ['20', 0]
            checks.append('Optional prompt enhancement uses its own local model and the current selection crop')
        generate.click()
        page.wait_for_function('ph3Editor.snapshot().layers.length===2', timeout=15000)
        layers = page.evaluate('ph3Editor.snapshot().layers')
        assert layers[0] == original and len(harness.graphs) == (2 if native else 1)
        job = harness.store.job(layers[1]['generation']['job_id'])
        request = job['request']
        assert request['mode'] == 'selection' and request['mask_asset'] and request['crop_asset']
        assert harness.graphs[-1]['6']['class_type'] == ('MiniMaxH3ImageConditioning' if native else 'PH3ImageConditioning')
        if native:
            graph = harness.graphs[-1]
            assert graph['1']['inputs']['unet_name'] == alternate
            assert graph['11']['inputs']['steps'] == 8 and graph['11']['inputs']['scheduler'] == 'normal'
            checks.append('Chosen checkpoint and sampling overrides reach ComfyUI')
        x, y, width, height = request['region']
        assert width < 320 and height < 240
        assert layers[1]['mask_asset'] == request['mask_asset']
        alpha = harness.store.image(job['results'][0]['asset']).getchannel('A')
        assert alpha.tobytes() == harness.store.image(request['mask_asset']).getchannel('R').tobytes()
        assert [alpha.getpixel((sample - x, 110 - y)) > 0 for sample in (128, 160, 192)] == [True, False, True]
        save.click()
        expect(save).to_be_enabled()
        composite = page.evaluate('ph3Applied.document.composite_asset')
        before = harness.store.image(original['asset']).getdata()
        after = harness.store.image(composite).getdata()
        changed = [value for value, old, new in zip(selected.getdata(), before, after) if old != new]
        assert changed and all(changed)
        assert not errors, errors
        checks.append('Simulated generation adopts a new masked layer with zero alpha outside the brushed regions')
        browser.close()

    result = {'environment': 'Chromium with real project storage and simulated generation',
              'passed': len(checks), 'checks': checks}
    output.mkdir(parents=True, exist_ok=True)
    (output / 'results.json').write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--native', action='store_true')
    args = parser.parse_args()
    main(args.output, args.native)
