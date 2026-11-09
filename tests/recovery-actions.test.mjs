// Actual recovery handlers with controlled transport, including failure paths.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const studio=readFileSync(new URL('../web/studio.mjs',import.meta.url),'utf8');
const source=studio.slice(studio.indexOf('  function offerDraftRecovery(){'),studio.indexOf('  function commit('));
function fixture(reject=false){
 const buttons=[],errors=[],posts=[],pending={id:'old',key:'old-draft',raw:'DO NOT CHANGE',draft:{revision:0,document:{width:8,height:8,layers:[]}}};let closeCallback;
 const ctx={draftRecovery:pending,record:{id:'old',revision:0},doc:{width:8,height:8,settings:{locale:'en'}},busy:0,closed:false,
  el:(tag,cls,text)=>({tag,cls,text,dataset:{}}),tr:k=>k,queueMicrotask,
  modal(){return{body:{append(){}},actions:{append:b=>buttons.push(b)},box:{classList:{add(){}},addEventListener(_e,fn){closeCallback=fn;}},finish(){ctx.finishes++;closeCallback();}};},
  client:{async post(url,body){posts.push({url,body});if(reject)throw Error('write failed');return{id:'fresh',document:{width:8,height:8,layers:[]}};}},
  withBusy:async fn=>fn(),async switchRecord(next){ctx.switched=next;},requestClose(){ctx.editorCloses++;},fail:e=>errors.push(e.message),
  finishes:0,editorCloses:0,localStorage:{removeItem(){throw Error('Must not remove the old draft');},setItem(){throw Error('Must not replace the old draft');}}};
 vm.createContext(ctx);vm.runInContext(source,ctx);ctx.offerDraftRecovery();return{ctx,pending,buttons,errors,posts,close:()=>closeCallback()};
}
test('Start new creates a separate blank project without discarding the previous draft',async()=>{
 const {ctx,pending,buttons,posts}=fixture();assert.deepEqual(buttons.map(b=>b.text),['newFromDraft','resumeDraft']);
 await buttons[0].onclick();await Promise.resolve();
 assert.equal(ctx.switched.id,'fresh');assert.equal(ctx.finishes,1);assert.equal(ctx.editorCloses,0);
 assert.equal(posts[0].url,'/projects');assert.equal(posts[0].body.width,8);assert.equal(pending.raw,'DO NOT CHANGE');
});
test('failed blank-project creation keeps the recovery prompt and original draft',async()=>{
 const {ctx,pending,buttons,errors}=fixture(true);await buttons[0].onclick();
 assert.equal(ctx.finishes,0);assert.equal(ctx.switched,undefined);assert.equal(pending.raw,'DO NOT CHANGE');assert.deepEqual(errors,['write failed']);
});
test('closing the prompt retains the existing protected-draft close path',async()=>{
 const {ctx,pending,close}=fixture();close();await Promise.resolve();assert.equal(ctx.editorCloses,1);assert.equal(pending.raw,'DO NOT CHANGE');
});
