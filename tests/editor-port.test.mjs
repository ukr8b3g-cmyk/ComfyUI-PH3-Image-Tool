import test from 'node:test';
import assert from 'node:assert/strict';
import {bubblePath} from '../web/source-bubbles.mjs';
import {sourceRays} from '../web/source-speed.mjs';
import {BUBBLES} from '../web/presets.mjs';
test('original procedural oval is symmetric at zero asymmetry',()=>{
 const path=bubblePath('base-oval',{asymmetry:0});
 assert.equal(path.length,4);
 assert.ok(Math.abs(path[0].x-.5)<1e-12);
 assert.ok(Math.abs(path[1].x+path[3].x-1)<1e-12);
 assert.ok(Math.abs(path[0].y+path[2].y-1)<1e-12);
});
test('all source bubble controls remain finite and deterministic',()=>{
 for(const [id] of BUBBLES){const a=bubblePath(id,{seed:123});assert.deepEqual(a,bubblePath(id,{seed:123}));for(const p of a)for(const value of Object.values(p))assert.ok(Number.isFinite(value));}
});
test('fixed thought cloud ignores random deformation',()=>{
 assert.deepEqual(bubblePath('base-thought',{asymmetry:0}),bubblePath('base-thought',{asymmetry:100,seed:987}));
});
test('ported rays support off-canvas centers and rectangular canvases',()=>{
 for(const centerX of [-.12,.5,1.12]){const l={w:1200,h:600,lines:130,centerX,seed:42,gap:.3,lineWidth:3};const rays=sourceRays(l);assert.ok(rays.length>0);assert.deepEqual(rays,sourceRays(l));for(const polygon of rays){assert.equal(polygon.length,4);assert.ok(polygon.flat().every(Number.isFinite));}}
});
