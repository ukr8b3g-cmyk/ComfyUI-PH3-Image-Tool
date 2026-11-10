// Pure document state; image bytes live in the local content-addressed store.
export const VERSION = 1;
export const MAX_PIXELS = 16777216;
export const MAX_LAYERS = 256;
export function ensureLayerCapacity(doc, count=1) {
  if (!Number.isInteger(count) || count < 0) throw Error('Invalid layer count');
  if (doc.layers.length + count > MAX_LAYERS) throw Error('Layer limit: 256');
}
// Raster stamps and AI lettering are decoration even though their type is image.
export function isDecorationLayer(layer) {
  return layer.type !== 'image' || layer.decoration === true || layer.generation?.mode === 'lettering';
}
export function imageInsertionIndex(doc) {
  const first = doc.layers.findIndex(isDecorationLayer);
  return first < 0 ? doc.layers.length : first;
}
export const clone = value => JSON.parse(JSON.stringify(value));
export function historySelection(before,after,selected){
 const old=new Map(before.layers.map(l=>[l.id,JSON.stringify(l)]));
 const changed=after.layers.filter(l=>old.get(l.id)!==JSON.stringify(l));
 return changed.at(-1)?.id||(after.layers.some(l=>l.id===selected)?selected:after.layers.at(-1)?.id)||null;
}
export const uid = () => {const bytes=new Uint8Array(16);crypto.getRandomValues(bytes);return [...bytes].map(x=>x.toString(16).padStart(2,'0')).join('');};
export const clamp = (n, low, high) => Math.min(high, Math.max(low, Number(n) || 0));
export function checkSize(w, h) {
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 || w > 8192 || h > 8192 || w * h > MAX_PIXELS) throw Error('Canvas must be 1–8192 pixels per side and at most 16 megapixels.');
}
// Limit new/resized canvases without invalidating older project documents.
export function checkNewSize(w,h){checkSize(w,h);if(w>2048||h>2048)throw Error('New canvas dimensions must be at most 2048 x 2048.');}
export function makeLayer(type, width, height, overrides={}) {
  const big = type === 'speed' || type === 'frame';
  return {id:uid(),type,name:type,x:big?0:width*.22,y:big?0:height*.25,
    w:big?width:width*.56,h:big?height:height*.25,rotation:0,opacity:1,visible:true,locked:false,
    text:type==='sfx'?'ドン!':type==='text'?'テキスト':'',font:'"Yu Gothic", "Meiryo", sans-serif',
    fontSize:Math.max(20,Math.round(width*.045)),bold:type==='sfx',vertical:false,
    fill:type==='bubble'?'#ffffff':'#111111',stroke:type==='sfx'?'#ffffff':'#111111',lineWidth:type==='sfx'?4:3,
    shape:'oval',symbol:'star',tailX:.65,tailY:1.3,lines:80,gap:.32,seed:42,frame:'simple',...overrides};
}
export class History {
  constructor(limit=40, budget=16*1024*1024) {this.limit=limit;this.budget=budget;this.past=[];this.future=[];}
  record(doc) {
    this.past.push(JSON.stringify(doc)); this.future=[];
    let bytes=this.past.reduce((n,x)=>n+x.length*2,0);
    while(this.past.length>this.limit || bytes>this.budget) bytes-=this.past.shift().length*2;
  }
  undo(doc) {
    if(!this.past.length)return null;
    this.future.push(JSON.stringify(doc));const next=JSON.parse(this.past.pop());
    next.canvas_revision=doc.canvas_revision+1;return next;
  }
  redo(doc) {
    if(!this.future.length)return null;
    this.past.push(JSON.stringify(doc));const next=JSON.parse(this.future.pop());
    next.canvas_revision=doc.canvas_revision+1;return next;
  }
  clear(){this.past=[];this.future=[];}
}
export function localPoint(layer, point) {
  const theta=-layer.rotation*Math.PI/180,dx=point.x-layer.x-layer.w/2,dy=point.y-layer.y-layer.h/2;
  return {x:dx*Math.cos(theta)-dy*Math.sin(theta)+layer.w/2,y:dx*Math.sin(theta)+dy*Math.cos(theta)+layer.h/2};
}
export function worldPoint(layer, point) {
  const theta=layer.rotation*Math.PI/180,dx=point.x-layer.w/2,dy=point.y-layer.h/2;
  return {x:dx*Math.cos(theta)-dy*Math.sin(theta)+layer.x+layer.w/2,y:dx*Math.sin(theta)+dy*Math.cos(theta)+layer.y+layer.h/2};
}
export function hitLayer(doc, point, selected=null) {
  for(const layer of [...doc.layers].reverse()) {
    if(!layer.visible || layer.locked || ((layer.type==='frame'||layer.type==='speed')&&layer.id!==selected))continue;
    const p=localPoint(layer,point);
    if(p.x>=0&&p.y>=0&&p.x<=layer.w&&p.y<=layer.h)return layer;
  }
  return null;
}
export function candidateMatches(doc, job, projectId) {
  return job.project_id===projectId && doc.canvas_revision===job.request.canvas_revision
    && doc.width===job.request.canvas[0] && doc.height===job.request.canvas[1];
}
export function layerFromCandidate(doc, job, index=0) {
  const item=job.results[index];if(!item)throw Error('Missing generation result');
  const req=job.request;
  return makeLayer('image',doc.width,doc.height,{name:req.prompt.slice(0,50),asset:req.mode==='lettering'?item.asset:item.raw_asset||item.asset,
      mask_asset:req.mask_asset||null,x:item.x,y:item.y,w:item.w,h:item.h,...(req.mode==='lettering'?{decoration:true,rotation:req.parent_layer?.rotation??req.source_layer?.rotation??0}:{}),
    generation:{job_id:job.id,result_index:index,mode:req.mode,prompt:req.prompt,original_prompt:req.original_prompt,
      seed:req.config.seed,models:req.config,source_asset:req.source_asset,raw_asset:item.raw_asset,
        mask_asset:req.mask_asset,generation_size:req.generation_size,region:req.region,...(req.mode==='lettering'?{preserved_lettering_asset:item.preserved_lettering_asset,glyph_rect:item.glyph_rect,lettering:req.lettering,source_layer_id:req.source_layer?.id,parent_job_id:req.parent_job_id,parent_result_index:req.parent_result_index,finish_only:!!req.finish_only}:{} )}});
}
export function addLetteringLayer(doc,job,index,name,{preserveExisting=false}={}){
    ensureLayerCapacity(doc);
    const layer=layerFromCandidate(doc,job,index);layer.name=name;
    const unchanged=snapshot=>{const current=doc.layers.find(l=>l.id===snapshot?.id);return current&&!current.locked&&JSON.stringify(current)===JSON.stringify(snapshot)?current:null;};
    const parent=unchanged(job.request.parent_layer),source=unchanged(job.request.source_layer);
    if(!preserveExisting){if(parent)parent.visible=false;if(source)source.visible=false;}
    const anchor=parent||source;if(anchor)doc.layers.splice(doc.layers.indexOf(anchor)+1,0,layer);else doc.layers.push(layer);
    return layer;
  }
export function reorder(layers,id,direction) {
  const index=layers.findIndex(x=>x.id===id),target=index+direction;
  if(index<0||target<0||target>=layers.length)return false;
  [layers[index],layers[target]]=[layers[target],layers[index]];return true;
}
export function safeSeed(text) {
  if(!/^\d+$/.test(String(text)))throw Error('Seed must be an integer');
  const seed=Number(text);if(!Number.isSafeInteger(seed)||seed<0)throw Error('Seed exceeds the exact browser integer range');
  return String(seed);
}
export function randomSeed(){const v=new Uint32Array(2);crypto.getRandomValues(v);return String((v[0]&0x1fffff)*4294967296+v[1]);}
export function contentSignature(doc){return JSON.stringify([doc.width,doc.height,doc.background,doc.transparent,doc.layers,doc.selection_asset]);}

export function insertImageLayer(doc, layer) {
  ensureLayerCapacity(doc);
  // Do not reorder the user's existing stack. Insert beneath its first decoration.
  doc.layers.splice(imageInsertionIndex(doc),0,layer);
}

// Every editing instruction change invalidates pending results, even if later restored.
export function setPromptValue(doc, key, value) {
  if (!['original','ai','source'].includes(key)) throw Error('Unknown prompt field');
  if (doc.prompt[key] === value) return false;
  doc.prompt[key] = value;
  doc.canvas_revision++;
  return true;
}

// Only preselect exact known P-H3 model basenames.  Never silently choose a
// different architecture, and never replace a user's valid selected model.
const PH3_MODEL_PREFERENCES = Object.freeze({
  unet_name: ['minimax_h3_fl2va_pruned_int8_convrot.safetensors'],
  clip_name: ['p-h3-image_text_encoder_int8_convrot.safetensors', 'p-h3-image_text_encoder_w4a8.safetensors'],
  vae_name: ['p-h3-image_vae_int8_convrot.safetensors'],
  lora_name: ['p-h3-image_lora_bf16.safetensors'],
  enhancer_name: ['p-h3-image_prompt_upsampler_w4a8.safetensors'],
});
const MODEL_CATEGORIES = Object.freeze({
  unet_name: 'diffusion_models', clip_name: 'text_encoders',
  vae_name: 'vae', lora_name: 'loras', enhancer_name: 'text_encoders',
});
const baseName = value => String(value||'').replaceAll('\\','/').split('/').pop().toLowerCase();
export function suggestInstalledPH3Models(settings, catalog) {
  const next = {...settings}, selected = [];
  for (const [field, category] of Object.entries(MODEL_CATEGORIES)) {
    const available = Array.isArray(catalog?.[category]) ? catalog[category] : [];
    if (next[field]) continue; // Never change an explicit choice.
    for (const name of PH3_MODEL_PREFERENCES[field]) {
      const matches = available.filter(item => baseName(item) === name);
      if (matches.length === 1) {
        next[field] = matches[0]; selected.push(field); break;
      }
      // Duplicate basenames across model subfolders need manual disambiguation.
      if (matches.length > 1) break;
    }
  }
  return {settings: next, selected};
}
export function ph3ModelReadiness(settings, catalog) {
  const missing = [];
  for (const [field, category] of Object.entries(MODEL_CATEGORIES)) {
    if (field === 'enhancer_name') continue;
    const choices = Array.isArray(catalog?.[category]) ? catalog[category] : [];
    if (!settings?.[field] || !choices.includes(settings[field])) missing.push(field);
  }
  return {missing, ready: missing.length === 0 && !(catalog?.missing_nodes||[]).length};
}

// Layer arrays are back-to-front; the UI displays them in reverse.
export function moveLayerRelative(layers,id,targetId,above=true){
 const from=layers.findIndex(l=>l.id===id),target=layers.findIndex(l=>l.id===targetId);
 if(from<0||target<0||from===target||layers[from].locked)return false;
 const [layer]=layers.splice(from,1),at=layers.findIndex(l=>l.id===targetId);
 layers.splice(at+(above?1:0),0,layer);return true;
}
