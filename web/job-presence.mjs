import {isInQueue} from './job-cancel.mjs?v=18a51c11ff11998e';
export const EXTERNAL_QUEUE_REMOVED='Queue entry removed externally';

// One monitor per Client is shared by all UI watchers. A missing entry is not
// terminal until multiple successful observations, a grace period and a final
// persisted-result/queue/history check agree. No ComfyUI interruption is sent.
export class JobPresence {
  constructor({now=Date.now,graceMs=15000,minObservations=3,minInterval=800}={}){this.now=now;this.graceMs=graceMs;this.minObservations=minObservations;this.minInterval=minInterval;this.states=new Map();}
  async check(client,job){
    if(!job?.id||!job.prompt_id||!['prepared','queued','running'].includes(job.status)||job.cancel_requested||job.results?.length||job.text){this.states.delete(job?.id);return job;}
    if(typeof client.queueState!=='function'||typeof client.history!=='function')return job;
    const prior=this.states.get(job.id);
    if(prior?.pending)return prior.pending;
    if(prior&&this.now()-prior.checked<this.minInterval)return job;
    const state=prior||{first:this.now(),count:0,checked:-Infinity};this.states.set(job.id,state);
    const run=async()=>{
      try{
        const present=async()=>{const [queue,history]=await Promise.all([client.queueState(),client.history(job.prompt_id)]);return isInQueue(queue,job.prompt_id)||!!history?.[job.prompt_id];};
        if(await present()){this.states.delete(job.id);return job;}
        state.checked=this.now();state.count++;
        if(state.count<this.minObservations||this.now()-state.first<this.graceMs)return job;
        const latest=await client.get('/jobs/'+job.id);
        if(latest.status==='succeeded'||latest.status==='failed'||latest.cancel_requested||latest.results?.length||latest.text){this.states.delete(job.id);return latest;}
        if(await present()){this.states.delete(job.id);return latest;}
        const result=await client.post('/jobs/'+job.id+'/state',{status:'failed',error:EXTERNAL_QUEUE_REMOVED,suppress_auto:true,only_if_unfinished:true,expected_prompt_id:job.prompt_id});this.states.delete(job.id);return result;
      }catch(error){this.states.delete(job.id);throw error;}
    };
    state.pending=run();try{return await state.pending;}finally{state.pending=null;}
  }
}
export function reconcileJob(client,job){client.jobPresence??=new JobPresence();return client.jobPresence.check(client,job);}
