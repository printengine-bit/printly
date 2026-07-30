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
  resetSizesForProduct();
  updatePrice();
  // Without this the layers column is a bare heading until the first edit —
  // the empty state (and the getting-started guide inside it) never showed
  // on the one screen that most needs it.
  renderLayers();
  renderPlacementRow();
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
function addJerseyKit(){
  const nm=(document.getElementById('jkName').value||'').trim().toUpperCase();
  const nu=(document.getElementById('jkNum').value||'').trim();
  const s1=(document.getElementById('jkSp1').value||'').trim().toUpperCase();
  const s2=(document.getElementById('jkSp2').value||'').trim().toUpperCase();
  const col=document.getElementById('jkColor').value;
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
  ['front','back'].forEach(s=>{
    state.layers[s].forEach(L=>{
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
  const P=pa();
  remapLayers(old,P,true);   // keep existing artwork inside the new zone
  zoomOut();                 // the box a zoom was framing belonged to the old product's zone
  toggleJerseyKit();
  updateProductSub();
  resetSizesForProduct();   // size keys differ (a tote is one-size)
  updatePrice(); draw();
  toast(state.product.name+' — mockup updated');
}
function setSide(s){
  state.side=s; state.sel=-1;
  zoomOut();   // the other side's layers were never in this zoomed box
  document.getElementById('tabF').classList.toggle('on',s==='front');
  document.getElementById('tabB').classList.toggle('on',s==='back');
  document.getElementById('sideLabel').textContent=s;
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
  return PRINT_AREAS[state.product.id]||PRINT_AREAS.rn;
}
function pxcm(){ const P=pa(); return P.w/P.cmW; }   // pixels per cm

/* ── garment silhouettes ── */
function drawGarment(c,type,color){
  const LINE='rgba(13,31,60,.30)', SOFT='rgba(13,31,60,.22)';
  c.save();
  c.fillStyle=color; c.strokeStyle=LINE; c.lineWidth=2;
  c.lineJoin='round';

  // Women's lines share the men's silhouette IDs plus a '-women' suffix
  // (rn-women, po-women, hd-women) — no photo exists for them yet, so this
  // vector fallback is what actually renders. Strip the suffix to pick the
  // right garment shape, then nudge the outline narrower at the waist so the
  // placeholder at least reads as a fitted cut instead of reusing the men's
  // silhouette unchanged.
  const women=type.endsWith('-women');
  const base=women?type.slice(0,-'-women'.length):type;
  if(women){ c.save(); c.translate(260,0); c.scale(0.92,1); c.translate(-260,0); }

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
  const L=mockLayout(state.product.id);
  if(L){
    const mock=getRecoloredMock(L.key,state.shirtColor);
    if(mock){
      // Stage first: the mockup's own background is transparent now, so
      // without this a dark garment sits on a dark page and disappears.
      drawStage(ctx,state.shirtColor,L.ox,L.oy,L.dw,L.dh);
      ctx.drawImage(mock,L.ox,L.oy,L.dw,L.dh);
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
  if(!clean){
    ctx.setLineDash([8*u,8*u]); ctx.strokeStyle='rgba(200,242,50,.55)'; ctx.lineWidth=2*u;
    ctx.strokeRect(P.x,P.y,P.w,P.h); ctx.setLineDash([]);
  }
  // layers
  const Ls=state.layers[state.side];
  Ls.forEach((L,i)=>{
    ctx.save();
    ctx.beginPath(); ctx.rect(P.x,P.y,P.w,P.h); ctx.clip();
    if(L.type==='text'){
      ctx.font=`${L.bold?'700':'400'} ${L.size}px "${L.font}"`;
      ctx.fillStyle=L.color; ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText(L.text,L.x,L.y);
    } else if(L.type==='img'&&L.img){
      ctx.drawImage(L.img,L.x-L.w/2,L.y-L.h/2,L.w,L.h);
    }
    ctx.restore();
    if(i===state.sel && !clean){
      const b=layerBounds(L);
      ctx.strokeStyle='#c8f232'; ctx.lineWidth=2*u;
      ctx.strokeRect(b.x,b.y,b.w,b.h);
      // live size readout in cm
      const k=pxcm();
      ctx.fillStyle='#c8f232'; ctx.font=`700 ${11*u}px Inter,sans-serif`; ctx.textAlign='center';
      ctx.fillText(`${(b.w/k).toFixed(1)} × ${(b.h/k).toFixed(1)} cm`, b.x+b.w/2, b.y-8*u);
      // scale handle (bottom-right) — visual affordance for the wheel resize
      ctx.fillStyle='#c8f232';
      ctx.fillRect(b.x+b.w-5*u,b.y+b.h-5*u,10*u,10*u);
      // on-canvas delete badge (top-right corner). `r` is sized in screen
      // pixels via `u`, not canvas pixels — a "fixed 11px" badge at 6x zoom
      // rendered 66px across, big enough to hide the artwork it sits beside.
      // state._delHit shrinks by the same factor, so the tap target stays a
      // constant comfortable on-screen size at any zoom instead of growing
      // into the artwork or shrinking to unhittable.
      const bx=b.x+b.w, by=b.y, r=11*u;
      state._delHit={x:bx,y:by,r:r+3*u};
      ctx.beginPath(); ctx.arc(bx,by,r,0,Math.PI*2);
      ctx.fillStyle='#ce0358'; ctx.fill();
      ctx.strokeStyle='#fff'; ctx.lineWidth=2*u; ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(bx-4*u,by-4*u); ctx.lineTo(bx+4*u,by+4*u);
      ctx.moveTo(bx+4*u,by-4*u); ctx.lineTo(bx-4*u,by+4*u); ctx.stroke();
    }
  });
  // centre snap guides
  const cx=P.x+P.w/2, cy=P.y+P.h/2;
  if(state.guides.v){
    ctx.strokeStyle='rgba(255,177,192,.9)'; ctx.lineWidth=1*u; ctx.setLineDash([5*u,4*u]);
    ctx.beginPath(); ctx.moveTo(cx,P.y-24); ctx.lineTo(cx,P.y+P.h+24); ctx.stroke(); ctx.setLineDash([]);
  }
  if(state.guides.h){
    ctx.strokeStyle='rgba(255,177,192,.9)'; ctx.lineWidth=1*u; ctx.setLineDash([5*u,4*u]);
    ctx.beginPath(); ctx.moveTo(P.x-24,cy); ctx.lineTo(P.x+P.w+24,cy); ctx.stroke(); ctx.setLineDash([]);
  }
  updateMeasure();
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
    html+=`<span class="mz quiet">Scroll to resize · Delete to remove</span>`;
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
  document.querySelectorAll('.st-toolbar button[data-needsel]')
    .forEach(b=>b.disabled=!live);
}
function alignSel(mode){
  const L=state.layers[state.side][state.sel];
  if(!L){ toast('Select an item first'); return; }
  const P=pa(), b=layerBounds(L);
  if(mode==='cx') L.x=P.x+P.w/2;
  if(mode==='cy') L.y=P.y+P.h/2;
  if(mode==='top')    L.y+= (P.y+8) - b.y;
  if(mode==='bottom') L.y+= (P.y+P.h-8) - (b.y+b.h);
  if(mode==='left')   L.x+= (P.x+8) - b.x;
  if(mode==='right')  L.x+= (P.x+P.w-8) - (b.x+b.w);
  draw();
}
function fitWidth(){
  const L=state.layers[state.side][state.sel];
  if(!L){ toast('Select an item first'); return; }
  const P=pa(); let guard=0;
  while(layerBounds(L).w > P.w-16 && guard++<60) bumpRaw(L,0.96);
  while(layerBounds(L).w < P.w-30 && guard++<120) bumpRaw(L,1.03);
  L.x=P.x+P.w/2; draw(); toast('Fitted to print width');
}
function bumpRaw(L,f){
  if(L.type==='text') L.size=Math.max(8,Math.min(110,L.size*f));
  else { L.w*=f; L.h*=f; }
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
  ],
  back: [
    ['full-back',   'Full Back',   'crop_free'],
    ['center-back', 'Center Back', 'crop_5_4'],
  ],
};

/* Box for a preset, in canvas-internal coordinates, derived from the live
   print area P — so it tracks garment size and product changes for free
   instead of needing its own per-product table. Fractions are off real
   placement charts: a chest hit is small (~9-10cm on an actual garment),
   sitting high and to one side; a full print fills the zone with a small
   margin so it doesn't visually bleed to the edge. */
function placementBox(key, P){
  if(key==='full-front' || key==='full-back') return {x:P.x, y:P.y, w:P.w, h:P.h};
  if(key==='center-chest'){
    const w=P.w*0.42; return {x:P.x+(P.w-w)/2, y:P.y+P.h*0.07, w, h:P.h*0.28};
  }
  if(key==='center-back'){
    const w=P.w*0.5; return {x:P.x+(P.w-w)/2, y:P.y+P.h*0.06, w, h:P.h*0.32};
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
  const P=pa(), box=placementBox(key,P);
  const tight=fitLayerToBox(Ls[state.sel], box);
  // zoomToBox()/zoomOut() are pure state-setters (see above) — they have to
  // run BEFORE the one draw() below, or the canvas paints at the OLD zoom
  // level and camTx/camTy/canvasZoom change out from under a bitmap that
  // was never re-rendered against them.
  const full=key==='full-front'||key==='full-back';
  if(full) zoomOut(); else zoomToBox(box);
  draw();
  const all=PLACEMENTS.front.concat(PLACEMENTS.back), hit=all.find(p=>p[0]===key);
  const label=hit?hit[1]:'Placement';
  toast(tight ? `${label} applied — that text is a tight fit here; try Center Chest or shorten it`
              : label+' applied');
}

function renderPlacementRow(){
  const el=document.getElementById('placementRow'); if(!el) return;
  const list=PLACEMENTS[state.side]||PLACEMENTS.front;
  el.innerHTML=`<span class="placement-label">Placement</span>`
    +list.map(([k,label,icon])=>`<button class="placement-btn" onclick="applyPlacement('${k}')">
        <span class="material-symbols-outlined">${icon}</span>${label}</button>`).join('')
    +(state._zoomed?`<button class="placement-btn zoom-out" onclick="zoomOut();draw()">
        <span class="material-symbols-outlined">zoom_out</span>Full view</button>`:'');
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
  // renderPlacementRow() FIRST: it's about to add the "Full view" exit
  // button, and .placement-row is a flex sibling of .canvas-frame in the
  // same column — that button appearing changes how much height the frame
  // actually gets. Measuring fr before this mutation reads the frame's
  // PRE-zoom size and bakes a backing store sized for a box that's about to
  // resize out from under it — measured directly: a ~15% aspect mismatch
  // between the backing store and the frame's actual final box, real
  // distortion, not rounding noise. Mutate the DOM, THEN measure.
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
}
function zoomOut(){
  const was=state._zoomed;
  resetCamera();
  state._zoomed=false;
  if(was) renderPlacementRow();
}

function layerBounds(L){
  if(L.type==='text'){
    ctx.font=`${L.bold?'700':'400'} ${L.size}px "${L.font}"`;
    const w=ctx.measureText(L.text).width;
    return {x:L.x-w/2-8,y:L.y-L.size/2-8,w:w+16,h:L.size+16};
  }
  return {x:L.x-L.w/2-6,y:L.y-L.h/2-6,w:L.w+12,h:L.h+12};
}

/* hero mini tee animation */
const hc=document.getElementById('heroTee'), hctx=hc.getContext('2d');
const heroSlogans=[
  ['TEAM','ROCKET','#0D1F3C','#FFFFFF','rn'],
  ['BATCH','OF 2026','#B02E2E','#FFFFFF','hd'],
  ['ACME','CORP','#1A8A4A','#FFFFFF','po'],
  ['PUNE','MARATHON','#0D1F3C','#FFFFFF','rn'],
];
let hi=0;
function drawHeroText(l1,l2,txt,pid){
  // place text on the chest print area of the mockup, mapped to 360x380
  const P=(window.PRINTLY_MOCKS&&window.PRINTLY_MOCKS.print[pid])||null;
  const img=mockImgs[pid];
  if(!img||!P){ // fallback centre
    hctx.fillStyle=txt; hctx.textAlign='center';
    hctx.font='700 40px "Archivo Narrow"'; hctx.fillText(l1,180,190);
    hctx.font='700 26px "Archivo Narrow"'; hctx.fillText(l2,180,225);
    return;
  }
  const iw=img.naturalWidth, ih=img.naturalHeight;
  const sc=Math.min(360/iw,380/ih), dw=iw*sc, dh=ih*sc;
  const ox=(360-dw)/2, oy=(380-dh)/2;
  const cx=ox+P.cx*sc, cy=oy+P.cy*sc;
  hctx.fillStyle=txt; hctx.textAlign='center'; hctx.textBaseline='middle';
  hctx.font='700 34px "Archivo Narrow"'; hctx.fillText(l1,cx,cy-14);
  hctx.font='700 22px "Archivo Narrow"'; hctx.fillText(l2,cx,cy+18);
}
function heroLoop(){
  const [l1,l2,shirt,txt,type]=heroSlogans[hi%heroSlogans.length];
  hctx.clearRect(0,0,360,380);
  const img=mockImgs[type];
  if(img){
    const mock=getRecoloredMock(type,shirt);
    const iw=img.naturalWidth, ih=img.naturalHeight;
    const sc=Math.min(360/iw,380/ih), dw=iw*sc, dh=ih*sc;
    const ox=(360-dw)/2, oy=(380-dh)/2;
    // The knockout used to happen here, on the *recolored* pixels, which
    // also ate any garment dark enough to look like the backdrop. It now
    // lives in getRecoloredMock() where it can key off the original photo.
    drawStage(hctx,shirt,ox,oy,dw,dh,14);
    hctx.drawImage(mock||img,ox,oy,dw,dh);
    drawHeroText(l1,l2,txt,type);
  } else {
    hctx.save(); hctx.scale(360/520,380/560);
    drawGarment(hctx,type,shirt);
    hctx.font='700 44px "Archivo Narrow"'; hctx.fillStyle=txt; hctx.textAlign='center';
    hctx.fillText(l1,260,280); hctx.font='700 30px "Archivo Narrow"'; hctx.fillText(l2,260,325);
    hctx.restore();
  }
  hi++;
}
heroLoop(); setInterval(heroLoop,2600);

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
    x.drawImage(mock,ox,oy,iw*s,ih*s);
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
  const P=pa();
  state.layers[state.side].push({type:'text',text:t,x:P.x+P.w/2,y:P.y+P.h/2,size:34,
    font:document.getElementById('txtFont').value,
    color:document.getElementById('txtColor').value,bold:true});
  state.sel=state.layers[state.side].length-1;
  document.getElementById('txtInput').value='';
  renderLayers(); draw();
}
function addImage(){
  const f=document.getElementById('imgInput').files[0];
  if(!f){ toast('Choose an image file first'); return; }
  const r=new FileReader();
  r.onload=e=>{
    const img=new Image();
    img.onload=()=>{
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
  const empty=!Ls.length && !state.layers[state.side==='front'?'back':'front'].length;
  // "Active layers" over a getting-started guide reads as a broken list.
  if(head) head.hidden=empty;
  if(!Ls.length){
    const other=state.side==='front'?'back':'front';
    el.innerHTML = state.layers[other].length
      ? `<div class="empty" style="padding:32px 8px">
          <span class="material-symbols-outlined">layers_clear</span>
          <p style="font-size:13px">Nothing on the ${state.side} yet.<br>
            Your design is on the ${other} — switch sides to see it.</p>
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
    const sub=isText ? `Text · ${Math.round(L.size)}px` : `Image · ${Math.round(L.w)}×${Math.round(L.h)}`;
    return `<div class="layer${i===state.sel?' on':''}">
      <div class="layer-thumb">${thumb}</div>
      <div class="layer-meta" onclick="selLayer(${i})">
        <div class="layer-name">${name}</div>
        <div class="layer-sub">${sub}</div>
      </div>
      <div class="layer-acts">
        <button onclick="bump(${i},1.15)" title="Bigger">+</button>
        <button onclick="bump(${i},0.87)" title="Smaller">−</button>
        <button class="del" onclick="delLayer(${i})" title="Remove">
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

  layers.forEach(L=>{
    if(L.type==='text'){
      x.font=`${L.bold?'700':'400'} ${L.size}px "${L.font}"`;
      x.fillStyle=L.color; x.textAlign='center'; x.textBaseline='middle';
      x.fillText(L.text,L.x,L.y);
    } else if(L.type==='img' && L.img){
      x.drawImage(L.img,L.x-L.w/2,L.y-L.h/2,L.w,L.h);
    }
  });
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
function selLayer(i){ state.sel=i; renderLayers(); draw(); }
function bump(i,f){
  const L=state.layers[state.side][i];
  if(L.type==='text') L.size=Math.max(10,Math.min(90,L.size*f));
  else { L.w*=f; L.h*=f; }
  draw();
}
function delLayer(i){ state.layers[state.side].splice(i,1); state.sel=-1; state._delHit=null; renderLayers(); draw(); toast('Removed'); }
function deleteSel(){ if(state.sel>=0) delLayer(state.sel); }
function clearSide(){ state.layers[state.side]=[]; state.sel=-1; renderLayers(); draw(); }
function downloadPNG(){
  const a=document.createElement('a');
  a.download='printly-design.png'; a.href=cv.toDataURL('image/png'); a.click();
  toast('Preview downloaded');
}

/* drag + resize */
let drag=null;
/* Two steps now instead of one. cv.width/r.width still correctly maps a
   screen-pixel offset to a BACKING-STORE pixel — that part is unchanged and
   doesn't care what canvasZoom currently is. But the backing store is no
   longer 1:1 with the logical 520×560 space draw() paints in (see
   zoomToBox()); (dx,dy) has to run back through the inverse of the same
   camera transform draw() applied, or a click while zoomed would hit-test
   against the wrong layer. */
function pos(e){
  const r=cv.getBoundingClientRect();
  const p=e.touches?e.touches[0]:e;
  const dx=(p.clientX-r.left)*(cv.width/r.width);
  const dy=(p.clientY-r.top)*(cv.height/r.height);
  return {x:(dx-camTx)/canvasZoom, y:(dy-camTy)/canvasZoom};
}
function down(e){
  const p=pos(e); const Ls=state.layers[state.side];
  // tap on delete badge of selected item?
  if(state.sel>=0 && state._delHit){
    const d=state._delHit, dx=p.x-d.x, dy=p.y-d.y;
    if(dx*dx+dy*dy <= d.r*d.r){
      delLayer(state.sel); e.preventDefault(); return;
    }
  }
  for(let i=Ls.length-1;i>=0;i--){
    const b=layerBounds(Ls[i]);
    if(p.x>=b.x&&p.x<=b.x+b.w&&p.y>=b.y&&p.y<=b.y+b.h){
      state.sel=i; drag={i,dx:p.x-Ls[i].x,dy:p.y-Ls[i].y};
      renderLayers(); draw(); e.preventDefault(); return;
    }
  }
  state.sel=-1; state._delHit=null; renderLayers(); draw();
}
function move(e){
  if(!drag)return;
  const p=pos(e); const L=state.layers[state.side][drag.i];
  let nx=p.x-drag.dx, ny=p.y-drag.dy;
  // snap to print-area centre lines
  const P=pa(), cx=P.x+P.w/2, cy=P.y+P.h/2, SNAP=7;
  if(Math.abs(nx-cx)<SNAP){ nx=cx; state.guides.v=true; } else state.guides.v=false;
  if(Math.abs(ny-cy)<SNAP){ ny=cy; state.guides.h=true; } else state.guides.h=false;
  L.x=nx; L.y=ny; draw(); e.preventDefault();
}
function up(){ drag=null; state.guides.v=state.guides.h=false; draw(); }
cv.addEventListener('mousedown',down); cv.addEventListener('mousemove',move);
window.addEventListener('mouseup',up);
cv.addEventListener('touchstart',down,{passive:false});
cv.addEventListener('touchmove',move,{passive:false});
cv.addEventListener('touchend',up);
cv.addEventListener('wheel',e=>{
  if(state.sel<0)return; e.preventDefault();
  bump(state.sel, e.deltaY<0?1.06:0.94);
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
});
