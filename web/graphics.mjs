import {canvas,drawLayer} from './render.mjs?v=c05d225929bd2f7c';
import {makeLayer} from './core.mjs?v=c05d225929bd2f7c';
const paths={
 aiLettering:'M3 4h12 M9 4v17 M5 21h8 M19 3v6 M16 6h6 M19 14v6 M16 17h6',
 wand:'m4 20 12-12 3 3L7 23z M5 3v6 M2 6h6 M16 1v4 M14 3h4 M21 15v6 M18 18h6',colorRange:'M12 3a9 9 0 1 0 9 9 M12 7a5 5 0 1 0 5 5 M12 10a2 2 0 1 0 2 2 M16 2l6 6-7 7-6-6z',
 dockPanel:'M3 3h18v18H3z M15 3v18 M5 12h7 M9 9l3 3-3 3',

 candidates:'M4 4h16v16H4z M7 8h10 M7 12h10 M7 16h6',newProject:'M4 3h10l6 6v12H4z M14 3v6h6 M8 14h8 M12 10v8',openProject:'M2 6h8l2 3h10l-3 12H2z M2 9V4h8l2 2h8v3',portable:'M4 3h16v18H4z M10 3v9l2 2 2-2V3 M10 18h4',close:'M5 5l14 14 M19 5 5 19',actual:'M5 6h2v12 M12 6h2v12 M18 6h2v12',resetView:'M5 8a8 8 0 1 1-1 7 M5 2v6h6',generate:'M12 3v4 M12 17v4 M3 12h4 M17 12h4 M5 5l3 3 M16 16l3 3 M5 19l3-3 M16 8l3-3 M12 8l4 4-4 4-4-4z',enhance:'m4 20 12-12 4 4L8 24z M17 2v4 M22 6h-4 M6 5v5 M3 8h6',engine:'M7 7h10v10H7z M9 2v5 M15 2v5 M9 17v5 M15 17v5 M2 9h5 M2 15h5 M17 9h5 M17 15h5',addReference:'M3 5h14v14H3z M17 3h5 M19.5 .5v5 M3 15l5-5 4 4 3-2 2 2',saveCopy:'M8 3h13v15H8z M3 7v14h13',properties:'M4 6h16 M4 12h16 M4 18h16 M8 3v6 M16 9v6 M10 15v6',layers:'m12 2 10 6-10 6L2 8z M2 12l10 6 10-6 M2 16l10 6 10-6',

 image:'M3 4h18v16H3z M3 16l5-5 4 4 3-3 6 6 M15 8h.01',input:'M12 2v12 m-5-5 5 5 5-5 M4 15v6h16v-6',
 move:'M12 2v20 M2 12h20 M8 6l4-4 4 4 M8 18l4 4 4-4 M6 8l-4 4 4 4 M18 8l4 4-4 4',rect:'M3 4h18v16H3z',ellipse:'M21 12a9 7 0 1 1-18 0 9 7 0 1 1 18 0',lasso:'M5 17C-2 11 4 3 13 4c11 1 11 11 3 13-5 2-10 1-9-3 2-4 7 2 3 7',
 paint:'M3 21l5-1L21 7l-4-4L4 16z M14 6l4 4',brush:'m13 4 5-2 4 4-9 9-4-4z M9 12C2 11 6 18 2 21c8 1 11-3 10-7',erase:'m9 19-6-6L14 2l8 8-9 9H9z M7 9l8 8 M12 21h10',
 text:'M3 4h18 M12 4v17 M8 21h8',bubble:'M4 4h16v12H10l-6 5v-5z',sfx:'m13 1-9 13h7l-1 9 10-14h-7z',symbol:'m12 2 3 7 7 1-5 5 1 7-6-4-6 4 1-7-5-5 7-1z',stamp:'M8 3h8v7l4 4v4H4v-4l4-4z M3 21h18',speed:'M2 3l6 5 M22 3l-6 5 M2 21l6-6 M22 21l-6-6 M12 1v6 M12 23v-6 M1 12h5 M23 12h-5',frame:'M2 3h20v18H2z M6 7h12v10H6z',
 comic:'M4 3h16v18H4z M4 9h16 M11 9v12 M15 13h2 M15 17h2',cutout:'M7 9a4 4 0 1 1 0-8 4 4 0 0 1 0 8 M7 23a4 4 0 1 1 0-8 4 4 0 0 1 0 8 M10 7l12 14 M10 17 22 3',
 undo:'M8 4 2 10l6 5 M3 10h11a7 7 0 0 1 7 7',redo:'m16 4 6 6-6 5 M21 10H10a7 7 0 0 0-7 7',settings:'M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8 M12 2v3 M12 19v3 M2 12h3 M19 12h3 M5 5l2 2 M17 17l2 2 M5 19l2-2 M17 7l2-2',
 export:'M12 16V2 m-4 4 4-4 4 4 M4 12v9h16v-9',save:'M3 3h15l3 3v15H3z M7 3v6h10V3 M7 21v-8h10v8',help:'M9 8a3 3 0 1 1 5 2c-2 1-2 2-2 4 M12 18h.01 M22 12a10 10 0 1 1-20 0 10 10 0 1 1 20 0',
 hand:'M8 12V5a2 2 0 0 1 4 0v7 V3a2 2 0 0 1 4 0v9 V6a2 2 0 0 1 4 0v10c0 8-10 9-13 4l-5-7a2 2 0 0 1 3-2l3 3',rotateView:'M4 9a9 9 0 1 1 0 6 M4 3v6h6',
 fit:'M3 9V3h6 M15 3h6v6 M21 15v6h-6 M9 21H3v-6',clear:'M4 4l16 16 M20 4 4 20',invert:'M12 2a10 10 0 0 1 0 20V2 M12 2a10 10 0 0 0 0 20',
};
export function icon(name){const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');svg.classList.add('ph3-icon');const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',paths[name]||paths.image);if(['rect','ellipse','lasso'].includes(name))path.setAttribute('stroke-dasharray','2 2');svg.append(path);if(['brush','erase'].includes(name)){const outline=document.createElementNS(svg.namespaceURI,'rect');for(const[k,v]of Object.entries({x:1,y:1,width:22,height:22,fill:'none','stroke-dasharray':'2 3','stroke-width':1}))outline.setAttribute(k,v);svg.append(outline);}return svg;}
export function layerThumbnail(layer,rasters,w=88,h=64){
 const c=canvas(w,h),ctx=c.getContext('2d');ctx.fillStyle='#dce4eb';ctx.fillRect(0,0,w,h);ctx.fillStyle='#c4ced8';for(let y=0;y<h;y+=8)for(let x=0;x<w;x+=8)if(((x+y)/8)%2===0)ctx.fillRect(x,y,8,8);
 if(!layer)return c;
 const pad=6,extra=layer.type==='bubble'&&layer.tailStyle!=='none'?.3:0,scale=Math.min((w-pad*2)/layer.w,(h-pad*2)/(layer.h*(1+extra)));
 ctx.save();ctx.translate((w-layer.w*scale)/2,(h-layer.h*(1+extra)*scale)/2);ctx.scale(scale,scale);if(layer.type==='bubble'){ctx.translate(layer.w*.12,layer.h*.12);ctx.scale(.76,.76);}drawLayer(ctx,{...layer,x:0,y:0,rotation:0,visible:true,opacity:1},rasters);ctx.restore();return c;
}
export function presetOptions(type,item,width,height,style={}) {
 const key=Array.isArray(item)?item[0]:item,custom=Array.isArray(item)?(item[3]||{}):{};
 let opts={};
 if(type==='bubble'){opts={shape:key,w:width*.5,h:height*.24,...custom};if(opts.aspect){opts.h=opts.w/opts.aspect;delete opts.aspect;}}
 else if(type==='symbol')opts={symbol:key,w:width*.16,h:width*.16,fill:key==='heart'?'#e85c79':key==='sweat'?'#6dc7ee':'#f8ce6a'};
 else if(type==='frame')opts={frame:key,lineWidth:Math.max(4,width*.01),stroke:key==='photo'?'#ffffff':'#111820',...custom};
 else if(type==='speed')opts={...custom};
 else if(type==='text')opts={...custom,text:'テキスト',h:height*.22};
 else opts={text:key,fontSize:Math.round(width*.085),h:height*.32,bold:true,...style};
 return opts;
}
export function presetThumbnail(type,item,style={}) {
 const layer=makeLayer(type,480,320,presetOptions(type,item,480,320,style));
 if(type==='text'){layer.text='Aa';layer.w=400;layer.h=190;layer.fontSize=130;layer.lineWidth=5;}
 if(type==='sfx'){layer.w=440;layer.h=200;layer.fontSize=90;}
 return layerThumbnail(layer,new Map(),210,136);
}
