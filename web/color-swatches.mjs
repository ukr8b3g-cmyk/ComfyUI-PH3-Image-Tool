// Shared palette for every native color picker. Selecting a chip uses the same
// input/change transaction as dragging the picker, including one-step Undo.
export const QUICK_COLORS = ['#111111','#ffffff','#808080','#e74747','#ff982c','#ffd42a','#b4e82a','#59bb82','#54c8de','#387cde','#7757cf','#ba65b2','#ef4080','#8e6767','#e3bfa3','#c7cbd0',
  '#30363d','#666b73','#8f313f','#bb5373','#f3b665','#f4e397','#87a74a','#40835e','#278b97','#25578c','#493788','#71438c','#d88aba','#a7cbb4','#a4c7dc','#dac8e6'];

const gray = Array.from({length:16},(_,i)=>'#'+Math.round(i*255/15).toString(16).padStart(2,'0').repeat(3));
const hues = ['#ff0000','#ff8000','#ffff00','#80ff00','#00ff00','#00ff80','#00ffff','#0080ff','#0000ff','#8000ff','#ff00ff','#ff0080','#c03030','#a06020','#608040','#408080'];
export const PALETTE_COLORS = [...gray,...Array.from({length:8},(_,row)=>hues.map(color=>{
  const rgb=color.slice(1).match(/../g).map(v=>parseInt(v,16));
  const shade=row<4?rgb.map(v=>255-(255-v)*(row+1)/4):rgb.map(v=>v*(8-row)/5);
  return '#'+shade.map(v=>Math.round(v).toString(16).padStart(2,'0')).join('');
})).flat()];

export function chooseSwatch(input,color){
  if(input.disabled || input.value.toLowerCase()===color.toLowerCase())return;
  input.value=color;
  input.dispatchEvent(new Event('input',{bubbles:true}));
  input.dispatchEvent(new Event('change',{bubbles:true}));
}

export function colorControl(input,tr){
  const wrapper=document.createElement('div');wrapper.className='ph3-color-control';
  const toggle=document.createElement('button');toggle.type='button';toggle.className='ph3-palette-toggle';toggle.textContent='▦';
  const title=tr('colorSwatches');toggle.title=title;toggle.setAttribute('aria-label',title+' · '+input.getAttribute('aria-label'));toggle.setAttribute('aria-expanded','false');
  const popup=document.createElement('div');popup.className='ph3-color-palette';popup.popover='auto';popup.setAttribute('role','group');popup.setAttribute('aria-label',title);
  const heading=document.createElement('strong');heading.textContent=title;const header=document.createElement('div');header.className='ph3-palette-header';const close=document.createElement('button');close.type='button';close.textContent='×';close.dataset.tone='red';close.setAttribute('aria-label',tr('close'));close.title=tr('close');close.onclick=()=>{popup.hidePopover();toggle.focus();};header.append(heading,close);popup.append(header);
  const grids=[];
  for(const colors of [QUICK_COLORS,PALETTE_COLORS]){
    const grid=document.createElement('div');grid.className='ph3-palette-grid';
    for(const color of colors){
      const chip=document.createElement('button');chip.type='button';chip.style.background=color;chip.title=color;chip.setAttribute('aria-label',color);
      chip.onclick=()=>{popup.hidePopover();toggle.focus();chooseSwatch(input,color);};grid.append(chip);
    }popup.append(grid);grids.push(grid);
  }
  const sync=()=>{for(const grid of grids)for(const chip of grid.children)chip.setAttribute('aria-pressed',String(chip.getAttribute('aria-label')===input.value.toLowerCase()));};
  toggle.onclick=()=>{
    if(popup.matches(':popover-open')){popup.hidePopover();return;}
    sync();popup.showPopover();
    const rect=toggle.getBoundingClientRect(),bounds=popup.getBoundingClientRect();
    popup.style.left=Math.max(6,Math.min(innerWidth-bounds.width-6,rect.right-bounds.width))+'px';
    popup.style.top=Math.max(6,Math.min(innerHeight-bounds.height-6,rect.bottom+4))+'px';
    popup.querySelector('button[aria-pressed="true"]')?.focus();
  };
  popup.addEventListener('toggle',()=>toggle.setAttribute('aria-expanded',String(popup.matches(':popover-open'))));
  popup.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();popup.hidePopover();toggle.focus();}});
  wrapper.append(input,toggle,popup);return wrapper;
}
