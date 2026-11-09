import test from 'node:test';import assert from 'node:assert/strict';import {nodeProgress} from '../web/node-progress.mjs';
test('node progress tracks its own prompt and remains active independently of the editor',()=>{
 const api=new EventTarget(),node={addCustomWidget(w){this.w=w;},setDirtyCanvas(){}};const p=nodeProgress(node,api,'ja');
 const emit=(type,detail)=>api.dispatchEvent(Object.assign(new Event(type),{detail}));
 p.queued({prompt_id:'own'},{'11':{class_type:'SamplerCustomAdvanced'}});
 emit('progress',{prompt_id:'other',node:'11',value:4,max:8});assert.equal(node.w.value.percent,null);
 emit('progress',{prompt_id:'own',node:'11',value:4,max:8});assert.equal(node.w.value.percent,50);
 emit('executing',{prompt_id:'own',node:null});assert.equal(node.w.value.active,false);assert.equal(node.w.value.text,'生成完了');
 p.dispose();emit('progress',{prompt_id:'own',node:'11',value:7,max:8});assert.equal(node.w.value.active,false);
});
test('a cached execution completing before the queue response does not leave the node stuck generating',()=>{
 const api=new EventTarget(),node={addCustomWidget(w){this.w=w;}};const p=nodeProgress(node,api);
 api.dispatchEvent(Object.assign(new Event('executing'),{detail:{prompt_id:'early',node:null}}));p.queued({prompt_id:'early'},{'11':{class_type:'SamplerCustomAdvanced'}});assert.equal(node.w.value.active,false);assert.equal(node.w.value.text,'Generation complete');p.dispose();
});
