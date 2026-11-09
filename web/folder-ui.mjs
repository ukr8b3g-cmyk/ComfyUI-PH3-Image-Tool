export function chooseOutputFolder({client,modal,button,tr,start='',onChoose}){
  const {body,actions,finish,box}=modal(tr('chooseFolder'));
  box.classList.add('ph3-folder-dialog');
  const path=document.createElement('input');path.type='text';path.setAttribute('aria-label',tr('folderPath'));
  const list=document.createElement('div');list.className='ph3-folder-list';
  const message=document.createElement('p');message.setAttribute('role','status');
  const go=button('openFolder',()=>load(path.value)),up=button('parentFolder',()=>load(parent));
  const row=document.createElement('div');row.className='ph3-row';row.append(path,go,up);body.append(row,list,message);
  let current='',parent='',epoch=0;
  const choose=button('useFolder',async()=>{try{choose.disabled=true;const result=await client.post('/output/locations',{path:current});onChoose(result);finish();}catch(e){message.textContent=e.message;choose.disabled=false;}},'primary');actions.prepend(choose);
  path.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();load(path.value);}};
  async function load(value){
    const token=++epoch;choose.disabled=true;message.textContent=tr('working');
    try{const data=await client.post('/output/folders',{path:value});if(token!==epoch||!box.isConnected)return;
      current=data.path;parent=data.parent;path.value=current;up.disabled=parent===null;choose.disabled=!current;list.replaceChildren();
      for(const folder of data.folders){const b=document.createElement('button');b.type='button';b.textContent='▸ '+folder.name;b.title=folder.path;b.onclick=()=>load(folder.path);list.append(b);}
      message.textContent=tr('folderHelp');
    }catch(e){if(token===epoch)message.textContent=e.message;}
  }load(start);
}
