const BASE='/ph3_image_tool';
export class Client {
  constructor({fetcher=(...args)=>fetch(...args),url=x=>x,clientId=null}={}){this.fetcher=fetcher;this.url=url;this.clientId=clientId;}
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
  queue(prompt){const body={prompt};if(this.clientId)body.client_id=this.clientId;return this.request('/prompt','POST',body);}
  history(id){return this.request('/history/'+encodeURIComponent(id));}
  queueState(){return this.request('/queue');}
  cancelJob(id){return this.request('/api/jobs/'+encodeURIComponent(id)+'/cancel','POST',{});}
  deleteQueued(id){return this.request('/queue','POST',{delete:[id]});}
}
