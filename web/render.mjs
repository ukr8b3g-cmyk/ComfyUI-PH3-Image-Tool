import {isDecorationLayer} from './core.mjs?v=37e99894a6ee0379';
import {drawSourceSpeed} from './source-speed.mjs?v=37e99894a6ee0379';
import {drawSourceBubble} from './source-bubbles.mjs?v=37e99894a6ee0379';
import {drawSourceText} from './source-text.mjs?v=37e99894a6ee0379';
import {prepareFonts} from './source-fonts.mjs?v=37e99894a6ee0379';
import {readMask,maskCanvas} from './selection.mjs?v=37e99894a6ee0379';
export function canvas(w,h){const c=document.createElement('canvas');c.width=w;c.height=h;return c;}
export const imageRasterKey=l=>(l.mask_asset?l.asset+':'+l.mask_asset:l.asset)+(l.colorize?':tint:'+(l.tintColor||'#ffd42a'):'');
export const previewRasterKey=l=>'layer-preview:'+l.id;
export const layerRaster=(rasters,l)=>rasters.get(previewRasterKey(l))||rasters.get(imageRasterKey(l));
// Apply display-only modifiers once, to either an immutable source or a live
// layer-local preview. Raw paint assets never contain their display mask/tint.
export function modifiedRaster(layer,source,mask=null){
  if(!mask&&!layer.colorize)return source;
  const out=canvas(mask?.width||source.width,mask?.height||source.height),ctx=out.getContext('2d');
  ctx.drawImage(source,0,0,out.width,out.height);
  if(mask){ctx.globalCompositeOperation='destination-in';ctx.drawImage(maskCanvas(readMask(mask,out.width,out.height),out.width,out.height,true),0,0);}
  if(layer.colorize){ctx.globalCompositeOperation='source-in';ctx.fillStyle=layer.tintColor||'#ffd42a';ctx.fillRect(0,0,out.width,out.height);}
  return out;
}
export class RasterCache {
  constructor(assetUrl){this.assetUrl=assetUrl;this.images=new Map();this.masked=new Map();}
  async get(key) {
    if(!key)return null;
    if(!this.images.has(key)) {
      const job=new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(Error('Missing local image: '+key.slice(0,12)));img.src=this.assetUrl(key);});
      this.images.set(key,job);job.catch(()=>this.images.delete(key));
    }
    return this.images.get(key);
  }
  async prepare(doc) {
    const keys=new Set(doc.layers.filter(x=>x.type==='image'&&x.visible).flatMap(x=>[x.asset,x.mask_asset]).filter(Boolean));
    const output=new Map();await Promise.all([...keys].map(async k=>output.set(k,await this.get(k))));
    for(const l of doc.layers.filter(x=>x.type==='image'&&x.visible&&(x.mask_asset||x.colorize))){
      const key=imageRasterKey(l);
      if(!this.masked.has(key)){this.masked.set(key,modifiedRaster(l,output.get(l.asset),output.get(l.mask_asset)));if(this.masked.size>8)this.masked.delete(this.masked.keys().next().value);}
      output.set(key,this.masked.get(key));
    }
    return output;
  }
  dispose(){this.images.clear();this.masked.clear();}
}
function poly(ctx,points,close=true){ctx.beginPath();points.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));if(close)ctx.closePath();}
function paint(ctx,l){if(l.fill)ctx.fill();if(l.lineWidth>0)ctx.stroke();}
function text(ctx,l){drawSourceText(ctx,l);}
function bubble(ctx,l){
 if(l.shape==='dialogue'){ctx.beginPath();ctx.roundRect(0,0,l.w,l.h,20);paint(ctx,l);}
 else if(l.shape!=='none')drawSourceBubble(ctx,l);
 if(l.text){ctx.save();ctx.translate(l.w*.12,l.h*.12);text(ctx,{...l,w:l.w*.76,h:l.h*.76,fill:l.textFill||'#111111',stroke:l.textStroke||'#ffffff',lineWidth:l.textOutline||0});ctx.restore();}
}
function symbol(ctx,l) {
  const w=l.w,h=l.h;ctx.beginPath();
  if(l.symbol==='heart'){
    ctx.moveTo(w/2,h*.92);ctx.bezierCurveTo(-w*.35,h*.35,w*.1,-h*.25,w/2,h*.22);ctx.bezierCurveTo(w*.9,-h*.25,w*1.35,h*.35,w/2,h*.92);ctx.closePath();
  }else if(l.symbol==='arrow')poly(ctx,[[0,h*.32],[w*.62,h*.32],[w*.62,0],[w,h*.5],[w*.62,h],[w*.62,h*.68],[0,h*.68]]);
  else if(l.symbol==='sweat'){
    ctx.moveTo(w*.5,0);ctx.bezierCurveTo(w*.56,h*.4,w*.96,h*.5,w*.9,h*.75);ctx.bezierCurveTo(w*.85,h*1.1,w*.15,h*1.1,w*.1,h*.75);ctx.bezierCurveTo(w*.04,h*.5,w*.44,h*.4,w*.5,0);ctx.closePath();
  }else if(['star','sparkle'].includes(l.symbol)){
    const n=l.symbol==='star'?10:8;for(let i=0;i<n;i++){const a=-Math.PI/2+i/n*Math.PI*2,r=i%2?.35:.95;const x=w/2+Math.cos(a)*w/2*r,y=h/2+Math.sin(a)*h/2*r;i?ctx.lineTo(x,y):ctx.moveTo(x,y);}ctx.closePath();
  }else if(l.symbol==='cross')poly(ctx,[[w*.35,0],[w*.65,0],[w*.65,h*.35],[w,h*.35],[w,h*.65],[w*.65,h*.65],[w*.65,h],[w*.35,h],[w*.35,h*.65],[0,h*.65],[0,h*.35],[w*.35,h*.35]]);
  else if(l.symbol==='anger'){
    ctx.lineWidth=Math.max(3,l.lineWidth,w*.05);for(let i=0;i<4;i++){ctx.save();ctx.translate(w/2,h/2);ctx.rotate(i*Math.PI/2);ctx.beginPath();ctx.moveTo(w*.1,0);ctx.quadraticCurveTo(w*.1,-h*.25,w*.38,-h*.25);ctx.stroke();ctx.restore();}return;
  }else{text(ctx,{...l,text:({question:'?',exclamation:'!',music:'♪'})[l.symbol]||'!',fontSize:Math.min(w,h)*.9});return;}
  paint(ctx,l);
}
function speed(ctx,l){drawSourceSpeed(ctx,l);}
function frame(ctx,l) {
  if(l.frame==='source-white'||l.frame==='source-black'){
    // Port of buildFrameSurface's border branch (Speech-Bubble-Comic-Editor-App).
    const w=l.w,h=l.h,borderX=Math.min(l.lineWidth,w/2),borderY=Math.min(l.lineWidth,h/2),innerWidth=l.innerWidth||0,innerW=w-borderX*2,innerH=h-borderY*2;
    ctx.fillStyle=l.stroke;ctx.beginPath();ctx.rect(0,0,w,h);if(innerW>0&&innerH>0)ctx.rect(borderX,borderY,innerW,innerH);ctx.fill('evenodd');
    if(innerWidth>0&&innerW>innerWidth&&innerH>innerWidth){const x=borderX+innerWidth/2,y=borderY+innerWidth/2;ctx.strokeStyle=l.innerColor||'#111111';ctx.lineWidth=innerWidth;ctx.strokeRect(x,y,w-x*2,h-y*2);}return;
  }

  if(!(l.lineWidth>0))return;
  const inset=Math.max(2,l.lineWidth/2),w=l.w-inset*2,h=l.h-inset*2;
  if(l.frame==='cinema'){ctx.fillStyle=l.stroke;ctx.fillRect(0,0,l.w,l.h*.09);ctx.fillRect(0,l.h*.91,l.w,l.h*.09);return;}
  if(l.frame==='photo'){ctx.fillStyle=l.stroke;const b=Math.max(l.lineWidth,l.w*.025);ctx.fillRect(0,0,l.w,b);ctx.fillRect(0,l.h-b*2,l.w,b*2);ctx.fillRect(0,0,b,l.h);ctx.fillRect(l.w-b,0,b,l.h);return;}
  if(l.frame==='corners'){const len=Math.min(w,h)*.17;for(const [x,y,sx,sy] of [[inset,inset,1,1],[inset+w,inset,-1,1],[inset,inset+h,1,-1],[inset+w,inset+h,-1,-1]]){ctx.beginPath();ctx.moveTo(x+sx*len,y);ctx.lineTo(x,y);ctx.lineTo(x,y+sy*len);ctx.stroke();}return;}
  ctx.beginPath();if(l.frame==='dashed')ctx.setLineDash([l.lineWidth*3,l.lineWidth*2]);
  if(l.frame==='dotted'){ctx.lineCap='round';ctx.setLineDash([.01,Math.max(2,l.lineWidth*2.5)]);}
  if(l.frame==='rounded')ctx.roundRect(inset,inset,w,h,Math.min(w,h)*.05);else ctx.rect(inset,inset,w,h);
  ctx.stroke();if(l.frame==='double'){ctx.beginPath();const d=l.lineWidth*2;ctx.rect(inset+d,inset+d,w-2*d,h-2*d);ctx.stroke();}
}
export function drawLayer(ctx,l,rasters) {
  if(!l.visible||l.opacity<=0)return;
  ctx.save();ctx.globalAlpha=l.opacity;ctx.translate(l.x+l.w/2,l.y+l.h/2);ctx.rotate(l.rotation*Math.PI/180);ctx.translate(-l.w/2,-l.h/2);
  ctx.fillStyle=l.fill||'#111111';ctx.strokeStyle=l.stroke||'#111111';ctx.lineWidth=l.lineWidth||0;ctx.lineJoin='round';
  if(l.type==='image'){
    const bitmap=layerRaster(rasters,l);if(bitmap)ctx.drawImage(bitmap,0,0,l.w,l.h);
  }else if(l.type==='text'||l.type==='sfx')text(ctx,l);
  else if(l.type==='bubble')bubble(ctx,l);
  else if(l.type==='symbol')symbol(ctx,l);
  else if(l.type==='speed')speed(ctx,l);
  else if(l.type==='frame')frame(ctx,l);
  ctx.restore();
}
export function drawDocument(ctx,doc,rasters,{includeText=true,background=true}={}) {
  ctx.clearRect(0,0,doc.width,doc.height);
  if(background&&!doc.transparent){ctx.fillStyle=doc.background;ctx.fillRect(0,0,doc.width,doc.height);}
  for(const l of doc.layers)if(includeText||!isDecorationLayer(l))drawLayer(ctx,l,rasters);
}
export async function exportCanvas(doc,cache,options={}) {
  await prepareFonts(doc);
  await document.fonts.ready;
  const out=canvas(doc.width,doc.height),rasters=await cache.prepare(doc);drawDocument(out.getContext('2d'),doc,rasters,options);return out;
}
export function layerSelectionMask(layer,selection,docWidth,docHeight,targetWidth,targetHeight) {
  const src=maskCanvas(selection,docWidth,docHeight),out=canvas(targetWidth,targetHeight),ctx=out.getContext('2d');
  ctx.fillStyle='black';ctx.fillRect(0,0,out.width,out.height);
  ctx.translate(targetWidth/2,targetHeight/2);ctx.scale(targetWidth/layer.w,targetHeight/layer.h);
  ctx.rotate(-layer.rotation*Math.PI/180);ctx.translate(-layer.x-layer.w/2,-layer.y-layer.h/2);ctx.drawImage(src,0,0);
  return out;
}
export function toBlob(c,type='image/png',quality=.92){return new Promise((resolve,reject)=>c.toBlob(b=>b?resolve(b):reject(Error('Image encoding failed')),type,quality));}
