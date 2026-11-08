// Local font loading adapter for the ported Speech-Bubble font catalogue.
const pending=new Map();
export async function loadFont(font){
 if(!font?.id)return;
 if(!pending.has(font.id)){
  const family=`PH3Font_${font.id}`;
  const promise=new FontFace(family,`url("/ph3_image_tool/fonts/${encodeURIComponent(font.id)}")`).load().then(face=>{document.fonts.add(face);return family;});
  pending.set(font.id,promise);promise.catch(()=>pending.delete(font.id));
 }
 return pending.get(font.id);
}
export async function prepareFonts(doc){
 await Promise.all(doc.layers.filter(l=>l.visible&&l.fontId).map(l=>loadFont({id:l.fontId})));
}

// Keep file IDs intact for saved documents, but present one row per family/style.
export function groupFonts(fonts,selectedId=null){
 const groups=new Map(),key=s=>String(s||'').normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase();
 for(const font of fonts){const family=font.family||font.name||font.id,k=key(family);if(!groups.has(k))groups.set(k,{key:k,family,fonts:[],variants:[]});groups.get(k).fonts.push(font);}
 for(const group of groups.values()){
  const styles=new Map();for(const font of group.fonts){const k=key(font.style||'Regular');if(!styles.has(k)||font.id===selectedId)styles.set(k,font);}
  group.variants=[...styles.values()].sort((a,b)=>Number(!!b.primary_style)-Number(!!a.primary_style));
  group.primary=group.variants.find(f=>f.id===selectedId)||group.variants.find(f=>f.primary_style)||group.variants[0];
 }return [...groups.values()];
}
