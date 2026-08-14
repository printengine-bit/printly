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
/* Merchandising rails on the home page — slugs only, ranked server-side.
   Empty on a fresh shop with no paid orders yet; renderHomeBestSellers()
   falls back to catalogue order rather than show a blank rail. */
const BEST_SELLERS = CATALOG.best_sellers || [];
const NEW_ARRIVALS = CATALOG.new_arrivals || [];
/* Only codes an admin explicitly featured — see promo_codes.featured on
   the backend. Never every active code. */
const DEALS = CATALOG.deals || [];

/* Shared helper — every render function interpolates user-supplied strings
   (layer text, product names, order ids) into innerHTML, so escape them.
   Lives here because data.js loads first. */
function esc(s){
  return String(s).replace(/[&<>"']/g, c => (
    {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]
  ));
}

/* ── Skeleton loading states ─────────────────────────────────────
   Shape-matched placeholders shown while a fetch is in flight, instead
   of bare "Loading…" text. Not tied to real data, so they're safe to
   call before anything has been fetched. */
function skeletonLines(n=3){
  return `<div>${Array.from({length:n},(_,i)=>
    `<div class="skeleton" style="height:14px;width:${i===n-1?'55%':'100%'};margin-bottom:10px"></div>`
  ).join('')}</div>`;
}
function skeletonListCards(n=2){
  return `<div class="stack" style="gap:12px">${Array.from({length:n},()=>`
    <div class="card skel-card">
      <div class="row" style="justify-content:space-between;margin-bottom:14px">
        <div class="skeleton" style="height:16px;width:100px"></div>
        <div class="skeleton" style="height:22px;width:74px;border-radius:var(--r-full)"></div>
      </div>
      <div class="skeleton" style="height:12px;width:75%;margin-bottom:16px"></div>
      <div class="skeleton" style="height:38px;width:100%"></div>
    </div>`).join('')}</div>`;
}
function skeletonPhotoCards(n=4){
  return `<div class="grid grid-4">${Array.from({length:n},()=>`
    <div class="card skel-card">
      <div class="skeleton skel-photo"></div>
      <div class="skeleton" style="height:14px;width:80%;margin-bottom:8px"></div>
      <div class="skeleton" style="height:12px;width:50%"></div>
    </div>`).join('')}</div>`;
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

/* ── Shared product card ─────────────────────────────────────────
   One renderer for every grid that shows a product: the products page,
   the wishlist, and every home page rail (best sellers, new arrivals,
   the full collection). Used to be three near-identical inline templates
   that had to be kept in sync by hand — swatches or a pricing change now
   only need to happen here. Lives in data.js, not wishlist.js, because
   products.js (loaded earlier) calls it too; classic scripts share one
   global scope, so the only requirement is that this exists by the time
   a render function actually runs, not by parse order. */
function _swatchesFor(p){
  if(!p.colors || !p.colors.length) return '';
  return `<div class="pcard-swatches">${p.colors.map(hex=>
    `<span class="swatch-dot" style="background:${esc(hex)}"></span>`).join('')}</div>`;
}
function _productCardHtml(p){
  return `
    <div class="card card-hover card-lift pcard" style="cursor:pointer" onclick="openProduct('${p.id}')">
      <div class="pcard-img">
        ${productThumbHtml(p.id,300,320)}
        ${wishHeart(p.id)}
      </div>
      <div class="pcard-body">
        <h3 class="pcard-name">${esc(p.name)}</h3>
        ${starsFor(p.id)}
        ${_swatchesFor(p)}
        <div class="pcard-price">From <span class="t-lime">₹${p.tiers[3][1].toLocaleString('en-IN')}</span>
          <span class="t-label t-dim" style="font-weight:400"> at 100+</span></div>
        <div class="pcard-tiers">1pc ₹${p.tiers[0][1]} · 10+ ₹${p.tiers[1][1]} · 50+ ₹${p.tiers[2][1]}</div>
      </div>
    </div>`;
}
