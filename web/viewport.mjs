/** View-only geometry. Never changes the document, layers, selection or output pixels. */
const rad = degrees => degrees * Math.PI / 180;
const clamp = (n,a,b) => Math.max(a,Math.min(b,n));
export function toScreen(point, view, size, viewport) {
  const a=rad(view.angle||0),x=(point.x-size.width/2)*view.zoom,y=(point.y-size.height/2)*view.zoom;
  return {x:viewport.width/2+view.x+x*Math.cos(a)-y*Math.sin(a),y:viewport.height/2+view.y+x*Math.sin(a)+y*Math.cos(a)};
}
export function toDocument(point, view, size, viewport) {
  const a=-rad(view.angle||0),x=point.x-viewport.width/2-view.x,y=point.y-viewport.height/2-view.y;
  return {x:(x*Math.cos(a)-y*Math.sin(a))/view.zoom+size.width/2,y:(x*Math.sin(a)+y*Math.cos(a))/view.zoom+size.height/2};
}
export function anchoredView(view, changes, anchor, size, viewport) {
  const p=toDocument(anchor,view,size,viewport),next={...view,...changes};
  next.zoom=clamp(next.zoom,.02,16);const after=toScreen(p,next,size,viewport);
  next.x+=anchor.x-after.x;next.y+=anchor.y-after.y;return next;
}
export function fitView(size, viewport, angle=0) {
  const a=rad(angle),w=Math.abs(size.width*Math.cos(a))+Math.abs(size.height*Math.sin(a)),h=Math.abs(size.width*Math.sin(a))+Math.abs(size.height*Math.cos(a));
  return {zoom:clamp(Math.min((viewport.width-64)/w,(viewport.height-64)/h,1),.02,16),x:0,y:0,angle};
}
export function wheelPixels(event, viewportHeight=800) {
  const factor=event.deltaMode===1?16:event.deltaMode===2?viewportHeight:1;
  return clamp(Number(event.deltaY||0)*factor,-400,400);
}
export const HANDLES=Object.freeze([['nw',-1,-1],['n',0,-1],['ne',1,-1],['e',1,0],['se',1,1],['s',0,1],['sw',-1,1],['w',-1,0]]);
export function handlePoints(layer, zoom) {
  return [...HANDLES.map(([id,x,y])=>({id,x:(x+1)*layer.w/2,y:(y+1)*layer.h/2})),{id:'rotate',x:layer.w/2,y:-28/zoom},...(layer.type==='bubble'&&layer.shape!=='none'&&layer.tailStyle!=='none'?[{id:'tail',x:layer.w*layer.tailX,y:layer.h*layer.tailY}]:[])];
}
export function visibleHandlePoints(layer,view,size,viewport) {
  const points=handlePoints(layer,view.zoom),handle=points.find(p=>p.id==='rotate'),gap=28/view.zoom,margin=7/view.zoom;
  const angle=rad(layer.rotation||0);
  const visible=p=>{
    const dx=p.x-layer.w/2,dy=p.y-layer.h/2;
    const world={x:layer.x+layer.w/2+dx*Math.cos(angle)-dy*Math.sin(angle),y:layer.y+layer.h/2+dx*Math.sin(angle)+dy*Math.cos(angle)};
    const screen=toScreen(world,view,size,viewport);
    return world.x>=margin&&world.y>=margin&&world.x<=size.width-margin&&world.y<=size.height-margin&&screen.x>=7&&screen.y>=7&&screen.x<=viewport.width-7&&screen.y<=viewport.height-7;
  };
  const candidates=[{x:layer.w/2,y:-gap,anchorY:0},{x:layer.w/2,y:Math.min(gap,layer.h/2),anchorY:0},{x:layer.w/2,y:layer.h+gap,anchorY:layer.h},{x:layer.w/2,y:Math.max(layer.h/2,layer.h-gap),anchorY:layer.h}];
  Object.assign(handle,candidates.find(visible)||candidates[1]);return points;
}
/** Resize about the opposite handle. Rotation and the opposite anchor are preserved. */
export function resizeLayer(layer, handle, delta, keepAspect=true) {
  const entry=HANDLES.find(h=>h[0]===handle);if(!entry)return {...layer};
  const [,hx,hy]=entry,a=rad(layer.rotation),dx=delta.x*Math.cos(a)+delta.y*Math.sin(a),dy=-delta.x*Math.sin(a)+delta.y*Math.cos(a);
  let w=hx?clamp(layer.w+hx*dx,1,32768):layer.w,h=hy?clamp(layer.h+hy*dy,1,32768):layer.h;
  if(hx&&hy&&keepAspect){const scale= Math.abs(w/layer.w-1)>=Math.abs(h/layer.h-1)?w/layer.w:h/layer.h;
    const safe=clamp(scale,Math.max(1/layer.w,1/layer.h),Math.min(32768/layer.w,32768/layer.h));w=layer.w*safe;h=layer.h*safe;}
  const cx=layer.x+layer.w/2,cy=layer.y+layer.h/2,lx=hx*(w-layer.w)/2,ly=hy*(h-layer.h)/2;
  return {...layer,w,h,x:cx+lx*Math.cos(a)-ly*Math.sin(a)-w/2,y:cy+lx*Math.sin(a)+ly*Math.cos(a)-h/2};
}
