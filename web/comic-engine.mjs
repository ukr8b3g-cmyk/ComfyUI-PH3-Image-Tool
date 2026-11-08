/* MIT adaptation of Speech-Bubble-Comic-Editor-App web/comic-converter.js.
 * Copyright (c) 2026 ukr8b3g-cmyk. Pinned source and changes: THIRD_PARTY_NOTICES.md.
 * Same grayscale/monochrome/edge-preserving comic/XDoG equations; no desktop host APIs.
 */
export const COMIC_DEFAULTS=Object.freeze({mode:'comic',brightness:0,contrast:1.04,gamma:1,smoothRadius:2,posterLevels:5,edgeThreshold:.055,edgeStrength:.3,toneStrength:0,colorEdgeWeight:1.25,lineCleanup:.04,preserveTones:true,solidBlack:true,sigma:.8,epsilon:-.005,phi:45,lineStrength:.95,k:1.6,tau:.995,strength:1});
export const COMIC_STYLES=[
  ['comic','漫画変換','Comic',{mode:'comic'}],['grayscale','グレースケール','Grayscale',{mode:'grayscale'}],
  ['monochrome','白黒2値','Black & white',{mode:'monochrome'}],['xdog','XDoG線画','XDoG line art',{mode:'xdog',lineStrength:1,preserveTones:false,solidBlack:false}],
  ['soft-comic','ソフト漫画','Soft comic',{mode:'comic',contrast:.95,edgeStrength:.2,lineStrength:.65,posterLevels:6}],
  ['tone-comic','網点漫画','Screentone comic',{mode:'comic',toneStrength:.65,posterLevels:5,contrast:1.1}],
];
/** Self-contained for execution in a disposable worker. Source pixels are never modified. */
export function processComic(rgba,width,height,options={}) {
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width*height>16777216||rgba.length!==width*height*4)throw Error('Invalid comic image size');
  const p={mode:'comic',brightness:0,contrast:1.04,gamma:1,smoothRadius:2,posterLevels:5,edgeThreshold:.055,edgeStrength:.3,toneStrength:0,colorEdgeWeight:1.25,lineCleanup:.04,preserveTones:true,solidBlack:true,sigma:.8,epsilon:-.005,phi:45,lineStrength:.95,k:1.6,tau:.995,strength:1,...options};
  const limits={brightness:[-100,100],contrast:[.5,2.5],gamma:[.4,2.5],smoothRadius:[0,5],posterLevels:[2,6],edgeThreshold:[.015,.25],edgeStrength:[0,2.5],toneStrength:[0,1],colorEdgeWeight:[0,2.5],lineCleanup:[0,.2],sigma:[.3,3],epsilon:[-.3,.2],phi:[1,100],lineStrength:[0,3],k:[1.1,3],tau:[.8,1.1],strength:[0,1]};
  for(const [key,[lo,hi]] of Object.entries(limits))if(!Number.isFinite(p[key])||p[key]<lo||p[key]>hi)throw Error('Invalid comic parameter: '+key);
  if(!['comic','grayscale','monochrome','xdog'].includes(p.mode))throw Error('Unknown comic mode');
  const clamp=(v,lo=0,hi=1)=>Math.max(lo,Math.min(hi,v));
  const gray=new Float32Array(width*height);
  for(let i=0;i<gray.length;i++){const j=i*4,alpha=rgba[j+3]/255;
    let y=(.2126*rgba[j]+.7152*rgba[j+1]+.0722*rgba[j+2])/255;y=y*alpha+1-alpha;
    gray[i]=Math.pow(clamp((y-.5)*p.contrast+.5+p.brightness/255),1/p.gamma);}
  function gaussian(src,sigma){const radius=Math.max(1,Math.ceil(sigma*3)),kernel=new Float32Array(radius*2+1);let sum=0;
    for(let i=-radius;i<=radius;i++){kernel[i+radius]=Math.exp(-(i*i)/(2*sigma*sigma));sum+=kernel[i+radius];}for(let i=0;i<kernel.length;i++)kernel[i]/=sum;
    const tmp=new Float32Array(src.length),out=new Float32Array(src.length);
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){let sum=0;for(let j=-radius;j<=radius;j++)sum+=src[y*width+clamp(x+j,0,width-1)]*kernel[j+radius];tmp[y*width+x]=sum;}
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){let sum=0;for(let j=-radius;j<=radius;j++)sum+=tmp[clamp(y+j,0,height-1)*width+x]*kernel[j+radius];out[y*width+x]=sum;}return out;
  }
  function smooth(src,radius){if(!radius)return src;const out=new Float32Array(src.length),spatialSigma=Math.max(.8,radius*.8),rangeSigma=.12;
    // Spatial weights are constant, but all range weights retain the upstream formula.
    const offsets=[];for(let dy=-radius;dy<=radius;dy++)for(let dx=-radius;dx<=radius;dx++)offsets.push([dx,dy,Math.exp(-(dx*dx+dy*dy)/(2*spatialSigma*spatialSigma))]);
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){const center=src[y*width+x];let sum=0,weights=0;
      for(const [dx,dy,spatial] of offsets){const v=src[clamp(y+dy,0,height-1)*width+clamp(x+dx,0,width-1)],weight=spatial*Math.exp(-((v-center)**2)/(2*rangeSigma*rangeSigma));sum+=v*weight;weights+=weight;}out[y*width+x]=sum/Math.max(1e-6,weights);}return out;
  }
  let values=gray;
  if(p.mode==='monochrome'){values=Float32Array.from(gray,v=>v>=.5?1:0);}
  else if(p.mode==='xdog'){
    const g1=gaussian(gray,Math.max(.3,p.sigma)),g2=gaussian(gray,Math.max(.3,p.sigma)*p.k);values=new Float32Array(gray.length);
    for(let i=0;i<values.length;i++){const dog=g1[i]-p.tau*g2[i],xdog=dog>=p.epsilon?1:1+Math.tanh(p.phi*(dog-p.epsilon));values[i]=clamp(1-(1-clamp(xdog))*p.lineStrength);}
  }else if(p.mode==='comic'){
    const sm=smooth(gray,Math.round(p.smoothRadius)),edge=new Float32Array(gray.length),levels=Math.max(2,p.posterLevels);
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const i=y*width+x,xl=Math.max(0,x-1),xr=Math.min(width-1,x+1),yu=Math.max(0,y-1),yd=Math.min(height-1,y+1);
      const eg=Math.sqrt((sm[y*width+xr]-sm[y*width+xl])**2+(sm[yd*width+x]-sm[yu*width+x])**2);
      const li=(y*width+xl)*4,ri=(y*width+xr)*4,ui=(yu*width+x)*4,di=(yd*width+x)*4;let sq=0;
      for(let c=0;c<3;c++)sq+=((rgba[ri+c]-rgba[li+c])/255)**2+((rgba[di+c]-rgba[ui+c])/255)**2;
      edge[i]=clamp((Math.max(eg,Math.sqrt(sq/6)*p.colorEdgeWeight)-p.edgeThreshold)/Math.max(.001,.30-p.edgeThreshold));
    }
    const g1=gaussian(sm,Math.max(.3,p.sigma)),g2=gaussian(sm,Math.max(.3,p.sigma)*p.k),bayer=[0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5];values=new Float32Array(gray.length);
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=y*width+x;let base=p.preserveTones?Math.round(sm[i]*(levels-1))/(levels-1):1;
      if(p.preserveTones&&p.solidBlack&&base<.22)base=0;
      const dog=g1[i]-p.tau*g2[i],xdog=dog>=p.epsilon?1:1+Math.tanh(p.phi*(dog-p.epsilon));let fine=(1-clamp(xdog))*p.lineStrength;if(fine<p.lineCleanup)fine=0;
      let v=Math.min(base,1-fine,1-edge[i]*p.edgeStrength);
      if(p.preserveTones&&p.toneStrength>0&&v>.08&&v<.96){const d=(bayer[(y&3)*4+(x&3)]+.5)/16;v=v*(1-p.toneStrength)+(d<v?1:0)*p.toneStrength;}values[i]=clamp(v);
    }
  }
  const out=new Uint8ClampedArray(rgba.length);
  for(let i=0;i<values.length;i++){const v=Math.round(clamp(values[i])*255),j=i*4;for(let c=0;c<3;c++)out[j+c]=Math.round(rgba[j+c]*(1-p.strength)+v*p.strength);out[j+3]=rgba[j+3];}return out;
}
export function comicAsync(imageData,params,{signal}={}) {
  return new Promise((resolve,reject)=>{
    if(signal?.aborted){reject(new DOMException('Cancelled','AbortError'));return;}
    const code=`const processComic=${processComic.toString()};self.onmessage=e=>{try{const {buffer,width,height,params}=e.data;const data=processComic(new Uint8ClampedArray(buffer),width,height,params);self.postMessage({buffer:data.buffer},[data.buffer]);}catch(error){self.postMessage({error:error.message});}};`;
    let worker,url,settled=false;
    const finish=(error,value)=>{if(settled)return;settled=true;worker?.terminate();if(url)URL.revokeObjectURL(url);signal?.removeEventListener('abort',cancel);error?reject(error):resolve(value);};
    const cancel=()=>finish(new DOMException('Cancelled','AbortError'));
    try{url=URL.createObjectURL(new Blob([code],{type:'application/javascript'}));worker=new Worker(url);
      worker.onmessage=e=>e.data.error?finish(Error(e.data.error)):finish(null,new ImageData(new Uint8ClampedArray(e.data.buffer),imageData.width,imageData.height));
      worker.onerror=e=>{e.preventDefault();finish(Error(e.message||'Comic worker could not start'));};
      signal?.addEventListener('abort',cancel,{once:true});const copy=new Uint8ClampedArray(imageData.data);worker.postMessage({buffer:copy.buffer,width:imageData.width,height:imageData.height,params},[copy.buffer]);
    }catch(error){finish(error);}
  });
}
