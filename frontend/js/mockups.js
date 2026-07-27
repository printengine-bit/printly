/* ── PHOTO MOCKUP ENGINE ── */
const MOCK=window.PRINTLY_MOCKS||{mocks:{},print:{}};
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
   1. Recolor — white fabric multiplied by the target colour, so folds and
      shadows survive (don't replace this with a flat fill).
   2. Background keyed to transparent. The source photos are shot on black,
      and leaving that black opaque is what made a black tee vanish into a
      dark page. With it keyed out the garment floats, and whatever draws it
      can put a contrasting stage behind — see stageFill().

   Alpha ramps across 24–56 rather than switching at a threshold, otherwise
   the garment gets a hard jagged edge where the photo's antialiasing was. */
function getRecoloredMock(pid,color){
  const key=pid+'|'+color;
  if(mockCache[key]) return mockCache[key];
  const img=mockImgs[pid]; if(!img) return null;
  const w=img.naturalWidth,h=img.naturalHeight;
  const c=document.createElement('canvas'); c.width=w; c.height=h;
  const x=c.getContext('2d'); x.drawImage(img,0,0);
  const tint = color!=='#FFFFFF';
  const [tr,tg,tb] = tint ? hexToRgb(color) : [0,0,0];
  const d=x.getImageData(0,0,w,h), p=d.data;
  for(let i=0;i<p.length;i+=4){
    const r=p[i],g=p[i+1],b=p[i+2];
    const m = r>g ? (r>b?r:b) : (g>b?g:b);      // brightest channel
    if(m<=24){ p[i+3]=0; continue; }            // pure background
    if(m<56) p[i+3] = Math.round((m-24)/32*255);
    if(tint){
      p[i]  = r/255*tr;
      p[i+1]= g/255*tg;
      p[i+2]= b/255*tb;
    }
  }
  x.putImageData(d,0,0);
  mockCache[key]=c; return c;
}
function clearMockCache(){ for(const k in mockCache) delete mockCache[k]; }

/* Relative luminance, 0–255. */
function colorLum(hex){
  const [r,g,b]=hexToRgb(hex);
  return 0.2126*r + 0.7152*g + 0.0722*b;
}

/* The panel drawn behind a garment. It contrasts the *garment*, not the
   page: a black tee needs a light backdrop whichever theme you're in, and a
   white tee needs a dark one — otherwise the product disappears. */
function stageFill(garmentColor){
  return colorLum(garmentColor) < 128 ? '#f2f2ec' : '#141414';
}

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
/* resolve which mockup key to use for a product + side */
function mockKey(pid){
  if(state.side==='back' && MOCK.mocks[pid+'_back']) return pid+'_back';
  return pid;
}
/* map a print area from mockup-space (720w) to canvas 520x560, letterboxed */
function mockLayout(pid){
  const key=mockKey(pid);
  const img=mockImgs[key]; if(!img) return null;
  const iw=img.naturalWidth, ih=img.naturalHeight;
  const scale=Math.min(520/iw, 560/ih);
  const dw=iw*scale, dh=ih*scale;
  const ox=(520-dw)/2, oy=(560-dh)/2;
  const P=MOCK.print[key]||MOCK.print.rn;
  return {scale,ox,oy,dw,dh,key,
    px:ox+(P.cx-P.w/2)*scale, py:oy+(P.cy-P.h/2)*scale,
    pw:P.w*scale, ph:P.h*scale, cmW:P.cmW, cmH:P.cmH};
}

let state = {
  user:null,
  view:'home',
  product:PRODUCTS[0],
  shirtColor:'#FFFFFF',
  side:'front',
  layers:{front:[],back:[]},   // {type:'text'|'img', ...}
  sel:-1,
  guides:{v:false,h:false},
  cart:[],
  aiTries:0,
  /* Per-size quantities are the single source of truth for how many pieces
     are being ordered — total quantity is derived from them, never stored
     separately. Bulk apparel orders are always a breakdown (5×S, 10×M …),
     so a lone "quantity" field can't express a real order. */
  sizes:newSizeBreakdown(),
};
