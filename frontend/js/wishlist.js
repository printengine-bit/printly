/* ═══════════════ WISHLIST ═══════════════
   state.wishlist (declared in mockups.js alongside the rest of `state`) is
   the source of truth once loaded — heart buttons on every product card and
   the PDP just read it. Guests can click a heart same as the gated AI tries
   elsewhere in the app: it opens the sign-in modal rather than silently
   failing. */

async function loadWishlist(){
  if(!state.user){ state.wishlist=new Set(); return; }
  try{
    const res=await fetch(BACKEND+'/api/wishlist',{credentials:'include'});
    const d=await res.json();
    if(d.ok) state.wishlist=new Set(d.product_ids);
  }catch(err){ /* wishlist is additive — the store works without it */ }
  refreshWishlistUI();
}

async function toggleWishlist(pid){
  if(!state.user){ openLogin(); return; }
  let d;
  try{
    const res=await fetch(BACKEND+'/api/wishlist/toggle',{method:'POST',
      headers:{'Content-Type':'application/json'},credentials:'include',
      body:JSON.stringify({product_id:pid})});
    d=await res.json();
  }catch(err){ toast('Could not reach the server — try again.'); return; }
  if(!d.ok){ toast(d.error||'Could not update wishlist'); return; }
  if(d.wishlisted) state.wishlist.add(pid); else state.wishlist.delete(pid);
  refreshWishlistUI();
  toast(d.wishlisted ? 'Saved to wishlist' : 'Removed from wishlist');
}

/* Every place a heart can appear re-renders — cheap at this catalogue size
   and it means a toggle on the PDP is reflected on the grid the moment you
   go back, with no separate cache-invalidation path to get wrong. */
function refreshWishlistUI(){
  renderWishlistBadge();
  renderProducts();
  renderHomeProducts();
  renderHomeBestSellers();
  renderHomeNewArrivals();
  if(state.view==='wishlist') renderWishlistPage();
  if(state.view==='pdp') renderPdp();
}

function wishHeart(pid,size){
  const on=state.wishlist.has(pid);
  return `<button class="wish-btn${on?' on':''}${size==='lg'?' wish-lg':''}"
    aria-label="${on?'Remove from':'Add to'} wishlist"
    onclick="event.stopPropagation();toggleWishlist('${pid}')">
    <span class="material-symbols-outlined" style="font-variation-settings:'FILL' ${on?1:0}">favorite</span>
  </button>`;
}

function renderWishlistBadge(){
  const b=document.getElementById('wishCount'); if(!b) return;
  b.textContent=state.wishlist.size; b.dataset.count=state.wishlist.size;
}

function renderWishlistPage(){
  const g=document.getElementById('wishlistGrid'); if(!g) return;
  const empty=document.getElementById('wishlistEmpty');
  if(!state.user){
    g.innerHTML='';
    if(empty){
      empty.style.display='';
      empty.innerHTML=`<span class="material-symbols-outlined">favorite</span><br>
        Sign in to save products for later.<br>
        <button class="btn btn-quiet btn-sm" style="margin-top:16px" onclick="openLogin()">Sign in</button>`;
    }
    return;
  }
  const list=PRODUCTS.filter(p=>state.wishlist.has(p.id));
  if(empty){
    empty.style.display = list.length ? 'none' : '';
    empty.innerHTML=`<span class="material-symbols-outlined">favorite</span><br>
      Nothing saved yet.<br>
      <button class="btn btn-quiet btn-sm" style="margin-top:16px" onclick="go('products')">Browse products</button>`;
  }
  g.innerHTML=list.map(_productCardHtml).join('');
  document.querySelectorAll('#wishlistGrid .pthumb').forEach(cnv=>drawProductThumb(cnv,cnv.dataset.p));
}
