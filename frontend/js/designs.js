/* ═══════════════ SAVED DESIGNS + TEMPLATES ═══════════════
   Serialising the canvas is the whole trick here. The cart uses stripImg()
   to drop image data (it only needs a thumbnail), but a saved design has to
   be fully restorable — so images are kept as data URIs and re-hydrated
   into Image objects on load. */

/* Which design is currently open, so Save updates rather than duplicates. */
state.designId = null;

function serialiseLayers(){
  const one = L => {
    if(L.type!=='img') return {...L};
    const c={...L}; delete c.img;
    c.src = L.img ? L.img.src : null;   // data URI or mockup path
    return c;
  };
  return Object.fromEntries(Object.entries(state.layers)
    .map(([key,layers])=>[key,(layers||[]).map(one)]));
}

/* Rebuild layer objects, waiting for every image to decode before drawing —
   otherwise the canvas renders a half-loaded design. */
function hydrateLayers(data){
  const pending=[];
  const one = L => {
    if(L.type!=='img' || !L.src) return {...L};
    const out={...L}; const img=new Image();
    pending.push(new Promise(res=>{ img.onload=res; img.onerror=res; }));
    img.src=L.src; out.img=img; delete out.src;
    return out;
  };
  const layers=Object.fromEntries(Object.entries(data||{})
    .map(([key,items])=>[key,(items||[]).map(one)]));
  return Promise.all(pending).then(()=>layers);
}

async function saveDesign(){
  if(!state.user){ openLogin(); toast('Sign in to save your designs'); return; }
  if(!enabledPrintViews().some(v=>(state.layers[v.key]||[]).length)){
    toast('Add something to the design first'); return;
  }
  const suggested = state.designName || (state.product.name+' drop');
  const name = prompt('Name this design', suggested);
  if(name===null) return;                       // cancelled

  try{
    const res=await fetch(BACKEND+'/api/designs',{
      method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',
      body:JSON.stringify({
        id: state.designId || undefined,
        name: name.trim() || suggested,
        product_id: state.product.id,
        shirt_color: state.shirtColor,
        layers: serialiseLayers(),
        thumb: captureThumb('image/jpeg',0.6),
      }),
    });
    const d=await res.json();
    if(!d.ok){ toast(d.error||'Could not save'); return; }
    state.designId=d.design.id;
    state.designName=d.design.name;
    toast('Saved “'+d.design.name+'”');
  }catch(err){ toast('Could not reach the server — try again.'); }
}

async function loadDesign(id){
  try{
    const res=await fetch(BACKEND+'/api/designs/'+id,{credentials:'include'});
    const d=await res.json();
    if(!d.ok){ toast(d.error||'Could not open that design'); return; }

    const p=PRODUCTS.find(x=>x.id===d.design.product_id);
    if(p){ state.product=p; document.getElementById('stProduct').value=p.id; }
    state.shirtColor=d.design.shirt_color||'#FFFFFF';
    document.querySelectorAll('.sw').forEach(el=>
      el.classList.toggle('on', el.title===state.shirtColor));

    state.layers=await hydrateLayers(d.design.layers);
    configureProductViews(state.product.id,true);
    state.enabledViews=printViews(state.product.id)
      .filter(v=>v.required||(state.layers[v.key]||[]).length).map(v=>v.key);
    state.sel=-1;
    // A template is a starting point, not a document you overwrite.
    state.designId = d.design.is_template ? null : d.design.id;
    state.designName = d.design.is_template ? null : d.design.name;

    closeTemplates();
    // The saved design can be for a different garment, and a tote's size
    // keys aren't a tee's — rebuild the breakdown before pricing it.
    toggleJerseyKit(); updateProductSub(); resetSizesForProduct(); updatePrice();
    setSide(state.enabledViews[0]||'front'); renderLayers(); draw();
    openPdp(state.product.id);
    toast(d.design.is_template ? 'Template loaded — make it yours' : 'Opened “'+d.design.name+'”');
  }catch(err){ toast('Could not reach the server — try again.'); }
}

async function deleteDesign(id, name){
  if(!confirm('Delete “'+name+'”? This cannot be undone.')) return;
  try{
    const res=await fetch(BACKEND+'/api/designs/'+id,{method:'DELETE',credentials:'include'});
    const d=await res.json();
    if(!d.ok){ toast(d.error||'Could not delete'); return; }
    if(state.designId===id){ state.designId=null; state.designName=null; }
    toast('Deleted');
    renderDesigns();
  }catch(err){ toast('Could not reach the server — try again.'); }
}

function newDesign(){
  state.layers={front:[],back:[],left_sleeve:[],right_sleeve:[]};
  configureProductViews(state.product.id);
  state.sel=-1; state.designId=null; state.designName=null;
  setSide('front'); renderLayers(); draw(); openPdp(state.product.id);
  toast('Fresh canvas');
}

/* ── My Designs gallery ── */
async function renderDesigns(){
  const el=document.getElementById('designsBody'); if(!el) return;
  if(!state.user){
    el.innerHTML=`<div class="empty">
      <span class="material-symbols-outlined">palette</span><br>
      Sign in to save and resume designs.<br><br>
      <button class="btn btn-primary" onclick="openLogin()">Sign in</button></div>`;
    return;
  }
  el.innerHTML=skeletonPhotoCards(4);
  let designs=[];
  try{
    const res=await fetch(BACKEND+'/api/designs/mine',{credentials:'include'});
    const d=await res.json();
    if(d.ok) designs=d.designs;
  }catch(err){ el.innerHTML='<div class="empty">Could not reach the server.</div>'; return; }

  const tiles = designs.map(d=>`
    <div class="card card-hover pcard">
      <div class="pcard-img">${d.thumb?`<img src="${d.thumb}" alt="">`:''}</div>
      <div class="pcard-body">
        <h3 class="pcard-name" style="font-size:15px">${esc(d.name)}</h3>
        <div class="pcard-tiers">Edited ${new Date(d.updated+'Z').toLocaleDateString('en-IN')}</div>
        <div class="row" style="gap:8px">
          <button class="btn btn-primary btn-sm" style="flex:1" onclick="loadDesign(${d.id})">Continue</button>
          <button class="btn btn-quiet btn-sm" onclick="deleteDesign(${d.id},'${esc(d.name).replace(/'/g,"\\'")}')" aria-label="Delete">
            <span class="material-symbols-outlined" style="font-size:18px">delete</span>
          </button>
        </div>
      </div>
    </div>`).join('');

  el.innerHTML=`<div class="grid grid-4">
    <button class="card new-design-tile" onclick="newDesign()">
      <span class="material-symbols-outlined" style="font-size:34px">add</span>
      <span class="t-label">Start new design</span>
    </button>${tiles}</div>`;
}

/* ── Template picker ── */
async function openTemplates(){
  const m=document.getElementById('templateModal');
  const body=document.getElementById('templateBody');
  m.classList.add('on');
  body.innerHTML=skeletonPhotoCards(4);
  try{
    const res=await fetch(BACKEND+'/api/designs/templates');
    const d=await res.json();
    if(!d.ok || !d.designs.length){
      body.innerHTML=`<div class="empty">
        <span class="material-symbols-outlined">auto_awesome_motion</span><br>
        No templates yet.<br>
        <span style="font-size:13px">An admin can publish any saved design as a template.</span></div>`;
      return;
    }
    body.innerHTML=`<div class="grid grid-4">`+d.designs.map(t=>`
      <div class="card card-hover pcard" style="cursor:pointer" onclick="loadDesign(${t.id})">
        <div class="pcard-img">${t.thumb?`<img src="${t.thumb}" alt="">`:''}</div>
        <div class="pcard-body"><h3 class="pcard-name" style="font-size:14px">${esc(t.name)}</h3></div>
      </div>`).join('')+`</div>`;
  }catch(err){ body.innerHTML='<div class="empty">Could not reach the server.</div>'; }
}
function closeTemplates(){ document.getElementById('templateModal').classList.remove('on'); }
