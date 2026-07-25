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
function renderProducts(){
  const g=document.getElementById('productGrid');
  g.innerHTML=PRODUCTS.map(p=>`
    <div class="card card-hover card-lift pcard">
      <div class="pcard-img">
        <canvas class="pthumb" data-p="${p.id}" width="300" height="320"></canvas>
      </div>
      <div class="pcard-body">
        <h3 class="pcard-name">${esc(p.name)}</h3>
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
