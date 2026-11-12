"""Exercise selection without leaving Generate and the default floating Layers layout."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import tempfile

from PIL import Image, ImageDraw
from playwright.sync_api import expect, sync_playwright

from browser_smoke import BRIDGE, ROOT, Harness, bundle_modules, launch_browser


def main(output):
    output.mkdir(parents=True, exist_ok=True)
    checks = []
    errors = []
    with tempfile.TemporaryDirectory() as directory, sync_playwright() as playwright:
        folder = Path(directory)
        harness = Harness(folder / 'store')
        image_path = folder / 'selection-fixture.png'
        image = Image.new('RGB', (640, 480), '#58a888')
        ImageDraw.Draw(image).rectangle((110, 95, 425, 330), fill='#df755d')
        image.save(image_path)
        css = (ROOT / 'web' / 'style.css').read_text(encoding='utf-8')
        browser = launch_browser(playwright)

        def open_page(width, height):
            page = browser.new_page(viewport={'width': width, 'height': height}, locale='ja-JP')
            page.set_default_timeout(10000)
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.expose_function('ph3TestRPC', harness.rpc)
            page.set_content('<meta charset="utf-8"><link data-ph3-tool><style>' + css + '</style>')
            page.evaluate('window.ph3TestDefaultPanels=true')
            page.evaluate('async MODULE_URL=>{' + BRIDGE + '}', bundle_modules(page))
            return page

        def check_layer_frame(editor):
            frame = editor.locator('.ph3-floating[data-i18n-label=layers]')
            expect(frame).to_be_visible()
            expect(editor.locator('[data-tab=layers]')).to_be_hidden()
            header = frame.locator('.ph3-floating-header')
            expect(header.locator('button')).to_have_count(1)
            expect(header.locator('[data-i18n=dockPanel]')).to_be_visible()
            panel = frame.bounding_box()
            viewport = editor.locator('.ph3-viewport').bounding_box()
            assert panel['x'] + panel['width'] <= viewport['x'] + viewport['width'], (panel, viewport)
            return frame

        page = open_page(1360, 900)
        editor = page.locator('.ph3-tool[open]')
        generate_tab = editor.locator('[data-tab=generate]')
        scope = editor.locator('select[data-i18n-label=mode]')
        save = editor.locator('.ph3-top [data-i18n=save]')
        layers = check_layer_frame(editor)
        expect(generate_tab).to_have_class('active')
        checks.append('Layers floats next to the canvas on a fresh open while Generate remains active')

        order = editor.locator('.ph3-tool-grid button[data-tool]').evaluate_all(
            'buttons=>buttons.map(button=>button.dataset.tool)')
        assert order[:4] == ['lasso', 'aiBrush', 'rect', 'ellipse']
        checks.append('Lasso and AI brush occupy the first row before Rectangle and Ellipse')

        with page.expect_file_chooser() as event:
            editor.locator('.ph3-left button[data-i18n=image]').click()
        event.value.set_files(str(image_path))
        page.wait_for_function('ph3Editor.snapshot().layers.length===1')
        expect(save).to_be_enabled()
        box = editor.locator('.ph3-canvas').bounding_box()
        assert box['x'] + box['width'] < layers.bounding_box()['x'], (box, layers.bounding_box())

        prompt = editor.locator('[data-panel=generate] textarea[data-i18n-label=original], [data-panel=generate] textarea[aria-label="原文"]').first
        prompt.fill('選択した部分を編集する')
        clear = editor.locator('.ph3-left button[data-i18n=clear]')

        def draw_selection(tool):
            editor.locator(f'button[data-tool={tool}]').click()
            def point(x, y):
                return (box['x'] + box['width'] * x, box['y'] + box['height'] * y)
            start = point(.25, .30)
            if tool in ('wand', 'colorRange'):
                page.mouse.click(*start)
            else:
                page.mouse.move(*start)
                page.mouse.down()
                if tool == 'lasso':
                    page.mouse.move(*point(.52, .31), steps=4)
                    page.mouse.move(*point(.46, .62), steps=4)
                    page.mouse.move(*point(.26, .56), steps=4)
                else:
                    page.mouse.move(*point(.54, .61), steps=5)
                page.mouse.up()
            page.wait_for_function('!!ph3Editor.snapshot().selection_asset')
            expect(save).to_be_enabled()

        def selection_colors():
            return editor.locator('.ph3-canvas').evaluate("""c=>{
                const ctx=c.getContext('2d'),w=c.width,h=c.height;
                const inner=Array.from(ctx.getImageData(Math.floor(w*.36),Math.floor(h*.45),1,1).data);
                const area=ctx.getImageData(Math.floor(w*.23),Math.floor(h*.28),Math.ceil(w*.31),Math.ceil(h*.36)).data;
                let black=0,white=0;
                for(let i=0;i<area.length;i+=4){
                    if(area[i]===area[i+1]&&area[i]===area[i+2]&&area[i+3]===255){
                        if(area[i]===0)black++;
                        if(area[i]===255)white++;
                    }
                }
                return {inner,black,white};
            }""")

        unselected = selection_colors()
        for tool in ('lasso', 'rect', 'ellipse', 'brush', 'wand', 'colorRange', 'aiBrush'):
            expect(generate_tab).to_have_class('active')
            draw_selection(tool)
            expect(generate_tab).to_have_class('active')
            expect(scope).to_have_value('auto')
            expect(scope).to_have_attribute('title', '自動 (選択範囲を編集)')
            expect(prompt).to_have_value('選択した部分を編集する')
            if tool == 'lasso':
                selected = selection_colors()
                assert selected['inner'] == unselected['inner'], (selected, unselected)
                assert selected['black'] > unselected['black'] and selected['white'] > unselected['white'], selected
                checks.append('Selection keeps original canvas colors inside the visible dotted outline')
                page.screenshot(path=str(output / 'generate-with-selection.png'))
            clear.click()
            page.wait_for_function('!ph3Editor.snapshot().selection_asset')
            expect(generate_tab).to_have_class('active')
            expect(scope).to_have_attribute('title', '自動 (画像全体を編集)')
        checks.append('Seven selection tools and deselection keep Generate and its prompt in place')

        editor.locator('[data-tab=properties]').click()
        draw_selection('wand')
        expect(editor.locator('[data-tab=properties]')).to_have_class('active')
        checks.append('A deliberately opened Properties tab stays in place during selection')

        layers.locator('.ph3-floating-header [data-i18n=dockPanel]').click()
        expect(layers).to_have_count(0)
        expect(editor.locator('[data-tab=layers]')).to_have_class('active')
        save.click()
        page.wait_for_function('!!window.ph3Applied?.id')
        expect(save).to_be_enabled()
        project_id = page.evaluate('ph3Applied.id')
        editor.locator('.ph3-top [data-i18n=close]').click()
        expect(editor).to_have_count(0)
        page.evaluate('id=>ph3Open(id)', project_id)
        expect(layers).to_have_count(0)
        expect(editor.locator('[data-tab=layers]')).to_be_visible()
        expect(generate_tab).to_have_class('active')
        checks.append('Dock returns Layers to the sidebar and the explicit layout survives reopening')

        for key, action in (('properties', 'floatProperties'), ('candidates', 'floatHistory')):
            editor.locator(f'[data-tab={key}]').click()
            editor.locator(f'[data-panel={key}] [data-i18n={action}]').click()
            header = editor.locator(f'.ph3-floating[data-i18n-label={key}] .ph3-floating-header')
            expect(header.locator('button')).to_have_count(1)
            header.locator('[data-i18n=dockPanel]').click()
            expect(header).to_have_count(0)
        expect(editor.locator('.ph3-top [data-i18n=close]')).to_be_visible()
        checks.append('Every floating panel has one Dock action; the editor still has its own Close')

        narrow = open_page(920, 680)
        narrow_editor = narrow.locator('.ph3-tool[open]')
        check_layer_frame(narrow_editor)
        expect(narrow_editor.locator('[data-panel=generate] [data-i18n=generate]')).to_be_visible()
        checks.append('The default floating panel leaves Generate accessible at a narrow desktop size')
        assert not errors, errors
        browser.close()

    result = {'environment': 'Isolated Chromium with real canvas and project storage',
              'passed': len(checks), 'checks': checks}
    (output / 'results.json').write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', required=True, type=Path)
    main(parser.parse_args().output)
