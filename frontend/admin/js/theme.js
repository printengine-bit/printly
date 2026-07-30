/* ═══════════════ THEME ═══════════════
   Reads the same localStorage key as the storefront, so switching theme in
   one is reflected in the other. The initial value is applied by the inline
   script in <head>; this only handles toggling after load. */

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
    btn.querySelector('.material-symbols-outlined').textContent =
      t === 'light' ? 'dark_mode' : 'light_mode';
    btn.setAttribute('aria-label', t === 'light' ? 'Switch to dark mode' : 'Switch to light mode');
  }
}
function toggleTheme(){
  const next = resolvedTheme() === 'light' ? 'dark' : 'light';
  try{ localStorage.setItem(THEME_KEY, next); }catch(e){}
  applyTheme();
}
