/* ═══════════════ CURSOR GRID ═══════════════ */
/* A lattice painted behind the hero that lights up under the pointer and
   fades back out. Cells lit by the cursor glow lime; a click sends an
   expanding ring that lights cells pink on its way past.

   The loop sleeps itself: once every cell has faded, rAF stops until the
   next pointer event. An always-on animation behind the fold isn't worth
   a phone's battery. */

const CURSOR_GRID = {
  cell:      44,    // lattice pitch, px
  radius:    150,   // how far from the pointer cells light up
  hold:      320,   // ms a cell stays lit before it starts fading
  fade:      750,   // ms a fully lit cell takes to fade out
  lineWidth: 1,
  maxAlpha:  0.85,  // peak. The stroke is a radial gradient that's already
                    // decayed by the time it reaches the cell edge, so this
                    // lands around 40% on screen — present, not shouting.
  fillAlpha: 0.07,  // translucent tile fill under the stroke
  gridAlpha: 0.03,  // faint always-visible lattice
  cellRadius:4,
  pulseSpeed:700    // click ring expansion, px/s
};

function initCursorGrid(selector){
  const host = document.querySelector(selector);
  if(!host) return;
  // It's a cursor effect: pointless on touch, and unwanted if the visitor
  // has asked for less motion.
  if(!matchMedia('(pointer: fine)').matches) return;
  if(matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const C = CURSOR_GRID;
  const canvas = document.createElement('canvas');
  canvas.className = 'cursor-grid';
  host.prepend(canvas);
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const roundRects = typeof ctx.roundRect === 'function';

  // Canvas can't use CSS variables, so read them once per (re)measure —
  // that's also when a theme switch reaches us, via paintCursorGrid().
  let LIME = [200,242,50], PINK = [206,3,88];
  function readTokens(){
    const cs = getComputedStyle(document.documentElement);
    const parse = (name, fallback) => {
      const v = cs.getPropertyValue(name).trim();
      if(!/^#[0-9a-f]{6}$/i.test(v)) return fallback;
      return [1,3,5].map(i=>parseInt(v.substr(i,2),16));
    };
    // --lime-ink, not --lime: on a light page the raw lime barely registers
    // against white, the same reason it can't be used for text.
    LIME = parse('--lime-ink', LIME);
    PINK = parse('--pink', PINK);
  }
  const smooth = t => t*t*(3-2*t);

  let w=0, h=0, cols=0, rows=0, offX=0, offY=0;
  let alpha = new Float32Array(0);   // current brightness per cell
  let lit   = new Float64Array(0);   // timestamp the cell was last touched
  let pink  = new Uint8Array(0);     // 1 = last lit by a click pulse
  const pulses = [];
  let raf = 0, running = false, lastFrame = 0;

  function rebuild(){
    readTokens();
    w = host.offsetWidth; h = host.offsetHeight;
    if(w < 1 || h < 1) return false;   // view is hidden
    canvas.width = Math.round(w*dpr); canvas.height = Math.round(h*dpr);
    canvas.style.width = w+'px'; canvas.style.height = h+'px';
    ctx.setTransform(dpr,0,0,dpr,0,0);
    cols = Math.ceil(w/C.cell)+1; rows = Math.ceil(h/C.cell)+1;
    // Centre the lattice so the cropped edge cells match left and right.
    offX = (w - cols*C.cell)/2; offY = (h - rows*C.cell)/2;
    alpha = new Float32Array(cols*rows);
    lit = new Float64Array(cols*rows);
    pink = new Uint8Array(cols*rows);
    return true;
  }

  const cx = i => offX + (i%cols)*C.cell + C.cell/2;
  const cy = i => offY + Math.floor(i/cols)*C.cell + C.cell/2;

  /* Walk only the cells whose bounding box overlaps the lit area, rather
     than the whole lattice. */
  function forCellsNear(x,y,reach,fn){
    const c0 = Math.max(0, Math.floor((x-reach-offX)/C.cell));
    const c1 = Math.min(cols-1, Math.floor((x+reach-offX)/C.cell));
    const r0 = Math.max(0, Math.floor((y-reach-offY)/C.cell));
    const r1 = Math.min(rows-1, Math.floor((y+reach-offY)/C.cell));
    for(let r=r0;r<=r1;r++) for(let c=c0;c<=c1;c++){
      const i = r*cols+c;
      fn(i, Math.hypot(cx(i)-x, cy(i)-y));
    }
  }

  function energize(x,y,now){
    forCellsNear(x,y,C.radius,(i,dist)=>{
      if(dist > C.radius) return;
      const level = smooth(1 - dist/C.radius) * C.maxAlpha;
      if(level <= 0) return;
      if(level > alpha[i]){ alpha[i] = level; pink[i] = 0; }
      lit[i] = now;
    });
  }

  function draw(now){
    const dt = Math.min(now - lastFrame, 50);
    lastFrame = now;
    ctx.clearRect(0,0,w,h);

    if(C.gridAlpha > 0){
      ctx.strokeStyle = 'rgba('+LIME[0]+','+LIME[1]+','+LIME[2]+','+C.gridAlpha+')';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for(let c=0;c<=cols;c++){ const x=Math.round(offX+c*C.cell)+0.5; ctx.moveTo(x,0); ctx.lineTo(x,h); }
      for(let r=0;r<=rows;r++){ const y=Math.round(offY+r*C.cell)+0.5; ctx.moveTo(0,y); ctx.lineTo(w,y); }
      ctx.stroke();
    }

    // Click rings hand their energy to each cell as the front passes it.
    for(let p=pulses.length-1;p>=0;p--){
      const ring = (now - pulses[p].t0)/1000 * C.pulseSpeed;
      if(ring > Math.hypot(w,h)){ pulses.splice(p,1); continue; }
      forCellsNear(pulses[p].x, pulses[p].y, ring+C.cell, (i,dist)=>{
        if(Math.abs(dist-ring) > C.cell/2) return;
        alpha[i] = C.maxAlpha; lit[i] = now; pink[i] = 1;
      });
    }

    let awake = pulses.length > 0;
    const step = dt / C.fade;
    const half = C.cell/2;

    for(let i=0;i<alpha.length;i++){
      let a = alpha[i];
      if(a <= 0) continue;
      if(now - lit[i] > C.hold){
        a = Math.max(0, a - step);
        alpha[i] = a;
        if(a <= 0) continue;
      }
      awake = true;

      const [r,g,b] = pink[i] ? PINK : LIME;
      const x = cx(i), y = cy(i);
      // Stroke fades toward the cell's corners so the tile reads as a glow
      // rather than a hard box.
      const grad = ctx.createRadialGradient(x,y,half*0.1,x,y,C.cell);
      grad.addColorStop(0,'rgba('+r+','+g+','+b+','+a+')');
      grad.addColorStop(1,'rgba('+r+','+g+','+b+',0)');

      ctx.beginPath();
      if(C.cellRadius > 0 && roundRects) ctx.roundRect(x-half+0.5, y-half+0.5, C.cell-1, C.cell-1, C.cellRadius);
      else ctx.rect(x-half+0.5, y-half+0.5, C.cell-1, C.cell-1);
      if(C.fillAlpha > 0){
        ctx.fillStyle = 'rgba('+r+','+g+','+b+','+(a*C.fillAlpha)+')';
        ctx.fill();
      }
      ctx.strokeStyle = grad;
      ctx.lineWidth = C.lineWidth;
      ctx.stroke();
    }

    if(awake) raf = requestAnimationFrame(draw);
    else running = false;   // static lattice stays painted; loop sleeps
  }

  function wake(){
    if(running || w < 1) return;
    running = true; lastFrame = performance.now();
    raf = requestAnimationFrame(draw);
  }

  function local(e){
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  host.addEventListener('pointermove', e=>{
    if(e.pointerType !== 'mouse') return;
    const [x,y] = local(e);
    energize(x, y, performance.now());
    wake();
  }, {passive:true});

  host.addEventListener('pointerdown', e=>{
    if(e.pointerType !== 'mouse') return;
    const [x,y] = local(e);
    pulses.push({x, y, t0:performance.now()});
    wake();
  }, {passive:true});

  if(window.ResizeObserver) new ResizeObserver(()=>{
    cancelAnimationFrame(raf); running = false;
    if(rebuild()) wake();
  }).observe(host);

  // Theme switches repaint through here (see repaintForTheme in theme.js).
  window.paintCursorGrid = ()=>{
    cancelAnimationFrame(raf); running = false;
    if(rebuild()) wake();
  };

  if(rebuild()) wake();
}
