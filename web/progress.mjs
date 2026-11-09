// Only progress from sampler nodes in this client's submitted prompt is exposed.
export class ProgressTracker {
 constructor(){this.graphs=new Map();this.frames=new Map();this.listeners=new Map();}
 bind(promptId,graph){
  this.graphs.set(promptId,new Set(Object.entries(graph).filter(([,n])=>['SamplerCustomAdvanced','SamplerCustom','KSampler','KSamplerAdvanced'].includes(n.class_type)).map(([id])=>id)));
  if(this.graphs.size>64)this.graphs.delete(this.graphs.keys().next().value);this.notify(promptId);
 }
 ingest(type,data){
  if(!data||typeof data.prompt_id!=='string'||!data.prompt_id)return;
  const id=data.prompt_id;let frame=this.frames.get(id);
  if(!frame){frame={nodes:new Map(),executing:undefined};this.frames.set(id,frame);if(this.frames.size>64)this.frames.delete(this.frames.keys().next().value);}
  const record=p=>{
   const node=p.node??p.node_id,value=p.value,max=p.max;
   if(typeof node!=='string'||!Number.isInteger(value)||!Number.isInteger(max)||max<1||value<0||value>max)return;
   frame.nodes.delete(node);frame.nodes.set(node,{node,value,max,percent:Math.round(value/max*100)});
   if(frame.nodes.size>128)frame.nodes.delete(frame.nodes.keys().next().value);
  };
  if(type==='progress')record(data);
  else if(type==='progress_state'){for(const [node,p]of Object.entries(data.nodes||{}))if(p&&typeof p==='object')record({...p,node});}
  else if(type==='executing')frame.executing=data.node;
  else if(type==='execution_start'){frame.nodes.clear();frame.executing=undefined;}
  else return;
  this.notify(id);
 }
 get(promptId){
  const allowed=this.graphs.get(promptId),frame=this.frames.get(promptId);if(!allowed||!frame)return null;
  const entries=[...frame.nodes.values()].filter(p=>allowed.has(p.node)),last=entries.at(-1);if(!last)return null;
  return {...last,postSampling:last.value===last.max&&frame.executing!==undefined&&!allowed.has(frame.executing)};
 }
 subscribe(promptId,listener){let set=this.listeners.get(promptId);if(!set){set=new Set();this.listeners.set(promptId,set);}set.add(listener);listener(this.get(promptId));return()=>{set.delete(listener);if(!set.size)this.listeners.delete(promptId);};}
 notify(promptId){const value=this.get(promptId);for(const fn of this.listeners.get(promptId)||[])fn(value);}
 clear(){this.graphs.clear();this.frames.clear();this.listeners.clear();}
}
