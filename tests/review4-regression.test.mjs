// Real editor handlers with controlled transport/DOM; not a live browser test.
import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';import {History,clone} from '../web/core.mjs';
const read=name=>readFileSync(process.env.PH3_REVIEW_SOURCE?process.env.PH3_REVIEW_SOURCE+'/'+name:new URL('../web/'+name,import.meta.url),'utf8');
const studio=read('studio.mjs'),processing=read('processing-ui.mjs');
const save=studio.slice(studio.indexOf('  async function saveRecord('),studio.indexOf('  async function save(){'));
const properties=studio.slice(studio.indexOf('    function layoutSlider('),studio.indexOf("    const transform=el('details'"));
function fixture(){
 const history=new History(),ctx={doc:{width:4,height:4,canvas_revision:0,layers:[{id:'selected',type:'image',opacity:1,fill:'#111111'}]},record:{id:'project',revision:0},history,clone,draftRecovery:null,detached:true,busy:false,renderToken:0,draftTimer:null,cache:{},selected:'selected',props:{querySelector:()=>null},sliders:{},colors:{},tr:k=>k,clearTimeout,JSON};
 ctx.client={upload:async()=>({asset:'composite'}),put:async(_path,payload)=>({id:'project',revision:1,document:clone(payload.document)})};
 Object.assign(ctx,{exportCanvas:async()=>({}),toBlob:async x=>x,localStorage:{removeItem(){}},updateToolbar(){},status(){},renderLayers(){},draw(){},stashDraft(){},renderAll(){},inputControl:value=>({value,closest:()=>null}),field:(_p,key,input)=>ctx.colors[key]=input,sliderField:(_p,key,value,finish,_min,_max,_step,preview)=>ctx.sliders[key]={value,finish,preview},commit(fn){history.record(ctx.doc);fn(ctx.doc);}});
 vm.createContext(ctx);vm.runInContext(`function renderProperties(){const l=doc.layers.find(x=>x.id===selected);const change=(key,value)=>commit(d=>d.layers.find(x=>x.id===l.id)[key]=value);${properties}\nlayoutSlider('opacity',l.opacity,0,1);colorProperty('fill');}\n`+save,ctx);ctx.renderProperties();return ctx;
}
for(const key of ['opacity','fill'])test('first '+key+' edit after Save/Apply updates the saved layer and has one Undo/Redo',async()=>{
 const ctx=fixture();await ctx.saveRecord();const before=clone(ctx.doc.layers);
 if(key==='opacity'){ctx.sliders.opacity.preview(.4);ctx.sliders.opacity.finish(.4);}else{ctx.colors.fill.value='#00ff00';ctx.colors.fill.oninput();ctx.colors.fill.onchange();}
 assert.equal(ctx.doc.layers[0][key],key==='opacity'?.4:'#00ff00');assert.equal(ctx.history.past.length,1);const after=clone(ctx.doc.layers);
 ctx.doc=ctx.history.undo(ctx.doc);assert.deepEqual(ctx.doc.layers,before);ctx.doc=ctx.history.redo(ctx.doc);assert.deepEqual(ctx.doc.layers,after);
});
const apply=processing.slice(processing.indexOf(' apply.onclick=async()=>'),processing.indexOf(" box.box.addEventListener('ph3-close'"));
for(const action of ['close','new-preview','close-and-reject'])test('processed result is not adopted after '+action+' while original source upload is pending',async()=>{
 let resolve,reject,reached;const waiting=new Promise(r=>reached=r),pending=new Promise((r,j)=>{resolve=r;reject=j;});let adopted=0,finished=0,reports=0;
 const ctx={closed:false,latest:1,sequence:1,applying:false,timer:null,controller:null,AbortController,clearTimeout,apply:{},refresh:{},controls:{querySelectorAll:()=>[]},resultLabel:{},tr:k=>k,calculate:async()=>({}),toBlob:async x=>x,client:{upload:async()=>({asset:'result'})},action:'comic',parameters:{},preset:'comic',transparentResult:null,originalUpload:()=>{reached();return pending;},onApply:async()=>adopted++,finish:()=>finished++,report:()=>reports++};
 vm.createContext(ctx);vm.runInContext(apply,ctx);const task=ctx.apply.onclick();await waiting;if(action==='new-preview')ctx.sequence++;else ctx.closed=true;
 if(action==='close-and-reject')reject(Error('upload failed'));else resolve({asset:'source'});await task;assert.equal(adopted,0);assert.equal(finished,0);assert.equal(reports,0);
});
