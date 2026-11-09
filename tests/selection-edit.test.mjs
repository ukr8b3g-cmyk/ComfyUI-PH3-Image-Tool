import test from 'node:test';
import assert from 'node:assert/strict';
import {adjustedPixels,strokeCoverage,paintedPixels,localePreference} from '../web/selection-edit.mjs';
import {History} from '../web/core.mjs';

test('all adjustments honor selection coverage and preserve original alpha',()=>{
 const source=new Uint8ClampedArray([100,50,25,100,80,60,40,255]),mask=new Uint8ClampedArray([255,0]);
 for(const [type,settings] of [['hue_saturation',{hue:90}],['brightness_contrast',{brightness:30}],['curves',{channels:{rgb:[{x:0,y:255},{x:255,y:0}]}}]]){
  const result=adjustedPixels(source,mask,type,settings);
  assert.deepEqual([...result.slice(4)],[80,60,40,255]);assert.equal(result[3],100);assert.notDeepEqual([...result.slice(0,3)],[100,50,25]);
 }
 assert.deepEqual([...source],[100,50,25,100,80,60,40,255]);
});
test('fill can paint transparent pixels, deletion softens alpha and retains RGB',()=>{
 const source=new Uint8ClampedArray([90,80,70,0,90,80,70,200]),mask=new Uint8ClampedArray([255,128]);
 assert.deepEqual([...adjustedPixels(source,mask,'fill',{color:'#ff0000'}).slice(0,4)],[255,0,0,255]);
 assert.deepEqual([...adjustedPixels(source,mask,'delete',{})],[90,80,70,0,90,80,70,100]);
});
test('brush selection, hardness and opacity are independent of dab count',()=>{
 const selection=new Uint8ClampedArray(100);selection.fill(255,0,50);const coverage=new Uint8ClampedArray(100);
 strokeCoverage(coverage,10,10,{x:5,y:2},{x:5,y:8},6,50,selection);
 assert.ok(coverage.slice(0,50).some(v=>v>0));assert.ok(coverage.slice(50).every(v=>v===0));
 const once=new Uint8ClampedArray(coverage);strokeCoverage(coverage,10,10,{x:5,y:2},{x:5,y:8},6,50,selection);assert.deepEqual(coverage,once);
 const image=paintedPixels(new Uint8ClampedArray(400),coverage,'#ff0000',.5);assert.ok(Math.max(...image.filter((_,i)=>i%4===3))<=128);
});
test('each edit or stroke is independently undoable/redoable after JSON reload',()=>{
 let doc={canvas_revision:0,layers:[{id:'source',visible:true,asset:'original'},{id:'text',text:'keep'}]},history=new History();
 history.record(doc);doc.layers[0].visible=false;doc.layers.push({id:'adjustment',asset:'adjusted',retouch:{source_asset:'original'}});
 const applied=structuredClone(doc);doc=history.undo(doc);assert.equal(doc.layers.length,2);assert.equal(doc.layers[1].text,'keep');doc=history.redo(doc);assert.deepEqual(doc.layers,applied.layers);
 doc=JSON.parse(JSON.stringify(doc));history=new History();history.record(doc);doc.layers.push({id:'paint',asset:'painted',paint:true});const painted=structuredClone(doc);
 doc=history.undo(doc);assert.deepEqual(doc.layers,applied.layers);doc=history.redo(doc);assert.deepEqual(doc.layers,painted.layers);
});
test('auto language follows the host while explicit overrides survive host changes',()=>{
 assert.equal(localePreference({},'ja-JP'),'ja');assert.equal(localePreference({locale_mode:'auto'},'en-US'),'en');
 assert.equal(localePreference({locale_mode:'ja'},'en'),'ja');assert.equal(localePreference({locale_mode:'en'},'ja'),'en');
});
