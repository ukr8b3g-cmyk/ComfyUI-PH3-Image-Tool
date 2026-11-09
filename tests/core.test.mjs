import test from 'node:test';import assert from 'node:assert/strict';
import {History,checkSize,checkNewSize,makeLayer,localPoint,worldPoint,candidateMatches,reorder,safeSeed,randomSeed,layerFromCandidate} from '../web/core.mjs';
import {combineMasks,rectangleMask,ellipseMask,polygonMask,pointInPolygon,strokeMask,invertMask,maskBounds} from '../web/selection.mjs';
const doc=()=>({width:128,height:96,canvas_revision:1,layers:[],settings:{},selection_asset:null});
test('bounded history and non-revivable canvas revisions',()=>{const h=new History(2);let d=doc();for(let i=0;i<4;i++){h.record(d);d={...d,canvas_revision:d.canvas_revision+1};}assert.equal(h.past.length,2);const u=h.undo(d);assert.equal(u.canvas_revision,6);const r=h.redo(u);assert.equal(r.canvas_revision,7);});
test('new edit after undo discards redo branch',()=>{const h=new History();const d=doc();h.record(d);h.undo({...d,canvas_revision:2});h.record(d);assert.equal(h.future.length,0);});
test('history byte budget prevents unlimited metadata copies',()=>{const h=new History(100,300);for(let i=0;i<20;i++)h.record({...doc(),title:'a'.repeat(100)});assert.equal(h.past.length,0);});
test('rotated coordinate roundtrip',()=>{const l=makeLayer('image',100,100,{x:20,y:30,w:80,h:40,rotation:47});const p={x:13,y:22};const r=localPoint(l,worldPoint(l,p));assert.ok(Math.abs(r.x-p.x)<1e-8);assert.ok(Math.abs(r.y-p.y)<1e-8);});
test('stale generation refused after undo revision advances',()=>{const d=doc(),job={project_id:'x',request:{canvas_revision:1,canvas:[128,96]}};assert.equal(candidateMatches(d,job,'x'),true);assert.equal(candidateMatches({...d,canvas_revision:2},job,'x'),false);assert.equal(candidateMatches(d,job,'other'),false);});
test('candidate layer keeps raw image and separate selection mask',()=>{const job={id:'job',request:{mode:'selection',mask_asset:'m',prompt:'apple',config:{seed:42},region:[1,2,3,4]},results:[{asset:'patch',raw_asset:'raw',x:1,y:2,w:3,h:4}]};const layer=layerFromCandidate(doc(),job);assert.equal(layer.asset,'raw');assert.equal(layer.mask_asset,'m');assert.equal(layer.x,1);});
test('seed rejects silent integer precision loss',()=>{assert.equal(safeSeed('691899913323484'),'691899913323484');assert.throws(()=>safeSeed('18446744073709551615'));assert.throws(()=>safeSeed('-1'));assert.ok(Number.isSafeInteger(Number(randomSeed())));});
test('canvas size limits',()=>{checkSize(2912,2912);assert.throws(()=>checkSize(8192,8192));assert.throws(()=>checkSize(0,1));});
test('new and resized canvases stop at 2048 without invalidating legacy dimensions',()=>{checkNewSize(2048,2048);assert.throws(()=>checkNewSize(2049,1),/2048/);assert.throws(()=>checkNewSize(1,2049),/2048/);checkSize(2049,1);});
test('settings confirmation accepts the same 1 to 100 quality range as export',async()=>{
 const {readFile}=await import('node:fs/promises'),source=await readFile(new URL('../web/studio.mjs',import.meta.url),'utf8');
 const guard=source.match(/for\(const \[key,min,max\]of \[\['context'[\s\S]*?throw Error\(`Invalid \$\{key\}`\);/)[0];
 const confirm=new Function('draft',guard),draft={context:0,feather:0,brush:40,max_megapixels:1};
 for(const quality of [1,5,9,10,80,100])assert.doesNotThrow(()=>confirm({...draft,export_quality:quality/100}));
 for(const quality of [0,101,NaN])assert.throws(()=>confirm({...draft,export_quality:quality/100}),/export_quality/);
});
test('layer reorder respects boundaries',()=>{const layers=[{id:'a'},{id:'b'}];assert.equal(reorder(layers,'a',-1),false);assert.equal(reorder(layers,'a',1),true);assert.equal(layers[1].id,'a');});
test('rectangular selection clips to canvas',()=>{const m=rectangleMask(10,10,-5,-5,3,4);assert.deepEqual(maskBounds(m,10,10),[0,0,3,4]);assert.equal(m.reduce((n,v)=>n+(v>0),0),12);});
test('ellipse stays inside box',()=>{const m=ellipseMask(20,20,3,4,15,16),bounds=maskBounds(m,20,20);assert.deepEqual(bounds,[3,4,12,12]);assert.equal(m[0],0);});
test('polygon point test',()=>{assert.equal(pointInPolygon(3,3,[{x:0,y:0},{x:10,y:0},{x:0,y:10}]),true);assert.equal(pointInPolygon(9,9,[{x:0,y:0},{x:10,y:0},{x:0,y:10}]),false);});
test('lasso selection bounded',()=>{const m=polygonMask(16,16,[{x:2,y:2},{x:8,y:2},{x:8,y:8},{x:2,y:8}]);assert.deepEqual(maskBounds(m,16,16),[2,2,6,6]);});
test('selection combine operations',()=>{const a=Uint8ClampedArray.from([0,100,255]),b=Uint8ClampedArray.from([80,80,0]);assert.deepEqual([...combineMasks(a,b,'add')],[80,100,255]);assert.deepEqual([...combineMasks(a,b,'subtract')],[0,20,255]);assert.deepEqual([...combineMasks(a,b,'intersect')],[0,80,0]);assert.throws(()=>combineMasks(a,new Uint8ClampedArray(1)));});
test('invert twice restores mask',()=>{const m=Uint8ClampedArray.from([0,123,255]);assert.deepEqual(invertMask(invertMask(m)),m);});
test('brush leaves outside untouched',()=>{const m=new Uint8ClampedArray(400);strokeMask(m,20,20,{x:5,y:5},{x:10,y:10},2);assert.equal(m[0],0);assert.equal(m[6*20+6],255);assert.equal(m[19*20+19],0);});

test('generated image is inserted below editable text and decorations',async()=>{const {insertImageLayer}=await import('../web/core.mjs');const d={layers:[{id:'base',type:'image'},{id:'title',type:'text'},{id:'frame',type:'frame'}]};insertImageLayer(d,{id:'generated',type:'image'});assert.deepEqual(d.layers.map(l=>l.id),['base','generated','title','frame']);});

test('prompt edits permanently invalidate a pending result, including edit-back',async()=>{const {setPromptValue}=await import('../web/core.mjs');const d={...doc(),prompt:{original:'apple',ai:'',source:'original'}},job={project_id:'x',request:{canvas_revision:1,canvas:[128,96]}};setPromptValue(d,'original','pear');setPromptValue(d,'original','apple');assert.equal(d.canvas_revision,3);assert.equal(candidateMatches(d,job,'x'),false);assert.equal(setPromptValue(d,'original','apple'),false);});


test('first use selects unambiguous installed P-H3 model variants only',async()=>{
  const {suggestInstalledPH3Models,ph3ModelReadiness}=await import('../web/core.mjs');
  const catalog={diffusion_models:['minimax/minimax_h3_fl2va_pruned_int8_convrot.safetensors','other.safetensors'],
    text_encoders:['p-h3-image_text_encoder_int8_convrot.safetensors','p-h3-image_prompt_upsampler_w4a8.safetensors'],
    vae:['p-h3-image_vae_int8_convrot.safetensors'],loras:['P-H3-Image\\p-h3-image_lora_bf16.safetensors'],missing_nodes:[]};
  const result=suggestInstalledPH3Models({},catalog);
  assert.equal(result.selected.length,5);
  assert.deepEqual(ph3ModelReadiness(result.settings,catalog),{missing:[],ready:true});
  assert.equal(suggestInstalledPH3Models({unet_name:'user-choice'},catalog).settings.unet_name,'user-choice');
});
test('ambiguous duplicate model names are never silently chosen',async()=>{
  const {suggestInstalledPH3Models,ph3ModelReadiness}=await import('../web/core.mjs');
  const catalog={diffusion_models:['a/minimax_h3_fl2va_pruned_int8_convrot.safetensors','b/minimax_h3_fl2va_pruned_int8_convrot.safetensors'],text_encoders:[],vae:[],loras:[]};
  const result=suggestInstalledPH3Models({},catalog);
  assert.equal(result.settings.unet_name,undefined);
  assert.equal(ph3ModelReadiness(result.settings,catalog).ready,false);
});
