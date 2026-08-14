/* ═══════════════ PRODUCTS ═══════════════ */
/* ── product card thumbnails (real mockups, not emoji) ── */
const THUMB_COLORS={rn:'#E05A1E',po:'#0D1F3C',hd:'#1A1A1A',js:'#1A6FB0',tb:'#D9CDB4',
  'rn-women':'#CE0358','po-women':'#0D1F3C','hd-women':'#7B3F96',
  'rn-oversized-women':'#E7C9EE','sw-women':'#CE0358',
  'rn-kids':'#2C82C9','hd-kids':'#F07A2B','sw-kids':'#16A36A'};
/* Real studio photography, one per product id — supplied directly, not
   scraped. Every id in THUMB_COLORS has a matching photo today; a future
   product without one falls back to the canvas render in productThumbHtml(). */
const PRODUCT_PHOTO={
  rn:'img/products/rn.jpg', po:'img/products/po.jpg', hd:'img/products/hd.jpg',
  js:'img/products/js.jpg', tb:'img/products/tb.jpg',
  'rn-women':'img/products/rn-women.jpg', 'po-women':'img/products/po-women.jpg',
  'hd-women':'img/products/hd-women.jpg', 'rn-oversized-women':'img/products/rn-oversized-women.jpg',
  'sw-women':'img/products/sw-women.jpg',
  'rn-kids':'img/products/rn-kids.jpg', 'hd-kids':'img/products/hd-kids.jpg',
  'sw-kids':'img/products/sw-kids.jpg',
};
/* Real per-angle photography for the PDP gallery — a product listed here
   shows these actual photos (in this order) instead of the studio's
   canvas-recolored mockup. Deliberately separate from PRODUCT_PHOTO: that
   map is one fixed card thumbnail regardless of garment colour picked,
   and this is the same trade-off applied to the bigger product-page
   gallery — a real photoshoot for the colour it was shot in, not a
   recolor that tracks the swatch grid. Products without an entry here
   keep the live canvas gallery in pdp.js, which does track colour. */
const PRODUCT_GALLERY={
  rn:[
    {label:'Front', src:'img/products/gallery/rn-front.jpg'},
    {label:'Back', src:'img/products/gallery/rn-back.jpg'},
    {label:'Detail', src:'img/products/gallery/rn-detail.jpg'},
  ],
  po:[
    {label:'Front', src:'img/products/gallery/po-front.jpg'},
    {label:'Back', src:'img/products/gallery/po-back.jpg'},
    {label:'Detail', src:'img/products/gallery/po-detail.jpg'},
  ],
};
/* Shared product-card thumbnail markup — a real photo where PRODUCT_PHOTO
   has one, otherwise the same canvas-rendered garment thumb every other
   pthumb site already used. Callers that keep the canvas path still need
   to run drawProductThumb() themselves after inserting this HTML. */
function productThumbHtml(id,w,h){
  const photo=PRODUCT_PHOTO[id];
  return photo
    ? `<img src="${photo}" alt="" loading="lazy">`
    : `<canvas class="pthumb" data-p="${id}" width="${w}" height="${h}"></canvas>`;
}
function jerseyBackPrint(c){
  c.save();
  // accent side stripes
  c.fillStyle='#F0692B';
  c.fillRect(142,190,18,306); c.fillRect(360,190,18,306);
  // collar trim
  c.strokeStyle='#F0692B'; c.lineWidth=7; c.lineJoin='round'; c.lineCap='round';
  c.beginPath(); c.moveTo(160,100); c.lineTo(260,153); c.lineTo(360,100); c.stroke();
  // back print
  c.textAlign='center';
  c.fillStyle='#FFE9A8'; c.font='700 24px "Archivo Narrow"';
  c.fillText('PRINT ENGINE',260,205);                        // sponsor 1
  c.fillStyle='#FFFFFF'; c.font='700 34px "Archivo Narrow"';
  c.fillText('SHARMA',260,256);                         // player name
  c.font='700 132px "Archivo Narrow"';
  c.fillText('10',260,382);                             // number
  c.strokeStyle='rgba(255,255,255,.65)'; c.lineWidth=2;
  c.strokeText('10',260,382);
  c.fillStyle='#FFE9A8'; c.font='700 20px "Archivo Narrow"';
  c.fillText('TATA MOTORS',260,458);                    // sponsor 2
  c.restore();
}
function toteArt(c){
  c.save(); c.textAlign='center';
  c.fillStyle='#0D1F3C'; c.font='700 30px "Archivo Narrow"';
  c.fillText('PRINT ENGINE',260,330);
  c.strokeStyle='#E05A1E'; c.lineWidth=3;
  c.beginPath(); c.moveTo(205,348); c.lineTo(315,348); c.stroke();
  c.restore();
}
function teeArt(c,txt,col){
  c.save(); c.textAlign='center'; c.fillStyle=col;
  c.font='700 38px "Archivo Narrow"'; c.fillText(txt,260,290);
  c.restore();
}
function drawProductThumb(cnv,id){
  const c=cnv.getContext('2d');
  c.clearRect(0,0,cnv.width,cnv.height);
  // photo mockup thumbnail if available
  const configured=printViews(id)[0]?.mock||id;
  const mock=MOCK.mocks[configured] ? configured : photoMockKey(id);
  const img=getRecoloredMock(mock,THUMB_COLORS[id]||'#FFFFFF');
  if(img){
    const iw=img.naturalWidth||img.width,ih=img.naturalHeight||img.height;
    const sc=Math.min(cnv.width/iw,cnv.height/ih);
    const dw=iw*sc,dh=ih*sc;
    drawStage(c,THUMB_COLORS[id]||'#FFFFFF',0,0,cnv.width,cnv.height,0);
    drawMockup(c,img,(cnv.width-dw)/2,(cnv.height-dh)/2,dw,dh);
    return;
  }
  const s=Math.min(cnv.width/520,cnv.height/560);
  c.save();
  c.translate((cnv.width-520*s)/2,(cnv.height-560*s)/2);
  c.scale(s,s);
  drawGarment(c,id,THUMB_COLORS[id]||'#FFFFFF');
  if(id==='js') jerseyBackPrint(c);
  if(id==='tb') toteArt(c);
  if(id==='rn') teeArt(c,'YOUR ART','#FFFFFF');
  if(id==='hd') teeArt(c,'BATCH 26','#E0B23C');
  if(id==='po') teeArt(c,'ACME','#FFFFFF');
  c.restore();
}
/* Catalogue filtering is client-side on purpose — the catalogue is a
   couple dozen products at most, so a search endpoint would be more
   moving parts for no benefit. category/audience come from the DB
   (catalog_payload) now, not a hardcoded id list, so a new product
   seeded on the backend shows up here with zero frontend changes. */
const CATEGORIES=[
  {key:'all',    label:'All items'},
  {key:'tees',   label:'Tees'},
  {key:'polos',  label:'Polos'},
  {key:'hoodies',label:'Hoodies'},
  {key:'sweatshirts',label:'Sweatshirts'},
  {key:'jerseys',label:'Jerseys'},
  {key:'bags',   label:'Bags'},
];
const AUDIENCES=[
  {key:'all',   label:'Everyone'},
  {key:'men',   label:'Men'},
  {key:'women', label:'Women'},
  {key:'kids',  label:'Kids'},
];
/* Checkbox facets, not single-select pills — empty Set means "no filter
   on this facet", not "nothing matches". A checked box means "include
   this", so multiple checked boxes in one facet are OR'd together
   (checking Tees and Polos shows both), while separate facets AND
   together (Tees + Men shows only men's tees). */
let prodCategories=new Set();
let prodAudiences=new Set();
let prodColors=new Set();
let reviewSummary={};   // filled by loadReviewSummary()

/* Flips one checkbox's value in the right Set and re-renders just the
   grid — the sidebar markup itself never needs rebuilding for this, so
   an open <details> section and scroll position survive every click. */
function onProdFilterChange(el){
  const set = el.dataset.group==='category' ? prodCategories
            : el.dataset.group==='audience' ? prodAudiences : prodColors;
  if(el.checked) set.add(el.value); else set.delete(el.value);
  renderProducts();
}

function clearProductFilters(){
  prodCategories=new Set(); prodAudiences=new Set(); prodColors=new Set();
  const s=document.getElementById('prodSearch'); if(s) s.value='';
  syncProductFilterCheckboxes();
  renderProducts();
}

/* Reflects the three Sets onto the checkboxes already in the DOM —
   used after browseCategory()/clearProductFilters() change the Sets
   programmatically, since a user click already updates its own checkbox
   natively and doesn't need this. */
function syncProductFilterCheckboxes(){
  document.querySelectorAll('#prodFilterSidebar input[type=checkbox]').forEach(el=>{
    const set = el.dataset.group==='category' ? prodCategories
              : el.dataset.group==='audience' ? prodAudiences : prodColors;
    el.checked = set.has(el.value);
  });
}

function renderProductFilterSidebar(){
  const el=document.getElementById('prodFilterSidebar'); if(!el) return;
  const checkRow=(group,value,label,extra)=>`
    <label class="filter-check">
      <input type="checkbox" data-group="${group}" value="${esc(value)}" onchange="onProdFilterChange(this)">
      ${extra||''}<span>${esc(label)}</span>
    </label>`;
  el.innerHTML=`
    <details class="acc" open><summary>Category</summary>
      <div class="filter-check-list">
        ${CATEGORIES.filter(c=>c.key!=='all').map(c=>{
          const n=PRODUCTS.filter(p=>p.category===c.key).length;
          return checkRow('category',c.key,`${c.label} (${n})`);
        }).join('')}
      </div>
    </details>
    <details class="acc" open><summary>Shop for</summary>
      <div class="filter-check-list">
        ${AUDIENCES.filter(a=>a.key!=='all').map(a=>{
          const n=PRODUCTS.filter(p=>p.audience===a.key).length;
          return checkRow('audience',a.key,`${a.label} (${n})`);
        }).join('')}
      </div>
    </details>
    <details class="acc" open><summary>Colour</summary>
      <div class="filter-check-list">
        ${CATALOG.colors.map(c=>
          checkRow('color',c.hex,c.name,
            `<span class="swatch-dot" style="background:${esc(c.hex)}"></span>`)
        ).join('')}
      </div>
    </details>
    <button class="btn btn-quiet btn-sm btn-block" onclick="clearProductFilters()">Clear filters</button>`;
}

async function loadReviewSummary(){
  try{
    const res=await fetch(BACKEND+'/api/reviews/summary');
    const d=await res.json();
    if(d.ok){ reviewSummary=d.summary; renderProducts(); renderHomeProducts();
      renderHomeBestSellers(); renderHomeNewArrivals(); renderProof(); }
  }catch(err){ /* ratings are additive — the grid works without them */ }
}

/* Home's social-proof strip.
   Deliberately driven by real review data. The mockup showed "50k+ orders
   delivered", but inventing a number on a live storefront is a false claim,
   so with no reviews yet this falls back to the service guarantees, which
   are actually true. */
function renderProof(){
  const el=document.getElementById('homeProof'); if(!el) return;
  const rows=Object.values(reviewSummary);
  const count=rows.reduce((s,r)=>s+r.count,0);
  const avg=count ? rows.reduce((s,r)=>s+r.average*r.count,0)/count : 0;

  el.innerHTML = count
    ? `<div class="row"><span class="stars">${'★'.repeat(Math.round(avg))}${'☆'.repeat(5-Math.round(avg))}</span>
         <b>${avg.toFixed(1)}</b>
         <span class="t-label t-mut">from ${count} verified ${count===1?'review':'reviews'}</span></div>
       <span class="proof-badge"><span class="material-symbols-outlined">verified</span><span>Every review from a confirmed order</span></span>`
    : `<span class="proof-badge"><span class="material-symbols-outlined">bolt</span><span>48-hour dispatch from Pune</span></span>
       <span class="proof-badge"><span class="material-symbols-outlined">verified</span><span>Digital proof before we print</span></span>
       <span class="proof-badge"><span class="material-symbols-outlined">package_2</span><span>Single-piece orders welcome</span></span>`;
}

function starsFor(pid){
  const r=reviewSummary[pid];
  if(!r) return `<span class="rating t-dim">No reviews yet</span>`;
  return `<span class="rating">
    <span class="material-symbols-outlined fill">star</span>
    <b style="color:var(--on-surface)">${r.average.toFixed(1)}</b> (${r.count})</span>`;
}

function renderProducts(){
  const g=document.getElementById('productGrid'); if(!g) return;
  if(!document.getElementById('prodFilterSidebar').innerHTML) renderProductFilterSidebar();

  const term=(document.getElementById('prodSearch')?.value||'').trim().toLowerCase();
  const sort=document.getElementById('prodSort')?.value||'popular';

  let list=PRODUCTS.filter(p=>{
    if(prodCategories.size && !prodCategories.has(p.category)) return false;
    // Unisex products remain visible under no audience filter rather than
    // leaking jerseys and bags into a checked Men/Women/Kids box — they
    // simply aren't tagged with any of the three, so the audience facet
    // correctly excludes them once anything there is checked.
    if(prodAudiences.size && !prodAudiences.has(p.audience)) return false;
    if(prodColors.size && !(p.colors||[]).some(hex=>prodColors.has(hex))) return false;
    return !term || p.name.toLowerCase().includes(term);
  });
  const rating=p=>reviewSummary[p.id]?.average||0;
  if(sort==='low')   list=[...list].sort((a,b)=>a.tiers[0][1]-b.tiers[0][1]);
  if(sort==='high')  list=[...list].sort((a,b)=>b.tiers[0][1]-a.tiers[0][1]);
  if(sort==='rated') list=[...list].sort((a,b)=>rating(b)-rating(a));

  if(!list.length){
    g.innerHTML=`<div class="empty" style="grid-column:1/-1">
      <span class="material-symbols-outlined">search_off</span><br>
      Nothing matches that.<br>
      <button class="btn btn-quiet btn-sm" style="margin-top:16px"
        onclick="clearProductFilters()">Clear filters</button></div>`;
    return;
  }

  g.innerHTML=list.map(_productCardHtml).join('');
  document.querySelectorAll('.pthumb').forEach(cnv=>drawProductThumb(cnv,cnv.dataset.p));
}
/* ── Home page merchandising ──────────────────────────────────────
   The home page used to end at the hero with no path to an actual
   product — no category tiles, no product grid, nothing that reads as
   a store. These render into the containers added in index.html and
   share CATEGORIES/AUDIENCES with the products page so there's one
   list of categories, not two that can drift. */
const CATEGORY_ICON={tees:'checkroom',polos:'checkroom',hoodies:'dry_cleaning',
  sweatshirts:'styler',jerseys:'sports_score',bags:'shopping_bag'};
/* Real studio photography, one per category — supplied directly, not
   scraped from any design-tool preview. Falls back to the canvas-rendered
   garment thumb (see below) for any category without a photo yet. */
const CATEGORY_PHOTO={
  tees:'img/category/tees.jpg', polos:'img/category/polos.jpg',
  hoodies:'img/category/hoodies.jpg', sweatshirts:'img/category/sweatshirts.jpg',
  jerseys:'img/category/jerseys.jpg', bags:'img/category/bags.jpg',
};
const AUDIENCE_ICON={men:'man',women:'woman',kids:'child_care'};

function browseCategory(audience,category){
  prodAudiences = audience==='all' ? new Set() : new Set([audience]);
  prodCategories = category==='all' ? new Set() : new Set([category]);
  prodColors = new Set();
  syncProductFilterCheckboxes();
  go('products');
}

/* A representative product per audience/category, for the photo tiles
   below — the first active product in that cut, same ordering the
   catalogue already uses (products.sort). Falls back to null (icon-only
   tile) rather than breaking if a category is momentarily empty. */
function _repProduct(filterFn){
  return PRODUCTS.find(filterFn) || null;
}

function renderHomeCategories(){
  const aBar=document.getElementById('homeAudienceTiles');
  if(aBar) aBar.innerHTML=AUDIENCES.filter(a=>a.key!=='all').map(a=>{
    const count=PRODUCTS.filter(p=>p.audience===a.key).length;
    const rep=_repProduct(p=>p.audience===a.key);
    return `
    <button class="card aud" onclick="browseCategory('${a.key}','all')" aria-label="Shop ${esc(a.label)}">
      <span class="aud-top">
        <span class="aud-symbol">
          ${rep ? `<canvas class="pthumb" data-p="${rep.id}" width="96" height="96"></canvas>`
                : `<span class="material-symbols-outlined">${AUDIENCE_ICON[a.key]||'person'}</span>`}
        </span>
        <span class="aud-arrow material-symbols-outlined">arrow_outward</span>
      </span>
      <span class="aud-copy">
        <span class="badge badge-lime">${esc(a.label)}</span>
        <h3>Shop ${esc(a.label)}</h3>
        <p>${count} styles ready to customise, from one piece to bulk orders.</p>
      </span>
    </button>`}).join('');
  document.querySelectorAll('#homeAudienceTiles .pthumb').forEach(cnv=>drawProductThumb(cnv,cnv.dataset.p));

  renderCategoryScrollRow();
}

/* Coming soon, not a real category yet — no product line, no print
   method wired up behind it. Shown so the merchandising row reads
   complete now, without pretending a click would go anywhere real. */
const COMING_SOON_CATEGORIES = [
  {key:'embroidery', label:'Embroidery', icon:'auto_awesome', photo:'img/category/embroidery.jpg'},
];

/* Editorial 4:5 photo cards — "Customize Clothing" pattern from the
   Industrial Editorial reference. Real studio photo where CATEGORY_PHOTO
   has one; otherwise the canvas-rendered garment thumb (same technique
   as everywhere else — never a raw <img> — see mockups.js) as a
   fallback for categories without photography yet. */
function renderCategoryScrollRow(){
  const cBar=document.getElementById('homeCategoryTiles'); if(!cBar) return;
  const real=CATEGORIES.filter(c=>c.key!=='all').map(c=>{
    const photo=CATEGORY_PHOTO[c.key];
    const rep=photo ? null : _repProduct(p=>p.category===c.key);
    return `
    <a class="cat-editorial-card" href="#" onclick="browseCategory('all','${c.key}');return false"
      aria-label="Browse ${esc(c.label)}">
      <span class="cat-editorial-photo">
        ${photo ? `<img src="${photo}" alt="" loading="lazy">`
        : rep ? `<canvas class="pthumb" data-p="${rep.id}" width="320" height="400"></canvas>`
              : `<span class="material-symbols-outlined">${CATEGORY_ICON[c.key]||'checkroom'}</span>`}
      </span>
      <span class="cat-editorial-title">
        <span>${esc(c.label)}</span>
        <span class="material-symbols-outlined">arrow_forward</span>
      </span>
    </a>`;
  }).join('');
  const soon=COMING_SOON_CATEGORIES.map(c=>`
    <a class="cat-editorial-card" href="#"
      onclick="toast('${esc(c.label)} is coming soon — check back shortly.');return false"
      aria-label="${esc(c.label)} — coming soon">
      <span class="cat-editorial-photo cat-editorial-soon">
        ${c.photo ? `<img src="${c.photo}" alt="" loading="lazy">`
                  : `<span class="material-symbols-outlined">${c.icon}</span>`}
      </span>
      <span class="cat-editorial-title">
        <span>${esc(c.label)}</span>
        <span class="t-label t-dim" style="font-size:10px">Coming soon</span>
      </span>
    </a>`).join('');
  cBar.innerHTML = real + soon;
  document.querySelectorAll('#homeCategoryTiles .pthumb').forEach(cnv=>drawProductThumb(cnv,cnv.dataset.p));
}

/* Persistent category nav under the header — same CATEGORIES list the
   products page filters with, so there's one list, not two that drift. */
function renderHeaderCatNav(){
  const el=document.getElementById('headerCatNav'); if(!el) return;
  const items=[{key:'all',label:'All products'}, ...CATEGORIES.filter(c=>c.key!=='all')];
  el.innerHTML=items.map(c=>`
    <button class="cat-nav-link" onclick="browseCategory('all','${c.key}')">${esc(c.label)}</button>`).join('');
}

/* ── Home merchandising rails ──────────────────────────────────────
   Three rails, one shared card (_productCardHtml, data.js):
   Best sellers (real order counts), New arrivals (most recently added),
   and the full collection (a browse-everything bridge — not a ranking
   claim, unlike the other two). */
function _bestSellerList(){
  const bySlug=Object.fromEntries(PRODUCTS.map(p=>[p.id,p]));
  // No paid orders yet ⇒ no real signal — fall back to catalogue order
  // rather than render a rail that's lying about what's popular. Reversed
  // (not the same first 4 as "Shop the collection" below) so the two
  // rails don't show an identical lineup while there's no real signal.
  const ranked=BEST_SELLERS.map(id=>bySlug[id]).filter(Boolean);
  return (ranked.length ? ranked : [...PRODUCTS].reverse()).slice(0,4);
}
function renderHomeBestSellers(){
  const g=document.getElementById('homeBestSellers'); if(!g || !PRODUCTS.length) return;
  const list=_bestSellerList();
  g.innerHTML=list.map(_productCardHtml).join('');
  document.querySelectorAll('#homeBestSellers .pthumb').forEach(cnv=>drawProductThumb(cnv,cnv.dataset.p));
}

function _newArrivalsList(excludeIds){
  const bySlug=Object.fromEntries(PRODUCTS.map(p=>[p.id,p]));
  return NEW_ARRIVALS.map(id=>bySlug[id]).filter(Boolean)
    .filter(p=>!excludeIds.has(p.id)).slice(0,4);
}
function renderHomeNewArrivals(){
  const g=document.getElementById('homeNewArrivals'); const section=document.getElementById('homeNewArrivalsSection');
  if(!g || !PRODUCTS.length) return;
  // Skip whatever Best Sellers (above this rail on the page) is already
  // showing — same reasoning as renderHomeProducts() below.
  const bestIds=new Set(_bestSellerList().map(p=>p.id));
  const list=_newArrivalsList(bestIds);
  if(section) section.style.display = list.length ? '' : 'none';
  g.innerHTML=list.map(_productCardHtml).join('');
  document.querySelectorAll('#homeNewArrivals .pthumb').forEach(cnv=>drawProductThumb(cnv,cnv.dataset.p));
}

function renderHomeDeals(){
  const section=document.getElementById('homeDealsSection'); if(!section) return;
  // Hidden, not an empty "Deals" heading, when nothing's featured — see
  // promo_codes.featured. Most shops most of the time have zero.
  section.style.display = DEALS.length ? '' : 'none';
  if(!DEALS.length) return;
  document.getElementById('homeDealsStrip').innerHTML=DEALS.map(d=>{
    const off = d.kind==='percent' ? `${d.value}% off` : `₹${d.value} off`;
    const min = d.min_subtotal ? ` on orders over ₹${d.min_subtotal.toLocaleString('en-IN')}` : '';
    return `
    <div class="card deal-card">
      <span class="material-symbols-outlined">sell</span>
      <div>
        <b>${off}${esc(min)}</b>
        <div class="t-mut" style="font-size:12.5px">Use code <span class="t-lime" style="font-weight:700">${esc(d.code)}</span> at checkout</div>
      </div>
    </div>`;
  }).join('');
}

function renderHomeProducts(){
  const g=document.getElementById('homeProductGrid'); if(!g || !PRODUCTS.length) return;
  // Skip whatever Best Sellers and New Arrivals (both above this rail on
  // the page) are already showing — three rails repeating the same 4
  // products isn't a browse-everything bridge, it's just one rail
  // rendered three times.
  const bestIds=new Set(_bestSellerList().map(p=>p.id));
  const newIds=new Set(_newArrivalsList(bestIds).map(p=>p.id));
  const excluded=new Set([...bestIds,...newIds]);
  const list=PRODUCTS.filter(p=>!excluded.has(p.id)).slice(0,4);
  g.innerHTML=list.map(_productCardHtml).join('');
  document.querySelectorAll('#homeProductGrid .pthumb').forEach(cnv=>drawProductThumb(cnv,cnv.dataset.p));
}

