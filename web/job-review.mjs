import {reconcileJob} from './job-presence.mjs?v=37e99894a6ee0379';
import {cancelGeneration,confirmStopped,isInQueue} from './job-cancel.mjs?v=37e99894a6ee0379';
const pause=(ms,signal)=>new Promise((resolve,reject)=>{
 const done=()=>{signal?.removeEventListener('abort',abort);resolve();},timer=setTimeout(done,ms);
 const abort=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);reject(signal.reason);};
 signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
});
// Cancellation latches before the HTTP request, so a late success stays a candidate.
export function generationReview(client,job,{signal,onUpdate=()=>{},interval=900}={}){
 let cancelled=false,pending=false,finished=false,stopFailed=false,last=job;
 const emit=(phase,error=null)=>{if(cancelled&&!['stopping','stopFailed','stopped'].includes(phase))return;if(!finished&&!signal?.aborted)onUpdate({phase,error,job:last});};
 return {
  async stop(){
   if(finished||pending)return;cancelled=true;pending=true;stopFailed=false;emit('stopping');
   try{await cancelGeneration(client,job);}catch(error){stopFailed=true;emit('stopFailed',error);}finally{pending=false;}
  },
  async wait(){
   for(;;){
    signal?.throwIfAborted();
    try{last=await reconcileJob(client,{...job,...await client.get('/jobs/'+job.id)});}catch(error){emit(cancelled?'stopFailed':'connectionRetry',error);await pause(interval,signal);continue;}
    signal?.throwIfAborted();
    if(last.cancel_requested||last.error==='Cancelled')cancelled=true;
    if(cancelled){
     try{const stopped=await confirmStopped(client,job);signal?.throwIfAborted();if(stopped){emit('stopped');finished=true;return null;}if(!stopFailed)emit('stopping');}
     catch(error){signal?.throwIfAborted();stopFailed=true;emit('stopFailed',error);}
    }else{
     if(last.status==='succeeded'){finished=true;if(!last.results?.length)throw Error('Generation returned no images');return last;}
     if(last.status==='failed'){finished=true;throw Error(last.error||'Generation failed');}
     try{
      const queue=await client.queueState();signal?.throwIfAborted();emit(isInQueue({queue_running:queue.queue_running},job.prompt_id)?'generating':isInQueue(queue,job.prompt_id)?'queued':'processingResult');
      if(job.prompt_id){const run=(await client.history(job.prompt_id))[job.prompt_id];if(!cancelled&&run?.status?.status_str==='error'){const error=(run.status.messages||[]).find(x=>x[0]==='execution_error');finished=true;throw Error(error?.[1]?.exception_message||'Generation failed');}}
     }catch(error){signal?.throwIfAborted();if(finished)throw error;emit('connectionRetry',error);}
    }
    await pause(interval,signal);
   }
  }
 };
}
// Watch a standard queued job without applying it or interrupting other work.
export async function waitForJob(client,job,{signal,onUpdate=()=>{},interval=900}={}){
 for(;;){
  signal?.throwIfAborted();const next=await reconcileJob(client,{...job,...await client.get('/jobs/'+job.id)});signal?.throwIfAborted();onUpdate(next);
  if(next.status==='succeeded'){if(!next.results?.length)throw Error('Generation returned no images');return next;}
  if(next.status==='failed')throw Error(next.error||'Generation failed');
  if(next.prompt_id){const run=(await client.history(next.prompt_id))[next.prompt_id];if(run?.status?.status_str==='error'){
   const error=(run.status.messages||[]).find(x=>x[0]==='execution_error');throw Error(error?.[1]?.exception_message||'Generation failed');
  }}
  await new Promise((resolve,reject)=>{const done=()=>{signal?.removeEventListener('abort',abort);resolve();},timer=setTimeout(done,interval),abort=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);reject(signal.reason);};signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();});
 }
}
export function visibleJobs(jobs,hidden){return jobs.filter(j=>!hidden.has(j.id)&&!(j.status==='failed'&&j.error==='Cancelled'&&!j.results?.length&&!j.text));}
