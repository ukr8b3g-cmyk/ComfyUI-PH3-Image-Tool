// Local colour fallback and manual refinements always read the immutable source.
const copy=image=>({width:image.width,height:image.height,data:new Uint8ClampedArray(image.data)});
function flood(image,seeds,color,tolerance,visit){
 const {width:w,height:h,data:p}=image,n=w*h,seen=new Uint8Array(n),queue=new Int32Array(n);let read=0,write=0;
 const add=i=>{if(!seen[i]){seen[i]=1;queue[write++]=i;}};for(const i of seeds)add(i);
 while(read<write){const i=queue[read++],k=i*4;if(!p[k+3]||Math.max(Math.abs(p[k]-color[0]),Math.abs(p[k+1]-color[1]),Math.abs(p[k+2]-color[2]))>tolerance)continue;
  visit(i);const x=i%w;if(x)add(i-1);if(x+1<w)add(i+1);if(i>=w)add(i-w);if(i+w<n)add(i+w);
 }
}
export function autoColorCutout(image,tolerance=32){
 const out=copy(image),{width:w,height:h,data:p}=image,n=w*h,seen=new Uint8Array(n),queue=new Int32Array(n),boundary=[];let read=0,write=0;
 const add=i=>{if(!seen[i]){seen[i]=1;if(p[i*4+3])boundary.push(i);else queue[write++]=i;}};
 for(let x=0;x<w;x++){add(x);add((h-1)*w+x);}for(let y=0;y<h;y++){add(y*w);add(y*w+w-1);}
 // Walk only exterior transparency; enclosed transparent holes are not new edges.
 while(read<write){const i=queue[read++],x=i%w;if(x)add(i-1);if(x+1<w)add(i+1);if(i>=w)add(i-w);if(i+w<n)add(i+w);}
 const bins=new Map();for(const i of boundary){const k=i*4,key=(p[k]>>5)*64+(p[k+1]>>5)*8+(p[k+2]>>5);if(!bins.has(key))bins.set(key,[]);bins.get(key).push(i);}
 let largest=[];for(const group of bins.values())if(group.length>largest.length)largest=group;
 // Ambiguous edges need manual input instead of a guessed foreground erasure.
 if(!largest.length||largest.length<boundary.length*.2)return out;
 const color=[0,1,2].map(c=>Math.round(largest.reduce((s,i)=>s+p[i*4+c],0)/largest.length));
 flood(image,boundary,color,tolerance,i=>out.data[i*4+3]=0);return out;
}
export function refineCutout(original,base,regions,tolerance=32){
 if(original.width!==base.width||original.height!==base.height)throw Error('Cutout dimensions must agree');
 const out=copy(original);for(let i=3;i<out.data.length;i+=4)out.data[i]=Math.min(original.data[i],base.data[i]);
 for(const region of regions){const x=Math.max(0,Math.min(original.width-1,Math.floor(region.seed[0]))),y=Math.max(0,Math.min(original.height-1,Math.floor(region.seed[1]))),i=y*original.width+x;
  const color=[0,1,2].map(c=>original.data[i*4+c]);flood(original,[i],color,tolerance,j=>out.data[j*4+3]=region.remove?0:original.data[j*4+3]);
 }return out;
}
