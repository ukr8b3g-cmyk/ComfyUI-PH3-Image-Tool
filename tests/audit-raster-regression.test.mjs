// Real editor handlers + real RasterCache/modifier code; Canvas/transport are
// controlled pixel fixtures. No browser, GPU, or large-canvas allocation.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {History,clone,makeLayer,uid,ensureLayerCapacity} from '../web/core.mjs';
import {RasterCache,imageRasterKey,previewRasterKey,layerRaster,modifiedRaster} from '../web/render.mjs';
import {adjustedPixels,strokeCoverage,paintedPixels} from '../web/selection-edit.mjs';
import {editableRetouch,bakeRetouch} from '../web/edit-provenance.mjs';
import {canvas,solid,maskCanvas,readMask,maskBounds} from './helpers/raster-fixture.mjs';
const studio=readFileSync(new URL('../web/studio.mjs',import.meta.url),'utf8');
const handlers=studio.slice(studio.indexOf('  async function beginRetouch('),studio.indexOf('  function renderLayers(){'));
const processing=studio.slice(studio.indexOf('  async function processModal('),studio.indexOf('  function comicMenu('));
globalThis.document={createElement:tag=>{assert.equal(tag,'canvas');return mutableCanvas();}};
function mutableCanvas(){let w=0,h=0,c=canvas(0,0);return{get width(){return w;},set width(v){w=v;c=canvas(w,h);},get height(){return h;},set height(v){h=v;c=canvas(w,h);},get data(){return c.data;},getContext(){return c.getContext('2d');}};}
const layer=(id,asset,extra={})=>makeLayer('image',4,4,{id,asset,name:id,x:0,y:0,w:4,h:4,...extra});
function fixture(layers,sourceAssets){
 const assets=new Map(sourceAssets),history=new History();let uploads=0;
 const ctx={doc:{width:4,height:4,canvas_revision:1,settings:{paint_size:1,paint_hardness:100,paint_opacity:100,paint_color:'#ff0000'},layers},history,selected:layers[0].id,record:{id:'project'},retouchSession:null,paintPreview:null,gesture:null,
  selection:new Uint8ClampedArray(16),rasters:new Map(),canvas,clone,makeLayer,uid,ensureLayerCapacity,adjustedPixels,strokeCoverage,paintedPixels,maskBounds,maskCanvas,readMask,editableRetouch,bakeRetouch,imageRasterKey,previewRasterKey,modifiedRaster,
  selectedImage:()=>ctx.doc.layers.find(l=>l.id===ctx.selected),layerSelectionMask:(_l,mask,_dw,_dh,w,h)=>maskCanvas(mask,w,h),toBlob:async c=>c,
  client:{upload:async c=>{const asset='asset-'+(++uploads),copy=canvas(c.width,c.height);copy.data.set(c.data);assets.set(asset,copy);return{asset};}},
  withBusy:async fn=>fn(),tr:k=>k,draw(){},showTab(){},renderProperties(){},stashDraft(){},status(){},fail:e=>{throw e;},modal(){},catalog:{},
  commit(fn){history.record(ctx.doc);fn(ctx.doc);ctx.doc.canvas_revision++;ctx.retouchSession=null;},openProcessing:async opts=>ctx.processingOptions=opts,
  renderAll:async()=>{ctx.rasters=await ctx.cache.prepare(ctx.doc);}};
 ctx.cache=new RasterCache(x=>x);ctx.cache.get=async key=>assets.get(key);vm.createContext(ctx);vm.runInContext(handlers+processing,ctx);return{ctx,assets,history};
}
const pixel=(ctx,l,index=15)=>[...layerRaster(ctx.rasters,l).data.slice(index*4,index*4+4)];
async function stroke(ctx){ctx.beginPaint({x:.5,y:.5});const g=ctx.gesture;ctx.gesture=null;const preview=pixel(ctx,ctx.doc.layers.find(l=>l.id===ctx.selected),0);await ctx.finishPaint(g);await ctx.renderAll();return preview;}

for(const tint of [false,true])test('successive paint strokes keep a soft mask and '+(tint?'tint':'raw colors')+' exactly once',async()=>{
 const l=layer('paint','source',{paint:true,mask_asset:'half',colorize:tint,tintColor:'#00ff00'});
 const {ctx,history,assets}=fixture([l],[['source',solid([90,90,90,255])],['half',solid([128,128,128,255])]]);await ctx.renderAll();const original=clone(ctx.doc.layers),before=pixel(ctx,l);
 for(let i=0;i<3;i++){const preview=await stroke(ctx);assert.deepEqual(pixel(ctx,l),before);assert.equal(pixel(ctx,l)[3],128);assert.deepEqual(pixel(ctx,l,0),preview);assert.equal(l.mask_asset,'half');assert.equal(l.colorize,tint);}
 const final=clone(ctx.doc.layers);ctx.doc=history.undo(ctx.doc);await ctx.renderAll();assert.equal(pixel(ctx,ctx.doc.layers[0])[3],128);ctx.doc=history.redo(ctx.doc);assert.deepEqual(ctx.doc.layers,final);
 assert.equal(assets.get('source').data[3],255);assert.equal(original[0].mask_asset,'half');
});
test('background removal bakes old adjustment metadata and cannot resurrect transparency',async()=>{
 const {ctx,assets,history}=fixture([layer('base','source')],[['source',solid([90,90,90,255])],['cut',solid([0,0,0,0])]]);await ctx.renderAll();
 await ctx.beginRetouch('brightness_contrast');ctx.retouchSession.settings.brightness=30;ctx.previewRetouch();await ctx.applyRetouch();await ctx.renderAll();const adjusted=clone(ctx.doc.layers);
 await ctx.processModal('remove_background');await ctx.processingOptions.onApply({asset:'cut'},{action:'remove_background',source_asset:ctx.doc.layers[1].asset,settings:{},transparent:true});
 const result=ctx.doc.layers.find(l=>l.id===ctx.selected);assert.equal(editableRetouch(result),null);assert.equal(result.retouch,undefined);assert.equal(result.retouch_history.length,1);
 await ctx.beginRetouch('brightness_contrast',true);assert.equal(ctx.retouchSession.editing,false);assert.equal(ctx.retouchSession.preview.data[3],0);await ctx.applyRetouch();
 assert.equal(assets.get(ctx.doc.layers.find(l=>l.id===ctx.selected).asset).data[3],0);
 ctx.doc=history.undo(ctx.doc);ctx.doc=history.undo(ctx.doc);assert.deepEqual(ctx.doc.layers,adjusted);
});
test('painting an adjusted layer invalidates the old editable source while Undo restores it',async()=>{
 const {ctx,history,assets}=fixture([layer('base','source',{paint:true})],[['source',solid([90,90,90,255])]]);await ctx.renderAll();
 ctx.doc.settings.paint_color='#00ff00';await ctx.beginRetouch('fill');await ctx.applyRetouch();await ctx.renderAll();const adjusted=clone(ctx.doc.layers);ctx.doc.settings.paint_color='#ff0000';
 await stroke(ctx);const painted=ctx.doc.layers.find(l=>l.id===ctx.selected);assert.equal(painted.retouch,undefined);assert.equal(painted.retouch_history.length,1);assert.deepEqual([...assets.get(painted.asset).data.slice(0,4)],[255,0,0,255]);
 await ctx.beginRetouch('brightness_contrast',true);assert.equal(ctx.retouchSession.editing,false);assert.deepEqual([...ctx.retouchSession.preview.data.slice(0,4)],[255,0,0,255]);
 ctx.retouchSession=null;ctx.doc=history.undo(ctx.doc);assert.deepEqual(ctx.doc.layers,adjusted);assert.ok(editableRetouch(ctx.doc.layers[1]));
});
test('duplicated images share only immutable rasters, never retouch or paint previews',async()=>{
 const a=layer('selected','source',{paint:true}),b=layer('duplicate','source',{paint:true,x:1});const {ctx}=fixture([a,b],[['source',solid([90,90,90,255])]]);await ctx.renderAll();const original=pixel(ctx,b,0);
 await ctx.beginRetouch('fill');assert.deepEqual(pixel(ctx,b,0),original);assert.deepEqual(pixel(ctx,a,0),[255,0,0,255]);assert.deepEqual([...ctx.rasters.get(imageRasterKey(b)).data.slice(0,4)],original);
 ctx.cancelRetouch();await ctx.renderAll();ctx.selected=a.id;ctx.beginPaint({x:.5,y:.5});assert.deepEqual(pixel(ctx,b,0),original);assert.deepEqual(pixel(ctx,a,0),[255,0,0,255]);
});
test('unverifiable v0.9.0 processed adjustments are retained but not offered as live settings',()=>{
 const legacy=layer('old','current',{processing:{action:'remove_background'},retouch:{type:'fill',source_asset:'old'}});assert.equal(editableRetouch(legacy),null);bakeRetouch(legacy);assert.equal(legacy.retouch_history[0].source_asset,'old');
 const plain=layer('plain','current',{retouch:{type:'curves',source_asset:'old'}});assert.ok(editableRetouch(plain));
});
test('Undo can load an evicted raster from its original asset URL',async t=>{
 const previous=globalThis.Image,loads=[];
 t.after(()=>{globalThis.Image=previous;});
 globalThis.Image=class {
  naturalWidth=2;
  naturalHeight=2;
  set src(key){loads.push(key);this.key=key;queueMicrotask(()=>this.onload());}
 };
 const cache=new RasterCache(key=>key),history=new History(40);
 let doc={canvas_revision:0,layers:[layer('one','0')]};
 await cache.prepare(doc);
 for(let i=1;i<=36;i++){
  history.record(doc);doc.layers[0].asset=String(i);
  await cache.prepare(doc);
 }
 assert.equal(cache.images.size,32);
 assert.equal(cache.images.has('4'),false);
 const count=loads.length;
 for(let i=0;i<32;i++)doc=history.undo(doc);
 const restored=await cache.prepare(doc);
 assert.equal(restored.get('4').key,'4');
 assert.deepEqual(loads.slice(count),['4']);
});
test('the byte budget evicts older images and pending loads cannot refill a disposed cache',async t=>{
 const previous=globalThis.Image,loads=[];
 t.after(()=>{globalThis.Image=previous;});
 globalThis.Image=class {
  naturalWidth=4096;
  naturalHeight=2048;
  set src(key){loads.push({key,image:this});}
 };
 const cache=new RasterCache(key=>key);
 for(const key of ['one','two']){
  const job=cache.get(key);loads.at(-1).image.onload();await job;
 }
 await cache.get('one');
 const third=cache.get('three');loads.at(-1).image.onload();await third;
 assert.deepEqual([...cache.images.keys()],['one','three']);
 assert.equal(cache.imageBytes,64*1024*1024);
 const stale=cache.get('reload'),same=cache.get('reload'),old=loads.at(-1).image;
 assert.equal(loads.filter(entry=>entry.key==='reload').length,1);
 cache.dispose();
 const current=cache.get('reload'),fresh=loads.at(-1).image;
 old.onload();
 assert.equal(await stale,old);
 assert.equal(await same,old);
 assert.equal(cache.images.size,0);
 fresh.onload();
 assert.equal(await current,fresh);
 assert.equal(await cache.get('reload'),fresh);
});
