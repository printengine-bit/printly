/* ═══════════════ CONTENT ═══════════════
   The three things a shop edits that aren't products or orders: which
   designs are offered as templates, which reviews are shown, and the print
   zones the studio measures against. */

const contState = {scope:'all'};

async function renderContent(el, sub){
  const tabs = [['design-templates','Design templates'],
                ['review-moderation','Review moderation'],
                ['product-photos','Product photos']];
  el.innerHTML = `<div class="row" style="margin-bottom:18px">
    ${tabs.map(([k,label])=>`<button class="btn btn-sm ${(sub||'design-templates')===k?'btn-primary':'btn-quiet'}"
      onclick="goTo('content','${k}')">${esc(label)}</button>`).join('')}
  </div><div id="contBody"></div>`;
  const body = document.getElementById('contBody');
  if(sub === 'review-moderation') return renderModeration(body);
  if(sub === 'product-photos')    return renderPhotos(body);
  return renderTemplates(body);
}

/* ── Templates ───────────────────────────────────────────────── */
async function renderTemplates(el){
  el.innerHTML = '<div class="empty">Loading…</div>';
  const d = await api('/api/admin/content/templates');
  if(!d.ok){ el.innerHTML = `<div class="empty">${esc(d.error)}</div>`; return; }
  const card = (t, isTemplate) => `<div class="tpl">
    <div class="tpl-thumb">${t.thumb?`<img src="${esc(t.thumb)}" alt="">`
      :'<span class="material-symbols-outlined">image</span>'}</div>
    <div class="tpl-meta">
      <b>${esc(t.name)}</b>
      <span class="tiny dim">${esc(t.product)} · ${esc(t.author||'unknown')} · ${esc(fmtDate(t.created))}</span>
    </div>
    ${isTemplate ? `<div class="row" style="gap:6px">
        <input type="text" value="${t.sort}" style="width:64px"
          onchange="setTemplate(${t.id},{sort:this.value})" aria-label="Sort order">
        <button class="btn btn-quiet btn-sm" onclick="setTemplate(${t.id},{is_template:false})">
          Unpublish</button>
      </div>`
      : `<button class="btn btn-primary btn-sm" onclick="setTemplate(${t.id},{is_template:true})">
          Publish</button>`}
  </div>`;
  el.innerHTML = `
    <div class="card">
      <h2>Published templates (${d.templates.length})</h2>
      <p class="tiny muted">Shown in the studio's "Start from template" picker,
        in the order below. Unpublishing takes it out of the picker — the
        design itself stays in its owner's account.</p>
      ${d.templates.map(t=>card(t,true)).join('') || '<div class="empty">None published.</div>'}
    </div>
    <div class="card">
      <h2>Recent customer designs</h2>
      <p class="tiny muted">A good template is usually something a customer
        already made. Publishing copies nothing — it flags this design, so
        the customer's own copy is what everyone starts from.</p>
      ${d.candidates.map(t=>card(t,false)).join('') || '<div class="empty">No saved designs yet.</div>'}
    </div>`;
}
async function setTemplate(id, patch){
  const d = await api('/api/admin/content/templates/'+id, patch);
  if(!d.ok){ toast(d.error); return; }
  toast('Updated');
  renderTemplates(document.getElementById('contBody'));
}

/* ── Review moderation ───────────────────────────────────────── */
async function renderModeration(el){
  el.innerHTML = '<div class="empty">Loading…</div>';
  const d = await api('/api/admin/content/reviews?scope='+contState.scope);
  if(!d.ok){ el.innerHTML = `<div class="empty">${esc(d.error)}</div>`; return; }
  const f = [['all','All',d.counts.all],['visible','Visible',d.counts.visible],
             ['low','1–2 star',d.counts.low],['hidden','Hidden',d.counts.hidden]];
  el.innerHTML = `
    <div class="row" style="margin-bottom:14px">
      ${f.map(([k,label,n])=>`<button class="chip ${contState.scope===k?'on':''}"
        onclick="setReviewScope('${k}')">${esc(label)} <b>${n}</b></button>`).join('')}
    </div>
    ${d.reviews.map(r=>`<div class="card ${r.hidden?'row-off':''}">
      <div class="spread" style="margin-bottom:8px">
        <div>
          <b>${'★'.repeat(r.rating)}${'☆'.repeat(5-r.rating)}</b>
          <span class="tiny dim"> ${esc(r.product)} · ${esc(r.author||'—')}
            · ${esc(fmtDate(r.created))}</span>
        </div>
        ${r.hidden ? `<button class="btn btn-quiet btn-sm" onclick="moderate(${r.id},false)">
            Restore</button>`
          : `<button class="btn btn-quiet btn-sm" onclick="moderate(${r.id},true)">Hide</button>`}
      </div>
      <p style="font-size:13.5px;line-height:1.55">${esc(r.body)}</p>
      ${r.hidden?`<p class="tiny" style="color:var(--pink-ink);margin-top:8px">
        Hidden — ${esc(r.hidden_reason)}</p>`:''}
    </div>`).join('') || '<div class="empty">Nothing here.</div>'}
    <p class="tiny dim">Hiding takes a review off the product page and out of
      its rating average. Nothing is deleted — the row stays, along with who
      hid it and why.</p>`;
}
function setReviewScope(s){ contState.scope=s; renderModeration(document.getElementById('contBody')); }
async function moderate(id, hide){
  let reason = '';
  if(hide){
    reason = prompt('Why is this being hidden? (kept on the record)') || '';
    if(!reason.trim()) return;
  }
  const d = await api('/api/admin/content/reviews/'+id, {hidden:hide, reason});
  if(!d.ok){ toast(d.error); return; }
  toast(hide?'Hidden':'Restored');
  renderModeration(document.getElementById('contBody'));
}

/* ── Photos + print zones ────────────────────────────────────── */
async function renderPhotos(el){
  el.innerHTML = '<div class="empty">Loading…</div>';
  const d = await api('/api/admin/content/photos');
  if(!d.ok){ el.innerHTML = `<div class="empty">${esc(d.error)}</div>`; return; }
  el.innerHTML = `
    <div class="alert warn" style="margin-bottom:16px">
      <span class="material-symbols-outlined">straighten</span>
      <span><b>These measurements drive every garment size.</b> The studio
        scales the zone up and down from this reference by the size chart, so
        one wrong figure here is wrong on all six sizes at once. Measure a real
        blank and the maximum your press can lay down — don't guess.</span>
    </div>
    ${d.photos.map(p=>`<div class="card">
      <div class="spread" style="margin-bottom:10px">
        <div><h2>${esc(p.product)} — ${esc(p.side)}</h2>
          <p class="tiny muted" style="font-family:monospace">${esc(p.file)}</p></div>
        <img class="photo-thumb" src="/${esc(p.file)}" alt=""
          onerror="this.classList.add('gone');this.alt='missing'">
      </div>
      ${p.zone ? `
        <div class="form-grid zone-grid">
          ${[['cx','Centre X (px)'],['cy','Centre Y (px)'],
             ['w','Width (px)'],['h','Height (px)'],
             ['cm_w','Width (cm)'],['cm_h','Height (cm)']].map(([f,label])=>`
            <label class="field"><span>${esc(label)}</span>
              <input id="z_${esc(p.key)}_${f}" type="text"
                value="${f==='cm_w'?p.zone.cmW:f==='cm_h'?p.zone.cmH:p.zone[f]}"></label>`).join('')}
        </div>
        <button class="btn btn-primary btn-sm" onclick="saveZone('${esc(p.key)}')">Save zone</button>
        <p class="tiny dim" style="margin-top:8px">Pixels are measured on the
          720px-wide mockup photo; centimetres are the real printable size on
          that garment.</p>`
        : `<div class="alert warn"><span class="material-symbols-outlined">error</span>
           <span>No zone recorded — the studio falls back to the round-neck tee's
             measurements, so this mockup prints at the wrong dimensions.</span></div>`}
    </div>`).join('')}
    ${d.no_photo.length?`<div class="card">
      <h2>Drawn without a photo</h2>
      <p class="tiny muted">${d.no_photo.map(esc).join(', ')} — no mockup file, so
        the studio draws a vector silhouette and uses the fallback print area in
        studio.js. That's by design, not a fault; add a photo to change it.</p>
    </div>`:''}
    ${d.orphan_zones.length?`<div class="card">
      <h2>Zones with no photo</h2>
      <p class="tiny muted">${d.orphan_zones.map(esc).join(', ')} — measurements
        for a mockup that isn't on disk. Harmless, but nothing reads them.</p>
    </div>`:''}
    <p class="tiny dim">Photos ship with the code and aren't uploadable here:
      everything outside the data volume is replaced on each deploy, so an
      uploaded file would disappear at the next push with nothing to connect
      the two. Replacing a mockup is a commit.</p>`;
}
async function saveZone(key){
  const num = f => document.getElementById('z_'+key+'_'+f).value;
  const d = await api('/api/admin/content/zones/'+encodeURIComponent(key), {
    cx:num('cx'), cy:num('cy'), w:num('w'), h:num('h'),
    cm_w:num('cm_w'), cm_h:num('cm_h'),
  });
  if(!d.ok){ toast(d.error); return; }
  toast('Saved — live in the studio on the next page load');
}
