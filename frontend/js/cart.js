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
    <div class="price-line"><span>${p.name} × ${q}</span><b>₹${sub.toLocaleString('en-IN')}</b></div>
    <div class="price-line"><span>Unit price</span><span>₹${u}</span></div>
    <div class="price-line"><span>GST 5%</span><span>₹${gst.toLocaleString('en-IN')}</span></div>
    <div class="price-line"><span>Shipping</span><span>${ship===0?'FREE':'₹'+ship}</span></div>
    <div class="price-line total"><span>Total</span><span>₹${tot.toLocaleString('en-IN')}</span></div>`;
}

/* ═══════════════ CART & ORDERS ═══════════════ */
function addToCart(){
  const hasDesign=state.layers.front.length||state.layers.back.length;
  if(!hasDesign){ toast('Add a design first — text, logo or AI'); return; }
  const q=+document.getElementById('qtyRange').value;
  const p=state.product, u=unitPrice(p,q);
  const thumb=cv.toDataURL('image/png');
  state.cart.push({product:p.name,qty:q,unit:u,total:u*q,shirt:state.shirtColor,
    layers:JSON.parse(JSON.stringify({front:state.layers.front.map(stripImg),back:state.layers.back.map(stripImg)})),
    thumb});
  document.getElementById('cartCount').textContent=state.cart.length;
  toast('Added to cart 🛒');
}
function stripImg(L){ if(L.type==='img'){const c={...L}; delete c.img; c.note='uploaded image'; return c;} return L; }
function renderCart(){
  const el=document.getElementById('cartBody');
  if(!state.cart.length){ el.innerHTML='<div class="empty"><div class="big">🛒</div>Your cart is empty.<br><br><button class="cta" onclick="go(\'studio\')">Design something →</button></div>'; return; }
  let sub=0;
  let rows=state.cart.map((c,i)=>{ sub+=c.total; return `
    <tr>
      <td><img src="${c.thumb}" style="width:64px;border-radius:8px;border:1px solid var(--line)"></td>
      <td><b>${c.product}</b><br><span style="font-size:12px;color:var(--mut)">${c.qty} pcs × ₹${c.unit}</span></td>
      <td><b>₹${c.total.toLocaleString('en-IN')}</b></td>
      <td><button class="sbtn small ghosty" style="width:auto;padding:6px 10px" onclick="rmCart(${i})">Remove</button></td>
    </tr>`; }).join('');
  const gst=Math.round(sub*.05), ship=sub>10000?0:99, tot=sub+gst+ship;
  el.innerHTML=`<table class="table"><tr><th>Preview</th><th>Item</th><th>Amount</th><th></th></tr>${rows}</table>
    <div class="panel" style="max-width:360px;margin-left:auto;margin-top:16px">
      <div class="price-line"><span>Subtotal</span><b>₹${sub.toLocaleString('en-IN')}</b></div>
      <div class="price-line"><span>GST 5%</span><span>₹${gst.toLocaleString('en-IN')}</span></div>
      <div class="price-line"><span>Shipping</span><span>${ship?'₹'+ship:'FREE'}</span></div>
      <div class="price-line total"><span>Total</span><span>₹${tot.toLocaleString('en-IN')}</span></div>
      <button class="sbtn orange" style="margin-top:12px" onclick="checkout(${tot})">Place order (Pay ₹${tot.toLocaleString('en-IN')})</button>
      <p style="font-size:11px;color:var(--mut);margin-top:8px">Production: UPI / card via Razorpay. Digital proof in 2 hrs before printing.</p>
    </div>`;
}
function rmCart(i){ state.cart.splice(i,1); document.getElementById('cartCount').textContent=state.cart.length; renderCart(); }
async function checkout(tot){
  if(!state.user){ openLogin(); toast('Sign in to place your order'); return; }
  try{
    const res=await fetch(BACKEND+'/api/orders',{method:'POST',headers:{'Content-Type':'application/json'},
      credentials:'include', body:JSON.stringify({items:state.cart,total:tot})});
    const d=await res.json();
    if(!d.ok){ toast(d.error||'Could not place order'); return; }
    state.cart=[]; document.getElementById('cartCount').textContent=0;
    go('orders'); toast('Order '+d.order.id+' placed! Proof coming in 2 hrs 🎉');
  }catch(err){ toast('Could not reach the server — try again.'); }
}
const STAGES=['Proof sent','Approved','Printing','Quality check','Shipped','Delivered'];
function badgeFor(s){
  if(s<=1)return '<span class="badge b-gold">'+STAGES[s]+'</span>';
  if(s<=3)return '<span class="badge b-org">'+STAGES[s]+'</span>';
  return '<span class="badge b-ok">'+STAGES[s]+'</span>';
}
async function renderOrders(){
  const el=document.getElementById('ordersBody');
  if(!state.user){ el.innerHTML='<div class="empty"><div class="big">📦</div>Sign in to see your orders.<br><br><button class="cta" onclick="openLogin()">Sign in →</button></div>'; return; }
  el.innerHTML='<div class="empty">Loading…</div>';
  let orders=[];
  try{
    const res=await fetch(BACKEND+'/api/orders/mine',{credentials:'include'});
    const d=await res.json();
    if(d.ok) orders=d.orders;
  }catch(err){ el.innerHTML='<div class="empty">Could not reach the server.</div>'; return; }
  if(!orders.length){ el.innerHTML='<div class="empty"><div class="big">📦</div>No orders yet.</div>'; return; }
  el.innerHTML='<table class="table"><tr><th>Order</th><th>Date</th><th>Items</th><th>Total</th><th>Status</th></tr>'+
    orders.map(o=>`<tr><td><b>${o.id}</b></td><td>${new Date(o.created).toLocaleDateString('en-IN')}</td><td>${o.items.length}</td>
      <td>₹${o.total.toLocaleString('en-IN')}</td><td>${badgeFor(o.status)}</td></tr>`).join('')+'</table>';
}
async function renderAdmin(){
  const el=document.getElementById('adminBody');
  el.innerHTML='<div class="empty">Loading…</div>';
  let orders=[];
  try{
    const res=await fetch(BACKEND+'/api/admin/orders',{credentials:'include'});
    if(res.status===401||res.status===403){ el.innerHTML='<div class="empty"><div class="big">🔒</div>Admin access required.</div>'; return; }
    const d=await res.json();
    if(d.ok) orders=d.orders;
  }catch(err){ el.innerHTML='<div class="empty">Could not reach the server.</div>'; return; }
  if(!orders.length){ el.innerHTML='<div class="empty"><div class="big">🖨️</div>No orders in the pipeline yet.<br>Orders placed from the cart appear here.</div>'; return; }
  el.innerHTML='<table class="table"><tr><th>Order</th><th>Customer</th><th>Total</th><th>Stage</th><th>Action</th></tr>'+
    orders.map(o=>`<tr><td><b>${o.id}</b></td><td>${o.customer}</td>
      <td>₹${o.total.toLocaleString('en-IN')}</td><td>${badgeFor(o.status)}</td>
      <td>${o.status<STAGES.length-1?`<button class="sbtn small" style="width:auto;padding:6px 12px" onclick="advance('${o.id}')">→ ${STAGES[o.status+1]}</button>`:'✅ Done'}</td></tr>`).join('')+'</table>';
}
async function advance(orderId){
  try{
    const res=await fetch(BACKEND+'/api/admin/orders/'+orderId+'/advance',{method:'POST',credentials:'include'});
    const d=await res.json();
    if(!d.ok){ toast(d.error||'Could not advance order'); return; }
    renderAdmin(); toast(d.order.id+' → '+STAGES[d.order.status]);
  }catch(err){ toast('Could not reach the server — try again.'); }
}
