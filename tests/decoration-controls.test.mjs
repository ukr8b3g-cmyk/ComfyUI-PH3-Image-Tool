import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceRays} from '../web/source-speed.mjs';
import {imageRasterKey} from '../web/render.mjs';
import {SPEEDS} from '../web/presets.mjs';

test('source emphasis controls affect geometry while preserving deterministic presets',()=>{
  for(const [, , ,preset] of SPEEDS){
    const layer={w:800,h:600,seed:42,...preset};
    const rays=sourceRays(layer);
    assert.ok(rays.length>0);assert.deepEqual(sourceRays(layer),rays);
    for(const [key,value]of [['lineLength',.6],['taper',.1],['gapY',.2],['speedWidth',.02],['lengthRandom',.7],['innerRandom',.1],['spacingRandom',.8]]){
      assert.notDeepEqual(sourceRays({...layer,[key]:value}),rays,key);
    }
  }
});
test('tint cache keys isolate color, alpha mask and original image',()=>{
  const source={asset:'original',mask_asset:'alpha'};
  assert.equal(imageRasterKey(source),'original:alpha');
  assert.notEqual(imageRasterKey({...source,colorize:true,tintColor:'#ff0000'}),imageRasterKey({...source,colorize:true,tintColor:'#00ff00'}));
  assert.equal(imageRasterKey({...source,colorize:false,tintColor:'#ff0000'}),imageRasterKey(source));
  assert.notEqual(imageRasterKey({...source,colorize:true}),imageRasterKey({...source,mask_asset:null,colorize:true}));
});
