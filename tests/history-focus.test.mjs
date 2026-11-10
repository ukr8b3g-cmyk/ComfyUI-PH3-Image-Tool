import test from 'node:test';import assert from 'node:assert/strict';
import {historySelection} from '../web/core.mjs';
test('paste Redo focuses the added layer; Undo never leaves a missing target',()=>{
 const base={id:'a',asset:'original'},paste={id:'b',asset:'copy'};
 assert.equal(historySelection({layers:[base]},{layers:[base,paste]},'a'),'b');
 assert.equal(historySelection({layers:[base,paste]},{layers:[base]},'b'),'a');
});
test('transform history restores the changed layer rather than an unrelated sibling',()=>{
 const a={id:'a',x:1},b={id:'b',x:2};
 assert.equal(historySelection({layers:[a,b]},{layers:[{...a,x:0},b]},'b'),'a');
 assert.equal(historySelection({layers:[a]},{layers:[]},'a'),null);
});
