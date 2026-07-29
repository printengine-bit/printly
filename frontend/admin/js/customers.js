/* ═══════════════ CUSTOMERS ═══════════════
   Who they are is a users row; everything worth knowing is derived from
   their orders. Two screens: the list ranked by what they've spent, and a
   drawer with their whole history — orders, addresses they've used, the
   loyalty ledger and any support they've asked for. */

const custState = {open:null, q:''};

async function renderCustomers(el, sub){
  const tabs = [['all-customers','All customers'],['loyalty-adjustments','Loyalty ledger']];
  el.innerHTML = `<div class="row" style="margin-bottom:18px">
    ${tabs.map(([k,label])=>`<button class="btn btn-sm ${(sub||'all-customers')===k?'btn-primary':'btn-quiet'}"
      onclick="goTo('customers','${k}')">${esc(label)}</button>`).join('')}
  </div><div id="custBody"></div>
  <div class="drawer-scrim" onclick="closeCustomer()"></div>
  <aside class="drawer" id="custDrawer"></aside>`;
  return renderCustomerList(document.getElementById('custBody'),
                            sub === 'loyalty-adjustments');
}

async function renderCustomerList(el, loyaltyView){
  el.innerHTML = '<div class="empty">Loading…</div>';
  const d = await api('/api/admin/customers' + (custState.q ? '?q='+encodeURIComponent(custState.q) : ''));
  if(!d.ok){ el.innerHTML = `<div class="empty">${esc(d.error)}</div>`; return; }
  const c = d.customers;
  const spend = c.reduce((a,x)=>a+x.spend,0);
  const withOrders = c.filter(x=>x.orders>0);

  el.innerHTML = `
    <div class="grid g3" style="margin-bottom:18px">
      <div class="stat"><span>Customers</span><b>${c.length}</b></div>
      <div class="stat"><span>Have ordered</span><b>${withOrders.length}</b></div>
      <div class="stat"><span>Lifetime value</span><b>${money(spend)}</b></div>
    </div>
    <div class="row" style="margin-bottom:14px">
      <input id="custSearch" type="text" placeholder="Search name or email"
        value="${esc(custState.q)}" style="max-width:320px"
        onkeydown="if(event.key==='Enter')searchCustomers()">
      <button class="btn btn-quiet btn-sm" onclick="searchCustomers()">Search</button>
      ${custState.q?`<button class="btn btn-quiet btn-sm" onclick="clearCustomerSearch()">Clear</button>`:''}
    </div>
    <div class="card" style="padding:0;overflow:hidden">
      ${c.length ? `<table>
        <thead><tr><th>Customer</th><th>Orders</th>
          <th>${loyaltyView?'Points':'Spent'}</th><th>Last order</th><th></th></tr></thead>
        <tbody>${c.map(x=>`<tr>
          <td data-label="Customer"><b>${esc(x.name)}</b><br>
            <span class="tiny dim">${esc(x.email)}${x.city?' · '+esc(x.city):''}</span></td>
          <td data-label="Orders">${x.orders}
            ${x.cancelled?`<br><span class="tiny dim">${x.cancelled} cancelled</span>`:''}</td>
          <td data-label="${loyaltyView?'Points':'Spent'}">
            ${loyaltyView ? `<b>${x.points}</b>` : money(x.spend)}</td>
          <td data-label="Last order" class="tiny dim">${x.last_order?esc(fmtWhen(x.last_order)):'never'}</td>
          <td data-label=""><button class="btn btn-quiet btn-sm"
            onclick="openCustomer(${x.id})">Open</button></td>
        </tr>`).join('')}</tbody></table>`
        : `<div class="empty">${custState.q?'Nobody matches that.':'No customers yet.'}</div>`}
    </div>
    ${loyaltyView?`<p class="tiny dim" style="margin-top:12px">
      Points accrue at 1 per ₹100 spent. <b>There is no way to redeem them yet</b> —
      the earn/burn policy hasn't been set, so this is a balance, not a promise.
      Open a customer to adjust it; every change is recorded with a reason.</p>`:''}`;
}

function searchCustomers(){
  custState.q = (document.getElementById('custSearch').value || '').trim();
  renderCustomerList(document.getElementById('custBody'),
                     (location.hash||'').indexOf('loyalty')>-1);
}
function clearCustomerSearch(){ custState.q=''; searchCustomers(); }

/* ── Detail drawer ───────────────────────────────────────────── */
async function openCustomer(id){
  custState.open = id;
  const dr = document.getElementById('custDrawer');
  dr.classList.add('on');
  document.querySelector('.drawer-scrim').classList.add('on');
  dr.innerHTML = '<div class="empty">Loading…</div>';
  const d = await api('/api/admin/customers/'+id);
  if(!d.ok){ dr.innerHTML = `<div class="empty">${esc(d.error)}</div>`; return; }
  const c = d.customer;
  dr.innerHTML = `
    <div class="drawer-head">
      <div><h2>${esc(c.name)}</h2>
        <p class="tiny muted">${esc(c.email)} · joined ${esc(fmtDate(c.joined))}</p></div>
      <button class="icon-btn" onclick="closeCustomer()" aria-label="Close">
        <span class="material-symbols-outlined">close</span></button>
    </div>
    <div class="drawer-body">
      <div class="grid g3" style="margin-bottom:18px">
        <div class="stat"><span>Spent</span><b>${money(c.spend)}</b></div>
        <div class="stat"><span>Avg order</span><b>${money(c.avg)}</b></div>
        <div class="stat"><span>Points</span><b>${c.points}</b></div>
      </div>

      <section>
        <h3 class="tiny muted lbl">Orders (${c.orders.length})</h3>
        ${c.orders.length ? `<table><tbody>${c.orders.map(o=>`<tr class="${o.cancelled?'row-off':''}">
          <td data-label="Order"><b>${esc(o.id)}</b><br>
            <span class="tiny dim">${esc(fmtWhen(o.created))}</span></td>
          <td data-label="Items" class="tiny">${(o.lines||[]).map(l=>
            esc((l.product||'')+' ×'+(l.qty||0))).join('<br>')}</td>
          <td data-label="Stage">${o.cancelled
            ? '<span class="badge badge-quiet">Cancelled</span>' : stageBadge(o.status)}</td>
          <td data-label="Total">${money(o.total)}</td>
        </tr>`).join('')}</tbody></table>`
          : '<p class="tiny dim">Signed up but never ordered.</p>'}
      </section>

      <section>
        <h3 class="tiny muted lbl">Addresses used</h3>
        ${c.addresses.length ? c.addresses.map(a=>`<div class="ship-to" style="margin-bottom:8px">
          <div><b>${esc(a.name)}</b> · ${esc(a.phone)}</div>
          <div class="tiny">${esc(a.line1)}${a.line2?', '+esc(a.line2):''}</div>
          <div class="tiny">${esc(a.city)}, ${esc(a.state)} — ${esc(a.pincode)}</div>
        </div>`).join('') : '<p class="tiny dim">No delivery address on file.</p>'}
      </section>

      <section>
        <h3 class="tiny muted lbl">Loyalty</h3>
        <div class="row" style="margin-bottom:12px">
          <input id="ptDelta" type="text" placeholder="e.g. 50 or -20" style="max-width:130px">
          <input id="ptReason" type="text" placeholder="Why — this is the record" style="flex:1">
          <button class="btn btn-primary btn-sm" onclick="adjustPoints(${c.id})">Adjust</button>
        </div>
        ${c.loyalty.length ? `<table><tbody>${c.loyalty.map(m=>`<tr>
          <td data-label="Points"><b style="color:${m.delta<0?'var(--pink-ink)':'var(--lime-ink)'}">
            ${m.delta>0?'+':''}${m.delta}</b></td>
          <td data-label="Reason">${esc(m.reason)}
            ${m.order_id?`<span class="tiny dim"> · ${esc(m.order_id)}</span>`:''}</td>
          <td data-label="When" class="tiny dim">${esc(fmtWhen(m.created))}
            ${m.actor?' · '+esc(m.actor):''}</td>
        </tr>`).join('')}</tbody></table>`
          : '<p class="tiny dim">No movements recorded.</p>'}
      </section>

      <section>
        <h3 class="tiny muted lbl">Support (${c.tickets.length})</h3>
        ${c.tickets.length ? c.tickets.map(t=>`<div class="row" style="margin-bottom:6px">
          <button class="btn btn-quiet btn-sm" onclick="closeCustomer();goTo('support','ticket-inbox');setTimeout(()=>openTicket(${t.id}),400)">
            #${t.id}</button>
          <span style="flex:1">${esc(t.subject)}</span>
          <span class="badge badge-quiet">${esc(t.status)}</span>
        </div>`).join('') : '<p class="tiny dim">Never got in touch.</p>'}
        <button class="btn btn-quiet btn-sm" style="margin-top:10px"
          onclick="closeCustomer();goTo('support','ticket-inbox');setTimeout(()=>newTicketFor(${c.id},'${esc(c.name)}'),400)">
          Log a conversation</button>
      </section>

      <p class="tiny dim">${c.designs} saved design(s) in their account.</p>
    </div>`;
}
function closeCustomer(){
  custState.open = null;
  const dr = document.getElementById('custDrawer');
  if(dr) dr.classList.remove('on');
  const sc = document.querySelector('.drawer-scrim');
  if(sc) sc.classList.remove('on');
}

async function adjustPoints(id){
  const d = await api('/api/admin/customers/'+id+'/loyalty', {
    delta: parseInt(document.getElementById('ptDelta').value, 10),
    reason: document.getElementById('ptReason').value,
  });
  if(!d.ok){ toast(d.error); return; }
  toast('Balance is now ' + d.points);
  openCustomer(id);
}
