/* ═══════════════ DATA ═══════════════
   The catalogue is no longer written here. It comes from the database,
   inlined into index.html by the `/` route as window.PRINTLY_CATALOG, so
   the shop can edit products and prices in the admin panel and the change
   is live on the next page load.

   The shape is unchanged from when this was a literal array — same keys,
   same types — so products.js, cart.js, studio.js and pdp.js all read it
   exactly as before. */
const CATALOG = window.PRINTLY_CATALOG || {products:[],colors:[],sizes:[],oneSizeKey:'One size'};
const PRODUCTS = CATALOG.products;
const SHIRT_COLORS = CATALOG.colors.map(c => c.hex);
const COLOR_NAMES = Object.fromEntries(CATALOG.colors.map(c => [c.hex, c.name]));

/* Shared helper — every render function interpolates user-supplied strings
   (layer text, product names, order ids) into innerHTML, so escape them.
   Lives here because data.js loads first. */
function esc(s){
  return String(s).replace(/[&<>"']/g, c => (
    {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]
  ));
}

/* ── Sizing ───────────────────────────────────────────────────────
   Whether a product is sized is a property of the product now (a tote is
   one-size, a hoodie isn't), so it comes from the catalogue rather than a
   hardcoded id list — adding a one-size product no longer means editing
   this file. */
const SIZES=CATALOG.sizes;
const ONE_SIZE_KEY=CATALOG.oneSizeKey;

function product(pid){ return PRODUCTS.find(p => p.id === pid); }
function isSized(pid){ const p=product(pid); return p ? !p.one_size : true; }
function sizeKeys(pid){ return isSized(pid) ? SIZES : [ONE_SIZE_KEY]; }

/* A fresh breakdown for a product. Defaults the whole opening quantity to
   M (or the single size) so the studio still has a sensible starting
   price rather than showing ₹0. */
function newSizeBreakdown(pid='rn', total=25){
  const keys=sizeKeys(pid);
  const b={};
  keys.forEach(k=>b[k]=0);
  b[keys.includes('M') ? 'M' : keys[0]] = total;
  return b;
}
function sizeTotal(sizes){
  return Object.values(sizes||{}).reduce((s,n)=>s+(+n||0),0);
}
/* "5×S · 10×M" — skips empty sizes. Used in cart, orders and admin. */
function sizeSummary(sizes){
  if(!sizes) return '';
  return Object.entries(sizes).filter(([,n])=>+n>0)
    .map(([k,n])=>`${n}×${k}`).join(' · ');
}
