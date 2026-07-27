/* ═══════════════ DASHBOARD ═══════════════ */

async function renderDashboard(el){
  el.innerHTML = '<div class="empty">Loading…</div>';
  const d = await api('/api/admin/dashboard');
  if(!d.ok){ el.innerHTML = `<div class="empty">${esc(d.error)}</div>`; return; }
  const c = d.counters;

  el.innerHTML = `
    <div class="grid g4" style="margin-bottom:18px">
      <div class="stat"><span>Orders today</span><b>${c.today}</b></div>
      <div class="stat"><span>In production</span><b>${c.in_production}</b></div>
      <div class="stat"><span>Awaiting proof</span><b>${c.awaiting_proof}</b></div>
      <div class="stat"><span>Live value</span><b>${money(c.live_value)}</b></div>
    </div>

    ${d.alerts.length ? `<div class="card">
      <h2>Needs attention</h2>
      <p class="tiny muted">Things that won't fix themselves.</p>
      ${d.alerts.map(a=>`<div class="alert ${a.level==='warn'?'warn':''}">
        <span class="material-symbols-outlined">${a.level==='warn'?'warning':'info'}</span>
        <span>${esc(a.text)}</span>
        <button onclick="goTo('${esc(a.module)}')">Open →</button>
      </div>`).join('')}
    </div>` : `<div class="card">
      <h2>Needs attention</h2>
      <p class="tiny muted">Nothing flagged right now.</p>
    </div>`}

    <div class="card">
      <h2>Recent activity</h2>
      <p class="tiny muted">Every staff action, newest first.</p>
      ${d.recent.length ? `<table><tbody>${d.recent.map(rowFor).join('')}</tbody></table>`
        : '<div class="empty">Nothing recorded yet.</div>'}
    </div>

    <div class="card">
      <h2>Business snapshot</h2>
      <p class="tiny muted">Counts across the whole life of the shop.</p>
      <div class="grid g3">
        <div class="stat"><span>Customers</span><b>${c.customers}</b></div>
        <div class="stat"><span>Delivered</span><b>${c.delivered}</b></div>
        <div class="stat"><span>Cancelled</span><b>${c.cancelled}</b></div>
      </div>
    </div>`;
}

const ACTION_LABEL = {
  placed:'Order placed', stage:'Stage changed', cancelled:'Order cancelled',
  restored:'Order restored', note:'Note added', created:'Staff added',
  role_changed:'Role changed', activated:'Staff activated',
  deactivated:'Staff deactivated', password_reset:'Password reset',
  updated:'Updated',
};

function rowFor(e){
  const what = e.entity === 'order' && e.entity_id != null
    ? 'PL-' + (1000 + e.entity_id) : e.entity;
  const detail = e.action === 'stage'
    ? `${esc(STAGES[e.from] || '—')} → ${esc(STAGES[e.to] || '—')}`
    : esc(e.note || '');
  return `<tr>
    <td data-label="Action"><b>${esc(ACTION_LABEL[e.action] || e.action)}</b></td>
    <td data-label="On">${esc(what)}</td>
    <td data-label="Detail" class="muted">${detail}</td>
    <td data-label="Who" class="tiny dim">${esc(e.actor || 'system')} · ${esc(fmtWhen(e.created))}</td>
  </tr>`;
}

/* Mirrors the stage names the storefront's order tracker uses. */
const STAGES = ['Proof sent','Approved','Printing','Quality check','Shipped','Delivered'];
