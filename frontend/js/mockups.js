/* ── PHOTO MOCKUP ENGINE ── */
const MOCK=window.PRINTLY_MOCKS||{mocks:{},print:{}};
/* Print zones are admin-editable. mockup-data.js ships the measurements the
   photos were taken with; the database wins where it has a row, so a shop
   that measures a real blank can correct the studio without a deploy. Merged
   here rather than at every read site — pa(), the ruler, printSpec() and the
   export all go through MOCK.print. */
if(window.PRINTLY_CATALOG && window.PRINTLY_CATALOG.zones){
  Object.assign(MOCK.print, window.PRINTLY_CATALOG.zones);
}
const mockImgs={};        // pid -> loaded Image
const mockCache={};       // pid+color -> recolored canvas
let mocksReady=false;
function loadMocks(cb){
  const ids=Object.keys(MOCK.mocks); let n=ids.length;
  if(!n){ cb&&cb(); return; }
  ids.forEach(pid=>{
    const img=new Image();
    img.onload=()=>{ mockImgs[pid]=img; if(--n===0){ mocksReady=true; cb&&cb(); } };
    img.onerror=()=>{ if(--n===0){ mocksReady=true; cb&&cb(); } };
    img.src=MOCK.mocks[pid];
  });
}
function hexToRgb(h){
  h=h.replace('#',''); return [parseInt(h.slice(0,2),16),parseInt(h.slice(2,4),16),parseInt(h.slice(4,6),16)];
}
/* Build a recolored mockup canvas.

   Two things happen per pixel, both keyed off the ORIGINAL photo:
   1. Recolor — the source luminance is expanded before shading the target
      colour, so white, pastel and near-black fabric all retain their folds.
   2. Background keyed to transparent. The source photos are shot on black,
      and leaving that black opaque is what made a black tee vanish into a
      dark page. With it keyed out the garment floats, and whatever draws it
      can put a contrasting stage behind — see stageFill().

   Alpha ramps instead of switching at a threshold, and background-connected
   boundary pixels receive a wider fade so JPEG antialiasing cannot leave a
   dotted dark halo. Existing alpha is retained for transparent sleeve PNGs. */
function getRecoloredMock(pid,color){
  const key=pid+'|'+color;
  if(mockCache[key]) return mockCache[key];
  const img=mockImgs[pid]; if(!img) return null;
  const w=img.naturalWidth,h=img.naturalHeight;
  const c=document.createElement('canvas'); c.width=w; c.height=h;
  const x=c.getContext('2d'); x.drawImage(img,0,0);
  const [tr,tg,tb] = hexToRgb(color);
  const targetLum=(.2126*tr+.7152*tg+.0722*tb)/255;
  const d=x.getImageData(0,0,w,h), p=d.data;
  // Mark only the old black background (or true PNG transparency). Later we
  // can soften pixels touching this mask without flattening dark folds and
  // seam detail safely inside the garment.
  const oldBackground=new Uint8Array(w*h);
  for(let n=0;n<oldBackground.length;n++){
    const j=n*4,r=p[j],g=p[j+1],b=p[j+2];
    oldBackground[n]=(p[j+3]===0||Math.max(r,g,b)<=24)?1:0;
  }
  for(let i=0;i<p.length;i+=4){
    const r=p[i],g=p[i+1],b=p[i+2],a=p[i+3];
    const m = r>g ? (r>b?r:b) : (g>b?g:b);      // brightest channel
    if(m<=24){ p[i+3]=0; continue; }            // pure background
    const n=i/4,px=n%w,py=Math.floor(n/w);
    let touchesBackground=false;
    if(m<220){
      for(let oy=-2;oy<=2&&!touchesBackground;oy++){
        const yy=py+oy;if(yy<0||yy>=h)continue;
        for(let ox=-2;ox<=2;ox++){
          const xx=px+ox;if(xx>=0&&xx<w&&oldBackground[yy*w+xx]){
            touchesBackground=true;break;
          }
        }
      }
    }
    const edgeAlpha=touchesBackground
      ? Math.max(0,Math.min(1,(m-24)/196))
      : (m<120 ? (m-24)/96 : 1);
    p[i+3]=Math.round(a*edgeAlpha);

    // Expand the pale source fabric's narrow luminance range so seams,
    // pockets and folds stay distinct on white and pastel garments.
    const lum=.2126*r+.7152*g+.0722*b;
    // JPEG edge pixels are the white garment blended with its old black
    // background. Undo that premultiplication before deriving fabric tone,
    // otherwise the cut-out gets a dark dotted halo on a white stage.
    const fabricLum=edgeAlpha<1 ? Math.min(255,lum/edgeAlpha) : lum;
    let tone=Math.max(0,Math.min(1,(fabricLum-120)/135));
    // Boundary pixels in the JPEG are pale fabric blended with the original
    // black backdrop. Keep those pixels close to the garment's true surface
    // tone so the transparent cut-out does not composite as a grey/black
    // outline on the white product stage.
    if(touchesBackground) tone=1;
    else if(edgeAlpha<1) tone=Math.max(.92,tone);
    const shade=.10+.90*tone;

    // A neutral specular lift prevents near-black dyes from crushing every
    // highlight into the same flat value while retaining the selected hue.
    const sheen=36*tone*tone*tone*(1-targetLum);
    p[i]  = Math.min(255,Math.round(tr*shade+sheen));
    p[i+1]= Math.min(255,Math.round(tg*shade+sheen));
    p[i+2]= Math.min(255,Math.round(tb*shade+sheen));
  }
  x.putImageData(d,0,0);
  mockCache[key]=c; return c;
}
function clearMockCache(){ for(const k in mockCache) delete mockCache[k]; }

/* One clean catalogue background for every garment colour. */
function stageFill(){ return '#FFFFFF'; }

/* Fill a rounded stage panel over the area a mockup is about to be drawn
   into. Callers pass the same box they hand drawImage(). */
function drawStage(ctx2d, garmentColor, x, y, w, h, radius){
  ctx2d.save();
  ctx2d.fillStyle = stageFill(garmentColor);
  ctx2d.beginPath();
  const r = radius===undefined ? 18 : radius;
  if(r>0 && typeof ctx2d.roundRect === 'function') ctx2d.roundRect(x,y,w,h,r);
  else ctx2d.rect(x,y,w,h);
  ctx2d.fill();
  ctx2d.restore();
}

/* Fabric depth belongs inside the photographed folds. A canvas shadow around
   the transparent cut-out creates a dark perimeter on light garments, so the
   product image is deliberately drawn without an outer silhouette effect. */
function drawMockup(ctx2d, mock, x, y, w, h){
  ctx2d.drawImage(mock,x,y,w,h);
}
/* Audience-specific catalogue SKUs reuse the photographed garment family
   until dedicated shoots are uploaded. Resolve that family in the browser
   too, so older database rows cannot fall back to a flat vector thumbnail. */
function photoMockKey(pid){
  if(MOCK.mocks[pid]) return pid;
  const family=pid.split('-')[0];
  const shared=family==='sw' ? 'rn' : family;
  return MOCK.mocks[shared] ? shared : pid;
}
/* resolve which mockup key to use for a product + side */
function mockKey(pid){
  const v=typeof printView==='function' ? printView(pid,state.side) : null;
  const key=v&&v.mock ? v.mock : (state.side==='front'?pid:pid+'_'+state.side);
  return MOCK.mocks[key] ? key : photoMockKey(pid);
}
/* ── Garment size ─────────────────────────────────────────────────
   The mockup photos are one garment. Which one: REF_SIZE. Everything else
   is that photo scaled by how much bigger or smaller the real garment is,
   taken from the same size chart the product page already prints — so a new
   product needs no extra data to size correctly.

   Chest drives it, not length. A photo can only be scaled uniformly without
   distorting the fabric, and chest is the dimension you actually read off a
   front-on shot. Across the full S–3XL run the two ratios differ by about
   7%, which is well inside the tolerance of a printable-area figure.

   ⚠️ This scales whatever MOCK.print says the reference garment's print
   zone is. If those base figures are wrong (rn front claims 38x50cm, which
   is generous for an M), every size is wrong by the same factor. Measure a
   real blank before trusting the numbers, not the scaling. */
const REF_SIZE='M';

function sizeScale(pid,size){
  const p=product(pid), ch=p&&p.chart;
  if(!ch||!ch.chest||ch.chest.length<2) return 1;      // one-size product
  const i=SIZES.indexOf(size), r=SIZES.indexOf(REF_SIZE);
  if(i<0||r<0||!ch.chest[i]||!ch.chest[r]) return 1;
  return ch.chest[i]/ch.chest[r];
}
/* The biggest garment has to fit the canvas, so the whole run is normalised
   against it rather than against the reference. A 3XL fills the frame and
   everything below sits in proportion — which is the point of drawing them
   at different sizes at all. */
function maxSizeScale(pid){
  const p=product(pid), ch=p&&p.chart;
  if(!ch||!ch.chest||ch.chest.length<2) return 1;
  return Math.max(...SIZES.map(s=>sizeScale(pid,s)));
}
/* Which garment size the canvas is showing. Single mode follows the size
   they picked; bulk previews the SMALLEST size in the order, because that's
   the one a design is liable to overflow. */
function previewSize(){
  const pid=state.product.id, keys=sizeKeys(pid);
  if(keys.length===1) return keys[0];
  const ordered=SIZES.filter(k=>+state.sizes[k]>0);
  if(ordered.length) return ordered[0];                // SIZES is S→3XL
  return SIZES.includes(REF_SIZE)?REF_SIZE:keys[0];
}

/* map a print area from mockup-space (720w) to canvas 520x560, letterboxed */
function mockLayout(pid,sizeOverride){
  const key=mockKey(pid);
  const img=mockImgs[key]; if(!img) return null;
  const iw=img.naturalWidth, ih=img.naturalHeight;
  const s=sizeScale(pid, sizeOverride||previewSize())/maxSizeScale(pid);
  const scale=Math.min(520/iw, 560/ih)*s;
  const dw=iw*scale, dh=ih*scale;
  const ox=(520-dw)/2, oy=(560-dh)/2;
  const P=MOCK.print[key]||MOCK.print.rn;
  // The zone's px box scales with the photo but its cm figures scale with
  // the real garment, so px-per-cm comes out identical at every size. That
  // is what keeps a 20cm print 20cm wide when you switch from S to 3XL —
  // only the garment around it changes.
  const g=sizeScale(pid, sizeOverride||previewSize());
  return {scale,ox,oy,dw,dh,key,
    px:ox+(P.cx-P.w/2)*scale, py:oy+(P.cy-P.h/2)*scale,
    pw:P.w*scale, ph:P.h*scale,
    cmW:+(P.cmW*g).toFixed(1), cmH:+(P.cmH*g).toFixed(1)};
}

let state = {
  user:null,
  view:'home',
  product:PRODUCTS[0],
  shirtColor:'#FFFFFF',
  side:'front',
  layers:{front:[],back:[],left_sleeve:[],right_sleeve:[]},
  enabledViews:['front'],
  plainItem:false,
  sel:-1,
  guides:{v:false,h:false},
  cropMode:false,
  editorZoom:1,
  cart:[],
  aiTries:0,
  /* Per-size quantities are the single source of truth for how many pieces
     are being ordered — total quantity is derived from them, never stored
     separately. Bulk apparel orders are always a breakdown (5×S, 10×M …),
     so a lone "quantity" field can't express a real order. */
  sizes:newSizeBreakdown(),
  /* Which face the size picker wears. 'single' is one size + a quantity,
     which is what almost every visitor wants; 'bulk' opens the full
     breakdown. Both write into `sizes` above — this is a view mode, not a
     second place quantity is stored. */
  orderMode:'single',
  // Product ids the signed-in user has saved. Empty for guests — wishlist.js
  // loads the real set after login/session-restore, same as My Designs.
  wishlist:new Set(),
};
