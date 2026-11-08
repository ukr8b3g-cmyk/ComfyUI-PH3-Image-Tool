import {openLettering} from './lettering-ui.mjs?v=8ed0e47f8bb24088';
import {fitTextBox,textLayoutSignature} from './source-text.mjs?v=8ed0e47f8bb24088';
import {cancelGeneration,confirmStopped} from './job-cancel.mjs?v=8ed0e47f8bb24088';
import {editorShortcut} from './shortcuts.mjs?v=8ed0e47f8bb24088';
import {SOURCE_ASSETS} from './source-assets.mjs?v=8ed0e47f8bb24088';
import {groupFonts,loadFont,prepareFonts} from './source-fonts.mjs?v=8ed0e47f8bb24088';
import {ensureLayerCapacity,isDecorationLayer,moveLayerRelative,clone,uid,makeLayer,History,checkSize,hitLayer,localPoint,worldPoint,candidateMatches,layerFromCandidate,addLetteringLayer,reorder,randomSeed,safeSeed,insertImageLayer,setPromptValue,suggestInstalledPH3Models,ph3ModelReadiness} from './core.mjs?v=9d2b3fb59c01be4a';
import {selectionBoundary,floodSelect,colorRangeMask,featherMask,selectionOperation,combineMasks,rectangleMask,ellipseMask,polygonMask,strokeMask,invertMask,maskBounds,maskCanvas,readMask} from './selection.mjs?v=8ed0e47f8bb24088';
import {RasterCache,canvas,drawDocument,exportCanvas,layerSelectionMask,toBlob} from './render.mjs?v=9d2b3fb59c01be4a';
import {BUBBLES,SFX,SYMBOLS,FRAMES,COMIC,SPEEDS,TEXT_STYLES} from './presets.mjs?v=8ed0e47f8bb24088';
import {t} from './i18n.mjs?v=8ed0e47f8bb24088';
import {toScreen,toDocument,anchoredView,fitView,wheelPixels,visibleHandlePoints,resizeLayer} from './viewport.mjs?v=8ed0e47f8bb24088';
import {icon,presetOptions,presetThumbnail,layerThumbnail} from './graphics.mjs?v=8ed0e47f8bb24088';
import {openProcessing} from './processing-ui.mjs?v=8ed0e47f8bb24088';
import {openManga} from './manga-ui.mjs?v=8ed0e47f8bb24088';
import {addMangaLayers} from './manga-core.mjs?v=9d2b3fb59c01be4a';

const styleURL=new URL('./style.css'+new URL(import.meta.url).search,import.meta.url).href;
const el=(tag,cls='',text=null)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==null)e.textContent=text;return e;};
function download(blob,name){const a=document.createElement('a'),url=URL.createObjectURL(blob);a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function filePicker(accept,multiple=false){return new Promise(resolve=>{const input=document.createElement('input');input.type='file';input.accept=accept;input.multiple=multiple;input.onchange=()=>resolve([...input.files]);input.oncancel=()=>resolve([]);input.click();});}

export async function openStudio({client,projectId='',inputAsset=null,onApply=null,onClose=null,hostLocale=null}) {
  if(!document.querySelector('link[data-ph3-tool]')){const link=el('link');link.rel='stylesheet';link.href=styleURL;link.dataset.ph3Tool='1';await new Promise((resolve,reject)=>{link.onload=resolve;link.onerror=()=>{link.remove();reject(Error('Editor styles could not be loaded'));};document.head.append(link);});}
  let record=projectId?await client.get('/projects/'+projectId):await client.post('/projects',{});
  let doc=clone(record.document);if(hostLocale)doc.settings.locale=String(hostLocale).toLowerCase().startsWith('ja')?'ja':'en';
  let savedText=JSON.stringify(doc),selected=null,tool='move',operation='replace',zoom=1;
  // Capture recovery data before any asynchronous bootstrap work or auto defaults.
  let draftRecovery=readDraftRecovery(record);
  function readDraftRecovery(saved) {
    const key='ph3-tool:draft:'+saved.id;
    try {
      const raw=localStorage.getItem(key);if(!raw)return null;
      let draft=null;try{draft=JSON.parse(raw);}catch{}
      if(draft?.document&&JSON.stringify(draft.document)===JSON.stringify(saved.document))return null;
      return {id:saved.id,key,raw,draft}; // Preserve malformed drafts for explicit export/discard too.
    } catch {return null;}
  }
  let pixelOptions={tolerance:30,contiguous:true,merged:true,antialias:true};
  try{Object.assign(pixelOptions,JSON.parse(localStorage.getItem('ph3-tool:pixel-selection')||'{}'));}catch{}
  let view={zoom:1,x:0,y:0,angle:0},viewDrag=null,layerClipboard=null;
  let closed=false,detached=false,busy=0,gesture=null,selection=new Uint8ClampedArray(doc.width*doc.height),rasters=new Map();
  let renderToken=0,pollTimer=null,draftTimer=null,selectionEpoch=0,pan=null,space=false,bgSeed=null;
  let jobs=[],currentJobs=new Map(),activeTab='generate',catalog=null,selectionOverlay=null,selectionEdge=null;
  const history=new History(doc.settings.history_limit||40),cache=new RasterCache(k=>client.assetURL(k)),abort=new AbortController();
  const events={signal:abort.signal};const textMeasure=canvas(1,1).getContext('2d');
  const root=el('dialog','ph3-tool');root.setAttribute('aria-label','PH3 Image Tool');root.dataset.theme=doc.settings.theme||'dark';
  const shell=el('div','ph3-shell'),top=el('header','ph3-top'),work=el('div','ph3-work'),left=el('aside','ph3-left'),center=el('main','ph3-center'),right=el('aside','ph3-right'),footer=el('footer','ph3-footer');
  const viewbar=el('div','ph3-viewbar'),viewport=el('div','ph3-viewport'),stage=el('div','ph3-stage'),display=el('canvas','ph3-canvas'),hint=el('div','ph3-hint');
  display.setAttribute('aria-label','Image editing canvas');viewport.tabIndex=0;stage.append(display);viewport.append(stage);center.append(viewbar,viewport,hint);
  const floating=new Map();let drawer=null;
  const tabs=el('div','ph3-tabs'),panels={},statusNode=el('span','ph3-status');statusNode.setAttribute('role','status');statusNode.setAttribute('aria-live','polite');
  const sizeLabel=el('span'),footerVersion=el('span');footer.append(statusNode,sizeLabel,footerVersion);right.append(tabs);
  work.append(left,center,right);shell.append(top,work,footer);root.append(shell);document.body.append(root);
  const tr=key=>t(doc.settings.locale||'ja',key);
  const status=(text,error=false)=>{statusNode.textContent=text;statusNode.title=text;statusNode.classList.toggle('error',error);};
  function button(key,fn,cls=''){const b=el('button',cls);b.append(icon(key),el('span','ph3-button-label',tr(key)));b.setAttribute('aria-label',tr(key));b.title=tr(key+'Help')===key+'Help'?tr(key):tr(key+'Help');b.type='button';b.dataset.i18n=key;if(fn)b.addEventListener('click',()=>{if(busy)return;Promise.resolve().then(fn).catch(fail);},events);return b;}
  function fail(error){console.error('[PH3 Image Tool]',error);status(`${tr('error')}: ${error.message||error}`,true);}
  function labelElement(tag,cls,key){const n=el(tag,cls,tr(key));n.dataset.i18n=key;return n;}
  function localize(){root.dataset.theme=doc.settings.theme||'dark';root.lang=doc.settings.locale||'ja';root.querySelectorAll('[data-i18n]').forEach(n=>{const label=n.querySelector('.ph3-button-label');if(label)label.textContent=tr(n.dataset.i18n);else n.textContent=tr(n.dataset.i18n);n.setAttribute('aria-label',tr(n.dataset.i18n));n.title=tr(n.dataset.i18n+'Help')===n.dataset.i18n+'Help'?tr(n.dataset.i18n):tr(n.dataset.i18n+'Help');});root.querySelectorAll('[data-i18n-label]').forEach(n=>n.setAttribute('aria-label',tr(n.dataset.i18nLabel)));root.querySelectorAll('[data-help]').forEach(n=>n.title=tr(n.dataset.help));hint.textContent=tr('canvasHint');layerSplit.setAttribute('aria-label',tr('layerHeight'));layerSplit.title=tr('layerHeight');minus.title=tr('zoomOut');plus.title=tr('zoomIn');zoomInput.setAttribute('aria-label',tr('zoomPercent'));footerVersion.textContent='0.2.0-rc3+manga.1';footerVersion.title=tr('notFinal');for(const option of modeSelect.options)option.textContent=tr(({selection:'partial',full:'full',new:'newImage'})[option.value]);for(const option of sourceSelect.options)option.textContent=tr(option.value);for(const option of operationSelect.options)option.textContent=tr(option.value);originalText.placeholder=tr('promptPlaceholder');originalText.setAttribute('aria-label',tr('original'));aiText.setAttribute('aria-label',tr('ai'));operationSelect.setAttribute('aria-label',tr('selectionOperation'));renderProperties();renderReferences();renderJobs();}
  async function withBusy(fn,label='working'){
    if(busy)throw Error(tr('working'));busy++;
    const disabled=[...root.querySelectorAll('button,input,select,textarea')].map(x=>[x,x.disabled]);disabled.forEach(([x])=>x.disabled=true);status(tr(label));
    try{return await fn();}finally{busy--;disabled.forEach(([x,v])=>{if(x.isConnected)x.disabled=v;});updateToolbar();}
  }
  function dirty(){return JSON.stringify(doc)!==savedText;}
  function stashDraft(){
    clearTimeout(draftTimer);if(draftRecovery)return;
    const id=record.id;
    draftTimer=setTimeout(()=>{
      if(closed||draftRecovery||record.id!==id)return;
      try{localStorage.setItem('ph3-tool:draft:'+id,JSON.stringify({revision:record.revision,document:doc}));}
      catch{status('Draft storage unavailable; use Save or Export project.',true);}
    },350);
  }
  function suggestModels(){
    if(!catalog||draftRecovery||closed)return;
    const suggested=suggestInstalledPH3Models(doc.settings,catalog);
    if(suggested.selected.length)commit(d=>{d.settings=suggested.settings;},{canvasChange:false,refresh:false});
    if(!ph3ModelReadiness(doc.settings,catalog).ready)status(tr('setupFirst'),true);
  }
  function offerDraftRecovery(){
    const pending=draftRecovery;if(!pending||pending.id!==record.id)return;
    const {body,actions,finish,box}=modal(tr('recoverDraft'));let resolved=false;
    const ja=doc.settings.locale!=='en';
    body.append(el('p','',pending.draft?.document?tr(pending.draft.revision===record.revision?'recoverDraftHelp':'recoverCopyHelp'):
      (ja?'下書きを読み取れません。退避するか、明示的に破棄してください。':'The draft cannot be read. Download it or explicitly discard it.')));
    // Closing the recovery prompt must never mean permission to replace the draft.
    box.addEventListener('ph3-close',()=>{if(!resolved)queueMicrotask(()=>{if(!closed)requestClose();});},{once:true});
    const backup=el('button','',ja?'下書きJSONを退避':'Download draft JSON');
    backup.onclick=()=>download(new Blob([pending.raw],{type:'application/json'}),'PH3-recovery-draft.json');
    const discard=el('button','',ja?'下書きを破棄':'Discard draft');
    discard.onclick=()=>{
      if(busy)return;
      try{
        if(localStorage.getItem(pending.key)!==pending.raw)throw Error(ja?'別の画面で下書きが変更されました。開き直してください。':'The draft changed in another editor. Reopen the project.');
        localStorage.removeItem(pending.key);draftRecovery=null;resolved=true;finish();suggestModels();
      }catch(error){fail(error);}
    };
    actions.prepend(backup,discard);
    if(pending.draft?.document){
      const restore=el('button','primary',tr('restoreDraft'));
      restore.onclick=async()=>{
        if(busy)return;
        try{await withBusy(async()=>{
          if(pending.id!==record.id)throw Error(tr('processingConflict'));
          const recovered=clone(pending.draft.document);
          checkSize(recovered.width,recovered.height);ensureLayerCapacity(recovered,0);
          if(pending.draft.revision!==record.revision){
            const copy=await client.post('/projects',{document:recovered});
            // The old draft remains recoverable until its new copy is safely stored.
            resolved=true;finish();await switchRecord(copy);
            try{if(localStorage.getItem(pending.key)===pending.raw)localStorage.removeItem(pending.key);}catch{}
          }else{
            const previous=doc;
            doc=recovered;
            try{await restoreSelection();}catch(error){doc=previous;await restoreSelection();throw error;}
            doc.canvas_revision=Math.max(previous.canvas_revision,doc.canvas_revision)+1;
            history.clear();draftRecovery=null;resolved=true;finish();syncPrompt();localize();await renderAll();fit();stashDraft();
          }
        });suggestModels();}catch(error){fail(error);}
      };
      actions.prepend(restore);
    }
  }
  function commit(fn,{canvasChange=true,refresh=true}={}){
    const previous=new Map(doc.layers.filter(l=>l.type==='text').map(l=>[l.id,textLayoutSignature(l)]));history.record(doc);fn(doc);for(const l of doc.layers)if(l.type==='text'&&!l.locked&&l.autoFit!==false&&previous.get(l.id)!==textLayoutSignature(l))fitTextBox(textMeasure,l);if(canvasChange)doc.canvas_revision++;
    stashDraft();if(refresh){renderAll();}else updateToolbar();
  }
  function updateToolbar(){undoButton.disabled=busy||!history.past.length;redoButton.disabled=busy||!history.future.length;saveButton.querySelector('.ph3-button-label').textContent=tr('save')+(dirty()?' *':'');sizeLabel.textContent=`${doc.width} × ${doc.height} · ${Math.round(zoom*100)}% · ${Math.round(view.angle)}°`;if(zoomInput)zoomInput.value=Math.round(zoom*100);if(viewAngle)viewAngle.textContent=Math.round(view.angle)+'°';}
  function invalidate(){selectionOverlay=null;selectionEdge=null;}
  async function restoreSelection(){const epoch=++selectionEpoch;
    if(!doc.selection_asset){selection=new Uint8ClampedArray(doc.width*doc.height);invalidate();return;}
    const key=doc.selection_asset,w=doc.width,h=doc.height,image=await cache.get(key);if(epoch!==selectionEpoch||closed)return;
    if(image.width!==w||image.height!==h)throw Error('Stored selection dimensions do not match the canvas');
    selection=readMask(image,w,h);invalidate();
  }
  async function replaceSelection(next){
    if(busy)return;
    await withBusy(async()=>{const asset=maskBounds(next,doc.width,doc.height)?(await client.upload(await toBlob(maskCanvas(next,doc.width,doc.height)))).asset:null;
      commit(d=>d.selection_asset=asset,{refresh:false});selection=next;invalidate();await renderAll();});status(tr('ready'));
  }
  async function renderAll(){
    const token=++renderToken,snapshot=clone(doc);
    try{await prepareFonts(snapshot);const prepared=await cache.prepare(snapshot);if(token!==renderToken||closed)return;rasters=prepared;draw();renderLayers();renderProperties();updateToolbar();}catch(e){fail(e);}
  }
  function draw(){
    if(closed)return;
    // Screen preview is bounded; exports always use the original canvas size.
    const scale=Math.min(1,Math.max(.15,zoom),2048/Math.max(doc.width,doc.height));
    const pw=Math.max(1,Math.round(doc.width*scale)),ph=Math.max(1,Math.round(doc.height*scale));
    if(display.width!==pw||display.height!==ph){display.width=pw;display.height=ph;}
    display.style.width=`${doc.width}px`;display.style.height=`${doc.height}px`;display.style.transform=`translate(calc(-50% + ${view.x}px),calc(-50% + ${view.y}px)) rotate(${view.angle}deg) scale(${zoom})`;
    const ctx=display.getContext('2d');ctx.setTransform(scale,0,0,scale,0,0);drawDocument(ctx,doc,rasters);
    if(selection.some(x=>x>0)){
      if(!selectionOverlay){selectionOverlay=maskCanvas(selection,doc.width,doc.height,true);const c=selectionOverlay.getContext('2d');c.globalCompositeOperation='source-in';c.fillStyle='#43a8ee';c.fillRect(0,0,doc.width,doc.height);}
      ctx.save();ctx.globalAlpha=.12;ctx.drawImage(selectionOverlay,0,0);ctx.restore();
      if(!selectionEdge||selectionEdge.width!==pw||selectionEdge.height!==ph){
        selectionEdge=canvas(pw,ph);const edgeCtx=selectionEdge.getContext('2d');edgeCtx.drawImage(selectionOverlay,0,0,pw,ph);
        const pixels=edgeCtx.getImageData(0,0,pw,ph),mask=new Uint8ClampedArray(pw*ph);for(let i=0;i<mask.length;i++)mask[i]=pixels.data[i*4+3];
        pixels.data.set(selectionBoundary(mask,pw,ph));edgeCtx.putImageData(pixels,0,0);
      }
      ctx.save();ctx.imageSmoothingEnabled=false;ctx.drawImage(selectionEdge,0,0,doc.width,doc.height);ctx.restore();
    }
    const l=doc.layers.find(x=>x.id===selected);
    if(l&&tool==='move'){
      ctx.save();ctx.translate(l.x+l.w/2,l.y+l.h/2);ctx.rotate(l.rotation*Math.PI/180);ctx.translate(-l.w/2,-l.h/2);
      ctx.strokeStyle='#8ecfb8';ctx.lineWidth=1.5/zoom;ctx.setLineDash([5/zoom,3/zoom]);ctx.strokeRect(0,0,l.w,l.h);ctx.setLineDash([]);
      const rotateHandle=visibleHandlePoints(l,view,doc,viewSize()).find(h=>h.id==='rotate');ctx.beginPath();ctx.moveTo(l.w/2,rotateHandle.anchorY);ctx.lineTo(rotateHandle.x,rotateHandle.y);ctx.stroke();
      for(const handle of visibleHandlePoints(l,view,doc,viewSize())){const r=4.5/zoom;ctx.fillStyle=handle.id==='tail'?'#ffc857':handle.id==='rotate'?'#76d7c2':'#f5fff9';ctx.beginPath();if(handle.id==='rotate'||handle.id==='tail')ctx.arc(handle.x,handle.y,r,0,Math.PI*2);else ctx.rect(handle.x-r,handle.y-r,r*2,r*2);ctx.fill();ctx.stroke();}ctx.restore();
    }
    if(gesture?.points?.length){ctx.save();ctx.strokeStyle='#ffd66f';ctx.lineWidth=2/zoom;ctx.beginPath();gesture.points.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.stroke();ctx.restore();}
    if(!doc.layers.length){ctx.save();ctx.fillStyle='#6b7785';ctx.textAlign='center';ctx.font=`${Math.max(15,doc.width*.025)}px sans-serif`;ctx.fillText(tr('empty'),doc.width/2,doc.height/2,doc.width*.85);ctx.restore();}
  }
  function viewSize(){return {width:viewport.clientWidth,height:viewport.clientHeight};}
  function setView(next){view=next;zoom=next.zoom;draw();updateToolbar();}
  function fit(){setView(fitView(doc,viewSize(),view.angle));}
  function resetView(){setView(fitView(doc,viewSize(),0));}
  function zoomAt(value,anchor={x:viewport.clientWidth/2,y:viewport.clientHeight/2}){setView(anchoredView(view,{zoom:value},anchor,doc,viewSize()));}
  async function undo(){if(gesture||pan||viewDrag){cancelGesture();return;}const previous=history.undo(doc);if(!previous)return;doc=previous;selected=null;await restoreSelection();syncPrompt();stashDraft();await renderAll();}
  async function redo(){if(gesture||pan||viewDrag){cancelGesture();return;}const next=history.redo(doc);if(!next)return;doc=next;selected=null;await restoreSelection();syncPrompt();stashDraft();await renderAll();}
  async function saveRecord(apply=true){
    if(draftRecovery)throw Error(tr('recoverDraftHelp'));
    const snapshot=clone(doc),flat=await exportCanvas(snapshot,cache),image=await client.upload(await toBlob(flat));snapshot.composite_asset=image.asset;
    const next=await client.put('/projects/'+record.id,{revision:record.revision,document:snapshot});
    record=next;doc=clone(next.document);savedText=JSON.stringify(doc);clearTimeout(draftTimer);try{localStorage.removeItem('ph3-tool:draft:'+record.id);}catch{}
    if(apply&&!detached&&onApply)await onApply(record);
    updateToolbar();status(tr('saved'));return next;
  }
  async function save(){await withBusy(()=>saveRecord(true),'saving');}
  async function saveCopy(){if(draftRecovery)throw Error(tr('recoverDraftHelp'));await withBusy(async()=>{clearTimeout(draftTimer);const flat=await exportCanvas(doc,cache),info=await client.upload(await toBlob(flat));doc.composite_asset=info.asset;record=await client.post('/projects',{document:doc});savedText=JSON.stringify(doc);if(!detached&&onApply)await onApply(record);updateToolbar();status(tr('saved'));},'saving');}
  async function exportProject(){await withBusy(async()=>{await saveRecord(true);download(await client.archive(record.id),(doc.title||'project')+'.ph3tool');});}
  async function exportImage(){
    const snapshot=clone(doc),{body,actions,finish,box}=modal(tr('export'));box.classList.add('ph3-export-modal');
    let active=true,token=0,blob=null,encodedKey='',timer=null,url=null;
    box.addEventListener('ph3-close',()=>{active=false;token++;clearTimeout(timer);if(url)URL.revokeObjectURL(url);},{once:true});
    const options={format:doc.settings.export_format||'png',quality:Math.round((doc.settings.export_quality??.92)*100),png_compression:doc.settings.png_compression??6,webp_lossless:!!doc.settings.webp_lossless,preserve_alpha:doc.transparent,matte:doc.background.slice(0,7)};
    const frame=el('div','ph3-export-preview'),img=el('img');img.alt=tr('exportPreview');frame.append(img);body.append(frame);
    const formatRow=el('div','ph3-format-row');body.append(formatRow);const rows=el('div');body.append(rows);const size=el('div','ph3-export-size',tr('working'));size.setAttribute('role','status');body.append(size);
    const saveFile=el('button','primary',tr('downloadImage'));saveFile.disabled=true;actions.prepend(saveFile);
    const render=await exportCanvas(snapshot,cache,{background:false});if(!active)return;
    const asset=await client.upload(await toBlob(render));if(!active)return;
    function changed(){token++;blob=null;saveFile.disabled=true;clearTimeout(timer);size.textContent=tr('encoding');timer=setTimeout(()=>encode().catch(fail),160);}
    async function encode(){const serial=++token,config={asset:asset.asset,...options};let out;try{out=await client.encode(config);}catch(error){if(active&&serial===token){size.textContent=error.message;size.classList.add('error');}throw error;}if(!active||serial!==token)return;size.classList.remove('error');
      blob=out;encodedKey=JSON.stringify(options);if(url)URL.revokeObjectURL(url);url=URL.createObjectURL(blob);img.src=url;size.textContent=`${snapshot.width} × ${snapshot.height} px · ${blob.size<1048576?(blob.size/1024).toFixed(1)+' KB':(blob.size/1048576).toFixed(2)+' MB'}`;saveFile.disabled=false;}
    function row(key,c){field(rows,key,c);return c;}
    function slider(key,value,min,max,onChange){const group=el('div','ph3-range-control'),a=inputControl(value,'range'),b=inputControl(value,'number');for(const c of [a,b]){c.min=min;c.max=max;c.step=1;}a.setAttribute('aria-label',tr(key)+' slider');b.setAttribute('aria-label',tr(key));const change=value=>{const n=Number(value);if(!Number.isInteger(n)||n<min||n>max)return;a.value=b.value=n;onChange(n);changed();};a.oninput=()=>change(a.value);b.onchange=()=>change(b.value);group.append(a,b);row(key,group);}
    function refresh(){rows.replaceChildren();for(const b of formatRow.children)b.classList.toggle('active',b.dataset.format===options.format);
      if(options.format==='png'){slider('pngCompression',options.png_compression,0,9,v=>options.png_compression=v);rows.append(el('p','ph3-small',tr('pngLosslessHelp')));}
      else {slider('qualityPercent',options.quality,1,100,v=>options.quality=v);if(options.format==='webp'){const lossless=inputControl(options.webp_lossless,'checkbox');lossless.onchange=()=>{options.webp_lossless=lossless.checked;refresh();changed();};row('webpLossless',lossless);rows.append(el('p','ph3-small',tr(options.webp_lossless?'webpLosslessHelp':'lossyHelp')));}else rows.append(el('p','ph3-small',tr('jpegHelp')));}
      const alpha=inputControl(options.preserve_alpha,'checkbox');alpha.disabled=options.format==='jpeg';alpha.onchange=()=>{options.preserve_alpha=alpha.checked;changed();};row('preserveAlpha',alpha);const matte=inputControl(options.matte,'color');matte.onchange=()=>{options.matte=matte.value;changed();};row('matteColor',matte);rows.append(el('p','ph3-small',tr('transparentHelp')));
    }
    for(const format of ['png','webp','jpeg']){const b=el('button','ph3-format-card',format==='webp'?'WebP':format.toUpperCase());b.dataset.format=format;b.onclick=()=>{options.format=format;refresh();changed();};formatRow.append(b);}
    saveFile.onclick=()=>{if(!blob||encodedKey!==JSON.stringify(options))return;download(blob,(snapshot.title||'image').replace(/[\\/:*?"<>|]/g,'_')+'.'+(options.format==='jpeg'?'jpg':options.format));commit(d=>{d.settings.export_format=options.format;d.settings.export_quality=options.quality/100;d.settings.png_compression=options.png_compression;d.settings.webp_lossless=options.webp_lossless;},{canvasChange:false,refresh:false});finish();status(tr('exported'));};
    refresh();await encode();
  }
  async function switchRecord(next){clearTimeout(draftTimer);record=next;doc=clone(next.document);savedText=JSON.stringify(doc);draftRecovery=readDraftRecovery(record);selected=null;history.clear();cache.dispose();jobs=[];currentJobs.clear();await restoreSelection();syncPrompt();localize();await loadJobs();await renderAll();fit();suggestModels();offerDraftRecovery();}
  function confirmSwitch(){return !dirty()||confirm(tr('confirmNew'));}
  async function newProject(){
    const {body,actions,finish}=modal(tr('newProject'));
    const w=inputControl(doc.width,'number'),h=inputControl(doc.height,'number');
    field(body,'width',w);field(body,'height',h);
    const sizes=optionsSelect([['','—'],['1024x1024','1024 × 1024'],['832x1216','832 × 1216'],['1216x832','1216 × 832'],['1536x1024','1536 × 1024']],'');
    field(body,'canvasPreset',sizes);sizes.onchange=()=>{if(sizes.value)[w.value,h.value]=sizes.value.split('x');};
    const alpha=inputControl(doc.transparent,'checkbox');field(body,'transparent',alpha);
    const message=el('p','ph3-small');body.append(message);
    const create=button('create',async()=>{try{const width=Number(w.value),height=Number(h.value);checkSize(width,height);if(!confirmSwitch())return;
      await withBusy(async()=>{let next=await client.post('/projects',{width,height});if(next.document.transparent!==alpha.checked){next.document.transparent=alpha.checked;next=await client.put('/projects/'+next.id,{revision:next.revision,document:next.document});}await switchRecord(next);});finish();status(tr('ready'));
    }catch(error){message.textContent=error.message;message.classList.add('error');}});actions.prepend(create);
  }
  async function openProject(){
    const list=await client.get('/projects');const {body,finish}=modal(tr('openProject'));
    body.append(button('image',async()=>{finish();await importImages();}));
    const importButton=button('importProject',async()=>{const files=await filePicker('.ph3tool,.zip');if(!files[0]||!confirmSwitch())return;finish();await withBusy(async()=>switchRecord(await client.upload(files[0],files[0].name,'/import')));});body.append(importButton);
    for(const item of list){const b=el('button','',`${item.title} — ${new Date(item.saved_at*1000).toLocaleString()}`);b.style.display='block';b.style.width='100%';b.style.marginTop='6px';b.onclick=async()=>{if(!confirmSwitch())return;finish();try{await withBusy(async()=>switchRecord(await client.get('/projects/'+item.id)));}catch(e){fail(e);}};body.append(b);}
  }
  async function addImage(info,name='Image'){
    ensureLayerCapacity(doc);
    commit(d=>{if(!d.layers.length){checkSize(info.width,info.height);d.width=info.width;d.height=info.height;d.selection_asset=null;selection=new Uint8ClampedArray(d.width*d.height);invalidate();}
      const scale=Math.min(1,d.width/info.width,d.height/info.height),w=info.width*scale,h=info.height*scale;
      const layer=makeLayer('image',d.width,d.height,{asset:info.asset,name,w,h,x:(d.width-w)/2,y:(d.height-h)/2});insertImageLayer(d,layer);selected=layer.id;});await renderAll();fit();modeSelect.value='full';
  }
  async function importImages(files=null){files??=await filePicker('image/png,image/jpeg,image/webp',true);if(!files.length)return;
    ensureLayerCapacity(doc,files.length);
    await withBusy(async()=>{for(const f of files){const info=await client.upload(f,f.name);await addImage(info,f.name.replace(/\.[^.]+$/,''));}});status(tr('loaded'));
  }
  async function importStamp(){const files=await filePicker('image/png,image/webp',true);if(!files.length)return;ensureLayerCapacity(doc,files.length);await withBusy(async()=>{for(const file of files){const info=await client.upload(file,file.name);const scale=Math.min(doc.width*.3/info.width,doc.height*.3/info.height,1);addObject('image',{asset:info.asset,name:file.name,w:info.width*scale,h:info.height*scale,decoration:true});}});status(tr('loaded'));}
  async function importInput(){if(!inputAsset){status(tr('noInput'),true);return;}await withBusy(()=>addImage(inputAsset,'ComfyUI input'));}
  function addObject(type,overrides={}){
    ensureLayerCapacity(doc);
    commit(d=>{const layer=makeLayer(type,d.width,d.height,overrides);d.layers.push(layer);selected=layer.id;});tool='move';setTool('move');showTab('properties');
  }
  function presetModal(type,choices,applyToSelected=false){const {body,finish,box}=modal(tr(type),{dismissOutside:true,drawer:true});box.classList.add('ph3-gallery-modal');
    const search=inputControl('','search');search.placeholder=tr('searchStyles');search.setAttribute('aria-label',tr('searchStyles'));body.append(search);
    const grid=el('div','ph3-preset-grid');let style={fill:'#ffd42a',stroke:'#191919',lineWidth:0,bold:true};
    if(type==='sfx'){const picker=el('div','ph3-text-style-strip');for(const item of TEXT_STYLES){const b=el('button','ph3-mini-style',item[doc.settings.locale==='en'?2:1]);b.style.color=item[3].fill;b.style.background=item[3].stroke;b.onclick=()=>{style=item[3];populate();};picker.append(b);}body.append(picker);}
    body.append(grid);function populate(){grid.replaceChildren();const query=search.value.toLocaleLowerCase();for(const item of choices){const key=Array.isArray(item)?item[0]:item,label=Array.isArray(item)?item[doc.settings.locale==='en'?2:1]:item;if(query&&!String(item).toLocaleLowerCase().includes(query))continue;
      const b=el('button','ph3-preset-card');b.setAttribute('aria-label',label);b.dataset.preset=key;b.append(presetThumbnail(type,item,style),el('span','',label));
      b.onclick=()=>{finish();const opts=presetOptions(type,item,doc.width,doc.height,style);if(applyToSelected){const id=selected;commit(d=>{const layer=d.layers.find(l=>l.id===id);if(layer&&!layer.locked)Object.assign(layer,Array.isArray(item)?item[3]:{});});}else addObject(type,{...opts,name:label});};grid.append(b);}
    }search.oninput=populate;populate();search.focus();
  }

  async function sourceGallery(category){
    const {body,finish,box}=modal(tr(category==='sfx'?'sourceSfx':'sourceStamps'),{dismissOutside:true,drawer:true});box.classList.add('ph3-gallery-modal');
    const search=inputControl('','search');search.placeholder=tr('searchStyles');search.setAttribute('aria-label',tr('searchStyles'));body.append(search);
    const grid=el('div','ph3-preset-grid');body.append(grid);
    function populate(){grid.replaceChildren();for(const asset of SOURCE_ASSETS.filter(a=>a.category===category&&JSON.stringify([a.name,a.labels]).toLowerCase().includes(search.value.toLowerCase()))){
      const label=asset.labels?.[doc.settings.locale]||asset.name;const url=new URL('./source-assets/'+asset.path,import.meta.url),b=el('button','ph3-preset-card'),img=el('img');b.setAttribute('aria-label',label);img.loading='lazy';img.src=url.href;img.alt=label;img.style.cssText='width:100%;height:110px;object-fit:contain';
      if(asset.mask){const preview=el('span','ph3-tinted-preview');preview.style.background=asset.fill||'#ffd42a';preview.style.maskImage=`url("${url.href}")`;preview.setAttribute('aria-label',label);b.append(preview);}else b.append(img);b.append(el('span','',label));
      b.onclick=async()=>{try{ensureLayerCapacity(doc);await withBusy(async()=>{const response=await fetch(url);if(!response.ok)throw Error('Asset unavailable');const info=await client.upload(await response.blob(),asset.name+'.png');const scale=Math.min(doc.width*.45/info.width,doc.height*.45/info.height,1);addObject('image',{asset:info.asset,name:label,w:info.width*scale,h:info.height*scale,colorize:!!asset.mask,tintColor:asset.fill||'#ffd42a',decoration:true});});finish();status(tr('loaded'));}catch(error){fail(error);}};grid.append(b);
    }}search.oninput=populate;populate();
  }
  async function fontBrowser(layer){
    const {body,finish,box}=modal(tr('fontList'));box.classList.add('ph3-font-browser');body.append(el('p','ph3-small',tr('fontLoading')));
    const fonts=await client.get('/fonts');if(!box.isConnected)return;body.replaceChildren();
    let category=doc.settings.locale==='ja'?'ja':'',favorites=[],recent=[];
    try{favorites=JSON.parse(localStorage.getItem('ph3-tool:favorite-fonts')||'[]');recent=JSON.parse(localStorage.getItem('ph3-tool:recent-fonts')||'[]');}catch{}
    if(!Array.isArray(favorites))favorites=[];if(!Array.isArray(recent))recent=[];const groups=groupFonts(fonts,layer.fontId),expanded=new Set();
    const store=()=>{try{localStorage.setItem('ph3-tool:favorite-fonts',JSON.stringify(favorites));localStorage.setItem('ph3-tool:recent-fonts',JSON.stringify(recent));}catch{}};
    const search=inputControl('','search');search.placeholder=tr('fontSearch');search.setAttribute('aria-label',tr('fontSearch'));
    const filters=el('div','ph3-font-filters'),count=el('div','ph3-section-title'),list=el('div','ph3-font-list');
    body.append(search,filters,el('p','ph3-small',tr('fontFavoriteHint')),count,list);
    const categories=[['favorite',tr('fontFavorites')],['recent',tr('fontRecent')],['ja','日本語'],['zh-hans','简体中文'],['zh-hant','繁體中文'],['ko','한국어'],['latin','Latin'],['other',tr('fontOther')],['',tr('allFonts')]];
    const observer=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){observer.unobserve(entry.target);const sample=entry.target,font=fonts.find(f=>f.id===sample.dataset.fontId);loadFont(font).then(family=>{if(sample.isConnected){sample.style.fontFamily=family;sample.textContent=font.sample||'Aa';sample.classList.add('loaded');}}).catch(()=>{if(sample.isConnected){sample.textContent=tr('fontPreviewFailed');sample.title=tr('fontPreviewFailed');}});}},{root:list,rootMargin:'60px'});
    const cleanup=()=>{observer.disconnect();removed.disconnect();};const removed=new MutationObserver(()=>{if(!box.isConnected)cleanup();});removed.observe(root,{childList:true});abort.signal.addEventListener('abort',cleanup,{once:true});
    function populate(){observer.disconnect();list.replaceChildren();filters.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.category===category)));
      const query=search.value.toLocaleLowerCase();let matches=groups.filter(g=>g.fonts.some(f=>(!category||category==='favorite'?(!category||favorites.includes(f.id)):category==='recent'?recent.includes(f.id):category==='other'?!['ja','zh-hans','zh-hant','ko','latin'].includes(f.language):f.language===category))&&g.fonts.some(f=>`${f.name} ${f.family} ${f.style}`.toLocaleLowerCase().includes(query)));
      if(category==='recent'){const rank=g=>Math.min(...g.fonts.map(f=>recent.includes(f.id)?recent.indexOf(f.id):Infinity));matches.sort((a,b)=>rank(a)-rank(b));}count.textContent=(categories.find(c=>c[0]===category)?.[1]||'')+' · '+matches.length;
      if(!matches.length)list.append(el('p','ph3-small',tr('fontNoMatches')));
      function makeRow(group,font,variant=false){const row=el('div','ph3-font-row'+(variant?' ph3-font-variant':'')),active=group.fonts.some(f=>favorites.includes(f.id)),star=el(variant?'span':'button','ph3-font-star',variant?'':active?'★':'☆');
        if(!variant){star.type='button';star.setAttribute('aria-label',tr('fontFavorites')+': '+group.family);star.setAttribute('aria-pressed',String(active));star.onclick=()=>{const ids=group.fonts.map(f=>f.id);favorites=active?favorites.filter(id=>!ids.includes(id)):[...new Set([...favorites,...ids])];store();populate();};}
        const pick=el('button','ph3-font-choice'),meta=el('span','ph3-font-meta'),sample=el('span','ph3-font-sample',tr('fontPreviewLoading'));pick.type='button';pick.setAttribute('aria-label',variant?font.name:group.family);meta.append(el('strong','',variant?(font.style||'Regular'):group.family),el('small','',`${font.language==='ja'?'JP':font.language_label}${font.supports_latin?'+EN':''} · ${font.style||'Regular'}`));sample.dataset.fontId=font.id;pick.append(meta,sample);row.append(star,pick);list.append(row);observer.observe(sample);
        if(!variant&&group.variants.length>1){const toggle=el('button','ph3-font-styles',expanded.has(group.key)?tr('fontHideStyles'):group.variants.length+' '+tr('fontStyles'));toggle.type='button';toggle.setAttribute('aria-label',group.family+': '+tr('fontStyles'));toggle.setAttribute('aria-expanded',String(expanded.has(group.key)));toggle.onclick=()=>{expanded.has(group.key)?expanded.delete(group.key):expanded.add(group.key);populate();};row.append(toggle);}
        pick.onclick=async()=>{if(busy)return;try{await withBusy(async()=>{const family=await loadFont(font);commit(d=>{const target=d.layers.find(x=>x.id===layer.id);if(target&&!target.locked)Object.assign(target,{font:family,fontId:font.id,fontName:font.name});});recent=[font.id,...recent.filter(id=>id!==font.id)].slice(0,30);store();});finish();status(tr('ready'));}catch(error){fail(error);}};
      }
      for(const group of matches){makeRow(group,group.primary);if(expanded.has(group.key))for(const font of group.variants)makeRow(group,font,true);}
    }
    for(const [id,label] of categories){const b=el('button','',label);b.type='button';b.dataset.category=id;b.onclick=()=>{category=id;populate();list.scrollTop=0;};filters.append(b);}search.oninput=populate;populate();search.focus();
  }
  async function mergeVisible(){
    if(!doc.layers.some(l=>l.visible))return;
    ensureLayerCapacity(doc);
    if(doc.layers.some(l=>l.visible&&l.locked))throw Error(tr('mergeLocked'));
    const snapshot=clone(doc),signature=JSON.stringify(doc.layers);
    await withBusy(async()=>{const image=await exportCanvas(snapshot,cache,{background:false}),info=await client.upload(await toBlob(image));if(signature!==JSON.stringify(doc.layers))throw Error(tr('processingConflict'));
      commit(d=>{for(const layer of d.layers)if(layer.visible)layer.visible=false;const merged=makeLayer('image',d.width,d.height,{asset:info.asset,name:tr('merged'),x:0,y:0,w:d.width,h:d.height});d.layers.push(merged);selected=merged.id;});
    });
  }
  function selectedImage(){let l=doc.layers.find(x=>x.id===selected&&x.type==='image');if(!l){const images=doc.layers.filter(x=>x.type==='image');if(images.length===1){l=images[0];selected=l.id;renderLayers();renderProperties();draw();}}if(!l)throw Error(tr('requireImage'));return l;}
  async function applyLayerMask(){const l=selectedImage();if(l.locked)throw Error(tr('locked'));if(!maskBounds(selection,doc.width,doc.height))throw Error(tr('requireSelection'));
    await withBusy(async()=>{const source=await cache.get(l.asset),out=layerSelectionMask(l,selection,doc.width,doc.height,source.width,source.height),result=await client.upload(await toBlob(out));commit(d=>d.layers.find(x=>x.id===l.id).mask_asset=result.asset);});status(tr('ready'));
  }
  function renderLayers(){
    layerList.replaceChildren();for(const l of [...doc.layers].reverse()){
      const row=el('div','ph3-layer'+(l.id===selected?' active':''));row.dataset.layerId=l.id;row.draggable=!l.locked;row.title=tr('layerOrderHelp');
      row.ondragstart=e=>{if(busy||l.locked){e.preventDefault();return;}e.dataTransfer.setData('application/x-ph3-layer',l.id);e.dataTransfer.effectAllowed='move';};
      row.ondragover=e=>{if(![...e.dataTransfer.types].includes('application/x-ph3-layer'))return;e.preventDefault();e.stopPropagation();const above=e.clientY<row.getBoundingClientRect().top+row.clientHeight/2;row.classList.toggle('drop-above',above);row.classList.toggle('drop-below',!above);};
      row.ondragleave=row.ondragend=()=>row.classList.remove('drop-above','drop-below');
      row.ondrop=e=>{const id=e.dataTransfer.getData('application/x-ph3-layer');if(!id)return;e.preventDefault();e.stopPropagation();row.classList.remove('drop-above','drop-below');if(busy||id===l.id||!doc.layers.some(x=>x.id===id&&!x.locked))return;const above=e.clientY<row.getBoundingClientRect().top+row.clientHeight/2;commit(d=>{moveLayerRelative(d.layers,id,l.id,above);selected=id;});};
      const vis=el('button','',l.visible?'●':'○');vis.title=tr('visible');vis.onclick=()=>{if(!busy)commit(d=>d.layers.find(x=>x.id===l.id).visible=!l.visible);};
      const lock=el('button','',l.locked?'■':'□');lock.title=tr('locked');lock.onclick=()=>{if(!busy)commit(d=>d.layers.find(x=>x.id===l.id).locked=!l.locked,{canvasChange:false});};
      const name=el('button','ph3-layer-title',l.name||l.type);name.title=l.name||l.type;name.onclick=()=>{selected=l.id;renderLayers();renderProperties();draw();viewport.focus({preventScroll:true});};
      const thumbnail=layerThumbnail(l,rasters,64,48);thumbnail.className='ph3-layer-thumbnail';thumbnail.setAttribute('aria-hidden','true');row.append(vis,lock,thumbnail,name);layerList.append(row);
    }
  }
  function inputControl(value,type='text'){const input=el('input');input.type=type;if(type==='checkbox')input.checked=!!value;else input.value=value??'';return input;}
  function field(parent,key,control,wide=false){control.dataset.i18nLabel=key;control.setAttribute('aria-label',tr(key));const label=el('label','ph3-field'+(wide?' wide':'')),caption=el('span','',tr(key));caption.dataset.i18n=key;label.dataset.property=key;label.append(caption,control);parent.append(label);return control;}
  function numeric(parent,key,value,fn,min,max,step=1){const input=inputControl(value,'number');input.min=min;input.max=max;input.step=step;input.onchange=()=>{if(busy)return;const v=Number(input.value);if(!Number.isFinite(v)||v<min||v>max){input.value=value;return;}fn(v);};return field(parent,key,input);}
  function segmentedProperty(parent,key,title,choices,current,onChange){
    const row=el('div','ph3-field wide');row.dataset.property=key;
    const caption=labelElement('span','',title),group=el('div','ph3-text-segments');group.setAttribute('role','group');group.setAttribute('aria-label',tr(title));group.dataset.i18nLabel=title;
    for(const [value,label] of choices){const b=el('button','',tr(label));b.type='button';b.dataset.i18n=label;b.setAttribute('aria-label',tr(label));b.setAttribute('aria-pressed',String(value===current));b.onclick=()=>{if(!busy&&value!==current)onChange(value);};group.append(b);}row.append(caption,group);parent.append(row);
  }
  function renderProperties(){
    const previousLayout=props.querySelector('details.ph3-text-layout'),layoutOpen=previousLayout?.dataset.layerId===selected&&previousLayout.open;
    const previousAI=props.querySelector('details.ph3-ai-lettering'),aiOpen=previousAI?.dataset.layerId===selected&&previousAI.open;
    const previousTransform=props.querySelector('details.ph3-transform'),transformOpen=previousTransform?.dataset.layerId===selected&&previousTransform.open;
    const emphasisOpen=new Set([...props.querySelectorAll('details[data-emphasis-section]')].filter(n=>n.dataset.layerId===selected&&n.open).map(n=>n.dataset.emphasisSection));
    props.replaceChildren(panelDetach('properties'));const l=doc.layers.find(x=>x.id===selected);
    if(!l){props.append(el('p','ph3-small',tr('inspect')));return;}
    if(l.locked){props.append(el('p','ph3-small',tr('lockedHint')));return;}
    const change=(key,value)=>commit(d=>{const layer=d.layers.find(x=>x.id===l.id);layer[key]=value;if(layer.type==='text'&&['w','h'].includes(key))layer.autoFit=false;});
    function layoutSlider(key,value,min,max,label=key,step=1,parent=props,rangeBounds=null){
      let before=null;
      const preview=v=>{if(!before){before=clone(doc);doc.canvas_revision++;}renderToken++;l[key]=v;if(l.type==='text'&&['w','h'].includes(key))l.autoFit=false;if(l.type==='text'&&l.autoFit!==false&&!['opacity','rotation','x','y','w','h'].includes(key))fitTextBox(textMeasure,l);draw();};
      const finish=v=>{if(!before){change(key,v);return;}const original=before;before=null;l[key]=v;if(l.type==='text'&&['w','h'].includes(key))l.autoFit=false;if(l.type==='text'&&l.autoFit!==false&&!['opacity','rotation','x','y','w','h'].includes(key))fitTextBox(textMeasure,l);if(JSON.stringify(original.layers)!==JSON.stringify(doc.layers))history.record(original);stashDraft();renderAll();};
      sliderField(parent,label,value,finish,min,max,step,preview,rangeBounds);
    }
    function colorProperty(key,label=key,value=l[key]?.slice(0,7)||'#111111',imageTint=false){
      const control=inputControl(value,'color');let before=null;
      const read=()=>/^#[0-9a-f]{6}$/i.test(control.value)?control.value:null;
      const apply=v=>{l[key]=v;if(imageTint){l.colorize=true;const toggle=props.querySelector('input[data-i18n-label="colorize"]');if(toggle)toggle.checked=true;}};
      const redrawTint=async token=>{try{const prepared=await cache.prepare(clone(doc));if(token!==renderToken||closed)return;rasters=prepared;draw();}catch(e){if(token===renderToken&&!closed)fail(e);}};
      const syncSwatches=()=>{const row=control.closest('.ph3-field')?.nextElementSibling;if(row?.classList.contains('ph3-color-swatches'))for(const b of row.children)b.setAttribute('aria-pressed',String(b.getAttribute('aria-label').toLowerCase()===control.value.toLowerCase()));};
      control.oninput=()=>{const v=read();if(busy||!v||!before&&l[key]===v&&(!imageTint||l.colorize))return;if(!before){before=clone(doc);doc.canvas_revision++;}const token=++renderToken;apply(v);syncSwatches();if(imageTint)redrawTint(token);else draw();};
      control.onchange=()=>{const v=read();if(busy||!v)return;if(!before){if(l[key]!==v||imageTint&&!l.colorize){if(imageTint)commit(()=>apply(v));else change(key,v);}return;}const original=before;before=null;apply(v);if(JSON.stringify(original.layers)!==JSON.stringify(doc.layers))history.record(original);stashDraft();renderAll();};
      field(props,label,control);return control;
    }
    const transform=el('details','ph3-processing-details ph3-transform');transform.dataset.layerId=l.id;transform.open=!!transformOpen;transform.append(el('summary','',tr('transform')));
    layoutSlider('opacity',l.opacity,0,1,'opacity',.01);
    const name=inputControl(l.name);name.onchange=()=>change('name',name.value.slice(0,200));field(props,'name',name);
    for(const [key,label,extent]of [['x','X',doc.width],['y','Y',doc.height],['w','W',doc.width],['h','H',doc.height]]){
      const position=key==='x'||key==='y',min=position?-32768:1,rangeMin=position?Math.min(-extent,Math.floor(l[key])):1,rangeMax=Math.min(32768,Math.max(position?extent:extent*2,Math.ceil(l[key])));
      layoutSlider(key,Math.round(l[key]*100)/100,min,32768,label,1,transform,[rangeMin,rangeMax]);
    }
    layoutSlider('rotation',l.rotation,-36000,36000,'rotation',1,transform,[-180,180,true]);
    if(l.type==='image'){
      const tint=inputControl(l.colorize,'checkbox');tint.onchange=()=>change('colorize',tint.checked);field(props,'colorize',tint);
      colorProperty('tintColor','tintColor',l.tintColor||'#ffd42a',true);
      colorSwatches(props,l.tintColor||'#ffd42a',value=>commit(d=>Object.assign(d.layers.find(x=>x.id===l.id),{tintColor:value,colorize:true})));
      props.append(button('maskLayer',applyLayerMask),button('clearLayerMask',()=>change('mask_asset',null)));
      if(l.generation){const info=el('details','ph3-generation-info');info.append(el('summary','',tr('generationInfo')),el('p','ph3-small',`P-H3 · Seed ${l.generation.seed}\n${l.generation.prompt}`));props.append(info);}
    }else{
      if(['text','sfx','bubble'].includes(l.type)){
        const txt=el('textarea');txt.value=l.text||'';txt.onchange=()=>change('text',txt.value.slice(0,10000));field(props,'text',txt,true);
        const font=el('button','ph3-font-current');font.type='button';const auto=!l.fontId&&!l.fontName&&(!l.font||l.font==='\"Yu Gothic\", \"Meiryo\", sans-serif'||l.font==='sans-serif');font.append(el('span','',auto?tr('fontAuto'):l.fontName||l.font.split(',')[0].replace(/[\"']/g,'')),el('small','',auto?'AUTO':'▾'));font.title=tr('chooseFont');font.onclick=()=>{if(!busy)fontBrowser(l).catch(fail);};field(props,'font',font);
        layoutSlider('fontSize',l.fontSize,4,2048);
        const styleRow=el('div','ph3-field wide');styleRow.dataset.property='textDecorations';styleRow.append(labelElement('span','','textDecorations'));
        const styleGroup=el('div','ph3-text-segments ph3-text-style-buttons');styleGroup.setAttribute('role','group');styleGroup.setAttribute('aria-label',tr('textDecorations'));styleGroup.dataset.i18nLabel='textDecorations';
        for(const [key,letter] of [['bold','B'],['italic','I'],['underline','U'],['strikethrough','S']]){const b=el('button');b.type='button';b.dataset.i18n=key;b.setAttribute('aria-label',tr(key));b.setAttribute('aria-pressed',String(!!l[key]));const mark=el('span','ph3-style-letter '+key,letter);mark.setAttribute('aria-hidden','true');b.append(mark,el('span','ph3-button-label',tr(key)));b.onclick=()=>{if(!busy)change(key,!l[key]);};styleGroup.append(b);}styleRow.append(styleGroup);props.append(styleRow);
      }
      if(['text','sfx','bubble'].includes(l.type)){
        segmentedProperty(props,'vertical','writingDirection',[[false,'horizontalWriting'],[true,'vertical']],!!l.vertical,v=>change('vertical',v));
        segmentedProperty(props,'align','align',[['left','textLeft'],['center','textCenter'],['right','textRight']],l.align||'left',v=>change('align',v));
        layoutSlider('tracking',l.tracking||0,-200,500);
        layoutSlider('fontScaleX',l.fontScaleX||100,10,500);
        layoutSlider('fontScaleY',l.fontScaleY||100,10,500);
        if(l.vertical){const writing=optionsSelect([['vertical-rl',tr('verticalRL')],['vertical-lr',tr('verticalLR')]],l.writing||'vertical-rl');writing.onchange=()=>change('writing',writing.value);field(props,'writing',writing);}
      }
      if(l.type==='text'){const auto=inputControl(l.autoFit!==false,'checkbox');auto.onchange=()=>change('autoFit',auto.checked);field(props,'autoFit',auto);props.append(button('fitTextBox',()=>commit(d=>fitTextBox(textMeasure,d.layers.find(x=>x.id===l.id)))));}
      if(['text','sfx'].includes(l.type))props.append(button('textStyles',()=>presetModal('text',TEXT_STYLES,true)));
      if(l.type==='bubble')colorProperty('textFill','textColor');
      for(const key of (l.type==='speed'?['fill']:l.type==='frame'?['stroke']:['fill','stroke'])){colorProperty(key,['text','sfx'].includes(l.type)?(key==='fill'?'textColor':'outlineColor'):key);if(['text','sfx'].includes(l.type)||key==='fill'||l.type==='frame')colorSwatches(props,l[key],value=>change(key,value));}
      if(['text','sfx','bubble','frame'].includes(l.type))layoutSlider('lineWidth',l.lineWidth,0,256,['text','sfx'].includes(l.type)?'outlineWidth':'lineWidth');else if(l.type!=='speed')numeric(props,'lineWidth',l.lineWidth,v=>change('lineWidth',v),0,256);
      if(l.type==='bubble'){const tail=optionsSelect([['pointed',tr('tailPointed')],['dots',tr('tailDots')],['none',tr('tailNone')]],l.tailStyle||'pointed');tail.onchange=()=>change('tailStyle',tail.value);field(props,'tailStyle',tail);const outline=optionsSelect([['solid',tr('solid')],['double',tr('double')]],l.outlineStyle||'solid');outline.onchange=()=>change('outlineStyle',outline.value);field(props,'outlineStyle',outline);layoutSlider('asymmetry',l.asymmetry??0,0,100);layoutSlider('tailX',l.tailX,-1,2,'tailX',.05);layoutSlider('tailY',l.tailY,-1,3,'tailY',.05);}
      if(l.type==='frame'){
        const presets=optionsSelect(FRAMES.map(p=>[p[0],p[doc.settings.locale==='en'?2:1]]),l.frame);
        presets.onchange=()=>commit(d=>{const target=d.layers.find(x=>x.id===l.id);Object.assign(target,presetOptions('frame',FRAMES.find(p=>p[0]===presets.value),d.width,d.height));});field(props,'preset',presets);
        layoutSlider('innerWidth',l.innerWidth||0,0,128);
        colorProperty('innerColor');
      }
      if(l.type==='bubble'){const presets=optionsSelect(BUBBLES.map(p=>[p[0],p[doc.settings.locale==='en'?2:1]]),l.shape);presets.onchange=()=>commit(d=>{const target=d.layers.find(x=>x.id===l.id);const item=BUBBLES.find(p=>p[0]===presets.value);Object.assign(target,{shape:item[0],...(item[3]||{})});});field(props,'preset',presets);}
      if(l.type==='speed'){
        const presets=optionsSelect(SPEEDS.map(p=>[p[0],p[doc.settings.locale==='en'?2:1]]),l.speedPreset||'center');
        presets.onchange=()=>commit(d=>Object.assign(d.layers.find(x=>x.id===l.id),SPEEDS.find(p=>p[0]===presets.value)[3]));field(props,'preset',presets);
        for(const [key,label,min,max,step,fallback]of [['lines','lineCount',20,400,1,180],['gap','gap',.03,.65,.01,.5],['gapY','gapY',.03,.65,.01,l.gap??.5],['speedWidth','speedWidth',.0005,.035,.0005,(l.lineWidth||3)/Math.min(l.w,l.h)],['lineLength','lineLength',.15,1,.01,1],['taper','taper',0,1,.01,1]])layoutSlider(key,l[key]??fallback,min,max,label,step);
        const random=el('details','ph3-processing-details');random.append(el('summary','',tr('randomness')));random.dataset.emphasisSection='random';random.dataset.layerId=l.id;random.open=emphasisOpen.has('random');props.append(random);
        for(const[key,fallback]of [['lengthRandom',0],['innerRandom',.5],['widthRandom',.48],['spacingRandom',.38]])layoutSlider(key,l[key]??fallback,0,1,key,.01,random);
        numeric(random,'seed',l.seed,v=>change('seed',v),0,4294967295);
        const position=el('details','ph3-processing-details');position.append(el('summary','',tr('centerPosition')));position.dataset.emphasisSection='position';position.dataset.layerId=l.id;position.open=emphasisOpen.has('position');props.append(position);
        for(const key of ['centerX','centerY'])layoutSlider(key,l[key]??.5,-.5,1.5,key,.01,position);
      }
    }
    props.append(transform);
    if(l.type==='text'){
      // Reuse the existing controls and listeners; keep color swatches with their field.
      const fields=new Map([...props.children].filter(n=>n.dataset.property).map(n=>[n.dataset.property,[n,...(n.nextElementSibling?.classList.contains('ph3-color-swatches')?[n.nextElementSibling]:[])]]));
      const buttons=new Map([...props.children].filter(n=>n.tagName==='BUTTON').map(n=>[n.dataset.i18n,[n]]));
      for(const key of ['text','font','fontSize','textColor','outlineColor','outlineWidth','vertical','writing','align','autoFit','fitTextBox','textDecorations','textStyles','tracking','fontScaleX','fontScaleY','opacity','name']){
        const nodes=fields.get(key)||buttons.get(key);if(nodes)props.append(...nodes);
      }
      const layout=el('details','ph3-processing-details ph3-text-layout');layout.dataset.layerId=l.id;layout.open=!!layoutOpen;layout.append(labelElement('summary','','textLayout'));
      for(const key of ['tracking','fontScaleX','fontScaleY'])layout.append(...fields.get(key));
      props.insertBefore(layout,fields.get('opacity')[0]);props.append(transform);
      const ai=el('details','ph3-processing-details ph3-ai-lettering');ai.dataset.layerId=l.id;ai.open=!!aiOpen;ai.append(labelElement('summary','','aiLettering'),el('p','ph3-small',tr('letteringIntro')),button('letteringOpen',()=>letteringModal(l).catch(fail)));props.insertBefore(ai,fields.get('opacity')[0]);
    }
  }
  function colorSwatches(parent,current,onChange){const row=el('div','ph3-color-swatches');row.setAttribute('role','group');row.setAttribute('aria-label',tr('colorSwatches'));
    for(const color of ['#111111','#ffffff','#ffd42a','#ef4080','#e74747','#ff982c','#b4e82a','#59bb82','#54c8de','#387cde','#7757cf','#ba65b2']){const b=el('button');b.type='button';b.style.background=color;b.title=color;b.setAttribute('aria-label',color);b.setAttribute('aria-pressed',String(current===color));b.onclick=()=>{if(!busy)onChange(color);};row.append(b);}parent.append(row);
  }
  function sliderField(parent,key,value,onChange,min,max,step,onPreview=null,rangeBounds=null){const row=el('div','ph3-range-control'),range=inputControl(value,'range'),number=inputControl(value,'number');for(const c of [range,number]){c.min=min;c.max=max;c.step=step;c.value=value;c.setAttribute('aria-label',tr(key)+(c===range?' slider':''));}if(rangeBounds){range.min=rangeBounds[0];range.max=rangeBounds[1];range.value=rangeBounds[2]?((Number(value)+180)%360+360)%360-180:value;}range.oninput=()=>{number.value=range.value;if(!busy&&onPreview)onPreview(Number(range.value));};for(const c of [range,number])c.onchange=()=>{const v=Number(c.value);if(!busy&&Number.isFinite(v)&&v>=min&&v<=max)onChange(v);};row.append(range,number);field(parent,key,row);}
  function panelDetach(key){const row=el('div','ph3-panel-detach');row.append(labelElement('strong','',key==='candidates'?'historyTab':key),button({properties:'floatProperties',layers:'floatLayers',candidates:'floatHistory'}[key],()=>toggleFloat(key)));return row;}
  function panelPrefs(key){try{return JSON.parse(localStorage.getItem('ph3-tool:panel:'+key)||'{}')||{};}catch{return {};}}
  function savePanel(key,value){try{localStorage.setItem('ph3-tool:panel:'+key,JSON.stringify(value));}catch{}}
  function toggleFloat(key,visible=true){if(floating.has(key)){const entry=floating.get(key);entry.frame.hidden=!visible;entry.constrain();entry.save();return;}
    const panel=panels[key],frame=el('section','ph3-floating'),header=el('header','ph3-floating-header'),title=labelElement('strong','',key),dock=button('dockPanel',()=>restore()),close=button('close',()=>{frame.hidden=true;save();});close.replaceChildren(document.createTextNode('×'));
    frame.setAttribute('role','region');frame.dataset.i18nLabel=key;frame.setAttribute('aria-label',tr(key));header.append(title,dock,close);frame.append(header,panel);root.append(frame);panel.hidden=false;
    const saved=panelPrefs(key),r=root.getBoundingClientRect(),width=Math.min(Number(saved.width)||300,r.width-24),height=Math.min(Number(saved.height)||(key==='layers'?290:480),r.height-110);
    frame.style.width=width+'px';frame.style.height=height+'px';frame.style.left=Math.max(6,Math.min(r.width-width-6,Number.isFinite(saved.left)?saved.left:r.width-width-(key==='properties'?width+24:12)))+'px';frame.style.top=Math.max(66,Math.min(r.height-height-20,Number.isFinite(saved.top)?saved.top:key==='layers'?r.height-height-25:76))+'px';frame.hidden=!visible;
    const save=()=>{if(!frame.hidden)Object.assign(saved,{left:frame.offsetLeft,top:frame.offsetTop,width:frame.offsetWidth,height:frame.offsetHeight});savePanel(key,{...saved,docked:false,visible:!frame.hidden});};
    const constrain=()=>{if(frame.hidden)return;frame.style.left=Math.max(0,Math.min(root.clientWidth-frame.offsetWidth,frame.offsetLeft))+'px';frame.style.top=Math.max(0,Math.min(root.clientHeight-frame.offsetHeight-6,frame.offsetTop))+'px';};
    const observer=new ResizeObserver(()=>{if(!frame.hidden){constrain();save();}});observer.observe(frame);observer.observe(root);abort.signal.addEventListener('abort',()=>observer.disconnect(),{once:true});
    const restore=()=>{observer.disconnect();right.append(panel);frame.remove();floating.delete(key);savePanel(key,{...saved,docked:true,visible:true});showTab(key);};floating.set(key,{dock:restore,frame,save,constrain});save();
    let drag=null;header.tabIndex=0;header.dataset.help='dragPanel';header.title=tr('dragPanel');
    header.onpointerdown=e=>{if(e.button!==0||e.target.closest('button'))return;drag={x:e.clientX,y:e.clientY,left:frame.offsetLeft,top:frame.offsetTop};header.setPointerCapture(e.pointerId);};
    header.onpointermove=e=>{if(!drag)return;frame.style.left=Math.max(0,Math.min(root.clientWidth-frame.offsetWidth,drag.left+e.clientX-drag.x))+'px';frame.style.top=Math.max(0,Math.min(root.clientHeight-44,drag.top+e.clientY-drag.y))+'px';};
    header.onpointerup=header.onpointercancel=()=>{drag=null;save();};
    header.onkeydown=e=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)||e.target!==header)return;e.preventDefault();e.stopPropagation();frame.style.left=Math.max(0,Math.min(root.clientWidth-frame.offsetWidth,frame.offsetLeft+({ArrowLeft:-10,ArrowRight:10}[e.key]||0)))+'px';frame.style.top=Math.max(0,Math.min(root.clientHeight-44,frame.offsetTop+({ArrowUp:-10,ArrowDown:10}[e.key]||0)))+'px';save();};
  }
  function layerAction(action,inPlace=false){if(action==='duplicate')ensureLayerCapacity(doc);const l=doc.layers.find(x=>x.id===selected);if(!l)return;if(l.locked&&action!=='duplicate'){status(tr('lockedHint'),true);return;}
    commit(d=>{const layer=d.layers.find(x=>x.id===selected);if(action==='duplicate'){const copy={...clone(layer),id:uid(),name:layer.name+' copy',x:layer.x+(inPlace?0:10),y:layer.y+(inPlace?0:10)};d.layers.push(copy);selected=copy.id;}
      if(action==='remove'){d.layers=d.layers.filter(x=>x.id!==selected);selected=null;}
      if(action==='up'||action==='down')reorder(d.layers,selected,action==='up'?1:-1);
    });
  }
  let modalMaximized=false;
  try{modalMaximized=localStorage.getItem('ph3-tool:modal-maximized')==='true';}catch{}
  function modal(title,{dismissOutside=false,drawer:side=false,maximizable=true}={}){
    if(side)drawer?.();
    const overlay=el('div','ph3-overlay'),box=el('section','ph3-modal'),heading=el('h2','',title),body=el('div','ph3-modal-body'),actions=el('div','ph3-modal-actions');box.setAttribute('role','dialog');box.setAttribute('aria-modal','true');box.setAttribute('aria-label',title);
    const prior=document.activeElement;let ended=false;const finish=()=>{if(ended)return;ended=true;box.dispatchEvent(new Event('ph3-close'));overlay.remove();if(drawer===finish)drawer=null;if(prior?.isConnected)prior.focus();};overlay.ph3Finish=finish;
    let outsideDown=false;
    overlay.addEventListener('pointerdown',e=>outsideDown=e.target===overlay);
    overlay.addEventListener('click',e=>{if(dismissOutside&&outsideDown&&e.target===overlay&&!busy)finish();outsideDown=false;});
    const cancel=el('button','',tr('close'));cancel.onclick=finish;actions.append(cancel);const header=el('header','ph3-modal-header'),topClose=el('button','',tr('close'));topClose.setAttribute('aria-label',tr('close'));topClose.onclick=finish;header.append(heading);if(!maximizable)box.style.resize='none';if(!side&&maximizable){const maximize=el('button','',tr('maximize'));maximize.setAttribute('aria-label',tr('maximize'));const setMaximized=active=>{box.classList.toggle('ph3-maximized',active);maximize.textContent=tr(active?'restoreWindow':'maximize');maximize.setAttribute('aria-label',maximize.textContent);maximize.setAttribute('aria-pressed',String(active));};setMaximized(modalMaximized);maximize.onclick=()=>{modalMaximized=!box.classList.contains('ph3-maximized');setMaximized(modalMaximized);try{localStorage.setItem('ph3-tool:modal-maximized',String(modalMaximized));}catch{}};header.append(maximize);header.ondblclick=e=>{if(e.target===header||e.target===heading)maximize.click();};const observer=new ResizeObserver(()=>box.style.setProperty('--ph3-dialog-height',box.getBoundingClientRect().height+'px'));observer.observe(box);box.addEventListener('ph3-close',()=>observer.disconnect(),{once:true});}header.append(topClose);box.append(header,body,actions);
    if(side){overlay.classList.add('ph3-drawer-overlay');box.classList.add('ph3-drawer');drawer=finish;}overlay.append(box);root.append(overlay);box.tabIndex=-1;box.focus();
    overlay.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();finish();}if(e.key==='Tab'){const all=[...box.querySelectorAll('button,input,select,textarea,[tabindex="0"]')].filter(n=>!n.disabled&&n.getClientRects().length);if(!all.length){e.preventDefault();return;}if(e.shiftKey&&(document.activeElement===all[0]||document.activeElement===box)){e.preventDefault();all.at(-1).focus();}else if(!e.shiftKey&&document.activeElement===all.at(-1)){e.preventDefault();all[0].focus();}}});
    return{body,actions,finish,box};
  }
  function optionsSelect(options,value){const select=el('select');for(const [id,label]of options){const option=el('option','',label);option.value=id;select.append(option);}select.value=value;return select;}
  function modelSummary(){const state=ph3ModelReadiness(doc.settings,catalog||{}),missing=catalog?.missing_nodes||[];return missing.length?tr('missingNodes')+missing.join(', '):state.ready?tr('modelReady'):tr('missingModels')+state.missing.join(', ');}
  async function settings(){
    if(!catalog)catalog=await client.get('/capabilities');const draft={mouse_undo:true,ph3_lora_strength:1,...clone(doc.settings)},{body,actions,finish,box}=modal(tr('settings'));
    draft.extra_loras=Array.from({length:2},(_,i)=>({enabled:false,name:'',strength:1,...draft.extra_loras?.[i]}));
    const originalCanvas={background:doc.background,transparent:doc.transparent};let applied=false;
    box.addEventListener('ph3-close',()=>{if(!applied){Object.assign(doc,originalCanvas);renderToken++;draw();}});
    body.append(el('h3','',tr('canvas')));const grid=el('div','ph3-grid');body.append(grid);
    const title=inputControl(doc.title);field(grid,'title',title);const transparent=inputControl(doc.transparent,'checkbox');field(grid,'transparent',transparent);body.append(el('p','ph3-small',tr('transparentHelp')));
    const w=inputControl(doc.width,'number'),h=inputControl(doc.height,'number');field(grid,'width',w);field(grid,'height',h);const background=inputControl(doc.background,'color');field(grid,'background',background);
    const previewBackground=()=>{doc.background=background.value;doc.transparent=transparent.checked;renderToken++;draw();};background.oninput=background.onchange=previewBackground;transparent.onchange=previewBackground;
    body.append(el('h3','',tr('general')));const general=el('div','ph3-grid');body.append(general);
    function control(key,type,values=null){const c=values?optionsSelect(values,draft[key]):inputControl(draft[key],type);c.onchange=()=>draft[key]=type==='checkbox'?c.checked:type==='number'?Number(c.value):c.value;field(general,key,c);return c;}
    control('locale','text',[['ja','日本語'],['en','English']]);general.lastChild.firstChild.textContent=tr('language');
    control('theme','text',[['dark',tr('dark')],['light',tr('light')]]);
    control('auto_apply','checkbox');general.lastChild.firstChild.textContent=tr('autoApply');control('include_text','checkbox');general.lastChild.firstChild.textContent=tr('includeText');
    control('mouse_undo','checkbox');general.lastChild.firstChild.textContent=tr('mouseUndo');
    control('history_limit','number');general.lastChild.firstChild.textContent=tr('historyLimit');
    control('export_format','text',[['png','PNG'],['webp','WebP'],['jpeg','JPEG']]);general.lastChild.firstChild.textContent=tr('format');
    const q=control('export_quality','number');q.min=.1;q.max=1;q.step=.01;general.lastChild.firstChild.textContent=tr('quality');
    for(const [key,label,min,max,step]of [['context','context',0,1,.05],['feather','feather',0,64,1],['brush','brushSize',1,512,1],['max_megapixels','megapixels',.25,8.5,.25]]){const c=control(key,'number');c.min=min;c.max=max;c.step=step;general.lastChild.firstChild.textContent=tr(label);}
    body.append(el('h3','',tr('engine')),el('p','ph3-small',tr('modelWarning')),el('p','ph3-model-status',modelSummary()));
    const fields=[['unet_name','unet','diffusion_models'],['clip_name','clip','text_encoders'],['vae_name','vae','vae'],['lora_name','lora','loras'],['enhancer_name','upsampler','text_encoders']];
    for(const[key,label,category]of fields){const choices=[['',tr('choose')],...(catalog[category]||[]).map(x=>[x,x])];const select=optionsSelect(choices,draft[key]);select.onchange=()=>draft[key]=select.value;field(body,label,select,true);}
    const primaryStrength=el('div','ph3-range-control'),primaryRange=inputControl(draft.ph3_lora_strength,'range'),primaryNumber=inputControl(draft.ph3_lora_strength,'number');
    for(const c of [primaryRange,primaryNumber]){c.min=-10;c.max=10;c.step=.05;c.setAttribute('aria-label',tr('ph3LoraStrength')+(c===primaryRange?' slider':''));}
    primaryRange.oninput=()=>{primaryNumber.value=primaryRange.value;draft.ph3_lora_strength=Number(primaryRange.value);};
    primaryNumber.oninput=()=>{const v=primaryNumber.value===''?NaN:Number(primaryNumber.value);draft.ph3_lora_strength=v;if(Number.isFinite(v)&&v>=-10&&v<=10)primaryRange.value=v;};
    primaryStrength.append(primaryRange,primaryNumber);field(body,'ph3LoraStrength',primaryStrength);
    body.append(el('p','ph3-small',tr('extraLoraHelp')));
    for(let i=0;i<2;i++){
      const slot=draft.extra_loras[i],group=el('fieldset','ph3-extra-lora');group.append(labelElement('legend','',i?'extraLora2':'extraLora1'));body.append(group);
      const enabled=inputControl(slot.enabled,'checkbox');enabled.setAttribute('role','switch');field(group,'extraLoraEnabled',enabled);
      const names=[['',tr('noExtraLora')],...(catalog.loras||[]).map(x=>[x,x])];if(slot.name&&!names.some(x=>x[0]===slot.name))names.push([slot.name,slot.name]);
      const file=optionsSelect(names,slot.name);file.onchange=()=>slot.name=file.value;field(group,'extraLoraFile',file,true);
      sliderField(group,'loraStrength',slot.strength,v=>slot.strength=v,-10,10,.05);
      const sync=()=>{slot.enabled=enabled.checked;file.disabled=!slot.enabled;for(const c of group.querySelectorAll('.ph3-range-control input'))c.disabled=!slot.enabled;};enabled.onchange=sync;sync();
    }
    const sampler=optionsSelect((catalog.samplers||[]).map(x=>[x,x]),draft.sampler);sampler.onchange=()=>draft.sampler=sampler.value;field(body,'sampler',sampler);
    const sigmas=el('textarea');sigmas.value=draft.sigmas;sigmas.onchange=()=>draft.sigmas=sigmas.value;field(body,'sigmas',sigmas,true);
    const seed=inputControl(draft.seed);seed.onchange=()=>draft.seed=seed.value;field(body,'seed',seed);
    const random=inputControl(draft.random_seed,'checkbox');random.onchange=()=>draft.random_seed=random.checked;field(body,'randomSeed',random);
    body.append(el('p','ph3-small',catalog.cutout?.onnx_available&&catalog.cutout?.model_available?'ISNet: local model ready':tr('cutoutUnavailable')));
    const ok=el('button','primary',tr('ok'));ok.onclick=async()=>{try{
      const width=Number(w.value),height=Number(h.value);checkSize(width,height);draft.seed=safeSeed(draft.seed);draft.history_limit=Math.round(Math.min(100,Math.max(5,draft.history_limit||40)));
      for(const [key,min,max]of [['context',0,1],['feather',0,64],['brush',1,512],['max_megapixels',.25,8.5],['export_quality',.1,1]])if(!Number.isFinite(draft[key])||draft[key]<min||draft[key]>max)throw Error(`Invalid ${key}`);
      if(!Number.isFinite(draft.ph3_lora_strength)||draft.ph3_lora_strength<-10||draft.ph3_lora_strength>10)throw Error(tr('invalidLoraStrength'));
      for(const slot of draft.extra_loras){if(!Number.isFinite(slot.strength)||slot.strength<-10||slot.strength>10)throw Error(tr('invalidLoraStrength'));if(slot.enabled&&slot.name&&slot.strength!==0&&!(catalog.loras||[]).includes(slot.name))throw Error(tr('missingExtraLora'));}
      const canvasBackground=background.value,canvasTransparent=transparent.checked;Object.assign(doc,originalCanvas);
      commit(d=>{if(d.width!==width||d.height!==height){d.width=width;d.height=height;d.selection_asset=null;selection=new Uint8ClampedArray(width*height);invalidate();}d.title=title.value.slice(0,200)||'Untitled';d.settings=draft;d.transparent=canvasTransparent;d.background=canvasBackground;});
      history.limit=draft.history_limit;applied=true;finish();localize();syncPrompt();fit();status(tr('ready'));

    }catch(e){fail(e);}};actions.prepend(ok);
  }
  async function processModal(action){
    const layer=selectedImage();if(layer.locked)throw Error(tr('locked'));
    const baseline=JSON.stringify(layer),project=record.id,snapshot=clone(doc),mask=new Uint8ClampedArray(selection);
    await openProcessing({action,onManga:()=>mangaModal(false),layer:clone(layer),doc:snapshot,cache,client,selection:mask,modal,tr,catalog,onError:fail,
      onApply:async(info,meta)=>{
        if(record.id!==project||JSON.stringify(doc.layers.find(l=>l.id===layer.id))!==baseline)throw Error(tr('processingConflict'));
        ensureLayerCapacity(doc);
        commit(d=>{const prior=d.layers.find(x=>x.id===layer.id),index=d.layers.indexOf(prior);prior.visible=false;
          const next={...clone(prior),id:uid(),asset:info.asset,mask_asset:null,visible:true,name:prior.name+' · '+tr(action==='comic'?'comic':'cutout'),processing:{action:meta.action,preset:meta.preset,source_asset:meta.source_asset,settings:meta.settings}};
          d.layers.splice(index+1,0,next);selected=next.id;Object.assign(d.settings,meta.settings);if(meta.transparent)d.transparent=true;
        });await renderAll();status(tr('ready'));
      }});
  }
  const mangaNames=()=>Object.fromEntries(['paper','tone','ink','white'].map(k=>[k,tr('mangaLayer_'+k)]));
  function comicMenu(){const {body,finish}=modal(tr('comic'),{maximizable:false});
    body.append(el('p','ph3-small',tr('comicMenuHelp')));
    for(const [key,action]of [['comicFilter',()=>processModal('comic')],['ph3ComicFilter',()=>mangaModal(true)]])body.append(button(key,()=>{finish();return action();},'ph3-conversion-choice'));
  }
  async function mangaModal(ph3=false){
    const layer=selectedImage();if(layer.locked)throw Error(tr('locked'));
    const signature=JSON.stringify(layer),project=record.id,revision=doc.canvas_revision;
    const check=()=>{if(record.id!==project||doc.canvas_revision!==revision||JSON.stringify(doc.layers.find(l=>l.id===layer.id))!==signature)throw Error(tr('processingConflict'));};
    await openManga({ph3,onClassic:()=>processModal('comic'),layer:clone(layer),doc:clone(doc),cache,client,modal,tr,catalog,
      onApply:async(result)=>{check();ensureLayerCapacity(doc,4);commit(d=>{const layers=addMangaLayers(d,result,{sourceId:layer.id,sourceSignature:signature,names:mangaNames()});selected=layers[2].id;});await renderAll();status(tr('ready'));},
      onGenerate:async(source,settings,preset)=>{check();await generate('manga',{source_asset:source,source_layer_id:layer.id,manga_settings:settings,manga_preset:preset});showTab('generate');}
    });
  }
  function syncPrompt(){originalText.value=doc.prompt.original;aiText.value=doc.prompt.ai;sourceSelect.value=doc.prompt.source;originalText.hidden=doc.prompt.source==='ai';aiText.hidden=doc.prompt.source!=='ai';renderReferences();}
  function promptEdit(key,value){if(setPromptValue(doc,key,value)){stashDraft();updateToolbar();}}
  async function addReference(files=null){files??=await filePicker('image/png,image/jpeg,image/webp',true);if(!files.length)return;
    if(doc.references.length+files.length>7)throw Error('At most 7 reference images');
    await withBusy(async()=>{for(const file of files){const info=await client.upload(file,file.name);commit(d=>d.references.push({asset:info.asset,role:'appearance'}),{refresh:false});}renderReferences();});
  }
  function renderReferences(){if(!refsBox)return;refsBox.replaceChildren();for(let i=0;i<doc.references.length;i++){
    const ref=doc.references[i],row=el('div','ph3-ref'),img=el('img');img.src=client.assetURL(ref.asset);img.alt=`Reference ${i+1}`;const input=inputControl(ref.role);input.placeholder=tr('referenceRole');input.onchange=()=>commit(d=>d.references[i].role=input.value.slice(0,200),{refresh:false});
    const del=el('button','','×');del.title=tr('remove');del.onclick=()=>{if(!busy){commit(d=>d.references.splice(i,1),{refresh:false});renderReferences();}};row.append(img,input,del);refsBox.append(row);
  }}
  async function letteringModal(layer,followup=null){
    if(busy)return;if(!catalog)catalog=await client.get('/capabilities');if(!catalog.lettering_finishing)throw Error(tr('letteringRestart'));const snapshot=clone(layer||{}),projectId=record.id;
    openLettering({layer:snapshot,doc:clone(doc),projectId,jobs:clone(jobs),client,cache,catalog,modal,field,button,tr,followup,onGenerate:async(payload,prepareSource)=>{
      if(projectId!==record.id)throw Error(tr('processingConflict'));
      if(snapshot.id){const current=doc.layers.find(l=>l.id===snapshot.id);if(!current||current.locked||JSON.stringify(current)!==JSON.stringify(snapshot))throw Error(tr('processingConflict'));}
      if(payload.lettering.use_reference&&payload.lettering.reference_kind==='candidate'&&['spiky','thought'].includes(payload.lettering.decoration)&&!catalog.preserved_lettering_bubbles)throw Error(tr('letteringRestart'));
      await generate('lettering',payload,prepareSource);
    },onFinish:async payload=>{
      if(projectId!==record.id)throw Error(tr('processingConflict'));
      await withBusy(async()=>{await saveRecord(true);const result=await client.post('/projects/'+record.id+'/lettering/finish',{...payload,revision:record.revision,save:true});jobs.unshift(result.job);renderJobs();showTab('candidates');status(tr('ready'));});
    }});
  }
  async function generate(mode=null,extra={},prepareSource=null){
    mode??=modeSelect.value;
    if(mode==='selection'&&!maskBounds(selection,doc.width,doc.height))throw Error(tr('requireSelection'));
    const hasSource=doc.layers.some(l=>l.visible&&l.type==='image'&&(doc.settings.include_text||!isDecorationLayer(l)));
    if(!['new','enhance','lettering'].includes(mode)&&!extra.source_asset&&!hasSource)throw Error(tr('requireImage'));
    await withBusy(async()=>{
      if(mode!=='enhance'&&doc.settings.random_seed)doc.settings.seed=randomSeed();
      await saveRecord(true);
      let source=prepareSource?await prepareSource():extra.source_asset||null;
      if(!source&&!['new','lettering'].includes(mode)&&hasSource)source=(await client.upload(await toBlob(await exportCanvas(doc,cache,{includeText:!!doc.settings.include_text})))).asset;
      const prepared=await client.post(`/projects/${record.id}/prepare`,{revision:record.revision,mode,source_asset:source,...extra});
      let queued;try{queued=await client.queue(prepared.prompt);}catch(e){await client.post('/jobs/'+prepared.job.id+'/state',{error:String(e.message),status:'failed'}).catch(()=>{});throw e;}
      if(!queued.prompt_id)throw Error('ComfyUI did not return a prompt_id');
      const job={...prepared.job,prompt_id:queued.prompt_id,status:'queued'};currentJobs.set(job.id,job);
      await client.post('/jobs/'+job.id+'/state',{prompt_id:queued.prompt_id,status:'queued'}).catch(()=>{});
      jobs.unshift(job);renderJobs();showTab('candidates');status(tr('waiting'));
    });startPolling();
  }
  const stoppingJobs=new Set();
  async function loadJobs(){jobs=await client.get('/projects/'+record.id+'/jobs');for(const job of jobs)if(['queued','prepared'].includes(job.status))currentJobs.set(job.id,job);renderJobs();if(currentJobs.size)startPolling();}
  function startPolling(){if(!pollTimer&&!closed)pollTimer=setTimeout(poll,900);}
  async function poll(){pollTimer=null;if(closed)return;
    try{for(const [id,old]of [...currentJobs]){
      let job=await client.get('/jobs/'+id);if(stoppingJobs.has(id))continue;
      if(job.cancel_requested){const stopped=await confirmStopped(client,job);if(stopped){job=stopped;currentJobs.delete(id);}}
      jobs=jobs.map(x=>x.id===id?job:x);
      if(job.status==='succeeded'){
        if(busy||gesture||root.querySelector('.ph3-overlay'))continue;
        currentJobs.delete(id);
        if(!job.suppress_auto&&!stoppingJobs.has(id)){
          if(job.request.mode==='enhance'){
            if(candidateMatches(doc,job,record.id)&&doc.prompt.original===job.request.original_prompt){commit(d=>{d.prompt.ai=job.text;d.prompt.source='ai';},{refresh:false});syncPrompt();status(tr('ready'));}
          }else if(!['manga','lettering'].includes(job.request.mode)&&doc.settings.auto_apply&&candidateMatches(doc,job,record.id)&&!doc.layers.some(l=>l.generation?.job_id===job.id)){try{await adopt(job,0,false);}catch(error){status(error.message,true);}}
          else if(!candidateMatches(doc,job,record.id))status(tr('stale'));
        }
      }else if(job.status==='failed'){currentJobs.delete(id);status(job.error||'Generation failed',true);}
      else if(job.prompt_id){
        const run=(await client.history(job.prompt_id))[job.prompt_id];
        if(run?.status?.status_str==='error'){
          const details=(run.status.messages||[]).find(x=>x[0]==='execution_error');const msg=details?.[1]?.exception_message||'ComfyUI execution failed';
          await client.post('/jobs/'+id+'/state',{status:'failed',error:msg});currentJobs.delete(id);status(msg,true);
        }
      }
    }renderJobs();}catch(e){status(e.message+' · retrying',true);}finally{if(currentJobs.size&&!closed)pollTimer=setTimeout(poll,1800);}
  }
  async function stopAuto(job){
    if(stoppingJobs.has(job.id)||job.cancel_requested)return;
    stoppingJobs.add(job.id);job.suppress_auto=true;renderJobs();
    try{const stopped=await cancelGeneration(client,job);const updated=stopped||await client.get('/jobs/'+job.id);jobs=jobs.map(x=>x.id===job.id?updated:x);if(stopped)currentJobs.delete(job.id);else currentJobs.set(job.id,updated);status(tr(stopped?'stopped':'stopping'));}
    catch(error){status(tr('stopFailed')+' '+error.message,true);}
    finally{stoppingJobs.delete(job.id);renderJobs();if(currentJobs.size)startPolling();}
  }
  async function adopt(job,index=0,manual=true){
    if(job.project_id!==record.id)throw Error('Generation belongs to another project');
    if(!candidateMatches(doc,job,record.id)){
      if(!manual)return;if(!confirm(tr('confirmStale')))return;
    }
    ensureLayerCapacity(doc,job.request.mode==='manga'?4:1);
    commit(d=>{const layer=layerFromCandidate(d,job,index);
      if(job.request.mode==='manga'){
        const layers=addMangaLayers(d,job.results[index],{sourceId:candidateMatches(d,job,record.id)?job.request.source_layer?.id:null,sourceSignature:JSON.stringify(job.request.source_layer),names:mangaNames(),generation:layer.generation});selected=layers[2].id;
      }else if(job.request.mode==='lettering'){
        selected=addLetteringLayer(d,job,index,tr('aiLettering')+' · '+job.request.lettering.text).id;
      }else{insertImageLayer(d,layer);selected=layer.id;}
    });await renderAll();status(tr('ready'));renderJobs();
  }
  function renderJobs(){if(!jobsBox)return;jobsBox.replaceChildren();for(const job of jobs.filter(job=>!(job.status==='failed'&&job.error==='Cancelled'&&!job.results?.length&&!job.text)).slice(0,20)){
    const card=el('div','ph3-card'),label=el('div','ph3-small',`${job.request.mode==='lettering'?tr('aiLettering')+' · '+job.request.lettering.text:job.request.mode} · ${new Date(job.created_at*1000).toLocaleTimeString()} · ${job.request.config.seed??'AI'}`);const header=el('div','ph3-job-header');header.append(label);card.append(header);
    if(['prepared','queued'].includes(job.status)){const stopping=stoppingJobs.has(job.id)||job.cancel_requested;const close=el('button','ph3-job-stop','×');close.type='button';close.title=close.ariaLabel=tr('stop');close.disabled=!!stopping;close.onclick=()=>stopAuto(job).catch(fail);header.append(close);const progress=el('div','ph3-progress');progress.append(el('i'));const stop=button(stopping?'stopping':'stop',()=>stopAuto(job));stop.disabled=!!stopping;card.append(progress,el('div','ph3-small',tr(stopping?'stopping':'waiting')),stop);}
    if(job.status==='failed')card.append(el('div','ph3-small',job.error==='Cancelled'?tr('stopped'):job.error||'Failed'));
    if(job.text){card.append(el('pre','',job.text),button('useText',()=>{commit(d=>{d.prompt.ai=job.text;d.prompt.source='ai';},{refresh:false});syncPrompt();}));}
    for(let i=0;i<(job.results||[]).length;i++){const result=job.results[i],img=el('img');img.src=client.assetURL(result.asset);img.alt=job.request.prompt;card.append(img);if(job.request.mode==='lettering'&&result.edge_clipped)card.append(el('p','ph3-small',tr('letteringClipped')));
      const used=doc.layers.some(l=>l.generation?.job_id===job.id&&(l.generation.result_index??0)===i),stale=!candidateMatches(doc,job,record.id);const adoptButton=button(used?'applied':stale?'importStale':'apply',()=>adopt(job,i,true));adoptButton.disabled=used;card.append(adoptButton);
      if(job.request.mode==='lettering')card.append(button('letteringAddDecoration',()=>letteringModal(null,{job:clone(job),index:i}).catch(fail)));}
    jobsBox.append(card);
  }if(!jobsBox.children.length)jobsBox.append(el('p','ph3-small',tr('noCandidates')));}
  function showTab(name){
    if(floating.has(name)){const entry=floating.get(name);entry.frame.hidden=false;entry.constrain();entry.save();return;}
    activeTab=name;right.dataset.mode=name;for(const[key,panel]of Object.entries(panels))panel.hidden=floating.has(key)?false:key==='layers'?false:key!==name;for(const b of tabs.children)b.classList.toggle('active',b.dataset.tab===name);
  }
  function setTool(name){tool=name;pixelControls.hidden=!['wand','colorRange'].includes(name);contiguousField.hidden=name!=='wand';if(['rect','ellipse','lasso','brush','erase','wand','colorRange'].includes(name))modeSelect.value='selection';for(const b of left.querySelectorAll('[data-tool]'))b.classList.toggle('active',b.dataset.tool===name);viewport.style.cursor=name==='hand'?'grab':name==='move'?'default':'crosshair';draw();}
  async function selectPixels(p,op){
    const x=Math.floor(p.x),y=Math.floor(p.y);
    if(x<0||y<0||x>=doc.width||y>=doc.height)return;
    const snapshot=clone(doc),base=new Uint8ClampedArray(selection),kind=tool,opts={...pixelOptions};
    if(!opts.merged){const layer=snapshot.layers.find(l=>l.id===selected)||(snapshot.layers.length===1?snapshot.layers[0]:null);if(!layer){status(tr('selectLayerFirst'),true);return;}snapshot.layers=[layer];}
    await withBusy(async()=>{
      const image=await exportCanvas(snapshot,cache,{background:false});if(closed)return;
      const pixels=image.getContext('2d').getImageData(0,0,image.width,image.height),i=(y*image.width+x)*4;
      const color={r:pixels.data[i],g:pixels.data[i+1],b:pixels.data[i+2]};
      let mask=kind==='wand'&&opts.contiguous?floodSelect(pixels,x,y,opts.tolerance):colorRangeMask(pixels,[color],[],opts.tolerance);
      if(opts.antialias)mask=featherMask(mask,image.width,image.height,1);
      const next=combineMasks(base,mask,op),asset=maskBounds(next,doc.width,doc.height)?(await client.upload(await toBlob(maskCanvas(next,doc.width,doc.height)))).asset:null;
      if(closed)return;commit(d=>d.selection_asset=asset,{refresh:false});selection=next;invalidate();await renderAll();
    });status(tr('ready'));
  }
  function viewportPoint(event){const r=viewport.getBoundingClientRect();return{x:event.clientX-r.left,y:event.clientY-r.top};}
  function point(event){return toDocument(viewportPoint(event),view,doc,viewSize());}
  function cancelGesture(){if(gesture?.before)doc=gesture.before;if(gesture?.original)selection=gesture.original;gesture=null;pan=null;viewDrag=null;invalidate();renderAll();}
  function pointerDown(event){
    if(busy||root.querySelector('.ph3-overlay'))return;
    if((event.button===3||event.button===4)&&doc.settings.mouse_undo!==false){event.preventDefault();event.stopPropagation();(event.button===3?undo:redo)().catch(fail);return;}
    if(event.button!==0&&event.button!==1)return;viewport.focus({preventScroll:true});event.preventDefault();event.stopPropagation();viewport.setPointerCapture(event.pointerId);
    if(event.button===1||space||tool==='hand'){pan={x:event.clientX,y:event.clientY,start:{...view}};viewport.style.cursor='grabbing';return;}
    if(tool==='rotateView'){const q=viewportPoint(event),cx=viewport.clientWidth/2+view.x,cy=viewport.clientHeight/2+view.y;viewDrag={angle:view.angle,start:Math.atan2(q.y-cy,q.x-cx),cx,cy};return;}
    const p=point(event);
    if(tool==='wand'||tool==='colorRange'){selectPixels(p,selectionOperation(event.shiftKey,event.altKey,operation)).catch(fail);return;}
    if(tool==='move'){
      const existing=doc.layers.find(x=>x.id===selected);let mode='move',layer=existing,handle=null;
      if(existing&&!existing.locked){const r=localPoint(existing,p);handle=visibleHandlePoints(existing,view,doc,viewSize()).find(h=>Math.hypot(r.x-h.x,r.y-h.y)<10/zoom);if(handle)mode=handle.id==='rotate'?'rotate':handle.id==='tail'?'tail':'resize';else layer=hitLayer(doc,p,selected);}else layer=hitLayer(doc,p,selected);
      selected=layer?.id||null;renderLayers();renderProperties();draw();if(!layer||layer.locked)return;
      gesture={type:mode,handle:handle?.id,start:p,before:clone(doc),layer:clone(layer),id:layer.id};
    }else{
      gesture={type:tool,start:p,points:[p],original:new Uint8ClampedArray(selection),mask:new Uint8ClampedArray(selection.length),operation:tool==='erase'?'subtract':selectionOperation(event.shiftKey,event.altKey,operation)};
      if(tool==='brush'||tool==='erase'){strokeMask(gesture.mask,doc.width,doc.height,p,p,(doc.settings.brush||32)/2);selection=combineMasks(gesture.original,gesture.mask,gesture.operation);invalidate();draw();}
    }
  }
  function pointerMove(event){
    if(pan){setView({...pan.start,x:pan.start.x+event.clientX-pan.x,y:pan.start.y+event.clientY-pan.y});return;}
    if(viewDrag){const p=viewportPoint(event);let a=viewDrag.angle+(Math.atan2(p.y-viewDrag.cy,p.x-viewDrag.cx)-viewDrag.start)*180/Math.PI;if(event.shiftKey)a=Math.round(a/15)*15;setView({...view,angle:a});return;}
    if(!gesture)return;const p=point(event),g=gesture;
    if(['move','resize','rotate','tail'].includes(g.type)){
      const layer=doc.layers.find(x=>x.id===g.id);if(!layer)return;
      if(g.type==='move'){layer.x=Math.max(-32768,Math.min(32768,g.layer.x+p.x-g.start.x));layer.y=Math.max(-32768,Math.min(32768,g.layer.y+p.y-g.start.y));}
      if(g.type==='rotate'){const c={x:g.layer.x+g.layer.w/2,y:g.layer.y+g.layer.h/2};layer.rotation=g.layer.rotation+(Math.atan2(p.y-c.y,p.x-c.x)-Math.atan2(g.start.y-c.y,g.start.x-c.x))*180/Math.PI;if(event.shiftKey)layer.rotation=Math.round(layer.rotation/15)*15;}
      if(g.type==='resize'){Object.assign(layer,resizeLayer(g.layer,g.handle,{x:p.x-g.start.x,y:p.y-g.start.y},!event.shiftKey));if(layer.type==='text')layer.autoFit=false;}
      if(g.type==='tail'){const q=localPoint(layer,p);layer.tailX=Math.max(-1,Math.min(2,q.x/layer.w));layer.tailY=Math.max(-1,Math.min(3,q.y/layer.h));}
      draw();return;
    }
    if(g.type==='lasso'){if(Math.hypot(p.x-g.points.at(-1).x,p.y-g.points.at(-1).y)>2/zoom)g.points.push(p);draw();return;}
    if(g.type==='rect'||g.type==='ellipse')g.mask=(g.type==='rect'?rectangleMask:ellipseMask)(doc.width,doc.height,g.start.x,g.start.y,p.x,p.y);
    else{strokeMask(g.mask,doc.width,doc.height,g.points.at(-1),p,(doc.settings.brush||32)/2);g.points.push(p);}
    selection=combineMasks(g.original,g.mask,g.operation);invalidate();draw();
  }
  async function pointerUp(event){
    if(pan||viewDrag){pan=null;viewDrag=null;setTool(tool);return;}if(!gesture)return;const g=gesture;gesture=null;
    if(['move','resize','rotate','tail'].includes(g.type)){if(JSON.stringify(g.before.layers)!==JSON.stringify(doc.layers)){history.record(g.before);doc.canvas_revision++;stashDraft();}renderProperties();updateToolbar();draw();return;}
    const next=g.type==='lasso'?combineMasks(g.original,polygonMask(doc.width,doc.height,g.points),g.operation):selection;selection=g.original;invalidate();await replaceSelection(next);
  }
  viewport.addEventListener('pointerdown',pointerDown,events);viewport.addEventListener('pointermove',pointerMove,events);viewport.addEventListener('pointerup',e=>pointerUp(e).catch(fail),events);
  viewport.addEventListener('pointercancel',cancelGesture,events);
  for(const name of ['mousedown','mouseup','auxclick'])viewport.addEventListener(name,e=>{if((e.button===3||e.button===4)&&doc.settings.mouse_undo!==false){e.preventDefault();e.stopPropagation();}},events);
  viewport.addEventListener('wheel',e=>{if(busy||gesture||pan||viewDrag||root.querySelector('.ph3-overlay'))return;e.preventDefault();e.stopPropagation();const delta=wheelPixels(e,viewport.clientHeight),anchor=viewportPoint(e);
    if(e.altKey)setView(anchoredView(view,{angle:view.angle+delta*.1},anchor,doc,viewSize()));
    else if(e.shiftKey)setView({...view,x:view.x-delta});
    else zoomAt(view.zoom*Math.exp(-delta*.0017),anchor);
  },{...events,passive:false});
  root.addEventListener('dragover',e=>{e.preventDefault();e.stopPropagation();},events);
  root.addEventListener('drop',e=>{e.preventDefault();e.stopPropagation();const files=[...e.dataTransfer.files].filter(f=>/^image\//.test(f.type));if(files.length&&!busy)importImages(files).catch(fail);},events);
  root.addEventListener('keydown',e=>{
    const typing=!!e.target.closest('input,textarea,select,[contenteditable]:not([contenteditable=false])'),ctrl=e.ctrlKey||e.metaKey,key=e.key.toLowerCase();
    e.stopPropagation();if(e.defaultPrevented||e.isComposing||e.keyCode===229||busy)return;
    if(root.querySelector('.ph3-overlay'))return;
    if(ctrl&&key==='s'){e.preventDefault();save().catch(fail);return;}
    if(typing)return;
    const command=editorShortcut(e,{blocked:!!gesture||!!pan||!!viewDrag});
    if(command){e.preventDefault();if(e.repeat)return;
      const run=async()=>{
        if(command==='duplicate')layerAction('duplicate',true);
        else if(command==='remove')layerAction('remove');
        else if(command==='deselect')await replaceSelection(new Uint8ClampedArray(doc.width*doc.height));
        else if(command==='selectAll')await replaceSelection(new Uint8ClampedArray(doc.width*doc.height).fill(255));
        else if(command==='invertSelection')await replaceSelection(invertMask(selection));
        else if(command==='transform'){setTool('move');showTab('properties');draw();}
        else if(command==='mergeVisible')await mergeVisible();
        else if(command==='newProject')await newProject();
        else if(command==='openProject')await openProject();
        else if(command==='zoomIn')zoomAt(zoom*1.2);
        else if(command==='zoomOut')zoomAt(zoom/1.2);
        else {
          const [action,amount]=command.split(':'),direction=Number(amount),index=doc.layers.findIndex(l=>l.id===selected);
          if(action==='select'){
            const target=index<0?(direction>0?0:doc.layers.length-1):index+direction;
            if(doc.layers[target]){selected=doc.layers[target].id;renderLayers();renderProperties();draw();}
          }else if(index>=0){
            const layer=doc.layers[index];if(layer.locked){status(tr('lockedHint'),true);return;}
            const target=action==='edge'?(direction>0?doc.layers.length-1:0):index+direction;
            if(target>=0&&target<doc.layers.length&&target!==index)commit(d=>{const [item]=d.layers.splice(index,1);d.layers.splice(target,0,item);});
          }
        }
      };run().catch(fail);return;
    }
    if(e.altKey||e.getModifierState?.('AltGraph'))return;
    if(e.key==='Escape'&&gesture){e.preventDefault();cancelGesture();return;}
    if(e.code==='Space'){space=true;e.preventDefault();}
    if(ctrl&&key==='z'){e.preventDefault();(e.shiftKey?redo:undo)().catch(fail);}
    else if(ctrl&&key==='y'){e.preventDefault();redo().catch(fail);}
    else if(ctrl&&key==='c'){const l=doc.layers.find(l=>l.id===selected);if(l){layerClipboard=clone(l);e.preventDefault();}}
    else if(ctrl&&key==='v'&&layerClipboard){e.preventDefault();try{addObject(layerClipboard.type,{...clone(layerClipboard),id:uid(),x:layerClipboard.x+12,y:layerClipboard.y+12,locked:false});}catch(error){fail(error);}}
    else if(ctrl&&key==='0'){e.preventDefault();fit();}
    else if(ctrl&&key==='1'){e.preventDefault();zoomAt(1);}
    else if(e.key.startsWith('Arrow')){const l=doc.layers.find(l=>l.id===selected);if(l&&!l.locked){e.preventDefault();const delta=e.shiftKey?10:1;commit(d=>{const target=d.layers.find(x=>x.id===l.id);if(e.key==='ArrowLeft')target.x-=delta;if(e.key==='ArrowRight')target.x+=delta;if(e.key==='ArrowUp')target.y-=delta;if(e.key==='ArrowDown')target.y+=delta;target.x=Math.max(-32768,Math.min(32768,target.x));target.y=Math.max(-32768,Math.min(32768,target.y));});}}
    else if(!ctrl){const action={v:'move',m:'rect',w:'wand',l:'lasso',b:'brush',e:'erase',h:'hand',r:'rotateView'}[key];if(action){e.preventDefault();setTool(action);}if(key==='t'){try{addObject('text');}catch(error){fail(error);}}if(key==='0'){e.preventDefault();resetView();}if(key==='+'||key==='='){e.preventDefault();zoomAt(zoom*1.2);}if(key==='-'){e.preventDefault();zoomAt(zoom/1.2);}if(key==='['||key===']'){e.preventDefault();doc.settings.brush=Math.min(512,Math.max(1,(doc.settings.brush||32)+(key==='['?-4:4)));stashDraft();status(tr('brushSize')+': '+doc.settings.brush);}if(key==='?')help();}
  },events);
  root.addEventListener('keyup',e=>{if(e.code==='Space')space=false;},events);
  window.addEventListener('blur',()=>{space=false;if(gesture||pan||viewDrag)cancelGesture();},events);
  root.addEventListener('cancel',e=>{e.preventDefault();const overlay=root.querySelector('.ph3-overlay');if(overlay)overlay.ph3Finish?.();else requestClose();},events);
  function help(){const {body}=modal(tr('shortcuts'));const table=el('div','ph3-shortcuts');for(const [key,label]of [['Wheel','wheelHelp'],['Space + Drag / Middle drag','panHelp'],['R + Drag / Alt + Wheel','rotateHelp'],['0','resetView'],['Ctrl+0 / Ctrl+1','fitActualHelp'],['Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y','undoRedo'],['Mouse Back / Forward','mouseUndo'],['Delete / Backspace','remove'],['Ctrl+J','duplicate'],['Ctrl+C / Ctrl+V','copyPasteLayers'],['Ctrl+A / Ctrl+D / Ctrl+Shift+I','selectionKeys'],['Ctrl+[ / Ctrl+]','orderKeys'],['Ctrl+Shift+[ / Ctrl+Shift+]','edgeKeys'],['Alt+[ / Alt+]','selectLayerKeys'],['Ctrl+T','transformKeys'],['Ctrl+Shift+E','mergeVisible'],['Ctrl+N / Ctrl+O / Ctrl+S','fileKeys'],['Ctrl++ / Ctrl+−','zoomKeys'],['↑ ↓ ← → / Shift','nudge'],['Shift + Resize','freeResize'],['V M L B E H R T','toolKeys'],['[ / ]','brushSize']]){const row=el('div');row.append(el('kbd','',key),el('span','',tr(label)));table.append(row);}body.append(table,el('p','ph3-small',tr('shortcutScope')),el('p','ph3-small',tr('mouseUndoHelp')));}
  window.addEventListener('beforeunload',e=>{if(dirty()){e.preventDefault();e.returnValue='';}},{signal:abort.signal});

  // Assemble a single editor surface. There is deliberately no comic-page or Quick Retouch workspace.
  top.append(el('span','ph3-brand','PH3 Image Tool'),button('newProject',newProject),button('openProject',openProject));
  const saveButton=button('save',save,'primary');top.append(saveButton,button('portable',exportProject,'ph3-optional'),button('export',exportImage));
  top.append(el('span','ph3-spacer'));const undoButton=button('undo',undo),redoButton=button('redo',redo);top.append(undoButton,redoButton,button('settings',settings),button('help',help),button('close',()=>requestClose()));
  left.append(button('image',()=>importImages(),'ph3-import-button'),button('input',importInput),labelElement('div','ph3-section-title','selection'));
  const tools=el('div','ph3-tool-grid');left.append(tools);
  for(const key of ['move','hand','rect','ellipse','lasso','wand','colorRange','brush','erase','rotateView']){const b=button(key,()=>setTool(key));b.dataset.tool=key;tools.append(b);}
  const pixelControls=el('div','ph3-pixel-options');pixelControls.hidden=true;left.append(pixelControls);
  const savePixelOptions=()=>{try{localStorage.setItem('ph3-tool:pixel-selection',JSON.stringify(pixelOptions));}catch{}};
  const tolerance=inputControl(pixelOptions.tolerance,'number');tolerance.min=0;tolerance.max=100;tolerance.step=1;
  tolerance.onchange=()=>{pixelOptions.tolerance=Math.max(0,Math.min(100,Number(tolerance.value)||0));tolerance.value=pixelOptions.tolerance;savePixelOptions();};field(pixelControls,'selectionTolerance',tolerance);
  let contiguousField;
  for(const [key,label] of [['contiguous','selectionContiguous'],['merged','selectionMerged'],['antialias','selectionAntialias']]){const control=inputControl(pixelOptions[key],'checkbox');control.onchange=()=>{pixelOptions[key]=control.checked;savePixelOptions();};field(pixelControls,label,control);if(key==='contiguous')contiguousField=control.parentElement;}
  pixelControls.title=tr('pixelSelectionHelp');pixelControls.dataset.help='pixelSelectionHelp';
  const selectionActions=el('div','ph3-row');selectionActions.append(button('clear',()=>replaceSelection(new Uint8ClampedArray(doc.width*doc.height))),button('invert',()=>replaceSelection(invertMask(selection))));left.append(selectionActions);
  left.append(button('bubble',()=>presetModal('bubble',BUBBLES)),button('addText',()=>addObject('text'),'primary'),button('sourceSfx',()=>sourceGallery('sfx')),button('sourceStamps',()=>sourceGallery('stamps')),button('speed',()=>presetModal('speed',SPEEDS)),button('frame',()=>presetModal('frame',FRAMES)),button('styles',()=>styleGallery()));
  function styleGallery(){
    const {body,finish,box}=modal(tr('styles'),{dismissOutside:true,drawer:true});box.classList.add('ph3-gallery-modal');const decor=el('div','ph3-decoration-grid');body.append(decor);
  const actionsByType={text:()=>addObject('text'),bubble:()=>presetModal('bubble',BUBBLES),sfx:()=>presetModal('sfx',SFX),symbol:()=>presetModal('symbol',SYMBOLS),stamp:importStamp,speed:()=>presetModal('speed',SPEEDS),frame:()=>presetModal('frame',FRAMES)};
  const thumbItem={text:TEXT_STYLES[1],bubble:BUBBLES[0],sfx:SFX[0],symbol:SYMBOLS[1],speed:SPEEDS[0],frame:FRAMES[1]};
  for(const[key,action]of Object.entries(actionsByType)){const b=button(key,()=>{finish();return action();},'ph3-visual-launch');if(thumbItem[key]){b.querySelector('svg')?.remove();const preview=presetThumbnail(key,thumbItem[key]);b.prepend(preview);}decor.append(b);}
  }
  left.append(labelElement('div','ph3-section-title','filters'),button('comic',comicMenu,'ph3-process-launch'),button('cutout',()=>processModal('remove_background'),'ph3-process-launch'));
  const leftScroller=el('div','ph3-left-scroller'),processGroup=el('div','ph3-process-group');
  const allLeft=[...left.children];for(const child of allLeft.slice(0,-3))leftScroller.append(child);for(const child of allLeft.slice(-3))processGroup.append(child);left.append(leftScroller,processGroup);
  viewbar.append(button('fit',fit),button('actual',()=>zoomAt(1)));
  const minus=el('button','','−'),plus=el('button','','+'),zoomInput=inputControl(100,'number');zoomInput.className='ph3-zoom-input';zoomInput.min=2;zoomInput.max=1600;zoomInput.setAttribute('aria-label',tr('zoomPercent'));zoomInput.onchange=()=>{const z=Number(zoomInput.value);if(Number.isFinite(z)&&z>=2&&z<=1600)zoomAt(z/100);};minus.title=tr('zoomOut');plus.title=tr('zoomIn');minus.onclick=()=>zoomAt(zoom/1.2);plus.onclick=()=>zoomAt(zoom*1.2);viewbar.append(minus,zoomInput,el('span','','%'),plus);
  const viewAngle=el('span','ph3-view-angle','0°'),reset=button('resetView',resetView);reset.title=tr('viewOnly');viewbar.append(el('span','ph3-spacer'),viewAngle,reset);
  const operationSelect=optionsSelect(['replace','add','subtract','intersect'].map(x=>[x,tr(x)]),operation);operationSelect.setAttribute('aria-label',tr('selectionOperation'));operationSelect.onchange=()=>operation=operationSelect.value;viewbar.append(operationSelect);
  for(const key of ['generate','properties','layers','candidates']){const b=button(key==='generate'?'generationTab':key==='candidates'?'historyTab':key,()=>{if(floating.has(key)){const entry=floating.get(key);entry.frame.hidden=!entry.frame.hidden;entry.constrain();entry.save();}else showTab(key);});b.dataset.tab=key;tabs.append(b);const panel=el('section','ph3-panel');panel.dataset.panel=key;panels[key]=panel;right.append(panel);}

  const gen=panels.generate,props=panels.properties,layerPanel=panels.layers;
  const modeSelect=optionsSelect([['selection',tr('partial')],['full',tr('full')],['new',tr('newImage')]],doc.layers.some(l=>l.type==='image')?'full':'new');field(gen,'mode',modeSelect);modeSelect.onchange=()=>{doc.canvas_revision++;stashDraft();};
  const sourceSelect=optionsSelect([['original',tr('original')],['ai',tr('ai')]],doc.prompt.source);sourceSelect.onchange=()=>{promptEdit('source',sourceSelect.value);syncPrompt();};field(gen,'prompt',sourceSelect);
  const originalText=el('textarea'),aiText=el('textarea');originalText.placeholder=tr('promptPlaceholder');originalText.setAttribute('aria-label',tr('original'));aiText.setAttribute('aria-label',tr('ai'));
  originalText.oninput=()=>promptEdit('original',originalText.value);aiText.oninput=()=>promptEdit('ai',aiText.value);gen.append(originalText,aiText);
  const genRow=el('div','ph3-row');genRow.append(button('enhance',()=>generate('enhance')),button('generate',()=>generate(),'primary'));gen.append(genRow);genRow.dataset.help='inputHint';genRow.title=tr('inputHint');

  gen.append(labelElement('div','ph3-section-title','references'));const refsBox=el('div');const refButton=button('addReference',addReference);refButton.dataset.help='newRefs';refButton.title=tr('newRefs');const refDrop=el('div','ph3-reference-drop');refDrop.dataset.help='referenceDropHelp';refDrop.title=tr('referenceDropHelp');refDrop.append(refsBox,refButton,labelElement('div','ph3-small','referenceDrop'));
  refDrop.ondragover=e=>{if([...e.dataTransfer.types].includes('Files')){e.preventDefault();e.stopPropagation();refDrop.classList.add('drag-active');}};
  refDrop.ondragleave=()=>refDrop.classList.remove('drag-active');
  refDrop.ondrop=e=>{e.preventDefault();e.stopPropagation();refDrop.classList.remove('drag-active');const files=[...e.dataTransfer.files].filter(f=>/^image\//.test(f.type));if(files.length&&!busy)addReference(files).catch(fail);};gen.append(refDrop);
  const jobsBox=el('div');panels.candidates.append(panelDetach('candidates'),jobsBox);
  const layerList=el('div','ph3-layer-list'),actions=el('div','ph3-row');for(const key of ['duplicate','remove','up','down'])actions.append(button(key,()=>layerAction(key)));actions.append(button('mergeVisible',mergeVisible));layerPanel.classList.add('ph3-layer-dock');layerPanel.append(panelDetach('layers'),actions,layerList,button('saveCopy',saveCopy));
  const layerSplit=el('div','ph3-layer-split');layerSplit.tabIndex=0;layerSplit.setAttribute('role','separator');layerSplit.setAttribute('aria-orientation','horizontal');layerSplit.setAttribute('aria-label',tr('layerHeight'));layerSplit.title=tr('layerHeight');layerPanel.prepend(layerSplit);
  let dockHeight=245,splitDrag=null;
  try{const saved=Number(localStorage.getItem('ph3-tool:layer-height'));if(Number.isFinite(saved)&&saved>=140)dockHeight=saved;}catch{}
  function resizeDock(value,save=false){const max=Math.max(140,right.clientHeight-tabs.offsetHeight-100);const height=Math.round(Math.max(140,Math.min(max,value)));right.style.setProperty('--ph3-layer-height',height+'px');layerSplit.setAttribute('aria-valuemin','140');layerSplit.setAttribute('aria-valuemax',String(Math.round(max)));layerSplit.setAttribute('aria-valuenow',String(height));if(save){dockHeight=height;try{localStorage.setItem('ph3-tool:layer-height',String(height));}catch{}}}
  layerSplit.onpointerdown=e=>{if(e.button!==0)return;e.preventDefault();splitDrag={y:e.clientY,height:layerPanel.getBoundingClientRect().height};layerSplit.setPointerCapture(e.pointerId);};
  layerSplit.onpointermove=e=>{if(splitDrag)resizeDock(splitDrag.height+splitDrag.y-e.clientY,true);};
  layerSplit.onpointerup=layerSplit.onpointercancel=()=>splitDrag=null;
  layerSplit.onkeydown=e=>{if(!['ArrowUp','ArrowDown','Home','End'].includes(e.key))return;e.preventDefault();e.stopPropagation();resizeDock(e.key==='Home'?140:e.key==='End'?right.clientHeight:layerPanel.getBoundingClientRect().height+(e.key==='ArrowUp'?20:-20),true);};
  const dockObserver=new ResizeObserver(()=>resizeDock(dockHeight));dockObserver.observe(right);abort.signal.addEventListener('abort',()=>dockObserver.disconnect(),{once:true});
  function requestClose(){if(busy)return false;if(dirty()&&!confirm(tr('warningClose')))return false;root.querySelectorAll('.ph3-overlay').forEach(o=>o.ph3Finish?.());closed=true;clearTimeout(draftTimer);clearTimeout(pollTimer);abort.abort();cache.dispose();root.close();root.remove();onClose?.();return true;}
  root.showModal();syncPrompt();localize();showTab('generate');setTool('move');await restoreSelection();await renderAll();fit();status(tr('ready'));for(const key of ['properties','layers','candidates']){const pref=panelPrefs(key);if(pref.docked===false)toggleFloat(key,pref.visible??key==='layers');}showTab('generate');
  catalog=await client.get('/capabilities').catch(e=>{fail(e);return null;});
  suggestModels();
  await loadJobs().catch(fail);
  if(!closed)offerDraftRecovery();
  return {focus:()=>root.focus(),close:requestClose,updateInput:value=>inputAsset=value,detach:()=>{detached=true;status(tr('detached'));},
    // Read-only testing/diagnostic surface; no programmatic hidden execution.
    snapshot:()=>clone(doc),viewSnapshot:()=>({...view}),element:root};
}

