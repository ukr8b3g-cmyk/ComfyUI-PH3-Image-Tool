import {nodeProgress} from './node-progress.mjs?v=59a8d35b929e86cd';
import {app} from '../../../scripts/app.js';
import {api} from '../../../scripts/api.js';

const editors=new WeakMap();
const widget=(node,name)=>node.widgets?.find(w=>w.name===name);
function install(node,knownType=false){
  if(!knownType&&node.comfyClass!=='PH3ImageTool'&&node.type!=='PH3ImageTool')return;
  if(node.widgets?.some(w=>w.name==='Open PH3 Image Tool'))return;
  for(const name of ['project_id','revision']){
    const w=widget(node,name);if(!w)continue;w.hidden=true;w.serialize=true;w.options={...w.options,hidden:true,serialize:true};w.computeSize=()=>[0,-4];
  }
  const launch=node.addWidget('button','Open PH3 Image Tool',null,async()=>{
    const existing=editors.get(node);if(existing){existing.focus();return;}
    if(node.__ph3Opening)return;node.__ph3Opening=true;
    let baseline=[String(widget(node,'project_id')?.value||''),Number(widget(node,'revision')?.value||0)];
    try{
      // Keep the launch widget independent of the editor module graph.
      const [{Client},{openStudio}]=await Promise.all([import('./client.mjs?v=59a8d35b929e86cd'),import('./studio.mjs?v=59a8d35b929e86cd')]);
      const client=new Client({fetcher:(path,opts)=>api.fetchApi(path,opts),url:path=>api.apiURL(path),clientId:api.clientId,progressEvents:api});
      const editor=await openStudio({client,onGenerationJob:(job,graph)=>monitor.queued(job,graph),hostLocale:()=>app.ui?.settings?.getSettingValue?.('Comfy.Locale')||document.documentElement.lang||navigator.language,projectId:baseline[0],inputAsset:node.__ph3Input||null,
        onApply:record=>{
          if(!node.graph)throw Error('The destination node was removed. The project is still saved locally.');
          const current=[String(widget(node,'project_id')?.value||''),Number(widget(node,'revision')?.value||0)];
          if(current[0]!==baseline[0]||current[1]!==baseline[1])throw Error('Node changed while editing. The project is saved, but automatic node replacement was refused.');
          const graph=node.graph;graph.beforeChange?.();try{
            for(const[name,value]of [['project_id',record.id],['revision',record.revision]]){const w=widget(node,name);w.value=value;w.callback?.(value);}
            baseline=[record.id,record.revision];node.setDirtyCanvas?.(true,true);
          }finally{graph.afterChange?.();}
        },onClose:()=>editors.delete(node)});
      editors.set(node,editor);
    }catch(error){console.error('[PH3 Image Tool]',error);window.alert('PH3 Image Tool: '+error.message);}
    finally{node.__ph3Opening=false;}
  },{serialize:false});
  const monitor=nodeProgress(node,api,app.ui?.settings?.getSettingValue?.('Comfy.Locale')||document.documentElement.lang);
  launch.serialize=false;node.__ph3ToolInstalled=true;
  const executed=node.onExecuted;node.onExecuted=function(message,...args){const result=executed?.call(this,message,...args);if(message?.ph3_input?.[0]){node.__ph3Input=message.ph3_input[0];editors.get(node)?.updateInput(node.__ph3Input);}return result;};
  const removed=node.onRemoved;node.onRemoved=function(...args){monitor.dispose();editors.get(node)?.detach();return removed?.apply(this,args);};
  node.setSize?.([Math.max(350,node.size?.[0]||0),Math.max(160,node.computeSize?.()[1]||0)]);
}
app.registerExtension({name:'ukr8b3g.ph3-image-tool',nodeCreated:node=>install(node),loadedGraphNode:node=>install(node),
  afterConfigureGraph(){for(const node of app.graph?._nodes||[])install(node);},
  async beforeRegisterNodeDef(nodeType,nodeData){
    if(nodeData.name!=='PH3ImageTool')return;
    const created=nodeType.prototype.onNodeCreated;nodeType.prototype.onNodeCreated=function(...args){const result=created?.apply(this,args);queueMicrotask(()=>install(this,true));return result;};
    const configured=nodeType.prototype.onConfigure;nodeType.prototype.onConfigure=function(...args){const result=configured?.apply(this,args);install(this,true);return result;};
  }});
