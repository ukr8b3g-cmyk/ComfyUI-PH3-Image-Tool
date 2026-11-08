import test from 'node:test';
import assert from 'node:assert/strict';
import {floodSelect,colorRangeMask,featherMask,combineMasks,selectionOperation} from '../web/selection.mjs';
const red=[255,0,0,255],blue=[0,0,255,255];
const image={width:5,height:2,data:new Uint8ClampedArray([red,red,blue,red,[255,0,0,0],red,blue,blue,red,red].flat())};
test('wand selects four-connected matching pixels, color selects disconnected matching pixels',()=>{
 assert.deepEqual([...floodSelect(image,0,0,0)],[255,255,0,0,0,255,0,0,0,0]);
 assert.deepEqual([...colorRangeMask(image,[{r:255,g:0,b:0}],[],0)],[255,255,0,255,0,255,0,0,255,255]);
});
test('source tolerance, alpha distinction and color exclusion',()=>{
 assert.equal(floodSelect(image,4,0,0).filter(Boolean).length,1);
 assert.equal(colorRangeMask(image,[{r:250,g:0,b:0}],[],0).filter(Boolean).length,0);
 assert.equal(colorRangeMask(image,[{r:250,g:0,b:0}],[],5).filter(Boolean).length,6);
 assert.equal(colorRangeMask(image,[{r:255,g:0,b:0}],[{r:255,g:0,b:0}],30).filter(Boolean).length,0);
});
test('modifier precedence and incremental selection operations',()=>{
 const a=floodSelect(image,0,0,0),b=floodSelect(image,3,0,0);
 const added=combineMasks(a,b,selectionOperation(true,false));assert.equal(added.filter(Boolean).length,6);
 assert.deepEqual(combineMasks(added,b,selectionOperation(false,true)),a);
 assert.deepEqual(combineMasks(added,b,selectionOperation(true,true)),b);
 assert.equal(selectionOperation(false,false,'subtract'),'subtract');
});
test('anti-alias softens edges while preserving an all-selected mask',()=>{
 assert.deepEqual(featherMask(new Uint8ClampedArray(10).fill(255),5,2,1),new Uint8ClampedArray(10).fill(255));
 assert.ok(featherMask(floodSelect(image,0,0,0),5,2,1).some(x=>x>0&&x<255));
});
