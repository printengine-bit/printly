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
