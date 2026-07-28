/* ═══════════════ ORDERS ═══════════════
   The list is deliberately light — the API sends per-line summaries only,
   because each order line carries a base64 thumbnail and putting those in
   a list response made it 234KB for four orders. The heavy payload comes
   from the detail endpoint, one order at a time. */

const ordState = { orders:[], q:'', open:null, selected:new Set(), sub:'all-orders' };

const SUB_FILTER = {
  'all-orders':        o => !o.cancelled,
  'production-queue':  o => !o.cancelled && o.status > 0 && o.status < 4,
  'awaiting-proof':    o => !o.cancelled && o.status === 0,
  'ready-to-dispatch': o => !o.cancelled && o.status === 4,
  'cancelled':         o => o.cancelled,
};
const SUB_EMPTY = {
  'all-orders':        'No orders yet.',
  'production-queue':  'Nothing on the floor right now.',
  'awaiting-proof':    'No orders waiting on proof approval.',
  'ready-to-dispatch': 'Nothing packed and waiting to ship.',
  'cancelled':         'No cancelled orders.',
};

async function renderOrders(el, sub){
  ordState.sub = SUB_FILTER[sub] ? sub : 'all-orders';
  if(!ordState.orders.length) el.innerHTML = '<div class="empty">Loading…</div>';
  const d = await api('/api/admin/orders');
  if(!d.ok){ el.innerHTML = `<div class="empty">${esc(d.error)}</div>`; return; }
  ordState.orders = d.orders;
  paintOrders();
}

function ordVisible(){
  const q = ordState.q.trim().toLowerCase();
  return ordState.orders.filter(SUB_FILTER[ordState.sub]).filter(o=>{
    if(!q) return true;
    return (o.id + ' ' + o.customer + ' ' + o.customer_email + ' ' +
            (o.shipping.city||'') + ' ' + (o.shipping.pincode||'') + ' ' +
            o.lines.map(l=>l.product||'').join(' ')).toLowerCase().includes(q);
  });
}

function paintOrders(){
  const el = document.getElementById('content');
  const rows = ordVisible();
  const counts = Object.fromEntries(Object.keys(SUB_FILTER).map(k =>
    [k, ordState.orders.filter(SUB_FILTER[k]).length]));
  const sel = ordState.selected;

  el.innerHTML = `
    <div class="row" style="margin-bottom:16px">
      ${Object.entries(SUB_FILTER).map(([k])=>`
        <button class="btn btn-sm ${ordState.sub===k?'btn-primary':'btn-quiet'}"
          onclick="goTo('orders','${k}')">${esc(subLabel(k))}
          <span class="tiny" style="opacity:.75">${counts[k]}</span></button>`).join('')}
    </div>

    <label class="field admin-search" style="max-width:420px;margin-bottom:14px">
      <span class="material-symbols-outlined">search</span>
      <input id="ordQ" type="text" placeholder="Order, customer, city, PIN or product"
             value="${esc(ordState.q)}" oninput="ordSearch(this.value)">
    </label>

    ${sel.size ? `<div class="bulk-bar">
      <b>${sel.size} selected</b>
      <span class="tiny muted">Move to</span>
      ${STAGES.map((s,i)=>`<button class="chip" onclick="bulkMove(${i})">${esc(s)}</button>`).join('')}
      <button class="btn btn-quiet btn-sm" onclick="clearSel()">Clear</button>
    </div>` : ''}

    ${!rows.length ? `<div class="empty">${esc(SUB_EMPTY[ordState.sub])}</div>` : `
    <div class="card" style="padding:0;overflow:hidden">
    <table>
      <thead><tr>
        <th style="width:38px"><input type="checkbox" class="cbx" onchange="selectAll(this.checked)"
            ${rows.length && rows.every(o=>sel.has(o.id)) ? 'checked' : ''}></th>
        <th>Order</th><th>Customer</th><th>To print</th><th>Deliver to</th>
        <th>Total</th><th>Stage</th><th></th>
      </tr></thead>
      <tbody>${rows.map(o=>`<tr class="${o.cancelled?'row-off':''}">
        <td data-label=""><input type="checkbox" class="cbx" ${sel.has(o.id)?'checked':''}
            onchange="toggleSel('${esc(o.id)}',this.checked)"></td>
        <td data-label="Order"><b>${esc(o.id)}</b><br>
          <span class="tiny dim">${esc(fmtWhen(o.created))}</span></td>
        <td data-label="Customer">${esc(o.customer)}<br>
          <span class="tiny dim">${esc(o.customer_email||'')}</span></td>
        <td data-label="To print">${o.lines.map(l=>
          `${esc(l.product||'item')} <span class="tiny" style="color:var(--lime-ink)">${
            l.sizes ? esc(sizeSummary(l.sizes)) : (l.qty||'?')+' pcs'}</span>`).join('<br>')}</td>
        <td data-label="Deliver to">${o.shipping.recorded
          ? esc(o.shipping.city) + '<br><span class="tiny dim">' + esc(o.shipping.pincode) + '</span>'
          : '<span class="tiny dim">no address</span>'}</td>
        <td data-label="Total"><b>${money(o.total)}</b></td>
        <td data-label="Stage">${o.cancelled
          ? '<span class="badge badge-quiet">Cancelled</span>' : stageBadge(o.status)}</td>
        <td data-label=""><button class="btn btn-quiet btn-sm"
            onclick="openOrder('${esc(o.id)}')">Open</button></td>
      </tr>`).join('')}</tbody>
    </table></div>`}

    <div class="drawer-scrim ${ordState.open?'on':''}" onclick="closeOrder()"></div>
    <aside class="drawer ${ordState.open?'on':''}" id="ordDrawer"></aside>`;
}

function subLabel(k){
  return {'all-orders':'All','production-queue':'In production',
          'awaiting-proof':'Awaiting proof','ready-to-dispatch':'Ready to dispatch',
          'cancelled':'Cancelled'}[k];
}
function sizeSummary(sizes){
  return Object.entries(sizes||{}).filter(([,n])=>+n>0)
    .map(([k,n])=>`${n}×${k}`).join(' · ');
}
function stageBadge(s){
  const cls = s <= 1 ? 'badge-warn' : s <= 3 ? 'badge-mid' : 'badge-lime';
  return `<span class="badge ${cls}">${esc(STAGES[s]||s)}</span>`;
}

function ordSearch(v){ ordState.q = v; paintOrders(); document.getElementById('ordQ').focus(); }
function toggleSel(id, on){ on ? ordState.selected.add(id) : ordState.selected.delete(id); paintOrders(); }
function selectAll(on){
  ordVisible().forEach(o => on ? ordState.selected.add(o.id) : ordState.selected.delete(o.id));
  paintOrders();
}
function clearSel(){ ordState.selected.clear(); paintOrders(); }

async function bulkMove(to){
  const ids = [...ordState.selected];
  const d = await api('/api/admin/orders/bulk', {ids, to});
  if(!d.ok){ toast(d.error); return; }
  // Partial success is the normal case — a cancelled order in the selection
  // can't move — so say what actually happened rather than "done".
  const msg = d.moved.length + ' moved to ' + STAGES[to] +
    (d.skipped.length ? ` · ${d.skipped.length} skipped` : '');
  toast(msg);
  ordState.selected.clear();
  renderOrders(document.getElementById('content'), ordState.sub);
}

/* ── Detail drawer ───────────────────────────────────────────── */
async function openOrder(id){
  ordState.open = id; paintOrders();
  const box = document.getElementById('ordDrawer');
  box.innerHTML = '<div class="empty">Loading…</div>';
  const d = await api('/api/admin/orders/' + encodeURIComponent(id));
  if(!d.ok){ box.innerHTML = `<div class="empty">${esc(d.error)}</div>`; return; }
  box.innerHTML = orderDrawer(d.order);
}
function closeOrder(){ ordState.open = null; paintOrders(); }

function addressBlock(s){
  if(!s.recorded) return `<p class="tiny muted">No address recorded — this order
    predates delivery details being collected. Contact the customer before printing.</p>`;
  const lines = [s.line1, s.line2, `${s.city}, ${s.state} ${s.pincode}`].filter(Boolean);
  return `<div class="addr">
    <b>${esc(s.name)}</b>
    <a href="tel:${esc(s.phone)}">${esc(s.phone)}</a>
    ${lines.map(l=>`<span>${esc(l)}</span>`).join('')}
    <button class="btn btn-quiet btn-sm" onclick="copyAddr(this)"
      data-addr="${esc(s.name+'\n'+s.phone+'\n'+lines.join('\n'))}">
      <span class="material-symbols-outlined" style="font-size:16px">content_copy</span>
      Copy</button>
  </div>`;
}
function copyAddr(btn){
  navigator.clipboard.writeText(btn.dataset.addr).then(()=>toast('Address copied'));
}

/* Per-side print instructions, measured in the studio at add-to-cart time —
   only the canvas knows the px-per-cm ratio for that product's print area. */
function specBlock(side, spec, artUrl){
  if(!spec) return '';
  return `<div class="spec">
    <div class="spec-head">
      <b>${side==='front'?'Front':'Back'}</b>
      <span class="tiny dim">print zone ${spec.zone.w} × ${spec.zone.h} cm</span>
      ${artUrl ? `<a class="btn btn-primary btn-sm" href="${esc(artUrl)}" download>
        <span class="material-symbols-outlined" style="font-size:16px">download</span>
        Artwork</a>` : '<span class="tiny dim">no print file</span>'}
    </div>
    ${(spec.layers||[]).map(l=>`<div class="spec-row ${l.cropped?'bad':''}">
      <span class="spec-kind">${l.kind==='text'?'Text':'Graphic'}</span>
      <span>${l.kind==='text'
        ? `“${esc(l.text||'')}” · ${esc(l.font||'')} · <span class="swatch-dot"
             style="background:${esc(l.color||'#000')}"></span>${esc(l.color||'')}`
        : 'uploaded / generated image'}</span>
      <span><b>${l.w} × ${l.h}</b> cm</span>
      <span class="tiny dim">${l.fromTop} cm from top · ${l.fromLeft} cm from left</span>
      ${l.cropped?'<span class="badge badge-warn">Extends past print area</span>':''}
    </div>`).join('')}
  </div>`;
}

const EVENT_LABEL = {placed:'Order placed', stage:'Stage changed', cancelled:'Cancelled',
                     restored:'Restored', note:'Note'};

function orderDrawer(o){
  const items = Array.isArray(o.items) ? o.items : [];
  return `
  <div class="drawer-head">
    <div><h2 class="page-title" style="font-size:19px">${esc(o.id)}</h2>
      <span class="tiny dim">Placed ${esc(fmtDate(o.created))}</span></div>
    ${o.cancelled ? '<span class="badge badge-quiet">Cancelled</span>' : stageBadge(o.status)}
    <button class="icon-btn" onclick="closeOrder()" aria-label="Close">
      <span class="material-symbols-outlined">close</span></button>
  </div>

  <div class="drawer-body">
    <section>
      <h3 class="tiny muted lbl">Stage</h3>
      ${o.cancelled
        ? '<p class="tiny muted">Restore this order to change its stage.</p>'
        : `<div class="chip-row">${STAGES.map((s,i)=>`
            <button class="chip ${o.status===i?'on':''}"
              onclick="setStage('${esc(o.id)}',${i})">${esc(s)}</button>`).join('')}</div>
           <p class="tiny dim" style="margin-top:8px">Moves either way. Every change
             is recorded below.</p>`}
    </section>

    <section>
      <h3 class="tiny muted lbl">Customer</h3>
      <p>${esc(o.customer)}<br>
        <a href="mailto:${esc(o.customer_email||'')}" style="color:var(--lime-ink)">
          ${esc(o.customer_email||'')}</a></p>
    </section>

    <section>
      <h3 class="tiny muted lbl">Deliver to</h3>
      ${addressBlock(o.shipping)}
    </section>

    <section>
      <h3 class="tiny muted lbl">To print</h3>
      ${items.map(it=>`
        <div class="ord-line">
          <div class="ord-line-top">
            ${it.thumb?`<img class="ord-thumb" src="${esc(it.thumb)}" alt="">`:''}
            <div>
              <b>${esc(it.product||'item')}</b>
              <div class="tiny dim">Garment
                <span class="swatch-dot" style="background:${esc(it.shirt||'#fff')}"></span>
                ${esc(it.shirt||'')}</div>
              <div class="size-chips">${it.sizes
                ? Object.entries(it.sizes).map(([k,n])=>
                    `<span class="size-chip"><b>${n}</b>×${esc(k)}</span>`).join('')
                : `<span class="tiny dim">${it.qty||'?'} pcs (no size recorded)</span>`}</div>
            </div>
            <b style="margin-left:auto">${money(it.total||0)}</b>
          </div>
          ${specBlock('front', it.spec && it.spec.front, it.art && it.art.front)}
          ${specBlock('back',  it.spec && it.spec.back,  it.art && it.art.back)}
          ${!it.spec?`<p class="tiny dim">No print spec recorded — placed before
            artwork capture existed.</p>`:''}
        </div>`).join('')}
      <div class="ord-total"><span>Order total</span><b>${money(o.total)}</b></div>
    </section>

    <section>
      <h3 class="tiny muted lbl">History</h3>
      <ul class="timeline">${(o.events||[]).map(e=>`
        <li><b>${esc(EVENT_LABEL[e.kind]||e.kind)}</b>
          ${e.kind==='stage'?`<span class="muted">${esc(STAGES[e.from]||'—')} →
            ${esc(STAGES[e.to]||'—')}</span>`:''}
          ${e.note?`<span class="muted">${esc(e.note)}</span>`:''}
          <span class="tiny dim">${esc(fmtWhen(e.created))}${e.actor?' · '+esc(e.actor):''}</span>
        </li>`).join('') || '<li class="tiny dim">Nothing recorded yet.</li>'}</ul>
      <div class="note-row">
        <input id="ordNote" type="text" placeholder="Add an internal note…"
               onkeydown="if(event.key==='Enter')addNote('${esc(o.id)}')">
        <button class="btn btn-quiet btn-sm" onclick="addNote('${esc(o.id)}')">Add</button>
      </div>
    </section>

    <section>
      ${o.cancelled
        ? `<button class="btn btn-primary btn-block" onclick="cancelOrder('${esc(o.id)}',true)">
             Restore order</button>`
        : `<button class="btn btn-danger btn-block" onclick="cancelOrder('${esc(o.id)}',false)">
             Cancel order</button>
           <p class="tiny dim" style="margin-top:8px">Keeps the order and its stage on
             record, returns its blanks to stock, and stops it counting as live work.
             Reversible.</p>`}
    </section>
  </div>`;
}

async function setStage(id, to){
  const d = await api('/api/admin/orders/' + encodeURIComponent(id) + '/status', {to});
  if(!d.ok){ toast(d.error); return; }
  toast(id + ' → ' + STAGES[to]);
  await renderOrders(document.getElementById('content'), ordState.sub);
  await openOrder(id);
}
async function cancelOrder(id, restore){
  if(!restore && !confirm('Cancel ' + id + '? Its blanks go back to stock and it can be restored.')) return;
  const d = await api('/api/admin/orders/' + encodeURIComponent(id) + '/cancel', {restore});
  if(!d.ok){ toast(d.error); return; }
  toast(restore ? id + ' restored' : id + ' cancelled');
  await renderOrders(document.getElementById('content'), ordState.sub);
  await openOrder(id);
}
async function addNote(id){
  const box = document.getElementById('ordNote');
  const note = (box.value || '').trim();
  if(!note) return;
  const d = await api('/api/admin/orders/' + encodeURIComponent(id) + '/note', {note});
  if(!d.ok){ toast(d.error); return; }
  await openOrder(id);
}
