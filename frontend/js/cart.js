/* ═══════════════ PRICING ═══════════════ */
function unitPrice(p,q){
  let u=p.tiers[0][1];
  p.tiers.forEach(([min,pr])=>{ if(q>=min)u=pr; });
  return u;
}
function updatePrice(){
  const q=+document.getElementById('qtyRange').value;
  document.getElementById('qtyLabel').textContent=q;
  const p=state.product, u=unitPrice(p,q), sub=u*q;
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
  const q=+document.getElementById('qtyRange').value;
  const p=state.product, u=unitPrice(p,q);
  // JPEG, not PNG — this thumbnail is stored inside the order row, and a
  // full-size PNG of the canvas is ~10x bigger for no visible benefit.
  const thumb=captureThumb();
  state.cart.push({pid:p.id,product:p.name,qty:q,unit:u,total:u*q,shirt:state.shirtColor,
    layers:JSON.parse(JSON.stringify({front:state.layers.front.map(stripImg),back:state.layers.back.map(stripImg)})),
    thumb});
  setCartCount();
  toast('Added to cart 🛒');
}
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
async function checkout(tot){
  if(!state.user){ openLogin(); toast('Sign in to place your order'); return; }
  try{
    const res=await fetch(BACKEND+'/api/orders',{method:'POST',headers:{'Content-Type':'application/json'},
      credentials:'include', body:JSON.stringify({items:state.cart,total:tot})});
    const d=await res.json();
    if(!d.ok){ toast(d.error||'Could not place order'); return; }
    state.cart=[]; setCartCount();
    // Loyalty points are awarded server-side, so the cached user is now
    // stale — refresh it before the orders page reads the balance.
    if(d.points_earned) await checkSession();
    go('orders');
    toast('Order '+d.order.id+' placed'+(d.points_earned?` · +${d.points_earned} points`:'')+' 🎉');
  }catch(err){ toast('Could not reach the server — try again.'); }
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
      ${tracker(o.status)}
    </div>`).join('');
}
async function renderAdmin(){
  const el=document.getElementById('adminBody');
  el.innerHTML='<div class="empty">Loading…</div>';
  let orders=[];
  try{
    const res=await fetch(BACKEND+'/api/admin/orders',{credentials:'include'});
    if(res.status===401||res.status===403){ el.innerHTML='<div class="empty"><span class="material-symbols-outlined">lock</span><br>Admin access required.</div>'; return; }
    const d=await res.json();
    if(d.ok) orders=d.orders;
  }catch(err){ el.innerHTML='<div class="empty">Could not reach the server.</div>'; return; }
  if(!orders.length){ el.innerHTML='<div class="empty"><span class="material-symbols-outlined">print</span><br>No orders in the pipeline yet.<br>Orders placed from the cart appear here.</div>'; return; }

  const inProd=orders.filter(o=>o.status>0&&o.status<STAGES.length-1).length;
  const today=orders.filter(o=>isToday(o.created)).length;
  const revenue=orders.reduce((s,o)=>s+o.total,0);

  el.innerHTML=`
    <div class="grid grid-3" style="margin-bottom:28px;max-width:640px">
      <div class="stat-pill"><span>Orders today</span><b>${today}</b></div>
      <div class="stat-pill"><span>In production</span><b>${inProd}</b></div>
      <div class="stat-pill"><span>Total value</span><b>₹${revenue.toLocaleString('en-IN')}</b></div>
    </div>
    <table class="table">
      <thead><tr><th>Order</th><th>Customer</th><th>Total</th><th>Stage</th><th>Action</th></tr></thead>
      <tbody>`+
    orders.map(o=>`<tr>
      <td data-label="Order"><span><b>${esc(o.id)}</b><br><span class="t-dim" style="font-size:11px">${fmtDate(o.created)}</span></span></td>
      <td data-label="Customer"><span>${esc(o.customer)}<br><span class="t-dim" style="font-size:11px">${esc(o.customer_email||'')}</span></span></td>
      <td data-label="Total"><b>₹${o.total.toLocaleString('en-IN')}</b></td>
      <td data-label="Stage">${badgeFor(o.status)}</td>
      <td data-label="Action">${o.status<STAGES.length-1
        ? `<button class="btn btn-primary btn-sm" onclick="advance('${o.id}')">→ ${STAGES[o.status+1]}</button>`
        : '<span class="badge b-done">Done</span>'}</td>
    </tr>`).join('')+'</tbody></table>';
}
async function advance(orderId){
  try{
    const res=await fetch(BACKEND+'/api/admin/orders/'+orderId+'/advance',{method:'POST',credentials:'include'});
    const d=await res.json();
    if(!d.ok){ toast(d.error||'Could not advance order'); return; }
    renderAdmin(); toast(d.order.id+' → '+STAGES[d.order.status]);
  }catch(err){ toast('Could not reach the server — try again.'); }
}
