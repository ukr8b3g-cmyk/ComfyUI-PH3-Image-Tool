import {ensureCutoutModel} from './cutout-model.mjs?v=01bc95baa1764cb1';
import {canvas,exportCanvas,layerSelectionMask,toBlob} from './render.mjs?v=01bc95baa1764cb1';
import {maskBounds} from './selection.mjs?v=01bc95baa1764cb1';
import {COMIC_DEFAULTS,COMIC_STYLES,comicAsync,processComic} from './comic-engine.mjs?v=01bc95baa1764cb1';
import {cutoutAsync} from './edge-refine.mjs?v=01bc95baa1764cb1';
import {COMIC} from './presets.mjs?v=01bc95baa1764cb1';
import {autoColorCutout,refineCutout} from './cutout-auto.mjs?v=01bc95baa1764cb1';
const el=(tag,cls='',text='')=>{const e=document.createElement(tag);e.className=cls;if(text)e.textContent=text;return e;};
const scaled=(source,max=640)=>{const f=Math.min(1,max/Math.max(source.width,source.height)),c=canvas(Math.max(1,Math.round(source.width*f)),Math.max(1,Math.round(source.height*f)));c.getContext('2d').drawImage(source,0,0,c.width,c.height);return c;};
const data=c=>c.getContext('2d',{willReadFrequently:true}).getImageData(0,0,c.width,c.height);
const fromData=p=>{const c=canvas(p.width,p.height);c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(p.data),p.width,p.height),0,0);return c;};
export async function openProcessing({action,layer,doc,cache,client,selection,modal,tr,catalog,onApply,onError,onManga}) {
 const native=await cache.get(layer.asset),local={...doc,width:native.width,height:native.height,transparent:true,layers:[{...layer,x:0,y:0,w:native.width,h:native.height,rotation:0,opacity:1,visible:true}]};
 const source=await exportCanvas(local,cache),previewSource=scaled(source,640),thumbSource=scaled(source,150),sourceData=data(previewSource);
 const box=modal(tr(action==='comic'?'comicFilter':'cutout'),{maximizable:true});box.box.classList.add('ph3-processing');if(action!=='comic')box.box.classList.add('ph3-cutout-modal');
 const {body,actions,finish}=box;let closed=false,sequence=0,timer=null,controller=null,sourceInfo=null,previewInfo=null,maskInfo=null,latest=null;
 if(action==='comic'&&onManga){const select=el('select');select.setAttribute('aria-label',tr('filterMethod'));select.title=tr('filterMethodHelp');select.setAttribute('aria-description',select.title);for(const [id,key]of [['classic','classicMethod'],['screen','screenMethod']]){const o=el('option','',tr(key));o.value=id;select.append(o);}select.onchange=()=>{if(select.value==='screen'){finish();onManga().catch(onError);}};body.append(select);}
 const savedPreset=doc.settings.comic_preset||'comic',knownPreset=COMIC_STYLES.some(x=>x[0]===savedPreset)||COMIC.some(x=>x[0]===savedPreset);
 let preset=knownPreset?savedPreset:'comic',parameters={...COMIC_DEFAULTS,...doc.settings.comic_settings},method=doc.settings.background_method||'color',tolerance=doc.settings.background_tolerance??32,seed=[0,0],legacy=!COMIC_STYLES.some(x=>x[0]===preset);
 // Each opening starts with Auto; manual edits refine its immutable base.
 if(action!=='comic')method='auto';
 let regions=[],regionMode='add',selectionAction='remove',applying=false;
 let modelPrompted=false,modelPending=null;
 let aiAvailable=!!(catalog?.cutout?.onnx_available&&catalog?.cutout?.model_available);
 let edge={width:1,amount:0,defringe:false,matte:'none',shrink:0,feather:0,...doc.settings.cutout_edge};
 let methodSelect=null,modelNote=null;
 const bgCache=new Map(),after=el('canvas','ph3-process-canvas'),before=el('canvas','ph3-process-canvas'),note=el('p','ph3-small');
 const layout=el('div','ph3-processing-layout'),visual=el('div','ph3-processing-visual'),controls=el('div','ph3-processing-controls'),comparison=el('div','ph3-comparison');
 const panel=(label,c)=>{const frame=el('div','ph3-compare-panel'),cap=el('span','ph3-compare-label',label);frame.append(cap,c);comparison.append(frame);};
 panel(tr('before'),before);panel(tr('after'),after);visual.append(comparison,note);layout.append(visual,controls);body.append(el('p','ph3-small',`${layer.name} · ${source.width} × ${source.height} px`),layout);
 before.width=after.width=previewSource.width;before.height=after.height=previewSource.height;before.getContext('2d').drawImage(previewSource,0,0);after.getContext('2d').drawImage(previewSource,0,0);
 const resultLabel=el('p','ph3-process-status',tr('previewHint'));resultLabel.setAttribute('role','status');controls.append(resultLabel);
 const bgRow=el('div','ph3-preview-backgrounds');for(const [label,bg] of [['checker',''],['white','#fff'],['black','#18202a'],['green','#61b499']]){const b=el('button','ph3-bg-swatch');b.type='button';b.title=tr(label);b.setAttribute('aria-label',tr(label));if(bg)b.style.background=bg;b.onclick=()=>{for(const c of [before,after]){c.style.backgroundColor=bg;c.style.backgroundImage=bg?'none':'';}};bgRow.append(b);}visual.append(bgRow);
 function line(key,control){const l=el('label','ph3-field'),caption=el('span','',tr(key));control.setAttribute('aria-label',tr(key));l.append(caption,control);controls.append(l);return control;}
 function select(key,choices,value,onChange){const c=el('select');for(const [id,label]of choices){const o=el('option','',label);o.value=id;c.append(o);}c.value=value;c.onchange=()=>{onChange(c.value);schedule();};return line(key,c);}
 function range(key,value,min,max,step,onChange){const group=el('div','ph3-range-control'),c=el('input'),n=el('input');c.type='range';n.type='number';for(const e of [c,n]){e.min=min;e.max=max;e.step=step;e.value=value;}
  c.setAttribute('aria-label',tr(key)+' slider');n.setAttribute('aria-label',tr(key));const update=(v)=>{v=Number(v);if(!Number.isFinite(v)||v<min||v>max)return;c.value=n.value=v;onChange(v);schedule();};c.oninput=()=>update(c.value);n.onchange=()=>update(n.value);group.append(c,n);line(key,group);return group;}
 function check(key,value,onChange){const c=el('input');c.type='checkbox';c.checked=value;c.onchange=()=>{onChange(c.checked);schedule();};return line(key,c);}
 function clear(){clearTimeout(timer);controller?.abort();sequence++;latest=null;apply.disabled=true;}
 function schedule(){clear();if(closed)return;resultLabel.textContent=tr('previewPending');timer=setTimeout(()=>renderPreview().catch(report),180);}
 function report(e){if(closed||e.name==='AbortError')return;resultLabel.textContent=e.message;resultLabel.classList.add('error');apply.disabled=true;}
 const refresh=el('button','',tr('preview')),apply=el('button','primary',tr('applyResult'));apply.dataset.tone='green';refresh.dataset.tone='blue';apply.disabled=true;actions.prepend(refresh,apply);refresh.onclick=()=>{clear();renderPreview(true).catch(report);};
 let transparentResult=null;
 if(action==='comic'){
  const grid=el('div','ph3-style-grid');controls.append(grid);
  for(const [id,ja,en,opts]of COMIC_STYLES){const card=el('button','ph3-style-card'),small=data(thumbSource),pixels=processComic(small.data,small.width,small.height,{...COMIC_DEFAULTS,...opts});const c=fromData(new ImageData(pixels,small.width,small.height));card.append(c,el('span','',doc.settings.locale==='en'?en:ja));card.setAttribute('aria-label',doc.settings.locale==='en'?en:ja);card.dataset.preset=id;
   card.onclick=()=>{legacy=false;preset=id;parameters={...parameters,...COMIC_DEFAULTS,...opts};grid.querySelectorAll('button').forEach(b=>b.classList.toggle('active',b===card));presetChoice.value=id;syncRanges();schedule();};grid.append(card);}
  const presetChoice=select('comicPreset',[...COMIC_STYLES.map(x=>[x[0],x[doc.settings.locale==='en'?2:1]]),...COMIC.filter(x=>x[0]!=='grayscale').map(x=>['legacy:'+x[0],x[doc.settings.locale==='en'?2:1]])],legacy?'legacy:'+preset:preset,value=>{legacy=value.startsWith('legacy:');preset=legacy?value.slice(7):value;if(!legacy)parameters={...parameters,...COMIC_DEFAULTS,...(COMIC_STYLES.find(x=>x[0]===preset)?.[3]||{})};syncRanges();grid.querySelectorAll('button').forEach(b=>b.classList.toggle('active',b.dataset.preset===preset));});
  const ranges=new Map();for(const[key,min,max,step]of [['strength',0,1,.05],['brightness',-100,100,1],['contrast',.5,2.5,.05],['gamma',.4,2.5,.05],['lineStrength',0,3,.05],['toneStrength',0,1,.05],['posterLevels',2,6,1]])ranges.set(key,range(key,parameters[key],min,max,step,v=>parameters[key]=v));
  const details=el('details','ph3-processing-details'),summary=el('summary','',tr('advancedLines'));details.append(summary);controls.append(details);
  for(const[key,min,max,step]of [['sigma',.3,3,.05],['epsilon',-.3,.2,.005],['phi',1,100,1],['smoothRadius',0,5,1]]){const group=range(key,parameters[key],min,max,step,v=>parameters[key]=v);details.append(group.parentNode);ranges.set(key,group);}
  function syncRanges(){for(const[key,group]of ranges)for(const i of group.querySelectorAll('input')){i.value=parameters[key];i.disabled=legacy&&key!=='strength';}}
  syncRanges();grid.querySelectorAll('button').forEach(b=>b.classList.toggle('active',!legacy&&b.dataset.preset===preset));
 }else{
  methodSelect=select('cutoutMethod',[['auto',tr('autoMethod')],['color',tr('colorMethod')],['selection',tr('selectionMethod')],['isnet',tr('aiMethod')]],method,value=>{method=value;});
  if(!catalog?.cutout?.onnx_available)methodSelect.querySelector('[value=isnet]').disabled=true;
  modelNote=el('p','ph3-small',tr(aiAvailable?'cutoutAutoAI':'isnetMissing'));controls.append(modelNote);
  controls.append(el('p','ph3-small',tr('clickRegions')));
  select('regionMode',[['add',tr('regionAdd')],['restore',tr('regionRestore')],['replace',tr('regionReplace')]],regionMode,v=>regionMode=v);
  select('selectionAction',[['remove',tr('removeSelected')],['keep',tr('keepSelected')]],selectionAction,v=>selectionAction=v);
  const regionStatus=el('p','ph3-small');controls.append(regionStatus);
  function markRegions(){before.getContext('2d').drawImage(previewSource,0,0);const c=before.getContext('2d');for(const item of regions){c.strokeStyle=item.remove?'#ee4055':'#22a878';c.lineWidth=2;c.beginPath();c.arc(item.seed[0]*before.width/source.width,item.seed[1]*before.height/source.height,7,0,Math.PI*2);c.stroke();}regionStatus.textContent=tr('regionCount')+': '+regions.length;}
  const regionButtons=el('div','ph3-row');for(const[key,fn]of [['regionUndo',()=>regions.pop()],['regionReset',()=>regions=[]]]){const b=el('button','',tr(key));b.onclick=()=>{if(applying)return;fn();markRegions();schedule();};regionButtons.append(b);}controls.append(regionButtons);markRegions();
  before.style.cursor=after.style.cursor='crosshair';before.title=after.title=tr('clickRegions');before.onclick=after.onclick=e=>{if(applying||closed)return;const target=e.currentTarget,r=target.getBoundingClientRect(),scale=Math.min((r.width-2)/target.width,(r.height-2)/target.height),w=target.width*scale,h=target.height*scale,px=e.clientX-r.left-(r.width-w)/2,py=e.clientY-r.top-(r.height-h)/2;
    // object-fit:contain letterboxes the canvas. Padding is not an image pixel.
    if(px<0||py<0||px>=w||py>=h)return;
    if(method==='selection'){method='color';methodSelect.value=method;}
    if(regionMode==='replace')regions=[];if(regions.length>=64){report(Error(tr('regionLimit')));return;}
    seed=[Math.max(0,Math.min(source.width-1,Math.floor(px*source.width/w))),Math.max(0,Math.min(source.height-1,Math.floor(py*source.height/h)))];regions.push({seed,remove:regionMode!=='restore'});markRegions();schedule();};
  range('tolerance',tolerance,0,255,1,v=>tolerance=v);
  select('matteRemoval',[['none',tr('none')],['white',tr('white')],['black',tr('black')]],edge.matte,v=>edge.matte=v);
  check('defringe',edge.defringe,v=>edge.defringe=v);range('edgeWidth',edge.width,1,10,1,v=>edge.width=v);range('decontaminate',edge.amount,0,1,.05,v=>edge.amount=v);range('shrink',edge.shrink,0,10,1,v=>edge.shrink=v);range('edgeFeather',edge.feather,0,8,1,v=>edge.feather=v);
  transparentResult=check('cutoutCanvasTransparent',true,()=>{});
 }
 note.textContent=tr('processingNote');
 async function originalUpload(){if(!sourceInfo)sourceInfo=await client.upload(await toBlob(source));return sourceInfo;}
 async function backgroundBase(explicit=false){
  if((method==='auto'||method==='isnet')&&!aiAvailable&&catalog?.cutout?.onnx_available&&(!modelPrompted||method==='isnet')){
   modelPrompted=true;refresh.disabled=true;
   try{modelPending??=ensureCutoutModel({client,catalog,confirmDownload:message=>new Promise(resolve=>{const dialog=modal(tr('downloadModel'),{maximizable:false});dialog.body.append(el('p','ph3-small',message));dialog.body.lastChild.style.whiteSpace='pre-line';const yes=el('button','primary',tr('downloadModel'));yes.onclick=()=>{resolve(true);dialog.finish();};dialog.actions.prepend(yes);dialog.box.addEventListener('ph3-close',()=>resolve(false),{once:true});}),onStatus:message=>{resultLabel.textContent=message;},tr});aiAvailable=await modelPending;}
   finally{modelPending=null;if(!closed)refresh.disabled=false;}
   if(closed)throw new DOMException('Closed','AbortError');
   modelNote.textContent=tr(aiAvailable?'cutoutAutoAI':'isnetMissing');
   if(!aiAvailable&&method==='isnet'){method='auto';methodSelect.value='auto';}
  }
  if(method==='auto'||method==='isnet'){
   const useAI=method==='isnet'||aiAvailable,key=useAI?'auto:isnet':'auto:color:'+tolerance;
   if(method==='isnet'&&!explicit&&!bgCache.has(key))throw Error(tr('aiPreviewExplicit'));
   if(!bgCache.has(key)){
    const promise=useAI?(async()=>{const info=await originalUpload();const result=await client.post('/process',{action:'remove_background',asset:info.asset,method:'isnet'});return cache.get(result.asset);})():Promise.resolve(fromData(autoColorCutout(data(source),tolerance)));
    bgCache.set(key,promise);promise.catch(()=>{if(bgCache.get(key)===promise)bgCache.delete(key);});
    if(bgCache.size>6)bgCache.delete(bgCache.keys().next().value);
   }
   const base=await bgCache.get(key);return regions.length?fromData(refineCutout(data(source),data(scaled(base,Math.max(source.width,source.height))),regions,tolerance)):base;
  }
  const sourceInfo=await originalUpload(),payload={action:'remove_background',asset:sourceInfo.asset,method,tolerance,seed,regions:regions.map(r=>({...r,seed:[...r.seed]})),selection_action:selectionAction};
  if(method==='selection'){if(!maskBounds(selection,doc.width,doc.height))throw Error(tr('requireSelection'));if(!maskInfo)maskInfo=await client.upload(await toBlob(layerSelectionMask(layer,selection,doc.width,doc.height,source.width,source.height)));payload.mask_asset=maskInfo.asset;}
  const key=JSON.stringify(payload);if(bgCache.has(key))return await bgCache.get(key);
  if(method==='isnet'&&!explicit)throw Error(tr('aiPreviewExplicit'));
  const promise=client.post('/process',payload).then(info=>cache.get(info.asset));bgCache.set(key,promise);if(bgCache.size>6)bgCache.delete(bgCache.keys().next().value);
  try{return await promise;}catch(error){bgCache.delete(key);throw error;}
 }
 async function calculate(full=false,explicit=false,signal=null){
  if(action==='comic'){
   if(legacy){const input=full?await originalUpload():(previewInfo??=await client.upload(await toBlob(previewSource)));const result=await client.post('/process',{action:'comic',asset:input.asset,preset,strength:parameters.strength});return scaled(await cache.get(result.asset),full?Math.max(source.width,source.height):640);}
   return fromData(await comicAsync(full?data(source):sourceData,parameters,{signal}));
  }
  const base=await backgroundBase(explicit),image=scaled(base,full?Math.max(source.width,source.height):640),factor=image.width/source.width;
  // Mask refinement widths are native pixels; reduced previews use proportional widths.
  const config={...edge,width:Math.max(1,Math.round(edge.width*factor)),shrink:Math.round(edge.shrink*factor),feather:Math.round(edge.feather*factor)};
  return fromData(await cutoutAsync(data(image),config,{signal}));
 }
 async function renderPreview(explicit=false){
  const serial=++sequence;controller?.abort();controller=new AbortController();apply.disabled=true;resultLabel.textContent=tr('working');resultLabel.classList.remove('error');
  const output=await calculate(false,explicit,controller.signal);if(closed||serial!==sequence)return;
  after.width=output.width;after.height=output.height;after.getContext('2d').drawImage(output,0,0);latest=serial;apply.disabled=false;resultLabel.textContent=tr('previewReady');
 }
 apply.onclick=async()=>{if(closed||latest!==sequence)return;applying=true;clearTimeout(timer);const serial=sequence;controller?.abort();controller=new AbortController();apply.disabled=refresh.disabled=true;for(const c of controls.querySelectorAll('input,select,button'))c.disabled=true;resultLabel.textContent=tr('processingFull');
  try{const out=await calculate(true,true,controller.signal);if(closed||serial!==sequence)return;const info=await client.upload(await toBlob(out));if(closed||serial!==sequence)return;
   const settings=action==='comic'?{comic_settings:{...parameters},comic_preset:preset}:{background_method:method,background_tolerance:tolerance,cutout_edge:{...edge}};
   const sourceAsset=(await originalUpload()).asset;if(closed||serial!==sequence)return;
   await onApply(info,{action,preset,settings,transparent:transparentResult?.checked,source_asset:sourceAsset});if(!closed)finish();
  }catch(error){if(closed||serial!==sequence)return;applying=false;report(error);refresh.disabled=false;for(const c of controls.querySelectorAll('input,select,button'))c.disabled=false;}
 };
 box.box.addEventListener('ph3-close',()=>{closed=true;clearTimeout(timer);controller?.abort();bgCache.clear();},{once:true});
 if(action==='comic')await renderPreview().catch(report);else await renderPreview(false).catch(report);
}
