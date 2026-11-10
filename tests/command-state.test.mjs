import test from 'node:test';import assert from 'node:assert/strict';import {commandState} from '../web/command-state.mjs';
const image=(id='one',extra={})=>({id,type:'image',visible:true,locked:false,...extra});
const context=(layers=[],extra={})=>({doc:{layers,references:[],prompt:{original:''}},selected:layers[0]?.id,hasSelection:false,...extra});
test('empty documents do not offer meaningless layer, mask, cut, paste or merge commands',()=>{
 for(const key of ['maskLayer','clearLayerMask','remove','up','down','copyPixels','cutPixels','pastePixels','mergeVisible','comic','cutout'])assert.equal(commandState(key,context()).disabled,true,key);
 assert.equal(commandState('addText',context()).disabled,false);
});
test('mask creation needs a selection; mask removal needs an actual mask, not baked transparency',()=>{
 const pasted=image('pasted');let ctx=context([pasted]);assert.equal(commandState('maskLayer',ctx).reason,'needSelection');assert.equal(commandState('clearLayerMask',ctx).reason,'noLayerMask');
 ctx.hasSelection=true;assert.equal(commandState('maskLayer',ctx).disabled,false);pasted.mask_asset='mask';assert.equal(commandState('clearLayerMask',ctx).disabled,false);
 pasted.locked=true;assert.equal(commandState('maskLayer',ctx).reason,'lockedHint');assert.equal(commandState('clearLayerMask',ctx).reason,'lockedHint');
});
test('layer order, locks, capacity and visibility have specific eligibility reasons',()=>{
 const layers=[image('back'),image('front')],ctx=context(layers);assert.equal(commandState('down',ctx).reason,'alreadyBack');assert.equal(commandState('up',ctx).disabled,false);ctx.selected='front';assert.equal(commandState('up',ctx).reason,'alreadyFront');layers[1].locked=true;assert.equal(commandState('remove',ctx).reason,'lockedHint');assert.equal(commandState('mergeVisible',ctx).reason,'mergeLocked');
 const full=context(Array.from({length:256},(_,i)=>image(String(i))));assert.equal(commandState('duplicate',full).reason,'layerCapacity');assert.equal(commandState('addText',full).reason,'layerCapacity');
});
test('clipboard, references, generation scope, undo and redo update with context',()=>{
 let ctx=context([image()]);assert.equal(commandState('pastePixels',ctx).disabled,true);ctx.clipboard={kind:'pixels'};assert.equal(commandState('pastePixels',ctx).disabled,false);
 assert.equal(commandState('undo',ctx).disabled,true);ctx.history={past:[{}],future:[]};assert.equal(commandState('undo',ctx).disabled,false);assert.equal(commandState('redo',ctx).disabled,true);
 ctx.mode='selection';assert.equal(commandState('generate',ctx).reason,'needSelection');ctx.hasSelection=true;assert.equal(commandState('generate',ctx).disabled,false);ctx.modelsReady=false;assert.equal(commandState('generate',ctx).reason,'setupFirst');
 ctx.doc.references=Array(7).fill({});assert.equal(commandState('addReference',ctx).reason,'referenceCapacity');
});
test('decoration-only canvases are not offered as an excluded image source',()=>{
 const ctx=context([image('stamp',{decoration:true})],{mode:'full'});assert.equal(commandState('generate',ctx).reason,'needImage');ctx.doc.settings={include_text:true};assert.equal(commandState('generate',ctx).disabled,false);
});
