import test from 'node:test';
import assert from 'node:assert/strict';
import {ProgressTracker} from '../web/progress.mjs';
import {Client} from '../web/client.mjs';
const graph={'11':{class_type:'SamplerCustomAdvanced'},'12':{class_type:'VAEDecode'}};
test('progress is scoped to the exact prompt and submitted sampler node',()=>{
 const p=new ProgressTracker();p.bind('own',graph);p.ingest('progress',{prompt_id:'other',node:'11',value:9,max:10});assert.equal(p.get('own'),null);
 p.ingest('progress',{prompt_id:'own',node:'11',value:3,max:10});p.ingest('progress',{prompt_id:'own',node:'12',value:99,max:100});assert.deepEqual(p.get('own'),{node:'11',value:3,max:10,percent:30,postSampling:false});
});
test('real progress arriving before queue acknowledgement is retained',()=>{const p=new ProgressTracker();p.ingest('progress',{prompt_id:'own',node:'11',value:1,max:4});assert.equal(p.get('own'),null);p.bind('own',graph);assert.equal(p.get('own').percent,25);});
test('missing IDs and invalid step counts never create invented percentages',()=>{
 const p=new ProgressTracker();p.bind('own',graph);for(const fields of [{value:1,max:0},{value:-1,max:4},{value:5,max:4},{value:NaN,max:4},{value:1.2,max:4},{value:'2',max:4}])p.ingest('progress',{prompt_id:'own',node:'11',...fields});p.ingest('progress',{node:'11',value:1,max:4});assert.equal(p.get('own'),null);
});
test('combined progress state supports the sampler while excluding auxiliary nodes',()=>{const p=new ProgressTracker();p.bind('own',graph);p.ingest('progress_state',{prompt_id:'own',nodes:{'12':{value:5,max:5},'11':{value:2,max:7}}});assert.equal(p.get('own').value,2);assert.equal(p.get('own').percent,29);});
test('100 percent sampling is distinguished from later image processing',()=>{const p=new ProgressTracker();p.bind('own',graph);p.ingest('executing',{prompt_id:'own',node:'11'});p.ingest('progress',{prompt_id:'own',node:'11',value:4,max:4});assert.equal(p.get('own').postSampling,false);p.ingest('executing',{prompt_id:'own',node:'12'});assert.equal(p.get('own').postSampling,true);p.ingest('execution_start',{prompt_id:'own'});assert.equal(p.get('own'),null);});
test('unsubscribing and disposing remove progress listeners and cached values',()=>{const p=new ProgressTracker();p.bind('own',graph);let calls=0;const off=p.subscribe('own',()=>calls++);p.ingest('progress',{prompt_id:'own',node:'11',value:1,max:4});off();p.ingest('progress',{prompt_id:'own',node:'11',value:2,max:4});assert.equal(calls,2);p.clear();assert.equal(p.get('own'),null);assert.equal(p.listeners.size,0);});
const emit=(events,type,detail)=>events.dispatchEvent(Object.assign(new Event(type),{detail}));
test('ComfyUI client uses existing host events and never replaces the host socket',async()=>{
 const events=new EventTarget();let body;const client=new Client({clientId:'host',progressEvents:events,webSocketFactory:()=>{throw Error('Must not open another host socket');},fetcher:async(p,opts)=>{body=JSON.parse(opts.body);emit(events,'progress',{prompt_id:'own',node:'11',value:1,max:4});return{ok:true,json:async()=>({prompt_id:'own'})};}});
 await client.queue(graph);assert.equal(body.client_id,'host');assert.deepEqual(body.prompt,graph);assert.equal(client.progress.get('own').percent,25);client.dispose();emit(events,'progress',{prompt_id:'own',node:'11',value:3,max:4});assert.equal(client.progress.frames.size,0);
});
test('standalone client uses a unique socket ID matching its queued job and cleans up',async()=>{
 let socket,url,body,closed=false;class Socket extends EventTarget{close(){closed=true;this.dispatchEvent(new Event('close'));}}
 const client=new Client({webSocketFactory:address=>{url=new URL(address);socket=new Socket();queueMicrotask(()=>socket.dispatchEvent(new Event('open')));return socket;},fetcher:async(p,opts)=>{body=JSON.parse(opts.body);return{ok:true,json:async()=>({prompt_id:'own'})};}});
 await client.queue(graph);assert.equal(body.client_id,url.searchParams.get('clientId'));assert.ok(body.client_id);socket.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({type:'progress',data:{prompt_id:'own',node:'11',value:3,max:4}})}));assert.equal(client.progress.get('own').percent,75);client.dispose();assert.equal(closed,true);assert.equal(client.progressSocket,null);
});
test('a preexisting client ID without host events is never reused for a new socket',async()=>{let opened=false;const client=new Client({clientId:'existing',webSocketFactory:()=>opened=true,fetcher:async()=>({ok:true,json:async()=>({prompt_id:'own'})})});await client.queue(graph);assert.equal(opened,false);assert.equal(client.progress.get('own'),null);client.dispose();});
