/* ═══════════════ SCROLL STACK ═══════════════ */
/* Cards inside a `.stack` container pin one under the other as the page
   scrolls, each shrinking a little so the pile reads as depth.

   Only transforms are touched — layout never changes — so each card's
   document position can be measured once and reused every frame. That
   also means `offsetTop` (layout-based, ignores transforms) is the right
   thing to measure with; getBoundingClientRect would feed the applied
   transform back into the next frame's maths. */

const STACK_CFG = {
  top:       0.18,  // where a pinned card rests, as a fraction of the viewport
  scaleEnd:  0.08,  // scaling finishes this far (fraction of vh) above that
  gap:       120,   // scroll distance between cards, px
  offset:    26,    // sliver of each card left visible under the one above
  baseScale: 0.90,  // scale the bottom-most card in the pile settles at
  scaleStep: 0.03,  // each card above it settles a little larger
  hold:      40,    // scroll distance the completed pile stays put before
                    // releasing — 0 makes it snap away the instant it forms
  tail:      40     // breathing room under the released pile. Matched to
                    // `hold` so the gap to the next section lands on the
                    // site's normal 80+80px section rhythm rather than
                    // reading as a hole.
};
const STACK_CFG_SM = { top:0.12, gap:80, offset:14, baseScale:0.93, hold:30, tail:30 };

function initScrollStack(selector){
  const box = document.querySelector(selector);
  if(!box) return;
  // No-JS and reduced-motion visitors keep the plain grid the CSS ships.
  if(matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const cards = Array.from(box.querySelectorAll('.stack-card'));
  if(cards.length < 2) return;

  // Trailing spacer. Cards are moved with transforms, so the container's
  // layout height still ends at the last card's resting place — this is the
  // room the pinned pile occupies beyond that, and without it the next
  // section slides underneath the stack.
  const end = document.createElement('div');
  end.className = 'stack-end';
  box.appendChild(end);
  box.classList.add('is-stacked');

  let cfg = {}, tops = [], endTop = 0, dirty = true, queued = false;
  const last = new Map();

  function docTop(el){ let y=0; for(let n=el;n;n=n.offsetParent) y+=n.offsetTop; return y; }

  function measure(){
    cfg = innerWidth<=720 ? Object.assign({},STACK_CFG,STACK_CFG_SM) : STACK_CFG;
    // The gap lives here rather than in CSS so the scroll maths and the
    // rendered spacing can't drift apart.
    cards.forEach((c,i)=>{ c.style.marginBottom = (i<cards.length-1 ? cfg.gap : 0)+'px'; });
    tops = cards.map(docTop);

    // Pure breathing room under the released pile. It deliberately does NOT
    // set the release point — see pinEnd in update().
    end.style.height = (cfg.tail + cfg.hold)+'px';
    endTop = docTop(end);
    dirty = false;
  }

  function update(){
    queued = false;
    // Hidden view (another page is showing) — offsets would all read 0.
    if(box.offsetParent === null){ dirty = true; return; }
    if(dirty) measure();

    const vh = innerHeight, y = scrollY;
    const topPx = cfg.top*vh, endPx = cfg.scaleEnd*vh;
    // Release the instant the last card has settled into the pile, plus a
    // short hold. Deriving this from the spacer's position instead — the
    // obvious approach, and what the original does — makes it depend on
    // viewport height, so on a tall window the pile lets go a few pixels
    // before the final card has actually landed.
    const pinEnd = tops[tops.length-1] - topPx - cfg.offset*(cards.length-1) + cfg.hold;

    cards.forEach((card,i)=>{
      const cardTop = tops[i];
      const pinStart = cardTop - topPx - cfg.offset*i;
      const span = Math.max(1, (cardTop - endPx) - pinStart);
      const p = Math.min(1, Math.max(0, (y - pinStart)/span));
      // Clamped: the front card sits at its natural size, never larger —
      // with enough cards baseScale + i*scaleStep would climb past 1.
      const settled = Math.min(1, cfg.baseScale + i*cfg.scaleStep);
      const scale = 1 - p*(1 - settled);
      // Past pinStart the card tracks the scroll (staying put on screen)
      // until pinEnd, where it freezes and scrolls away with the page.
      const ty = y < pinStart ? 0
               : Math.min(y, Math.max(pinStart, pinEnd)) - cardTop + topPx + cfg.offset*i;

      const next = { ty:Math.round(ty*100)/100, s:Math.round(scale*1000)/1000 };
      const prev = last.get(i);
      if(prev && Math.abs(prev.ty-next.ty)<0.1 && Math.abs(prev.s-next.s)<0.001) return;
      card.style.transform = 'translate3d(0,'+next.ty+'px,0) scale('+next.s+')';
      last.set(i,next);
    });
  }

  function tick(){ if(!queued){ queued=true; requestAnimationFrame(update); } }
  function invalidate(){ dirty=true; last.clear(); tick(); }

  addEventListener('scroll', tick, {passive:true});
  addEventListener('resize', invalidate);
  addEventListener('load', invalidate);
  // Body height changes when a view is toggled or images finish loading —
  // both move the cards, so re-measure instead of hooking into go().
  if(window.ResizeObserver) new ResizeObserver(invalidate).observe(document.body);
  update();
}
