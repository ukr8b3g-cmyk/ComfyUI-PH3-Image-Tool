"""Exercise editor close choices in Chromium against the real project store."""

import argparse
import json
import tempfile
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

from browser_smoke import BRIDGE, ROOT, Harness, bundle_modules, launch_browser


class SaveFailureHarness(Harness):
    reject_save = False

    def rpc(self, op, path, data=None):
        if self.reject_save and op == 'put' and path.startswith('/projects/'):
            return {'error': 'Test save failure'}
        return super().rpc(op, path, data)


def main(output):
    checks = []
    errors = []
    with tempfile.TemporaryDirectory() as temp, sync_playwright() as playwright:
        harness = SaveFailureHarness(Path(temp) / 'store')
        browser = launch_browser(playwright)
        page = browser.new_page(viewport={'width': 1280, 'height': 900}, locale='ja-JP')
        page.set_default_timeout(8000)
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.expose_function('ph3TestRPC', harness.rpc)
        css = (ROOT / 'web' / 'style.css').read_text(encoding='utf-8')
        page.set_content('<meta charset="utf-8"><link data-ph3-tool><style>' + css + '</style>')
        page.evaluate('async MODULE_URL=>{' + BRIDGE + '}', bundle_modules(page))

        editor = page.locator('.ph3-tool[open]')
        prompt = editor.locator('.ph3-close-confirmation')
        close = editor.locator('.ph3-top [data-i18n=close]')
        save = editor.locator('.ph3-top [data-i18n=save]')
        save_close = prompt.locator('[data-i18n=saveAndClose]')
        discard = prompt.locator('[data-i18n=discardAndClose]')
        cancel = prompt.locator('[data-i18n=cancelClose]')
        project_id = harness.store.projects()[0]['id']
        draft_key = 'ph3-tool:draft:' + project_id

        def open_project():
            page.evaluate('id=>window.ph3Open(id)', project_id)
            expect(editor).to_be_visible()

        def add_text(value):
            editor.locator('.ph3-left [data-i18n=addText]').click()
            text = editor.locator('.ph3-panel[data-panel=properties] textarea').first
            text.fill(value)
            text.press('Tab')

        def draft():
            return page.evaluate('key=>localStorage.getItem(key)', draft_key)

        # Establish a saved baseline, including the automatically suggested settings.
        save.click()
        expect(save).to_be_enabled()
        original = harness.store.read(project_id)
        close.click()
        expect(editor).to_have_count(0)
        checks.append('Clean project closes directly')

        open_project()
        add_text('Discard me')
        close.click()
        expect(prompt.get_by_role('button', name='保存して閉じる', exact=True)).to_be_enabled()
        expect(prompt.get_by_role('button', name='保存せず閉じる', exact=True)).to_be_enabled()
        expect(cancel).to_be_focused()
        cancel.click()
        expect(prompt).to_have_count(0)
        expect(editor).to_be_visible()
        assert page.evaluate('ph3Editor.snapshot().layers[0].text') == 'Discard me'
        checks.append('Dirty close offers three actions and focuses Cancel; Cancel keeps edits')

        page.keyboard.press('Escape')
        expect(prompt).to_be_visible()
        page.keyboard.press('Escape')
        expect(prompt).to_have_count(0)
        expect(editor).to_be_visible()
        checks.append('Escape opens and cancels dirty close')

        page.wait_for_function('key=>localStorage.getItem(key)!==null', arg=draft_key)
        close.click()
        discard.click()
        expect(editor).to_have_count(0)
        assert draft() is None
        assert harness.store.read(project_id) == original
        open_project()
        assert not page.evaluate('ph3Editor.snapshot().layers.length')
        checks.append('Discard clears this draft and reopens the last saved project')

        add_text('Keep me')
        page.wait_for_function('key=>localStorage.getItem(key)!==null', arg=draft_key)
        recoverable = draft()
        harness.reject_save = True
        close.click()
        save_close.click()
        expect(prompt.get_by_role('alert')).to_have_text('Test save failure')
        expect(editor).to_be_visible()
        assert draft() == recoverable
        assert harness.store.read(project_id) == original
        assert page.evaluate('ph3Editor.snapshot().layers[0].text') == 'Keep me'
        checks.append('Save failure leaves the editor, draft and close choices available')

        harness.reject_save = False
        page.evaluate('''() => {
            const put = ph3Client.put;
            ph3Client.put = async (...args) => {
                await new Promise(resolve => { window.releaseCloseSave = resolve; });
                return put(...args);
            };
        }''')
        save_close.click()
        page.wait_for_function('typeof window.releaseCloseSave === "function"')
        expect(cancel).to_be_disabled()
        page.keyboard.press('Escape')
        expect(prompt).to_be_visible()
        assert harness.store.read(project_id) == original
        checks.append('Pending save keeps the dialog open and blocks dismissal')

        page.evaluate('window.releaseCloseSave()')
        expect(editor).to_have_count(0)
        saved = harness.store.read(project_id)
        assert saved['revision'] == original['revision'] + 1
        assert page.evaluate('ph3Applied.revision') == saved['revision']
        assert draft() is None
        open_project()
        assert page.evaluate('ph3Editor.snapshot().layers[0].text') == 'Keep me'
        assert not errors, errors
        checks.append('Save and close applies the saved revision and reopens with editable text')
        browser.close()

    result = {'environment': 'Chromium with real project storage', 'passed': len(checks), 'checks': checks}
    output.mkdir(parents=True, exist_ok=True)
    (output / 'results.json').write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', required=True, type=Path)
    main(parser.parse_args().output)
