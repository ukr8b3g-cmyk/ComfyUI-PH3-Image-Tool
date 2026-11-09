import test from 'node:test';
import assert from 'node:assert/strict';
import {JobPresence,EXTERNAL_QUEUE_REMOVED} from '../web/job-presence.mjs';
import {generationReview,waitForJob} from '../web/job-review.mjs';
const job={id:'own',prompt_id:'prompt',status:'queued',results:[]};
function fixture(){
 let now=0,state={...job},queue={queue_running:[],queue_pending:[]},history={},reads=0;
 const writes=[],monitor=new JobPresence({now:()=>now}),client={jobPresence:monitor,get:async()=>state,queueState:async()=>{reads++;return queue;},history:async()=>history,post:async(path,patch)=>{writes.push({path,patch});state={...state,...patch};return state;},cancelJob(){throw Error('Must not interrupt any prompt');}};
 return{client,monitor,writes,get reads(){return reads;},time:n=>now=n,state:v=>state=v,queue:v=>queue=v,history:v=>history=v};
}
test('absent queue/history requires grace and repeated spaced observations',async()=>{
 const f=fixture();for(const time of [0,800,1600,14999]){f.time(time);assert.equal((await f.monitor.check(f.client,job)).status,'queued');}
 f.time(15800);const result=await f.monitor.check(f.client,job);assert.equal(result.status,'failed');assert.equal(result.error,EXTERNAL_QUEUE_REMOVED);assert.equal(f.writes.length,1);assert.equal(f.writes[0].path,'/jobs/own/state');assert.equal(result.suppress_auto,true);
});
test('own queue entry, execution history or stored result prevents external-removal classification',async()=>{
 for(const mode of ['queue','history','results']){
  const f=fixture();await f.monitor.check(f.client,job);f.time(30000);
  if(mode==='queue')f.queue({queue_running:[['q','prompt']],queue_pending:[]});
  if(mode==='history')f.history({prompt:{status:{status_str:'success'}}});
  if(mode==='results')f.state({...job,status:'succeeded',results:[{asset:'result'}]});
  for(let i=0;i<4;i++){f.time(30000+i*1000);await f.monitor.check(f.client,job);}assert.equal(f.writes.length,0,mode);
 }
});
test('result arriving in final persisted check wins over missing queue/history',async()=>{
 const f=fixture();f.time(0);await f.monitor.check(f.client,job);f.time(1000);await f.monitor.check(f.client,job);f.state({...job,status:'succeeded',results:[{asset:'late'}]});f.time(16000);
 assert.equal((await f.monitor.check(f.client,job)).results[0].asset,'late');assert.equal(f.writes.length,0);
});
test('queue reappearance in the final confirmation prevents a terminal update',async()=>{
 const f=fixture();await f.monitor.check(f.client,job);f.time(1000);await f.monitor.check(f.client,job);let checks=0;
 f.client.queueState=async()=>++checks===1?{queue_running:[],queue_pending:[]}:{queue_running:[['own','prompt']],queue_pending:[]};f.time(16000);
 assert.equal((await f.monitor.check(f.client,job)).status,'queued');assert.equal(f.writes.length,0);
});
test('server-side completion racing the state update remains a successful candidate',async()=>{
 const f=fixture();await f.monitor.check(f.client,job);f.time(1000);await f.monitor.check(f.client,job);f.time(16000);
 f.client.post=async(_path,patch)=>{assert.equal(patch.only_if_unfinished,true);assert.equal(patch.expected_prompt_id,'prompt');return{...job,status:'succeeded',results:[{asset:'raced'}]};};
 assert.equal((await f.monitor.check(f.client,job)).results[0].asset,'raced');
});
test('simultaneous UI watchers share one presence observation',async()=>{
 const f=fixture();await Promise.all([f.monitor.check(f.client,job),f.monitor.check(f.client,job),f.monitor.check(f.client,job)]);assert.equal(f.reads,1);
});
test('transport failure resets missing observations instead of becoming removal evidence',async()=>{
 const f=fixture();await f.monitor.check(f.client,job);const original=f.client.queueState;f.client.queueState=async()=>{throw Error('offline');};f.time(20000);await assert.rejects(f.monitor.check(f.client,job),/offline/);f.client.queueState=original;
 for(const time of [21000,22000,23000]){f.time(time);assert.equal((await f.monitor.check(f.client,job)).status,'queued');}assert.equal(f.writes.length,0);
});
for(const watch of [generationReview,waitForJob])test(watch.name+' exits after confirmed external removal without cancelling other jobs',async()=>{
 const f=fixture();f.client.jobPresence=new JobPresence({graceMs:0,minInterval:0,minObservations:3});
 const task=watch(f.client,job,{interval:0});await assert.rejects(typeof task.wait==='function'?task.wait():task,/removed externally/);assert.equal(f.writes.length,1);
});
