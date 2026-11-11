import {clone} from './core.mjs?v=18a51c11ff11998e';

// A result fingerprint separates a live adjustment from its baked provenance.
// Legacy results with processing/paint modifiers cannot prove the old source is
// still current; keep their metadata but offer a new adjustment on current pixels.
export function editableRetouch(layer){
  const edit=layer?.retouch;if(!edit)return null;
  if(edit.result_asset)return edit.result_asset===layer.asset&&!layer.mask_asset&&!layer.colorize?edit:null;
  return !layer.processing&&!layer.paint&&!layer.mask_asset&&!layer.colorize?edit:null;
}
export function bakeRetouch(layer){
  if(layer.retouch){layer.retouch_history=[...(layer.retouch_history||[]),clone(layer.retouch)].slice(-16);delete layer.retouch;}
  return layer;
}
