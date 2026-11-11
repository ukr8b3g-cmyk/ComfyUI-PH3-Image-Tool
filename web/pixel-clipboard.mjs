import {canvas,drawLayer,exportCanvas,toBlob,layerSelectionMask} from './render.mjs?v=59a8d35b929e86cd';
import {maskBounds,readMask,maskCanvas} from './selection.mjs?v=59a8d35b929e86cd';
export const CLIPBOARD_LIMIT=64*1024*1024;
// Render in document coordinates: the layer mask and selection coverage each
// apply once. Placement is baked into the cropped pixels, never reapplied.
export async function capturePixels(doc,layer,selection,cache,{merged=false}={}){
 const bounds=maskBounds(selection,doc.width,doc.height);if(!bounds)return null;
 const [x,y,w,h]=bounds,out=canvas(w,h),ctx=out.getContext('2d');
 if(merged){const all=await exportCanvas(doc,cache,{background:false});ctx.drawImage(all,-x,-y);}
 else {const rasters=await cache.prepare({layers:[layer]});ctx.translate(-x,-y);drawLayer(ctx,{...layer,opacity:1},rasters);ctx.setTransform(1,0,0,1,0,0);}
 const pixels=ctx.getImageData(0,0,w,h);let occupied=false;
 for(let j=0;j<h;j++)for(let i=0;i<w;i++){const p=(j*w+i)*4+3;pixels.data[p]=Math.round(pixels.data[p]*selection[(y+j)*doc.width+x+i]/255);occupied ||= pixels.data[p]>0;}
 if(!occupied)return null;ctx.putImageData(pixels,0,0);
 const blob=await toBlob(out);if(blob.size>CLIPBOARD_LIMIT)throw Error('Clipboard image exceeds 64 MiB');
 return {kind:'pixels',blob,x,y,w,h};
}
export async function erasedMask(doc,layer,selection,cache,{repeatable=false}={}){
 const source=await cache.get(layer.asset),coverage=readMask(layerSelectionMask(layer,selection,doc.width,doc.height,source.width,source.height),source.width,source.height);
 const old=layer.mask_asset?readMask(await cache.get(layer.mask_asset),source.width,source.height):new Uint8ClampedArray(source.width*source.height).fill(255);
 let changed=false;
 for(let i=0;i<old.length;i++){
  const next=repeatable?Math.min(old[i],255-coverage[i]):Math.round(old[i]*(1-coverage[i]/255));
  changed ||= next!==old[i];
  old[i]=next;
 }
 if(repeatable&&!changed)return null;
 return toBlob(maskCanvas(old,source.width,source.height));
}
