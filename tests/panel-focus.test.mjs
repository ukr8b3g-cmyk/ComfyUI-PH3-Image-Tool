import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const studio=readFileSync(new URL('../web/studio.mjs',import.meta.url),'utf8');
test('queueing image, AI text, manga or lettering does not switch the current tab',async()=>{
 const source=studio.slice(studio.indexOf('  async function generate('),studio.indexOf('  const stoppingJobs='));
 for(const mode of ['new','enhance','manga','lettering'])for(const tab of ['generate','properties','layers','candidates']){
  const ctx={doc:{settings:{random_seed:false},layers:[]},modeSelect:{value:mode},record:{id:'project',revision:3},currentJobs:new Map(),jobs:[],activeTab:tab,withBusy:async fn=>fn(),saveRecord:async()=>{},client:{post:async path=>path.endsWith('/prepare')?{job:{id:'j'},prompt:{test:true}}:{},queue:async()=>({prompt_id:'p'})},isDecorationLayer:()=>false,renderJobs:()=>{},status:()=>{},tr:s=>s,startPolling:()=>{}};
  ctx.showTab=name=>ctx.activeTab=name;vm.createContext(ctx);vm.runInContext(source,ctx);await ctx.generate(mode,{source_asset:'asset'});
  assert.equal(ctx.activeTab,tab,mode+' from '+tab);assert.equal(ctx.jobs.length,1);assert.equal(ctx.currentJobs.get('j').prompt_id,'p');
 }
});
test('docked History and Layers are separate tab views',()=>{
 const source=studio.slice(studio.indexOf('  function showTab('),studio.indexOf('  function setTool('));
 const panels=Object.fromEntries(['generate','properties','layers','candidates'].map(k=>[k,{hidden:false}]));
 const ctx={panels,floating:new Map(),right:{dataset:{}},tabs:{children:[]},activeTab:'generate'};vm.createContext(ctx);vm.runInContext(source,ctx);
 for(const tab of Object.keys(panels)){ctx.showTab(tab);for(const [key,panel]of Object.entries(panels))assert.equal(panel.hidden,key!==tab,tab+' / '+key);}
});
test('opening floating History is explicit and hides the previous docked view',()=>{
 const source=studio.slice(studio.indexOf('  function showTab('),studio.indexOf('  function setTool('));
 const frame={hidden:true},panels={generate:{},properties:{},layers:{},candidates:{}};let saved=0;
 const ctx={panels,floating:new Map([['candidates',{frame,constrain(){},save(){saved++;}}]]),right:{dataset:{}},tabs:{children:[]},activeTab:'layers'};vm.createContext(ctx);vm.runInContext(source,ctx);ctx.showTab('candidates');assert.equal(frame.hidden,false);assert.equal(panels.layers.hidden,true);assert.equal(ctx.activeTab,'candidates');assert.equal(saved,1);
});
