import {clone} from './core.mjs?v=37e99894a6ee0379';
import {MANGA_DEFAULTS} from './manga-core.mjs?v=37e99894a6ee0379';
import {exportCanvas,toBlob} from './render.mjs?v=37e99894a6ee0379';
import {inlineProgress} from './inline-progress.mjs?v=37e99894a6ee0379';
const el=(tag,cls='',text='')=>{const e=document.createElement(tag);e.className=cls;e.textContent=text;return e;};
export async function openManga({layer,doc,cache,client,modal,tr,catalog,onApply,onGenerate,onAdopt,ph3=false,onClassic,shared}) {
  const {body,actions,finish,box}=modal(tr(ph3?'ph3ComicFilter':'comicFilter'),{maximizable:true});box.classList.add('ph3-processing');
  const progress=inlineProgress({box,client,tr,shared});
  let closed=false,running=false,source=null,result=null,review=null,index=0;
  const watch=new AbortController();
  box.addEventListener('ph3-close',()=>{closed=true;watch.abort();},{once:true});
  const settings={...MANGA_DEFAULTS,...doc.settings.manga_settings,...layer.processing?.settings};
  const layout=el('div','ph3-processing-layout'),visual=el('div','ph3-processing-visual'),controls=el('div','ph3-processing-controls');
  const comparison=el('div','ph3-comparison'),before=el('img','ph3-process-canvas'),after=el('img','ph3-process-canvas');
  for(const [key,img]of [['before',before],['after',after]]){const frame=el('div','ph3-compare-panel');img.alt=tr(key);frame.append(el('span','ph3-compare-label',tr(key)),img);comparison.append(frame);}
  const note=el('p','ph3-small',tr('mangaHelp')),state=el('p','ph3-process-status');state.setAttribute('role','status');
  visual.append(comparison,note);layout.append(visual,controls);body.append(el('p','',layer.name),layout);controls.append(state);
  let preset='standard';const presetSelect=el('select');presetSelect.setAttribute('aria-label',tr(ph3?'preset':'filterMethod'));
  for(const [id,key]of (ph3?[['standard','mangaStandard'],['bold','mangaBold']]:[['classic','classicMethod'],['screen','screenMethod']])){const o=el('option','',tr(key));o.value=id;presetSelect.append(o);}
  if(!ph3){presetSelect.title=tr('filterMethodHelp');presetSelect.setAttribute('aria-description',presetSelect.title);}presetSelect.value=ph3?'standard':'screen';body.prepend(presetSelect);
  if(ph3)Object.assign(settings,{screen_lines:250,white_point:.8,black_point:.3,light_tone:.18,dark_tone:.42,gradation:1,white_lines:.4});
  presetSelect.onchange=()=>{if(!ph3){finish();onClassic();return;}preset=presetSelect.value;Object.assign(settings,{screen_lines:250,white_point:.8,black_point:preset==='bold'?.4:.3,light_tone:.18,dark_tone:.42,gradation:1,white_lines:.4});for(const[key,input,,,slider]of inputs)input.value=slider.value=settings[key];white.checked=true;result=null;apply.disabled=true;};
  const inputs=[];
  for(const[key,min,max,step]of [['screen_lines',40,600,10],['white_point',.05,1,.01],['black_point',0,.95,.01],['light_tone',0,1,.01],['dark_tone',0,1,.01],['gradation',0,1,.05]]){
    const row=el('label','ph3-field'),input=el('input');input.type='number';input.value=settings[key];input.min=min;input.max=max;input.step=step;input.setAttribute('aria-label',tr('manga_'+key));
    const group=el('div','ph3-range-control'),slider=el('input');slider.type='range';slider.min=min;slider.max=max;slider.step=step;slider.value=settings[key];slider.setAttribute('aria-label',tr('manga_'+key)+' slider');
    const invalidate=()=>{result=null;apply.disabled=true;state.textContent=tr('previewPending');};
    slider.oninput=()=>{input.value=slider.value;invalidate();};
    input.oninput=()=>{const value=Number(input.value);if(input.value!==''&&Number.isFinite(value)&&value>=min&&value<=max)slider.value=value;invalidate();};
    inputs.push([key,input,min,max,slider]);group.append(slider,input);row.append(el('span','',tr('manga_'+key)),group);controls.append(row);
  }
  const white=el('input');white.type='checkbox';white.checked=!!settings.white_lines;white.setAttribute('aria-label',tr('manga_white_lines'));white.onchange=()=>{result=null;apply.disabled=true;};
  const wr=el('label','ph3-field');wr.append(el('span','',tr('manga_white_lines')),white);controls.append(wr);
  const background=el('div','ph3-preview-backgrounds');for(const[key,color]of [['checker',''],['white','#fff'],['black','#111'],['green','#61b499']]){const b=el('button','ph3-bg-swatch');b.title=tr(key);b.setAttribute('aria-label',tr(key));if(color)b.style.background=color;b.onclick=()=>{for(const img of [before,after]){img.style.backgroundColor=color;img.style.backgroundImage=color?'none':'';}};background.append(b);}visual.append(background);
  const preview=el('button','',tr('preview')),apply=el('button','primary',tr('mangaApply')),generate=el('button','',tr('mangaGenerate'));apply.dataset.tone=generate.dataset.tone='green';preview.dataset.tone='blue';
  const choices=el('select');choices.hidden=true;choices.setAttribute('aria-label',tr('generatedCandidate'));choices.onchange=()=>{index=Number(choices.value);after.src=client.assetURL(review.results[index].asset);};controls.append(choices);
  if(ph3){actions.prepend(generate,apply);apply.textContent=tr('applyResult');controls.append(el('p','ph3-small',tr('inlineReviewHint')));preview.hidden=true;after.hidden=true;}else{actions.prepend(preview,apply);}apply.disabled=true;
  function read(){for(const[key,input,min,max]of inputs){const v=Number(input.value);if(!Number.isFinite(v)||v<min||v>max)throw Error(tr('mangaInvalid'));settings[key]=v;}settings.white_lines=white.checked?.4:0;
    if(!Number.isInteger(settings.screen_lines)||settings.white_point-settings.black_point<.05||settings.light_tone>settings.dark_tone)throw Error(tr('mangaInvalid'));return clone(settings);}
  async function busy(fn){if(running||closed)return;running=true;const disabled=[...box.querySelectorAll('button:not([data-ph3-close]):not([data-ph3-job-stop]),input,select')].map(n=>[n,n.disabled]);disabled.forEach(([n])=>n.disabled=true);state.textContent=tr('working');state.classList.remove('error');try{await fn();}catch(e){if(!closed){state.textContent=e.message;state.classList.add('error');}}finally{running=false;progress.finish();disabled.forEach(([n,v])=>n.disabled=v);apply.disabled=ph3?!review:!result;}}
  async function ensureSource(){if(source)return source;
    const asset=layer.processing?.action==='manga_finish'?layer.processing.source_asset||layer.asset:layer.asset;
    const snapshot={...doc,transparent:true,layers:[{...layer,asset,visible:true}]};
    source=await client.upload(await toBlob(await exportCanvas(snapshot,cache,{background:false})));
    if(!closed){before.src=client.assetURL(source.asset);if(!ph3)after.src=before.src;}return source;
  }
  preview.onclick=()=>busy(async()=>{const p=read(),src=await ensureSource();const out=await client.post('/process',{action:'manga_finish',asset:src.asset,settings:p});if(closed)return;result=out;after.src=client.assetURL(out.asset);state.classList.remove('error');state.textContent=tr('mangaPreviewReady')+` (${out.settings.effective_screen_lines})`;});
  apply.onclick=()=>busy(async()=>{if(ph3){if(!review)return;if(await onAdopt(review,index)===false)return;}else{if(!result)return;await onApply(result);}finish();});
  generate.onclick=()=>busy(async()=>{review=null;after.hidden=true;choices.hidden=true;progress.prepare();const p=read(),src=await ensureSource();if(closed)return;const job=await onGenerate(src.asset,p,preset);if(closed)return;state.textContent=tr('waiting');review=await progress.watch(job,{signal:watch.signal});if(!review){state.textContent=tr('stopped');return;}index=0;choices.replaceChildren();review.results.forEach((r,i)=>{const o=el('option','',String(i+1));o.value=i;choices.append(o);});choices.hidden=review.results.length<2;after.src=client.assetURL(review.results[0].asset);after.hidden=false;state.textContent=tr('inlineReviewReady');});
  if(catalog?.manga_available===false){preview.disabled=generate.disabled=true;state.textContent=tr('mangaUnavailable');}
  await busy(async()=>{await ensureSource();if(!closed)state.textContent=tr(ph3?'mangaGenerateReady':'mangaPreviewHint');});
}
