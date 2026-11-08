import test from 'node:test';
import assert from 'node:assert/strict';
import {layerFromCandidate,addLetteringLayer,History} from '../web/core.mjs';
const doc={width:800,height:600};
const request={mode:'lettering',prompt:'English template',original_prompt:'Page prompt',source_asset:'ref',mask_asset:null,generation_size:[1280,768],region:[0,0,1280,768],source_layer:{id:'text-source',rotation:25},lettering:{text:'ビクッ!!',preset:'angular',use_reference:false},config:{seed:42}};
const job={id:'job',request,results:[{asset:'processed-alpha',raw_asset:'original-white',x:20,y:30,w:300,h:80}]};
test('AI lettering uses transparent processed asset and retains original/reference metadata',()=>{
 const copy=structuredClone(job),layer=layerFromCandidate(doc,job);
 assert.equal(layer.asset,'processed-alpha');assert.equal(layer.decoration,true);assert.equal(layer.rotation,25);assert.equal(layer.mask_asset,null);
 assert.equal(layer.generation.raw_asset,'original-white');assert.equal(layer.generation.source_asset,'ref');assert.equal(layer.generation.source_layer_id,'text-source');assert.equal(layer.generation.lettering.text,'ビクッ!!');assert.deepEqual(job,copy);
});
test('normal generation keeps its existing raw-asset behavior',()=>{
 const normal=structuredClone(job);normal.request.mode='full';normal.request.mask_asset='mask';
 const layer=layerFromCandidate(doc,normal);assert.equal(layer.asset,'original-white');assert.equal(layer.mask_asset,'mask');assert.equal(layer.rotation,0);
});

const {letteringDefaults,sameLetteringGeometry}=await import('../web/lettering-ui.mjs');
test('old style IDs map to independent design and decoration without changing explicit new values',()=>{
 assert.deepEqual([letteringDefaults({preset:'spiky'}).style,letteringDefaults({preset:'spiky'}).decoration],['angular','spiky']);
 assert.equal(letteringDefaults({preset:'round'}).style,'pop');assert.equal(letteringDefaults({preset:'spiky',style:'cute',decoration:'thought'}).style,'cute');
});
test('finish-only accepts color/strength changes but requires generation for text/layout/design/decoration',()=>{
 const a=letteringDefaults({text:'ビクッ!!',vertical:false});
 assert.ok(sameLetteringGeometry(a,{...a,color_mode:'gradient',tremble_strength:1}));
 for(const changes of [{text:'ドン!'}, {vertical:true},{style:'cute'},{decoration:'spiky'}])assert.equal(sameLetteringGeometry(a,{...a,...changes}),false);
});
test('layer provenance retains parent candidate and finish-only flag',()=>{
 const child=structuredClone(job);child.request.parent_job_id='parent';child.request.parent_result_index=2;child.request.finish_only=true;
 const layer=layerFromCandidate(doc,child);assert.equal(layer.generation.parent_job_id,'parent');assert.equal(layer.generation.parent_result_index,2);assert.equal(layer.generation.finish_only,true);
});

test('adopting a derived finish hides an unchanged adopted parent and one undo restores it',()=>{
 const parent=layerFromCandidate(doc,job);const state={...doc,canvas_revision:0,layers:[parent]};const child=structuredClone(job);child.id='child';child.request.parent_layer=structuredClone(parent);child.request.parent_job_id=job.id;
 const h=new History();h.record(state);const next=addLetteringLayer(state,child,0,'New finish');assert.equal(parent.visible,false);assert.equal(state.layers.length,2);assert.equal(next.generation.parent_job_id,job.id);
 const previous=h.undo(state);assert.equal(previous.layers.length,1);assert.equal(previous.layers[0].visible,true);
});
test('a moved or locked parent is preserved when a later result is adopted',()=>{
 for(const change of [{x:999},{locked:true}]){const parent=layerFromCandidate(doc,job),child=structuredClone(job);child.request.parent_layer=structuredClone(parent);Object.assign(parent,change);const state={...doc,layers:[parent]};addLetteringLayer(state,child,0,'Finish');assert.equal(parent.visible,true);}
});
