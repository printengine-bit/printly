/* ═══════════════ NAV ═══════════════ */
function go(v){
  if(v==='studio'){
    openProduct(state.product&&state.product.id||PRODUCTS[0].id);
    return;
  }
  state.view=v;
  document.querySelectorAll('.view').forEach(x=>x.classList.remove('on'));
  document.getElementById('v-'+v).classList.add('on');
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.toggle('on',b.dataset.v===v));
  if(v==='products') renderProducts();
  if(v==='cart') renderCart();
  if(v==='orders') renderOrders();
  if(v==='designs') renderDesigns();
  if(v==='wishlist') renderWishlistPage();
  if(v==='pdp') renderPdp();
  document.getElementById('navLinks').classList.remove('open');
  window.scrollTo({top:0});
}
function toggleMenu(){
  document.getElementById('navLinks').classList.toggle('open');
}
function toast(m){
  const t=document.getElementById('toast'); t.textContent=m; t.classList.add('on');
  setTimeout(()=>t.classList.remove('on'),2600);
}

/* ── Header search ─────────────────────────────────────────────
   One dataset (PRODUCTS, already in memory from the inlined catalogue),
   two entry points: the desktop dropdown panel (#hdrSearchPanel) and the
   mobile drawer's inline box (.nav-search) — see printly.css for why
   they're not the same element. Both call the same render/submit logic. */
function toggleHeaderSearch(){
  const panel=document.getElementById('hdrSearchPanel');
  const opening=!panel.classList.contains('on');
  panel.classList.toggle('on',opening);
  if(opening) setTimeout(()=>document.getElementById('hdrSearchInput').focus(),10);
  else document.getElementById('hdrSearchResults').innerHTML='';
}
function _searchResultsHtml(term){
  const t=term.trim().toLowerCase();
  if(!t) return '';
  const hits=PRODUCTS.filter(p=>p.name.toLowerCase().includes(t)).slice(0,6);
  if(!hits.length) return `<div class="sr-empty">Nothing matches "${esc(term)}".</div>`;
  return hits.map(p=>`
    <div class="sr-item" onclick="openProduct('${p.id}');closeHeaderSearch()">
      <span>${esc(p.name)}</span>
      <span class="t-lime t-label">From ₹${p.tiers[3][1].toLocaleString('en-IN')}</span>
    </div>`).join('');
}
function onHeaderSearchInput(term,ctx){
  const box=document.getElementById(ctx==='nav'?'navSearchResults':'hdrSearchResults');
  box.innerHTML=_searchResultsHtml(term);
}
function submitHeaderSearch(term){
  if(!term.trim()) return;
  go('products');
  document.getElementById('prodSearch').value=term;
  renderProducts();
  closeHeaderSearch();
}
function closeHeaderSearch(){
  document.getElementById('hdrSearchPanel').classList.remove('on');
  document.getElementById('hdrSearchResults').innerHTML='';
  document.getElementById('navSearchResults').innerHTML='';
  const nav=document.getElementById('navSearchInput'); if(nav) nav.value='';
  const hdr=document.getElementById('hdrSearchInput'); if(hdr) hdr.value='';
  document.getElementById('navLinks').classList.remove('open');
}
document.addEventListener('click',e=>{
  const panel=document.getElementById('hdrSearchPanel');
  if(panel && panel.classList.contains('on')
     && !panel.contains(e.target) && e.target.id!=='searchBtn'
     && !e.target.closest('#searchBtn')){
    closeHeaderSearch();
  }
});
document.addEventListener('keydown',e=>{ if(e.key==='Escape') closeHeaderSearch(); });
