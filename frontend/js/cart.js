/* ═══════════════ PRICING ═══════════════ */
function unitPrice(p,q){
  let u=p.tiers[0][1];
  p.tiers.forEach(([min,pr])=>{ if(q>=min)u=pr; });
  return u;
}
/* Render the per-size steppers. These ARE the quantity input — the total
   is derived from them, so there's no second control that can disagree. */
function renderSizeGrid(){
  const el=document.getElementById('sizeGrid'); if(!el) return;
  const keys=sizeKeys(state.product.id);
  el.innerHTML=keys.map(k=>`
    <div class="size-row">
      <span class="size-key">${esc(k)}</span>
      <button class="size-step" onclick="bumpSize('${esc(k)}',-1)" aria-label="Fewer ${esc(k)}">−</button>
      <input class="size-num" type="number" min="0" max="9999" inputmode="numeric"
             value="${state.sizes[k]||0}" oninput="setSize('${esc(k)}',this.value)" aria-label="${esc(k)} quantity">
      <button class="size-step" onclick="bumpSize('${esc(k)}',1)" aria-label="More ${esc(k)}">+</button>
    </div>`).join('');
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
/* Reset the breakdown when the product changes, since size keys differ
   (a tote has no S/M/L). Carries the existing total over. */
function resetSizesForProduct(){
  const keys=sizeKeys(state.product.id);
  const existing=Object.keys(state.sizes);
  const sameShape = existing.length===keys.length && keys.every(k=>k in state.sizes);
  if(!sameShape) state.sizes=newSizeBreakdown(state.product.id, sizeTotal(state.sizes)||25);
  renderSizeGrid();
}

function updatePrice(){
  const q=sizeTotal(state.sizes);
  document.getElementById('qtyLabel').textContent=q;
  const p=state.product, u=unitPrice(p,Math.max(1,q)), sub=u*q;
  const gst=Math.round(sub*0.05), ship=q>=50?0:99, tot=sub+gst+ship;
  document.getElementById('priceBox').innerHTML=`
    <div class="price-line"><span>Unit price</span><span>₹${u.toLocaleString('en-IN')}</span></div>
    <div class="price-line"><span>${esc(p.name)} × ${q}</span><span>₹${sub.toLocaleString('en-IN')}</span></div>
    <div class="price-line"><span>GST 5%</span><span>₹${gst.toLocaleString('en-IN')}</span></div>
    <div class="price-line"><span>Shipping</span><span>${ship===0?'<span class="t-lime">FREE</span>':'₹'+ship}</span></div>
    <div class="price-line total"><span>Total</span><span>₹${tot.toLocaleString('en-IN')}</span></div>`;
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
  const hasDesign=state.layers.front.length||state.layers.back.length;
  if(!hasDesign){ toast('Add a design first — text, logo or AI'); return; }
  const q=sizeTotal(state.sizes);
  if(q<1){ toast('Pick at least one size'); return; }
  const p=state.product, u=unitPrice(p,q);
  // JPEG, not PNG — this thumbnail is stored inside the order row, and a
  // full-size PNG of the canvas is ~10x bigger for no visible benefit.
  const thumb=captureThumb();
  // Drop empty sizes — production only needs the ones actually ordered.
  const sizes=Object.fromEntries(Object.entries(state.sizes).filter(([,n])=>+n>0));
  state.cart.push({pid:p.id,product:p.name,qty:q,sizes,unit:u,total:u*q,shirt:state.shirtColor,
    layers:JSON.parse(JSON.stringify({front:state.layers.front.map(stripImg),back:state.layers.back.map(stripImg)})),
    // The measured print spec, and the print-ready artwork itself. Both have
    // to be captured HERE: the canvas still holds the live Image objects,
    // which stripImg() is about to drop. `_art` is held in memory only and
    // uploaded at checkout — see uploadArt() — so abandoned carts don't
    // leave orphaned files on the volume.
    spec:{front:printSpec('front'), back:printSpec('back')},
    _art:{front:capturePrintArt('front'), back:capturePrintArt('back')},
    thumb});
  setCartCount();
  toast('Added to cart 🛒');
}
/* The cart line only needs enough to redraw a preview; the printable copy of
   an uploaded image goes to the artwork endpoint instead of into the order. */
function stripImg(L){ if(L.type==='img'){const c={...L}; delete c.img; c.note='uploaded image'; return c;} return L; }
const FREE_SHIP_OVER=10000;
function renderCart(){
  const el=document.getElementById('cartBody');
  if(!state.cart.length){
    el.innerHTML=`<div class="empty">
      <span class="material-symbols-outlined">shopping_bag</span><br>
      Your bag is empty.<br><br>
      <button class="btn btn-primary" onclick="go('studio')">Design something →</button></div>`;
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

  const gst=Math.round(sub*.05), ship=sub>FREE_SHIP_OVER?0:99, tot=sub+gst+ship;
  const away=FREE_SHIP_OVER-sub;

  el.innerHTML=`<div class="cart-grid">
    <div>${lines}
      ${away>0?`<p class="t-dim" style="font-size:12px;margin-top:8px">
        Add ₹${away.toLocaleString('en-IN')} more for free shipping.</p>`:''}
      ${shipForm()}
    </div>
    <div class="card card-pad summary-card">
      <h3 class="t-label" style="margin-bottom:16px">Order summary</h3>
      <div class="price-line"><span>Subtotal</span><span>₹${sub.toLocaleString('en-IN')}</span></div>
      <div class="price-line"><span>GST 5%</span><span>₹${gst.toLocaleString('en-IN')}</span></div>
      <div class="price-line"><span>Shipping</span><span>${ship?'₹'+ship:'<span class="t-lime">FREE</span>'}</span></div>
      <div class="price-line total"><span>Total</span><span>₹${tot.toLocaleString('en-IN')}</span></div>
      <button class="btn btn-primary btn-block" style="margin-top:18px" onclick="checkout(${tot})">
        Place order · ₹${tot.toLocaleString('en-IN')}
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
state.ship = state.ship || {name:'',phone:'',line1:'',line2:'',city:'',state:'',pincode:''};

function shipForm(){
  return `<div class="card card-pad ship-form">
    <h3 class="t-label" style="margin-bottom:4px">Delivery address</h3>
    <p class="t-dim" style="font-size:12px;margin-bottom:16px">Where should we send the parcel?</p>
    <div class="ship-grid">${SHIP_FIELDS.map(([k,label,type,auto])=>`
      <label class="field ${k==='line1'||k==='line2'?'span2':''}">
        <span>${label}</span>
        <input id="ship_${k}" type="${type}" autocomplete="${auto}"
               value="${esc(state.ship[k]||'')}" oninput="state.ship['${k}']=this.value"
               ${k==='pincode'?'inputmode="numeric" maxlength="6"':''}
               ${k==='phone'?'inputmode="numeric" maxlength="10"':''}>
      </label>`).join('')}</div>
  </div>`;
}

/* Mirrors _clean_shipping() in orders.py. The server is the authority — this
   exists so the customer sees the problem next to the field, not as a toast
   after a round trip. */
function validateShip(){
  const s=state.ship;
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
    for(const side of ['front','back']){
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

async function checkout(tot){
  if(!state.user){ openLogin(); toast('Sign in to place your order'); return; }
  const bad=validateShip();
  if(bad){ toast(bad); document.getElementById('ship_'+shipFieldFor(bad))?.focus(); return; }
  const btn=document.querySelector('.summary-card .btn-primary');
  if(btn){ btn.disabled=true; btn.textContent='Placing order…'; }
  try{
    const items=await uploadArt();
    const res=await fetch(BACKEND+'/api/orders',{method:'POST',headers:{'Content-Type':'application/json'},
      credentials:'include', body:JSON.stringify({items,total:tot,shipping:state.ship})});
    const d=await res.json();
    if(!d.ok){ toast(d.error||'Could not place order'); renderCart(); return; }
    state.cart=[]; setCartCount();
    // Loyalty points are awarded server-side, so the cached user is now
    // stale — refresh it before the orders page reads the balance.
    if(d.points_earned) await checkSession();
    go('orders');
    toast('Order '+d.order.id+' placed'+(d.points_earned?` · +${d.points_earned} points`:'')+' 🎉');
  }catch(err){
    toast(err&&err.message ? err.message : 'Could not reach the server — try again.');
    renderCart();
  }
}
/* Which field to focus for a given validation message. */
function shipFieldFor(msg){
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
  el.innerHTML='<div class="empty">Loading…</div>';
  let orders=[];
  try{
    const res=await fetch(BACKEND+'/api/orders/mine',{credentials:'include'});
    const d=await res.json();
    if(d.ok) orders=d.orders;
  }catch(err){ el.innerHTML='<div class="empty">Could not reach the server.</div>'; return; }

  if(stats){
    // "In production" = anything past proof but not yet delivered.
    const active=orders.filter(o=>o.status<STAGES.length-1).length;
    stats.innerHTML=`
      <div class="stat-pill"><span>In production</span><b>${String(active).padStart(2,'0')}</b></div>
      <div class="stat-pill"><span>Loyalty points</span><b>${(state.user.loyalty_points||0).toLocaleString('en-IN')}</b></div>`;
  }

  if(!orders.length){
    el.innerHTML=`<div class="empty">
      <span class="material-symbols-outlined">inventory_2</span><br>
      No orders yet.<br><br>
      <button class="btn btn-primary" onclick="go('studio')">Start designing →</button></div>`;
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
