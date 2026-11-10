"""Serve current ES modules to an isolated Playwright page without network I/O.

Native browser imports preserve query versions and resolve shared dependencies
once; no recursive data-URL expansion or source rewriting is necessary.
"""
from pathlib import Path
from urllib.parse import urlsplit,unquote
import mimetypes,os

WEB=Path(__file__).resolve().parents[1]/'web'
PREFIX='http://ph3-test.invalid/modules/'
def module_response(url):
 parts=urlsplit(url)
 if parts.scheme!='http' or parts.netloc!='ph3-test.invalid' or not parts.path.startswith('/modules/'):return 404,b'', 'text/plain'
 path=(WEB/unquote(parts.path[len('/modules/'):])).resolve()
 if not path.is_relative_to(WEB.resolve()) or not path.is_file():return 404,b'', 'text/plain'
 mime='text/javascript' if path.suffix in ('.mjs','.js') else mimetypes.guess_type(path.name)[0] or 'application/octet-stream'
 return 200,path.read_bytes(),mime
def install_module_routes(page):
 def serve(route):
  status,body,mime=module_response(route.request.url)
  route.fulfill(status=status,body=body,content_type=mime,headers={'Access-Control-Allow-Origin':'*'})
 page.route(PREFIX+'**',serve)
 return PREFIX+'studio.mjs'
def launch_browser(playwright):
 executable=os.environ.get('PH3_TEST_BROWSER')
 if not executable and Path('/usr/bin/chromium').is_file():executable='/usr/bin/chromium'
 options={'headless':True,'args':['--no-sandbox','--disable-dev-shm-usage']}
 if executable:options['executable_path']=executable
 return playwright.chromium.launch(**options)
