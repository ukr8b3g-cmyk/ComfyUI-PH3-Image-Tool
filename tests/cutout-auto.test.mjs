import test from 'node:test';
import assert from 'node:assert/strict';
import {autoColorCutout,refineCutout} from '../web/cutout-auto.mjs';
const image=(w=12,h=10)=>({width:w,height:h,data:new Uint8ClampedArray(w*h*4)});
function rect(p,x,y,w,h,color){for(let j=y;j<y+h;j++)for(let i=x;i<x+w;i++)p.data.set(color,(j*p.width+i)*4);}
const alpha=(p,x,y)=>p.data[(y*p.width+x)*4+3];
function fixture(){const p=image();rect(p,0,0,12,10,[40,180,100,255]);rect(p,3,2,6,6,[190,20,40,255]);rect(p,5,4,2,2,[40,180,100,255]);return p;}
test('auto removes exterior colour and preserves enclosed same-colour region',()=>{const p=fixture(),before=p.data.slice(),out=autoColorCutout(p);assert.equal(alpha(out,0,0),0);assert.equal(alpha(out,3,3),255);assert.equal(alpha(out,5,4),255);assert.deepEqual(p.data,before);});
test('auto finds background inside transparent side margins',()=>{const p=fixture();rect(p,0,0,2,10,[0,0,0,0]);rect(p,10,0,2,10,[0,0,0,0]);const out=autoColorCutout(p);assert.equal(alpha(out,2,0),0);assert.equal(alpha(out,4,3),255);assert.equal(alpha(out,0,0),0);});
test('manual addition removes an isolated leftover, undo restores Auto base',()=>{const p=fixture(),base=autoColorCutout(p),out=refineCutout(p,base,[{seed:[5,4],remove:true}]);assert.equal(alpha(out,5,4),0);assert.equal(alpha(out,4,3),255);assert.equal(alpha(refineCutout(p,base,[]),5,4),255);assert.equal(alpha(base,5,4),255);});
test('manual restore uses original alpha without reviving original transparency',()=>{const p=fixture();rect(p,0,0,1,1,[0,0,0,0]);const base=autoColorCutout(p),out=refineCutout(p,base,[{seed:[1,0],remove:false},{seed:[0,0],remove:false}]);assert.equal(alpha(out,1,0),255);assert.equal(alpha(out,0,0),0);});
test('refinements preserve source RGB and apply latest add/restore in order',()=>{const p=fixture(),base=autoColorCutout(p);rect(base,0,0,12,10,[255,255,255,0]);const out=refineCutout(p,base,[{seed:[4,3],remove:false},{seed:[4,3],remove:true}]);assert.equal(alpha(out,4,3),0);assert.deepEqual([...out.data.slice(4*40,4*40+3)],[...p.data.slice(4*40,4*40+3)]);});
test('empty transparency remains untouched; mismatched base rejected',()=>{const p=image();assert.deepEqual(autoColorCutout(p),p);assert.throws(()=>refineCutout(p,image(2,2),[]),/dimensions/);});
