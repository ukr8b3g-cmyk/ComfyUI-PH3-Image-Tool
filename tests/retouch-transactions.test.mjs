import {editableRetouch,bakeRetouch} from '../web/edit-provenance.mjs';
import {previewRasterKey,modifiedRaster} from '../web/render.mjs';
// Executes the actual editor handlers with deterministic in-memory rasters and
// asset transport. This is an integration fixture, not a browser/GPU test.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {History,clone,makeLayer,uid,ensureLayerCapacity} from '../web/core.mjs';
import {adjustedPixels,strokeCoverage,paintedPixels} from '../web/selection-edit.mjs';
import {maskBounds} from '../web/selection.mjs';
const studio=readFileSync(new URL('../web/studio.mjs',import.meta.url),'utf8');
const handlers=studio.slice(studio.indexOf('  async function beginRetouch('),studio.indexOf('  function renderLayers(){'));
function canvas(w,h){
 const image={width:w,height:h,data:new Uint8ClampedArray(w*h*4)};
 image.getContext=()=>({drawImage(src){image.data.set(src.data);},getImageData(){return{data:new Uint8ClampedArray(image.data)};},createImageData(){return{data:new Uint8ClampedArray(image.data.length)};},putImageData(p){image.data.set(p.data);}});return image;
}
function fixture(){
 const source=canvas(4,4);source.data.fill(90);for(let i=3;i<source.data.length;i+=4)source.data[i]=200;
 const assets=new Map([['source',source]]);let uploads=0;
 const doc={width:4,height:4,canvas_revision:1,settings:{paint_size:2,paint_hardness:100,paint_opacity:50,paint_color:'#ff0000'},layers:[makeLayer('image',4,4,{id:'source-layer',asset:'source',x:0,y:0,w:4,h:4}),makeLayer('text',4,4,{id:'text',text:'keep me'})]};
 const history=new History();
 const ctx={doc,selected:'source-layer',record:{id:'project'},retouchSession:null,gesture:null,paintPreview:null,history,editableRetouch,bakeRetouch,previewRasterKey,modifiedRaster,canvas,clone,makeLayer,uid,ensureLayerCapacity,adjustedPixels,strokeCoverage,paintedPixels,maskBounds,
   selection:new Uint8ClampedArray([255,255,0,0,255,255,0,0,0,0,0,0,0,0,0,0]),rasters:new Map([['source',source]]),imageRasterKey:l=>l.asset,
   cache:{get:async key=>assets.get(key),prepare:async()=>assets},selectedImage:()=>ctx.doc.layers.find(l=>l.id===ctx.selected&&l.type==='image'),
   layerSelectionMask:(_l,mask,_dw,_dh,w,h)=>{const c=canvas(w,h);for(let i=0;i<mask.length;i++)c.data[i*4]=mask[i];return c;},
   readMask:image=>Uint8ClampedArray.from({length:16},(_,i)=>image.data[i*4]),
   maskCanvas:(mask,w,h)=>{const c=canvas(w,h);for(let i=0;i<mask.length;i++)c.data[i*4]=mask[i];return c;},
   toBlob:async c=>c,client:{upload:async image=>{const key='asset-'+(++uploads);assets.set(key,image);return{asset:key};}},
   withBusy:async fn=>fn(),showTab(){},renderProperties(){},renderAll:async()=>{},draw(){},stashDraft(){},tr:k=>k,fail:e=>{throw e;},
   commit(fn){history.record(ctx.doc);fn(ctx.doc);ctx.doc.canvas_revision++;}};
 vm.createContext(ctx);vm.runInContext(handlers,ctx);return{ctx,history,assets};
}
for(const type of ['hue_saturation','brightness_contrast','curves','fill','delete'])test(type+' apply/Undo/Redo preserves editable text and source assets',async()=>{
 const {ctx,history,assets}=fixture(),original=clone(ctx.doc.layers);
 await ctx.beginRetouch(type);if(type==='hue_saturation')ctx.retouchSession.settings.hue=90;
 if(type==='brightness_contrast')ctx.retouchSession.settings.brightness=40;
 ctx.previewRetouch();await ctx.applyRetouch();
 assert.equal(ctx.doc.layers.length,3);assert.equal(ctx.doc.layers.find(l=>l.id==='text').text,'keep me');assert.equal(ctx.doc.layers[0].visible,false);
 const result=clone(ctx.doc.layers),pixel=assets.get(ctx.doc.layers[1].asset).data;
 assert.deepEqual([...pixel.slice(8,16)],[90,90,90,200,90,90,90,200]);
 ctx.doc=history.undo(ctx.doc);assert.deepEqual(ctx.doc.layers,original);
 ctx.doc=history.redo(ctx.doc);assert.deepEqual(ctx.doc.layers,result);
 // Reopen a saved adjustment and change it without adding another layer.
 ctx.doc=JSON.parse(JSON.stringify(ctx.doc));ctx.selected=ctx.doc.layers[1].id;
 await ctx.beginRetouch(type,true);if(type==='brightness_contrast')ctx.retouchSession.settings.brightness=-20;
 ctx.previewRetouch();await ctx.applyRetouch();assert.equal(ctx.doc.layers.length,3);
 ctx.doc=history.undo(ctx.doc);assert.deepEqual(ctx.doc.layers,result);
});
test('first and subsequent paint strokes each undo once, preserving text and adjustment layers',async()=>{
 const {ctx,history}=fixture(),original=clone(ctx.doc.layers);
 ctx.beginPaint({x:1,y:1});ctx.movePaint({x:2,y:1});let stroke=ctx.gesture;ctx.gesture=null;await ctx.finishPaint(stroke);
 assert.equal(ctx.doc.layers.length,3);assert.equal(ctx.doc.layers[2].paint,true);const first=clone(ctx.doc.layers);
 ctx.doc=history.undo(ctx.doc);assert.deepEqual(ctx.doc.layers,original);ctx.doc=history.redo(ctx.doc);assert.deepEqual(ctx.doc.layers,first);
 ctx.selected=ctx.doc.layers[2].id;ctx.rasters.set(ctx.doc.layers[2].asset,stroke.canvas);
 ctx.beginPaint({x:1,y:2});ctx.movePaint({x:2,y:2});stroke=ctx.gesture;ctx.gesture=null;await ctx.finishPaint(stroke);assert.equal(ctx.doc.layers.length,3);
 const second=clone(ctx.doc.layers);ctx.doc=history.undo(ctx.doc);assert.deepEqual(ctx.doc.layers,first);ctx.doc=history.redo(ctx.doc);assert.deepEqual(ctx.doc.layers,second);
});
test('selection copy creates a masked layer without hiding or changing the source',async()=>{
 const {ctx,history,assets}=fixture(),original=clone(ctx.doc.layers);
 await ctx.copySelection();assert.equal(ctx.doc.layers.length,3);assert.equal(ctx.doc.layers[0].visible,true);
 const layer=ctx.doc.layers[1],pixels=assets.get(layer.asset).data;
 assert.equal(pixels[3],200);assert.equal(pixels[11],0);
 const copied=clone(ctx.doc.layers);ctx.doc=history.undo(ctx.doc);assert.deepEqual(ctx.doc.layers,original);ctx.doc=history.redo(ctx.doc);assert.deepEqual(ctx.doc.layers,copied);
});
