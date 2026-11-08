import test from 'node:test';
import assert from 'node:assert/strict';
import {moveLayerRelative,insertImageLayer} from '../web/core.mjs';
test('layer drop uses visible above/below order in either direction',()=>{const l=['a','b','c','d'].map(id=>({id}));assert.ok(moveLayerRelative(l,'a','c',true));assert.deepEqual(l.map(x=>x.id),['b','c','a','d']);moveLayerRelative(l,'d','b',false);assert.deepEqual(l.map(x=>x.id),['d','b','c','a']);moveLayerRelative(l,'a','c',false);assert.deepEqual(l.map(x=>x.id),['d','b','a','c']);});
test('locked, missing and same layer drops cannot mutate order',()=>{const l=[{id:'a',locked:true},{id:'b'}],before=JSON.stringify(l);for(const ids of [['a','b'],['z','b'],['b','z'],['b','b']])assert.equal(moveLayerRelative(l,...ids),false);assert.equal(JSON.stringify(l),before);});
test('imported image remains below editable text and bubbles',()=>{const d={layers:[{id:'base',type:'image'},{id:'bubble',type:'bubble'},{id:'text',type:'text'}]};insertImageLayer(d,{id:'new',type:'image'});assert.deepEqual(d.layers.map(l=>l.id),['base','new','bubble','text']);});
