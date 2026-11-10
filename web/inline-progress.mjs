import {generationReview} from './job-review.mjs?v=70d397f187c183a6';
export function sharedProgress({home,tr}){
 const panel=document.createElement('div');panel.className='ph3-shared-progress';panel.hidden=true;
 const status=document.createElement('span');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 const bar=document.createElement('div');bar.className='ph3-progress';bar.setAttribute('role','progressbar');bar.setAttribute('aria-label',tr('generationProgress'));bar.append(document.createElement('i'));
 const stop=document.createElement('button');stop.type='button';stop.dataset.ph3JobStop='';stop.dataset.tone='red';stop.textContent=tr('stop');stop.setAttribute('aria-label',tr('stopThisGeneration'));stop.title=tr('stopHelp');
 const review=document.createElement('button');review.type='button';review.dataset.ph3JobStop='';review.className='ph3-progress-review';review.dataset.tone='blue';review.textContent=tr('openGeneration');review.setAttribute('aria-label',tr('openGeneration'));review.hidden=true;
 panel.append(status,bar,stop,review);home.append(panel);let owner=null,current=null;const reviews=new Map();
 function refresh(){review.hidden=!reviews.size;panel.hidden=!current&&!reviews.size;stop.hidden=bar.hidden=!current;if(!current)status.textContent=tr('generationReviewAvailable');}
 review.onclick=()=>[...reviews.values()].at(-1)?.();
 stop.onclick=()=>current?.stop?.();
 return {element:panel,
  mount(header,before=null){header.insertBefore(panel,before);},
  addReview(token,open){reviews.set(token,open);refresh();},
  removeReview(token){reviews.delete(token);refresh();},
  acquire(token){owner=token;},
  release(token){if(owner===token){owner=null;current=null;refresh();}},
  clear(){if(owner===null){current=null;refresh();}},
  show(token,data){if(owner!==token)return;current=data;refresh();const {phase,numerical,error,started,label}=data;const displayPhase=numerical?.postSampling&&phase==='generating'?'processingResult':phase;const steps=numerical?tr('samplingSteps')+' '+numerical.value+' / '+numerical.max+' '+tr('stepUnit')+' · '+numerical.percent+'%':'';
  status.textContent=(label?label+' · ':'')+tr(displayPhase)+(steps?' · '+steps:'')+(error?' · '+error.message:'')+' · '+Math.max(0,Math.floor((Date.now()-started)/1000))+tr('elapsedSeconds');status.classList.toggle('error',phase==='stopFailed'||phase==='connectionRetry');stop.textContent=tr(phase==='stopping'?'stopping':'stop');stop.disabled=phase==='stopping';
  bar.classList.toggle('is-determinate',!!numerical);bar.firstElementChild.style.width=numerical?numerical.percent+'%':'';
  if(numerical){bar.setAttribute('aria-valuemin','0');bar.setAttribute('aria-valuemax','100');bar.setAttribute('aria-valuenow',String(numerical.percent));bar.setAttribute('aria-valuetext',steps);}else{for(const attr of ['aria-valuemin','aria-valuemax','aria-valuenow','aria-valuetext'])bar.removeAttribute(attr);}
  }
 };
}
export function inlineProgress({box,client,tr,shared}){
 const token=Symbol('inline generation');let task=null,active=false,requested=false,phase='preparingGeneration',error=null,started=0,timer=null,numerical=null,unsubscribe=null;
 const edit=document.createElement('button');edit.type='button';edit.textContent=tr('returnToEditing');edit.setAttribute('aria-label',tr('returnToEditing'));edit.dataset.ph3JobStop='';edit.onclick=()=>box.dispatchEvent(new Event('ph3-background'));edit.dataset.tone='blue';const header=box.querySelector('.ph3-modal-header');header.insertBefore(edit,header.querySelector('[data-ph3-close]'));
 const render=()=>{if(active)shared.show(token,{phase,numerical,error,started,stop:stopTask});};
 function stopTask(){if(!active)return;requested=true;phase='stopping';error=null;render();if(task)task.stop();}
 function prepare(){unsubscribe?.();unsubscribe=null;numerical=null;active=true;requested=false;task=null;phase='preparingGeneration';error=null;started=Date.now();shared.addReview(token,()=>box.dispatchEvent(new Event('ph3-foreground')));shared.acquire(token);clearInterval(timer);timer=setInterval(render,1000);render();}
 function finish(){active=false;clearInterval(timer);timer=null;task=null;unsubscribe?.();unsubscribe=null;numerical=null;shared.release(token);}
 box.addEventListener('ph3-close',()=>{finish();shared.removeReview(token);},{once:true});
 return {prepare,finish,async watch(job,{signal}={}){
  if(!active)prepare();if(job.prompt_id&&client.subscribeProgress)unsubscribe=client.subscribeProgress(job.prompt_id,value=>{numerical=value;render();});task=generationReview(client,job,{signal,onUpdate:s=>{phase=s.phase;error=s.error;render();}});
  if(requested)task.stop();try{return await task.wait();}finally{finish();}
 }};
}
