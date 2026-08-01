/* ═══════════════ PRODUCTS ═══════════════ */
/* ── product card thumbnails (real mockups, not emoji) ── */
const THUMB_COLORS={rn:'#E05A1E',po:'#0D1F3C',hd:'#1A1A1A',js:'#1A6FB0',tb:'#D9CDB4',
  'rn-women':'#CE0358','po-women':'#0D1F3C','hd-women':'#7B3F96',
  'rn-oversized-women':'#E7C9EE','sw-women':'#CE0358',
  'rn-kids':'#2C82C9','hd-kids':'#F07A2B','sw-kids':'#16A36A'};
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
let prodCategory='all';
let prodAudience='all';
let reviewSummary={};   // filled by loadReviewSummary()

function setCategory(k){ prodCategory=k; renderProducts(); }
function setAudience(k){ prodAudience=k; renderProducts(); }

async function loadReviewSummary(){
  try{
    const res=await fetch(BACKEND+'/api/reviews/summary');
    const d=await res.json();
    if(d.ok){ reviewSummary=d.summary; renderProducts(); renderHomeProducts(); renderProof(); }
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
       <span class="t-label t-mut">Every review is from a confirmed order</span>`
    : `<span class="t-label t-mut"><span class="t-lime">✓</span> 48-hour dispatch from Pune</span>
       <span class="t-label t-mut"><span class="t-lime">✓</span> Digital proof before we print</span>
       <span class="t-label t-mut"><span class="t-lime">✓</span> Single-piece orders welcome</span>`;
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

  const abar=document.getElementById('prodAudienceFilters');
  if(abar) abar.innerHTML=AUDIENCES.map(a=>
    `<button class="pill${a.key===prodAudience?' on':''}" onclick="setAudience('${a.key}')">${a.label}</button>`).join('');

  const fbar=document.getElementById('prodFilters');
  if(fbar) fbar.innerHTML=CATEGORIES.map(c=>
    `<button class="pill${c.key===prodCategory?' on':''}" onclick="setCategory('${c.key}')">${c.label}</button>`).join('');

  const term=(document.getElementById('prodSearch')?.value||'').trim().toLowerCase();
  const sort=document.getElementById('prodSort')?.value||'popular';

  let list=PRODUCTS.filter(p=>{
    if(prodCategory!=='all' && p.category!==prodCategory) return false;
    // Audience tabs show the exact cut requested. Unisex products remain
    // under Everyone instead of leaking jerseys and bags into Women/Kids.
    if(prodAudience!=='all' && p.audience!==prodAudience) return false;
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
        onclick="document.getElementById('prodSearch').value='';setCategory('all')">Clear filters</button></div>`;
    return;
  }

  g.innerHTML=list.map(p=>`
    <div class="card card-hover card-lift pcard">
      <div class="pcard-img" style="cursor:pointer" onclick="openProduct('${p.id}')">
        <canvas class="pthumb" data-p="${p.id}" width="300" height="320"></canvas>
        ${wishHeart(p.id)}
      </div>
      <div class="pcard-body">
        <h3 class="pcard-name" style="cursor:pointer" onclick="openProduct('${p.id}')">${esc(p.name)}</h3>
        ${starsFor(p.id)}
        <div class="pcard-price">From <span class="t-lime">₹${p.tiers[3][1].toLocaleString('en-IN')}</span>
          <span class="t-label t-dim" style="font-weight:400"> at 100+</span></div>
        <div class="pcard-tiers">1pc ₹${p.tiers[0][1]} · 10+ ₹${p.tiers[1][1]} · 50+ ₹${p.tiers[2][1]}</div>
        <button class="btn btn-primary btn-sm btn-block" onclick="pickProduct('${p.id}')">
          Design this <span class="material-symbols-outlined" style="font-size:18px">arrow_forward</span>
        </button>
      </div>
    </div>`).join('');
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
const AUDIENCE_ICON={men:'man',women:'woman',kids:'child_care'};

function browseCategory(audience,category){
  prodAudience=audience; prodCategory=category;
  go('products');
}

function renderHomeCategories(){
  const aBar=document.getElementById('homeAudienceTiles');
  if(aBar) aBar.innerHTML=AUDIENCES.filter(a=>a.key!=='all').map(a=>{
    const count=PRODUCTS.filter(p=>p.audience===a.key).length;
    return `
    <button class="card aud" onclick="browseCategory('${a.key}','all')" aria-label="Shop ${esc(a.label)}">
      <span class="aud-top">
        <span class="aud-symbol material-symbols-outlined">${AUDIENCE_ICON[a.key]||'person'}</span>
        <span class="aud-arrow material-symbols-outlined">arrow_outward</span>
      </span>
      <span class="aud-copy">
        <span class="badge badge-lime">${esc(a.label)}</span>
        <h3>Shop ${esc(a.label)}</h3>
        <p>${count} styles ready to customise, from one piece to bulk orders.</p>
      </span>
    </button>`}).join('');

  const cBar=document.getElementById('homeCategoryTiles');
  if(cBar) cBar.innerHTML=CATEGORIES.filter(c=>c.key!=='all').map(c=>{
    const count=PRODUCTS.filter(p=>p.category===c.key).length;
    return `
    <button class="card cat-tile" onclick="browseCategory('all','${c.key}')"
      aria-label="Browse ${esc(c.label)}">
      <span class="cat-icon material-symbols-outlined">${CATEGORY_ICON[c.key]||'checkroom'}</span>
      <span class="cat-copy"><b>${esc(c.label)}</b><small>${count} ${count===1?'style':'styles'}</small></span>
      <span class="cat-arrow material-symbols-outlined">arrow_forward</span>
    </button>`}).join('');
}

function renderHomeProducts(){
  const g=document.getElementById('homeProductGrid'); if(!g || !PRODUCTS.length) return;
  const list=PRODUCTS.slice(0,4);
  g.innerHTML=list.map(p=>`
    <div class="card card-hover card-lift pcard">
      <div class="pcard-img" style="cursor:pointer" onclick="openProduct('${p.id}')">
        <canvas class="pthumb" data-p="${p.id}" width="300" height="320"></canvas>
        ${wishHeart(p.id)}
      </div>
      <div class="pcard-body">
        <h3 class="pcard-name" style="cursor:pointer" onclick="openProduct('${p.id}')">${esc(p.name)}</h3>
        ${starsFor(p.id)}
        <div class="pcard-price">From <span class="t-lime">₹${p.tiers[3][1].toLocaleString('en-IN')}</span>
          <span class="t-label t-dim" style="font-weight:400"> at 100+</span></div>
        <button class="btn btn-primary btn-sm btn-block" onclick="pickProduct('${p.id}')">
          Design this <span class="material-symbols-outlined" style="font-size:18px">arrow_forward</span>
        </button>
      </div>
    </div>`).join('');
  document.querySelectorAll('#homeProductGrid .pthumb').forEach(cnv=>drawProductThumb(cnv,cnv.dataset.p));
}

function pickProduct(id){
  openProduct(id);
}
