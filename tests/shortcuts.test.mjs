import test from 'node:test';
import assert from 'node:assert/strict';
import {editorShortcut} from '../web/shortcuts.mjs';
import {readFileSync} from 'node:fs';import vm from 'node:vm';
const key=(key,extra={})=>({key,...extra});
test('layer and selection commands use distinct familiar bindings',()=>{
  for(const [k,action]of [['j','duplicate'],['d','deselect'],['a','selectAll'],['t','transform']])assert.equal(editorShortcut(key(k,{ctrlKey:true})),action);
  assert.equal(editorShortcut(key('Delete')),'remove');
  assert.equal(editorShortcut(key('Backspace')),'remove');
  assert.equal(editorShortcut(key('i',{ctrlKey:true,shiftKey:true})),'invertSelection');
  assert.equal(editorShortcut(key('e',{ctrlKey:true,shiftKey:true})),'mergeVisible');
  assert.equal(editorShortcut(key('e')),'tool:pixelEraser');
  assert.equal(editorShortcut(key('E',{shiftKey:true})),'tool:erase');
});
test('stack order and neighboring selection work with shifted bracket characters',()=>{
  assert.equal(editorShortcut(key(']',{ctrlKey:true})),'order:1');
  assert.equal(editorShortcut(key('[',{ctrlKey:true})),'order:-1');
  assert.equal(editorShortcut(key('}',{ctrlKey:true,shiftKey:true})),'edge:1');
  assert.equal(editorShortcut(key('{',{metaKey:true,shiftKey:true})),'edge:-1');
  assert.equal(editorShortcut(key(']',{altKey:true})),'select:1');
});
test('editing, composing, dialogs and AltGr never trigger document commands',()=>{
  for(const e of [key('Delete'),key('j',{ctrlKey:true}),key('d',{ctrlKey:true}),key('e'),key('E',{shiftKey:true})]){
    assert.equal(editorShortcut(e,{typing:true}),null);
    assert.equal(editorShortcut(e,{blocked:true}),null);
    assert.equal(editorShortcut({...e,isComposing:true}),null);
    assert.equal(editorShortcut({...e,keyCode:229}),null);
    assert.equal(editorShortcut({...e,defaultPrevented:true}),null);
  }
  assert.equal(editorShortcut(key('j',{ctrlKey:true,altKey:true})),null);
  assert.equal(editorShortcut(key('j',{ctrlKey:true,getModifierState:()=>true})),null);
  assert.equal(editorShortcut(key('Delete',{ctrlKey:true})),null);
});

test('selection tools cycle and reselect without stealing composing or blocked input',()=>{
 assert.equal(editorShortcut(key('m')),'tool:rect');assert.equal(editorShortcut(key('M',{shiftKey:true}),{tool:'rect'}),'tool:ellipse');assert.equal(editorShortcut(key('M',{shiftKey:true}),{tool:'ellipse'}),'tool:rect');
 assert.equal(editorShortcut(key('w')),'tool:wand');assert.equal(editorShortcut(key('l')),'tool:lasso');assert.equal(editorShortcut(key('d',{ctrlKey:true,shiftKey:true})),'reselect');
 for(const e of [key('m'),key('d',{ctrlKey:true,shiftKey:true})]){assert.equal(editorShortcut(e,{typing:true}),null);assert.equal(editorShortcut(e,{blocked:true}),null);assert.equal(editorShortcut({...e,isComposing:true}),null);}
});
test('actual deselect and reselect handlers preserve a copy and reject different canvases',async()=>{
 const studio=readFileSync(new URL('../web/studio.mjs',import.meta.url),'utf8'),source=studio.slice(studio.indexOf('  let selectionRecall=null;'),studio.indexOf('  async function replaceSelection(next){'));
 const ctx={busy:false,selection:Uint8ClampedArray.from([255,0]),doc:{width:2,height:1},record:{id:'one'},maskBounds:m=>m.some(v=>v)?[0,0,1,1]:null};ctx.replaceSelection=async next=>ctx.selection=next;vm.createContext(ctx);vm.runInContext(source,ctx);
 await ctx.deselectSelection();assert.deepEqual([...ctx.selection],[0,0]);await ctx.reselectSelection();assert.deepEqual([...ctx.selection],[255,0]);ctx.selection[0]=1;await ctx.reselectSelection();assert.equal(ctx.selection[0],255);
 ctx.record.id='two';ctx.selection.fill(0);await ctx.reselectSelection();assert.deepEqual([...ctx.selection],[0,0]);ctx.record.id='one';ctx.doc.width=1;await ctx.reselectSelection();assert.deepEqual([...ctx.selection],[0,0]);
});
