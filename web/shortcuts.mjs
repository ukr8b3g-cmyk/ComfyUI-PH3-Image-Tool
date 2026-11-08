// Resolve editor commands without stealing text editing, IME or AltGr input.
export function editorShortcut(e,{typing=false,blocked=false}={}) {
  if(typing||blocked||e.defaultPrevented||e.isComposing||e.keyCode===229||e.getModifierState?.('AltGraph'))return null;
  const key=e.key.toLowerCase(),ctrl=e.ctrlKey||e.metaKey;
  const bracket=key==='['||key==='{'?-1:key===']'||key==='}'?1:0;
  if(ctrl&&e.altKey)return null;
  if(bracket&&ctrl)return (e.shiftKey?'edge:':'order:')+bracket;
  if(bracket&&e.altKey&&!e.shiftKey)return 'select:'+bracket;
  if(e.altKey)return null;
  if(ctrl){
    if(key==='+'||key==='=')return 'zoomIn';
    if(e.shiftKey)return ({i:'invertSelection',e:'mergeVisible'})[key]||null;
    return ({j:'duplicate',d:'deselect',a:'selectAll',t:'transform',n:'newProject',o:'openProject','+':'zoomIn','=':'zoomIn','-':'zoomOut'})[key]||null;
  }
  if(!e.shiftKey&&(key==='delete'||key==='backspace'))return 'remove';
  return null;
}
