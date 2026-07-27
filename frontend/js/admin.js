/* ═══════════════ ADMIN — ORDER PIPELINE ═══════════════
   Two levels: a filterable list (cheap — the API sends summaries only), and
   a detail drawer fetched per order that carries the heavy payload, the
   delivery address, the print spec and the audit trail.

   Everything destructive goes through the API, which re-checks the admin
   role on every call — hiding a button here is presentation, not security. */

const adminState = { orders:[], q:'', stage:'all', showCancelled:false, open:null };

async function renderAdmin(){
  const el=document.getElementById('adminBody');
  if(!adminState.orders.length) el.innerHTML='<div class="empty">Loading…</div>';
  try{
    const res=await fetch(BACKEND+'/api/admin/orders',{credentials:'include'});
    if(res.status===401||res.status===403){
      el.innerHTML='<div class="empty"><span class="material-symbols-outlined">lock</span><br>Admin access required.</div>';
      return;
    }
    const d=await res.json();
    adminState.orders = d.ok ? d.orders : [];
  }catch(err){ el.innerHTML='<div class="empty">Could not reach the server.</div>'; return; }
  paintAdmin();
}

function adminVisible(){
  const q=adminState.q.trim().toLowerCase();
  return adminState.orders.filter(o=>{
    if(o.cancelled && !adminState.showCancelled) return false;
    if(adminState.stage!=='all' && !o.cancelled && o.status!==+adminState.stage) return false;
    if(adminState.stage!=='all' && o.cancelled) return false;
    if(!q) return true;
    return (o.id+' '+o.customer+' '+o.customer_email+' '+(o.shipping.city||'')+' '+
            (o.shipping.pincode||'')+' '+o.lines.map(l=>l.product||'').join(' ')
           ).toLowerCase().includes(q);
  });
}

function paintAdmin(){
  const el=document.getElementById('adminBody');
  const all=adminState.orders;
  const live=all.filter(o=>!o.cancelled);
  const inProd=live.filter(o=>o.status>0&&o.status<STAGES.length-1).length;
  const today=live.filter(o=>isToday(o.created)).length;
  // Cancelled orders are excluded: counting money you've agreed not to take
  // makes the number a vanity metric rather than a figure you can act on.
  const revenue=live.reduce((s,o)=>s+o.total,0);
  const cancelled=all.length-live.length;

  const rows=adminVisible();
  el.innerHTML=`
    <div class="grid grid-4 admin-stats">
      <div class="stat-pill"><span>Orders today</span><b>${today}</b></div>
      <div class="stat-pill"><span>In production</span><b>${inProd}</b></div>
      <div class="stat-pill"><span>Live value</span><b>₹${revenue.toLocaleString('en-IN')}</b></div>
      <div class="stat-pill"><span>Cancelled</span><b>${cancelled}</b></div>
    </div>

    <div class="admin-bar">
      <label class="field admin-search">
        <span class="material-symbols-outlined">search</span>
        <input id="admQ" type="text" placeholder="Order, customer, city, PIN or product"
               value="${esc(adminState.q)}" oninput="admSearch(this.value)">
      </label>
      <div class="chip-row">
        <button class="chip ${adminState.stage==='all'?'on':''}" onclick="admStage('all')">All</button>
        ${STAGES.map((s,i)=>`<button class="chip ${adminState.stage===String(i)?'on':''}"
          onclick="admStage('${i}')">${esc(s)}</button>`).join('')}
        <button class="chip ${adminState.showCancelled?'on':''}" onclick="admToggleCancelled()">
          Cancelled${cancelled?' · '+cancelled:''}</button>
      </div>
    </div>

    ${!all.length ? `<div class="empty"><span class="material-symbols-outlined">print</span><br>
        No orders in the pipeline yet.<br>Orders placed from the cart appear here.</div>`
     : !rows.length ? `<div class="empty">No orders match that filter.</div>`
     : `<table class="table">
      <thead><tr><th>Order</th><th>Customer</th><th>To print</th><th>Deliver to</th>
                 <th>Total</th><th>Stage</th><th></th></tr></thead>
      <tbody>`+rows.map(o=>`<tr class="${o.cancelled?'row-off':''}">
        <td data-label="Order"><span><b>${esc(o.id)}</b><br>
          <span class="t-dim" style="font-size:11px">${fmtDate(o.created)}</span></span></td>
        <td data-label="Customer"><span>${esc(o.customer)}<br>
          <span class="t-dim" style="font-size:11px">${esc(o.customer_email||'')}</span></span></td>
        <td data-label="To print"><span>${o.lines.map(l=>
            `${esc(l.product||'item')}<br><span class="t-lime" style="font-size:11px">${
              l.sizes ? esc(sizeSummary(l.sizes)) : (l.qty||'?')+' pcs (no size recorded)'}</span>`
          ).join('<br>')}</span></td>
        <td data-label="Deliver to"><span>${o.shipping.recorded
            ? esc(o.shipping.city)+'<br><span class="t-dim" style="font-size:11px">'+esc(o.shipping.pincode)+'</span>'
            : '<span class="t-dim" style="font-size:11px">no address recorded</span>'}</span></td>
        <td data-label="Total"><b>₹${o.total.toLocaleString('en-IN')}</b></td>
        <td data-label="Stage">${o.cancelled?'<span class="badge b-off">Cancelled</span>':badgeFor(o.status)}</td>
        <td data-label=""><button class="btn btn-quiet btn-sm" onclick="admOpen('${esc(o.id)}')">Open</button></td>
      </tr>`).join('')+'</tbody></table>'}

    <div class="drawer-scrim ${adminState.open?'on':''}" onclick="admClose()"></div>
    <aside class="drawer ${adminState.open?'on':''}" id="admDrawer"></aside>`;
}

function admSearch(v){ adminState.q=v; paintAdmin(); document.getElementById('admQ').focus(); }
function admStage(s){ adminState.stage=s; if(s!=='all') adminState.showCancelled=false; paintAdmin(); }
function admToggleCancelled(){
  adminState.showCancelled=!adminState.showCancelled;
  if(adminState.showCancelled) adminState.stage='all';
  paintAdmin();
}

/* ── Detail drawer ─────────────────────────────────────────────── */
async function admOpen(id){
  adminState.open=id; paintAdmin();
  const box=document.getElementById('admDrawer');
  box.innerHTML='<div class="empty">Loading…</div>';
  try{
    const res=await fetch(BACKEND+'/api/admin/orders/'+encodeURIComponent(id),{credentials:'include'});
    const d=await res.json();
    if(!d.ok){ box.innerHTML='<div class="empty">'+esc(d.error||'Not found')+'</div>'; return; }
    box.innerHTML=drawerHtml(d.order);
  }catch(err){ box.innerHTML='<div class="empty">Could not reach the server.</div>'; }
}
function admClose(){ adminState.open=null; paintAdmin(); }

function addressHtml(s){
  if(!s.recorded) return `<p class="t-dim" style="font-size:13px">
    No address recorded — this order was placed before delivery details were collected.
    Contact the customer before printing.</p>`;
  const lines=[s.line1,s.line2,`${s.city}, ${s.state} ${s.pincode}`].filter(Boolean);
  return `<div class="addr">
    <b>${esc(s.name)}</b>
    <a href="tel:${esc(s.phone)}">${esc(s.phone)}</a>
    ${lines.map(l=>`<span>${esc(l)}</span>`).join('')}
    <button class="btn btn-quiet btn-sm" onclick="admCopyAddr(this)"
      data-addr="${esc(s.name+'\n'+s.phone+'\n'+lines.join('\n'))}">
      <span class="material-symbols-outlined" style="font-size:16px">content_copy</span> Copy</button>
  </div>`;
}
function admCopyAddr(btn){
  navigator.clipboard.writeText(btn.dataset.addr).then(()=>toast('Address copied'));
}

/* Per-side print instructions. `spec` is measured in the studio at
   add-to-cart time — see printSpec() — because only the canvas knows the
   px-per-cm ratio for that product's print area. */
function specHtml(side, spec, artUrl){
  if(!spec) return '';
  return `<div class="spec">
    <div class="spec-head">
      <b>${side==='front'?'Front':'Back'}</b>
      <span class="t-dim">print zone ${spec.zone.w} × ${spec.zone.h} cm</span>
      ${artUrl?`<a class="btn btn-primary btn-sm" href="${esc(artUrl)}" download>
        <span class="material-symbols-outlined" style="font-size:16px">download</span> Artwork</a>`
       :`<span class="t-dim" style="font-size:11px">no print file</span>`}
    </div>
    ${spec.layers.map(l=>`<div class="spec-row ${l.cropped?'bad':''}">
      <span class="spec-kind">${l.kind==='text'?'Text':'Graphic'}</span>
      <span>${l.kind==='text'
        ? `“${esc(l.text||'')}” · ${esc(l.font||'')} · <span class="swatch" style="background:${esc(l.color||'#000')}"></span>${esc(l.color||'')}`
        : 'uploaded / generated image'}</span>
      <span><b>${l.w} × ${l.h}</b> cm</span>
      <span class="t-dim">${l.fromTop} cm from top · ${l.fromLeft} cm from left</span>
      ${l.cropped?'<span class="badge b-pink">Extends past print area</span>':''}
    </div>`).join('')}
  </div>`;
}

const EVENT_LABEL={placed:'Order placed',stage:'Stage changed',cancelled:'Cancelled',
                   restored:'Restored',note:'Note'};

function drawerHtml(o){
  const items=Array.isArray(o.items)?o.items:[];
  return `
  <div class="drawer-head">
    <div>
      <h2 class="t-h3">${esc(o.id)}</h2>
      <span class="t-dim" style="font-size:12px">Placed ${fmtDate(o.created)}</span>
    </div>
    ${o.cancelled?'<span class="badge b-off">Cancelled</span>':badgeFor(o.status)}
    <button class="icon-btn" onclick="admClose()" aria-label="Close">
      <span class="material-symbols-outlined">close</span></button>
  </div>

  <div class="drawer-body">
    <section>
      <h3 class="t-label">Stage</h3>
      ${o.cancelled
        ? `<p class="t-dim" style="font-size:13px">Restore this order to change its stage.</p>`
        : `<div class="chip-row">${STAGES.map((s,i)=>`
            <button class="chip ${o.status===i?'on':''}" onclick="admSetStage('${esc(o.id)}',${i})">
              ${esc(s)}</button>`).join('')}</div>
           <p class="t-dim" style="font-size:11px;margin-top:8px">
             Moves in either direction. Every change is recorded below.</p>`}
    </section>

    <section>
      <h3 class="t-label">Customer</h3>
      <p style="font-size:14px">${esc(o.customer)}<br>
        <a href="mailto:${esc(o.customer_email||'')}" class="t-lime">${esc(o.customer_email||'')}</a></p>
    </section>

    <section>
      <h3 class="t-label">Deliver to</h3>
      ${addressHtml(o.shipping)}
    </section>

    <section>
      <h3 class="t-label">To print</h3>
      ${items.map(it=>`
        <div class="ord-line">
          <div class="ord-line-top">
            ${it.thumb?`<img class="ord-thumb" src="${esc(it.thumb)}" alt="">`:''}
            <div>
              <b>${esc(it.product||'item')}</b>
              <div class="t-dim" style="font-size:12px">
                Garment colour <span class="swatch" style="background:${esc(it.shirt||'#fff')}"></span>${esc(it.shirt||'')}
              </div>
              <div class="size-chips" style="margin-top:8px">${
                it.sizes ? Object.entries(it.sizes).map(([k,n])=>
                  `<span class="size-chip"><b>${n}</b>×${esc(k)}</span>`).join('')
                : '<span class="t-dim" style="font-size:12px">'+(it.qty||'?')+' pcs (no size recorded)</span>'}</div>
            </div>
            <b style="margin-left:auto">₹${(it.total||0).toLocaleString('en-IN')}</b>
          </div>
          ${specHtml('front', it.spec&&it.spec.front, it.art&&it.art.front)}
          ${specHtml('back',  it.spec&&it.spec.back,  it.art&&it.art.back)}
          ${!it.spec?`<p class="t-dim" style="font-size:12px">
            No print spec recorded — placed before artwork capture existed.</p>`:''}
        </div>`).join('')}
      <div class="ord-total"><span>Order total</span><b>₹${o.total.toLocaleString('en-IN')}</b></div>
    </section>

    <section>
      <h3 class="t-label">History</h3>
      <ul class="timeline">${(o.events||[]).map(e=>`
        <li>
          <b>${esc(EVENT_LABEL[e.kind]||e.kind)}</b>
          ${e.kind==='stage'?`<span class="t-mut">${esc(STAGES[e.from]||'—')} → ${esc(STAGES[e.to]||'—')}</span>`:''}
          ${e.note?`<span class="t-mut">${esc(e.note)}</span>`:''}
          <span class="t-dim">${fmtDate(e.created)}${e.actor?' · '+esc(e.actor):''}</span>
        </li>`).join('')||'<li class="t-dim">Nothing recorded yet.</li>'}</ul>
      <div class="note-row">
        <input id="admNote" type="text" placeholder="Add an internal note…"
               onkeydown="if(event.key==='Enter')admAddNote('${esc(o.id)}')">
        <button class="btn btn-quiet btn-sm" onclick="admAddNote('${esc(o.id)}')">Add</button>
      </div>
    </section>

    <section>
      ${o.cancelled
        ? `<button class="btn btn-primary btn-block" onclick="admCancel('${esc(o.id)}',true)">
             Restore order</button>`
        : `<button class="btn btn-danger btn-block" onclick="admCancel('${esc(o.id)}',false)">
             Cancel order</button>
           <p class="t-dim" style="font-size:11px;margin-top:8px">
             Keeps the order and its stage on record — it just stops counting
             as live work. Reversible.</p>`}
    </section>
  </div>`;
}

/* ── Actions ───────────────────────────────────────────────────── */
async function admPost(url, body){
  const res=await fetch(BACKEND+url,{method:'POST',
    headers:{'Content-Type':'application/json'},credentials:'include',
    body:JSON.stringify(body||{})});
  return res.json();
}
async function admSetStage(id, to){
  const d=await admPost('/api/admin/orders/'+encodeURIComponent(id)+'/status',{to});
  if(!d.ok){ toast(d.error||'Could not change the stage'); return; }
  toast(id+' → '+STAGES[to]);
  await renderAdmin(); await admOpen(id);
}
async function admCancel(id, restore){
  if(!restore && !confirm('Cancel '+id+'? It stays on record and can be restored.')) return;
  const d=await admPost('/api/admin/orders/'+encodeURIComponent(id)+'/cancel',{restore});
  if(!d.ok){ toast(d.error||'Could not update the order'); return; }
  toast(restore?id+' restored':id+' cancelled');
  await renderAdmin(); await admOpen(id);
}
async function admAddNote(id){
  const box=document.getElementById('admNote');
  const note=(box.value||'').trim();
  if(!note) return;
  const d=await admPost('/api/admin/orders/'+encodeURIComponent(id)+'/note',{note});
  if(!d.ok){ toast(d.error||'Could not save the note'); return; }
  await admOpen(id);
}
