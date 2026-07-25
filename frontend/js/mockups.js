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
/* build a recolored mockup canvas (multiply blend on black-bg photo) */
function getRecoloredMock(pid,color){
  const key=pid+'|'+color;
  if(mockCache[key]) return mockCache[key];
  const img=mockImgs[pid]; if(!img) return null;
  const w=img.naturalWidth,h=img.naturalHeight;
  const c=document.createElement('canvas'); c.width=w; c.height=h;
  const x=c.getContext('2d'); x.drawImage(img,0,0);
  if(color!=='#FFFFFF'){
    const [tr,tg,tb]=hexToRgb(color);
    const d=x.getImageData(0,0,w,h), p=d.data;
    for(let i=0;i<p.length;i+=4){
      const r=p[i],g=p[i+1],b=p[i+2];
      // black bg stays black; white fabric takes colour, folds preserved
      if(r>55||g>55||b>55){
        p[i]  = r/255*tr;
        p[i+1]= g/255*tg;
        p[i+2]= b/255*tb;
      }
    }
    x.putImageData(d,0,0);
  }
  mockCache[key]=c; return c;
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
};
