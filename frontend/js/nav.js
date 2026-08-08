/* ═══════════════ NAV ═══════════════ */
/* Reads the real free-shipping threshold off TAX (data.js), which is the
   same company row checkout prices against — never a separate hardcoded
   figure that could say one thing here and charge another at the cart. */
function renderPromoBar(){
  const el=document.getElementById('promoBar'); if(!el) return;
  const over=TAX.free_shipping_over;
  el.textContent = over
    ? `Free shipping on orders over ₹${over.toLocaleString('en-IN')} · No minimum order quantity`
    : `No minimum order quantity — single pieces welcome`;
}

function go(v){
  /* There is no Studio *destination* any more — the editor is mounted into
     the PDP, so designing always starts from picking a product. Nothing in
     the UI routes here now, but the guard stays: `#v-studio` still exists as
     the parking spot the editor lives in while it isn't mounted, so without
     this a stray go('studio') would show that empty div as a blank page. */
  if(v==='studio'){
    openProduct(state.product&&state.product.id||PRODUCTS[0].id);
    return;
  }
  state.view=v;
  document.body.classList.toggle('pdp-active',v==='pdp');
  document.querySelectorAll('.view').forEach(x=>x.classList.remove('on'));
  document.getElementById('v-'+v).classList.add('on');
  if(v==='products') renderProducts();
  if(v==='cart') renderCart();
  if(v==='orders') renderOrders();
  if(v==='designs') renderDesigns();
  if(v==='wishlist') renderWishlistPage();
  if(v==='account') renderAccount();
  if(v==='pdp') renderPdp();
  closeHeaderSearch();
  window.scrollTo({top:0});
}
function toast(m){
  const t=document.getElementById('toast'); t.textContent=m; t.classList.add('on');
  setTimeout(()=>t.classList.remove('on'),2600);
}

/* ── Header search ─────────────────────────────────────────────
   One always-visible box in the header (no more click-to-reveal panel) —
   results drop down below it as you type and hide on blur/Escape/navigate. */
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
function onHeaderSearchInput(term){
  document.getElementById('hdrSearchResults').innerHTML=_searchResultsHtml(term);
}
function submitHeaderSearch(term){
  if(!term.trim()) return;
  go('products');
  document.getElementById('prodSearch').value=term;
  renderProducts();
  closeHeaderSearch();
}
function closeHeaderSearch(){
  const results=document.getElementById('hdrSearchResults');
  if(results) results.innerHTML='';
}
document.addEventListener('click',e=>{
  const box=document.querySelector('.hdr-search-inline');
  if(box && !box.contains(e.target)) closeHeaderSearch();
  const menu=document.getElementById('userMenu');
  if(menu && !menu.contains(e.target)) closeUserMenu();
});
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'){ closeHeaderSearch(); closeUserMenu(); }
});
