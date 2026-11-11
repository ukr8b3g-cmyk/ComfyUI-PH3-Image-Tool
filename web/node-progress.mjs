import {ProgressTracker} from './progress.mjs?v=59a8d35b929e86cd';
export function nodeProgress(node,api,locale='en'){
 const ja=String(locale).startsWith('ja'),tracker=new ProgressTracker(),terminal=new Map();let current=null,off=null;
 const widget={name:'PH3 generation progress',type:'ph3_progress',serialize:false,value:null,computeSize:()=>[260,38],draw(ctx,n,width,y){
  ctx.save();ctx.fillStyle='#18212b';ctx.fillRect(10,y+3,width-20,32);ctx.font='11px sans-serif';ctx.fillStyle='#e7edf4';ctx.fillText(widget.value?.text||(ja?'生成待機中':'Ready to generate'),16,y+16,width-32);
  if(widget.value?.active){ctx.fillStyle='#344250';ctx.fillRect(16,y+23,width-32,5);if(widget.value.percent!=null){ctx.fillStyle='#9ad8c3';ctx.fillRect(16,y+23,(width-32)*widget.value.percent/100,5);}}ctx.restore();}};
 node.addCustomWidget(widget);
 const display=(text,active=false,percent=null)=>{widget.value={text,active,percent};node.setDirtyCanvas?.(true,true);};
 const handlers=['progress','progress_state','executing','execution_start','execution_error','execution_interrupted'].map(type=>{const fn=e=>{const d=e.detail;if(!d)return;tracker.ingest(type,d);if(d.prompt_id&&(type==='execution_error'||type==='execution_interrupted'||type==='executing'&&d.node===null)){terminal.set(d.prompt_id,type);if(terminal.size>64)terminal.delete(terminal.keys().next().value);}if(d.prompt_id!==current)return;
  if(type==='execution_error'||type==='execution_interrupted'){off?.();off=null;display(ja?(type==='execution_error'?'生成エラー':'生成停止'):(type==='execution_error'?'Generation failed':'Stopped'));}
  else if(type==='executing'&&d.node===null){off?.();off=null;display(ja?'生成完了':'Generation complete');}};api.addEventListener(type,fn);return[type,fn];});
 return{queued(job,graph){off?.();current=job.prompt_id;tracker.bind(current,graph);if(terminal.has(current)){const type=terminal.get(current);display(type==='executing'?(ja?'生成完了':'Generation complete'):type==='execution_error'?(ja?'生成エラー':'Generation failed'):(ja?'生成停止':'Stopped'));return;}display(ja?'生成中・キュー待ち':'Generating / queued',true);off=tracker.subscribe(current,p=>{if(p)display((ja?'生成中 ':'Generating ')+p.value+' / '+p.max+' · '+p.percent+'%',true,p.percent);});},dispose(){off?.();for(const[type,fn]of handlers)api.removeEventListener(type,fn);tracker.clear();terminal.clear();}};
}
