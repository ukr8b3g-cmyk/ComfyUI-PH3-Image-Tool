import test from 'node:test';
import assert from 'node:assert/strict';
import {addMangaLayers,MANGA_ROLES} from '../web/manga-core.mjs';
import {makeLayer,History} from '../web/core.mjs';
const fixture=()=>({width:128,height:96,canvas_revision:0,settings:{},layers:[makeLayer('image',128,96,{asset:'original'}),makeLayer('bubble',128,96,{text:'こんにちは'}),makeLayer('text',128,96,{text:'original'})]});
const result={width:128,height:96,source_asset:'snapshot',layers:MANGA_ROLES.map(role=>({role,asset:role})),settings:{screen_lines:80},has_alpha:true};
test('adoption preserves source, editable decorations and alpha; undo restores original',()=>{
 const doc=fixture(),before=structuredClone(doc),history=new History();history.record(doc);
 addMangaLayers(doc,result,{sourceId:doc.layers[0].id});
 assert.equal(doc.layers.length,7);assert.equal(doc.layers[0].asset,'original');assert.equal(doc.layers[0].visible,false);
 assert.deepEqual(doc.layers.slice(-2),before.layers.slice(-2));assert.equal(doc.transparent,true);
 assert.deepEqual(history.undo(doc).layers,before.layers);
});
test('changed source is never hidden by a stale result',()=>{
 const doc=fixture(),signature=JSON.stringify(doc.layers[0]);doc.layers[0].asset='changed';
 addMangaLayers(doc,result,{sourceId:doc.layers[0].id,sourceSignature:signature});assert.equal(doc.layers[0].visible,true);
});
test('re-finishing hides only the previous manga group',()=>{
 const doc=fixture();const first=addMangaLayers(doc,result,{sourceId:doc.layers[0].id});
 addMangaLayers(doc,result,{sourceId:first[2].id});assert.equal(first.every(l=>!l.visible),true);assert.equal(doc.layers.filter(l=>l.visible&&l.processing).length,4);
});
test('layer and canvas limits fail before changing source visibility',()=>{
 const doc=fixture();doc.layers.push(...Array.from({length:251},()=>makeLayer('image',128,96)));const before=JSON.stringify(doc);
 assert.throws(()=>addMangaLayers(doc,result,{sourceId:doc.layers[0].id}));assert.equal(JSON.stringify(doc),before);
 assert.throws(()=>addMangaLayers(fixture(),{...result,width:256}));
});
test('locked sibling in a manga group cannot be hidden by re-finishing',()=>{
 const doc=fixture(),layers=addMangaLayers(doc,result,{sourceId:doc.layers[0].id});layers[0].locked=true;const before=JSON.stringify(doc);
 assert.throws(()=>addMangaLayers(doc,result,{sourceId:layers[2].id}));assert.equal(JSON.stringify(doc),before);
});
