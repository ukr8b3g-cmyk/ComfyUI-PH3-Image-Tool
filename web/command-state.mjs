import {NATIVE_IMAGE,hasGenerationSource,resolveGenerationMode} from './core.mjs?v=01bc95baa1764cb1';

// UI eligibility only. Command handlers retain their validation and race guards.
export function commandState(key,{doc,selected,hasSelection=false,clipboard=null,history={},modelsReady=true,enhancerAvailable=true,mode='new',inputAsset=null}){
 const layers=doc.layers,index=layers.findIndex(l=>l.id===selected),layer=layers[index],visible=layers.filter(l=>l.visible),images=visible.filter(l=>l.type==='image'),image=layer?.type==='image'?layer:images.length===1?images[0]:null;
 const room=layers.length<256,editable=!image?'needImage':image.locked?'lockedHint':!image.visible?'needVisibleImage':null;
 const hasSource=hasGenerationSource(doc),scope=resolveGenerationMode(mode,hasSource,hasSelection);
 const choose=!layer?'needLayer':null,unlock=choose||(layer.locked?'lockedHint':null),selection=hasSelection?null:'needSelection';
 const missingSource=scope==='new'||hasSource?null:'needImage';
 const generationScopeError=(scope==='selection'?selection:null)||missingSource;
 let reason;
 switch(key){
 case 'maskLayer':reason=editable||selection;break;
 case 'clearLayerMask':reason=editable||(!image.mask_asset?'noLayerMask':null);break;
 case 'comic':case 'cutout':reason=editable||(!room?'layerCapacity':null);break;
 case 'duplicate':case 'duplicatePixels':reason=choose||(!room?'layerCapacity':null);break;
 case 'remove':reason=unlock;break;
 case 'up':reason=unlock||(index===layers.length-1?'alreadyFront':null);break;
 case 'down':reason=unlock||(index===0?'alreadyBack':null);break;
 case 'mergeVisible':reason=!visible.length?'needVisibleLayers':visible.some(l=>l.locked)?'mergeLocked':!room?'layerCapacity':null;break;
 case 'clear':case 'erase':case 'selectionSubtract':case 'selectionIntersect':reason=selection;break;
 case 'copyPixels':reason=choose||(!layer.visible?'needVisibleImage':hasSelection&&layer.type!=='image'?'needImage':null);break;
 case 'cutPixels':reason=unlock||(!layer.visible?'needVisibleImage':hasSelection&&layer.type!=='image'?'needImage':null);break;
 case 'copyMerged':reason=!visible.length?'needVisibleLayers':null;break;
 case 'pastePixels':reason=!room?'layerCapacity':!clipboard?'noInternalClipboard':null;break;
 case 'changeSelectionColor':case 'retouchbrightness_contrast':case 'retouchcurves':case 'retouchhue_saturation':case 'fillSelection':case 'copySelection':reason=editable||(!room?'layerCapacity':null);break;
 case 'deleteSelection':reason=editable||selection;break;
 case 'pixelEraser':reason=choose||(layer.type==='image'?editable:'needImage');break;
 case 'generateSelection':reason=!modelsReady?'setupFirst':selection||(!hasSource?'needImage':null);break;
 case 'letteringSelection':reason=selection||(!room?'layerCapacity':null);break;
 case 'image':case 'addText':case 'bubble':case 'speed':case 'frame':case 'sourceStamps':case 'aiLettering':reason=!room?'layerCapacity':null;break;
 case 'input':reason=!inputAsset?'noNodeInput':!room?'layerCapacity':null;break;
 case 'addReference':reason=(doc.references?.length||0)>=7?'referenceCapacity':null;break;
 case 'undo':reason=!history.past?.length?'nothingUndo':null;break;
 case 'redo':reason=!history.future?.length?'nothingRedo':null;break;
 case 'generate':reason=!modelsReady?'setupFirst':generationScopeError;break;
 case 'enhance':
  if(!doc.prompt?.original?.trim())reason='needPrompt';
  else if(doc.settings?.model_engine===NATIVE_IMAGE&&!enhancerAvailable)reason='choosePromptEnhancer';
  else if(doc.settings?.model_engine!==NATIVE_IMAGE&&(!modelsReady||!enhancerAvailable))reason='setupFirst';
  else reason=generationScopeError;
  break;
 default:return null;
 }
 return {disabled:!!reason,reason:reason||null};
}
