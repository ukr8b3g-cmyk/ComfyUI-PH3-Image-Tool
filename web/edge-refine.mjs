/* MIT adaptation of Speech-Bubble-Comic-Editor-App background-removal-edge.js.
 * Copyright (c) 2026 ukr8b3g-cmyk. Keeps alpha; repairs white/black matte and edge color.
 */
export function correctEdges(source,alpha,width,height,settings={}) {
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width*height>16777216||source.length!==width*height*4||alpha.length!==width*height)throw Error('Invalid cutout buffers');
  const out=new Uint8ClampedArray(source),edgeWidth=Math.max(1,Math.min(10,Math.round(Number(settings.width)||1))),amount=Math.max(0,Math.min(1,Number(settings.amount)||0));
  const byte=v=>Math.max(0,Math.min(255,Math.round(v)));
  const neighbors=(i,fn)=>{const x=i%width,y=(i/width)|0;if(x>0)fn(i-1);if(x+1<width)fn(i+1);if(y>0)fn(i-width);if(y+1<height)fn(i+width);};
  if(['white','black'].includes(settings.matte)){
    const m=settings.matte==='white'?255:0;
    for(let i=0;i<alpha.length;i++)if(alpha[i]>0&&alpha[i]<255){const a=Math.max(1/255,alpha[i]/255);for(let c=0;c<3;c++)out[i*4+c]=byte((out[i*4+c]-m*(1-a))/a);}
  }
  if(settings.defringe||amount>0){
    const distance=new Uint16Array(alpha.length),queue=new Int32Array(alpha.length);let head=0,tail=0;
    for(let i=0;i<alpha.length;i++){if(!alpha[i])continue;const x=i%width,y=(i/width)|0;let edge=x===0||x===width-1||y===0||y===height-1;neighbors(i,n=>{if(!alpha[n])edge=true;});if(edge){distance[i]=1;queue[tail++]=i;}}
    while(head<tail){const i=queue[head++];neighbors(i,n=>{if(alpha[n]>0&&!distance[n]){distance[n]=Math.min(65535,distance[i]+1);queue[tail++]=n;}});}
    const donors=new Int32Array(alpha.length);donors.fill(-1);head=tail=0;
    const seed=min=>{for(let i=0;i<alpha.length;i++)if(donors[i]===-1&&alpha[i]>=min&&distance[i]>edgeWidth){donors[i]=i;queue[tail++]=i;}};
    seed(240);if(!tail)seed(1);
    while(head<tail){const i=queue[head++];neighbors(i,n=>{if(alpha[n]>0&&donors[n]===-1){donors[n]=donors[i];queue[tail++]=n;}});}
    for(let i=0;i<alpha.length;i++){const d=distance[i],donor=donors[i];if(!alpha[i]||!d||d>edgeWidth||donor<0||donor===i)continue;
      const strength=settings.defringe?1:amount*(edgeWidth-d+1)/edgeWidth;for(let c=0;c<3;c++)out[i*4+c]=byte(out[i*4+c]+(out[donor*4+c]-out[i*4+c])*strength);}
  }
  for(let i=0;i<alpha.length;i++)out[i*4+3]=alpha[i];return out;
}
export function refineAlpha(alpha,width,height,{shrink=0,feather=0}={}) {
  shrink=Math.max(0,Math.min(10,Math.round(Number(shrink)||0)));feather=Math.max(0,Math.min(8,Math.round(Number(feather)||0)));
  let current=new Uint8ClampedArray(alpha);
  for(let pass=0;pass<shrink;pass++){const next=new Uint8ClampedArray(alpha.length);for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const i=y*width+x;next[i]=Math.min(current[i],x?current[i-1]:0,x+1<width?current[i+1]:0,y?current[i-width]:0,y+1<height?current[i+width]:0);}current=next;}
  if(feather){const tmp=new Float32Array(current.length),out=new Uint8ClampedArray(current.length),r=feather,div=r*2+1;
    for(let y=0;y<height;y++){let sum=0;for(let x=-r;x<=r;x++)sum+=current[y*width+Math.max(0,Math.min(width-1,x))];
      for(let x=0;x<width;x++){tmp[y*width+x]=sum/div;sum+=current[y*width+Math.min(width-1,x+r+1)]-current[y*width+Math.max(0,x-r)];}}
    for(let x=0;x<width;x++){let sum=0;for(let y=-r;y<=r;y++)sum+=tmp[Math.max(0,Math.min(height-1,y))*width+x];
      for(let y=0;y<height;y++){const i=y*width+x;out[i]=Math.min(current[i],Math.round(sum/div));sum+=tmp[Math.min(height-1,y+r+1)*width+x]-tmp[Math.max(0,y-r)*width+x];}}current=out;
  }return current;
}
export function cutoutAsync(imageData,params,{signal}={}) {
 return new Promise((resolve,reject)=>{
  if(signal?.aborted){reject(new DOMException('Cancelled','AbortError'));return;}
  const code=`const correctEdges=${correctEdges.toString()};const refineAlpha=${refineAlpha.toString()};self.onmessage=e=>{try{const {buffer,width,height,params}=e.data,rgba=new Uint8ClampedArray(buffer),alpha=new Uint8ClampedArray(width*height);for(let i=0;i<alpha.length;i++)alpha[i]=rgba[i*4+3];const mask=refineAlpha(alpha,width,height,params),out=correctEdges(rgba,mask,width,height,params);self.postMessage({buffer:out.buffer},[out.buffer]);}catch(error){self.postMessage({error:error.message});}};`;
  let worker,url,done=false;const finish=(error,result)=>{if(done)return;done=true;worker?.terminate();if(url)URL.revokeObjectURL(url);signal?.removeEventListener('abort',cancel);error?reject(error):resolve(result);};
  const cancel=()=>finish(new DOMException('Cancelled','AbortError'));
  try{url=URL.createObjectURL(new Blob([code],{type:'application/javascript'}));worker=new Worker(url);worker.onmessage=e=>e.data.error?finish(Error(e.data.error)):finish(null,new ImageData(new Uint8ClampedArray(e.data.buffer),imageData.width,imageData.height));worker.onerror=e=>{e.preventDefault();finish(Error(e.message||'Cutout worker failed'));};signal?.addEventListener('abort',cancel,{once:true});const copy=new Uint8ClampedArray(imageData.data);worker.postMessage({buffer:copy.buffer,width:imageData.width,height:imageData.height,params},[copy.buffer]);}catch(error){finish(error);}
 });
}
