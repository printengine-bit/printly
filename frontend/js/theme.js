/* ═══════════════ THEME ═══════════════
   `data-theme` on <html> drives the whole palette (see the token blocks in
   printly.css). The initial value is set by an inline script in <head>, not
   here — by the time this file runs the page has already painted, and a
   dark-to-light flip after first paint is the flash we're avoiding.

   Light is deliberately the first-visit default. An explicit light/dark
   choice is persisted so returning visitors keep the mode they selected. */

const THEME_KEY = 'printly-theme';

function storedTheme(){
  try{ return localStorage.getItem(THEME_KEY) || 'light'; }catch(e){ return 'light'; }
}
function resolvedTheme(){
  return storedTheme() === 'dark' ? 'dark' : 'light';
}
function applyTheme(){
  const t = resolvedTheme();
  document.documentElement.dataset.theme = t;
  const btn = document.getElementById('themeBtn');
  if(btn){
    const icon = t === 'light' ? 'dark_mode' : 'light_mode';
    btn.querySelector('.material-symbols-outlined').textContent = icon;
    btn.setAttribute('aria-label', t === 'light' ? 'Switch to dark mode' : 'Switch to light mode');
    btn.title = 'Theme: ' + t;
  }
  // Canvases don't inherit CSS variables — they're painted, not styled — so
  // every mockup surface has to be redrawn against the new palette.
  repaintForTheme();
}

function toggleTheme(){
  const next = resolvedTheme() === 'light' ? 'dark' : 'light';
  try{ localStorage.setItem(THEME_KEY, next); }catch(e){}
  applyTheme();
}

function repaintForTheme(){
  // Recolored mockups are cached per product+colour and bake in the stage
  // backdrop, so the cache has to go when the palette changes.
  if(typeof clearMockCache === 'function') clearMockCache();
  if(typeof draw === 'function' && document.getElementById('teeCanvas')) draw();
  if(typeof heroLoop === 'function' && document.getElementById('heroTee')) heroLoop();
  if(typeof drawAiPreview === 'function') drawAiPreview();
  if(typeof paintCursorGrid === 'function') paintCursorGrid();
}
