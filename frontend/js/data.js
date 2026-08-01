/* ═══════════════ DATA ═══════════════
   The catalogue is no longer written here. It comes from the database,
   inlined into index.html by the `/` route as window.PRINTLY_CATALOG, so
   the shop can edit products and prices in the admin panel and the change
   is live on the next page load.

   The shape is unchanged from when this was a literal array — same keys,
   same types — so products.js, cart.js, studio.js and pdp.js all read it
   exactly as before. */
const CATALOG = window.PRINTLY_CATALOG || {products:[],colors:[],sizes:[],oneSizeKey:'One size'};
/* Tax and shipping come from the same place the server prices orders from.
   Never hardcode a rate against these — the pair drifted once already, and
   a client figure that disagrees with quote() is a 409 at checkout. */
const TAX = CATALOG.tax || {gst_percent:5, gst_percent_high:12, gst_threshold:1000,
                            shipping_flat:99, free_shipping_over:10000};
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
/* Most products share the adult S..3XL scale (the global SIZES), but a
   product can carry its own label set (kids' age bands) via CATALOG's
   per-product `sizes` field. Every size-picker render goes through this,
   so setting it here is the one place that needs to know the difference. */
function sizeKeys(pid){
  if(!isSized(pid)) return [ONE_SIZE_KEY];
  const p=product(pid);
  return (p&&p.sizes&&p.sizes.length) ? p.sizes : SIZES;
}
function printViews(pid){
  const p=product(pid);
  return (p&&p.print_views&&p.print_views.length) ? p.print_views : [
    {key:'front',label:'Front',group:'front',mock:pid,required:true,default:true,surcharge:0}
  ];
}
function printView(pid,key){ return printViews(pid).find(v=>v.key===key); }
function enabledPrintViews(){
  const on=new Set(state.enabledViews||[]);
  return printViews(state.product.id).filter(v=>on.has(v.key));
}
function printExtra(p,keys){
  const wanted=new Set(keys||[]);
  const groups={};
  printViews(p.id).forEach(v=>{
    if(wanted.has(v.key)) groups[v.group]=Math.max(groups[v.group]||0,+v.surcharge||0);
  });
  return Object.values(groups).reduce((n,v)=>n+v,0);
}

/* A fresh breakdown for a product. Opens empty on purpose: pre-selecting a
   size the customer never chose is how someone ends up with an M they
   didn't want. A one-size product is the exception — there's nothing to
   get wrong — and `resetSizesForProduct()` fills that in. */
function newSizeBreakdown(pid='rn', total=0){
  const keys=sizeKeys(pid);
  const b={};
  keys.forEach(k=>b[k]=0);
  if(total>0) b[keys.includes('M') ? 'M' : keys[0]] = total;
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
