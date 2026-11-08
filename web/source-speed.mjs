// MIT: Speech-Bubble-Comic-Editor-App, 83109b21, Copyright (c) 2026 ukr8b3g-cmyk.
const EMPHASIS_EDGE_OVERSHOOT=.035;
    const EMPHASIS_PRESETS = Object.freeze([
      Object.freeze({id:"center",label:"Center",line_count:180,inner_x:.5,inner_y:.5,line_width:.006,line_length:1,taper:1,center_x:.5,center_y:.5,length_random:0,inner_random:.5,width_random:.48,spacing_random:.38}),
      Object.freeze({id:"wide",label:"Wide",line_count:210,inner_x:.45,inner_y:.45,line_width:.005,line_length:1,taper:1,center_x:.5,center_y:.5,length_random:0,inner_random:.5,width_random:.55,spacing_random:.42}),
      Object.freeze({id:"tall",label:"Tall",line_count:190,inner_x:.45,inner_y:.45,line_width:.0055,line_length:1,taper:1,center_x:.5,center_y:.5,length_random:0,inner_random:.5,width_random:.50,spacing_random:.42}),
      Object.freeze({id:"side",label:"One Side",line_count:130,inner_x:.45,inner_y:.45,line_width:.008,line_length:1,taper:1,center_x:-.12,center_y:.5,length_random:0,inner_random:.5,width_random:.50,spacing_random:.34}),
    ]);
    const EMPHASIS_BY_ID = new Map(EMPHASIS_PRESETS.map(preset=>[preset.id,preset]));
    const EMPHASIS_GEOMETRY_KEYS = new Set(["preset","line_count","inner_x","inner_y","line_width","line_length","taper","center_x","center_y","length_random","inner_random","width_random","spacing_random","seed","w","h"]);
    const EMPHASIS_GAP_MIN = .03;
    const EMPHASIS_GAP_MAX = .65;
    function emphasisClamp(value,minimum,maximum,fallback){const number=Number(value);return Math.max(minimum,Math.min(maximum,Number.isFinite(number)?number:fallback));}
    function emphasisCenterGapValue(item){const x=Math.max(1e-8,Number(item?.inner_x)||.15),y=Math.max(1e-8,Number(item?.inner_y)||.20);return Math.sqrt(x*y);}
    function scaleCenterGapPair(startX,startY,requestedGap){startX=emphasisClamp(startX,EMPHASIS_GAP_MIN,EMPHASIS_GAP_MAX,.15);startY=emphasisClamp(startY,EMPHASIS_GAP_MIN,EMPHASIS_GAP_MAX,.20);const startGap=emphasisCenterGapValue({inner_x:startX,inner_y:startY}),requested=emphasisClamp(requestedGap,EMPHASIS_GAP_MIN,EMPHASIS_GAP_MAX,startGap),minimumScale=Math.max(EMPHASIS_GAP_MIN/startX,EMPHASIS_GAP_MIN/startY),maximumScale=Math.min(EMPHASIS_GAP_MAX/startX,EMPHASIS_GAP_MAX/startY),scale=emphasisClamp(requested/startGap,minimumScale,maximumScale,1);return{inner_x:startX*scale,inner_y:startY*scale};}
    function emphasisMulberry32(seed){let value=Number(seed)>>>0;return()=>{value|=0;value=value+0x6D2B79F5|0;let result=Math.imul(value^value>>>15,1|value);result=result+Math.imul(result^result>>>7,61|result)^result;return((result^result>>>14)>>>0)/4294967296;};}
    function normalizeEmphasisParams(source={}){
      const preset=EMPHASIS_BY_ID.get(source.preset)||EMPHASIS_PRESETS[0];
      return{
        preset:preset.id,
        line_count:Math.round(emphasisClamp(source.line_count,20,500,preset.line_count)),
        inner_x:emphasisClamp(source.inner_x,.03,.65,preset.inner_x),
        inner_y:emphasisClamp(source.inner_y,.03,.65,preset.inner_y),
        line_width:emphasisClamp(source.line_width,.0005,.035,preset.line_width),
        line_length:emphasisClamp(source.line_length,.15,1,preset.line_length),
        taper:emphasisClamp(source.taper,0,1,preset.taper),
        overshoot:EMPHASIS_EDGE_OVERSHOOT,
        center_x:emphasisClamp(source.center_x,-.5,1.5,preset.center_x),
        center_y:emphasisClamp(source.center_y,-.5,1.5,preset.center_y),
        length_random:emphasisClamp(source.length_random,0,1,preset.length_random),
        inner_random:emphasisClamp(source.inner_random,0,1,preset.inner_random),
        width_random:emphasisClamp(source.width_random,0,1,preset.width_random),
        spacing_random:emphasisClamp(source.spacing_random,0,1,preset.spacing_random),
        seed:Number(source.seed)>>>0,
      };
    }
    function emphasisEllipseRadius(radiusX,radiusY,angle){const cosine=Math.cos(angle),sine=Math.sin(angle);return 1/Math.sqrt(cosine*cosine/(radiusX*radiusX)+sine*sine/(radiusY*radiusY));}
    function emphasisRayBoxInterval(originX,originY,directionX,directionY,width,height){
      let enter=-Infinity,exit=Infinity;
      for(const [origin,direction,minimum,maximum] of [[originX,directionX,0,width],[originY,directionY,0,height]]){
        if(Math.abs(direction)<1e-12){if(origin<minimum||origin>maximum)return null;continue;}
        let near=(minimum-origin)/direction,far=(maximum-origin)/direction;if(near>far)[near,far]=[far,near];
        enter=Math.max(enter,near);exit=Math.min(exit,far);if(enter>exit)return null;
      }
      return!Number.isFinite(exit)||exit<=0?null:[Math.max(0,enter),exit];
    }
    function generateNormalizedEmphasisRays(source,width,height){
      const params=normalizeEmphasisParams(source);width=Math.max(1,Number(width)||1);height=Math.max(1,Number(height)||1);
      const random=emphasisMulberry32(params.seed),centerX=params.center_x*width,centerY=params.center_y*height,baseSize=Math.min(width,height),radiusX=Math.max(2,params.inner_x*width),radiusY=Math.max(2,params.inner_y*height),overshoot=baseSize*params.overshoot,rays=[];
      for(let index=0;index<params.line_count;index+=1){
        const regular=index/params.line_count*Math.PI*2,jitter=(random()-.5)*(Math.PI*2/params.line_count)*params.spacing_random*1.9,angle=regular+jitter,directionX=Math.cos(angle),directionY=Math.sin(angle),interval=emphasisRayBoxInterval(centerX,centerY,directionX,directionY,width,height);
        if(!interval)continue;
        const [entry,exit]=interval,inner=emphasisEllipseRadius(radiusX,radiusY,angle),innerRandomSample=random(),lengthRandomSample=random(),widthRandomSample=random(),innerJitter=inner*params.inner_random*(innerRandomSample-.5)*.8,minimumStart=entry-overshoot,nominalStart=Math.max(minimumStart,inner),startBase=Math.max(minimumStart,inner+innerJitter),outer=exit+overshoot,nominalUsable=Math.max(0,outer-nominalStart);
        if(nominalUsable<=1e-6)continue;
        const start=Math.max(0,startBase),lengthFactor=1-params.length_random*lengthRandomSample,end=outer-nominalUsable*(1-params.line_length*lengthFactor);
        if(end<=start+1e-6)continue;
        const widthFactor=1+(widthRandomSample-.5)*2*params.width_random,outerWidth=Math.max(.3,baseSize*params.line_width*widthFactor),innerWidth=Math.max(.05,outerWidth*(1-params.taper)),perpendicularX=-directionY,perpendicularY=directionX,startX=centerX+directionX*start,startY=centerY+directionY*start,endX=centerX+directionX*end,endY=centerY+directionY*end;
        rays.push([
          [(startX+perpendicularX*innerWidth/2)/width,(startY+perpendicularY*innerWidth/2)/height],
          [(endX+perpendicularX*outerWidth/2)/width,(endY+perpendicularY*outerWidth/2)/height],
          [(endX-perpendicularX*outerWidth/2)/width,(endY-perpendicularY*outerWidth/2)/height],
          [(startX-perpendicularX*innerWidth/2)/width,(startY-perpendicularY*innerWidth/2)/height],
        ]);
      }
      return rays;
    }

export function sourceRays(layer){return generateNormalizedEmphasisRays({preset:layer.speedPreset,line_count:layer.lines,inner_x:layer.gap,inner_y:layer.gapY??layer.gap,line_width:layer.speedWidth??Math.max(.0005,(layer.lineWidth||3)/Math.min(layer.w,layer.h)),line_length:layer.lineLength,taper:layer.taper,length_random:layer.lengthRandom,inner_random:layer.innerRandom,width_random:layer.widthRandom,spacing_random:layer.spacingRandom,center_x:layer.centerX??.5,center_y:layer.centerY??.5,seed:layer.seed??42},layer.w,layer.h);}
export function drawSourceSpeed(ctx,l){for(const polygon of sourceRays(l)){ctx.beginPath();polygon.forEach(([x,y],i)=>i?ctx.lineTo(x*l.w,y*l.h):ctx.moveTo(x*l.w,y*l.h));ctx.closePath();ctx.fill();}}
