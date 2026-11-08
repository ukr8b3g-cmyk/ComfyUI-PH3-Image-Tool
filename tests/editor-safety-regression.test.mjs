import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  makeLayer, History, ensureLayerCapacity, isDecorationLayer,
  imageInsertionIndex, insertImageLayer, candidateMatches
} from '../web/core.mjs';
import {addMangaLayers, MANGA_ROLES} from '../web/manga-core.mjs';

const doc = layers => ({width:128,height:96,canvas_revision:3,settings:{},layers});
const photo = (name,more={}) => ({id:name,type:'image',asset:name,visible:true,locked:false,opacity:1,x:0,y:0,w:128,h:96,rotation:0,...more});
const manga = {width:128,height:96,source_asset:'sample',settings:{screen_lines:200},has_alpha:false,
  layers:MANGA_ROLES.map(role=>({role,asset:role}))};

test('image decoration detection keeps stamps and AI lettering distinct',()=>{
  assert.equal(isDecorationLayer(photo('base')),false);
  assert.equal(isDecorationLayer(photo('stamp',{decoration:true})),true);
  assert.equal(isDecorationLayer(photo('lettering',{generation:{mode:'lettering'}})),true);
  assert.equal(isDecorationLayer({type:'text'}),true);
});
test('inserted generation is below visual decorations without reordering',()=>{
  const d=doc([photo('base'),photo('stamp',{decoration:true}),{id:'editable',type:'text'}]);
  insertImageLayer(d,photo('generated'));
  assert.deepEqual(d.layers.map(l=>l.id),['base','generated','stamp','editable']);
  assert.equal(imageInsertionIndex(d),2);
});
test('insert supports no decorations and keeps existing photos in order',()=>{
  const d=doc([photo('a'),photo('b')]);insertImageLayer(d,photo('c'));
  assert.deepEqual(d.layers.map(l=>l.id),['a','b','c']);
});
test('layer capacity rejects overflow and does not mutate input',()=>{
  const d=doc(Array.from({length:256},(_,i)=>photo(String(i))));const before=JSON.stringify(d);
  assert.throws(()=>insertImageLayer(d,photo('new')),/Layer limit/);
  assert.equal(JSON.stringify(d),before);
  assert.throws(()=>ensureLayerCapacity(d,4),/Layer limit/);
  assert.throws(()=>ensureLayerCapacity(d,-1),/Invalid layer count/);
});
test('capacity allows the boundary and rejects 4-layer manga overshoot',()=>{
  const d=doc(Array.from({length:255},(_,i)=>photo(String(i))));ensureLayerCapacity(d);
  assert.throws(()=>ensureLayerCapacity(d,2),/Layer limit/);
  const m=doc([photo('source'),...Array.from({length:252},(_,i)=>photo('f'+i))]);
  const before=JSON.stringify(m);
  assert.throws(()=>addMangaLayers(m,manga,{sourceId:'source'}),/Layer limit/);
  assert.equal(JSON.stringify(m),before);
});
test('manga input from a decoration preserves its decoration status',()=>{
  const d=doc([photo('base'),photo('stamp',{decoration:true}),{id:'text',type:'text'}]);
  const layers=addMangaLayers(d,manga,{sourceId:'stamp'});
  assert.ok(layers.every(l=>l.decoration===true));
  assert.equal(d.layers.find(l=>l.id==='stamp').visible,false);
});
test('manga without known source stays below decorations',()=>{
  const d=doc([photo('base'),photo('stamp',{decoration:true}),{id:'text',type:'text'}]);
  addMangaLayers(d,manga);
  assert.deepEqual(d.layers.map(l=>l.id).slice(-2),['stamp','text']);
});
test('generation export filters raster lettering and stamps',()=>{
  const render=readFileSync(new URL('../web/render.mjs',import.meta.url),'utf8');
  assert.match(render,/includeText\|\|!isDecorationLayer\(l\)/);
  assert.equal(isDecorationLayer(photo('stamp',{decoration:true})),true);
  assert.equal(isDecorationLayer(photo('letter',{generation:{mode:'lettering'}})),true);
});
test('in-progress edits must invalidate prior generation revision',()=>{
  const d={...doc([]),canvas_revision:9};
  const job={project_id:'p',request:{canvas:[128,96],canvas_revision:9}};
  assert.equal(candidateMatches(d,job,'p'),true);
  d.canvas_revision++;assert.equal(candidateMatches(d,job,'p'),false);
});
test('live edit handlers invalidate revision at the first preview event',()=>{
  const studio=readFileSync(new URL('../web/studio.mjs',import.meta.url),'utf8');
  assert.match(studio,/if\(!before\)\{before=clone\(doc\);doc\.canvas_revision\+\+;\}/);
  assert.match(studio,/if\(JSON\.stringify\(original\.layers\)!==JSON\.stringify\(doc\.layers\)\)history\.record\(original\);stashDraft\(\)/);
});
test('draft recovery occurs before model suggestions or queued draft writes',()=>{
  const studio=readFileSync(new URL('../web/studio.mjs',import.meta.url),'utf8');
  assert.ok(studio.indexOf('let draftRecovery=readDraftRecovery(record)')<studio.indexOf('catalog=await client.get'));
  assert.match(studio,/clearTimeout\(draftTimer\);if\(draftRecovery\)return;/);
  assert.match(studio,/if\(draftRecovery\)throw Error\(tr\('recoverDraftHelp'\)\)/);
  assert.match(studio,/if\(!closed\)offerDraftRecovery\(\)/);
});
test('local history keeps one snapshot per committed gesture',()=>{
  const d=doc([photo('a')]),history=new History();history.record(d);
  d.layers[0].x=22;d.canvas_revision++;
  const original=history.undo(d);assert.equal(original.layers[0].x,0);
  assert.equal(original.canvas_revision,d.canvas_revision+1);
});
