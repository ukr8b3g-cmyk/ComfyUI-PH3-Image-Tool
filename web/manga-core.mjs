import {clone,uid,makeLayer,ensureLayerCapacity,imageInsertionIndex,isDecorationLayer} from './core.mjs?v=59a8d35b929e86cd';
export const MANGA_DEFAULTS=Object.freeze({screen_lines:200,white_point:.8,black_point:.3,light_tone:.18,dark_tone:.42,gradation:1,white_lines:.4});
export const MANGA_ROLES=['paper','tone','ink','white'];
export function addMangaLayers(doc,result,{sourceId=null,sourceSignature=null,names={},generation=null,preserveExisting=false}={}) {
  if(!Array.isArray(result.layers)||result.layers.length!==4||MANGA_ROLES.some(r=>!result.layers.some(l=>l.role===r&&l.asset)))throw Error('Invalid manga layer bundle');
  ensureLayerCapacity(doc,4);
  if(result.width!==doc.width||result.height!==doc.height)throw Error('Manga canvas size changed; render again');
  const source=doc.layers.find(l=>l.id===sourceId),matches=source&&(!sourceSignature||JSON.stringify(source)===sourceSignature);
  const group=uid(),previous=matches?source.processing?.manga_group:null;
  if(!preserveExisting&&matches&&(source.locked||(previous&&doc.layers.some(l=>l.processing?.manga_group===previous&&l.locked))))throw Error('Unlock the manga layers before replacing this group');
  let at=matches?doc.layers.indexOf(source)+1:imageInsertionIndex(doc);
  if(at<0)at=doc.layers.length;
  const layers=MANGA_ROLES.map(role=>makeLayer('image',doc.width,doc.height,{
    asset:result.layers.find(l=>l.role===role).asset,name:names[role]||role,
    x:0,y:0,w:doc.width,h:doc.height,rotation:0,opacity:1,mask_asset:null,
    ...(source&&isDecorationLayer(source)?{decoration:true}:{}),
    processing:{action:'manga_finish',manga_group:group,role,source_asset:result.source_asset,settings:clone(result.settings)},
    ...(generation?{generation:clone(generation)}:{})
  }));
  // Preserve originals and all decorations; only the adopted source/group is hidden.
  if(!preserveExisting&&matches){source.visible=false;if(previous)for(const l of doc.layers)if(l.processing?.manga_group===previous)l.visible=false;}
  doc.layers.splice(at,0,...layers);
  doc.settings.manga_settings=clone(result.settings);
  if(result.has_alpha)doc.transparent=true;
  return layers;
}
