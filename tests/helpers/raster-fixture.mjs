// Pixel-compositing fixture adapted from the supplied MIT audit probe.
import assert from 'node:assert/strict';
function canvas(w,h){
 const image={width:w,height:h,data:new Uint8ClampedArray(w*h*4)};
 const context={globalCompositeOperation:'source-over',fillStyle:'#000000',
  drawImage(src,x=0,y=0,sw=src.width,sh=src.height){
   assert.equal(src.width,w,'fixture only supports native-size canvases');assert.equal(src.height,h);
   for(let i=0;i<image.data.length;i+=4){
    const sa=src.data[i+3]/255,da=image.data[i+3]/255;
    if(this.globalCompositeOperation==='destination-in'){image.data[i+3]=Math.round(image.data[i+3]*sa);continue;}
    assert.equal(this.globalCompositeOperation,'source-over');
    const a=sa+da*(1-sa);for(let k=0;k<3;k++)image.data[i+k]=a?Math.round((src.data[i+k]*sa+image.data[i+k]*da*(1-sa))/a):0;
    image.data[i+3]=Math.round(a*255);
   }
  },fillRect(){
   assert.equal(this.globalCompositeOperation,'source-in');
   const rgb=this.fillStyle.slice(1).match(/../g).map(n=>parseInt(n,16));
   for(let i=0;i<image.data.length;i+=4)for(let k=0;k<3;k++)image.data[i+k]=rgb[k];
  },getImageData(){return{data:new Uint8ClampedArray(image.data)};},
  createImageData(){return{data:new Uint8ClampedArray(image.data.length)};},
  putImageData(p){image.data.set(p.data);}
 };
 image.getContext=()=>context;return image;
}
function solid(rgba,w=4,h=4){const c=canvas(w,h);for(let i=0;i<c.data.length;i+=4)c.data.set(rgba,i);return c;}
function maskCanvas(mask,w,h,alpha=false){const c=canvas(w,h);for(let i=0;i<mask.length;i++)c.data.set(alpha?[255,255,255,mask[i]]:[mask[i],mask[i],mask[i],255],i*4);return c;}
function readMask(image,w,h){return Uint8ClampedArray.from({length:w*h},(_,i)=>image.data[4*i]);}
function maskBounds(mask,w,h){let l=w,t=h,r=0,b=0;for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(mask[y*w+x]){l=Math.min(l,x);t=Math.min(t,y);r=Math.max(r,x+1);b=Math.max(b,y+1);}return r>l&&b>t?[l,t,r-l,b-t]:null;}

export {canvas,solid,maskCanvas,readMask,maskBounds};
