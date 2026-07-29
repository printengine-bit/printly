/* ═══════════════ DISPATCH ═══════════════
   Production finishes a print; this turns it into a parcel with a legal
   document on it. Four screens, in the order the work actually happens:
   pack and hand to a courier → the invoice that went with it → labels to
   stick on boxes → the manifest the courier signs at pickup. */

const dispState = {sel:new Set(), pending:[]};

async function renderDispatch(el, sub){
  const tabs = [['pending-shipments','Pending shipments'],['tax-invoices','Tax invoices'],
                ['shipping-labels','Shipping labels'],['manifest','Manifest']];
  el.innerHTML = `<div class="row" style="margin-bottom:18px">
    ${tabs.map(([k,label])=>`<button class="btn btn-sm ${(sub||'pending-shipments')===k?'btn-primary':'btn-quiet'}"
      onclick="goTo('dispatch','${k}')">${esc(label)}</button>`).join('')}
  </div><div id="dispBody"></div>`;
  const body = document.getElementById('dispBody');
  if(sub === 'tax-invoices')    return renderInvoices(body);
  if(sub === 'shipping-labels') return renderLabels(body);
  if(sub === 'manifest')        return renderManifest(body);
  return renderPending(body);
}

/* ── Pending shipments ───────────────────────────────────────── */
async function renderPending(el){
  el.innerHTML = '<div class="empty">Loading…</div>';
  const d = await api('/api/admin/dispatch/pending');
  if(!d.ok){ el.innerHTML = `<div class="empty">${esc(d.error)}</div>`; return; }
  dispState.pending = d.orders;
  dispState.sel = new Set();

  /* Documents carry the company's legal identity. If it isn't on file the
     invoice prints with blanks where the GSTIN and state should be, and the
     tax split can't be worked out at all — so say so here, before anything
     is packed, rather than on the paper. */
  const blockers = [];
  if(!d.gst_registered) blockers.push(
    `<b>No GSTIN on file.</b> Invoices can't be issued as tax invoices until
     one is added under <a href="#/settings/company-profile">Settings → Company profile</a>.`);
  if(!d.company_ready) blockers.push(
    `<b>Company profile is incomplete.</b> The legal name and state are what
     decide CGST/SGST vs IGST — without them the tax split on every invoice
     is a guess.`);

  el.innerHTML = `
    ${blockers.map(b=>`<div class="alert warn" style="margin-bottom:16px">
      <span class="material-symbols-outlined">warning</span><span>${b}</span></div>`).join('')}
    <div class="grid g3" style="margin-bottom:18px">
      <div class="stat"><span>Waiting to ship</span><b>${d.orders.length}</b></div>
      <div class="stat"><span>Pieces</span><b>${d.orders.reduce((a,o)=>a+o.qty,0)}</b></div>
      <div class="stat"><span>Blocked</span><b>${d.orders.filter(o=>!o.ready).length}</b></div>
    </div>
    ${d.orders.length ? d.orders.map(o=>pendingCard(o)).join('')
      : `<div class="empty"><span class="material-symbols-outlined">local_shipping</span>
         <br>Nothing waiting. Orders land here once production marks them Quality check.</div>`}`;
}

function pendingCard(o){
  const a = o.shipping;
  return `<div class="card">
    <div class="spread" style="margin-bottom:12px">
      <div>
        <h2>${esc(o.id)} — ${esc(o.customer)}</h2>
        <p class="tiny muted">${o.qty} piece(s) · ${esc(fmtWhen(o.created))}
          ${o.invoice_no?` · invoice ${esc(o.invoice_no)}`:''}</p>
      </div>
      <div class="stat" style="padding:8px 14px"><span>Value</span><b>${money(o.total)}</b></div>
    </div>

    ${a.recorded ? `<div class="ship-to">
      <div><b>${esc(a.name)}</b> · ${esc(a.phone)}</div>
      <div class="tiny">${esc(a.line1)}${a.line2?', '+esc(a.line2):''}</div>
      <div class="tiny">${esc(a.city)}, ${esc(a.state)} — <b>${esc(a.pincode)}</b></div>
    </div>` : `<div class="alert warn"><span class="material-symbols-outlined">warning</span>
      <span>No delivery address recorded — this can't ship.</span></div>`}

    <table style="margin:10px 0">
      <tbody>${o.lines.map(l=>`<tr>
        <td>${esc(l.product||'')}</td>
        <td>${Object.entries(l.sizes||{}).filter(([,n])=>+n>0)
          .map(([k,n])=>`<span class="size-chip"><b>${n}</b>×${esc(k)}</span>`).join('')
          || `<span class="tiny dim">${l.qty} pcs</span>`}</td>
      </tr>`).join('')}</tbody>
    </table>

    ${a.recorded ? `<div class="dispatch-form">
      <label class="field"><span>Courier</span>
        <input id="cr_${esc(o.id)}" type="text" list="courierList" placeholder="Delhivery"></label>
      <label class="field"><span>AWB / tracking no.</span>
        <input id="awb_${esc(o.id)}" type="text" placeholder="Paste from the courier portal"></label>
      <label class="field"><span>Boxes</span>
        <input id="bx_${esc(o.id)}" type="text" value="1"></label>
      <label class="field"><span>Weight (grams)</span>
        <input id="wt_${esc(o.id)}" type="text" placeholder="e.g. 450"></label>
    </div>
    <div class="row" style="margin-top:12px">
      <button class="btn btn-primary" onclick="shipOrder('${esc(o.id)}')">
        <span class="material-symbols-outlined" style="font-size:18px">local_shipping</span>
        Dispatch &amp; raise invoice</button>
      <button class="btn btn-quiet btn-sm" onclick="openDoc('/api/admin/dispatch/label.html?orders=${encodeURIComponent(o.id)}')">
        Preview label</button>
    </div>
    <p class="tiny dim" style="margin-top:8px">Dispatching moves the order to
      Shipped and raises its tax invoice — that's the moment the goods move,
      which is when the invoice is due.</p>` : ''}
  </div>`;
}

async function shipOrder(id){
  const v = p => (document.getElementById(p+'_'+id)||{}).value || '';
  const d = await api('/api/admin/dispatch/ship', {
    order: id,
    courier: v('cr').trim(),
    awb: v('awb').trim(),
    boxes: parseInt(v('bx'),10) || 1,
    weight_g: parseInt(v('wt'),10) || 0,
  });
  if(!d.ok){ toast(d.error); return; }
  toast(`${id} dispatched · invoice ${d.invoice_no}`);
  openDoc('/api/admin/dispatch/label.html?orders='+encodeURIComponent(id));
  renderPending(document.getElementById('dispBody'));
}

/* Documents print from their own tab: no admin chrome, and each page sets
   its own paper size so nobody has to fix the print dialog by hand. */
function openDoc(url){ window.open(url, '_blank', 'noopener'); }

/* ── Tax invoices ────────────────────────────────────────────── */
async function renderInvoices(el){
  el.innerHTML = '<div class="empty">Loading…</div>';
  const d = await api('/api/admin/dispatch/invoices');
  if(!d.ok){ el.innerHTML = `<div class="empty">${esc(d.error)}</div>`; return; }
  el.innerHTML = `
    <div class="card" style="padding:0;overflow:hidden">
      ${d.invoices.length ? `<table>
        <thead><tr><th>Invoice</th><th>Order</th><th>Consignee</th>
          <th>Issued</th><th>Value</th><th></th></tr></thead>
        <tbody>${d.invoices.map(i=>`<tr class="${i.cancelled?'row-off':''}">
          <td data-label="Invoice"><b>${esc(i.number)}</b></td>
          <td data-label="Order">${esc(i.order)}
            ${i.cancelled?' <span class="badge badge-quiet">cancelled</span>':''}</td>
          <td data-label="Consignee">${esc(i.to||'—')}<br>
            <span class="tiny dim">${esc(i.state||'')}</span></td>
          <td data-label="Issued" class="tiny dim">${esc(fmtWhen(i.at))}</td>
          <td data-label="Value">${money(i.total)}</td>
          <td data-label=""><button class="btn btn-quiet btn-sm"
            onclick="openDoc('/api/admin/dispatch/invoice/${encodeURIComponent(i.order)}.html')">
            <span class="material-symbols-outlined" style="font-size:15px">print</span></button></td>
        </tr>`).join('')}</tbody></table>`
        : '<div class="empty">No invoices raised yet.</div>'}
    </div>
    <p class="tiny dim" style="margin-top:12px">
      Numbers run consecutively within a financial year and are never reused.
      A reprint reproduces exactly what was issued — it is not recalculated
      at today's rates, so editing GST later can't restate an old invoice.
    </p>`;
}

/* ── Shipping labels ─────────────────────────────────────────── */
async function renderLabels(el){
  el.innerHTML = '<div class="empty">Loading…</div>';
  const d = await api('/api/admin/dispatch/shipments');
  if(!d.ok){ el.innerHTML = `<div class="empty">${esc(d.error)}</div>`; return; }
  el.innerHTML = `
    <div class="card">
      <h2>Reprint labels</h2>
      <p class="tiny muted">Tick as many as you like — they print as one job,
        which is how you avoid putting the wrong AWB on a box.</p>
      ${d.shipments.length ? `
      <div class="row" style="margin:12px 0">
        <button class="btn btn-primary btn-sm" onclick="printSelectedLabels()">Print selected</button>
        <button class="btn btn-quiet btn-sm" onclick="toggleAllLabels(true)">Select all</button>
        <button class="btn btn-quiet btn-sm" onclick="toggleAllLabels(false)">Clear</button>
      </div>
      <table>
        <thead><tr><th></th><th>Order</th><th>Courier / AWB</th><th>Consignee</th><th>Dispatched</th></tr></thead>
        <tbody>${d.shipments.map(s=>`<tr>
          <td data-label=""><input class="cbx" type="checkbox" value="${s.id}"
            onchange="toggleLabel(this)" aria-label="Select ${esc(s.order)}"></td>
          <td data-label="Order"><b>${esc(s.order)}</b><br>
            <span class="tiny dim">${esc(s.invoice_no||'no invoice')}</span></td>
          <td data-label="Courier">${esc(s.courier)}<br>
            <span class="tiny" style="font-family:monospace">${esc(s.awb)}</span></td>
          <td data-label="Consignee">${esc(s.to||'—')}<br>
            <span class="tiny dim">${esc(s.city||'')}, ${esc(s.state||'')} ${esc(s.pincode||'')}</span></td>
          <td data-label="Dispatched" class="tiny dim">${esc(fmtWhen(s.created))}</td>
        </tr>`).join('')}</tbody>
      </table>` : '<div class="empty">Nothing dispatched yet.</div>'}
    </div>
    <p class="tiny dim">Labels are 4×6 in — the standard thermal size. The stripe
      under the AWB is a visual check for humans, not a scannable barcode: couriers
      issue their own scannable label from their portal.</p>`;
}
function toggleLabel(cb){
  if(cb.checked) dispState.sel.add(cb.value); else dispState.sel.delete(cb.value);
}
function toggleAllLabels(on){
  document.querySelectorAll('#dispBody .cbx').forEach(cb=>{ cb.checked=on; toggleLabel(cb); });
}
/* By shipment id, not order id: an order that went out twice has two AWBs,
   and reprinting "the order" would put the newer one on the older parcel. */
function printSelectedLabels(){
  if(!dispState.sel.size){ toast('Tick at least one'); return; }
  openDoc('/api/admin/dispatch/label.html?ships=' +
    encodeURIComponent([...dispState.sel].join(',')));
}

/* ── Manifest ────────────────────────────────────────────────── */
async function renderManifest(el){
  const today = new Date().toISOString().slice(0,10);
  el.innerHTML = `<div class="card">
    <h2>Pickup manifest</h2>
    <p class="tiny muted">The sheet the courier signs when they collect. One
      line per consignment, with box and weight totals at the foot.</p>
    <div class="row" style="margin:14px 0">
      <label class="field" style="max-width:200px"><span>Date</span>
        <input id="mfDate" type="date" value="${today}"></label>
      <button class="btn btn-primary" style="align-self:flex-end"
        onclick="openDoc('/api/admin/dispatch/manifest.html?date='+encodeURIComponent(document.getElementById('mfDate').value))">
        <span class="material-symbols-outlined" style="font-size:18px">description</span>
        Open manifest</button>
    </div>
    <div id="mfList"></div>
  </div>`;
  const list = document.getElementById('mfList');
  const d = await api('/api/admin/dispatch/shipments?date='+encodeURIComponent(today));
  if(!d.ok){ list.innerHTML = `<div class="empty">${esc(d.error)}</div>`; return; }
  const grams = d.shipments.reduce((a,s)=>a+(s.weight_g||0),0);
  list.innerHTML = d.shipments.length ? `
    <div class="grid g3" style="margin-bottom:14px">
      <div class="stat"><span>Consignments today</span><b>${d.shipments.length}</b></div>
      <div class="stat"><span>Boxes</span><b>${d.shipments.reduce((a,s)=>a+(s.boxes||0),0)}</b></div>
      <div class="stat"><span>Weight</span><b>${(grams/1000).toFixed(2)} kg</b></div>
    </div>
    <table><tbody>${d.shipments.map(s=>`<tr>
      <td data-label="Order"><b>${esc(s.order)}</b></td>
      <td data-label="Courier">${esc(s.courier)} · <span class="tiny"
        style="font-family:monospace">${esc(s.awb)}</span></td>
      <td data-label="To" class="tiny dim">${esc(s.city||'')}, ${esc(s.state||'')}</td>
    </tr>`).join('')}</tbody></table>`
    : '<div class="empty">Nothing dispatched today yet.</div>';
}
