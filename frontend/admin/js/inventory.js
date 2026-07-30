/* ═══════════════ INVENTORY ═══════════════
   Products and their bulk pricing, a colour × size stock grid, the movement
   ledger, and the low-stock view.

   Stock is never allowed to block a sale — a fresh shop has counted nothing,
   so refusing orders on a zero count would take the storefront offline.
   Negative stock is shown loudly instead; see apply_stock() in catalog.py. */

const invState = {
  products:[], tax:null, openProduct:null,
  audience:'all', category:'all',
};
const ADMIN_AUDIENCES = [
  ['unisex','Everyone / unisex'], ['men','Men'], ['women','Women'], ['kids','Kids'],
];
const ADMIN_CATEGORIES = [
  ['tees','Tees'], ['polos','Polos'], ['hoodies','Hoodies'],
  ['sweatshirts','Sweatshirts'], ['jerseys','Jerseys'], ['bags','Bags'],
];
const ADMIN_MOCKS = [
  ['rn','Round neck · front'], ['rn_back','Round neck · back'],
  ['po','Polo · front'], ['po_back','Polo · back'],
  ['hd','Hoodie · front'], ['hd_back','Hoodie · back'],
  ['hd_left_sleeve','Hoodie · left sleeve'],
  ['hd_right_sleeve','Hoodie · right sleeve'],
  ['js','Jersey · front'], ['js_back','Jersey · back'],
];
function adminOptionRows(rows, selected){
  return rows.map(([value,label])=>
    `<option value="${esc(value)}" ${value===selected?'selected':''}>${esc(label)}</option>`).join('');
}
function setCatalogFilter(kind, value){
  invState[kind] = value;
  renderProducts(document.getElementById('invBody'));
}

async function renderInventory(el, sub){
  const tabs = [
    ['products','Products'],
    ['variants-stock','Variants & stock'],
    ['stock-movements','Stock movements'],
    ['low-stock','Low stock'],
    ['promo-codes','Promo codes'],
  ];
  el.innerHTML = `<div class="row" style="margin-bottom:18px">
    ${tabs.map(([k,label])=>`<button class="btn btn-sm ${(sub||'products')===k?'btn-primary':'btn-quiet'}"
      onclick="goTo('inventory','${k}')">${esc(label)}</button>`).join('')}
  </div><div id="invBody"></div>`;

  const body = document.getElementById('invBody');
  if(sub === 'variants-stock')   return renderStockGrid(body);
  if(sub === 'stock-movements')  return renderMoves(body);
  if(sub === 'low-stock')        return renderLowStock(body);
  if(sub === 'promo-codes')      return renderPromoCodes(body);
  if(sub === 'suppliers')        return body.innerHTML = stubCard('Suppliers & purchase orders',
    'Planned once stock counts are being kept reliably.');
  return renderProducts(body);
}

function stubCard(title, note){
  return `<div class="card stub"><h2>${esc(title)}</h2><p class="muted">${esc(note)}</p></div>`;
}

/* ── Products ────────────────────────────────────────────────── */
async function renderProducts(el){
  el.innerHTML = '<div class="empty">Loading…</div>';
  const d = await api('/api/admin/catalog/products');
  if(!d.ok){ el.innerHTML = `<div class="empty">${esc(d.error)}</div>`; return; }
  invState.products = d.products;
  invState.tax = d.tax;
  const owner = SESSION.user.role === 'owner';
  const shown = d.products.filter(p=>
    (invState.audience==='all' || p.audience===invState.audience) &&
    (invState.category==='all' || p.category===invState.category));

  el.innerHTML = `
    <div class="card">
      <div class="spread">
        <div><h2>Products</h2>
          <p class="tiny muted">Audience, category, photo mapping and pricing are live on the storefront.</p></div>
        <span class="badge badge-lime">${shown.length} shown</span>
      </div>
      <p class="tiny muted">Prices here are what the storefront charges and what the
        server bills — the browser no longer decides.</p>
      <div class="form-grid catalog-filters">
        <label class="field"><span>Audience</span><select onchange="setCatalogFilter('audience',this.value)">
          <option value="all">All audiences</option>
          ${adminOptionRows(ADMIN_AUDIENCES,invState.audience)}
        </select></label>
        <label class="field"><span>Category</span><select onchange="setCatalogFilter('category',this.value)">
          <option value="all">All categories</option>
          ${adminOptionRows(ADMIN_CATEGORIES,invState.category)}
        </select></label>
      </div>
      <table>
        <thead><tr><th>Product</th><th>Storefront</th><th>Photo</th><th>Tiers</th><th>Stock</th><th>Status</th><th></th></tr></thead>
        <tbody>${shown.map(p=>`<tr>
          <td data-label="Product"><b>${esc(p.emoji)} ${esc(p.name)}</b><br>
            <span class="tiny dim">${esc(p.slug)} · ${esc(p.fabric||'no fabric text')}</span></td>
          <td data-label="Storefront"><b>${esc((ADMIN_AUDIENCES.find(x=>x[0]===p.audience)||[])[1]||p.audience)}</b><br>
            <span class="tiny dim">${esc((ADMIN_CATEGORIES.find(x=>x[0]===p.category)||[])[1]||p.category)}</span></td>
          <td data-label="Photo" class="tiny">${esc((p.print_views.find(v=>v.key==='front')||p.print_views[0]||{}).mock||'none')}</td>
          <td data-label="Tiers" class="tiny">${p.tiers.map(t=>
            `${t[0]}+ → ₹${t[1].toLocaleString('en-IN')}`).join('<br>')}</td>
          <td data-label="Stock">
            <b class="${p.stock<0?'':''}" style="${p.stock<0?'color:var(--pink-ink)':''}">${p.stock}</b>
            <span class="tiny dim"> across ${p.variants}</span>
            ${p.low?`<br><span class="badge badge-warn" style="margin-top:4px">${p.low} low</span>`:''}</td>
          <td data-label="Status">${p.active
            ? '<span class="badge badge-lime">Live</span>'
            : '<span class="badge badge-quiet">Hidden</span>'}</td>
          <td data-label=""><button class="btn btn-quiet btn-sm" onclick="editProduct(${p.id})">Edit</button></td>
        </tr>`).join('') || `<tr><td colspan="7"><div class="empty">No products match these filters.</div></td></tr>`}</tbody>
      </table>
    </div>

    <div class="card">
      <h2>Tax &amp; shipping</h2>
      <p class="tiny muted">Applied to every order, server-side.</p>
      ${(d.tax.gst_percent > 0 || d.tax.gst_percent_high > 0) && !d.gst_registered ? `
      <div class="alert warn">
        <span class="material-symbols-outlined">warning</span>
        <span><b>Charging GST with no GSTIN on file.</b>
          Tax can't be collected without registration — either set both rates to 0
          until you're registered, or add the GSTIN under Settings.</span>
      </div>` : ''}
      <p class="tiny dim" style="margin-bottom:12px">Apparel is taxed <b>per piece</b>
        on what that piece sells for, so one order can carry both rates — and a
        garment discounted below the threshold by a bulk tier moves down a slab.</p>
      <div class="form-grid">
        <label class="field"><span>GST % at or below threshold</span>
          <input id="tx_gst" type="text" value="${d.tax.gst_percent}" ${owner?'':'disabled'}></label>
        <label class="field"><span>GST % above threshold</span>
          <input id="tx_gst_hi" type="text" value="${d.tax.gst_percent_high}" ${owner?'':'disabled'}></label>
        <label class="field"><span>Slab threshold ₹ / piece</span>
          <input id="tx_gst_at" type="text" value="${d.tax.gst_threshold}" ${owner?'':'disabled'}></label>
        <label class="field"><span>Flat shipping ₹</span>
          <input id="tx_ship" type="text" value="${d.tax.shipping_flat}" ${owner?'':'disabled'}></label>
        <label class="field"><span>Free shipping over ₹</span>
          <input id="tx_free" type="text" value="${d.tax.free_shipping_over}" ${owner?'':'disabled'}></label>
      </div>
      ${owner ? '<button class="btn btn-primary" onclick="saveTax()">Save</button>'
              : '<p class="tiny dim">Only an owner can change these.</p>'}
    </div>

    <div id="prodEditor"></div>`;
  if(invState.openProduct) editProduct(invState.openProduct);
}

function editProduct(id){
  invState.openProduct = id;
  const p = invState.products.find(x=>x.id===id);
  if(!p) return;
  const box = document.getElementById('prodEditor');
  box.innerHTML = `<div class="card">
    <div class="spread"><h2>Edit ${esc(p.name)}</h2>
      <button class="icon-btn" onclick="closeEditor()" aria-label="Close">
        <span class="material-symbols-outlined">close</span></button></div>
    <div class="form-grid">
      <label class="field"><span>Name</span><input id="pe_name" type="text" value="${esc(p.name)}"></label>
      <label class="field"><span>Emoji</span><input id="pe_emoji" type="text" value="${esc(p.emoji)}"></label>
      <label class="field span2"><span>Fabric</span><input id="pe_fabric" type="text" value="${esc(p.fabric)}"></label>
      <label class="field"><span>Fit label</span><input id="pe_fit" type="text" value="${esc(p.fit)}"></label>
      <label class="field"><span>Audience</span><select id="pe_audience">
        ${adminOptionRows(ADMIN_AUDIENCES,p.audience)}
      </select></label>
      <label class="field"><span>Category</span><select id="pe_category">
        ${adminOptionRows(ADMIN_CATEGORIES,p.category)}
      </select></label>
      <label class="field"><span>Storefront order</span>
        <input id="pe_sort" type="number" min="0" step="1" value="${p.sort||0}"></label>
      <label class="field"><span>HSN code</span>
        <input id="pe_hsn" type="text" value="${esc(p.hsn_code)}" placeholder="e.g. 61091000"></label>
      <label class="field"><span>Cost per blank ₹</span>
        <input id="pe_cost" type="text" value="${p.cost_price||0}"
          placeholder="what you pay for it"></label>
    </div>
    <p class="tiny dim" style="margin:-4px 0 16px">HSN is only needed once you're
      GST-registered — it goes on the tax invoice, not the delivery note.</p>

    <h3 class="tiny muted" style="text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">
      Bulk price tiers</h3>
    <p class="tiny dim" style="margin-bottom:10px">The highest tier at or below the
      ordered quantity wins. The first must start at 1.</p>
    <div id="pe_tiers">${p.tiers.map((t,i)=>tierRow(t[0],t[1],i)).join('')}</div>
    <div class="row" style="margin:12px 0 18px">
      <button class="btn btn-quiet btn-sm" onclick="addTier()">Add tier</button>
    </div>

    <h3 class="tiny muted" style="text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">
      Printable views</h3>
    <p class="tiny dim" style="margin-bottom:10px">Each canvas has its own mockup and zone.
      Views sharing a group (both sleeves) charge that group's fee only once.</p>
    <div id="pe_views">${(p.print_views||[]).map((v,i)=>printViewRow(v,i)).join('')}</div>
    <button class="btn btn-quiet btn-sm" style="margin:4px 0 18px" onclick="addPrintView()">Add view</button>

    <label class="field"><span>Storefront visibility</span>
      <select id="pe_active">
        <option value="1" ${p.active?'selected':''}>Live — shown to customers</option>
        <option value="0" ${!p.active?'selected':''}>Hidden — kept, not sold</option>
      </select></label>

    <div class="row">
      <button class="btn btn-primary" onclick="saveProduct(${p.id})">Save product</button>
      <button class="btn btn-quiet" onclick="goTo('inventory','variants-stock')">Stock for this →</button>
    </div>
  </div>`;
  box.scrollIntoView({behavior:'smooth', block:'nearest'});
}
function closeEditor(){ invState.openProduct=null; document.getElementById('prodEditor').innerHTML=''; }

function tierRow(qty, price, i){
  return `<div class="row tier-row" style="margin-bottom:8px">
    <input type="text" class="pe-q" value="${qty}" style="max-width:120px" aria-label="Min quantity">
    <span class="tiny muted">pcs and up →</span>
    <input type="text" class="pe-p" value="${price}" style="max-width:140px" aria-label="Unit price">
    <button class="icon-btn" onclick="this.closest('.tier-row').remove()" aria-label="Remove tier">
      <span class="material-symbols-outlined">delete</span></button>
  </div>`;
}
function addTier(){
  document.getElementById('pe_tiers').insertAdjacentHTML('beforeend', tierRow('', '', 0));
}
function printViewRow(v={}){
  return `<div class="card print-view-row" style="padding:12px;margin-bottom:8px">
    <div class="form-grid">
      <label class="field"><span>Key</span><input class="pv-key" value="${esc(v.key||'')}"></label>
      <label class="field"><span>Customer label</span><input class="pv-label" value="${esc(v.label||'')}"></label>
      <label class="field"><span>Price group</span><input class="pv-group" value="${esc(v.group||'')}"></label>
      <label class="field"><span>Photographed mockup</span><select class="pv-mock">
        ${v.mock && !ADMIN_MOCKS.some(x=>x[0]===v.mock)
          ? `<option value="${esc(v.mock)}" selected>${esc(v.mock)} · custom</option>` : ''}
        ${adminOptionRows(ADMIN_MOCKS,v.mock||'rn')}
      </select></label>
      <label class="field"><span>Surcharge ₹</span><input class="pv-fee" value="${+v.surcharge||0}"></label>
      <label class="field"><span>Behaviour</span><span class="row" style="gap:12px;min-height:40px">
        <label><input class="pv-required" type="checkbox" ${v.required?'checked':''}> Required</label>
        <label><input class="pv-default" type="checkbox" ${v.default?'checked':''}> Default</label>
      </span></label>
    </div>
    <button class="btn btn-quiet btn-sm" onclick="this.closest('.print-view-row').remove()">Remove view</button>
  </div>`;
}
function addPrintView(){
  document.getElementById('pe_views').insertAdjacentHTML('beforeend',printViewRow());
}

async function saveProduct(id){
  const tiers = [...document.querySelectorAll('#pe_tiers .tier-row')].map(r=>[
    parseInt(r.querySelector('.pe-q').value, 10),
    parseFloat(r.querySelector('.pe-p').value),
  ]).filter(t=>!isNaN(t[0]) && !isNaN(t[1]));
  const d = await api('/api/admin/catalog/products/' + id, {
    name: document.getElementById('pe_name').value,
    emoji: document.getElementById('pe_emoji').value,
    fabric: document.getElementById('pe_fabric').value,
    fit: document.getElementById('pe_fit').value,
    hsn_code: document.getElementById('pe_hsn').value,
    cost_price: parseFloat(document.getElementById('pe_cost').value) || 0,
    audience: document.getElementById('pe_audience').value,
    category: document.getElementById('pe_category').value,
    sort: parseInt(document.getElementById('pe_sort').value, 10) || 0,
    active: document.getElementById('pe_active').value === '1',
    tiers,
    print_views:[...document.querySelectorAll('#pe_views .print-view-row')].map(r=>({
      key:r.querySelector('.pv-key').value.trim(),
      label:r.querySelector('.pv-label').value.trim(),
      group:r.querySelector('.pv-group').value.trim(),
      mock:r.querySelector('.pv-mock').value.trim(),
      surcharge:parseFloat(r.querySelector('.pv-fee').value)||0,
      required:r.querySelector('.pv-required').checked,
      default:r.querySelector('.pv-default').checked,
    })),
  });
  if(!d.ok){ toast(d.error); return; }
  toast('Saved — live on the storefront after a refresh');
  invState.openProduct = null;
  renderProducts(document.getElementById('invBody'));
}

async function saveTax(){
  const num = id => parseFloat(document.getElementById(id).value);
  const d = await api('/api/admin/catalog/tax', {
    gst_percent: num('tx_gst'),
    gst_percent_high: num('tx_gst_hi'),
    gst_threshold: num('tx_gst_at'),
    shipping_flat: num('tx_ship'),
    free_shipping_over: num('tx_free'),
  });
  if(!d.ok){ toast(d.error); return; }
  toast('Tax and shipping updated');
  renderProducts(document.getElementById('invBody'));
}

/* ── Stock grid ──────────────────────────────────────────────── */
async function renderStockGrid(el){
  el.innerHTML = '<div class="empty">Loading…</div>';
  if(!invState.products.length){
    const d = await api('/api/admin/catalog/products');
    if(d.ok) invState.products = d.products;
  }
  const pid = invState.openProduct || (invState.products[0] && invState.products[0].id);
  if(!pid){ el.innerHTML = '<div class="empty">No products yet.</div>'; return; }
  invState.openProduct = pid;

  const d = await api('/api/admin/catalog/products/' + pid + '/stock');
  if(!d.ok){ el.innerHTML = `<div class="empty">${esc(d.error)}</div>`; return; }

  // One row per colour, one column per size — the shape a stocktake is
  // actually done in.
  const byColor = {};
  d.variants.forEach(v=>{ (byColor[v.color_name] ||= {hex:v.color_hex, cells:{}}).cells[v.size] = v; });

  el.innerHTML = `
    <div class="card">
      <div class="spread" style="margin-bottom:14px">
        <div><h2>Stock — ${esc(d.product.name)}</h2>
          <p class="tiny muted">Click any number to set a new count.</p></div>
        <select onchange="pickStockProduct(this.value)" style="max-width:240px">
          ${invState.products.map(p=>`<option value="${p.id}" ${p.id===pid?'selected':''}>
            ${esc(p.name)}</option>`).join('')}
        </select>
      </div>
      <div style="overflow-x:auto">
      <table>
        <thead><tr><th>Colour</th>${d.sizes.map(s=>`<th>${esc(s)}</th>`).join('')}</tr></thead>
        <tbody>${Object.entries(byColor).map(([name,row])=>`<tr>
          <td data-label="Colour"><span class="swatch-dot" style="background:${esc(row.hex)}"></span>
            ${esc(name)}</td>
          ${d.sizes.map(s=>{
            const v = row.cells[s];
            if(!v) return '<td class="dim">—</td>';
            const cls = v.stock < 0 ? 'stock-neg' : v.stock <= v.low_at ? 'stock-low' : '';
            return `<td data-label="${esc(s)}">
              <input class="stock-cell ${cls}" type="text" value="${v.stock}"
                     data-vid="${v.id}" data-was="${v.stock}" title="${esc(v.sku)}"
                     onchange="setStock(this)"></td>`;
          }).join('')}
        </tr>`).join('')}</tbody>
      </table>
      </div>
      <p class="tiny dim" style="margin-top:12px">
        Negative means more has been sold than counted in — an order was placed
        against stock that was never recorded. Orders are never blocked on stock.
      </p>
    </div>`;
}
function pickStockProduct(id){
  invState.openProduct = parseInt(id, 10);
  renderStockGrid(document.getElementById('invBody'));
}
async function setStock(input){
  const next = parseInt(input.value, 10);
  if(isNaN(next)){ input.value = input.dataset.was; return; }
  const d = await api('/api/admin/catalog/stock', {
    variant_id: parseInt(input.dataset.vid, 10),
    set: next,
    reason: 'stocktake',
  });
  if(!d.ok){ toast(d.error); input.value = input.dataset.was; return; }
  input.dataset.was = d.variant.stock;
  input.value = d.variant.stock;
  toast('Stock updated');
}

/* ── Movements ───────────────────────────────────────────────── */
const MOVE_LABEL = {purchase:'Received', order:'Sold', cancel:'Order cancelled',
                    adjust:'Adjusted', damage:'Damaged', stocktake:'Stocktake'};

async function renderMoves(el){
  el.innerHTML = '<div class="empty">Loading…</div>';
  const d = await api('/api/admin/catalog/moves');
  if(!d.ok){ el.innerHTML = `<div class="empty">${esc(d.error)}</div>`; return; }
  el.innerHTML = `<div class="card">
    <h2>Stock movements</h2>
    <p class="tiny muted">Append-only. Every count change, with its reason — the
      running totals are the sum of these.</p>
    ${d.moves.length ? `<table>
      <thead><tr><th>SKU</th><th>Change</th><th>Reason</th><th>Order</th><th>Who</th></tr></thead>
      <tbody>${d.moves.map(m=>`<tr>
        <td data-label="SKU"><b>${esc(m.sku)}</b><br>
          <span class="tiny dim">${esc(m.product)} · ${esc(m.color)} · ${esc(m.size)}</span></td>
        <td data-label="Change"><b style="color:${m.delta<0?'var(--pink-ink)':'var(--lime-ink)'}">
          ${m.delta>0?'+':''}${m.delta}</b></td>
        <td data-label="Reason">${esc(MOVE_LABEL[m.reason]||m.reason)}
          ${m.note?`<br><span class="tiny dim">${esc(m.note)}</span>`:''}</td>
        <td data-label="Order" class="tiny">${m.order_id?'PL-'+(1000+m.order_id):'—'}</td>
        <td data-label="Who" class="tiny dim">${esc(m.actor||'system')} · ${esc(fmtWhen(m.created))}</td>
      </tr>`).join('')}</tbody></table>`
      : '<div class="empty">No movements recorded yet.</div>'}
  </div>`;
}

/* ── Low stock ───────────────────────────────────────────────── */
async function renderLowStock(el){
  el.innerHTML = '<div class="empty">Loading…</div>';
  const d = await api('/api/admin/catalog/low-stock');
  if(!d.ok){ el.innerHTML = `<div class="empty">${esc(d.error)}</div>`; return; }
  const neg = d.variants.filter(v=>v.negative);
  el.innerHTML = `
    ${neg.length ? `<div class="alert warn" style="margin-bottom:16px">
      <span class="material-symbols-outlined">warning</span>
      <span><b>${neg.length} variant(s) are negative.</b> Those were ordered
        against stock that had never been counted in. Set the real counts on the
        Variants &amp; stock tab.</span>
    </div>` : ''}
    ${d.uncounted ? `<div class="alert" style="margin-bottom:16px">
      <span class="material-symbols-outlined">inventory</span>
      <span><b>${d.uncounted} variant(s) have never been counted.</b> They're left
        out of this list — "low" should mean something ran down, not that it was
        never stocked. Enter real counts on the Variants &amp; stock tab and they'll
        start reporting.</span>
    </div>` : ''}
    <div class="card">
      <h2>Low stock</h2>
      <p class="tiny muted">At or below the reorder point, counting only variants
        that have been stocked at least once.</p>
      ${d.variants.length ? `<table>
        <thead><tr><th>SKU</th><th>Product</th><th>Stock</th><th>Reorder at</th></tr></thead>
        <tbody>${d.variants.map(v=>`<tr>
          <td data-label="SKU"><b>${esc(v.sku)}</b></td>
          <td data-label="Product">${esc(v.product)} · ${esc(v.color)} · ${esc(v.size)}</td>
          <td data-label="Stock"><b style="${v.negative?'color:var(--pink-ink)':''}">${v.stock}</b></td>
          <td data-label="Reorder at" class="dim">${v.low_at}</td>
        </tr>`).join('')}</tbody></table>`
        : '<div class="empty">Nothing below its reorder point.</div>'}
    </div>`;
}

/* ── Promo codes ─────────────────────────────────────────────── */
async function renderPromoCodes(el){
  el.innerHTML = '<div class="empty">Loading…</div>';
  const d = await api('/api/admin/promo');
  if(!d.ok){ el.innerHTML = `<div class="empty">${esc(d.error)}</div>`; return; }

  el.innerHTML = `
    <div class="card">
      <h2>Promo codes</h2>
      <p class="tiny muted">Validated and applied server-side at checkout — a code
        here is the only thing that can ever discount an order.</p>
      ${d.promos.length ? `<table>
        <thead><tr><th>Code</th><th>Discount</th><th>Limits</th><th>Redeemed</th><th>Status</th><th></th></tr></thead>
        <tbody>${d.promos.map(p=>`<tr>
          <td data-label="Code"><b>${esc(p.code)}</b>
            ${p.expires?`<br><span class="tiny dim">Expires ${esc(fmtDate(p.expires))}</span>`:''}</td>
          <td data-label="Discount">${p.kind==='percent'?p.value+'%':money(p.value)}
            ${p.max_discount?`<br><span class="tiny dim">capped at ${money(p.max_discount)}</span>`:''}</td>
          <td data-label="Limits" class="tiny dim">
            ${p.min_subtotal?`Min ${money(p.min_subtotal)}<br>`:''}
            ${p.max_uses?`${p.max_uses} uses total<br>`:'Unlimited uses<br>'}
            ${p.per_user_limit} per customer</td>
          <td data-label="Redeemed">${p.redeemed}</td>
          <td data-label="Status">${p.active
            ? '<span class="badge badge-lime">Active</span>'
            : '<span class="badge badge-quiet">Disabled</span>'}</td>
          <td data-label=""><button class="btn btn-quiet btn-sm"
            onclick="togglePromo(${p.id},${p.active?0:1})">${p.active?'Disable':'Enable'}</button></td>
        </tr>`).join('')}</tbody></table>`
        : '<div class="empty">No promo codes yet.</div>'}
    </div>

    <div class="card">
      <h2>New promo code</h2>
      <div class="form-grid">
        <label class="field"><span>Code</span>
          <input id="pc_code" type="text" placeholder="e.g. WELCOME10" style="text-transform:uppercase"></label>
        <label class="field"><span>Type</span>
          <select id="pc_kind">
            <option value="percent">Percent off</option>
            <option value="flat">Flat ₹ off</option>
          </select></label>
        <label class="field"><span>Value</span>
          <input id="pc_value" type="text" placeholder="e.g. 10"></label>
        <label class="field"><span>Max discount ₹ (percent only, optional)</span>
          <input id="pc_max_discount" type="text" placeholder="uncapped if blank"></label>
        <label class="field"><span>Minimum order ₹ (optional)</span>
          <input id="pc_min_subtotal" type="text" placeholder="0"></label>
        <label class="field"><span>Total uses allowed (optional)</span>
          <input id="pc_max_uses" type="text" placeholder="unlimited if blank"></label>
        <label class="field"><span>Uses per customer</span>
          <input id="pc_per_user" type="text" value="1"></label>
        <label class="field"><span>Expires (optional)</span>
          <input id="pc_expires" type="date"></label>
      </div>
      <button class="btn btn-primary" onclick="createPromo()">Create code</button>
    </div>`;
}

async function createPromo(){
  const num = id => { const v=document.getElementById(id).value.trim(); return v?parseFloat(v):null; };
  const d = await api('/api/admin/promo', {
    code: document.getElementById('pc_code').value,
    kind: document.getElementById('pc_kind').value,
    value: num('pc_value'),
    max_discount: num('pc_max_discount'),
    min_subtotal: num('pc_min_subtotal') || 0,
    max_uses: num('pc_max_uses'),
    per_user_limit: num('pc_per_user') || 1,
    expires: document.getElementById('pc_expires').value || null,
  });
  if(!d.ok){ toast(d.error); return; }
  toast(d.promo.code + ' created');
  renderPromoCodes(document.getElementById('invBody'));
}
async function togglePromo(id, active){
  const d = await api('/api/admin/promo/' + id, {active: !!active});
  if(!d.ok){ toast(d.error); return; }
  toast(active ? 'Code enabled' : 'Code disabled');
  renderPromoCodes(document.getElementById('invBody'));
}
