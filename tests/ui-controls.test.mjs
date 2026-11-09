import test from 'node:test';
import assert from 'node:assert/strict';
import {actionTone,brushShortcut,draggedBrush} from '../web/ui-controls.mjs';
import {brushOverlay} from '../web/brush-overlay.mjs';

test('brush size/hardness shortcuts do not consume layer order or AltGr commands',()=>{
 assert.deepEqual(brushShortcut({key:']'},1,80),{size:2,hardness:80});
 assert.deepEqual(brushShortcut({key:'['},2,80),{size:1,hardness:80});
 assert.deepEqual(brushShortcut({key:'['},40,80),{size:34,hardness:80});
 assert.deepEqual(brushShortcut({key:']'},40,80),{size:47,hardness:80});
 assert.deepEqual(brushShortcut({key:'{',code:'BracketLeft',shiftKey:true},40,80),{size:40,hardness:70});
 assert.deepEqual(brushShortcut({key:'}',code:'BracketRight',shiftKey:true},40,100),{size:40,hardness:100});
 for(const modifiers of [{ctrlKey:true},{metaKey:true},{altKey:true},{isComposing:true},{getModifierState:()=>true}])assert.equal(brushShortcut({key:'[',...modifiers},40,80),null);
});
test('right-drag brush adjustments are bounded and relative to the initial values',()=>{
 assert.deepEqual(draggedBrush(40,80,20,-20),{size:60,hardness:90});
 assert.deepEqual(draggedBrush(40,80,-1000,1000),{size:1,hardness:0});
 assert.deepEqual(draggedBrush(40,80,1000,-1000),{size:512,hardness:100});
});
test('important actions use four shared accents; close/cancel/stop share red',()=>{
 assert.equal(new Set(['generate','properties','layers','historyTab'].map(actionTone)).size,4);
 for(const key of ['close','cancel','cancelRetouch','stop'])assert.equal(actionTone(key),'red');
 assert.equal(actionTone('newProject'),'blue');assert.equal(actionTone('applyResult'),'green');assert.equal(actionTone('unknown'),'');
});
test('view-only brush ring tracks zoom and hardness and hides for other tools',()=>{
 const old=globalThis.document;
 const element=()=>({style:{setProperty(){}},classList:{toggle(){}},setAttribute(){},append(...children){this.children=children;},remove(){this.removed=true;}});
 globalThis.document={createElement:element};
 try{
  const viewport={clientWidth:800,clientHeight:600,getBoundingClientRect:()=>({left:10,top:20}),append(...children){this.children=children;}};
  const state={tool:'paint',size:40,hardness:80,opacity:50,color:'#ff0000',zoom:2,blocked:false};
  const overlay=brushOverlay(viewport,()=>state);overlay.update({clientX:60,clientY:70});
  const [ring,hud]=viewport.children;assert.equal(ring.style.width,'80px');assert.equal(ring.style.left,'50px');assert.equal(ring.children[0].style.width,'80%');assert.equal(ring.hidden,false);
  overlay.flash();assert.equal(hud.hidden,false);assert.match(hud.textContent,/40 px/);
  state.zoom=.5;overlay.refresh();assert.equal(ring.style.width,'20px');state.tool='move';overlay.refresh();assert.equal(ring.hidden,true);
  overlay.dispose();assert.equal(ring.removed,true);
 }finally{globalThis.document=old;}
});
