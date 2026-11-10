import re,unittest
from urllib.parse import urljoin
from browser_modules import module_response,install_module_routes,WEB,PREFIX

class BrowserModuleTests(unittest.TestCase):
 def test_versioned_import_closure_is_served_as_current_bytes(self):
  pending=[PREFIX+'studio.mjs'];seen=set();versioned=0
  while pending:
   url=pending.pop()
   if url in seen:continue
   seen.add(url);status,raw,mime=module_response(url);self.assertEqual(status,200,url);self.assertEqual(mime,'text/javascript')
   self.assertEqual(raw,(WEB/url.split('/modules/',1)[1].split('?',1)[0]).read_bytes())
   for dep in re.findall(r"(?:from\s*|import\s*)['\"](\./[^'\"]+\.mjs(?:\?[^'\"]*)?)['\"]",raw.decode('utf8')):
    versioned+='?v=' in dep;pending.append(urljoin(url,dep))
  self.assertGreater(len(seen),20);self.assertGreater(versioned,20)
 def test_invalid_paths_cannot_leave_web_root(self):
  for url in [PREFIX+'../storage.py',PREFIX+'%2e%2e/storage.py','http://other.invalid/modules/studio.mjs',PREFIX+'missing.mjs']:self.assertEqual(module_response(url)[0],404)
 def test_route_serves_versions_and_cors_without_network(self):
  class Page:
   def route(self,pattern,handler):self.pattern=pattern;self.handler=handler
  class Route:
   request=type('Request',(),{'url':PREFIX+'core.mjs?v=test'})()
   def fulfill(self,**kwargs):self.response=kwargs
  page=Page();self.assertEqual(install_module_routes(page),PREFIX+'studio.mjs');route=Route();page.handler(route)
  self.assertEqual(route.response['status'],200);self.assertEqual(route.response['headers']['Access-Control-Allow-Origin'],'*')
