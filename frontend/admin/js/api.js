/* ═══════════════ API + SHARED HELPERS ═══════════════
   Same-origin, so the session cookie the storefront set is the same one
   used here — there is no second login system. */

const API = '';

async function api(path, body, method){
  const opts = {credentials:'include', method: method || (body ? 'POST' : 'GET')};
  if(body){
    opts.headers = {'Content-Type':'application/json'};
    opts.body = JSON.stringify(body);
  }
  let res;
  try{ res = await fetch(API + path, opts); }
  catch(e){ return {ok:false, error:"Can't reach the server.", offline:true}; }
  let d;
  try{ d = await res.json(); }
  catch(e){ d = {ok:false, error:'Unexpected response from the server.'}; }
  d.status = res.status;
  return d;
}

/* Every render function interpolates server data into innerHTML. */
function esc(s){
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
    {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]
  ));
}

function money(n){ return '₹' + Number(n || 0).toLocaleString('en-IN'); }

/* SQLite writes CURRENT_TIMESTAMP as UTC with no zone marker, so tag it
   before parsing or the browser reads it as local time. Only add the Z when
   there isn't already one — appending blindly gives "...ZZ" and NaN. */
function parseUTC(s){
  const str = String(s || '').replace(' ', 'T');
  return new Date(/[Zz]|[+-]\d{2}:?\d{2}$/.test(str) ? str : str + 'Z');
}
function fmtDate(s){
  const d = parseUTC(s);
  if(isNaN(d)) return '—';
  return d.toLocaleDateString('en-IN', {day:'2-digit', month:'short', year:'numeric'});
}
function fmtWhen(s){
  const d = parseUTC(s);
  if(isNaN(d)) return '—';
  const mins = Math.round((Date.now() - d) / 60000);
  if(mins < 1) return 'just now';
  if(mins < 60) return mins + 'm ago';
  if(mins < 1440) return Math.round(mins/60) + 'h ago';
  return fmtDate(s);
}

let toastTimer = 0;
function toast(msg){
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>el.classList.remove('on'), 2800);
}

/* ── Reveal a password ────────────────────────────────────────────
   Typing a handed-over temporary password blind, into a field that shows
   only dots, is how people get locked out of an account they were just
   given. Every password input gets a toggle.

   Applied by walking the DOM rather than by adding markup at each field, so
   a password input added anywhere later is covered without remembering to
   wire it up — call this again after rendering one. */
function enhancePasswordFields(root){
  (root || document).querySelectorAll('input[type=password]').forEach(inp=>{
    if(inp.dataset.pwWired) return;
    inp.dataset.pwWired = '1';
    const wrap = document.createElement('span');
    wrap.className = 'pw-wrap';
    inp.parentNode.insertBefore(wrap, inp);
    wrap.appendChild(inp);
    const btn = document.createElement('button');
    btn.type = 'button';                 // inside a <form>: must not submit
    btn.className = 'pw-toggle';
    btn.setAttribute('aria-pressed', 'false');
    btn.setAttribute('aria-label', 'Show password');
    btn.innerHTML = '<span class="material-symbols-outlined">visibility</span>';
    btn.onclick = ()=>{
      const show = inp.type === 'password';
      inp.type = show ? 'text' : 'password';
      btn.setAttribute('aria-pressed', String(show));
      btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
      btn.firstChild.textContent = show ? 'visibility_off' : 'visibility';
      // Put the caret back where it was — retyping into a field that just
      // jumped to the end is worse than not being able to see it.
      const at = inp.value.length;
      inp.focus();
      try{ inp.setSelectionRange(at, at); }catch(e){}
    };
    wrap.appendChild(btn);
  });
}
addEventListener('DOMContentLoaded', ()=>enhancePasswordFields());
