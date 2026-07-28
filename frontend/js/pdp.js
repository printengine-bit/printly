/* ═══════════════ PRODUCT DETAIL PAGE ═══════════════
   New page — the catalogue used to jump straight into the studio, so a
   customer never saw fabric, sizing, reviews or delivery before designing.

   The gallery reuses the same recolour engine as the studio rather than
   shipping separate per-colour photos: getRecoloredMock() already produces
   a canvas for any product/colour, so swatches here are live. */

state.pdp = {id:null, side:'front', color:'#FFFFFF', size:'M'};

/* SIZES comes from data.js. It must NOT be re-declared here: these are
   classic scripts sharing one global scope, so a duplicate `const` is a
   parse error that silently discards this entire file — the whole product
   detail page stops existing, with nothing in the console to say why. */

/* Fabric text, care instructions and the size chart all live on the
   product row now (seeded from what used to be hardcoded here), so adding
   a product in the admin panel gives it a complete detail page instead of
   one missing half its content. */

function openProduct(pid){
  state.pdp.id=pid;
  state.pdp.side='front';
  state.pdp.color='#FFFFFF';
  state.pdp.size='M';
  go('pdp');
}

function renderPdp(){
  const el=document.getElementById('pdpBody'); if(!el) return;
  const p=PRODUCTS.find(x=>x.id===state.pdp.id);
  if(!p){ el.innerHTML='<div class="empty">Product not found.</div>'; return; }

  const f={spec:p.fabric||'Premium fabric', care:p.care||[]};
  const chart=p.chart && p.chart.chest ? {label:p.fit, ...p.chart} : null;
  const hasBack=!!(MOCK.mocks[p.id+'_back']);

  el.innerHTML=`
    <div class="crumb">
      <a href="#" onclick="go('home');return false">Home</a> ›
      <a href="#" onclick="go('products');return false">Products</a> ›
      <span>${esc(p.name)}</span>
    </div>

    <div class="pdp">
      <div class="pdp-gallery">
        <div class="pdp-main"><canvas id="pdpCanvas" width="520" height="560"></canvas></div>
        <div class="pdp-thumbs">
          <div class="pdp-thumb on" data-side="front" onclick="pdpSide('front')">
            <canvas class="pdp-tc" data-side="front" width="150" height="160"></canvas>
          </div>
          ${hasBack?`<div class="pdp-thumb" data-side="back" onclick="pdpSide('back')">
            <canvas class="pdp-tc" data-side="back" width="150" height="160"></canvas>
          </div>`:''}
        </div>
      </div>

      <div>
        <h1 class="t-h1">${esc(p.name)}</h1>
        <div style="margin:12px 0 24px" id="pdpRating">${starsFor(p.id)}</div>

        <div class="t-label t-mut" style="margin-bottom:8px">Bulk pricing</div>
        <div class="tiers">
          ${p.tiers.map((t,i)=>`<div class="tier${i===3?' best':''}">
            <div class="tier-q">${t[0]}${i===p.tiers.length-1?'+':'–'+(p.tiers[i+1]?p.tiers[i+1][0]-1:'')} pcs</div>
            <div class="tier-p">₹${t[1].toLocaleString('en-IN')}</div>
          </div>`).join('')}
        </div>
        <p class="t-dim" style="font-size:12px;margin-bottom:24px">Inclusive of printing. GST and shipping shown at checkout.</p>

        <div class="t-label t-mut" style="margin-bottom:10px">Colour</div>
        <div class="swatches" style="margin-bottom:24px">
          ${SHIRT_COLORS.map(c=>`<div class="sw${c===state.pdp.color?' on':''}"
             style="background:${c}" title="${c}" onclick="pdpColor('${c}')"></div>`).join('')}
        </div>

        ${chart&&chart.chest.length>1?`
        <div class="spread" style="margin-bottom:10px">
          <span class="t-label t-mut">Size</span>
          <a href="#" class="t-lime t-label" onclick="document.getElementById('sizeChart').open=true;return false">Size guide</a>
        </div>
        <div class="sizes" style="margin-bottom:24px">
          ${SIZES.map(s=>`<button class="size-btn${s===state.pdp.size?' on':''}" onclick="pdpSize('${s}')">${s}</button>`).join('')}
        </div>`:''}

        <button class="btn btn-primary btn-block" onclick="pickProduct('${p.id}')">
          Design this in Studio <span class="material-symbols-outlined">arrow_forward</span>
        </button>

        <div class="deliv">
          <div class="row" style="gap:8px;margin-bottom:10px">
            <span class="material-symbols-outlined t-lime" style="font-size:20px">local_shipping</span>
            <span class="t-label">Delivery estimate</span>
          </div>
          <div class="row" style="gap:8px">
            <input class="inp" id="pinInput" placeholder="Enter 6-digit pincode" maxlength="6" inputmode="numeric">
            <button class="btn btn-quiet btn-sm" onclick="checkPincode()">Check</button>
          </div>
          <div id="pinResult" style="font-size:13px;margin-top:10px"></div>
        </div>

        <details class="acc"><summary>Fabric &amp; composition</summary>
          <p>${esc(f.spec)}</p></details>
        <details class="acc"><summary>Care instructions</summary>
          <ul>${f.care.map(c=>`<li>${esc(c)}</li>`).join('')}</ul></details>
        ${chart?`<details class="acc" id="sizeChart"><summary>Size guide — ${esc(chart.label)}</summary>
          <table class="size-table">
            <tr><th>Size</th><th>Chest (in)</th><th>Length (cm)</th></tr>
            ${chart.chest.map((c,i)=>`<tr><td><b>${chart.chest.length>1?SIZES[i]:'One size'}</b></td>
              <td>${c}</td><td>${chart.length[i]}</td></tr>`).join('')}
          </table>
          <p style="font-size:12px">Chest measured flat, armpit to armpit. Allow ±1 in tolerance.</p>
        </details>`:''}
      </div>
    </div>

    <div class="section-sm" style="margin-top:24px">
      <div class="spread" style="margin-bottom:24px">
        <h2 class="t-h2">Community <span class="t-lime">feedback</span></h2>
        <div id="reviewAction"></div>
      </div>
      <div id="reviewList"></div>
    </div>

    <div class="section-sm">
      <h2 class="t-h2" style="margin-bottom:24px">Complete the <span class="t-lime">look</span></h2>
      <div class="grid grid-4">
        ${PRODUCTS.filter(x=>x.id!==p.id).slice(0,4).map(x=>`
          <div class="card card-hover pcard" style="cursor:pointer" onclick="openProduct('${x.id}')">
            <div class="pcard-img"><canvas class="pthumb" data-p="${x.id}" width="300" height="320"></canvas></div>
            <div class="pcard-body">
              <h3 class="pcard-name" style="font-size:15px">${esc(x.name)}</h3>
              <div class="pcard-price">From <span class="t-lime">₹${x.tiers[3][1].toLocaleString('en-IN')}</span></div>
            </div>
          </div>`).join('')}
      </div>
    </div>`;

  drawPdp();
  document.querySelectorAll('.pthumb').forEach(c=>drawProductThumb(c,c.dataset.p));
  loadReviews(p.id);
}

/* Paint the gallery from the shared recolour engine. */
function drawPdp(){
  const p=PRODUCTS.find(x=>x.id===state.pdp.id); if(!p) return;
  const key = state.pdp.side==='back' && MOCK.mocks[p.id+'_back'] ? p.id+'_back' : p.id;

  const paint=(cnv,k)=>{
    if(!cnv) return;
    const c=cnv.getContext('2d');
    c.clearRect(0,0,cnv.width,cnv.height);
    const mock=getRecoloredMock(k,state.pdp.color) || mockImgs[k];
    if(!mock){ drawGarment(c,p.id,state.pdp.color); return; }
    const iw=mock.width||mock.naturalWidth, ih=mock.height||mock.naturalHeight;
    const s=Math.min(cnv.width/iw,cnv.height/ih);
    const ox=(cnv.width-iw*s)/2, oy=(cnv.height-ih*s)/2;
    // Thumbnails are small, so scale the corner radius with the canvas.
    drawStage(c,state.pdp.color,ox,oy,iw*s,ih*s,cnv.width<120?6:16);
    c.drawImage(mock,ox,oy,iw*s,ih*s);
  };
  paint(document.getElementById('pdpCanvas'),key);
  document.querySelectorAll('.pdp-tc').forEach(cnv=>{
    const s=cnv.dataset.side;
    paint(cnv, s==='back'&&MOCK.mocks[p.id+'_back'] ? p.id+'_back' : p.id);
  });
}

function pdpSide(side){
  state.pdp.side=side;
  document.querySelectorAll('.pdp-thumb').forEach(t=>t.classList.toggle('on',t.dataset.side===side));
  drawPdp();
}
function pdpColor(c){
  state.pdp.color=c;
  document.querySelectorAll('#v-pdp .sw').forEach(el=>el.classList.toggle('on',el.title===c));
  drawPdp();
}
function pdpSize(s){
  state.pdp.size=s;
  document.querySelectorAll('.size-btn').forEach(b=>b.classList.toggle('on',b.textContent===s));
}

async function checkPincode(){
  const pin=(document.getElementById('pinInput').value||'').trim();
  const out=document.getElementById('pinResult');
  out.innerHTML='<span class="t-dim">Checking…</span>';
  try{
    const res=await fetch(BACKEND+'/api/shipping/estimate?pincode='+encodeURIComponent(pin));
    const d=await res.json();
    out.innerHTML = d.ok
      ? `<span class="t-lime">Delivers in ${d.min_days}–${d.max_days} days</span>
         <span class="t-dim"> · ${esc(d.region)}</span><br>
         <span class="t-dim" style="font-size:11px">${esc(d.note)}</span>`
      : `<span class="t-pink">${esc(d.error)}</span>`;
  }catch(err){ out.innerHTML='<span class="t-pink">Could not reach the server.</span>'; }
}

/* ── Reviews ── */
async function loadReviews(pid){
  const list=document.getElementById('reviewList');
  const action=document.getElementById('reviewAction');
  if(!list) return;
  try{
    const res=await fetch(BACKEND+'/api/reviews/'+pid,{credentials:'include'});
    const d=await res.json();

    action.innerHTML = d.can_review
      ? `<button class="btn btn-ghost btn-sm" onclick="writeReview('${pid}')">
           <span class="material-symbols-outlined" style="font-size:18px">edit</span> Write a review</button>`
      : `<span class="t-dim" style="font-size:12px">${
            state.user ? 'Only verified buyers can review' : 'Sign in after ordering to review'}</span>`;

    if(!d.reviews.length){
      list.innerHTML=`<div class="empty">
        <span class="material-symbols-outlined">reviews</span><br>
        No reviews yet — be the first after your order arrives.</div>`;
      return;
    }
    list.innerHTML=`<div class="grid grid-3">`+d.reviews.map(r=>`
      <div class="review">
        <div class="review-head">
          <div class="avatar">${esc(r.author.trim().charAt(0).toUpperCase())}</div>
          <div>
            <div style="font-weight:600;font-size:14px">${esc(r.author)}</div>
            <div class="stars">${'★'.repeat(r.rating)}${'☆'.repeat(5-r.rating)}</div>
          </div>
        </div>
        ${r.body?`<p class="t-mut" style="font-size:14px">${esc(r.body)}</p>`:''}
      </div>`).join('')+`</div>`;
  }catch(err){ list.innerHTML='<div class="empty">Could not load reviews.</div>'; }
}

async function writeReview(pid){
  const raw=prompt('Rate this product from 1 to 5');
  if(raw===null) return;
  const rating=parseInt(raw,10);
  if(!(rating>=1&&rating<=5)){ toast('Enter a number from 1 to 5'); return; }
  const body=prompt('Add a comment (optional)')||'';
  try{
    const res=await fetch(BACKEND+'/api/reviews/'+pid,{
      method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',
      body:JSON.stringify({rating,body}),
    });
    const d=await res.json();
    if(!d.ok){ toast(d.error||'Could not post review'); return; }
    toast('Thanks for the review');
    loadReviews(pid); loadReviewSummary();
  }catch(err){ toast('Could not reach the server — try again.'); }
}
