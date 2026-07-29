/* ═══════════════ SHELL ═══════════════
   Boots the panel: works out who's signed in, builds the sidebar from the
   modules the server says this role can reach, and routes between sections
   via the URL hash so a screen can be linked to and survives a refresh. */

let SESSION = null;

/* The whole structure, including what isn't built yet. Sections are shown
   with their planned sub-menus rather than hidden, so the shape of the
   panel is visible from day one — `phase` marks what's still to come. */
const SECTIONS = {
  dashboard: {label:'Dashboard', icon:'dashboard', subs:[]},
  inventory: {label:'Inventory', icon:'inventory_2',
    subs:['Products','Variants & stock','Stock movements','Low stock','Suppliers']},
  orders:    {label:'Orders', icon:'receipt_long',
    subs:['All orders','Production queue','Awaiting proof','Ready to dispatch','Cancelled']},
  production:{label:'Production', icon:'print',
    subs:['Print jobs','Artwork files','Proof log']},
  dispatch:  {label:'Dispatch', icon:'local_shipping',
    subs:['Pending shipments','Tax invoices','Shipping labels','Manifest']},
  customers: {label:'Customers', icon:'group',
    subs:['All customers','Loyalty ledger']},
  support:   {label:'Support', icon:'support_agent',
    subs:['Ticket inbox','Unassigned','Canned replies']},
  content:   {label:'Content', icon:'palette', phase:5,
    subs:['Design templates','Review moderation','Product photos']},
  reports:   {label:'Reports', icon:'bar_chart', phase:5,
    subs:['Sales','Production throughput','Stock valuation','AI usage']},
  settings:  {label:'Settings', icon:'settings',
    subs:['Company profile','Staff & roles','Audit log']},
};

/* ── Boot ─────────────────────────────────────────────────────── */
async function boot(){
  applyTheme();
  const d = await api('/api/admin/session');
  if(!d.ok || !d.staff){
    showGate(d.status === 401 || !d.ok ? '' : 'That account has no admin access.');
    return;
  }
  SESSION = d;
  if(d.user.must_change_password){ showPasswordGate(); return; }
  startShell();
}

function showGate(msg){
  document.getElementById('shell').hidden = true;
  document.getElementById('pwGate').hidden = true;
  const gate = document.getElementById('gate');
  gate.hidden = false;
  if(msg) document.getElementById('gateHint').textContent = msg;
  document.getElementById('gEmail').focus();
}

async function gateSignIn(){
  const btn = document.getElementById('gBtn');
  const hint = document.getElementById('gateHint');
  hint.textContent = '';
  btn.disabled = true;
  const d = await api('/api/auth/login', {
    email: document.getElementById('gEmail').value.trim(),
    password: document.getElementById('gPass').value,
  });
  btn.disabled = false;
  if(!d.ok){ hint.textContent = d.error || 'Could not sign in.'; return; }
  document.getElementById('gate').hidden = true;
  boot();
}

function showPasswordGate(){
  document.getElementById('gate').hidden = true;
  document.getElementById('shell').hidden = true;
  document.getElementById('pwGate').hidden = false;
  document.getElementById('pwCur').focus();
}

async function submitPassword(){
  const d = await api('/api/auth/change-password', {
    current: document.getElementById('pwCur').value,
    password: document.getElementById('pwNew').value,
  });
  if(!d.ok){ toast(d.error); return; }
  document.getElementById('pwGate').hidden = true;
  toast('Password updated');
  boot();
}

async function signOut(){
  await api('/api/auth/logout', {});
  SESSION = null;
  stopPulse();
  location.reload();
}

/* ── Shell ────────────────────────────────────────────────────── */
function startShell(){
  document.getElementById('gate').hidden = true;
  document.getElementById('shell').hidden = false;
  document.getElementById('whoName').textContent = SESSION.user.name;
  document.getElementById('whoRole').textContent = SESSION.role_label;
  buildMenu();
  route();
  startPulse();
}

function buildMenu(){
  const allowed = new Set(SESSION.modules);
  document.getElementById('menu').innerHTML = Object.entries(SECTIONS).map(([key,s])=>{
    const can = allowed.has(key);
    const subs = key === 'settings' && SESSION.user.role !== 'owner'
      ? ['Company profile'] : s.subs;
    return `<button class="menu-item ${can?'':'locked'}" data-m="${key}"
        ${can?`onclick="goTo('${key}')"`:'title="Your role doesn\'t include this section"'}>
        <span class="material-symbols-outlined">${s.icon}</span>${esc(s.label)}
      </button>
      ${subs.length?`<div class="menu-sub" data-subs="${key}" hidden>${
        subs.map(t=>`<button data-sub="${esc(slug(t))}"
          onclick="goTo('${key}','${esc(slug(t))}')">${esc(t)}</button>`).join('')
      }</div>`:''}`;
  }).join('');
}

function slug(s){ return s.toLowerCase().replace(/[^a-z]+/g,'-').replace(/^-|-$/g,''); }

function goTo(module, sub){
  const next = '#/' + module + (sub ? '/' + sub : '');
  if(innerWidth <= 900) closeSide();
  // Assigning an unchanged hash fires no hashchange, so navigating to the
  // view you're already on would silently do nothing — which breaks both
  // "click the nav item to refresh" and returning to a list after an action.
  if(location.hash === next) return route();
  location.hash = next;
}

function route(){
  const parts = (location.hash || '').replace(/^#\/?/, '').split('/').filter(Boolean);
  const module = parts[0] || 'dashboard';
  const sub = parts[1] || '';
  const key = SECTIONS[module] ? module : 'dashboard';
  const allowed = new Set(SESSION.modules);
  const target = allowed.has(key) ? key : 'dashboard';

  document.querySelectorAll('.menu-item').forEach(b=>
    b.classList.toggle('on', b.dataset.m === target));
  document.querySelectorAll('.menu-sub').forEach(g=>{
    g.hidden = g.dataset.subs !== target;
    g.querySelectorAll('button').forEach(b=>
      b.classList.toggle('on', b.dataset.sub === sub));
  });

  const s = SECTIONS[target];
  document.getElementById('pageTitle').textContent = s.label;
  document.getElementById('pageSub').textContent =
    s.phase ? 'Not built yet — planned for phase ' + s.phase : '';

  const el = document.getElementById('content');
  if(target === 'dashboard') return renderDashboard(el);
  if(target === 'settings')  return renderSettings(el, sub || 'company');
  if(target === 'inventory') return renderInventory(el, sub || 'products');
  if(target === 'orders')    return renderOrders(el, sub || 'all-orders');
  if(target === 'production')return renderProduction(el, sub || 'print-jobs');
  if(target === 'dispatch')  return renderDispatch(el, sub || 'pending-shipments');
  if(target === 'customers') return renderCustomers(el, sub || 'all-customers');
  if(target === 'support')   return renderSupport(el, sub || 'ticket-inbox');
  renderStub(el, target, s);
}

function renderStub(el, key, s){
  el.innerHTML = `<div class="card stub">
    <span class="material-symbols-outlined">${s.icon}</span>
    <h2>${esc(s.label)}</h2>
    <p class="muted">This section is planned for phase ${s.phase}. Its shape is
      shown here so the structure of the panel is visible while it's built.</p>
    <ul>${s.subs.map(t=>`<li>${esc(t)}</li>`).join('')}</ul>
  </div>`;
}

/* ── Live data ────────────────────────────────────────────────── */
/* Polling, not SSE: an open event stream would hold a worker thread per
   admin tab, and those same threads serve the blocking image-generation
   calls. The pulse query is tiny, and a list only refetches when the
   watermark actually moves. */
const PULSE_MS = 20000;
let pulseTimer = 0, lastMark = null;

function startPulse(){
  stopPulse();
  pulseTimer = setInterval(pulse, PULSE_MS);
  pulse();
}
function stopPulse(){ clearInterval(pulseTimer); pulseTimer = 0; }

async function pulse(){
  if(document.hidden) return;            // don't poll a backgrounded tab
  const d = await api('/api/admin/pulse');
  const dot = document.getElementById('liveDot');
  const txt = document.getElementById('liveText');
  if(!d.ok){ dot.classList.add('stale'); txt.textContent = 'offline'; return; }
  dot.classList.remove('stale');
  txt.textContent = 'live';
  if(lastMark !== null && d.watermark !== lastMark){
    const onDash = (location.hash || '#/dashboard').startsWith('#/dashboard');
    if(onDash) renderDashboard(document.getElementById('content'));
    else toast('Orders changed — refresh to see the latest');
  }
  lastMark = d.watermark;
}
document.addEventListener('visibilitychange', ()=>{ if(!document.hidden && SESSION) pulse(); });

/* ── Mobile nav ───────────────────────────────────────────────── */
function toggleSide(){
  const open = document.getElementById('side').classList.toggle('open');
  document.getElementById('sideScrim').classList.toggle('on', open);
}
function closeSide(){
  document.getElementById('side').classList.remove('open');
  document.getElementById('sideScrim').classList.remove('on');
}

addEventListener('hashchange', ()=>{ if(SESSION) route(); });
boot();
