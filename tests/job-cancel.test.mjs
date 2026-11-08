import test from 'node:test';
import assert from 'node:assert/strict';
import {cancelGeneration,confirmStopped} from '../web/job-cancel.mjs';
import {Client} from '../web/client.mjs';
test('terminal job error text is job data, not an HTTP failure',async()=>{
 const client=new Client({fetcher:async()=>({ok:true,status:200,json:async()=>({status:'failed',error:'Cancelled'})})});
 assert.equal((await client.get('/jobs/j')).error,'Cancelled');
});
test('cancellation targets the prompt, not a global interrupt',async()=>{
 const calls=[];const client=new Client({fetcher:async(path,opts)=>{calls.push([path,opts]);return{ok:true,json:async()=>({cancelled:true})};}});
 await client.cancelJob('target');assert.equal(calls[0][0],'/api/jobs/target/cancel');assert.equal(calls[0][1].method,'POST');
});
test('running cancellation waits for confirmed queue removal and ignores unrelated work',async()=>{
 const calls=[];let running=true;const client={post:async(p,b)=>{calls.push(b);return b;},cancelJob:async id=>{assert.equal(id,'prompt');},queueState:async()=>({queue_running:running?[[0,'prompt'],[1,'other']]:[[1,'other']],queue_pending:[]})};
 const job={id:'job',prompt_id:'prompt'};assert.equal(await cancelGeneration(client,job),null);assert.equal(calls[0].suppress_auto,true);assert.equal(calls.some(c=>c.status==='failed'),false);
 running=false;assert.equal((await confirmStopped(client,job)).error,'Cancelled');
});
test('unavailable targeted API remains retryable and never reports stopped',async()=>{
 const writes=[];const client={post:async(p,b)=>{writes.push(b);},cancelJob:async()=>{throw Error('404');}};
 await assert.rejects(cancelGeneration(client,{id:'j',prompt_id:'p'}),/404/);assert.deepEqual(writes.at(-1),{cancel_requested:false});assert.equal(writes.some(c=>c.status==='failed'),false);
});
test('already absent queued job becomes terminal',async()=>{
 const client={post:async(p,b)=>b,cancelJob:async()=>({cancelled:false}),queueState:async()=>({queue_pending:[],queue_running:[]})};
 assert.equal((await cancelGeneration(client,{id:'j',prompt_id:'p'})).status,'failed');
});
