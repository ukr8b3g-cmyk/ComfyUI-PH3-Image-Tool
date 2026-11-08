import test from 'node:test';import assert from 'node:assert/strict';
import {visibleHandlePoints} from '../web/viewport.mjs';
const size={width:800,height:600},view={zoom:1,x:0,y:0,angle:0};
test('top-clipped rotation handle flips inward without changing layer',()=>{const l={x:100,y:0,w:200,h:200,rotation:0};const before=JSON.stringify(l),p=visibleHandlePoints(l,view,size,size).find(p=>p.id==='rotate');assert.equal(p.y,28);assert.equal(JSON.stringify(l),before);});
test('available top rotation handle stays outside',()=>{const p=visibleHandlePoints({x:100,y:100,w:200,h:200},view,size,size).find(p=>p.id==='rotate');assert.equal(p.y,-28);});
