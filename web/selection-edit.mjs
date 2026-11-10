import {renderStack} from './retouch-core.mjs?v=37e99894a6ee0379';

export function adjustedPixels(source,mask,type,settings){
  if(type==='fill'||type==='delete'){
    const out=new Uint8ClampedArray(source),rgb=(settings.color||'#111111').slice(1).match(/../g).map(n=>parseInt(n,16));
    for(let i=0,p=0;i<out.length;i+=4,p++){
      const a=(mask?.[p]??255)/255;if(!a)continue;
      if(type==='delete')out[i+3]=Math.round(out[i+3]*(1-a));
      else {const da=out[i+3]/255,alpha=a+da*(1-a);for(let k=0;k<3;k++)out[i+k]=Math.round((rgb[k]*a+out[i+k]*da*(1-a))/alpha);out[i+3]=Math.round(alpha*255);}
    }return out;
  }
  return renderStack(source,[{type:'adjustment',id:'edit',visible:true,opacity:1,adjustmentType:type,settings}],new Map([['edit',mask]]));
}

// Max coverage within a stroke prevents opacity from accumulating at every dab.
export function strokeCoverage(mask,width,height,a,b,size,hardness=80,selection=null){
  const radius=Math.max(.5,size/2),dx=b.x-a.x,dy=b.y-a.y,len=dx*dx+dy*dy,hard=Math.max(0,Math.min(.9999,hardness/100));
  const x0=Math.max(0,Math.floor(Math.min(a.x,b.x)-radius)),x1=Math.min(width-1,Math.ceil(Math.max(a.x,b.x)+radius));
  const y0=Math.max(0,Math.floor(Math.min(a.y,b.y)-radius)),y1=Math.min(height-1,Math.ceil(Math.max(a.y,b.y)+radius));
  for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
    const t=len?Math.max(0,Math.min(1,((x+.5-a.x)*dx+(y+.5-a.y)*dy)/len)):0;
    const d=Math.hypot(x+.5-a.x-t*dx,y+.5-a.y-t*dy)/radius;
    if(d>=1)continue;const coverage=d<=hard?1:(1-d)/(1-hard),i=y*width+x;
    mask[i]=Math.max(mask[i],Math.round(coverage*(selection?.[i]??255)));
  }
}

export function paintedPixels(source,coverage,color,opacity){
  const paint=new Uint8ClampedArray(source.length),rgb=color.slice(1).match(/../g).map(n=>parseInt(n,16));
  for(let p=0;p<coverage.length;p++)if(coverage[p])paint.set([...rgb,coverage[p]],p*4);
  return renderStack(source,[{type:'paint',visible:true,opacity,pixels:paint}]);
}

export function localePreference(settings,host){
  const mode=settings.locale_mode||'auto';
  return mode==='auto'?(String(host||'en').toLowerCase().startsWith('ja')?'ja':'en'):mode;
}
