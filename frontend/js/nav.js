/* ═══════════════ NAV ═══════════════ */
function go(v){
  state.view=v;
  document.querySelectorAll('.view').forEach(x=>x.classList.remove('on'));
  document.getElementById('v-'+v).classList.add('on');
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.toggle('on',b.dataset.v===v));
  if(v==='products') renderProducts();
  if(v==='cart') renderCart();
  if(v==='orders') renderOrders();
  if(v==='admin') renderAdmin();
  if(v==='designs') renderDesigns();
  if(v==='pdp') renderPdp();
  if(v==='studio') draw();
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
