// View-only cursor; never part of exported rasters or document history.
export function brushOverlay(viewport,read){
  const ring=document.createElement('div');ring.className='ph3-brush-ring';ring.setAttribute('aria-hidden','true');ring.hidden=true;
  const core=document.createElement('i');ring.append(core);
  const hud=document.createElement('div');hud.className='ph3-brush-hud';hud.setAttribute('aria-hidden','true');hud.hidden=true;viewport.append(ring,hud);
  let point=null,timer=null,flashing=false;
  function refresh(){
    const options=read(),show=point&&['paint','pixelEraser','brush','erase','aiBrush'].includes(options.tool)&&!options.blocked;
    ring.hidden=!show;if(!show){hud.hidden=true;return;}
    const size=Math.max(1,options.size*options.zoom),hardness=['paint','pixelEraser'].includes(options.tool)?options.hardness:100;
    ring.style.width=size+'px';ring.style.height=size+'px';ring.style.left=point.x+'px';ring.style.top=point.y+'px';
    ring.style.setProperty('--brush-color',options.color||'#54c8de');core.style.width=core.style.height=Math.max(0,hardness)+'%';ring.classList.toggle('resizing',!!options.resizing);
    hud.textContent=Math.round(options.size)+' px';
    if(options.tool==='paint')hud.textContent+=' · '+Math.round(hardness)+'% · '+Math.round(options.opacity??100)+'%';
    if(options.tool==='pixelEraser')hud.textContent+=' · '+Math.round(hardness)+'%';
    hud.style.left=Math.max(4,Math.min(viewport.clientWidth-185,point.x+18))+'px';hud.style.top=Math.max(4,Math.min(viewport.clientHeight-30,point.y+18))+'px';hud.hidden=!(flashing||options.resizing);
  }
  return {update(event){const r=viewport.getBoundingClientRect();point={x:event.clientX-r.left,y:event.clientY-r.top};refresh();},refresh,
    flash(){flashing=true;clearTimeout(timer);refresh();timer=setTimeout(()=>{flashing=false;refresh();},900);},
    hide(){if(read().resizing)return;point=null;ring.hidden=hud.hidden=true;},
    dispose(){clearTimeout(timer);ring.remove();hud.remove();}};
}
