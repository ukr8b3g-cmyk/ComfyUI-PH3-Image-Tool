import test from 'node:test';
import assert from 'node:assert/strict';
import {waitForJob,visibleJobs,generationReview} from '../web/job-review.mjs';
test('queued review returns its own complete result without adopting or queueing',async()=>{
 const states=[{status:'queued',prompt_id:'p'},{status:'succeeded',results:[{asset:'a'}]}],calls=[];
 const client={get:async p=>{calls.push(p);return states.shift();},history:async()=>({})};
 const job=await waitForJob(client,{id:'own'},{interval:0});assert.equal(job.results[0].asset,'a');assert.deepEqual(calls,['/jobs/own','/jobs/own']);
});
test('closing review aborts watching without cancellation or applying a job',async()=>{const c=new AbortController();c.abort();let reads=0;await assert.rejects(waitForJob({get:async()=>reads++},{id:'own'},{signal:c.signal}));assert.equal(reads,0);});
test('abort during wait cancels timer and does not poll again',async()=>{const c=new AbortController();let reads=0;const task=waitForJob({get:async()=>{reads++;return{status:'queued'};}},{id:'own'},{signal:c.signal,interval:10000,onUpdate:()=>setTimeout(()=>c.abort(),0)});await assert.rejects(task);assert.equal(reads,1);});
test('terminal and Comfy history errors are surfaced, not silently applied',async()=>{
 await assert.rejects(waitForJob({get:async()=>({status:'failed',error:'model missing'})},{id:'own'}),/model missing/);
 await assert.rejects(waitForJob({get:async()=>({status:'queued',prompt_id:'p'}),history:async()=>({p:{status:{status_str:'error',messages:[['execution_error',{exception_message:'device error'}]]}}})},{id:'own'}),/device error/);
 await assert.rejects(waitForJob({get:async()=>({status:'succeeded',results:[]})},{id:'own'}),/no images/);
});
test('dismissing a candidate hides only its card and preserves job results',()=>{const jobs=[{id:'a',status:'succeeded',results:[{asset:'x'}]},{id:'b',status:'queued'},{id:'c',status:'failed',error:'Cancelled'}];const before=JSON.stringify(jobs);assert.deepEqual(visibleJobs(jobs,new Set(['a'])).map(j=>j.id),['b']);assert.equal(JSON.stringify(jobs),before);assert.equal(visibleJobs(jobs,new Set()).length,2);});
test('inline progress reports the target queued, running and result-processing phases',async()=>{
 let reads=0;const phases=[];const client={get:async()=>++reads===4?{status:'succeeded',results:[{asset:'x'}]}:{status:'queued'},queueState:async()=>({queue_running:reads===2?[[0,'p']]:[[1,'other']],queue_pending:reads===1?[[0,'p']]:[]}),history:async()=>({})};
 assert.equal((await generationReview(client,{id:'j',prompt_id:'p'},{interval:0,onUpdate:s=>phases.push(s.phase)}).wait()).results[0].asset,'x');assert.deepEqual(phases,['queued','generating','processingResult']);
});
test('inline stop targets only its prompt and waits for its removal',async()=>{
 let running=true,stopCalls=0;const writes=[],phases=[];let task;
 const client={get:async()=>({status:'queued'}),post:async(path,body)=>{assert.equal(path,'/jobs/j/state');writes.push(body);return body;},cancelJob:async id=>{assert.equal(id,'p');stopCalls++;running=false;},queueState:async()=>({queue_running:running?[[0,'p'],[1,'other']]:[[1,'other']],queue_pending:[]}),history:async()=>({})};
 task=generationReview(client,{id:'j',prompt_id:'p'},{interval:0,onUpdate:s=>{phases.push(s.phase);if(s.phase==='generating')task.stop();}});
 assert.equal(await task.wait(),null);assert.equal(stopCalls,1);assert.equal(phases.at(-1),'stopped');assert.equal(writes[0].suppress_auto,true);assert.ok(writes.some(x=>x.error==='Cancelled'));
});
test('stop latches before a late successful image arrives and prevents review adoption',async()=>{
 const client={get:async()=>({status:'succeeded',results:[{asset:'late'}]}),post:async(p,b)=>b,cancelJob:async()=>{},queueState:async()=>({queue_running:[],queue_pending:[]})};
 const task=generationReview(client,{id:'j',prompt_id:'p'});await task.stop();assert.equal(await task.wait(),null);
});
test('failed targeted stop stays retryable and does not claim completion',async()=>{
 let failed=true,running=true;const phases=[];const client={get:async()=>({status:'queued'}),post:async(p,b)=>b,cancelJob:async()=>{if(failed)throw Error('target API unavailable');running=false;},queueState:async()=>({queue_running:running?[[0,'p']]:[],queue_pending:[]})};
 const task=generationReview(client,{id:'j',prompt_id:'p'},{onUpdate:s=>phases.push(s.phase)});await task.stop();assert.equal(phases.at(-1),'stopFailed');assert.ok(!phases.includes('stopped'));failed=false;await task.stop();assert.equal(await task.wait(),null);
});
test('double stop clicks send only one targeted cancellation while pending',async()=>{
 let calls=0,release;const gate=new Promise(r=>release=r);const client={post:async(p,b)=>b,cancelJob:async()=>{calls++;await gate;},queueState:async()=>({queue_running:[],queue_pending:[]})};
 const task=generationReview(client,{id:'j',prompt_id:'p'});const a=task.stop();const b=task.stop();await b;release();await a;assert.equal(calls,1);
});
test('temporary progress transport errors keep the review monitor alive',async()=>{
 let calls=0;const phases=[];const client={get:async()=>{if(!calls++)throw Error('offline');return{status:'succeeded',results:[{asset:'x'}]};}};
 assert.equal((await generationReview(client,{id:'j'},{interval:0,onUpdate:s=>phases.push(s.phase)}).wait()).results[0].asset,'x');assert.deepEqual(phases,['connectionRetry']);
});
test('closing the dialog detaches monitoring without cancelling any prompt',async()=>{
 const abort=new AbortController();abort.abort();let reads=0;await assert.rejects(generationReview({get:async()=>reads++},{id:'j'},{signal:abort.signal}).wait());assert.equal(reads,0);
});
