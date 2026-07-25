/* ═══════════════ DATA ═══════════════ */
const PRODUCTS = [
  {id:'rn', name:'Round Neck T-Shirt', emoji:'👕', base:599, tiers:[[1,599],[10,449],[50,349],[100,279]], cost:'₹279 at 100+'},
  {id:'po', name:'Polo Shirt',         emoji:'🎽', base:899, tiers:[[1,899],[10,699],[50,549],[100,449]], cost:'₹449 at 100+'},
  {id:'hd', name:'Hoodie',             emoji:'🧥', base:1299,tiers:[[1,1299],[10,999],[50,799],[100,649]],cost:'₹649 at 100+'},
  {id:'js', name:'Sports Jersey',      emoji:'🏏', base:799, tiers:[[1,799],[10,599],[50,499],[100,399]], cost:'₹399 at 100+'},
  {id:'tb', name:'Tote Bag',           emoji:'👜', base:399, tiers:[[1,399],[10,299],[50,249],[100,199]], cost:'₹199 at 100+'},
];
const SHIRT_COLORS = ['#FFFFFF','#111111','#0D1F3C','#B02E2E','#1A8A4A','#C8F232','#CE0358','#D4D8DE'];

/* Shared helper — every render function interpolates user-supplied strings
   (layer text, product names, order ids) into innerHTML, so escape them.
   Lives here because data.js loads first. */
function esc(s){
  return String(s).replace(/[&<>"']/g, c => (
    {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]
  ));
}
