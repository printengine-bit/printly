/* ═══════════════ STUDIO: setup ═══════════════ */
const cv=document.getElementById('teeCanvas'), ctx=cv.getContext('2d');
function initStudio(){
  const sel=document.getElementById('stProduct');
  PRODUCTS.forEach(p=>sel.innerHTML+=`<option value="${p.id}">${p.name}</option>`);
  const sw=document.getElementById('swatches');
  SHIRT_COLORS.forEach((c,i)=>{
    const d=document.createElement('div');
    d.className='sw'+(i===0?' on':''); d.style.background=c;
    d.title=c;
    d.onclick=()=>{ state.shirtColor=c;
      document.querySelectorAll('.sw').forEach(x=>x.classList.remove('on')); d.classList.add('on'); draw(); };
    sw.appendChild(d);
  });
  updateProductSub();
  configureProductViews(state.product.id);
  resetSizesForProduct();
  updatePrice();
  // Without this the layers column is a bare heading until the first edit —
  // the empty state (and the getting-started guide inside it) never showed
  // on the one screen that most needs it.
  renderLayers();
  renderPlacementRow();
  renderPrintControls();
}
/* Left-panel tab switcher (Base / Assets / AI) */
function studioTab(name){
  document.querySelectorAll('.st-tab').forEach(t=>t.classList.toggle('on',t.dataset.tab===name));
  document.querySelectorAll('.st-panel').forEach(p=>p.classList.toggle('on',p.id==='tab-'+name));
}
/* Fabric/spec line under the product name */
const PRODUCT_SPEC={
  rn:'180 GSM combed cotton', po:'220 GSM pique cotton',
  hd:'320 GSM fleece blend',  js:'130 GSM dry-fit polyester',
  tb:'12 oz canvas',
};
function updateProductSub(){
  const el=document.getElementById('stProductSub');
  if(el) el.textContent=PRODUCT_SPEC[state.product.id]||'Premium fabric';
}
function configureProductViews(pid, preserve=false){
  const defs=printViews(pid);
  defs.forEach(v=>{ if(!Array.isArray(state.layers[v.key])) state.layers[v.key]=[]; });
  if(!preserve || state._viewProduct!==pid){
    state.enabledViews=defs.filter(v=>v.required||v.default).map(v=>v.key);
  }else{
    state.enabledViews=(state.enabledViews||[]).filter(k=>defs.some(v=>v.key===k));
    defs.filter(v=>v.required).forEach(v=>{
      if(!state.enabledViews.includes(v.key)) state.enabledViews.push(v.key);
    });
  }
  if(!state.enabledViews.includes(state.side)) state.side=state.enabledViews[0]||defs[0].key;
  state._viewProduct=pid;
}
function printGroups(){
  const out=[];
  printViews(state.product.id).forEach(v=>{
    let g=out.find(x=>x.key===v.group);
    if(!g){ g={key:v.group,label:v.group==='sleeves'?'Sleeves':v.label,views:[],fee:+v.surcharge||0}; out.push(g); }
    g.views.push(v); g.fee=Math.max(g.fee,+v.surcharge||0);
  });
  return out;
}
function togglePrintGroup(key,on){
  const g=printGroups().find(x=>x.key===key); if(!g) return;
  if(!on && g.views.some(v=>v.required)){ renderPrintControls(); return; }
  if(!on && g.views.some(v=>(state.layers[v.key]||[]).length) &&
     !confirm('Turn off this print location? Its artwork will stay saved, but it will not be printed or priced.')){
    renderPrintControls(); return;
  }
  g.views.forEach(v=>{
    const i=state.enabledViews.indexOf(v.key);
    if(on && i<0) state.enabledViews.push(v.key);
    if(!on && i>=0) state.enabledViews.splice(i,1);
  });
  if(!state.enabledViews.includes(state.side)) setSide(state.enabledViews[0]);
  renderPrintControls(); updatePrice(); syncCta();
}
function renderPrintControls(){
  const groups=document.getElementById('printSideGroups');
  if(groups) groups.innerHTML=printGroups().map(g=>{
    const on=g.views.every(v=>state.enabledViews.includes(v.key));
    const required=g.views.some(v=>v.required);
    return `<label class="print-check${required?' required':''}">
      <input type="checkbox" ${on?'checked':''} ${(required||state.plainItem)?'disabled':''}
             onchange="togglePrintGroup('${g.key}',this.checked)">
      <span>${esc(g.label)}</span>${g.fee?`<small>+₹${g.fee}</small>`:''}
    </label>`;
  }).join('');
  const mirror=document.getElementById('canvasPrintGroups');
  if(mirror) mirror.innerHTML=printGroups().map(g=>{
    const on=g.views.every(v=>state.enabledViews.includes(v.key));
    const required=g.views.some(v=>v.required);
    return `<button class="${on?'on':''}${required?' required':''}"
       ${required||state.plainItem?'disabled':''}
       onclick="togglePrintGroup('${g.key}',${!on})">
       <span class="material-symbols-outlined">${on?'check_box':'check_box_outline_blank'}</span>${esc(g.label)}
     </button>`;
  }).join('');
  const tabs=document.getElementById('printViewTabs');
  if(tabs) tabs.innerHTML=enabledPrintViews().map(v=>
    `<button class="${state.side===v.key?'on':''}" onclick="setSide('${v.key}')">${esc(v.label)}</button>`
  ).join('');
}
function togglePlainItem(on){
  state.plainItem=!!on;
  renderPrintControls(); updatePrice(); syncCta();
}
function markCustomized(){
  if(!state.plainItem) return;
  state.plainItem=false;
  const t=document.getElementById('plainItemToggle'); if(t) t.checked=false;
  renderPrintControls();
}
function addJerseyKit(){
  markCustomized();
  const nm=(document.getElementById('jkName').value||'').trim().toUpperCase();
  const nu=(document.getElementById('jkNum').value||'').trim();
  const s1=(document.getElementById('jkSp1').value||'').trim().toUpperCase();
  const s2=(document.getElementById('jkSp2').value||'').trim().toUpperCase();
  const col=document.getElementById('jkColor').value;
  pushUndo();
  setSide('back');
  const P=pa(), cx=P.x+P.w/2;
  const L=[];
  if(s1) L.push({type:'text',text:s1,x:cx,y:P.y+26,size:20,font:'Archivo Narrow',color:col,bold:true});
  if(nm) L.push({type:'text',text:nm,x:cx,y:P.y+68,size:30,font:'Archivo Narrow',color:col,bold:true});
  if(nu) L.push({type:'text',text:nu,x:cx,y:P.y+150,size:96,font:'Archivo Narrow',color:col,bold:true});
  if(s2) L.push({type:'text',text:s2,x:cx,y:P.y+P.h-22,size:18,font:'Archivo Narrow',color:col,bold:true});
  state.layers.back=L; state.sel=-1;
  renderLayers(); draw();
  toast('Jersey back applied — drag anything to fine-tune');
}
function toggleJerseyKit(){
  document.getElementById('jerseyKit').style.display =
    state.product.id==='js' ? 'block' : 'none';
}
/* Move artwork from one print area to another, keeping where it sits on the
   garment rather than its absolute pixel position — so a centred design
   stays centred. `shrink` also scales the artwork down to fit a smaller
   zone; that's right when the *product* changes (a tote's zone is much
   smaller than a hoodie's) and wrong when only the *size* changes, where
   the print is a fixed physical thing and the garment moved around it. */
function remapLayers(old,P,shrink){
  Object.keys(state.layers).forEach(s=>{
    (state.layers[s]||[]).forEach(L=>{
      const rx=(L.x-old.x)/old.w, ry=(L.y-old.y)/old.h;
      L.x=P.x+rx*P.w; L.y=P.y+ry*P.h;
      if(shrink && P.w<old.w){
        const f=P.w/old.w;
        if(L.type==='text') L.size=Math.max(10,L.size*f);
        else { L.w*=f; L.h*=f; }
      }
    });
  });
}

/* Redraw against a different garment size when the order's smallest size
   changes. Called after every size edit; a no-op unless the size actually
   moved, so it costs nothing on a quantity bump. */
function applyPreviewSize(){
  if(typeof previewSize!=='function' || !document.getElementById('teeCanvas')) return;
  const pid=state.product.id, side=state.side, size=previewSize();
  const stamp=pid+'|'+side+'|'+size;
  if(state._drawnStamp===stamp) return;
  // Only remap when the garment SIZE moved. A product change does its own
  // remap (with shrinking), and a side flip lands on a different set of
  // layers that were never in this zone to begin with.
  const sizeOnly = state._drawnStamp && state._drawnStamp.indexOf(pid+'|'+side+'|')===0;
  const old=state._drawnPA;
  const P=pa();
  state._drawnStamp=stamp;
  state._drawnPA={x:P.x,y:P.y,w:P.w,h:P.h};
  if(old && sizeOnly) remapLayers(old,P,false);
  zoomOut();   // P just moved; a stale zoom transform would frame the wrong spot
  draw();
}

function studioProductChange(){
  const old=pa();
  state.product=PRODUCTS.find(p=>p.id===document.getElementById('stProduct').value);
  state.cropMode=false;state.activePlacement=null;
  document.querySelector('.studio')?.classList.remove('crop-mode');
  configureProductViews(state.product.id);
  const P=pa();
  remapLayers(old,P,true);   // keep existing artwork inside the new zone
  zoomOut();                 // the box a zoom was framing belonged to the old product's zone
  toggleJerseyKit();
  updateProductSub();
  resetSizesForProduct();   // size keys differ (a tote is one-size)
  renderPrintControls(); updatePrice(); draw();
  toast(state.product.name+' — mockup updated');
}
function setSide(s){
  if(!state.enabledViews.includes(s)) return;
  state.side=s; state.sel=-1;state.cropMode=false;state.activePlacement=null;
  document.querySelector('.studio')?.classList.remove('crop-mode');
  zoomOut();   // the other side's layers were never in this zoomed box
  document.getElementById('tabF')?.classList.toggle('on',s==='front');
  document.getElementById('tabB')?.classList.toggle('on',s==='back');
  const label=printView(state.product.id,s)?.label||s.replaceAll('_',' ');
  const sideLabel=document.getElementById('sideLabel'); if(sideLabel) sideLabel.textContent=label;
  renderPrintControls();
  renderPlacementRow();   // front/back offer different presets
  renderLayers(); applyPreviewSize(); draw();
}

/* ═══════════════ STUDIO: drawing ═══════════════ */
/* print area per product — px box + real print size in cm */
const PRINT_AREAS={
  rn:{x:150,y:150,w:220,h:280,cmW:30,cmH:38},
  po:{x:175,y:180,w:170,h:200,cmW:22,cmH:26},
  hd:{x:155,y:185,w:210,h:195,cmW:28,cmH:26},
  js:{x:150,y:185,w:220,h:265,cmW:30,cmH:36},
  tb:{x:175,y:225,w:170,h:215,cmW:22,cmH:28},
};
function pa(){
  const L=mockLayout(state.product.id);
  if(L) return {x:L.px,y:L.py,w:L.pw,h:L.ph,cmW:L.cmW,cmH:L.cmH};
  const base=state.product.id.split('-')[0];
  return PRINT_AREAS[state.product.id]||PRINT_AREAS[base]||PRINT_AREAS.rn;
}
function pxcm(){ const P=pa(); return P.w/P.cmW; }   // pixels per cm

/* ── garment silhouettes ── */
function drawGarment(c,type,color){
  const LINE='rgba(13,31,60,.30)', SOFT='rgba(13,31,60,.22)';
  c.save();
  c.fillStyle=color; c.strokeStyle=LINE; c.lineWidth=2;
  c.lineJoin='round';

  // Audience-specific lines share a leading garment family (rn/po/hd/sw).
  // Their dedicated photography can be added later; until then these fitted
  // vector silhouettes keep every new catalogue SKU usable in the studio.
  const women=type.endsWith('-women');
  const kids=type.endsWith('-kids');
  const base=type.split('-')[0];
  if(women){ c.save(); c.translate(260,0); c.scale(0.92,1); c.translate(-260,0); }
  if(kids){ c.save(); c.translate(260,42); c.scale(0.80,0.84); c.translate(-260,0); }

  if(base==='tb'){                                   // ── TOTE BAG ──
    c.strokeStyle=LINE; c.lineWidth=7; c.lineCap='round';
    c.beginPath(); c.moveTo(196,195); c.bezierCurveTo(196,95,246,95,246,195); c.stroke();
    c.beginPath(); c.moveTo(274,195); c.bezierCurveTo(274,95,324,95,324,195); c.stroke();
    c.lineWidth=2;
    c.beginPath();
    c.moveTo(150,185); c.lineTo(370,185);
    c.lineTo(378,495); c.quadraticCurveTo(260,512,142,495);
    c.closePath(); c.fill(); c.stroke();
    c.beginPath(); c.strokeStyle=SOFT; c.moveTo(152,205); c.lineTo(368,205); c.stroke();

  } else if(base==='hd'){                            // ── HOODIE ──
    c.beginPath();
    c.moveTo(140,115); c.quadraticCurveTo(195,82,260,82);
    c.quadraticCurveTo(325,82,380,115);
    c.lineTo(482,175); c.lineTo(442,240); c.lineTo(396,208);
    c.lineTo(396,512); c.lineTo(124,512); c.lineTo(124,208);
    c.lineTo(78,240); c.lineTo(38,175);
    c.closePath(); c.fill(); c.stroke();
    // hood
    c.beginPath();
    c.moveTo(186,118); c.bezierCurveTo(198,26,322,26,334,118);
    c.bezierCurveTo(302,84,218,84,186,118);
    c.closePath(); c.fill(); c.stroke();
    // drawstrings
    c.strokeStyle=SOFT; c.lineWidth=2.5; c.lineCap='round';
    c.beginPath(); c.moveTo(238,112); c.lineTo(234,182); c.stroke();
    c.beginPath(); c.moveTo(282,112); c.lineTo(286,182); c.stroke();
    c.fillStyle=SOFT;
    c.beginPath(); c.arc(234,185,4,0,7); c.fill();
    c.beginPath(); c.arc(286,185,4,0,7); c.fill();
    // pocket
    c.strokeStyle=SOFT; c.lineWidth=2;
    c.beginPath(); c.moveTo(176,406); c.lineTo(344,406);
    c.lineTo(344,474); c.lineTo(176,474); c.closePath(); c.stroke();

  } else if(base==='sw'){                            // ── CREWNECK SWEATSHIRT ──
    c.beginPath();
    c.moveTo(150,92); c.quadraticCurveTo(205,62,260,62);
    c.quadraticCurveTo(315,62,370,92);
    c.lineTo(474,158); c.lineTo(438,232); c.lineTo(390,202);
    c.lineTo(390,508); c.lineTo(130,508); c.lineTo(130,202);
    c.lineTo(82,232); c.lineTo(46,158);
    c.closePath(); c.fill(); c.stroke();
    c.strokeStyle=SOFT; c.lineWidth=3;
    c.beginPath(); c.arc(260,84,38,0,Math.PI); c.stroke();
    c.beginPath(); c.moveTo(132,478); c.lineTo(388,478); c.stroke();

  } else if(base==='js'){                            // ── SPORTS JERSEY ──
    c.beginPath();
    c.moveTo(155,95); c.lineTo(260,150); c.lineTo(365,95);
    c.lineTo(452,148); c.lineTo(416,208); c.lineTo(380,182);
    c.lineTo(380,498); c.lineTo(140,498); c.lineTo(140,182);
    c.lineTo(104,208); c.lineTo(68,148);
    c.closePath(); c.fill(); c.stroke();
    // v-neck trim
    c.strokeStyle=SOFT; c.lineWidth=4; c.lineJoin='round';
    c.beginPath(); c.moveTo(160,100); c.lineTo(260,153); c.lineTo(360,100); c.stroke();
    // side panels
    c.lineWidth=1.6;
    c.beginPath(); c.moveTo(160,190); c.lineTo(160,498); c.stroke();
    c.beginPath(); c.moveTo(360,190); c.lineTo(360,498); c.stroke();

  } else if(base==='po'){                            // ── POLO SHIRT ──
    c.beginPath();
    c.moveTo(150,90); c.quadraticCurveTo(190,62,260,62);
    c.quadraticCurveTo(330,62,370,90);
    c.lineTo(470,150); c.lineTo(430,215); c.lineTo(385,185);
    c.lineTo(385,500); c.lineTo(135,500); c.lineTo(135,185);
    c.lineTo(90,215); c.lineTo(50,150);
    c.closePath(); c.fill(); c.stroke();
    // collar flaps
    c.strokeStyle=LINE;
    c.beginPath(); c.moveTo(212,68); c.lineTo(256,116); c.lineTo(264,74); c.closePath(); c.fill(); c.stroke();
    c.beginPath(); c.moveTo(308,68); c.lineTo(264,116); c.lineTo(256,74); c.closePath(); c.fill(); c.stroke();
    // placket + buttons
    c.strokeStyle=SOFT; c.lineWidth=1.8;
    c.beginPath(); c.moveTo(249,112); c.lineTo(249,172); c.stroke();
    c.beginPath(); c.moveTo(271,112); c.lineTo(271,172); c.stroke();
    c.fillStyle=SOFT;
    c.beginPath(); c.arc(260,126,3.6,0,7); c.fill();
    c.beginPath(); c.arc(260,152,3.6,0,7); c.fill();
    // sleeve cuffs
    c.strokeStyle=SOFT; c.lineWidth=1.6;
    c.beginPath(); c.moveTo(94,206); c.lineTo(135,178); c.stroke();
    c.beginPath(); c.moveTo(426,206); c.lineTo(385,178); c.stroke();

  } else {                                           // ── ROUND NECK TEE ──
    c.beginPath();
    c.moveTo(150,90); c.quadraticCurveTo(190,60,260,60);
    c.quadraticCurveTo(330,60,370,90);
    c.lineTo(470,150); c.lineTo(430,215); c.lineTo(385,185);
    c.lineTo(385,500); c.lineTo(135,500); c.lineTo(135,185);
    c.lineTo(90,215); c.lineTo(50,150);
    c.closePath(); c.fill(); c.stroke();
    c.beginPath(); c.strokeStyle='rgba(13,31,60,.35)';
    c.moveTo(205,72); c.quadraticCurveTo(260,115,315,72); c.stroke();
  }
  if(kids) c.restore();
  if(women) c.restore();
  c.restore();
}
/* `clean` renders the garment + artwork only, with no editor overlays —
   used by captureThumb() so cart/design/order thumbnails don't have the
   print-area guide or selection UI baked into them. */
/* `canvasZoom`/`camTx`/`camTy` are the current camera: draw() applies them
   as the canvas's transform before painting the unchanged logical 520×560
   scene, so this one line is what makes every existing drawImage/fillText
   call in the function below sample fresh detail from the source images at
   whatever resolution `cv.width`/`cv.height` currently hold — see
   zoomToBox() for why that's a genuine fix and not just a bigger blur. */
function draw(clean){
  ctx.setTransform(1,0,0,1,0,0);
  ctx.clearRect(0,0,cv.width,cv.height);
  ctx.setTransform(canvasZoom,0,0,canvasZoom,camTx,camTy);
  state._transformHandles=null;
  const L=mockLayout(state.product.id);
  if(L){
    const mock=getRecoloredMock(L.key,state.shirtColor);
    if(mock){
      // Stage first: the mockup's own background is transparent now, so
      // without this a dark garment sits on a dark page and disappears.
      drawStage(ctx,state.shirtColor,L.ox,L.oy,L.dw,L.dh);
      drawMockup(ctx,mock,L.ox,L.oy,L.dw,L.dh);
    }
    else drawGarment(ctx,state.product.id,state.shirtColor);
  } else {
    drawGarment(ctx,state.product.id,state.shirtColor);
  }
  // print area guide — line weight and dash length are UI chrome, so they're
  // divided by `u` to hold a constant ON-SCREEN size regardless of zoom.
  // Without this, canvasZoom draws the whole bitmap bigger — chrome included
  // — and a zoomed-in placement view turns a thin dashed border into a thick
  // one and a small delete badge into something that eclipses the artwork
  // it's meant to sit beside. See canvasZoom near zoomToBox().
  const P=pa();
  const u = 1/canvasZoom;
  const isPdp=document.querySelector('.studio.pdp-mode');
  if(!clean && (!isPdp || state.sel>=0)){
    ctx.setLineDash([8*u,8*u]); ctx.strokeStyle=safeZoneColor(); ctx.lineWidth=2*u;
    ctx.strokeRect(P.x,P.y,P.w,P.h); ctx.setLineDash([]);
  }
  // layers
  const Ls=state.layers[state.side];
  Ls.forEach((L,i)=>{
    ctx.save();
    ctx.beginPath(); ctx.rect(P.x,P.y,P.w,P.h); ctx.clip();
    drawLayerContent(ctx,L);
    ctx.restore();
    if(i===state.sel && !clean){
      const b=layerBounds(L),g=layerGeometry(L),c=g.corners;
      ctx.strokeStyle=L.locked?'#999':'#c8f232'; ctx.lineWidth=2*u;
      ctx.beginPath();ctx.moveTo(c.tl.x,c.tl.y);ctx.lineTo(c.tr.x,c.tr.y);
      ctx.lineTo(c.br.x,c.br.y);ctx.lineTo(c.bl.x,c.bl.y);ctx.closePath();ctx.stroke();
      // live size readout in cm
      const k=pxcm();
      ctx.fillStyle='#c8f232'; ctx.font=`700 ${11*u}px Inter,sans-serif`; ctx.textAlign='center';
      ctx.fillText(`${(g.w/k).toFixed(1)} × ${(g.h/k).toFixed(1)} cm`, g.rotate.x, g.rotate.y-10*u);
      if(L.locked){
        state._transformHandles=null;
        ctx.font=`700 ${11*u}px Inter,sans-serif`; ctx.textAlign='center'; ctx.textBaseline='middle';
        ctx.fillStyle='#999'; ctx.fillText('🔒 LOCKED', b.x+b.w/2, b.y+b.h/2);
      } else {
        // Four genuine resize handles plus one rotation handle. Their visual
        // and hit sizes stay constant on screen at every camera zoom.
        ctx.beginPath();ctx.moveTo(g.top.x,g.top.y);ctx.lineTo(g.rotate.x,g.rotate.y);
        ctx.strokeStyle='#c8f232';ctx.lineWidth=1.5*u;ctx.stroke();
        const hr=6*u,rr=8*u;
        Object.values(c).forEach(p=>{
          ctx.beginPath();ctx.arc(p.x,p.y,hr,0,Math.PI*2);
          ctx.fillStyle='#fff';ctx.fill();ctx.strokeStyle='#c8f232';ctx.lineWidth=2*u;ctx.stroke();
        });
        ctx.beginPath();ctx.arc(g.rotate.x,g.rotate.y,rr,0,Math.PI*2);
        ctx.fillStyle='#c8f232';ctx.fill();ctx.strokeStyle='#fff';ctx.lineWidth=2*u;ctx.stroke();
        state._transformHandles={corners:c,rotate:g.rotate,r:Math.max(10*u,hr+4*u)};
      }
    }
  });
  // centre snap guides
  const cx=P.x+P.w/2, cy=P.y+P.h/2;
  if(state.guides.v!==false&&state.guides.v!=null){
    const gx=state.guides.v===true?cx:state.guides.v;
    ctx.strokeStyle='rgba(255,177,192,.9)'; ctx.lineWidth=1*u; ctx.setLineDash([5*u,4*u]);
    ctx.beginPath(); ctx.moveTo(gx,P.y-24); ctx.lineTo(gx,P.y+P.h+24); ctx.stroke(); ctx.setLineDash([]);
  }
  if(state.guides.h!==false&&state.guides.h!=null){
    const gy=state.guides.h===true?cy:state.guides.h;
    ctx.strokeStyle='rgba(255,177,192,.9)'; ctx.lineWidth=1*u; ctx.setLineDash([5*u,4*u]);
    ctx.beginPath(); ctx.moveTo(P.x-24,gy); ctx.lineTo(P.x+P.w+24,gy); ctx.stroke(); ctx.setLineDash([]);
  }
  updateMeasure();
}
function safeZoneColor(){
  const [r,g,b]=hexToRgb(state.shirtColor||'#FFFFFF');
  const linear=v=>{
    v/=255;
    return v<=.04045?v/12.92:Math.pow((v+.055)/1.055,2.4);
  };
  const luminance=.2126*linear(r)+.7152*linear(g)+.0722*linear(b);
  return luminance<.36?'rgba(255,255,255,.86)':'rgba(0,0,0,.72)';
}

/* ── measurement + alignment assistant ── */
function updateMeasure(){
  const box=document.getElementById('measureBar'); if(!box) return;
  const P=pa(), k=pxcm();
  const zone=document.getElementById('zoneLabel');
  const size=typeof previewSize==='function'?previewSize():'';
  const sized=sizeKeys(state.product.id).length>1;
  if(zone) zone.innerHTML = sized
    ? `Print zone on <b>${esc(size)}</b> · ${P.cmW} × ${P.cmH} cm`
    : `Print zone · ${P.cmW} × ${P.cmH} cm`;
  drawRuler(P,k);

  let html='', outside=false;
  const L=state.layers[state.side][state.sel];
  if(!L){
    html=`<span class="mz quiet">Select an item to see its size &amp; alignment</span>`;
  }else{
    const b=layerBounds(L);
    const cx=P.x+P.w/2;
    const centred=Math.abs(L.x-cx)<1.5;
    outside = b.x<P.x-1||b.y<P.y-1||b.x+b.w>P.x+P.w+1||b.y+b.h>P.y+P.h+1;
    html+=`<span class="mz"><b>${(b.w/k).toFixed(1)} × ${(b.h/k).toFixed(1)}</b> cm</span>`;
    html+=`<span class="mz">From top <b>${((b.y-P.y)/k).toFixed(1)}</b> cm</span>`;
    html+=centred?`<span class="mz ok">Centred</span>`
                 :`<span class="mz">Off-centre <b>${(Math.abs(L.x-cx)/k).toFixed(1)}</b> cm</span>`;
    if(outside) html+=`<span class="mz bad">Will be cropped</span>`;
    html+=`<span class="mz quiet">Drag corners to resize · top handle rotates</span>`;
  }
  box.innerHTML=html;

  // The mockup surfaces this as a floating pill rather than an inline chip.
  const warn=document.getElementById('stWarn');
  if(warn){
    warn.classList.toggle('on',outside);
    // previewSize() is the SMALLEST size in the order, so this warning is
    // already the strictest one: if it fits what's on screen it fits every
    // garment in the order. Naming the size is what makes that legible.
    document.getElementById('stWarnText').textContent =
      sizeKeys(state.product.id).length>1
        ? `Outside the print area on ${previewSize()}`
        : 'Object outside print area';
  }
  syncToolbar();
}

/* The ruler used to be four hardcoded numbers that meant nothing. It now
   spans the print zone itself and is relabelled every draw, so it stays
   true when the garment size changes the zone underneath it. */
function drawRuler(P,k){
  const el=document.getElementById('stRuler'); if(!el) return;
  const disp=cv.getBoundingClientRect().width||520;
  const f=disp/520;                              // canvas px → screen px
  const w=P.w*f;
  el.style.marginLeft=(P.x*f)+'px';
  el.style.width=w+'px';
  // The zone is only ~135px wide on a desktop canvas and less on a phone, so
  // tick density comes from the space available, not from a fixed step —
  // five labels in that width overlap into mush.
  const cm=P.cmW, maxTicks=Math.max(2,Math.min(5,Math.floor(w/48)));
  let step=50;
  for(const s of [5,10,20,25,50]){ if(cm/s+1<=maxTicks){ step=s; break; } }
  const ticks=[];
  for(let v=0;v<=cm-step*0.4;v+=step) ticks.push(v);
  el.innerHTML=ticks.map((v,i)=>`<span>${i?v:'0cm'}</span>`).join('')
    +`<span>${cm}</span>`;
}
/* Eight of the ten toolbar icons do nothing until something is selected, and
   answering every click with "Select an item first" taught nobody anything.
   Dim them instead, so the two that always work stand out. */
function syncToolbar(){
  const live=state.sel>=0;
  document.querySelector('.studio')?.classList.toggle('has-selection',live);
  renderPlacementRow();
  document.querySelectorAll('.st-toolbar button[data-needsel]')
    .forEach(b=>b.disabled=!live);
  const L=live?state.layers[state.side][state.sel]:null;
  document.getElementById('selectedActions')?.classList.toggle('on',live);
  document.getElementById('btnStroke')?.classList.toggle('on', !!(L&&L.stroke));
  document.getElementById('btnShadow')?.classList.toggle('on', !!(L&&L.shadow));
  document.getElementById('btnCrop')?.classList.toggle('on', !!(L&&L.cropZoom>1));
  document.getElementById('btnEffects')?.classList.toggle('on', !!(L&&L.effect));
  document.querySelectorAll('[data-image-only]').forEach(b=>b.disabled=!L||L.type!=='img');
  if((!L||L.type!=='img')&&state.cropMode){
    state.cropMode=false;document.querySelector('.studio')?.classList.remove('crop-mode');
  }
  renderContextToolbar();
  const u=document.getElementById('btnUndo'), r=document.getElementById('btnRedo');
  if(u) u.disabled=!undoStack.length;
  if(r) r.disabled=!redoStack.length;
}
const CONTEXT_FONTS=['Archivo Narrow','Inter','Georgia','Impact','Courier New','Brush Script MT'];
let contextEditOpen=false;
function beginContextEdit(){if(!contextEditOpen){pushUndo();contextEditOpen=true;}}
function finishContextEdit(){
  contextEditOpen=false;renderLayers();draw();
}
function mutateSelected(change,force){
  const L=state.layers[state.side][state.sel];
  if(!L){toast('Select an item first');return;}
  if(L.locked){toast('Unlock to edit');return;}
  pushUndo();change(L);renderLayers();draw();renderContextToolbar(force!==false);
}
function positionMenuHTML(){
  const list=PLACEMENTS[state.side]||PLACEMENTS.front;
  return `<details class="ctx-menu"><summary><span class="material-symbols-outlined">open_with</span>Position</summary>
    <div class="ctx-pop">
      <span class="ctx-pop-title">Align in print area</span>
      <div class="ctx-grid">
        <button onclick="alignSel('left')" title="Left">Left</button>
        <button onclick="alignSel('cx')" title="Centre">Centre</button>
        <button onclick="alignSel('right')" title="Right">Right</button>
        <button onclick="alignSel('top')" title="Top">Top</button>
        <button onclick="alignSel('cy')" title="Middle">Middle</button>
        <button onclick="alignSel('bottom')" title="Bottom">Bottom</button>
      </div>
      <span class="ctx-pop-title">Layer order &amp; direction</span>
      <div class="ctx-grid">
        <button onclick="moveSelectedLayer(1)"><span class="material-symbols-outlined">flip_to_front</span>Forward</button>
        <button onclick="moveSelectedLayer(-1)"><span class="material-symbols-outlined">flip_to_back</span>Backward</button>
        <button onclick="flipSelected()"><span class="material-symbols-outlined">flip</span>Flip</button>
      </div>
      <span class="ctx-pop-title">Placement presets</span>
      <div class="ctx-presets">${list.map(([k,label])=>
        `<button onclick="applyPlacement('${k}')">${esc(label)}</button>`).join('')}</div>
    </div></details>`;
}
function renderContextToolbar(force=false){
  const el=document.getElementById('selectedActions');if(!el)return;
  const L=state.layers[state.side][state.sel];
  if(!L){el.classList.remove('on');el.innerHTML='';el.dataset.key='';return;}
  el.classList.add('on');
  const key=`${state.side}:${state.sel}:${L.type}`;
  if(force||el.dataset.key!==key){
    el.dataset.key=key;
    const common=`${positionMenuHTML()}
      <button onclick="toggleLockSel()" title="${L.locked?'Unlock':'Lock'}"><span class="material-symbols-outlined">${L.locked?'lock_open':'lock'}</span></button>
      <button onclick="duplicateSel()" title="Duplicate"><span class="material-symbols-outlined">content_copy</span></button>
      <button onclick="deleteSel()" title="Delete"><span class="material-symbols-outlined">delete</span></button>`;
    if(L.type==='text'){
      el.innerHTML=`<input class="ctx-text" id="ctxText" aria-label="Edit selected text"
          value="${esc(L.text)}" onfocus="beginContextEdit()" oninput="editSelectedText(this.value)"
          onchange="finishContextEdit()">
        <select class="ctx-select" id="ctxFont" aria-label="Font" onchange="setTextProperty('font',this.value)">
          ${CONTEXT_FONTS.map(f=>`<option value="${f}"${f===L.font?' selected':''}>${f.replace(' Narrow','')}</option>`).join('')}
        </select>
        <input class="ctx-colour" id="ctxColor" type="color" aria-label="Text colour" value="${L.color||'#000000'}"
          oninput="beginContextEdit();editTextColour(this.value)" onchange="finishContextEdit()">
        <label class="ctx-slider">Size
          <input id="ctxSize" type="range" min="10" max="110" step="1" value="${Math.round(L.size)}"
            oninput="beginContextEdit();editTextSize(this.value)" onchange="finishContextEdit()">
          <output id="ctxSizeOut">${Math.round(L.size)}px</output>
        </label>
        <button id="ctxBold" class="${L.bold?'on':''}" onclick="toggleTextStyle('bold')" title="Bold"><b>B</b></button>
        <button id="ctxItalic" class="${L.italic?'on':''}" onclick="toggleTextStyle('italic')" title="Italic"><i>I</i></button>
        <button id="ctxUnderline" class="${L.underline?'on':''}" onclick="toggleTextStyle('underline')" title="Underline"><u>U</u></button>
        <button id="ctxStrike" class="${L.strike?'on':''}" onclick="toggleTextStyle('strike')" title="Strike-through"><s>S</s></button>
        <details class="ctx-menu"><summary><span class="material-symbols-outlined">auto_fix_high</span>Effects</summary>
          <div class="ctx-pop">
            <div class="ctx-grid">
              <button class="${L.stroke?'on':''}" onclick="toggleTextStyle('stroke')">Outline</button>
              <button class="${L.shadow?'on':''}" onclick="toggleTextStyle('shadow')">Shadow</button>
            </div>
          </div></details>${common}`;
    }else{
      el.innerHTML=`<button onclick="scaleSelected(1.12)"><span class="material-symbols-outlined">zoom_in</span>Scale</button>
        <details class="ctx-menu"><summary class="${state.cropMode?'on':''}"><span class="material-symbols-outlined">crop</span>Crop</summary>
          <div class="ctx-pop ctx-crop-pop">
            <button class="${state.cropMode?'on':''}" onclick="toggleCropMode()"><span class="material-symbols-outlined">pan_tool</span>${state.cropMode?'Finish crop':'Drag to pan'}</button>
            <label>Zoom <input id="ctxCropZoom" type="range" min="1" max="3" step=".05" value="${+L.cropZoom||1}"
              oninput="beginContextEdit();setImageCrop('zoom',this.value)" onchange="finishContextEdit()"><output id="ctxCropZoomOut">${(+L.cropZoom||1).toFixed(1)}×</output></label>
            <label>Pan X <input id="ctxCropX" type="range" min="-1" max="1" step=".02" value="${+L.cropX||0}"
              oninput="beginContextEdit();setImageCrop('x',this.value)" onchange="finishContextEdit()"><output id="ctxCropXOut">${Math.round((+L.cropX||0)*100)}%</output></label>
            <label>Pan Y <input id="ctxCropY" type="range" min="-1" max="1" step=".02" value="${+L.cropY||0}"
              oninput="beginContextEdit();setImageCrop('y',this.value)" onchange="finishContextEdit()"><output id="ctxCropYOut">${Math.round((+L.cropY||0)*100)}%</output></label>
          </div></details>
        <details class="ctx-menu"><summary><span class="material-symbols-outlined">auto_fix_high</span>Effects</summary>
          <div class="ctx-pop"><div class="ctx-grid">
            ${[['','None'],['grayscale','B&W'],['contrast','Punch'],['soft','Soft']].map(([v,n])=>
              `<button class="${(L.effect||'')===v?'on':''}" onclick="setImageEffect('${v}')">${n}</button>`).join('')}
          </div></div></details>
        <button onclick="replaceImageSel()"><span class="material-symbols-outlined">find_replace</span>Replace</button>${common}`;
    }
  }
  syncContextValues();
}
function syncContextValues(){
  const L=state.layers[state.side][state.sel];if(!L)return;
  const set=(id,value)=>{const n=document.getElementById(id);if(n&&document.activeElement!==n)n.value=value;};
  if(L.type==='text'){
    set('ctxText',L.text);set('ctxFont',L.font);set('ctxColor',L.color);set('ctxSize',Math.round(L.size));
    const out=document.getElementById('ctxSizeOut');if(out)out.value=Math.round(L.size)+'px';
  }else{
    set('ctxCropZoom',+L.cropZoom||1);set('ctxCropX',+L.cropX||0);set('ctxCropY',+L.cropY||0);
    const z=document.getElementById('ctxCropZoomOut'),x=document.getElementById('ctxCropXOut'),y=document.getElementById('ctxCropYOut');
    if(z)z.value=(+L.cropZoom||1).toFixed(1)+'×';
    if(x)x.value=Math.round((+L.cropX||0)*100)+'%';
    if(y)y.value=Math.round((+L.cropY||0)*100)+'%';
  }
}
function editSelectedText(value){
  const L=state.layers[state.side][state.sel];if(!L||L.type!=='text'||L.locked)return;
  L.text=value||' ';draw();
}
function editTextColour(value){
  const L=state.layers[state.side][state.sel];if(!L||L.type!=='text'||L.locked)return;
  L.color=value;draw();
}
function editTextSize(value){
  const L=state.layers[state.side][state.sel];if(!L||L.type!=='text'||L.locked)return;
  L.size=Math.max(10,Math.min(110,+value||10));draw();syncContextValues();
}
function setTextProperty(prop,value){mutateSelected(L=>{if(L.type==='text')L[prop]=value;});}
function toggleTextStyle(prop){mutateSelected(L=>{if(L.type==='text')L[prop]=!L[prop];});}
function alignSel(mode){
  const L=state.layers[state.side][state.sel];
  if(!L){ toast('Select an item first'); return; }
  if(L.locked){ toast('Unlock to edit'); return; }
  pushUndo();
  const P=pa(), b=layerBounds(L);
  if(mode==='cx') L.x=P.x+P.w/2;
  if(mode==='cy') L.y=P.y+P.h/2;
  if(mode==='top')    L.y+= (P.y+8) - b.y;
  if(mode==='bottom') L.y+= (P.y+P.h-8) - (b.y+b.h);
  if(mode==='left')   L.x+= (P.x+8) - b.x;
  if(mode==='right')  L.x+= (P.x+P.w-8) - (b.x+b.w);
  draw();renderContextToolbar(true);
}
function moveLayer(i,dir){
  const Ls=state.layers[state.side],to=Math.max(0,Math.min(Ls.length-1,i+dir));
  if(i<0||i>=Ls.length||to===i)return;
  pushUndo();const [L]=Ls.splice(i,1);Ls.splice(to,0,L);state.sel=to;
  renderLayers();draw();renderContextToolbar(true);
}
function moveSelectedLayer(dir){moveLayer(state.sel,dir);}
function flipSelected(){mutateSelected(L=>L.flipX=!L.flipX);}
function focusLayerPanel(){
  const section=document.getElementById('pdpLayerSection');
  if(section&&!section.hidden){section.scrollIntoView({behavior:'smooth',block:'center'});return;}
  toast('Add text or an image to create a layer');
}
function fitWidth(){
  const L=state.layers[state.side][state.sel];
  if(!L){ toast('Select an item first'); return; }
  if(L.locked){ toast('Unlock to edit'); return; }
  pushUndo();
  const P=pa(); let guard=0;
  while(layerBounds(L).w > P.w-16 && guard++<60) bumpRaw(L,0.96);
  while(layerBounds(L).w < P.w-30 && guard++<120) bumpRaw(L,1.03);
  L.x=P.x+P.w/2; draw(); toast('Fitted to print width');
}
function bumpRaw(L,f){
  if(L.type==='text') L.size=Math.max(8,Math.min(110,L.size*f));
  else { L.w*=f; L.h*=f; }
}
function drawTextLayer(c,L){
  c.font=textFont(L); c.textAlign='center'; c.textBaseline='middle';
  if(L.shadow){
    c.shadowColor='rgba(0,0,0,.45)'; c.shadowBlur=6;
    c.shadowOffsetX=2; c.shadowOffsetY=2;
  }
  if(L.stroke){
    c.lineWidth=Math.max(2,L.size/14); c.strokeStyle=L.strokeColor||'#000000';
    c.strokeText(L.text,0,0);
  }
  c.fillStyle=L.color; c.fillText(L.text,0,0);
  c.shadowColor='transparent';c.shadowBlur=0;c.shadowOffsetX=0;c.shadowOffsetY=0;
  if(L.underline||L.strike){
    const w=c.measureText(L.text).width;
    c.strokeStyle=L.color;c.lineWidth=Math.max(1.5,L.size/18);c.lineCap='round';
    if(L.underline){c.beginPath();c.moveTo(-w/2,L.size*.42);c.lineTo(w/2,L.size*.42);c.stroke();}
    if(L.strike){c.beginPath();c.moveTo(-w/2,0);c.lineTo(w/2,0);c.stroke();}
  }
}
function drawLayerContent(c,L){
  c.save();c.translate(L.x,L.y);c.rotate((+L.rotation||0)*Math.PI/180);
  if(L.flipX)c.scale(-1,1);
  if(L.type==='text') drawTextLayer(c,L);
  else if(L.type==='img'&&L.img) drawImageLayer(c,L);
  c.restore();
}
function drawImageLayer(c,L){
  const filters={grayscale:'grayscale(1)',contrast:'contrast(1.35) saturate(1.15)',soft:'saturate(.75) brightness(1.08)'};
  c.filter=filters[L.effect]||'none';
  const z=Math.max(1,+L.cropZoom||1);
  const iw=L.img.naturalWidth||L.img.width, ih=L.img.naturalHeight||L.img.height;
  const sw=iw/z,sh=ih/z,maxX=iw-sw,maxY=ih-sh;
  const px=Math.max(-1,Math.min(1,+L.cropX||0)),py=Math.max(-1,Math.min(1,+L.cropY||0));
  const sx=maxX*(px+1)/2,sy=maxY*(py+1)/2;
  c.drawImage(L.img,sx,sy,sw,sh,-L.w/2,-L.h/2,L.w,L.h);
  c.filter='none';
}
function cropImageSel(){
  const L=state.layers[state.side][state.sel];
  if(!L||L.type!=='img'){ toast('Select an image layer to crop'); return; }
  if(L.locked){ toast('Unlock to edit'); return; }
  pushUndo();
  const steps=[1,1.2,1.5,2], cur=+L.cropZoom||1;
  L.cropZoom=steps[(steps.indexOf(cur)+1)%steps.length];
  if(L.cropZoom===1){L.cropX=0;L.cropY=0;}
  draw();renderContextToolbar(true);toast(L.cropZoom===1?'Crop reset':`Crop zoom ${L.cropZoom}×`);
}
function effectImageSel(){
  const L=state.layers[state.side][state.sel];
  if(!L||L.type!=='img'){ toast('Select an image layer for effects'); return; }
  if(L.locked){ toast('Unlock to edit'); return; }
  pushUndo();
  const modes=['','grayscale','contrast','soft'];
  L.effect=modes[(modes.indexOf(L.effect||'')+1)%modes.length];
  draw();renderContextToolbar(true);toast(L.effect?`Effect: ${L.effect}`:'Effects removed');
}
function scaleSelected(f){
  if(state.sel<0){ toast('Select an item first'); return; }
  bumpFromList(state.sel,f); renderLayers();
}
function openImagePicker(){ document.getElementById('imgInput')?.click(); }
function openTextTool(){
  const modal=document.getElementById('quickTextModal');
  if(modal){
    modal.classList.add('on');
    setTimeout(()=>document.getElementById('quickTextInput')?.focus(),20);
    return;
  }
  studioTab('assets'); document.getElementById('txtInput')?.focus();
}
function toggleCropMode(){
  const L=state.layers[state.side][state.sel];
  if(!L||L.type!=='img'){toast('Select an image layer to crop');return;}
  if(L.locked){toast('Unlock to edit');return;}
  state.cropMode=!state.cropMode;
  if(state.cropMode&&(+L.cropZoom||1)<=1){pushUndo();L.cropZoom=1.2;}
  document.querySelector('.studio')?.classList.toggle('crop-mode',state.cropMode);
  renderContextToolbar(true);draw();
  toast(state.cropMode?'Crop mode — drag the image to pan':'Crop applied');
}
function setImageCrop(prop,value){
  const L=state.layers[state.side][state.sel];if(!L||L.type!=='img'||L.locked)return;
  if(prop==='zoom')L.cropZoom=Math.max(1,Math.min(3,+value||1));
  if(prop==='x')L.cropX=Math.max(-1,Math.min(1,+value||0));
  if(prop==='y')L.cropY=Math.max(-1,Math.min(1,+value||0));
  draw();syncContextValues();
}
function setImageEffect(mode){
  mutateSelected(L=>{if(L.type==='img')L.effect=mode;},true);
}
function openAiTool(){
  studioTab('ai');
  document.querySelector('.st-left')?.classList.add('tool-open');
  document.querySelector('.st-left')?.scrollIntoView({behavior:'smooth',block:'nearest'});
}
function closeCreativeTools(){
  document.querySelector('.st-left')?.classList.remove('tool-open');
}
function closeQuickText(){
  document.getElementById('quickTextModal')?.classList.remove('on');
}
function quickAddText(){
  const input=document.getElementById('quickTextInput');
  const t=(input?.value||'').trim();
  if(!t){ toast('Type some text first'); input?.focus(); return; }
  document.getElementById('txtInput').value=t;
  document.getElementById('txtFont').value=document.getElementById('quickTextFont').value;
  document.getElementById('txtColor').value=document.getElementById('quickTextColor').value;
  addText();
  input.value='';
  closeQuickText();
}
function togglePreview(){
  state.previewMode=!state.previewMode;
  document.getElementById('btnPreview')?.classList.toggle('on',state.previewMode);
  if(state.previewMode){
    state.sel=-1;state.cropMode=false;
    document.querySelector('.studio')?.classList.remove('crop-mode');
  }
  draw(state.previewMode);
}

/* ═══════════════ STUDIO: placement presets ═══════════════
   Prefilled positions a company logo actually goes — Left/Center/Right
   Chest, Full Front/Back — matching what print catalogues like Printful
   and CustomInk show, so a click replaces a drag-and-eyeball guess.
   "Left chest" follows the on-screen convention every one of those uses
   (their icon sits at the visual top-left of the front view), not the
   wearer's true anatomical left — the two disagree, and screen-left is
   what a customer clicking a picture expects. */
const PLACEMENTS = {
  front: [
    ['full-front',   'Full Front',   'crop_free'],
    ['center-chest', 'Center Chest', 'crop_5_4'],
    ['left-chest',   'Left Chest',   'align_horizontal_left'],
    ['right-chest',  'Right Chest',  'align_horizontal_right'],
    ['upper-center', 'Upper Center', 'vertical_align_top'],
    ['lower-center', 'Lower Center', 'vertical_align_bottom'],
  ],
  back: [
    ['full-back',   'Full Back',   'crop_free'],
    ['upper-back',  'Upper Back',  'vertical_align_top'],
    ['center-back', 'Center Back', 'crop_5_4'],
    ['lower-back',  'Lower Back',  'vertical_align_bottom'],
  ],
  left_sleeve: [
    ['full-sleeve', 'Full Sleeve', 'crop_portrait'],
    ['upper-sleeve','Upper Sleeve','vertical_align_top'],
    ['lower-sleeve','Lower Sleeve','vertical_align_bottom'],
  ],
  right_sleeve: [
    ['full-sleeve', 'Full Sleeve', 'crop_portrait'],
    ['upper-sleeve','Upper Sleeve','vertical_align_top'],
    ['lower-sleeve','Lower Sleeve','vertical_align_bottom'],
  ],
};

/* Box for a preset, in canvas-internal coordinates, derived from the live
   print area P — so it tracks garment size and product changes for free
   instead of needing its own per-product table. Fractions are off real
   placement charts: a chest hit is small (~9-10cm on an actual garment),
   sitting high and to one side; a full print fills the zone with a small
   margin so it doesn't visually bleed to the edge. */
function placementBox(key, P){
  if(key==='full-front' || key==='full-back' || key==='full-sleeve')
    return {x:P.x, y:P.y, w:P.w, h:P.h};
  if(key==='upper-sleeve')
    return {x:P.x, y:P.y, w:P.w, h:P.h*.48};
  if(key==='lower-sleeve')
    return {x:P.x, y:P.y+P.h*.52, w:P.w, h:P.h*.48};
  if(key==='center-chest'){
    const w=P.w*0.42; return {x:P.x+(P.w-w)/2, y:P.y+P.h*0.07, w, h:P.h*0.28};
  }
  if(key==='upper-center'){
    const w=P.w*0.48; return {x:P.x+(P.w-w)/2, y:P.y+P.h*0.04, w, h:P.h*0.24};
  }
  if(key==='lower-center'){
    const w=P.w*0.55; return {x:P.x+(P.w-w)/2, y:P.y+P.h*0.68, w, h:P.h*0.26};
  }
  if(key==='upper-back'){
    const w=P.w*0.5; return {x:P.x+(P.w-w)/2, y:P.y+P.h*0.04, w, h:P.h*0.25};
  }
  if(key==='center-back'){
    const w=P.w*0.5; return {x:P.x+(P.w-w)/2, y:P.y+P.h*0.06, w, h:P.h*0.32};
  }
  if(key==='lower-back'){
    const w=P.w*0.56; return {x:P.x+(P.w-w)/2, y:P.y+P.h*0.68, w, h:P.h*0.26};
  }
  const w=P.w*0.26, h=P.h*0.20, y=P.y+P.h*0.08;
  return key==='left-chest' ? {x:P.x+P.w*0.08, y, w, h} : {x:P.x+P.w*0.92-w, y, w, h};
}

/* Move + resize a layer to fill a box, centred, with breathing room.

   Solved directly rather than by shrinking in a loop: layerBounds() adds a
   FIXED padding (16px text, 12px image) for the on-canvas hit-box, and a
   chest placement is only ~35px wide in canvas-internal units — that
   padding alone is a third of the box. A loop chasing the padded size
   chases a moving target and can walk a long company name straight to the
   size floor without ever converging, leaving unreadable text that still
   overflows. Subtracting the same constant up front and solving for the
   exact font size gets it right in one step.

   Canvas text metrics scale linearly with font size for a given font, so
   measuring at 1px gives a per-pixel width to divide the available space
   by. Returns true when the result had to hit the readable-size floor —
   the caller uses that to tell the difference between "fits" and "just
   barely, consider a bigger placement or shorter text". */
const FIT_FLOOR = 10, FIT_CEIL = 110;
function fitLayerToBox(L, box){
  // No extra shrink factor on top of the padding subtraction — the fixed
  // padding IS the margin around the ink. Stacking a proportional margin on
  // top of it double-shrinks a chest box, which is already tight: a third
  // of a ~35px box is that padding alone.
  L.x = box.x+box.w/2; L.y = box.y+box.h/2;
  if(L.type==='text'){
    const padText = 16;   // must match layerBounds()'s text padding
    const contentW = Math.max(4, box.w - padText);
    const contentH = Math.max(4, box.h - padText);
    ctx.font = `${L.bold?'700':'400'} 1px "${L.font}"`;
    const perPx = Math.max(0.01, ctx.measureText(L.text).width);
    const size = Math.min(contentW/perPx, contentH);
    L.size = Math.max(FIT_FLOOR, Math.min(FIT_CEIL, size));
    return size < FIT_FLOOR;
  }
  const padImg = 12;      // must match layerBounds()'s image padding
  const contentW = Math.max(4, box.w - padImg);
  const contentH = Math.max(4, box.h - padImg);
  const ratio = L.w/(L.h||1);
  let w=contentW, h=w/ratio;
  if(h>contentH){ h=contentH; w=h*ratio; }
  L.w=w; L.h=h;
  return false;
}

function applyPlacement(key){
  const Ls=state.layers[state.side];
  if(!Ls.length){ toast('Add text or a logo first'); return; }
  if(state.sel<0){ toast('Select which layer to place — tap it in the layers list'); return; }
  if(Ls[state.sel].locked){toast('Unlock to edit');return;}
  pushUndo();
  const P=pa(), box=placementBox(key,P);
  const tight=fitLayerToBox(Ls[state.sel], box);
  state.activePlacement=key;
  // zoomToBox()/zoomOut() are pure state-setters (see above) — they have to
  // run BEFORE the one draw() below, or the canvas paints at the OLD zoom
  // level and camTx/camTy/canvasZoom change out from under a bitmap that
  // was never re-rendered against them.
  const full=key==='full-front'||key==='full-back'||key==='full-sleeve';
  if(full) zoomOut(); else zoomToBox(box);
  draw();
  const all=Object.values(PLACEMENTS).flat(), hit=all.find(p=>p[0]===key);
  const label=hit?hit[1]:'Placement';
  toast(tight ? `${label} applied — that text is a tight fit here; try Center Chest or shorten it`
              : label+' applied');
}

function renderPlacementRow(){
  const el=document.getElementById('placementRow'); if(!el) return;
  if(state.sel<0){ el.hidden=true; el.innerHTML=''; return; }
  el.hidden=false;
  const list=PLACEMENTS[state.side]||PLACEMENTS.front;
  el.innerHTML=`<span class="placement-label">Placement</span><div class="placement-options">`
    +list.map(([k,label,icon])=>`<button class="placement-btn${state.activePlacement===k?' on':''}" onclick="applyPlacement('${k}')">
        <span class="material-symbols-outlined">${icon}</span>${label}</button>`).join('')
    +`</div>`;
}

/* ── The zoom camera ──────────────────────────────────────────────
   First cut of this used a CSS transform: scale up the existing 520×560
   canvas element optically, same pixels, just bigger on screen. That's why
   an uploaded logo came out visibly soft when zoomed into a chest
   placement — a few dozen actual pixels stretched to fill the viewport is
   stretching, not detail.

   This version changes what draw() actually RENDERS instead. `cv.width`/
   `cv.height` — the canvas's backing store, not its CSS size — grow to
   match the frame's on-screen size × devicePixelRatio, and canvasZoom/
   camTx/camTy describe a camera: draw() applies them as the 2D context's
   transform before painting the unchanged logical 520×560 scene. Every
   existing drawImage/fillText call benefits automatically, because canvas
   samples fresh from the SOURCE image (the uploaded logo, the mockup
   photo) at whatever resolution the backing store now asks for — not from
   a small already-rendered patch. The CSS-displayed size of the canvas
   never changes; only the resolution behind it does.

   Ceiling on quality is now the source image's own resolution, same as it
   always was for the final printed artwork — a decent uploaded PNG should
   look sharp; the 720px mockup photos still won't hold up much past this
   zoom level, and no amount of backing-store resolution fixes that (see
   the CLAUDE.md note by SEED_ZONES / the mockups/ directory).

   canvasZoom is still what draw() divides its selection-chrome sizes by
   (the delete badge, size label, print-area dashes), for the same reason
   as before: chrome baked into the bitmap at a fixed logical size would
   now render enormous at high zoom just like the CSS version did. */
let canvasZoom = 1, camTx = 0, camTy = 0;

function resetCamera(){
  cv.width = 520; cv.height = 560;
  canvasZoom = 1; camTx = 0; camTy = 0;
}

/* State-setters only — no draw() call inside either. A caller that's also
   repositioning a layer (applyPlacement) needs exactly one redraw for the
   whole operation, not one here plus one of its own. */
function zoomToBox(box){
  const frame=document.getElementById('canvasFrame'); if(!frame) return;
  // Update the preset's active state before measuring and rendering.
  state._zoomed=true;
  renderPlacementRow();
  const fr=frame.getBoundingClientRect();
  const dpr=Math.min(window.devicePixelRatio||1, 3);   // capped: memory, not quality, past 3x
  // Both dimensions from the SAME measurement (fr), on purpose, even though
  // the frame's declared aspect-ratio is 520/560 and fr.width/fr.height
  // don't always resolve to exactly that. The camera transform below is a
  // uniform scale, so it doesn't care what aspect the backing store ends up
  // — a mismatched *box* just shows a little more context on one side. What
  // DOES matter is that the backing store's own aspect matches the canvas
  // element's actual CSS-rendered box (which width:100%/height:100% ties to
  // this same fr) — canvas stretches backing store to CSS size per-axis
  // independently, so if those two disagree, THAT'S what actually ellipses
  // a circle. Deriving cv.height from a fixed 520/560 ratio instead of
  // fr.height was tried and reverted for exactly this reason.
  cv.width  = Math.round(fr.width*dpr)  || 520;
  cv.height = Math.round(fr.height*dpr) || 560;
  const pad=1.35;                                       // margin so the box doesn't touch the frame edge
  // Deliberately uncapped by any "6x-looks-enough" number — the backing
  // store is bounded by frame size × dpr regardless of how this comes out,
  // so a small box legitimately earning a big k is exactly the point: more
  // real device pixels behind the same on-screen area.
  const k=Math.min(50, Math.max(1, Math.min(cv.width/(box.w*pad), cv.height/(box.h*pad))));
  canvasZoom=k;
  // Centres the box in backing-store space: box's logical centre × k, then
  // however far that lands from the backing store's own centre is the
  // translate needed to bring it there.
  camTx = cv.width/2  - k*(box.x+box.w/2);
  camTy = cv.height/2 - k*(box.y+box.h/2);
  const base=Math.max(.01,Math.min(cv.width/520,cv.height/560));
  state.editorZoom=Math.max(1,Math.min(4,k/base));
}
function setEditorZoom(value){
  const z=Math.max(1,Math.min(4,+value||1));
  state.editorZoom=z;
  if(z<=1.001){ zoomOut(); draw(); return; }
  const frame=document.getElementById('canvasFrame'); if(!frame) return;
  state._zoomed=true;
  renderPlacementRow();
  const fr=frame.getBoundingClientRect(),dpr=Math.min(window.devicePixelRatio||1,3);
  cv.width=Math.round(fr.width*dpr)||520; cv.height=Math.round(fr.height*dpr)||560;
  const base=Math.max(.01,Math.min(cv.width/520,cv.height/560));
  canvasZoom=base*z;
  const L=state.layers[state.side][state.sel],P=pa();
  const cx=L?L.x:P.x+P.w/2,cy=L?L.y:P.y+P.h/2;
  camTx=cv.width/2-canvasZoom*cx; camTy=cv.height/2-canvasZoom*cy;
  draw();
}
function zoomOut(){
  const was=state._zoomed;
  resetCamera();
  state._zoomed=false;
  state.editorZoom=1;
  if(was) renderPlacementRow();
}

function textFont(L,size=L.size){
  return `${L.italic?'italic ':''}${L.bold?'700':'400'} ${size}px "${L.font}"`;
}
function layerLocalSize(L){
  if(L.type==='text'){
    ctx.save(); ctx.font=textFont(L);
    const w=ctx.measureText(L.text||' ').width; ctx.restore();
    return {w:w+16,h:L.size+16,pad:8};
  }
  return {w:L.w+12,h:L.h+12,pad:6};
}
function rotatePoint(x,y,cx,cy,a){
  const co=Math.cos(a),si=Math.sin(a),dx=x-cx,dy=y-cy;
  return {x:cx+dx*co-dy*si,y:cy+dx*si+dy*co};
}
function layerGeometry(L){
  const s=layerLocalSize(L),a=(+L.rotation||0)*Math.PI/180;
  const raw={
    tl:{x:L.x-s.w/2,y:L.y-s.h/2},tr:{x:L.x+s.w/2,y:L.y-s.h/2},
    br:{x:L.x+s.w/2,y:L.y+s.h/2},bl:{x:L.x-s.w/2,y:L.y+s.h/2},
  };
  const corners={};
  Object.entries(raw).forEach(([k,p])=>corners[k]=rotatePoint(p.x,p.y,L.x,L.y,a));
  const top=rotatePoint(L.x,L.y-s.h/2,L.x,L.y,a);
  const rotate=rotatePoint(L.x,L.y-s.h/2-30/canvasZoom,L.x,L.y,a);
  return {w:s.w,h:s.h,a,corners,top,rotate};
}
function layerBounds(L){
  const pts=Object.values(layerGeometry(L).corners);
  const xs=pts.map(p=>p.x),ys=pts.map(p=>p.y);
  const x=Math.min(...xs),y=Math.min(...ys);
  return {x,y,w:Math.max(...xs)-x,h:Math.max(...ys)-y};
}
function pointInLayer(p,L){
  const a=-(+L.rotation||0)*Math.PI/180;
  const q=rotatePoint(p.x,p.y,L.x,L.y,a),s=layerLocalSize(L);
  return Math.abs(q.x-L.x)<=s.w/2 && Math.abs(q.y-L.y)<=s.h/2;
}

/* Home's "AI designer" callout — a static hoodie still, drawn with the same
   engine rather than shipped as a separate marketing image. */
function drawAiPreview(){
  const c=document.getElementById('aiPreview'); if(!c) return;
  const x=c.getContext('2d');
  x.clearRect(0,0,c.width,c.height);
  const mock=getRecoloredMock('hd','#111111')||mockImgs.hd;
  if(mock){
    const iw=mock.width||mock.naturalWidth, ih=mock.height||mock.naturalHeight;
    const s=Math.min(c.width/iw,c.height/ih);
    const ox=(c.width-iw*s)/2, oy=(c.height-ih*s)/2;
    drawStage(x,'#111111',ox,oy,iw*s,ih*s,14);
    drawMockup(x,mock,ox,oy,iw*s,ih*s);
  }
  x.textAlign='center';
  x.fillStyle='#c8f232'; x.font='800 30px "Archivo Narrow"';
  x.fillText('GEN-AI', c.width/2, c.height*0.47);
  x.fillStyle='#ce0358'; x.font='800 22px "Archivo Narrow"';
  x.fillText('DROP 01', c.width/2, c.height*0.55);
}

/* ═══════════════ STUDIO: add elements ═══════════════ */
function addText(){
  const t=document.getElementById('txtInput').value.trim();
  if(!t){ toast('Type some text first'); return; }
  markCustomized();
  pushUndo();
  const P=pa();
  const layer={type:'text',text:t,x:P.x+P.w/2,y:P.y+P.h/2,size:34,
    font:document.getElementById('txtFont').value,
    color:document.getElementById('txtColor').value,bold:true};
  // Start inside a useful centre area instead of making long text overflow
  // the printable boundary the moment it is added.
  fitLayerToBox(layer,{
    x:P.x+P.w*.1,y:P.y+P.h*.18,w:P.w*.8,h:P.h*.28
  });
  state.layers[state.side].push(layer);
  state.sel=state.layers[state.side].length-1;
  document.getElementById('txtInput').value='';
  renderLayers(); draw();
}
function addImage(){
  const f=document.getElementById('imgInput').files[0];
  if(!f){ toast('Choose an image file first'); return; }
  markCustomized();
  const r=new FileReader();
  r.onload=e=>{
    const img=new Image();
    img.onload=()=>{
      pushUndo();
      const P=pa();
      const ratio=img.width/img.height, w=Math.min(140,P.w-30), h=w/ratio;
      state.layers[state.side].push({type:'img',img,x:P.x+P.w/2,y:P.y+P.h/2,w,h});
      state.sel=state.layers[state.side].length-1;
      renderLayers(); draw(); toast('Logo placed — drag to position');
    };
    img.src=e.target.result;
  };
  r.readAsDataURL(f);
}
/* The layers column is empty for everyone's first minute here, which makes
   it the best place in the studio to say what to do — a wall of tool panels
   with no order to them is what made this page read as confusing. Steps 1
   and 2 open the panel they're talking about. */
function coachHTML(){
  const steps=[
    ['base','apparel','Pick the garment','Style and colour, on the left'],
    ['assets','draw','Put your design on it','Type text, drop in a logo, or let AI draw one'],
    ['','straighten','Choose a size','Then add to cart — digital proof within 2 hours'],
  ];
  return `<div class="coach">
    <div class="coach-h">Three steps to your print</div>
    ${steps.map(([tab,icon,title,sub],i)=>`
      <${tab?'button':'div'} class="coach-step"${tab?` onclick="studioTab('${tab}')"`:''}>
        <span class="coach-n">${i+1}</span>
        <span class="coach-txt"><b>${title}</b><i>${sub}</i></span>
        <span class="material-symbols-outlined coach-ico">${icon}</span>
      </${tab?'button':'div'}>`).join('')}
  </div>`;
}
function renderLayers(){
  const el=document.getElementById('layerList'); const Ls=state.layers[state.side];
  const head=document.getElementById('layerHead');
  const section=document.getElementById('pdpLayerSection');
  const other=enabledPrintViews().find(v=>v.key!==state.side&&(state.layers[v.key]||[]).length);
  const empty=!Ls.length && !other;
  if(section) section.hidden=empty;
  // "Active layers" over a getting-started guide reads as a broken list.
  if(head) head.hidden=empty;
  if(!Ls.length){
    el.innerHTML = other
      ? `<div class="empty" style="padding:32px 8px">
          <span class="material-symbols-outlined">layers_clear</span>
          <p style="font-size:13px">Nothing on the ${state.side} yet.<br>
            Your design is on ${esc(other.label)} — switch views to see it.</p>
        </div>`
      : coachHTML();
    if(typeof syncCta==='function') syncCta();
    return;
  }
  // Newest on top, matching how the canvas stacks them.
  el.innerHTML=Ls.map((L,i)=>{
    const isText=L.type==='text';
    const thumb=isText
      ? `<span class="material-symbols-outlined" style="font-size:18px">title</span>`
      : (L.img ? `<img src="${L.img.src}" alt="">` : `<span class="material-symbols-outlined" style="font-size:18px">image</span>`);
    const name=isText ? esc(L.text) : 'Image layer';
    const turn=Math.round(+L.rotation||0);
    const sub=(isText ? `Text · ${Math.round(L.size)}px` : `Image · ${Math.round(L.w)}×${Math.round(L.h)}`)
      +(turn?` · ${turn}°`:'');
    return `<div class="layer${i===state.sel?' on':''}${L.locked?' locked':''}">
      <div class="layer-thumb">${thumb}</div>
      <div class="layer-meta" onclick="selLayer(${i})">
        <div class="layer-name">${name}</div>
        <div class="layer-sub">${sub}</div>
      </div>
      <div class="layer-acts">
        <button onclick="moveLayer(${i},1)" title="Bring forward" ${i===Ls.length-1?'disabled':''}>
          <span class="material-symbols-outlined" style="font-size:16px">arrow_upward</span>
        </button>
        <button onclick="moveLayer(${i},-1)" title="Send backward" ${i===0?'disabled':''}>
          <span class="material-symbols-outlined" style="font-size:16px">arrow_downward</span>
        </button>
        <button onclick="bumpFromList(${i},1.15)" title="Bigger" ${L.locked?'disabled':''}>+</button>
        <button onclick="bumpFromList(${i},0.87)" title="Smaller" ${L.locked?'disabled':''}>−</button>
        <button onclick="toggleLock(${i})" title="${L.locked?'Unlock':'Lock'}">
          <span class="material-symbols-outlined" style="font-size:16px">${L.locked?'lock':'lock_open'}</span>
        </button>
        <button class="del" onclick="delLayer(${i})" title="Remove" ${L.locked?'disabled':''}>
          <span class="material-symbols-outlined" style="font-size:16px">delete</span>
        </button>
      </div>
    </div>`;
  }).reverse().join('');
  if(typeof syncCta==='function') syncCta();
}
/* Snapshot the canvas WITHOUT the editing chrome.
   draw() paints the selection box, size readout, delete badge and scale
   handle for the selected layer, and toDataURL captures whatever is on the
   canvas — so a naive capture bakes that UI into cart and design
   thumbnails. Deselect, redraw, capture, then put the selection back.

   Also has to survive a zoom being active. draw() now genuinely renders
   whatever camTx/camTy/canvasZoom point at — a cropped chest close-up, if
   that's what's on screen — not just a CSS-magnified view of the same full
   frame like the first version of this feature. A cart thumbnail showing a
   giant logo crop instead of the garment would be wrong, so this forces an
   unzoomed render for the capture and puts the on-screen zoom back after. */
function captureThumb(type='image/jpeg', quality=0.7){
  const was = state._zoomed
    ? {zoom:canvasZoom, tx:camTx, ty:camTy, w:cv.width, h:cv.height}
    : null;
  if(was) resetCamera();
  draw(true);                       // garment + artwork only
  const data=cv.toDataURL(type,quality);
  draw();                           // restore the editing view
  if(was){
    cv.width=was.w; cv.height=was.h;
    canvasZoom=was.zoom; camTx=was.tx; camTy=was.ty;
    draw();                         // back to whatever zoom the user was looking at
  }
  return data;
}

/* "Inspect closely" for a customer, not a tool for editing — a full-size
   lossless capture of exactly what's on the garment right now, reusing
   captureThumb() rather than cv.toDataURL() directly for the same reason
   every other capture site does: draw() paints selection handles and
   guides that have no business appearing in what the customer sees. */
function openZoomLightbox(){
  const data = captureThumb('image/png', 1);
  document.getElementById('zoomLightboxImg').src = data;
  document.getElementById('zoomLightbox').classList.add('on');
}
function closeZoomLightbox(){
  document.getElementById('zoomLightbox').classList.remove('on');
}

/* ── print-ready export ──────────────────────────────────────────
   captureThumb() gives a picture of a t-shirt; production needs the
   artwork alone, on transparency, at a resolution worth printing. This
   renders just the print area, scaled up from the 520×560 editor space,
   with no garment, guides or selection chrome.

   Resolution is derived from the print zone's real width in cm, not from a
   fixed pixel count — a tote's small zone and a hoodie's full front then
   come out at the same physical quality instead of the small one being
   needlessly huge. PRINT_MAX_PX is only a memory backstop: at 200 DPI a
   38cm zone is already an 11-megapixel canvas.

   ⚠️ 200 DPI, not the 300 the home page advertises. 300 would put a
   photographic print over both the browser's comfortable canvas size and
   the 5MB upload cap. Either raise the ceiling deliberately or fix the
   copy — don't let the two drift. */
const PRINT_DPI = 200;
const PRINT_MAX_PX = 3600;
/* Raw bytes an encoded artwork file may reach. Sits under artwork.py's 5MB
   cap with room for base64's 4/3 inflation on the way up. */
const PRINT_BUDGET = 3.5 * 1024 * 1024;

function dataUrlBytes(u){
  const i = u.indexOf(',') + 1;
  const pad = u.endsWith('==') ? 2 : u.endsWith('=') ? 1 : 0;
  return Math.floor((u.length - i) * 3 / 4) - pad;
}

/* Encode a print canvas as small as it can go without giving up quality
   unnecessarily.

   PNG first, always: a text-and-logo design is a few hundred KB lossless,
   and that's the common case. Only when PNG blows the budget — which is
   what a photographic AI generation does, ~8.7MB at full print size — do we
   fall back to WebP, which carries alpha (so the removed background
   survives) at roughly a sixth of the bytes. Last resort is scaling down,
   because a slightly smaller print file beats a checkout that fails. */
function encodePrintArt(canvas){
  const png = canvas.toDataURL('image/png');
  if(dataUrlBytes(png) <= PRINT_BUDGET) return png;

  const webp = canvas.toDataURL('image/webp', 0.92);
  // Browsers that can't encode WebP silently hand back a PNG data URL.
  if(webp.startsWith('data:image/webp')){
    if(dataUrlBytes(webp) <= PRINT_BUDGET) return webp;
    const leaner = canvas.toDataURL('image/webp', 0.8);
    if(dataUrlBytes(leaner) <= PRINT_BUDGET) return leaner;
  }

  let best = webp.startsWith('data:image/webp') ? webp : png;
  const type = webp.startsWith('data:image/webp') ? 'image/webp' : 'image/png';
  for(const scale of [0.75, 0.55, 0.4]){
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(canvas.width*scale));
    c.height = Math.max(1, Math.round(canvas.height*scale));
    const x = c.getContext('2d');
    x.imageSmoothingQuality = 'high';
    x.drawImage(canvas, 0, 0, c.width, c.height);
    best = c.toDataURL(type, 0.88);
    if(dataUrlBytes(best) <= PRINT_BUDGET) return best;
  }
  return best;   // still over: let the server reject it with a real message
}

function capturePrintArt(side){
  const prev = state.side;
  state.side = side;                      // pa()/mockLayout() read state.side
  const layers = state.layers[side] || [];
  if(!layers.length){ state.side = prev; return null; }

  const P = pa();
  const targetW = (P.cmW / 2.54) * PRINT_DPI;
  const scale = Math.min(targetW, PRINT_MAX_PX) / P.w;
  const c = document.createElement('canvas');
  c.width = Math.round(P.w * scale);
  c.height = Math.round(P.h * scale);
  const x = c.getContext('2d');
  // Translate print-area origin to 0,0 so editor coordinates map straight in.
  x.setTransform(scale, 0, 0, scale, -P.x*scale, -P.y*scale);

  layers.forEach(L=>drawLayerContent(x,L));
  state.side = prev;
  return encodePrintArt(c);
}

/* What the print floor needs in writing: every layer's real-world size and
   placement, in cm, measured from the top-left of the print area. */
function printSpec(side){
  const prev = state.side;
  state.side = side;
  const P = pa(), k = pxcm();
  const spec = (state.layers[side]||[]).map(L=>{
    const b = layerBounds(L);
    return {
      kind: L.type,
      text: L.type==='text' ? L.text : null,
      font: L.type==='text' ? L.font : null,
      color: L.type==='text' ? L.color : null,
      rotation: +(+L.rotation||0).toFixed(1),
      flipped: !!L.flipX,
      effect: L.type==='img' ? (L.effect||null) : null,
      w: +(b.w/k).toFixed(1), h: +(b.h/k).toFixed(1),
      fromTop: +((b.y-P.y)/k).toFixed(1),
      fromLeft: +((b.x-P.x)/k).toFixed(1),
      // Anything hanging outside the print area gets trimmed on the press —
      // production needs to know before it runs, not after.
      cropped: b.x<P.x-1 || b.y<P.y-1 || b.x+b.w>P.x+P.w+1 || b.y+b.h>P.y+P.h+1,
    };
  });
  // Which garment the zone belongs to. Without it the cm figures below are
  // unreadable on the print floor — a 38cm zone is an M or a 3XL depending
  // on nothing the order otherwise records.
  const zone = {w:P.cmW, h:P.cmH, size:previewSize()};
  state.side = prev;
  return spec.length ? {zone, layers:spec} : null;
}
function selLayer(i){
  if(state.sel!==i){
    state.cropMode=false;document.querySelector('.studio')?.classList.remove('crop-mode');
  }
  state.sel=i;renderLayers();draw();
}

/* One intentional hero product: a fixed custom hoodie, never a carousel.
   It uses the same photographed blank and recolouring pipeline as the studio
   so the homepage preview is an honest example of what customers can make. */
function drawHeroHoodie(){
  const c=document.getElementById('heroHoodie'); if(!c) return;
  const x=c.getContext('2d');
  x.clearRect(0,0,c.width,c.height);
  const color='#17211B';
  const mock=getRecoloredMock('hd',color)||mockImgs.hd;
  if(!mock){
    x.save(); x.translate((c.width-520*.68)/2,18); x.scale(.68,.68);
    drawGarment(x,'hd',color); x.restore();
    return;
  }
  const iw=mock.naturalWidth||mock.width,ih=mock.naturalHeight||mock.height;
  const s=Math.min(c.width/iw,c.height/ih);
  const ox=(c.width-iw*s)/2,oy=(c.height-ih*s)/2;
  drawStage(x,color,0,0,c.width,c.height,18);
  drawMockup(x,mock,ox,oy,iw*s,ih*s);

  const P=MOCK.print.hd;
  const cx=ox+P.cx*s, cy=oy+P.cy*s;
  x.save();
  x.textAlign='center'; x.textBaseline='middle';
  x.fillStyle='#FFFFFF';
  x.font=`800 ${Math.max(18,36*s)}px "Archivo Narrow"`;
  x.fillText('PRINT ENGINE',cx,cy-8*s);
  x.fillStyle='#C8F232';
  x.font=`700 ${Math.max(11,18*s)}px "Archivo Narrow"`;
  x.fillText('ORIGINALS',cx,cy+22*s);
  x.restore();
}
/* Locked layers ignore the layer list's +/− controls. */
function bump(i,f){
  const L=state.layers[state.side][i];
  if(!L || L.locked) return;
  if(L.type==='text') L.size=Math.max(10,Math.min(90,L.size*f));
  else { L.w*=f; L.h*=f; }
  draw();
}
/* Each layer-list size click is a natural, discrete undo step. */
function bumpFromList(i,f){ pushUndo(); bump(i,f); }
function delLayer(i){
  const L=state.layers[state.side][i];
  if(!L) return;
  if(L.locked){ toast('Unlock to delete'); return; }
  pushUndo();
  state.layers[state.side].splice(i,1); state.sel=-1; state.cropMode=false;
  document.querySelector('.studio')?.classList.remove('crop-mode');
  renderLayers(); draw(); toast('Removed');
}
function deleteSel(){ if(state.sel>=0) delLayer(state.sel); }
function clearSide(){ pushUndo(); state.layers[state.side]=[]; state.sel=-1; renderLayers(); draw(); }

/* ═══════════════ STUDIO: undo / redo ═══════════════
   One stack of {front,back} snapshots, taken right before each mutation —
   never continuously during a drag or a resize gesture, or a single drag
   would flood the stack with one entry per mousemove. Layer objects hold
   only primitives plus an immutable Image reference (images are never
   mutated in place), so a shallow copy per layer is a real, independent
   snapshot rather than a second reference to the same objects. */
const UNDO_LIMIT = 50;
let undoStack = [], redoStack = [];
function _cloneLayers(){
  return Object.fromEntries(Object.entries(state.layers)
    .map(([key,layers])=>[key,(layers||[]).map(L=>({...L}))]));
}
function pushUndo(){
  undoStack.push(_cloneLayers());
  if(undoStack.length>UNDO_LIMIT) undoStack.shift();
  redoStack.length=0;
}
function _restoreLayers(snap){
  state.layers=snap;
  state.sel=-1;state.cropMode=false;document.querySelector('.studio')?.classList.remove('crop-mode');
  renderLayers(); draw();
}
function undoEdit(){
  if(!undoStack.length) return;
  redoStack.push(_cloneLayers());
  _restoreLayers(undoStack.pop());
  toast('Undid last change');
}
function redoEdit(){
  if(!redoStack.length) return;
  undoStack.push(_cloneLayers());
  _restoreLayers(redoStack.pop());
  toast('Redid change');
}

/* ═══════════════ STUDIO: duplicate / lock / replace ═══════════════ */
function duplicateSel(){
  const L=state.layers[state.side][state.sel];
  if(!L){ toast('Select an item first'); return; }
  pushUndo();
  // Nudged, not stacked exactly on top — otherwise the copy is invisible
  // until you drag it and looks like duplicate did nothing. Never locked,
  // even if the original was: it's a new object, not the protected one.
  const copy={...L, x:L.x+16, y:L.y+16, locked:false};
  state.layers[state.side].push(copy);
  state.sel=state.layers[state.side].length-1;
  renderLayers(); draw(); toast('Duplicated');
}
function toggleLock(i){
  const L=state.layers[state.side][i];
  if(!L) return;
  pushUndo();
  L.locked=!L.locked;
  renderLayers(); draw();
  toast(L.locked?'Layer locked':'Layer unlocked');
}
function toggleLockSel(){
  if(state.sel<0){ toast('Select an item first'); return; }
  toggleLock(state.sel);
}
function replaceImageSel(){
  const L=state.layers[state.side][state.sel];
  if(!L || L.type!=='img'){ toast('Select an image layer to replace'); return; }
  if(L.locked){ toast('Unlock to edit'); return; }
  const input=document.createElement('input');
  input.type='file'; input.accept='image/*';
  input.onchange=()=>{
    const f=input.files[0]; if(!f) return;
    const r=new FileReader();
    r.onload=e=>{
      const img=new Image();
      img.onload=()=>{
        pushUndo();
        L.img=img;   // position and size stay exactly where they were
        renderLayers(); draw(); toast('Image replaced');
      };
      img.src=e.target.result;
    };
    r.readAsDataURL(f);
  };
  input.click();
}
function toggleStrokeSel(){
  const L=state.layers[state.side][state.sel];
  if(!L || L.type!=='text'){ toast('Select a text layer first'); return; }
  if(L.locked){ toast('Unlock to edit'); return; }
  pushUndo(); L.stroke=!L.stroke; draw();renderContextToolbar(true);
}
function toggleShadowSel(){
  const L=state.layers[state.side][state.sel];
  if(!L || L.type!=='text'){ toast('Select a text layer first'); return; }
  if(L.locked){ toast('Unlock to edit'); return; }
  pushUndo(); L.shadow=!L.shadow; draw();renderContextToolbar(true);
}
function downloadPNG(){
  const a=document.createElement('a');
  a.download='print-engine-design.png'; a.href=captureThumb('image/png'); a.click();
  toast('Preview downloaded');
}
async function shareDesign(){
  const title=`My ${state.product.name} design`;
  const text=`I made this ${state.product.name} on Print Engine.`;
  try{
    const data=captureThumb('image/png'),blob=await (await fetch(data)).blob();
    const file=new File([blob],'print-engine-design.png',{type:'image/png'});
    if(navigator.share&&(!navigator.canShare||navigator.canShare({files:[file]}))){
      await navigator.share({title,text,files:[file]});return;
    }
    if(navigator.share){await navigator.share({title,text,url:location.href});return;}
    await navigator.clipboard.writeText(location.href);
    toast('Design link copied');
  }catch(err){
    if(err&&err.name==='AbortError')return;
    try{await navigator.clipboard.writeText(location.href);toast('Design link copied');}
    catch(_){toast('Sharing is not available in this browser');}
  }
}
function shareWhatsApp(){
  const text=`I made this ${state.product.name} on Print Engine — ${location.href}`;
  window.open('https://wa.me/?text='+encodeURIComponent(text),'_blank','noopener,noreferrer');
}

/* ═══════════════ DIRECT TRANSFORM SYSTEM ═══════════════
   Pointer events cover mouse, pen and touch through one path. A gesture
   snapshots undo once, then directly manipulates the selected layer:
   moving, four-corner aspect-ratio resize, rotation, or crop panning. */
let drag=null;
function pos(e){
  const r=cv.getBoundingClientRect();
  const p=e.touches?e.touches[0]:e;
  const dx=(p.clientX-r.left)*(cv.width/r.width);
  const dy=(p.clientY-r.top)*(cv.height/r.height);
  return {x:(dx-camTx)/canvasZoom, y:(dy-camTy)/canvasZoom};
}
function hitCircle(p,h,r){const dx=p.x-h.x,dy=p.y-h.y;return dx*dx+dy*dy<=r*r;}
function beginTransform(type,data,e){
  drag={type,mutated:false,pointerId:e.pointerId,...data};
  document.querySelector('.studio')?.classList.add('transforming');
  cv.setPointerCapture?.(e.pointerId);e.preventDefault();
}
function down(e){
  const p=pos(e); const Ls=state.layers[state.side];
  const selected=Ls[state.sel],handles=state._transformHandles;
  if(selected&&!selected.locked&&handles){
    if(hitCircle(p,handles.rotate,handles.r)){
      beginTransform('rotate',{
        i:state.sel,startAngle:Math.atan2(p.y-selected.y,p.x-selected.x),
        baseRotation:+selected.rotation||0
      },e);return;
    }
    const opposite={tl:'br',tr:'bl',br:'tl',bl:'tr'};
    const signs={tl:[-1,-1],tr:[1,-1],br:[1,1],bl:[-1,1]};
    for(const name of ['tl','tr','br','bl']){
      if(hitCircle(p,handles.corners[name],handles.r)){
        const g=layerGeometry(selected);
        beginTransform('resize',{
          i:state.sel,handle:name,anchor:g.corners[opposite[name]],
          signs:signs[name],angle:g.a,startW:g.w,startH:g.h,
          startSize:selected.size,startImgW:selected.w,startImgH:selected.h
        },e);return;
      }
    }
  }
  if(selected&&!selected.locked&&state.cropMode&&selected.type==='img'&&pointInLayer(p,selected)){
    beginTransform('crop',{i:state.sel,start:p,startX:+selected.cropX||0,startY:+selected.cropY||0},e);return;
  }
  for(let i=Ls.length-1;i>=0;i--){
    if(pointInLayer(p,Ls[i])){
      if(state.sel!==i){
        state.cropMode=false;document.querySelector('.studio')?.classList.remove('crop-mode');
      }
      state.sel=i;
      if(!Ls[i].locked) beginTransform('move',{i,dx:p.x-Ls[i].x,dy:p.y-Ls[i].y},e);
      renderLayers(); draw(); e.preventDefault(); return;
    }
  }
  state.sel=-1; renderLayers(); draw();
}
function snapMovedLayer(L){
  const P=pa(),snap=8/Math.max(1,+state.editorZoom||1);
  let b=layerBounds(L);
  const xs=[
    {d:P.x-b.x,g:P.x},{d:P.x+P.w/2-(b.x+b.w/2),g:P.x+P.w/2},
    {d:P.x+P.w-(b.x+b.w),g:P.x+P.w}
  ].sort((a,b)=>Math.abs(a.d)-Math.abs(b.d));
  if(Math.abs(xs[0].d)<snap){L.x+=xs[0].d;state.guides.v=xs[0].g;}else state.guides.v=false;
  b=layerBounds(L);
  const ys=[
    {d:P.y-b.y,g:P.y},{d:P.y+P.h/2-(b.y+b.h/2),g:P.y+P.h/2},
    {d:P.y+P.h-(b.y+b.h),g:P.y+P.h}
  ].sort((a,b)=>Math.abs(a.d)-Math.abs(b.d));
  if(Math.abs(ys[0].d)<snap){L.y+=ys[0].d;state.guides.h=ys[0].g;}else state.guides.h=false;
}
function move(e){
  if(!drag)return;
  if(!drag.mutated){
    pushUndo();drag.mutated=true;state.activePlacement=null;renderPlacementRow();
  }
  const p=pos(e); const L=state.layers[state.side][drag.i];
  if(!L)return;
  if(drag.type==='move'){
    L.x=p.x-drag.dx;L.y=p.y-drag.dy;snapMovedLayer(L);
  }else if(drag.type==='rotate'){
    const now=Math.atan2(p.y-L.y,p.x-L.x);
    let deg=drag.baseRotation+(now-drag.startAngle)*180/Math.PI;
    const snapped=Math.round(deg/45)*45;
    if(Math.abs(deg-snapped)<4)deg=snapped;
    L.rotation=((deg%360)+360)%360;
  }else if(drag.type==='resize'){
    const q=rotatePoint(p.x,p.y,drag.anchor.x,drag.anchor.y,-drag.angle);
    const dx=(q.x-drag.anchor.x)*drag.signs[0],dy=(q.y-drag.anchor.y)*drag.signs[1];
    const scale=Math.max(.08,Math.max(dx/drag.startW,dy/drag.startH));
    if(L.type==='text')L.size=Math.max(8,Math.min(160,drag.startSize*scale));
    else{L.w=Math.max(8,drag.startImgW*scale);L.h=Math.max(8,drag.startImgH*scale);}
    const s=layerLocalSize(L),local={x:drag.signs[0]*s.w/2,y:drag.signs[1]*s.h/2};
    const co=Math.cos(drag.angle),si=Math.sin(drag.angle);
    L.x=drag.anchor.x+local.x*co-local.y*si;
    L.y=drag.anchor.y+local.x*si+local.y*co;
  }else if(drag.type==='crop'){
    const a=-(+L.rotation||0)*Math.PI/180,co=Math.cos(a),si=Math.sin(a);
    const dx=p.x-drag.start.x,dy=p.y-drag.start.y;
    let localX=dx*co-dy*si,localY=dx*si+dy*co;
    if(L.flipX)localX=-localX;
    L.cropX=Math.max(-1,Math.min(1,drag.startX-localX*2/Math.max(20,L.w)));
    L.cropY=Math.max(-1,Math.min(1,drag.startY-localY*2/Math.max(20,L.h)));
  }
  draw();syncContextValues();e.preventDefault();
}
function up(e){
  if(!drag)return;
  cv.releasePointerCapture?.(drag.pointerId);
  const changed=drag.mutated;drag=null;state.guides.v=state.guides.h=false;
  document.querySelector('.studio')?.classList.remove('transforming');
  if(changed)renderLayers();draw();
}
cv.addEventListener('pointerdown',down);
cv.addEventListener('pointermove',move);
cv.addEventListener('pointerup',up);
cv.addEventListener('pointercancel',up);
// The wheel controls the complete product camera, never the selected layer.
// Trackpad deltas remain smooth; a standard mouse-wheel notch is about 25%.
// At the 100%/400% limits the event falls through so the page can scroll.
let wheelZoomTarget=1,wheelZoomFrame=0;
cv.addEventListener('wheel',e=>{
  const current=wheelZoomFrame?wheelZoomTarget:(+state.editorZoom||1);
  const unit=e.deltaMode===1?.04:.0025;
  const next=Math.max(1,Math.min(4,current-e.deltaY*unit));
  if(Math.abs(next-current)<.001)return;
  e.preventDefault();
  wheelZoomTarget=next;
  if(!wheelZoomFrame){
    wheelZoomFrame=requestAnimationFrame(()=>{
      wheelZoomFrame=0;setEditorZoom(wheelZoomTarget);
    });
  }
},{passive:false});
// The ruler is measured against the canvas's RENDERED width, which the
// stylesheet ties to the viewport — so it has to be redrawn when that
// changes or it stops lining up with the print zone.
//
// A zoom now also sizes the canvas's actual backing store off the frame's
// rendered dimensions (see zoomToBox()) — if the window resizes while
// zoomed, that backing store is stale relative to the new frame size.
// Re-fitting it is more machinery than this is worth; exiting the zoom is
// simple and always correct, so that's what a resize does.
let rulerTick=0;
addEventListener('resize',()=>{
  clearTimeout(rulerTick);
  rulerTick=setTimeout(()=>{
    if(!document.getElementById('v-studio').classList.contains('on')) return;
    if(state._zoomed) zoomOut();
    draw();
  },120);
});
// keyboard: Delete / Backspace removes selected element (when not typing in a field)
window.addEventListener('keydown',e=>{
  const t=e.target.tagName;
  if(t==='INPUT'||t==='TEXTAREA'||t==='SELECT') return;
  if((e.key==='Delete'||e.key==='Backspace') && state.sel>=0){
    e.preventDefault(); delLayer(state.sel);
  }
  if((e.ctrlKey||e.metaKey) && !e.shiftKey && e.key.toLowerCase()==='z'){
    e.preventDefault(); undoEdit();
  }
  if((e.ctrlKey||e.metaKey) && (e.key.toLowerCase()==='y' || (e.shiftKey && e.key.toLowerCase()==='z'))){
    e.preventDefault(); redoEdit();
  }
});
