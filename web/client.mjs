import {ProgressTracker} from './progress.mjs?v=c05d225929bd2f7c';
const BASE='/ph3_image_tool';
export class Client {
  constructor({fetcher=(...args)=>fetch(...args),url=x=>x,clientId=null,progressEvents=null,webSocketFactory=null}={}){this.fetcher=fetcher;this.url=url;this.clientId=clientId;this.progressEvents=progressEvents;this.webSocketFactory=webSocketFactory;this.progress=new ProgressTracker();this.progressCleanup=null;this.progressSocket=null;this.progressReady=null;this.reconnectTimer=null;this.ownClientId=null;this.disposed=false;}
  async startProgress(){
    this.disposed=false;
    if(this.progressEvents?.addEventListener){
      if(!this.progressCleanup){const handlers=['progress','progress_state','executing','execution_start'].map(type=>{const fn=event=>this.progress.ingest(type,event.detail);this.progressEvents.addEventListener(type,fn);return[type,fn];});this.progressCleanup=()=>handlers.forEach(([type,fn])=>this.progressEvents.removeEventListener(type,fn));}
      return;
    }
    // Never replace the host ComfyUI socket by reusing its client ID.
    if(this.clientId&&!this.ownClientId)return;
    if(!this.webSocketFactory&&typeof WebSocket==='undefined')return;
    if(this.progressReady)return this.progressReady;
    this.ownClientId??=crypto.randomUUID();this.clientId=this.ownClientId;
    const endpoint=new URL(this.url('/ws'),typeof location==='undefined'?'http://localhost/':location.href);endpoint.protocol=endpoint.protocol==='https:'?'wss:':'ws:';endpoint.searchParams.set('clientId',this.ownClientId);
    const socket=this.webSocketFactory?this.webSocketFactory(endpoint.href):new WebSocket(endpoint.href);this.progressSocket=socket;
    this.progressReady=new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>{socket.close();reject(Error('Progress connection timed out'));},4000);
      socket.addEventListener('open',()=>{clearTimeout(timeout);resolve();},{once:true});
      socket.addEventListener('error',()=>{clearTimeout(timeout);reject(Error('Progress connection unavailable'));},{once:true});
    });
    socket.addEventListener('message',event=>{if(typeof event.data!=='string')return;try{const message=JSON.parse(event.data);this.progress.ingest(message.type,message.data);}catch{}});
    socket.addEventListener('close',()=>{if(this.progressSocket!==socket)return;this.progressSocket=null;this.progressReady=null;if(!this.disposed){clearTimeout(this.reconnectTimer);this.reconnectTimer=setTimeout(()=>this.startProgress().catch(()=>{}),1000);}});
    return this.progressReady;
  }
  subscribeProgress(promptId,listener){return this.progress.subscribe(promptId,listener);}
  dispose(){this.disposed=true;clearTimeout(this.reconnectTimer);this.progressCleanup?.();this.progressCleanup=null;const socket=this.progressSocket;this.progressSocket=null;this.progressReady=null;socket?.close();this.progress.clear();}
  async request(path,method='GET',body=null){
    const opts={method};if(body!==null){opts.headers={'Content-Type':'application/json'};opts.body=JSON.stringify(body);}
    const response=await this.fetcher(path,opts);let value;
    try{value=await response.json();}catch{throw Error(`HTTP ${response.status}: invalid JSON response`);}
    if(!response.ok||(value.error&&typeof value.error==='object')){const e=Error(value.error?.message||value.error?.type||(typeof value.error==='string'?value.error:`HTTP ${response.status}`));e.code=value.error?.code;e.detail=value.node_errors;throw e;}
    return value;
  }
  get(path){return this.request(BASE+path);}
  post(path,body){return this.request(BASE+path,'POST',body);}
  put(path,body){return this.request(BASE+path,'PUT',body);}
  async upload(blob,name='image.png',path='/assets'){
    const form=new FormData();form.append('file',blob,name);
    const response=await this.fetcher(BASE+path,{method:'POST',body:form}),data=await response.json();
    if(!response.ok||data.error)throw Error(data.error?.message||`Upload HTTP ${response.status}`);return data;
  }
  assetURL(key){return this.url(BASE+'/assets/'+encodeURIComponent(key));}
  async archive(id){const response=await this.fetcher(BASE+`/projects/${id}/export`);if(!response.ok){const data=await response.json();throw Error(data.error?.message||'Export failed');}return response.blob();}
  async encode(options){
    const response=await this.fetcher(BASE+'/encode',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(options)});
    if(!response.ok){const data=await response.json();throw Error(data.error?.message||'Encoding failed');}return response.blob();
  }
  async queue(prompt){await this.startProgress().catch(()=>{});const body={prompt};if(this.clientId)body.client_id=this.clientId;const result=await this.request('/prompt','POST',body);if(result.prompt_id)this.progress.bind(result.prompt_id,prompt);return result;}
  history(id){return this.request('/history/'+encodeURIComponent(id));}
  queueState(){return this.request('/queue');}
  cancelJob(id){return this.request('/api/jobs/'+encodeURIComponent(id)+'/cancel','POST',{});}
  deleteQueued(id){return this.request('/queue','POST',{delete:[id]});}
}
