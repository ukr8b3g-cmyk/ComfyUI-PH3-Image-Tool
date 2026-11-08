// Use ComfyUI's atomic, ID-scoped cancellation. Never fall back to /interrupt.
export const isInQueue=(queue,id)=>!!id&&[...(queue.queue_running||[]),...(queue.queue_pending||[])].some(item=>item[1]===id);
export async function confirmStopped(client,job){
  if(isInQueue(await client.queueState(),job.prompt_id))return null;
  return client.post('/jobs/'+job.id+'/state',{status:'failed',error:'Cancelled',cancel_requested:false,suppress_auto:true});
}
export async function cancelGeneration(client,job){
  await client.post('/jobs/'+job.id+'/state',{suppress_auto:true,cancel_requested:true});
  try{
    if(job.prompt_id)await client.cancelJob(job.prompt_id);
    return await confirmStopped(client,job);
  }catch(error){
    await client.post('/jobs/'+job.id+'/state',{cancel_requested:false});
    throw error;
  }
}
