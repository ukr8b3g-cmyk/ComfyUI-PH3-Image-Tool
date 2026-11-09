// Four shared accents. Labels/icons and selected borders remain authoritative.
export function actionTone(key){
  if(['close','cancel','cancelRetouch','stop','stopThisGeneration','remove','deleteSelection','dismissCandidate','historyTab'].includes(key))return 'red';
  if(['properties','newProject','openProject','settings','chooseFolder','defaultFolder','enhance','returnToEditing','openGeneration'].includes(key))return 'blue';
  if(['layers','help','export','exportProject','portable','copySelection'].includes(key))return 'amber';
  if(['generate','save','apply','applyRetouch','letteringGenerate','letteringSaveFinish','comicApply','applyResult','mangaApply','mangaGenerate','ok','useFolder','restoreDraft','useText'].includes(key))return 'green';
  return '';
}

export function brushShortcut(event,size,hardness){
  if(event.ctrlKey||event.metaKey||event.altKey||event.isComposing||event.getModifierState?.('AltGraph'))return null;
  const left=['[','{'].includes(event.key)||event.code==='BracketLeft',right=[']','}'].includes(event.key)||event.code==='BracketRight';
  const direction=left?-1:right?1:0;
  if(!direction)return null;
  if(event.shiftKey)return {size,hardness:Math.max(0,Math.min(100,hardness+direction*10))};
  return {size:Math.max(1,Math.min(512,direction<0?Math.min(size-1,Math.round(size*.85)):Math.max(size+1,Math.round(size*1.18)))),hardness};
}

export function draggedBrush(size,hardness,dx,dy){
  return {size:Math.max(1,Math.min(512,Math.round(size+dx))),hardness:Math.max(0,Math.min(100,Math.round(hardness-dy*.5)))};
}
