/* ═══════════════ PRODUCT DETAIL PAGE ═══════════════
   New page — the catalogue used to jump straight into the studio, so a
   customer never saw fabric, sizing, reviews or delivery before designing.

   The gallery reuses the same recolour engine as the studio rather than
   shipping separate per-colour photos: getRecoloredMock() already produces
   a canvas for any product/colour, so swatches here are live. */

/* SIZES comes from data.js. It must NOT be re-declared here: these are
   classic scripts sharing one global scope, so a duplicate `const` is a
   parse error that silently discards this entire file — the whole product
   detail page stops existing, with nothing in the console to say why. */

/* Fabric text, care instructions and the size chart all live on the
   product row now (seeded from what used to be hardcoded here), so adding
   a product in the admin panel gives it a complete detail page instead of
   one missing half its content. */

function openProduct(pid){
  parkStudio();
  const p=product(pid);
  if(p){
    state.product=p;
    const sel=document.getElementById('stProduct'); if(sel) sel.value=pid;
    configureProductViews(pid);
    // Open on a colour this product is actually stocked in (p.colors —
    // real variants, same list the card's swatch dots come from,
    // _colors_for() in catalog.py) instead of a blank white the customer
    // never asked for. Falls back to the full catalogue's first colour,
    // then white, only if this product somehow has no active variants yet.
    state.shirtColor=(p.colors&&p.colors[0])||SHIRT_COLORS[0]||'#FFFFFF';
    state.plainItem=false;
    resetSizesForProduct();
    updateProductSub();
  }
  // Browsing from the catalogue always lands on the plain product page
  // first — photos, price, colours — never straight into the editor.
  state.pdpStage='view';
  go('pdp');
}
/* Used to (re-)enter the design editor once the caller has already set up
   product/colour/layers itself — resuming a saved design, starting a fresh
   canvas. Deliberately does NOT run openProduct()'s reset-to-defaults
   (colour, print views), since that would clobber what the caller just
   configured; it only resets the things a new editing session should
   always start clean on (sizes, plain-item), same as before. */
function openPdp(pid){
  parkStudio();
  const p=product(pid);
  if(p) state.product=p;
  state.plainItem=false;
  resetSizesForProduct();
  updateProductSub();
  state.pdpStage='design';
  go('pdp');
}

function parkStudio(){
  const studio=document.querySelector('.studio');
  const parking=document.getElementById('studioParking');
  if(studio&&parking&&studio.parentElement!==parking){
    studio.classList.remove('pdp-mode');
    parking.appendChild(studio);
  }
}
function setGarmentColor(c){
  state.shirtColor=c;
  document.querySelectorAll('#pdpSwatches .sw,#swatches .sw')
    .forEach(el=>el.classList.toggle('on',el.title===c));
  document.querySelectorAll('#pdpViewSwatchGrid .pdp-view-swatch-item')
    .forEach(el=>el.classList.toggle('on',el.dataset.color===c));
  updatePdpColorName();
  redrawPdpGalleryCanvases();
  draw();
}
function updatePdpColorName(){
  const el=document.getElementById('pdpColorName'); if(!el) return;
  el.textContent=COLOR_NAMES[state.shirtColor]||'';
}
function mountPdpCustomizer(p){
  const studio=document.querySelector('.studio'), mount=document.getElementById('pdpCustomizerMount');
  if(!studio||!mount) return;
  studio.classList.add('pdp-mode');
  mount.appendChild(studio);
  document.querySelector('.st-left')?.classList.remove('tool-open');
  studioTab('assets');
  document.getElementById('pdpEditorTitle').textContent=p.name;
  document.getElementById('pdpEditorRating').innerHTML=starsFor(p.id);
  document.getElementById('pdpEditorWish').innerHTML=wishHeart(p.id,'lg');
  document.getElementById('pdpFabric').innerHTML=`<b>${esc(p.fit||'Custom fit')}</b><span>${esc(p.fabric||'Premium fabric')}</span>`;
  document.getElementById('plainItemToggle').checked=!!state.plainItem;
  document.getElementById('pdpSwatches').innerHTML=SHIRT_COLORS.map(c=>
    `<button class="sw${c===state.shirtColor?' on':''}" style="background:${c}" title="${c}"
       aria-label="${esc(COLOR_NAMES[c]||c)}" onclick="setGarmentColor('${c}')"></button>`).join('');
  updatePdpColorName();
  renderPdpDetails(p);
  renderPrintControls();
  renderSizeGrid(); updatePrice(); renderLayers(); applyPreviewSize(); draw();
}

/* Care instructions, size guide and delivery estimate have no live
   equivalent elsewhere on the merged page (unlike bulk pricing, which the
   size grid + tier-hint already show in real time) — they still need a
   home, so they're a details/accordion block inside pdp-config rather
   than a separate static gallery that gets thrown away on load. */
function renderPdpDetails(p){
  const el=document.getElementById('pdpDetails'); if(!el) return;
  const chart=p.chart && p.chart.chest ? {label:p.fit, ...p.chart} : null;
  const keys=sizeKeys(p.id);
  el.innerHTML=`
    <details class="acc"><summary>Fabric &amp; composition</summary>
      <p>${esc(p.fabric||'Premium fabric')}</p></details>
    <details class="acc"><summary>Care instructions</summary>
      <ul>${(p.care||[]).map(c=>`<li>${esc(c)}</li>`).join('')}</ul></details>
    ${chart?`<details class="acc"><summary>Size guide — ${esc(chart.label)}</summary>
      <table class="size-table">
        <tr><th>Size</th><th>Chest (in)</th><th>Length (cm)</th></tr>
        ${chart.chest.map((c,i)=>`<tr><td><b>${chart.chest.length>1?(keys[i]||'—'):'One size'}</b></td>
          <td>${c}</td><td>${chart.length[i]}</td></tr>`).join('')}
      </table>
      <p style="font-size:12px">Chest measured flat, armpit to armpit. Allow ±1 in tolerance.</p>
    </details>`:''}
    <details class="acc"><summary>Delivery estimate</summary>
      <div class="row" style="gap:8px;margin-top:2px">
        <input class="inp" id="pinInput" placeholder="Enter 6-digit pincode" maxlength="6" inputmode="numeric">
        <button class="btn btn-quiet btn-sm" onclick="checkPincode()">Check</button>
      </div>
      <div id="pinResult" style="font-size:13px;margin-top:10px"></div>
    </details>`;
}

function renderPdp(){
  parkStudio();
  const el=document.getElementById('pdpBody'); if(!el) return;
  const p=PRODUCTS.find(x=>x.id===state.product.id);
  if(!p){ el.innerHTML='<div class="empty">Product not found.</div>'; return; }

  el.innerHTML=`
    <div class="crumb">
      <a href="#" onclick="go('home');return false">Home</a> ›
      <a href="#" onclick="go('products');return false">Products</a> ›
      <span>${esc(p.name)}</span>
    </div>

    <div id="pdpView" class="pdp">
      <div class="pdp-gallery">
        <div class="pdp-main">
          <canvas id="pdpViewCanvas" width="520" height="560"></canvas>
        </div>
        <div class="pdp-thumbs" id="pdpViewThumbs"></div>
      </div>
      <div class="pdp-info">
        <div class="row" style="justify-content:space-between;align-items:flex-start;gap:12px">
          <div>
            <h1 class="pdp-view-title">${esc(p.name)}</h1>
            <div id="pdpViewRating"></div>
          </div>
          <div id="pdpViewWish"></div>
        </div>
        <div id="pdpViewPrice"></div>
        <div class="pdp-view-trust">
          <span><span class="material-symbols-outlined">verified</span>Premium fabric</span>
          <span><span class="material-symbols-outlined">encrypted</span>Secure payment</span>
          <span><span class="material-symbols-outlined">local_shipping</span>48-hr dispatch</span>
        </div>
        <div class="pdp-view-colors">
          <div class="spread"><span class="st-lbl">Colour</span><span class="t-label t-dim" id="pdpViewColorCount"></span></div>
          <div class="pdp-view-swatch-grid" id="pdpViewSwatchGrid"></div>
        </div>
        <button class="btn btn-primary btn-block pdp-view-cta" onclick="startDesigning()">
          Start designing now <span class="material-symbols-outlined">arrow_forward</span>
        </button>
        <div class="pdp-view-fabric" id="pdpViewFabric"></div>
      </div>
    </div>

    <div id="pdpCustomizerMount" class="pdp-customizer-mount" hidden></div>

    <div class="section-sm" style="margin-top:24px">
      <div class="spread" style="margin-bottom:24px">
        <h2 class="t-h2">Community <span class="t-lime">feedback</span></h2>
        <div id="reviewAction"></div>
      </div>
      <div id="reviewList"></div>
    </div>

    <div class="section-sm">
      <h2 class="t-h2" style="margin-bottom:24px">Complete the <span class="t-lime">look</span></h2>
      <div class="grid grid-4">
        ${PRODUCTS.filter(x=>x.id!==p.id).slice(0,4).map(x=>`
          <div class="card card-hover pcard" style="cursor:pointer" onclick="openProduct('${x.id}')">
            <div class="pcard-img">${productThumbHtml(x.id,300,320)}</div>
            <div class="pcard-body">
              <h3 class="pcard-name" style="font-size:15px">${esc(x.name)}</h3>
              <div class="pcard-price">From <span class="t-lime">₹${x.tiers[3][1].toLocaleString('en-IN')}</span></div>
            </div>
          </div>`).join('')}
      </div>
    </div>`;

  if(state.pdpStage==='design'){
    document.getElementById('pdpView').hidden=true;
    document.getElementById('pdpCustomizerMount').hidden=false;
    mountPdpCustomizer(p);
  }else{
    renderPdpView(p);
  }
  document.querySelectorAll('.pthumb').forEach(c=>drawProductThumb(c,c.dataset.p));
  loadReviews(p.id);
}

/* ── Product view stage — shown before the customer commits to designing.
   Reuses the studio's own recolour engine (getRecoloredMock) rather than
   shipping separate per-colour photos, so every swatch here is a live,
   accurate preview of what the studio canvas will actually open on. Real
   per-angle product photography can replace drawPdpGalleryFrame's canvas
   draw later without touching the surrounding layout. */
let pdpViewSide='front';
function pdpGalleryViews(pid){
  return printViews(pid).filter(v=>v.key==='front'||v.key==='back');
}
function galleryMockKey(pid,viewKey){
  const v=printView(pid,viewKey);
  const mock=v&&v.mock ? v.mock : (viewKey==='front'?pid:pid+'_'+viewKey);
  return MOCK.mocks[mock] ? mock : photoMockKey(pid);
}
function drawPdpGalleryFrame(cnv,pid,viewKey){
  if(!cnv) return;
  const c=cnv.getContext('2d');
  c.clearRect(0,0,cnv.width,cnv.height);
  const img=getRecoloredMock(galleryMockKey(pid,viewKey), state.shirtColor);
  if(!img) return;
  const iw=img.naturalWidth||img.width, ih=img.naturalHeight||img.height;
  const sc=Math.min(cnv.width/iw,cnv.height/ih);
  const dw=iw*sc, dh=ih*sc;
  drawStage(c,state.shirtColor,0,0,cnv.width,cnv.height,cnv.id==='pdpViewCanvas'?18:8);
  drawMockup(c,img,(cnv.width-dw)/2,(cnv.height-dh)/2,dw,dh);
}
function redrawPdpGalleryCanvases(){
  if(!document.getElementById('pdpViewCanvas')) return;
  const pid=state.product.id;
  document.querySelectorAll('#pdpViewThumbs .pdp-thumb').forEach(btn=>
    drawPdpGalleryFrame(btn.querySelector('canvas'), pid, btn.dataset.side));
  drawPdpGalleryFrame(document.getElementById('pdpViewCanvas'), pid, pdpViewSide);
}
function setPdpViewSide(side){
  pdpViewSide=side;
  document.querySelectorAll('#pdpViewThumbs .pdp-thumb').forEach(b=>b.classList.toggle('on',b.dataset.side===side));
  redrawPdpGalleryCanvases();
}
function renderPdpViewSwatches(p){
  const grid=document.getElementById('pdpViewSwatchGrid');
  const count=document.getElementById('pdpViewColorCount');
  if(!grid) return;
  // Real stocked colours for this product (same list the card's swatch
  // dots come from) — falls back to the full catalogue only if this
  // product has no active variants yet.
  const colors=(p.colors&&p.colors.length)?p.colors:SHIRT_COLORS;
  if(count) count.textContent=colors.length+' colour'+(colors.length===1?'':'s')+' available';
  grid.innerHTML=colors.map(c=>`
    <button class="pdp-view-swatch-item${c===state.shirtColor?' on':''}" data-color="${esc(c)}"
      onclick="setGarmentColor('${c}')" aria-label="${esc(COLOR_NAMES[c]||c)}">
      <span class="pdp-view-swatch-dot" style="background:${esc(c)}"></span>
      <span class="pdp-view-swatch-label">${esc(COLOR_NAMES[c]||c)}</span>
    </button>`).join('');
}
function renderPdpView(p){
  document.getElementById('pdpViewRating').innerHTML=starsFor(p.id);
  document.getElementById('pdpViewWish').innerHTML=wishHeart(p.id,'lg');
  document.getElementById('pdpViewPrice').innerHTML=`
    <div class="pcard-price pdp-view-price">From <span class="t-lime">₹${p.tiers[3][1].toLocaleString('en-IN')}</span>
      <span class="t-label t-dim" style="font-weight:400"> at 100+</span></div>
    <div class="pcard-tiers">1pc ₹${p.tiers[0][1]} · 10+ ₹${p.tiers[1][1]} · 50+ ₹${p.tiers[2][1]}</div>`;
  document.getElementById('pdpViewFabric').innerHTML=
    `<b>${esc(p.fit||'Custom fit')}</b><span>${esc(p.fabric||'Premium fabric')}</span>`;
  renderPdpViewSwatches(p);

  pdpViewSide='front';
  const views=pdpGalleryViews(p.id);
  const thumbs=document.getElementById('pdpViewThumbs');
  thumbs.innerHTML = views.length>1 ? views.map(v=>`
    <button class="pdp-thumb${v.key==='front'?' on':''}" data-side="${v.key}" onclick="setPdpViewSide('${v.key}')">
      <canvas width="120" height="130"></canvas><span>${esc(v.label)}</span>
    </button>`).join('') : '';
  redrawPdpGalleryCanvases();
}
function startDesigning(){
  state.pdpStage='design';
  document.getElementById('pdpView').hidden=true;
  document.getElementById('pdpCustomizerMount').hidden=false;
  mountPdpCustomizer(PRODUCTS.find(x=>x.id===state.product.id));
  window.scrollTo({top:0,behavior:'smooth'});
}
function backToPdpView(){
  state.pdpStage='view';
  parkStudio();
  document.getElementById('pdpCustomizerMount').hidden=true;
  document.getElementById('pdpView').hidden=false;
  renderPdpView(PRODUCTS.find(x=>x.id===state.product.id));
  window.scrollTo({top:0,behavior:'smooth'});
}

async function checkPincode(){
  const pin=(document.getElementById('pinInput').value||'').trim();
  const out=document.getElementById('pinResult');
  out.innerHTML='<span class="t-dim">Checking…</span>';
  try{
    const res=await fetch(BACKEND+'/api/shipping/estimate?pincode='+encodeURIComponent(pin));
    const d=await res.json();
    out.innerHTML = d.ok
      ? `<span class="t-lime">Delivers in ${d.min_days}–${d.max_days} days</span>
         <span class="t-dim"> · ${esc(d.region)}</span><br>
         <span class="t-dim" style="font-size:11px">${esc(d.note)}</span>`
      : `<span class="t-pink">${esc(d.error)}</span>`;
  }catch(err){ out.innerHTML='<span class="t-pink">Could not reach the server.</span>'; }
}

/* ── Reviews ── */
async function loadReviews(pid){
  const list=document.getElementById('reviewList');
  const action=document.getElementById('reviewAction');
  if(!list) return;
  try{
    const res=await fetch(BACKEND+'/api/reviews/'+pid,{credentials:'include'});
    const d=await res.json();

    action.innerHTML = d.can_review
      ? `<button class="btn btn-ghost btn-sm" onclick="writeReview('${pid}')">
           <span class="material-symbols-outlined" style="font-size:18px">edit</span> Write a review</button>`
      : `<span class="t-dim" style="font-size:12px">${
            state.user ? 'Only verified buyers can review' : 'Sign in after ordering to review'}</span>`;

    if(!d.reviews.length){
      list.innerHTML=`<div class="empty">
        <span class="material-symbols-outlined">reviews</span><br>
        No reviews yet — be the first after your order arrives.</div>`;
      return;
    }
    list.innerHTML=`<div class="grid grid-3">`+d.reviews.map(r=>`
      <div class="review">
        <div class="review-head">
          <div class="avatar">${esc(r.author.trim().charAt(0).toUpperCase())}</div>
          <div>
            <div style="font-weight:600;font-size:14px">${esc(r.author)}</div>
            <div class="stars">${'★'.repeat(r.rating)}${'☆'.repeat(5-r.rating)}</div>
          </div>
        </div>
        ${r.body?`<p class="t-mut" style="font-size:14px">${esc(r.body)}</p>`:''}
      </div>`).join('')+`</div>`;
  }catch(err){ list.innerHTML='<div class="empty">Could not load reviews.</div>'; }
}

async function writeReview(pid){
  const raw=prompt('Rate this product from 1 to 5');
  if(raw===null) return;
  const rating=parseInt(raw,10);
  if(!(rating>=1&&rating<=5)){ toast('Enter a number from 1 to 5'); return; }
  const body=prompt('Add a comment (optional)')||'';
  try{
    const res=await fetch(BACKEND+'/api/reviews/'+pid,{
      method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',
      body:JSON.stringify({rating,body}),
    });
    const d=await res.json();
    if(!d.ok){ toast(d.error||'Could not post review'); return; }
    toast('Thanks for the review');
    loadReviews(pid); loadReviewSummary();
  }catch(err){ toast('Could not reach the server — try again.'); }
}
