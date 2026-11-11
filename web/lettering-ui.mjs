import {clone,makeLayer} from './core.mjs?v=18a51c11ff11998e';
import {canvas,drawLayer,toBlob} from './render.mjs?v=18a51c11ff11998e';
import {fitTextBox} from './source-text.mjs?v=18a51c11ff11998e';
import {prepareFonts} from './source-fonts.mjs?v=18a51c11ff11998e';
import {inlineProgress} from './inline-progress.mjs?v=18a51c11ff11998e';

const el=(tag,cls='',text='')=>{const n=document.createElement(tag);n.className=cls;n.textContent=text;return n;};
const select=(items,value)=>{const n=el('select');for(const item of items){const o=el('option','',item.label);o.value=item.value;o.disabled=!!item.disabled;n.append(o);}n.value=value;return n;};

// Isolate the requested layer; never flatten the page into a lettering reference.
export async function letteringReference(layer,options,cache){
  const copy=clone(layer),w=options.vertical?768:1280,h=options.vertical?1280:768,out=canvas(w,h),ctx=out.getContext('2d');
  copy.visible=true;copy.opacity=1;copy.rotation=0;
  if(copy.type==='text'){
    copy.text=options.text;copy.vertical=options.vertical;copy.writing=options.vertical?(String(copy.writing||'').startsWith('vertical')?copy.writing:'vertical-rl'):'horizontal';
    await prepareFonts({layers:[copy]});await document.fonts.ready;fitTextBox(ctx,copy,false);
  }
  const prepared=copy.type==='image'?await cache.prepare({layers:[copy]}):new Map();copy.x=0;copy.y=0;
  const scale=Math.min(w*.65/copy.w,h*.65/copy.h);ctx.fillStyle='#ffffff';ctx.fillRect(0,0,w,h);ctx.save();ctx.translate((w-copy.w*scale)/2,(h-copy.h*scale)/2);ctx.scale(scale,scale);drawLayer(ctx,copy,prepared);ctx.restore();return out;
}

export function letteringDefaults(value={}){
  const legacy={round:['pop','none'],thin:['thin','none'],spiky:['angular','spiky'],thought:['angular','thought'],vibration:['angular','vibration'],wavy:['angular','wavy']};
  const [style,decoration]=legacy[value.preset]||[value.preset||'angular','none'];
  return {style,decoration,color_mode:'black',color:'#ff2020',gradient_end:'#ff9c00',gradient_direction:'vertical',tremble_strength:.75,...value};
}
export function sameLetteringGeometry(a,b){return ['text','style','decoration','vertical'].every(k=>a[k]===b[k]);}

export function openLettering({layer,doc,projectId,jobs,client,cache,catalog,modal,field,button,tr,onGenerate,onFinish,onAdopt,followup=null,shared}){
  const textLayer=layer.type==='text'?layer:makeLayer('text',doc.width,doc.height,{text:''});
  const {body,actions,finish,box}=modal(tr('aiLettering'),{maximizable:true});box.classList.add('ph3-lettering-modal');body.classList.add('ph3-lettering-body');
  const progress=inlineProgress({box,client,tr,shared});
  const controls=el('div','ph3-lettering-controls'),previews=el('aside','ph3-lettering-previews');body.append(controls,previews);
  const initial=letteringDefaults(followup?.job.request.lettering||{});
  let active=true,epoch=0,timer=null,vertical=followup?!!initial.vertical:!!layer.vertical,working=false;
  controls.append(el('p','ph3-small',tr(followup?'letteringFollowupIntro':'letteringIntro')));
  const text=el('textarea');text.value=followup?initial.text:layer.text||'';text.maxLength=128;text.rows=2;field(controls,'letteringText',text,true);
  const direction=el('div','ph3-text-segments');direction.setAttribute('role','group');
  const horizontal=button('horizontalWriting',()=>setDirection(false)),vert=button('vertical',()=>setDirection(true));direction.append(horizontal,vert);field(controls,'writingDirection',direction);
  function setDirection(value){vertical=value;horizontal.setAttribute('aria-pressed',String(!vertical));vert.setAttribute('aria-pressed',String(vertical));schedule();}
  const localized=items=>items.map(p=>({value:p.id,label:p[doc.settings.locale==='en'?'en':'ja']}));
  const style=select(localized(catalog.lettering_styles),initial.style);field(controls,'letteringStyle',style);
  const decoration=select(localized(catalog.lettering_decorations),initial.decoration);field(controls,'letteringDecoration',decoration);
  const tremble=el('div','ph3-lettering-strength'),slider=el('input'),number=el('input');slider.type='range';number.type='number';
  for(const c of [slider,number]){c.min=0;c.max=1;c.step=.05;c.value=initial.tremble_strength;c.setAttribute('aria-label',tr('letteringTremble'));c.addEventListener('input',()=>{(c===slider?number:slider).value=c.value;schedule();});}
  tremble.append(slider,number);field(controls,'letteringTremble',tremble);const trembleField=controls.lastChild;
  const colorMode=select(['black','solid','gradient'].map(value=>({value,label:tr('letteringColor'+value)})),initial.color_mode);field(controls,'letteringColorMode',colorMode);
  const color=el('input');color.type='color';color.value=initial.color;field(controls,'letteringColorStart',color);const colorField=controls.lastChild;
  const end=el('input');end.type='color';end.value=initial.gradient_end;field(controls,'letteringColorEnd',end);const endField=controls.lastChild;
  const gradient=select(['horizontal','vertical','diagonal'].map(value=>({value,label:tr('letteringGradient'+value)})),initial.gradient_direction);field(controls,'letteringGradientDirection',gradient);const gradientField=controls.lastChild;
  controls.append(el('p','ph3-small',tr('letteringColorHelp')));
  const use=el('input');use.type='checkbox';use.checked=!!followup;field(controls,'letteringUseReference',use);
  const sourceBox=el('div','ph3-lettering-reference');controls.append(sourceBox);
  const images=doc.layers.filter(l=>l.type==='image');
  const candidates=jobs.filter(j=>j.status==='succeeded').flatMap(j=>(j.results||[]).map((r,index)=>({value:j.id+':'+index,label:(j.request.lettering?.text||j.request.mode)+' · '+(index+1)+' · '+new Date(j.created_at*1000).toLocaleTimeString(),job:j,jobId:j.id,index,asset:r.preserved_lettering_asset||r.raw_asset||r.asset})));
  const kind=select([{value:'candidate',label:tr('letteringReferenceCandidate'),disabled:!candidates.length},{value:'layer',label:tr('letteringReferenceLayer'),disabled:!images.length},{value:'text',label:tr('letteringReferenceText')}],followup?'candidate':candidates.length?'candidate':images.length?'layer':'text');field(sourceBox,'letteringReferenceSource',kind);
  const imageSelect=select(images.map(l=>({value:l.id,label:l.name||l.type})),images[0]?.id||'');field(sourceBox,'letteringImageLayer',imageSelect,true);const imageField=sourceBox.lastChild;
  const candidateSelect=select(candidates,followup?followup.job.id+':'+followup.index:candidates[0]?.value||'');field(sourceBox,'letteringCandidate',candidateSelect,true);const candidateField=sourceBox.lastChild;
  const preview=el('img','ph3-lettering-reference-preview'),referenceCaption=el('p','ph3-small',tr('letteringReferencePreview'));preview.alt=tr('letteringReferencePreview');previews.append(referenceCaption,preview);
  const finishPreview=el('img','ph3-lettering-finish-preview'),finishCaption=el('p','ph3-small',tr('letteringFinishPreview'));finishPreview.alt=tr('letteringFinishPreview');finishPreview.hidden=true;previews.append(finishCaption,finishPreview);
  const info=el('p','ph3-small');controls.append(info);
  const advanced=el('details','ph3-processing-details');advanced.append(el('summary','',tr('letteringDetails')));controls.append(advanced);
  const transparent=el('input');transparent.type='checkbox';transparent.checked=initial.transparent!==false;field(advanced,'letteringTransparent',transparent);
  const prompt=el('textarea','ph3-lettering-prompt');prompt.readOnly=true;field(advanced,'letteringPrompt',prompt,true);
  const error=el('p','ph3-small');error.setAttribute('role','status');controls.append(error);
  const watch=new AbortController();let review=null,reviewIndex=0;
  const reviewBox=el('section','ph3-inline-results'),reviewImage=el('img','ph3-lettering-finish-preview'),reviewSelect=el('select');reviewBox.hidden=true;reviewImage.alt=tr('generatedCandidate');reviewSelect.setAttribute('aria-label',tr('generatedCandidate'));reviewBox.append(el('p','ph3-small',tr('generatedCandidate')),reviewSelect,reviewImage);previews.append(reviewBox);
  reviewSelect.onchange=()=>{reviewIndex=Number(reviewSelect.value);reviewImage.src=client.assetURL(review.results[reviewIndex].asset);};
  const apply=button('applyResult',async()=>{if(working||!review)return;working=true;apply.disabled=true;try{if(await onAdopt(review,reviewIndex)!==false)finish();}catch(e){error.textContent=e.message;error.classList.add('error');}finally{working=false;apply.disabled=!review;}});apply.disabled=true;actions.prepend(apply);
  function lockInputs(){const saved=[...controls.querySelectorAll('input,select,textarea,button')].map(c=>[c,c.disabled]);for(const[c]of saved)c.disabled=true;return()=>{for(const[c,v]of saved)c.disabled=v;};}
  async function showReview(job){
    if(!active)return;error.textContent=tr('waiting');error.classList.remove('error');
    const done=await progress.watch(job,{signal:watch.signal});if(!active)return;
    if(!done){working=false;schedule();error.textContent=tr('stopped');return;}
    working=false;schedule();review=done;reviewIndex=0;reviewSelect.replaceChildren();done.results.forEach((r,i)=>{const o=el('option','',String(i+1));o.value=i;reviewSelect.append(o);});reviewSelect.hidden=done.results.length<2;reviewImage.src=client.assetURL(done.results[0].asset);reviewBox.hidden=false;previews.hidden=false;body.classList.add('has-reference');box.classList.add('with-reference');apply.disabled=false;error.textContent=tr('inlineReviewReady');
  }
  const submit=button('letteringGenerate',async()=>{
    if(submit.disabled)return;working=true;schedule();error.textContent='';const opts=options(),selectedImage=images.find(l=>l.id===imageSelect.value),candidate=chosenCandidate();
    const payload={lettering:opts,...(layer.id?{source_layer_id:layer.id}:{})};
    if(opts.use_reference&&opts.reference_kind==='layer')payload.reference_layer_id=selectedImage?.id;
    if(opts.use_reference&&opts.reference_kind==='candidate'){payload.reference_job_id=candidate?.jobId;payload.reference_index=candidate?.index;}
    const unlock=lockInputs();progress.prepare();try{const job=await onGenerate(payload,async()=>{
      if(!opts.use_reference)return null;
      if(opts.reference_kind==='candidate'){if(!candidate)throw Error(tr('letteringSelectReference'));return candidate.asset;}
      const source=opts.reference_kind==='text'?textLayer:selectedImage;if(!source)throw Error(tr('letteringSelectReference'));
      return (await client.upload(await toBlob(await letteringReference(source,opts,cache)))).asset;
    });await showReview(job);}catch(e){if(active){error.textContent=e.message;error.classList.add('error');working=false;schedule();}}finally{progress.finish();unlock();if(active)submit.disabled=false;}
  },'primary');actions.prepend(submit);
  const saveFinish=button('letteringSaveFinish',async()=>{
    if(saveFinish.disabled)return;working=true;schedule();error.textContent='';const candidate=chosenCandidate();
    const unlock=lockInputs();try{await showReview(await onFinish({lettering:options(),reference_job_id:candidate.jobId,reference_index:candidate.index}));}
    catch(e){if(active){error.textContent=e.message;error.classList.add('error');working=false;schedule();}}finally{unlock();}
  });actions.prepend(saveFinish);
  function chosenCandidate(){return candidates.find(c=>c.value===candidateSelect.value);}
  function options(){return{text:text.value.trim(),preset:'angular',style:style.value,decoration:decoration.value,vertical,use_reference:use.checked,reference_kind:kind.value,transparent:transparent.checked,color_mode:colorMode.value,color:color.value,gradient_end:end.value,gradient_direction:gradient.value,tremble_strength:Number(number.value)};}
  function canFinish(opts,candidate){return use.checked&&kind.value==='candidate'&&candidate?.job.request.mode==='lettering'&&sameLetteringGeometry(opts,letteringDefaults(candidate.job.request.lettering));}
  function schedule(){
    review=null;reviewBox.hidden=true;apply.disabled=true;
    const token=++epoch;clearTimeout(timer);const opts=options(),candidate=chosenCandidate(),local=canFinish(opts,candidate);
    sourceBox.hidden=!use.checked;imageField.hidden=kind.value!=='layer';candidateField.hidden=kind.value!=='candidate';preview.hidden=true;referenceCaption.hidden=!use.checked;finishCaption.hidden=!local;if(!local)finishPreview.hidden=true;box.classList.toggle('with-reference',use.checked);body.classList.toggle('has-reference',use.checked);previews.hidden=!use.checked;
    trembleField.hidden=decoration.value!=='wavy';colorField.hidden=colorMode.value==='black';endField.hidden=gradientField.hidden=colorMode.value!=='gradient';
    info.textContent=tr(use.checked&&kind.value==='candidate'&&['spiky','thought'].includes(decoration.value)?'letteringPreservedBubble':use.checked?'letteringReferenceMode':'letteringT2IMode');
    submit.disabled=working||!text.value.trim()||!Number.isFinite(opts.tremble_strength)||use.checked&&(kind.value==='layer'&&!imageSelect.value||kind.value==='candidate'&&!candidateSelect.value);
    saveFinish.hidden=!use.checked||kind.value!=='candidate';saveFinish.disabled=working||!local;
    if(saveFinish.hidden===false&&!local)info.textContent+=' '+tr('letteringGenerateChanged');
    if(!text.value.trim()||working){prompt.value='';return;}
    timer=setTimeout(async()=>{try{
      const result=await client.post('/lettering/preview',opts);if(!active||token!==epoch)return;prompt.value=result.prompt;
      if(opts.use_reference){
        if(opts.reference_kind==='candidate'){if(candidate)preview.src=client.assetURL(candidate.asset);}
        else{const source=opts.reference_kind==='text'?textLayer:images.find(l=>l.id===imageSelect.value);if(source){const image=await letteringReference(source,opts,cache);if(!active||token!==epoch)return;preview.src=image.toDataURL('image/png');}}
        preview.hidden=!preview.src;
      }
      if(local){const processed=await client.post('/projects/'+projectId+'/lettering/finish',{lettering:opts,reference_job_id:candidate.jobId,reference_index:candidate.index});if(!active||token!==epoch)return;finishPreview.src=client.assetURL(processed.asset);finishPreview.hidden=false;}
    }catch(e){if(active&&token===epoch)error.textContent=e.message;}},160);
  }
  for(const c of [text,style,decoration,use,kind,imageSelect,candidateSelect,transparent,colorMode,color,end,gradient])c.addEventListener(c===text||c===color||c===end?'input':'change',schedule);
  box.addEventListener('ph3-close',()=>{active=false;watch.abort();epoch++;clearTimeout(timer);});setDirection(vertical);
  return{box,finish};
}
