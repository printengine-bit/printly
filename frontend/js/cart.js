/* ═══════════════ PRICING ═══════════════ */
/* Apparel GST is two slabs applied PER PIECE on the sale value — 5% up to
   ₹1,000, 12% above — so one cart can carry both rates. Mirrors gst_rate()
   in catalog.py; the server recomputes every figure and refuses a mismatch
   over ₹1, so these two have to agree exactly.
   The piece value that counts is the tier price, not the list price: a
   hoodie discounted below the threshold at volume moves down a slab. */
function gstRate(unit){
  return unit > TAX.gst_threshold ? TAX.gst_percent_high : TAX.gst_percent;
}
/* GST for a set of {unit,total} lines, plus the rates actually used so the
   label can say "GST 5%" or "GST 5% + 12%" rather than picking one. */
function gstFor(lines){
  let amount=0; const rates=new Set();
  lines.forEach(l=>{ const r=gstRate(l.unit); rates.add(r); amount += l.total*r/100; });
  return {amount:Math.round(amount), rates:[...rates].sort((a,b)=>a-b)};
}
function gstLabel(rates){
  return 'GST ' + (rates.length ? rates.map(r=>r+'%').join(' + ') : TAX.gst_percent+'%');
}
function baseUnitPrice(p,q){
  let u=p.tiers[0][1];
  p.tiers.forEach(([min,pr])=>{ if(q>=min)u=pr; });
  return u;
}
function unitPrice(p,q,keys){
  return baseUnitPrice(p,q)+printExtra(p,keys===undefined?(state.enabledViews||[]):keys);
}
/* ── Size picker ──────────────────────────────────────────────────
   Two faces over one piece of state. `state.sizes` is still the only place
   a quantity lives; `state.orderMode` only decides which control edits it.

   'single' is the default because it's what nearly every visitor is doing —
   one garment, one size, a quantity. The full per-size breakdown is a
   wholesale order form, and leading with it made the studio read like a
   trade portal. It's one click away behind the bulk button. */
function renderSizeGrid(){
  const el=document.getElementById('sizeGrid'); if(!el) return;
  const keys=sizeKeys(state.product.id);
  const bulk=state.orderMode==='bulk';
  el.className=bulk?'size-grid':'size-pick';
  el.innerHTML=bulk?bulkRows(keys):singleRows(keys);
  const pdpQty=document.getElementById('pdpQtyMount');
  if(pdpQty){
    pdpQty.innerHTML='';
    if(!bulk && document.querySelector('.studio.pdp-mode')){
      const row=el.querySelector('.qty-row');
      if(row) pdpQty.appendChild(row);
    }
  }
  const title=document.getElementById('qtyTitle');
  if(title) title.textContent=bulk?'Size breakdown':'Size';
  renderBulkToggle(keys);
}

/* One row per size — the wholesale view. */
function bulkRows(keys){
  const rows=keys.map(k=>`
    <div class="size-row">
      <span class="size-key">${esc(k)}</span>
      <button class="size-step" onclick="bumpSize('${esc(k)}',-1)" aria-label="Fewer ${esc(k)}">−</button>
      <input class="size-num" type="number" min="0" max="9999" inputmode="numeric"
             value="${state.sizes[k]||0}" oninput="setSize('${esc(k)}',this.value)" aria-label="${esc(k)} quantity">
      <button class="size-step" onclick="bumpSize('${esc(k)}',1)" aria-label="More ${esc(k)}">+</button>
    </div>`).join('');
  // One artwork gets printed on every size in the order, so the canvas shows
  // the smallest one — clear that fits them all.
  const ordered=keys.filter(k=>+state.sizes[k]>0);
  const note=ordered.length>1
    ? `<p class="size-note">Canvas shows <b>${esc(ordered[0])}</b>, the smallest size you've
         ordered — a design that fits there fits every size in the order.</p>` : '';
  return rows+note;
}

/* Size chips plus a quantity stepper. Nothing is pre-selected: the whole
   point of asking is that we don't know, and a default M that looks chosen
   is how a customer ends up with the wrong shirt. */
function singleRows(keys){
  const pick=currentSize();
  const qty=pick?(+state.sizes[pick]||1):1;
  const head=keys.length>1
    ? `<div class="sizes">${keys.map(k=>`<button class="size-btn${k===pick?' on':''}"
         onclick="pickSize('${esc(k)}')">${esc(k)}</button>`).join('')}</div>`
    : `<div class="one-size">${esc(keys[0])}</div>`;
  return `${head}
    <div class="qty-row${pick?'':' off'}">
      <span class="size-key">Qty</span>
      <button class="size-step" onclick="bumpQty(-1)" aria-label="One fewer">−</button>
      <input class="size-num" type="number" min="1" max="9999" inputmode="numeric"
             value="${qty}" ${pick?'':'disabled'} oninput="setQty(this.value)" aria-label="Quantity">
      <button class="size-step" onclick="bumpQty(1)" aria-label="One more">+</button>
    </div>`;
}

/* In single mode exactly one size carries the whole quantity, so "which
   size is selected" is derived rather than stored — no second field to
   drift out of step with the breakdown. */
function currentSize(){
  return sizeKeys(state.product.id).find(k=>+state.sizes[k]>0)||'';
}
function pickSize(k){
  const qty=Math.max(1,sizeTotal(state.sizes)||1);
  sizeKeys(state.product.id).forEach(x=>state.sizes[x]=0);
  state.sizes[k]=qty;                       // keep the quantity they'd set
  renderSizeGrid(); updatePrice();
}
function bumpQty(d){
  const k=currentSize();
  if(!k){ toast('Pick a size first'); return; }
  state.sizes[k]=Math.max(1,(+state.sizes[k]||1)+d);
  renderSizeGrid(); updatePrice();
}
function setQty(v){
  const k=currentSize(); if(!k) return;
  state.sizes[k]=Math.max(1,Math.min(9999,parseInt(v,10)||1));
  updatePrice();          // don't re-render: it would fight the caret
}

function bumpSize(k,d){
  state.sizes[k]=Math.max(0,(+state.sizes[k]||0)+d);
  renderSizeGrid(); updatePrice();
}
function setSize(k,v){
  const n=Math.max(0,Math.min(9999,parseInt(v,10)||0));
  state.sizes[k]=n;
  updatePrice();          // don't re-render: it would fight the caret
}

/* The bulk entry point doubles as the pitch: showing the next tier's price
   is the only reason someone would click it. Hidden for one-size products,
   where "single" and "bulk" are the same one-row control. */
function renderBulkToggle(keys){
  const b=document.getElementById('bulkToggle'); if(!b) return;
  keys=keys||sizeKeys(state.product.id);
  if(keys.length<2){ b.hidden=true; return; }
  b.hidden=false;
  if(state.orderMode==='bulk'){
    b.innerHTML=`<span class="material-symbols-outlined">arrow_back</span>
      <span>Back to a single item</span>`;
    return;
  }
  const t=(state.product.tiers||[])[1];
  b.innerHTML=`<span class="material-symbols-outlined">groups</span>
    <span><b>Bulk order</b>${t?` — mix sizes, from ₹${t[1].toLocaleString('en-IN')} each at ${t[0]}+`
                             :' — order a mix of sizes'}</span>`;
}

function toggleOrderMode(){
  if(state.orderMode==='bulk'){
    // Collapsing a real breakdown would quietly drop sizes, so keep the
    // biggest line and say so rather than picking for them in silence.
    const keys=sizeKeys(state.product.id);
    const filled=keys.filter(k=>+state.sizes[k]>0);
    if(filled.length>1){
      const best=filled.reduce((a,b)=>+state.sizes[b]>+state.sizes[a]?b:a);
      keys.forEach(k=>{ if(k!==best) state.sizes[k]=0; });
      toast(`Kept ${state.sizes[best]}×${best} — switch back to bulk for a size mix`);
    }
    state.orderMode='single';
  } else {
    state.orderMode='bulk';
  }
  renderSizeGrid(); updatePrice();
}

/* Reset the breakdown when the product changes, since size keys differ
   (a tote has no S/M/L). The quantity carries over only when the new
   product is one-size — otherwise there's no size to carry it onto, and
   guessing one is exactly what we're avoiding. */
function resetSizesForProduct(){
  const keys=sizeKeys(state.product.id);
  const existing=Object.keys(state.sizes);
  const sameShape=existing.length===keys.length && keys.every(k=>k in state.sizes);
  if(!sameShape){
    const carry=keys.length===1?Math.max(1,sizeTotal(state.sizes)):0;
    state.sizes=newSizeBreakdown(state.product.id, carry);
  }
  if(keys.length===1 && !(+state.sizes[keys[0]]>0)) state.sizes[keys[0]]=1;
  renderSizeGrid();
}

function updatePrice(){
  const q=sizeTotal(state.sizes);
  document.getElementById('qtyLabel').textContent=q;
  const p=state.product, base=baseUnitPrice(p,Math.max(1,q));
  const extra=state.plainItem?0:printExtra(p,state.enabledViews), u=base+extra;
  const box=document.getElementById('priceBox');
  const isPdp=!!document.querySelector('.studio.pdp-mode');

  if(isPdp){
    const sub=u*Math.max(1,q);
    box.innerHTML=`
      <div class="pdp-price-main">
        <b>₹${u.toLocaleString('en-IN')}</b>
        <span>per item</span>
      </div>
      ${extra?`<div class="pdp-price-detail">Includes ₹${extra.toLocaleString('en-IN')} for selected print locations</div>`:''}
      ${q>1?`<div class="pdp-line-total">${q} items · ₹${sub.toLocaleString('en-IN')} before GST</div>`:''}
      <div class="price-note">${q<1?'Choose a size to continue.':'GST and shipping calculated in cart.'}</div>`;
  } else if(q<1){
    // A total of ₹99 with nothing in the order is just the shipping line
    // showing through, and it reads as a broken price.
    box.innerHTML=`
      <div class="price-line"><span>Garment</span><span>₹${base.toLocaleString('en-IN')}</span></div>
      ${extra?`<div class="price-line"><span>Print locations</span><span>+₹${extra.toLocaleString('en-IN')}</span></div>`:''}
      <div class="price-note">Choose a size to see the total.</div>`;
  } else {
    // Free shipping is a rupee threshold, not a piece count. This line used
    // to read `q>=50`, so the studio quoted free delivery on fifty cheap
    // pieces the cart and the server then billed ₹99 for — and charged for
    // delivery on eight hoodies they'd waive. Same rule everywhere.
    const sub=u*q, g=gstFor([{unit:u,total:sub}]);
    const ship=sub>TAX.free_shipping_over?0:TAX.shipping_flat, tot=sub+g.amount+ship;
    box.innerHTML=`
      <div class="price-line"><span>Garment</span><span>₹${base.toLocaleString('en-IN')}</span></div>
      ${extra?`<div class="price-line"><span>Print locations</span><span>+₹${extra.toLocaleString('en-IN')}</span></div>`:''}
      <div class="price-line"><span>Unit price</span><span>₹${u.toLocaleString('en-IN')}</span></div>
      <div class="price-line"><span>${esc(p.name)} × ${q}</span><span>₹${sub.toLocaleString('en-IN')}</span></div>
      <div class="price-line"><span>${gstLabel(g.rates)}</span><span>₹${g.amount.toLocaleString('en-IN')}</span></div>
      <div class="price-line"><span>Shipping</span><span>${ship===0?'<span class="t-lime">FREE</span>':'₹'+ship}</span></div>
      <div class="price-line total"><span>Total</span><span>₹${tot.toLocaleString('en-IN')}</span></div>`;
  }
  renderTierHint(q);
  // Every size edit runs through here, and the canvas draws whichever
  // garment size the order is anchored to — so this is where the two meet.
  if(typeof applyPreviewSize==='function') applyPreviewSize();
  syncCta();
}

/* How far the next price break is. The tier table is already on the product
   page; here it only matters as "N more pieces and everything gets cheaper". */
function renderTierHint(q){
  const el=document.getElementById('tierHint'); if(!el) return;
  const tiers=state.product.tiers||[];
  if(q<1 || tiers.length<2){ el.hidden=true; return; }
  const next=tiers.find(([min])=>min>q);
  el.hidden=false;
  el.className='tier-hint'+(next?'':' best');
  el.innerHTML=next
    ? `<span class="material-symbols-outlined">trending_down</span>
       Add ${next[0]-q} more → <b>₹${next[1].toLocaleString('en-IN')}</b> each`
    : `<span class="material-symbols-outlined">verified</span> Best price unlocked`;
}

/* The primary button says what's missing instead of letting you press it and
   get a toast. Both conditions are still re-checked in addToCart(). */
function syncCta(){
  const btn=document.getElementById('addBtn'); if(!btn) return;
  const hasDesign=state.plainItem||enabledPrintViews().some(v=>(state.layers[v.key]||[]).length);
  let label='Add to cart', icon='arrow_forward', off=false;
  if(!hasDesign){ label='Add text or image'; icon='draw'; off=true; }
  else if(sizeTotal(state.sizes)<1){ label='Choose a size'; icon='straighten'; off=true; }
  btn.disabled=off;
  btn.innerHTML=`${label} <span class="material-symbols-outlined">${icon}</span>`;
}

/* ═══════════════ CART & ORDERS ═══════════════ */
/* Cart badge — the CSS hides it via [data-count="0"], so the attribute has to
   move in step with the text or the badge never appears. */
function setCartCount(){
  const el=document.getElementById('cartCount');
  const n=state.cart.length;
  el.textContent=n;
  el.dataset.count=n;
}
function addToCart(){
  const views=state.plainItem?[]:enabledPrintViews();
  const hasDesign=state.plainItem||views.some(v=>(state.layers[v.key]||[]).length);
  if(!hasDesign){ toast('Add a design first — text, logo or AI'); return; }
  const q=sizeTotal(state.sizes);
  if(q<1){ toast('Pick at least one size'); return; }
  const p=state.product, u=state.plainItem?baseUnitPrice(state.product,q):unitPrice(state.product,q,state.enabledViews);
  // JPEG, not PNG — this thumbnail is stored inside the order row, and a
  // full-size PNG of the canvas is ~10x bigger for no visible benefit.
  const thumb=captureThumb();
  // Drop empty sizes — production only needs the ones actually ordered.
  const sizes=Object.fromEntries(Object.entries(state.sizes).filter(([,n])=>+n>0));
  const layerData=Object.fromEntries(views.map(v=>[v.key,(state.layers[v.key]||[]).map(stripImg)]));
  const specs=Object.fromEntries(views.map(v=>[v.key,printSpec(v.key)]));
  const art=Object.fromEntries(views.map(v=>[v.key,capturePrintArt(v.key)]));
  state.cart.push({pid:p.id,product:p.name,qty:q,sizes,unit:u,total:u*q,shirt:state.shirtColor,
    print_views:views.map(v=>v.key), plain_item:state.plainItem,
    layers:JSON.parse(JSON.stringify(layerData)),
    // The measured print spec, and the print-ready artwork itself. Both have
    // to be captured HERE: the canvas still holds the live Image objects,
    // which stripImg() is about to drop. `_art` is held in memory only and
    // uploaded at checkout — see uploadArt() — so abandoned carts don't
    // leave orphaned files on the volume.
    spec:specs,
    _art:art,
    thumb});
  setCartCount();
  toast('Added to cart 🛒');
}
/* The cart line only needs enough to redraw a preview; the printable copy of
   an uploaded image goes to the artwork endpoint instead of into the order. */
function stripImg(L){ if(L.type==='img'){const c={...L}; delete c.img; c.note='uploaded image'; return c;} return L; }
function renderCart(){
  const el=document.getElementById('cartBody');
  if(!state.cart.length){
    el.innerHTML=`<div class="empty">
      <span class="material-symbols-outlined">shopping_bag</span><br>
      Your bag is empty.<br><br>
      <button class="btn btn-primary" onclick="go('products')">Browse products →</button></div>`;
    return;
  }
  let sub=0;
  const lines=state.cart.map((c,i)=>{ sub+=c.total; return `
    <div class="card cart-line">
      <div class="cart-thumb"><img src="${c.thumb}" alt=""></div>
      <div class="cart-meta">
        <div class="cart-name">${esc(c.product)}</div>
        <div class="cart-sub">${c.qty} pcs × ₹${c.unit.toLocaleString('en-IN')}</div>
        ${c.sizes?`<div class="size-chips">${Object.entries(c.sizes)
          .map(([k,n])=>`<span class="size-chip"><b>${n}</b>×${esc(k)}</span>`).join('')}</div>`:''}
        <button class="btn btn-quiet btn-sm" style="margin-top:12px" onclick="rmCart(${i})">
          <span class="material-symbols-outlined" style="font-size:16px">delete</span> Remove
        </button>
      </div>
      <div class="cart-line-total"><b>₹${c.total.toLocaleString('en-IN')}</b></div>
    </div>`; }).join('');

  // Per line, not on the subtotal: a cart holding a ₹599 tee and a ₹1,299
  // hoodie is taxed at both rates, and summing first would pick one.
  const g=gstFor(state.cart);
  const ship=sub>TAX.free_shipping_over?0:TAX.shipping_flat;
  // A coupon doesn't reopen which GST slab a line falls into — that's
  // decided by the per-piece tier price — so only the tax *amount* scales
  // down by the same fraction the discount takes off the subtotal. Mirrors
  // quote() in catalog.py, which is the actual authority at checkout.
  const discount=Math.min(state.promo.discount||0, sub);
  const gAmount=sub?Math.round(g.amount*(sub-discount)/sub):0;
  const tot=sub-discount+gAmount+ship;
  const away=TAX.free_shipping_over-sub;

  el.innerHTML=`<div class="cart-grid">
    <div>${lines}
      ${away>0?`<p class="t-dim" style="font-size:12px;margin-top:8px">
        Add ₹${away.toLocaleString('en-IN')} more for free shipping.</p>`:''}
      ${shipForm()}
    </div>
    <div class="card card-pad summary-card">
      <h3 class="t-label" style="margin-bottom:16px">Order summary</h3>
      ${promoBox()}
      <div class="price-line"><span>Subtotal</span><span>₹${sub.toLocaleString('en-IN')}</span></div>
      ${discount>0?`<div class="price-line"><span>Discount</span><span class="t-lime">−₹${discount.toLocaleString('en-IN')}</span></div>`:''}
      <div class="price-line"><span>${gstLabel(g.rates)}</span><span>₹${gAmount.toLocaleString('en-IN')}</span></div>
      <div class="price-line"><span>Shipping</span><span>${ship?'₹'+ship:'<span class="t-lime">FREE</span>'}</span></div>
      <div class="price-line total"><span>Total</span><span>₹${tot.toLocaleString('en-IN')}</span></div>
      ${payMethodBox()}
      <button class="btn btn-primary btn-block" style="margin-top:18px" onclick="checkout(${tot})">
        ${state.payMethod==='razorpay'
          ? `Pay ₹${tot.toLocaleString('en-IN')}`
          : `Place order · ₹${tot.toLocaleString('en-IN')}`}
      </button>
      <div class="trust">
        <span class="material-symbols-outlined" style="font-size:16px">verified_user</span>
        Digital proof in 2 hrs before printing
      </div>
      <!-- No payment gateway is wired yet, so this must not imply money is
           being taken. Reworded once Razorpay lands. -->
      <p class="t-dim" style="font-size:11px;text-align:center;margin-top:10px">
        Placing an order reserves it — we'll confirm payment with you before printing.</p>
    </div>
  </div>`;
}
function rmCart(i){ state.cart.splice(i,1); setCartCount(); renderCart(); }

/* ── Promo codes ──────────────────────────────────────────────────
   The discount shown here is a preview only — quote() in catalog.py
   recomputes it from scratch at checkout from the same {code, items}
   shape, and refuses the order if the code stopped being valid in
   between (cart changed under the minimum spend, code got used up by
   someone else, etc). This mirrors the discount math only for display;
   it is never the number that gets charged. */
state.promo = state.promo || {code:null, discount:0};

async function applyPromo(){
  const input=document.getElementById('promoInput');
  const code=(input.value||'').trim();
  const msg=document.getElementById('promoMsg');
  if(!code){ if(msg) msg.textContent='Enter a code.'; return; }
  if(msg) msg.textContent='Checking…';
  try{
    const res=await fetch(BACKEND+'/api/promo/check',{method:'POST',
      headers:{'Content-Type':'application/json'},credentials:'include',
      body:JSON.stringify({code, items:state.cart})});
    const d=await res.json();
    if(!d.ok){
      state.promo={code:null,discount:0};
      if(msg) msg.textContent=d.error||'That code is not valid.';
      return;
    }
    state.promo={code:d.code, discount:d.discount};
    toast('Promo applied — you saved ₹'+d.discount.toLocaleString('en-IN'));
    renderCart();
  }catch(err){ if(msg) msg.textContent='Could not reach the server.'; }
}
function removePromo(){ state.promo={code:null,discount:0}; renderCart(); }

function promoBox(){
  if(state.promo.code) return `
    <div class="promo-box promo-applied">
      <span><span class="material-symbols-outlined" style="font-size:16px">local_offer</span>
        <b>${esc(state.promo.code)}</b> applied</span>
      <button class="btn btn-quiet btn-sm" onclick="removePromo()">Remove</button>
    </div>`;
  return `
    <div class="promo-box">
      <div class="row" style="gap:8px">
        <input class="inp" id="promoInput" placeholder="Promo code" style="flex:1">
        <button class="btn btn-quiet btn-sm" onclick="applyPromo()">Apply</button>
      </div>
      <div id="promoMsg" class="t-dim" style="font-size:12px;margin-top:6px"></div>
    </div>`;
}

/* ── Delivery address ────────────────────────────────────────────
   Kept in state (not localStorage) and re-filled from the last order, so a
   repeat customer doesn't retype it. Nothing here is optional except line 2
   — an order with no address can't be shipped, which is exactly the hole
   this closes. */
const SHIP_FIELDS=[
  ['name','Full name','text','given-name'],
  ['phone','Mobile number','tel','tel'],
  ['line1','Flat / house / street','text','address-line1'],
  ['line2','Area, landmark (optional)','text','address-line2'],
  ['city','City','text','address-level2'],
  ['state','State','text','address-level1'],
  ['pincode','PIN code','text','postal-code'],
];
state.ship = state.ship || {name:'',phone:'',line1:'',line2:'',city:'',state:'',pincode:'',email:''};

/* No account needed to buy something — forcing signup before checkout is
   one of the biggest places a real store loses orders. A guest just needs
   an email so we have somewhere to send the confirmation; the server turns
   that into a real (passwordless) account behind the scenes — see
   get_or_create_guest() in auth.py — so "My Orders" and a password-reset
   claim it later without this page needing to know any of that. A signed-in
   customer already has an email on file, so the field only shows here. */
function shipForm(){
  const emailField = !state.user ? `
    <label class="field span2">
      <span>Email <span class="t-dim" style="font-weight:400">— for your order confirmation</span></span>
      <input id="ship_email" type="email" autocomplete="email"
             value="${esc(state.ship.email||'')}" oninput="state.ship.email=this.value">
    </label>` : '';
  return `<div class="card card-pad ship-form">
    <h3 class="t-label" style="margin-bottom:4px">Delivery address</h3>
    <p class="t-dim" style="font-size:12px;margin-bottom:16px">Where should we send the parcel?</p>
    <div class="ship-grid">${emailField}${SHIP_FIELDS.map(([k,label,type,auto])=>`
      <label class="field ${k==='line1'||k==='line2'?'span2':''}">
        <span>${label}</span>
        <input id="ship_${k}" type="${type}" autocomplete="${auto}"
               value="${esc(state.ship[k]||'')}" oninput="state.ship['${k}']=this.value"
               ${k==='pincode'?'inputmode="numeric" maxlength="6"':''}
               ${k==='phone'?'inputmode="numeric" maxlength="10"':''}>
      </label>`).join('')}</div>
  </div>`;
}

/* Mirrors _clean_shipping() in orders.py (plus the guest email check, which
   is orders.py's own get_or_create_guest()). The server is the authority —
   this exists so the customer sees the problem next to the field, not as a
   toast after a round trip. */
function validateShip(){
  const s=state.ship;
  if(!state.user && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test((s.email||'').trim()))
    return 'Enter a valid email for your order confirmation.';
  if(!(s.name||'').trim()) return 'Add the name the parcel should go to.';
  if(!/^[6-9]\d{9}$/.test((s.phone||'').trim())) return 'Enter a 10-digit Indian mobile number.';
  if(!(s.line1||'').trim()) return 'Add the street address.';
  if(!(s.city||'').trim()||!(s.state||'').trim()) return 'Add the city and state.';
  if(!/^[1-9]\d{5}$/.test((s.pincode||'').trim())) return 'Enter a valid 6-digit PIN code.';
  return null;
}

/* Push each line's print-ready PNGs to the artwork endpoint and swap the
   in-memory data URIs for URLs. Returns the order-safe cart. */
async function uploadArt(){
  const out=[];
  for(const line of state.cart){
    const {_art, ...rest}=line;
    const art={};
    for(const side of Object.keys(_art||{})){
      if(!_art||!_art[side]) continue;
      const res=await fetch(BACKEND+'/api/artwork',{method:'POST',
        headers:{'Content-Type':'application/json'},credentials:'include',
        body:JSON.stringify({data:_art[side]})});
      const d=await res.json();
      if(!d.ok) throw new Error(d.error||'Artwork upload failed');
      art[side]=d.url;
    }
    out.push({...rest, art});
  }
  return out;
}

/* Pay online or on delivery. Online is offered only when the server says
   payments are configured (PRINTLY_CATALOG.payments), so a shop without
   Razorpay keys never shows a button that can't work. */
function payMethodBox(){
  if(!(CATALOG.payments && CATALOG.payments.enabled)) return '';
  const opt=(val,label,sub)=>`
    <label class="pay-opt${state.payMethod===val?' on':''}">
      <input type="radio" name="paymethod" value="${val}" ${state.payMethod===val?'checked':''}
             onchange="setPayMethod('${val}')">
      <span><b>${label}</b><small>${sub}</small></span>
    </label>`;
  return `<div class="pay-methods">
    ${opt('razorpay','Pay online','UPI, cards, netbanking — via Razorpay')}
    ${opt('cod','Cash on delivery','Pay the courier when it arrives')}
  </div>`;
}
function setPayMethod(v){ state.payMethod=v; renderCart(); }

async function checkout(tot){
  const bad=validateShip();
  if(bad){ toast(bad); document.getElementById('ship_'+shipFieldFor(bad))?.focus(); return; }
  const btn=document.querySelector('.summary-card .btn-primary');
  if(btn){ btn.disabled=true; btn.textContent='Placing order…'; }
  try{
    const items=await uploadArt();
    const res=await fetch(BACKEND+'/api/orders',{method:'POST',headers:{'Content-Type':'application/json'},
      credentials:'include', body:JSON.stringify({items,total:tot,shipping:state.ship,
        email: state.user ? undefined : state.ship.email,
        promo_code:state.promo.code, payment_method:state.payMethod})});
    const d=await res.json();
    if(!d.ok){
      // 409 means the server priced this differently — it sends the correct
      // total back. Showing it beats a bare "prices have changed", which
      // leaves the customer with no idea what the number now is.
      if(res.status===409 && typeof d.total==='number'){
        toast(`Price updated to ₹${d.total.toLocaleString('en-IN')} — check and place again`);
      } else {
        toast(d.error||'Could not place order');
      }
      renderCart(); return;
    }
    // Online payment: the order exists but is invisible and costs nothing
    // until Razorpay confirms. Hand off to Checkout.
    if(d.requires_payment){ return payWithRazorpay(d); }
    finishOrder(d);
  }catch(err){
    toast(err&&err.message ? err.message : 'Could not reach the server — try again.');
    renderCart();
  }
}

/* Shared tail for a confirmed order, whichever way it was paid for. */
async function finishOrder(d, orderId){
  state.cart=[]; state.promo={code:null,discount:0}; setCartCount();
  const id=orderId || (d.order && d.order.id) || d.order;
  // No session refresh needed: the only thing that went stale was the
  // loyalty balance, which is no longer displayed. The points are still
  // awarded server-side and the ledger still records them.
  //
  // A guest has no session, so My Orders can't show them anything — it
  // would just land them on its "sign in to see your orders" state right
  // after they bought something, which reads as if the order vanished.
  // The order itself is real regardless (confirmation email included);
  // home is just a less confusing place to land.
  go(state.user ? 'orders' : 'home');
  toast(state.user ? 'Order '+id+' placed 🎉'
    : 'Order '+id+' placed 🎉 — a confirmation is on its way to '+(state.ship.email||'your email'));
}

/* Razorpay Checkout. The order already exists server-side as pending; this
   only decides whether it becomes real. Dismissing the modal is not an
   error — the pending order simply stays invisible and costs nothing. */
function payWithRazorpay(d){
  if(typeof Razorpay==='undefined'){
    toast('Payment library did not load — check your connection and retry');
    renderCart(); return;
  }
  const r=d.razorpay;
  const rz=new Razorpay({
    key:r.key, order_id:r.order_id, amount:r.amount, currency:r.currency,
    name:'Print Engine', description:'Order '+d.order,
    prefill:{name:state.ship.name||'', contact:state.ship.phone||'',
             email:(state.user&&state.user.email)||state.ship.email||''},
    theme:{color:'#c8f232'},
    handler: async function(resp){
      try{
        const v=await fetch(BACKEND+'/api/payments/verify',{method:'POST',
          headers:{'Content-Type':'application/json'},credentials:'include',
          body:JSON.stringify(resp)});
        const vd=await v.json();
        if(!vd.ok){ toast(vd.error||'Payment could not be verified'); renderCart(); return; }
        finishOrder({}, vd.order);
      }catch(err){
        // The webhook is the authority and will still confirm this, so
        // don't tell the customer the payment failed — it probably didn't.
        toast('Payment received — confirming your order shortly');
        go('orders');
      }
    },
    modal:{ ondismiss: function(){
      toast('Payment cancelled — your cart is still here');
      renderCart();
    }},
  });
  rz.open();
}
/* Which field to focus for a given validation message. */
function shipFieldFor(msg){
  if(msg.includes('email')) return 'email';
  if(msg.includes('name')) return 'name';
  if(msg.includes('mobile')) return 'phone';
  if(msg.includes('street')) return 'line1';
  if(msg.includes('city')) return 'city';
  return 'pincode';
}
const STAGES=['Proof sent','Approved','Printing','Quality check','Shipped','Delivered'];
function badgeFor(s){
  if(s<=1)return '<span class="badge b-early">'+STAGES[s]+'</span>';
  if(s<=3)return '<span class="badge b-mid">'+STAGES[s]+'</span>';
  return '<span class="badge b-done">'+STAGES[s]+'</span>';
}
/* Six-stage pipeline, mapped straight off orders.status — no backend change
   needed, the integer already means exactly this. */
function tracker(status){
  return `<div class="track">`+STAGES.map((s,i)=>`
    <div class="track-step ${i<status?'done':i===status?'now':''}">
      <div class="track-dot"></div>
      <div class="track-label">${s}</div>
    </div>`).join('')+`</div>`;
}

/* SQLite stores CURRENT_TIMESTAMP as UTC without a zone marker ("2026-07-25
   12:34:56"), so tag it before parsing or the browser reads it as local and
   the date can slip a day. Only add the Z when there isn't already a zone —
   appending it blindly turns a real ISO string into "...ZZ" and NaN. */
function parseUTC(s){
  const str=String(s).replace(' ','T');
  return new Date(/[Zz]|[+-]\d{2}:?\d{2}$/.test(str) ? str : str+'Z');
}
function fmtDate(s){
  const d=parseUTC(s);
  return isNaN(d) ? String(s) : d.toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'});
}
/* Relative for anything recent, absolute after a day. A support thread is
   read as a conversation — "2h ago" is what tells you whether the shop has
   actually gone quiet on you. */
function fmtWhen(s){
  const d=parseUTC(s);
  if(isNaN(d)) return String(s);
  const mins=Math.round((Date.now()-d)/60000);
  if(mins<1) return 'just now';
  if(mins<60) return mins+'m ago';
  if(mins<1440) return Math.round(mins/60)+'h ago';
  return fmtDate(s);
}
function isToday(s){
  const d=parseUTC(s);
  if(isNaN(d)) return false;
  const n=new Date();
  return d.getFullYear()===n.getFullYear() && d.getMonth()===n.getMonth() && d.getDate()===n.getDate();
}

async function renderOrders(){
  const el=document.getElementById('ordersBody');
  const stats=document.getElementById('dashStats');
  if(stats) stats.innerHTML='';
  if(!state.user){
    el.innerHTML=`<div class="empty">
      <span class="material-symbols-outlined">inventory_2</span><br>
      Sign in to see your orders.<br><br>
      <button class="btn btn-primary" onclick="openLogin()">Sign in →</button></div>`;
    return;
  }
  el.innerHTML=skeletonListCards(3);
  let orders=[];
  try{
    const res=await fetch(BACKEND+'/api/orders/mine',{credentials:'include'});
    const d=await res.json();
    if(d.ok) orders=d.orders;
  }catch(err){ el.innerHTML='<div class="empty">Could not reach the server.</div>'; return; }

  if(stats){
    // "In production" = anything past proof but not yet delivered.
    const active=orders.filter(o=>o.status<STAGES.length-1).length;
    // ⚠️ Loyalty balance is deliberately NOT shown. Points still accrue and
    // the ledger is still written — see award_points() — but there is no way
    // to spend them and no agreed policy, so showing a balance advertises a
    // reward the shop doesn't yet honour. Put this back the day redemption
    // exists; the numbers will all be there waiting.
    stats.innerHTML=`
      <div class="stat-pill"><span>In production</span><b>${String(active).padStart(2,'0')}</b></div>`;
  }

  // The help panel offers to raise a request against one of these, so it
  // needs the list — and it renders even with no orders, since "I haven't
  // received something I ordered" is exactly when the list can be empty.
  state.myOrders = orders;
  renderHelp();

  if(!orders.length){
    el.innerHTML=`<div class="empty">
      <span class="material-symbols-outlined">inventory_2</span><br>
      No orders yet.<br><br>
      <button class="btn btn-primary" onclick="go('products')">Start designing →</button></div>`;
    return;
  }

  el.innerHTML=orders.map(o=>`
    <div class="card order-card">
      <div class="order-top">
        <span class="order-id">${esc(o.id)}</span>
        ${badgeFor(o.status)}
        <span class="order-total">₹${o.total.toLocaleString('en-IN')}</span>
      </div>
      <div class="t-dim" style="font-size:12px">
        Placed ${fmtDate(o.created)} · ${o.items.length} item${o.items.length===1?'':'s'}
      </div>
      ${o.items.filter(it=>it&&it.sizes).map(it=>
        `<div class="t-mut" style="font-size:12px;margin-top:6px">
           ${esc(it.product||'')} — ${esc(sizeSummary(it.sizes))}</div>`).join('')}
      ${tracker(o.status)}
    </div>`).join('');
}
