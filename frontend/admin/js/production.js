/* ═══════════════ PRODUCTION ═══════════════
   The order list answers "what did this customer buy". This answers the
   opposite question: what to pull off the shelf and put on the press,
   batched across every open order. */

async function renderProduction(el, sub){
  const tabs = [['print-jobs','Print jobs'],['artwork-files','Artwork files'],
                ['proof-log','Proof log']];
  el.innerHTML = `<div class="row" style="margin-bottom:18px">
    ${tabs.map(([k,label])=>`<button class="btn btn-sm ${(sub||'print-jobs')===k?'btn-primary':'btn-quiet'}"
      onclick="goTo('production','${k}')">${esc(label)}</button>`).join('')}
  </div><div id="prodBody"></div>`;
  const body = document.getElementById('prodBody');
  if(sub === 'artwork-files') return renderArtwork(body);
  if(sub === 'proof-log')     return renderProofs(body);
  return renderJobs(body);
}

/* ── Print jobs ──────────────────────────────────────────────── */
async function renderJobs(el){
  el.innerHTML = '<div class="empty">Loading…</div>';
  const d = await api('/api/admin/production/jobs');
  if(!d.ok){ el.innerHTML = `<div class="empty">${esc(d.error)}</div>`; return; }
  if(!d.jobs.length){
    el.innerHTML = '<div class="empty"><span class="material-symbols-outlined">print</span>' +
      '<br>Nothing on the floor. Orders appear here once their proof is approved.</div>';
    return;
  }
  el.innerHTML = `
    <div class="grid g3" style="margin-bottom:18px">
      <div class="stat"><span>Blanks to pull</span><b>${d.total_pieces}</b></div>
      <div class="stat"><span>Groups</span><b>${d.jobs.length}</b></div>
      <div class="stat"><span>Orders involved</span><b>${
        new Set(d.jobs.flatMap(j=>j.lines.map(l=>l.order))).size}</b></div>
    </div>
    ${d.jobs.map(j=>`
      <div class="card">
        <div class="spread" style="margin-bottom:12px">
          <div>
            <h2><span class="swatch-dot" style="background:${esc(j.color_hex)}"></span>
              ${esc(j.product)} — ${esc(j.color_name)}</h2>
            <p class="tiny muted">${j.lines.length} order line(s) on the same blank</p>
          </div>
          <div class="stat" style="padding:8px 14px"><span>Pull</span><b>${j.qty}</b></div>
        </div>
        <table>
          <thead><tr><th>Order</th><th>Sizes</th><th>Stage</th><th>Artwork</th></tr></thead>
          <tbody>${j.lines.map(l=>`<tr>
            <td data-label="Order"><b>${esc(l.order)}</b><br>
              <span class="tiny dim">${esc(l.customer)} · ${esc(fmtWhen(l.created))}</span></td>
            <td data-label="Sizes">${Object.entries(l.sizes||{}).filter(([,n])=>+n>0)
              .map(([k,n])=>`<span class="size-chip"><b>${n}</b>×${esc(k)}</span>`).join('')
              || `<span class="tiny dim">${l.qty} pcs</span>`}</td>
            <td data-label="Stage">${stageBadge(l.status)}</td>
            <td data-label="Artwork">${['front','back'].map(side=>{
              const url = l.art && l.art[side];
              const spec = l.spec && l.spec[side];
              if(!url && !spec) return '';
              return `<div style="margin-bottom:6px">
                ${url?`<a class="btn btn-quiet btn-sm" href="${esc(url)}" download>
                  <span class="material-symbols-outlined" style="font-size:15px">download</span>
                  ${side}</a>`:`<span class="tiny dim">${side}: no file</span>`}
                ${spec?`<div class="tiny dim">${(spec.layers||[]).map(x=>
                  `${x.w}×${x.h} cm, ${x.fromTop} from top`).join('; ')}</div>`:''}
              </div>`;
            }).join('') || '<span class="tiny dim">—</span>'}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div>`).join('')}`;
}

/* ── Artwork files ───────────────────────────────────────────── */
async function renderArtwork(el){
  el.innerHTML = '<div class="empty">Loading…</div>';
  const d = await api('/api/admin/production/artwork');
  if(!d.ok){ el.innerHTML = `<div class="empty">${esc(d.error)}</div>`; return; }
  const mb = (d.total_bytes/1048576).toFixed(1);
  el.innerHTML = `
    <div class="grid g3" style="margin-bottom:18px">
      <div class="stat"><span>Print files</span><b>${d.files.length}</b></div>
      <div class="stat"><span>On the volume</span><b>${mb} MB</b></div>
      <div class="stat"><span>Orphaned</span><b>${d.orphans}</b></div>
    </div>
    ${d.orphans ? `<div class="alert warn" style="margin-bottom:16px">
      <span class="material-symbols-outlined">warning</span>
      <span><b>${d.orphans} file(s) belong to no order.</b> Those come from a
        checkout that uploaded artwork and then failed. Harmless, but they're
        the only thing on the volume that grows without being cleaned up.</span>
    </div>` : ''}
    <div class="card" style="padding:0;overflow:hidden">
      ${d.files.length ? `<table>
        <thead><tr><th>File</th><th>Order</th><th>Side</th><th>Format</th><th>Size</th><th></th></tr></thead>
        <tbody>${d.files.map(f=>`<tr class="${f.orphan||f.cancelled?'row-off':''}">
          <td data-label="File"><span class="tiny" style="font-family:monospace">${esc(f.name)}</span></td>
          <td data-label="Order">${f.order
            ? esc(f.order) + (f.cancelled?' <span class="badge badge-quiet">cancelled</span>':'')
            : '<span class="badge badge-warn">orphan</span>'}
            ${f.product?`<br><span class="tiny dim">${esc(f.product)}</span>`:''}</td>
          <td data-label="Side">${esc(f.side||'—')}</td>
          <td data-label="Format"><span class="badge badge-quiet">${esc(f.format)}</span></td>
          <td data-label="Size">${(f.bytes/1024).toFixed(0)} KB</td>
          <td data-label=""><a class="btn btn-quiet btn-sm" href="${esc(f.url)}" download>
            <span class="material-symbols-outlined" style="font-size:15px">download</span></a></td>
        </tr>`).join('')}</tbody></table>`
        : '<div class="empty">No print files yet.</div>'}
    </div>
    <p class="tiny dim" style="margin-top:12px">
      These are the only copies production can print from — the order itself
      stores a preview thumbnail, not the artwork.
    </p>`;
}

/* ── Proof log ───────────────────────────────────────────────── */
async function renderProofs(el){
  el.innerHTML = '<div class="empty">Loading…</div>';
  const d = await api('/api/admin/production/proofs');
  if(!d.ok){ el.innerHTML = `<div class="empty">${esc(d.error)}</div>`; return; }
  el.innerHTML = `
    ${d.overdue ? `<div class="alert warn" style="margin-bottom:16px">
      <span class="material-symbols-outlined">schedule</span>
      <span><b>${d.overdue} order(s) past the ${d.sla_hours}-hour proof promise.</b>
        The storefront tells customers they'll get a digital proof within
        ${d.sla_hours} hours — these are already late.</span>
    </div>` : ''}
    <div class="card">
      <h2>Waiting on approval</h2>
      <p class="tiny muted">Orders at the Proof sent stage, oldest first.</p>
      ${d.waiting.length ? `<table>
        <thead><tr><th>Order</th><th>Customer</th><th>Waiting</th><th></th></tr></thead>
        <tbody>${d.waiting.map(w=>`<tr>
          <td data-label="Order"><b>${esc(w.id)}</b></td>
          <td data-label="Customer">${esc(w.customer)}<br>
            <span class="tiny dim">${esc(w.email)}</span></td>
          <td data-label="Waiting"><b style="${w.overdue?'color:var(--pink-ink)':''}">
            ${w.hours} h</b>${w.overdue?' <span class="badge badge-warn">overdue</span>':''}</td>
          <td data-label=""><button class="btn btn-quiet btn-sm"
            onclick="goTo('orders','awaiting-proof')">Open in Orders</button></td>
        </tr>`).join('')}</tbody></table>`
        : '<div class="empty">Nothing waiting on a proof.</div>'}
    </div>

    <div class="card">
      <h2>Recently approved</h2>
      <p class="tiny muted">Taken from the audit log — a Proof sent → Approved
        move is exactly "the proof was accepted".</p>
      ${d.approved.length ? `<table><tbody>${d.approved.map(a=>`<tr>
        <td data-label="Order"><b>${esc(a.id)}</b></td>
        <td data-label="When" class="tiny dim">${esc(fmtWhen(a.created))}
          ${a.actor?' · '+esc(a.actor):''}</td>
      </tr>`).join('')}</tbody></table>`
        : '<div class="empty">No approvals recorded yet.</div>'}
    </div>

    <p class="tiny dim">
      Proofs are marked approved by staff here — there's no email transport
      yet, so nothing is sent to the customer automatically.
    </p>`;
}
