import {canvas,modifiedRaster} from './render.mjs?v=01bc95baa1764cb1';

const el=(tag,cls='',text='')=>Object.assign(document.createElement(tag),{className:cls,textContent:text});

export async function openSelectionBlend({layer,recipe,alreadyApplied,client,cache,modal,tr,sliderField,onApply}) {
  const {region,source_asset,mask_asset}=layer.generation;
  const [x,y,w,h]=region;
  const input={region,source_asset,result_asset:recipe.result_asset,selection_asset:recipe.selection_asset,mask_asset};
  const settings={feather:recipe.feather,color_strength:recipe.color_strength};
  let closed=false,applying=false,controller=null,timer=null,revision=0,render=null;
  const {box,body,actions,finish}=modal(tr('selectionBlend'),{maximizable:true,canDismiss:()=>!applying});
  box.classList.add('ph3-processing','ph3-selection-blend');
  const layout=el('div','ph3-processing-layout'),comparison=el('div','ph3-comparison'),controls=el('div','ph3-processing-controls');
  const scale=Math.min(1,1024/Math.max(w,h)),width=Math.max(1,Math.round(w*scale)),height=Math.max(1,Math.round(h*scale));
  const before=canvas(width,height),after=canvas(width,height);
  for(const [key,target] of [['blendCurrent',before],['blendAdjusted',after]]){
    target.className='ph3-process-canvas';target.setAttribute('aria-label',tr(key));
    const panel=el('div','ph3-compare-panel');
    panel.append(el('span','ph3-compare-label',tr(key)),target);comparison.append(panel);
  }
  layout.append(comparison,controls);body.append(layout);
  controls.append(el('p','ph3-small',tr('blendHint')));
  const message=el('p','ph3-process-status',tr('previewPending'));message.setAttribute('role','status');controls.append(message);
  const apply=el('button','primary',tr('applyBlend'));apply.dataset.tone='green';apply.type='button';apply.disabled=true;actions.prepend(apply);
  const showError=error=>{message.textContent=error.message;message.classList.add('error');};
  const ready=()=>{
    message.textContent=tr('blendPreviewReady');
    apply.disabled=alreadyApplied&&settings.feather===recipe.feather&&settings.color_strength===recipe.color_strength;
  };
  box.addEventListener('ph3-close',()=>{closed=true;clearTimeout(timer);controller?.abort();},{once:true});

  async function preview(){
    if(closed||applying||controller||!render)return;
    const version=revision;
    controller=new AbortController();
    try{
      const image=await createImageBitmap(await client.previewSelectionBlend({...input,...settings},controller.signal));
      try{
        if(closed||version!==revision)return;
        render(after,image);ready();
      }finally{image.close();}
    }catch(error){if(!closed&&version===revision)showError(error);}
    finally{
      controller=null;
      if(!closed&&version!==revision){clearTimeout(timer);timer=setTimeout(preview,0);}
    }
  }
  function change(key,value){
    if(applying||settings[key]===value)return;
    settings[key]=value;revision++;apply.disabled=true;
    message.classList.remove('error');message.textContent=tr('previewPending');
    clearTimeout(timer);timer=setTimeout(preview,180);
  }
  for(const [key,label,max] of [['feather',recipe.selection_asset?'blendFeather':'blendLegacyFeather',64],['color_strength','blendColor',100]]){
    const update=value=>change(key,value);
    sliderField(controls,label,settings[key],update,0,max,1,update);
    const [range,number]=controls.lastElementChild.querySelectorAll('input');
    number.onchange=()=>{
      const value=number.value===''?settings[key]:Math.max(0,Math.min(max,Math.round(Number(number.value))));
      range.value=number.value=value;
      update(value);
    };
  }
  apply.onclick=async()=>{
    if(applying||apply.disabled)return;
    applying=true;apply.disabled=true;
    const fields=[...controls.querySelectorAll('input')];fields.forEach(field=>field.disabled=true);
    message.classList.remove('error');message.textContent=tr('processingFull');
    try{
      const result=await client.post('/selection/reblend',{...input,...settings});
      if(!closed){await onApply(result,{...settings});finish();}
    }catch(error){
      if(!closed){showError(error);apply.disabled=false;fields.forEach(field=>field.disabled=false);}
    }finally{applying=false;}
  };

  try{
    const [source,result,mask]=await Promise.all([
      cache.get(source_asset),cache.get(layer.asset),layer.mask_asset?cache.get(layer.mask_asset):null
    ]);
    if(closed)return;
    render=(target,patch)=>{
      const ctx=target.getContext('2d');
      ctx.clearRect(0,0,width,height);
      ctx.drawImage(source,x,y,w,h,0,0,width,height);
      ctx.globalAlpha=layer.opacity;
      ctx.drawImage(patch,0,0,width,height);
      ctx.globalAlpha=1;
    };
    const current=modifiedRaster(layer,result,mask);
    render(before,current);render(after,current);
    if(revision)await preview();
    else ready();
  }catch(error){if(!closed)showError(error);}
}
