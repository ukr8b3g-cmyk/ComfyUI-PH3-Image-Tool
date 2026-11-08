"""Version local ES-module edges together after frontend edits (no dependencies)."""
from pathlib import Path
import hashlib,re

def version_web(web):
    paths=sorted([web/'extension.js',*web.glob('*.mjs')])
    pattern=re.compile(r"(\./[\w-]+\.mjs)(?:\?v=[\w-]+)?(?=['\"])")
    texts={p:pattern.sub(r'\1',p.read_text(encoding='utf-8')) for p in paths}
    version=hashlib.sha256(''.join(p.name+texts[p] for p in paths).encode()).hexdigest()[:16]
    for p,text in texts.items():
        p.write_text(pattern.sub(lambda m:m.group(1)+'?v='+version,text),encoding='utf-8')
    return version

if __name__=='__main__':print(version_web(Path(__file__).resolve().parents[1]/'web'))
