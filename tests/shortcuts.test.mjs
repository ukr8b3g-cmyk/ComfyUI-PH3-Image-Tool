import test from 'node:test';
import assert from 'node:assert/strict';
import {editorShortcut} from '../web/shortcuts.mjs';
const key=(key,extra={})=>({key,...extra});
test('layer and selection commands use distinct familiar bindings',()=>{
  for(const [k,action]of [['j','duplicate'],['d','deselect'],['a','selectAll'],['t','transform']])assert.equal(editorShortcut(key(k,{ctrlKey:true})),action);
  assert.equal(editorShortcut(key('Delete')),'remove');
  assert.equal(editorShortcut(key('Backspace')),'remove');
  assert.equal(editorShortcut(key('i',{ctrlKey:true,shiftKey:true})),'invertSelection');
  assert.equal(editorShortcut(key('e',{ctrlKey:true,shiftKey:true})),'mergeVisible');
});
test('stack order and neighboring selection work with shifted bracket characters',()=>{
  assert.equal(editorShortcut(key(']',{ctrlKey:true})),'order:1');
  assert.equal(editorShortcut(key('[',{ctrlKey:true})),'order:-1');
  assert.equal(editorShortcut(key('}',{ctrlKey:true,shiftKey:true})),'edge:1');
  assert.equal(editorShortcut(key('{',{metaKey:true,shiftKey:true})),'edge:-1');
  assert.equal(editorShortcut(key(']',{altKey:true})),'select:1');
});
test('editing, composing, dialogs and AltGr never trigger document commands',()=>{
  for(const e of [key('Delete'),key('j',{ctrlKey:true}),key('d',{ctrlKey:true})]){
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
