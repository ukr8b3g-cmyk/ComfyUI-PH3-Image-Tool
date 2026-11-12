import {buildCurveLut,normalizeCurvePoints} from './retouch-core.mjs?v=01bc95baa1764cb1';

export function retouchControls({parent,session,field,sliderField,button,tr,preview,apply,cancel}){
  const heading=document.createElement('h3');heading.textContent=tr('retouch'+session.type);parent.append(heading);
  const settings=session.settings;
  const slider=(key,min,max,step=1)=>sliderField(parent,key,settings[key]??0,v=>{settings[key]=v;preview();},min,max,step,v=>{settings[key]=v;preview();});
  if(session.type==='fill'){
    const color=document.createElement('input');color.type='color';color.value=settings.color;field(parent,'paintColor',color);color.oninput=color.onchange=()=>{settings.color=color.value;preview();};
  }else if(session.type==='hue_saturation'){
    slider('hue',-180,180);slider('saturation',-100,100);slider('lightness',-100,100);
  }else if(session.type==='brightness_contrast'){
    slider('brightness',-100,100);slider('contrast',-100,100);slider('gamma',.2,3,.05);
  }else if(session.type==='curves'){
    let selected=0,channel='rgb',drag=false;
    const channels=settings.channels,select=document.createElement('select');
    for(const key of ['rgb','red','green','blue']){const option=document.createElement('option');option.value=key;option.textContent=key.toUpperCase();select.append(option);}field(parent,'curveChannel',select);
    const graph=document.createElement('canvas');graph.width=256;graph.height=256;graph.className='ph3-curve-graph';graph.tabIndex=0;graph.setAttribute('aria-label',tr('curveHelp'));parent.append(graph);
    const input=document.createElement('input'),output=document.createElement('input');for(const n of [input,output]){n.type='number';n.min=0;n.max=255;n.step=1;}field(parent,'curveInput',input);field(parent,'curveOutput',output);
    const points=()=>channels[channel]??=[{x:0,y:0},{x:255,y:255}];
    const histogram=new Uint32Array(256);let peak=1;
    for(let i=0;i<session.pixels.length;i+=4*4)if(session.pixels[i+3]){const v=Math.round((session.pixels[i]+session.pixels[i+1]+session.pixels[i+2])/3);peak=Math.max(peak,++histogram[v]);}
    function draw(){const ctx=graph.getContext('2d');ctx.fillStyle='#202830';ctx.fillRect(0,0,256,256);ctx.fillStyle='#5e6570';for(let x=0;x<256;x++)ctx.fillRect(x,256-histogram[x]/peak*230,1,histogram[x]/peak*230);
      ctx.strokeStyle='#46505b';ctx.lineWidth=1;for(let x=0;x<=256;x+=64){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,256);ctx.moveTo(0,x);ctx.lineTo(256,x);ctx.stroke();}
      const lut=buildCurveLut(points());ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.beginPath();for(let x=0;x<256;x++)x?ctx.lineTo(x,255-lut[x]):ctx.moveTo(x,255-lut[x]);ctx.stroke();
      points().forEach((p,i)=>{ctx.fillStyle=i===selected?'#8fd8bf':'#fff';ctx.fillRect(p.x-3,252-p.y,6,6);});input.value=points()[selected].x;output.value=points()[selected].y;
    }
    const coords=e=>{const r=graph.getBoundingClientRect();return{x:Math.max(0,Math.min(255,Math.round((e.clientX-r.left)*255/r.width))),y:Math.max(0,Math.min(255,Math.round(255-(e.clientY-r.top)*255/r.height)))};};
    function move(p){p.x=Math.max(0,Math.min(255,Number(p.x)||0));p.y=Math.max(0,Math.min(255,Number(p.y)||0));const ps=points(),old=ps[selected];p.x=selected===0?0:selected===ps.length-1?255:Math.max(ps[selected-1].x+1,Math.min(ps[selected+1].x-1,p.x));Object.assign(old,p);draw();preview();}
    graph.onpointerdown=e=>{e.preventDefault();const p=coords(e),ps=points();selected=ps.findIndex(q=>Math.hypot(p.x-q.x,p.y-q.y)<12);if(selected<0){ps.push(p);channels[channel]=normalizeCurvePoints(ps);selected=channels[channel].findIndex(q=>q.x===p.x);}drag=true;graph.setPointerCapture(e.pointerId);move(p);};
    graph.onpointermove=e=>{if(drag)move(coords(e));};graph.onpointerup=graph.onpointercancel=()=>drag=false;
    input.onchange=output.onchange=()=>move({x:Number(input.value),y:Number(output.value)});
    select.onchange=()=>{channel=select.value;selected=0;draw();};
    parent.append(button('deleteCurvePoint',()=>{const ps=points();if(selected>0&&selected<ps.length-1){ps.splice(selected,1);selected=0;draw();preview();}}),button('resetCurve',()=>{channels[channel]=[{x:0,y:0},{x:255,y:255}];selected=0;draw();preview();}));draw();
  }
  const note=document.createElement('p');note.className='ph3-small';note.textContent=tr('retouchPreviewHelp');parent.append(note,button('applyRetouch',apply,'primary'),button('cancelRetouch',cancel));
}
