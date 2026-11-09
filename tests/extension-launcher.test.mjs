import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {nodeProgress} from '../web/node-progress.mjs';

function fixture(){
  let extension;const alerts=[];let loads=0;
  const app={registerExtension:e=>extension=e,graph:{_nodes:[]}};
  const source=fs.readFileSync(new URL('../web/extension.js',import.meta.url),'utf8')
    .replace(/^import .*?;\r?\n/gm,'')
    .replace(/await Promise\.all\(\[import\([^\n]+?\)\]\)/,"await loadEditor()");
  vm.runInNewContext(source,{app,api:new EventTarget(),nodeProgress,document:{documentElement:{lang:'en'}},queueMicrotask,console:{error(){}},window:{alert:s=>alerts.push(s)},loadEditor:async()=>{loads++;throw Error('test module failure');}});
  const node={type:'PH3ImageTool',widgets:[{name:'project_id',value:'saved-project'},{name:'revision',value:5}],size:[300,150],addCustomWidget(w){this.widgets.push(w);},addWidget(type,name,value,callback,options){const w={type,name,value,callback,options};this.widgets.push(w);return w;},setSize(size){this.size=size;},computeSize(){return[300,160];}};
  return {extension,node,alerts,loads:()=>loads,app};
}
test('launcher registers without loading editor; repeated hooks preserve project and one button',()=>{
  const f=fixture();f.extension.nodeCreated(f.node);f.extension.loadedGraphNode(f.node);f.app.graph._nodes=[f.node];f.extension.afterConfigureGraph();
  assert.equal(f.loads(),0);assert.equal(f.node.widgets.length,4);
  assert.equal(f.node.widgets[0].value,'saved-project');assert.equal(f.node.widgets[1].value,5);
  assert.equal(f.node.widgets[2].serialize,false);
});
test('failed editor import leaves launcher available and permits retry',async()=>{
  const f=fixture();f.extension.nodeCreated(f.node);
  await f.node.widgets[2].callback();await f.node.widgets[2].callback();
  assert.equal(f.loads(),2);assert.equal(f.alerts.length,2);assert.equal(f.node.__ph3Opening,false);
  assert.equal(f.node.widgets[0].value,'saved-project');
});
test('known node type configures before comfyClass assignment; failed widget creation can retry',async()=>{
  const f=fixture();function Node(){};await f.extension.beforeRegisterNodeDef(Node,{name:'PH3ImageTool'});
  f.node.type='display name';Node.prototype.onConfigure.call(f.node);assert.equal(f.node.widgets.length,4);
  const g=fixture(),add=g.node.addWidget;g.node.addWidget=()=>{throw Error('temporary');};assert.throws(()=>g.extension.nodeCreated(g.node));
  g.node.addWidget=add;g.extension.nodeCreated(g.node);assert.equal(g.node.widgets.length,4);
});
