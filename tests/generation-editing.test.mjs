import test from 'node:test';
import assert from 'node:assert/strict';
import {sharedProgress} from '../web/inline-progress.mjs';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
class Element {
 constructor(){this.children=[];this.hidden=false;this.dataset={};this.attrs={};this.style={};this.classList={toggle(){}};}
 setAttribute(k,v){this.attrs[k]=v;}removeAttribute(k){delete this.attrs[k];}
 append(...nodes){this.children.push(...nodes);}get firstElementChild(){return this.children[0];}
}
test('one shared progress component retains an explicit result entry after generation without reopening it',()=>{
 const old=globalThis.document;globalThis.document={createElement:()=>new Element()};
 try{const home=new Element(),p=sharedProgress({home,tr:k=>k}),token=Symbol();let opened=0;
 p.addReview(token,()=>opened++);p.acquire(token);p.show(token,{phase:'generating',numerical:{value:3,max:8,percent:38},started:Date.now(),stop(){}});
 assert.equal(home.children.length,1);assert.equal(opened,0);assert.equal(p.element.children[1].attrs['aria-valuenow'],'38');assert.ok(Object.hasOwn(p.element.children[3].dataset,'ph3JobStop'));
 p.release(token);p.clear();assert.equal(opened,0);assert.equal(p.element.hidden,false);assert.equal(p.element.children[1].hidden,true);assert.equal(p.element.children[2].hidden,true);
 p.element.children[3].onclick();assert.equal(opened,1);p.removeReview(token);assert.equal(p.element.hidden,true);
 }finally{globalThis.document=old;}
});
test('backgrounding a generation dialog leaves monitoring alive and returns keyboard focus to the canvas',()=>{
 const source=readFileSync(new URL('../web/studio.mjs',import.meta.url),'utf8');
 const start=source.indexOf("    box.addEventListener('ph3-background'");const end=source.indexOf("    overlay.addEventListener('keydown'",start);
 const handlers={},ctx={box:{addEventListener:(k,v)=>handlers[k]=v,focus(){ctx.dialogFocused=true;}},overlay:{hidden:false},shared:{mount:(...args)=>ctx.mount=args},top:{},progressHome:{nextSibling:{}},viewport:{focus(){ctx.canvasFocused=true;}},ended:false,header:{},topClose:{}};
 vm.createContext(ctx);vm.runInContext(source.slice(start,end),ctx);handlers['ph3-background']();assert.equal(ctx.overlay.hidden,true);assert.equal(ctx.canvasFocused,true);assert.equal(ctx.mount[0],ctx.top);
 handlers['ph3-foreground']();assert.equal(ctx.overlay.hidden,false);assert.equal(ctx.dialogFocused,true);assert.equal(ctx.mount[0],ctx.header);
});
