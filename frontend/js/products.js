/* ═══════════════ PRODUCTS ═══════════════ */
/* ── product card thumbnails (real mockups, not emoji) ── */
const THUMB_COLORS={rn:'#E05A1E',po:'#0D1F3C',hd:'#1A1A1A',js:'#1A6FB0',tb:'#D9CDB4'};
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
  c.fillText('PRINTLY',260,205);                        // sponsor 1
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
  c.fillText('PRINTLY',260,330);
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
  const img=mockImgs[id];
  if(img){
    const iw=img.naturalWidth,ih=img.naturalHeight;
    const sc=Math.min(cnv.width/iw,cnv.height/ih);
    const dw=iw*sc,dh=ih*sc;
    c.drawImage(img,(cnv.width-dw)/2,(cnv.height-dh)/2,dw,dh);
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
/* Catalogue filtering is client-side on purpose — there are five products,
   so a search endpoint would be more moving parts for no benefit. */
const CATEGORIES=[
  {key:'all',   label:'All items'},
  {key:'tees',  label:'Tees',     ids:['rn']},
  {key:'polos', label:'Polos',    ids:['po']},
  {key:'hoodies',label:'Hoodies', ids:['hd']},
  {key:'jerseys',label:'Jerseys', ids:['js']},
  {key:'bags',  label:'Bags',     ids:['tb']},
];
let prodCategory='all';
let reviewSummary={};   // filled by loadReviewSummary()

function setCategory(k){ prodCategory=k; renderProducts(); }

async function loadReviewSummary(){
  try{
    const res=await fetch(BACKEND+'/api/reviews/summary');
    const d=await res.json();
    if(d.ok){ reviewSummary=d.summary; renderProducts(); renderProof(); }
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

  const fbar=document.getElementById('prodFilters');
  if(fbar) fbar.innerHTML=CATEGORIES.map(c=>
    `<button class="pill${c.key===prodCategory?' on':''}" onclick="setCategory('${c.key}')">${c.label}</button>`).join('');

  const term=(document.getElementById('prodSearch')?.value||'').trim().toLowerCase();
  const sort=document.getElementById('prodSort')?.value||'popular';
  const cat=CATEGORIES.find(c=>c.key===prodCategory);

  let list=PRODUCTS.filter(p=>{
    if(cat && cat.ids && !cat.ids.includes(p.id)) return false;
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
function pickProduct(id){
  state.product=PRODUCTS.find(p=>p.id===id);
  document.getElementById('stProduct').value=id;
  toggleJerseyKit();
  updateProductSub();
  go('studio'); updatePrice(); draw(); toast(state.product.name+' selected');
}
