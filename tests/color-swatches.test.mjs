import test from 'node:test';
import assert from 'node:assert/strict';
import {QUICK_COLORS,PALETTE_COLORS,chooseSwatch} from '../web/color-swatches.mjs';

test('shared palette contains neutral, bright and shaded valid colors',()=>{
  assert.equal(QUICK_COLORS.length,32);
  assert.equal(PALETTE_COLORS.length,144);
  for(const color of [...QUICK_COLORS,...PALETTE_COLORS])assert.match(color,/^#[0-9a-f]{6}$/);
  for(const color of ['#000000','#ffffff','#ff0000','#00ffff'])assert.ok(PALETTE_COLORS.includes(color));
});

test('choosing a swatch follows a single live-input then commit transaction',()=>{
  const input=new EventTarget();input.value='#111111';const events=[];
  for(const type of ['input','change'])input.addEventListener(type,event=>events.push([type,input.value,event.bubbles]));
  chooseSwatch(input,'#ff0000');
  assert.deepEqual(events,[['input','#ff0000',true],['change','#ff0000',true]]);
  chooseSwatch(input,'#FF0000');assert.equal(events.length,2);
  input.disabled=true;chooseSwatch(input,'#ffffff');
  assert.equal(input.value,'#ff0000');assert.equal(events.length,2);
});
