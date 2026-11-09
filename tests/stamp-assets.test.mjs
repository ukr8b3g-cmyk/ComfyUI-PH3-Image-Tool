import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {SOURCE_ASSETS,STAMP_ASSETS} from '../web/source-assets.mjs';

test('stamp picker merges existing stamps with retained symbols and rarity badges',()=>{
 assert.equal(STAMP_ASSETS.length,110);
 assert.equal(new Set(STAMP_ASSETS.map(a=>a.path)).size,110);
 for(const a of SOURCE_ASSETS.filter(a=>a.category==='stamps')) assert.ok(STAMP_ASSETS.includes(a),a.path);
 for(const file of ['anger-mark-mask.webp','arrow-loop-mask.webp','rough-underline-mask.webp','basic-square-mask.webp','hot-spring-mask.webp','dizzy-spiral-mask.webp','music-notes-mask.webp','motion-swish-mask.webp','brush-exclamation-mask.webp','brush-question-mask.webp','filled-heart-mask.webp','crown_ssr_gold.png','crown_n_green.png','ribbon_rare_red.png','ribbon_super_rare_gold.png'])
  assert.ok(STAMP_ASSETS.some(a=>a.path==='sfx/'+file),file);
 for(const a of STAMP_ASSETS) assert.ok(existsSync(new URL('../web/source-assets/'+a.path,import.meta.url)),a.path);
});

test('word effects are hidden while original catalog and project files stay intact',()=>{
 assert.equal(SOURCE_ASSETS.length,329);
 assert.equal(SOURCE_ASSETS.filter(a=>!STAMP_ASSETS.includes(a)).length,219);
 for(const file of ['yadaa-mask.webp','yamero-horizontal-gpt-v1.webp','zokuzoku-mask.webp','sucha-reference-vertical-mask.webp','pink-stamp-biku-heart.webp','sfx-png-corrected-list-v2/png/02_biku_katakana_heart.png']) {
  const path='sfx/'+file;
  assert.ok(SOURCE_ASSETS.some(a=>a.path===path),path);
  assert.ok(!STAMP_ASSETS.some(a=>a.path===path),path);
  assert.ok(existsSync(new URL('../web/source-assets/'+path,import.meta.url)),path);
 }
 const studio=readFileSync(new URL('../web/studio.mjs',import.meta.url),'utf8');
 const menu=studio.slice(studio.indexOf("  left.append(button('bubble'"),studio.indexOf("  left.append(button('bubble'")+900);
 assert.ok(menu.includes("button('aiLettering'"));
 assert.ok(menu.includes("button('sourceStamps'"));
 for(const key of ['sourceSfx','otherAssets','styles']) assert.ok(!menu.includes("button('"+key+"'"));
});
