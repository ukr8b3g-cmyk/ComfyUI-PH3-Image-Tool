import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {makeLayer,History,candidateMatches,layerFromCandidate,addLetteringLayer,insertImageLayer,ensureLayerCapacity} from '../web/core.mjs';
import {addMangaLayers,MANGA_ROLES} from '../web/manga-core.mjs';
const studio=readFileSync(new URL('../web/studio.mjs',import.meta.url),'utf8');
const source=studio.slice(studio.indexOf('  async function adopt('),studio.indexOf('  const dismissedHistory='));
function fixture(mode){
 const image=makeLayer('image',128,96,{asset:'original',locked:true}),text=makeLayer('text',128,96,{text:'edited during generation',fontSize:62}),stamp=makeLayer('image',128,96,{asset:'stamp',decoration:true});
 const doc={width:128,height:96,canvas_revision:8,settings:{},layers:[image,stamp,text]},before=structuredClone(doc),history=new History();
 const job={id:'job',project_id:'project',request:{mode,canvas_revision:1,canvas:[128,96],prompt:'prompt',config:{seed:42},source_layer:structuredClone(text),parent_layer:structuredClone(stamp),lettering:{text:'ビクッ!!'}},results:[{asset:'new',x:0,y:0,w:128,h:96,width:128,height:96,settings:{},layers:MANGA_ROLES.map(role=>({role,asset:role}))}]};
 const ctx={doc,record:{id:'project'},candidateMatches,layerFromCandidate,addLetteringLayer,insertImageLayer,ensureLayerCapacity,addMangaLayers,selected:text.id,currentJobs:new Map(),mangaNames:()=>({}),tr:k=>k,renderAll:async()=>{},renderJobs(){},status(){},commit(fn){history.record(doc);fn(doc);doc.canvas_revision++;},confirm(){throw Error('Non-destructive adoption must not ask to overwrite');}};
 vm.createContext(ctx);vm.runInContext(source,ctx);return{ctx,before,history,job};
}
for(const mode of ['full','selection','lettering','manga'])test(mode+' adoption adds new layers without modifying the edited stack',async()=>{
 const {ctx,before,history,job}=fixture(mode);
 if(mode==='manga')job.request.source_layer=structuredClone(ctx.doc.layers[0]);
 assert.equal(await ctx.adopt(job,0,true),true);
 const originalIds=new Set(before.layers.map(l=>l.id));
 assert.deepEqual(ctx.doc.layers.filter(l=>originalIds.has(l.id)),before.layers);
 assert.equal(ctx.doc.layers.length,before.layers.length+(mode==='manga'?4:1));
 assert.deepEqual(history.undo(ctx.doc).layers,before.layers);
});
test('stale automatic adoption remains rejected without changing edits or undo history',async()=>{
 const {ctx,before,history,job}=fixture('full');assert.equal(await ctx.adopt(job,0,false),false);assert.deepEqual(ctx.doc,before);assert.equal(history.past.length,0);
});
test('manga dialog adoption checks project ownership without rejecting later canvas edits',async()=>{
 const start=studio.indexOf('  async function mangaModal('),end=studio.indexOf('  function syncPrompt(',start),snippet=studio.slice(start,end);let callbacks,adopted=0;
 const layer={id:'source',locked:false},ctx={selectedImage:()=>layer,record:{id:'project'},doc:{canvas_revision:1,layers:[layer]},clone:structuredClone,cache:{},client:{},modal(){},tr:k=>k,catalog:{},shared:{},openManga:async opts=>{callbacks=opts;},adopt:async()=>{adopted++;return true;}};
 vm.createContext(ctx);vm.runInContext(snippet,ctx);await ctx.mangaModal(true);ctx.doc.canvas_revision=99;ctx.doc.layers=[];
 await callbacks.onAdopt({},0);assert.equal(adopted,1);ctx.record.id='another-project';await assert.rejects(callbacks.onAdopt({},0),/processingConflict/);
});
