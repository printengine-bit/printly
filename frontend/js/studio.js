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
  updatePrice();
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
function studioProductChange(){
  const old=pa();
  state.product=PRODUCTS.find(p=>p.id===document.getElementById('stProduct').value);
  const P=pa();
  // keep existing artwork inside the new product's print area
  ['front','back'].forEach(s=>{
    state.layers[s].forEach(L=>{
      const rx=(L.x-old.x)/old.w, ry=(L.y-old.y)/old.h;
      L.x=P.x+rx*P.w; L.y=P.y+ry*P.h;
      if(P.w<old.w){
        const f=P.w/old.w;
        if(L.type==='text') L.size=Math.max(10,L.size*f);
        else { L.w*=f; L.h*=f; }
      }
    });
  });
  toggleJerseyKit();
  updateProductSub();
  updatePrice(); draw();
  toast(state.product.name+' — mockup updated');
}
function setSide(s){
  state.side=s; state.sel=-1;
  document.getElementById('tabF').classList.toggle('on',s==='front');
  document.getElementById('tabB').classList.toggle('on',s==='back');
  document.getElementById('sideLabel').textContent=s;
  renderLayers(); draw();
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

  if(type==='tb'){                                   // ── TOTE BAG ──
    c.strokeStyle=LINE; c.lineWidth=7; c.lineCap='round';
    c.beginPath(); c.moveTo(196,195); c.bezierCurveTo(196,95,246,95,246,195); c.stroke();
    c.beginPath(); c.moveTo(274,195); c.bezierCurveTo(274,95,324,95,324,195); c.stroke();
    c.lineWidth=2;
    c.beginPath();
    c.moveTo(150,185); c.lineTo(370,185);
    c.lineTo(378,495); c.quadraticCurveTo(260,512,142,495);
    c.closePath(); c.fill(); c.stroke();
    c.beginPath(); c.strokeStyle=SOFT; c.moveTo(152,205); c.lineTo(368,205); c.stroke();

  } else if(type==='hd'){                            // ── HOODIE ──
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

  } else if(type==='js'){                            // ── SPORTS JERSEY ──
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

  } else if(type==='po'){                            // ── POLO SHIRT ──
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
  c.restore();
}
/* `clean` renders the garment + artwork only, with no editor overlays —
   used by captureThumb() so cart/design/order thumbnails don't have the
   print-area guide or selection UI baked into them. */
function draw(clean){
  ctx.clearRect(0,0,520,560);
  const L=mockLayout(state.product.id);
  if(L){
    const mock=getRecoloredMock(L.key,state.shirtColor);
    if(mock) ctx.drawImage(mock,L.ox,L.oy,L.dw,L.dh);
    else drawGarment(ctx,state.product.id,state.shirtColor);
  } else {
    drawGarment(ctx,state.product.id,state.shirtColor);
  }
  // print area guide
  const P=pa();
  if(!clean){
    ctx.setLineDash([8,8]); ctx.strokeStyle='rgba(200,242,50,.55)'; ctx.lineWidth=2;
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
      ctx.strokeStyle='#c8f232'; ctx.lineWidth=2;
      ctx.strokeRect(b.x,b.y,b.w,b.h);
      // live size readout in cm
      const k=pxcm();
      ctx.fillStyle='#c8f232'; ctx.font='700 11px Inter,sans-serif'; ctx.textAlign='center';
      ctx.fillText(`${(b.w/k).toFixed(1)} × ${(b.h/k).toFixed(1)} cm`, b.x+b.w/2, b.y-8);
      // scale handle (bottom-right) — visual affordance for the wheel resize
      ctx.fillStyle='#c8f232';
      ctx.fillRect(b.x+b.w-5,b.y+b.h-5,10,10);
      // on-canvas delete badge (top-right corner)
      const bx=b.x+b.w, by=b.y, r=11;
      state._delHit={x:bx,y:by,r:r+3};
      ctx.beginPath(); ctx.arc(bx,by,r,0,Math.PI*2);
      ctx.fillStyle='#ce0358'; ctx.fill();
      ctx.strokeStyle='#fff'; ctx.lineWidth=2; ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(bx-4,by-4); ctx.lineTo(bx+4,by+4);
      ctx.moveTo(bx+4,by-4); ctx.lineTo(bx-4,by+4); ctx.stroke();
    }
  });
  // centre snap guides
  const cx=P.x+P.w/2, cy=P.y+P.h/2;
  if(state.guides.v){
    ctx.strokeStyle='rgba(255,177,192,.9)'; ctx.lineWidth=1; ctx.setLineDash([5,4]);
    ctx.beginPath(); ctx.moveTo(cx,P.y-24); ctx.lineTo(cx,P.y+P.h+24); ctx.stroke(); ctx.setLineDash([]);
  }
  if(state.guides.h){
    ctx.strokeStyle='rgba(255,177,192,.9)'; ctx.lineWidth=1; ctx.setLineDash([5,4]);
    ctx.beginPath(); ctx.moveTo(P.x-24,cy); ctx.lineTo(P.x+P.w+24,cy); ctx.stroke(); ctx.setLineDash([]);
  }
  updateMeasure();
}

/* ── measurement + alignment assistant ── */
function updateMeasure(){
  const box=document.getElementById('measureBar'); if(!box) return;
  const P=pa(), k=pxcm();
  const zone=document.getElementById('zoneLabel');
  if(zone) zone.textContent=`Primary print zone · ${P.cmW} × ${P.cmH} cm`;

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
  if(warn) warn.classList.toggle('on',outside);
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
    // draw to temp canvas, knock out black bg, then blit to hero
    const tmp=document.createElement('canvas'); tmp.width=360; tmp.height=380;
    const t=tmp.getContext('2d');
    t.drawImage(mock||img,(360-dw)/2,(380-dh)/2,dw,dh);
    const d=t.getImageData(0,0,360,380), p=d.data;
    for(let i=0;i<p.length;i+=4){
      if(p[i]<40&&p[i+1]<40&&p[i+2]<40) p[i+3]=0;   // black → transparent
    }
    t.putImageData(d,0,0);
    hctx.drawImage(tmp,0,0);
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
function renderLayers(){
  const el=document.getElementById('layerList'); const Ls=state.layers[state.side];
  if(!Ls.length){
    el.innerHTML=`<div class="empty" style="padding:32px 8px">
      <span class="material-symbols-outlined">layers_clear</span>
      <p style="font-size:13px">Nothing on this side yet.<br>Add text, a logo, or use AI.</p>
    </div>`;
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
}
/* Snapshot the canvas WITHOUT the editing chrome.
   draw() paints the selection box, size readout, delete badge and scale
   handle for the selected layer, and toDataURL captures whatever is on the
   canvas — so a naive capture bakes that UI into cart and design
   thumbnails. Deselect, redraw, capture, then put the selection back. */
function captureThumb(type='image/jpeg', quality=0.7){
  draw(true);                       // garment + artwork only
  const data=cv.toDataURL(type,quality);
  draw();                           // restore the editing view
  return data;
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
function pos(e){
  const r=cv.getBoundingClientRect();
  const p=e.touches?e.touches[0]:e;
  return {x:(p.clientX-r.left)*(cv.width/r.width),y:(p.clientY-r.top)*(cv.height/r.height)};
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
// keyboard: Delete / Backspace removes selected element (when not typing in a field)
window.addEventListener('keydown',e=>{
  const t=e.target.tagName;
  if(t==='INPUT'||t==='TEXTAREA'||t==='SELECT') return;
  if((e.key==='Delete'||e.key==='Backspace') && state.sel>=0){
    e.preventDefault(); delLayer(state.sel);
  }
});
