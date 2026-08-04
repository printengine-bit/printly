/* ═══════════════ SETTINGS ═══════════════
   Company profile, staff & roles, audit log. Staff and audit are owner-only
   on the server too — the sub-menu hides them, but the API is the gate. */

async function renderSettings(el, sub){
  const tabs = [
    ['company','Company profile'],
    ['staff','Staff & roles'],
    ['audit','Audit log'],
    ['emails','Email log'],
  ].filter(([k]) => k === 'company' || SESSION.user.role === 'owner');

  el.innerHTML = `<div class="row" style="margin-bottom:18px">
    ${tabs.map(([k,label])=>`<button class="btn btn-sm ${sub===k?'btn-primary':'btn-quiet'}"
      onclick="goTo('settings','${k}')">${esc(label)}</button>`).join('')}
  </div><div id="setBody"></div>`;

  const body = document.getElementById('setBody');
  if(sub === 'staff') return renderStaff(body);
  if(sub === 'audit') return renderAudit(body);
  if(sub === 'emails') return renderEmails(body);
  return renderCompany(body);
}

/* ── Company profile ─────────────────────────────────────────── */
const COMPANY_FIELDS = [
  ['legal_name','Registered / legal name','span2'],
  ['trade_name','Trading name',''],
  ['phone','Phone',''],
  ['address','Address','span2'],
  ['city','City',''],
  ['state','State',''],
  ['pincode','PIN code',''],
  ['email','Billing email',''],
  ['gstin','GSTIN',''],
  ['doc_prefix','Document prefix',''],
];

async function renderCompany(el){
  el.innerHTML = '<div class="empty">Loading…</div>';
  const d = await api('/api/admin/company');
  if(!d.ok){ el.innerHTML = `<div class="empty">${esc(d.error)}</div>`; return; }
  const c = d.company;
  const owner = SESSION.user.role === 'owner';

  el.innerHTML = `
    ${!c.gst_registered ? `<div class="alert warn" style="margin-bottom:16px">
      <span class="material-symbols-outlined">warning</span>
      <span><b>No GSTIN on file.</b> Documents will print as delivery notes,
      not tax challans — and the storefront should not be charging a GST line
      until this is filled in.</span>
    </div>` : ''}
    <div class="card">
      <h2>Company profile</h2>
      <p class="tiny muted">Printed on delivery notes and shipping labels.</p>
      <div class="form-grid">
        ${COMPANY_FIELDS.map(([k,label,cls])=>`
          <label class="field ${cls}"><span>${esc(label)}</span>
            <input id="co_${k}" type="text" value="${esc(c[k]||'')}" ${owner?'':'disabled'}>
          </label>`).join('')}
      </div>
      <p class="tiny dim" style="margin-bottom:14px">
        Next delivery note number: <b>${esc(c.doc_prefix)}-DN-${String(c.challan_next).padStart(4,'0')}</b>
      </p>
      ${owner ? `<button class="btn btn-primary" onclick="saveCompany()">Save profile</button>`
              : `<p class="tiny dim">Only an owner can change these.</p>`}
    </div>`;
}

async function saveCompany(){
  const body = {};
  COMPANY_FIELDS.forEach(([k])=>{ body[k] = document.getElementById('co_'+k).value; });
  const d = await api('/api/admin/company', body);
  if(!d.ok){ toast(d.error); return; }
  toast('Company profile saved');
  renderCompany(document.getElementById('setBody'));
}

/* ── Staff ───────────────────────────────────────────────────── */
async function renderStaff(el){
  el.innerHTML = '<div class="empty">Loading…</div>';
  const d = await api('/api/admin/staff');
  if(!d.ok){ el.innerHTML = `<div class="empty">${esc(d.error)}</div>`; return; }

  el.innerHTML = `
    <div class="card">
      <h2>Staff</h2>
      <p class="tiny muted">Who can sign in to this panel, and what they can reach.</p>
      <table>
        <thead><tr><th>Name</th><th>Role</th><th>Status</th><th>Added</th><th></th></tr></thead>
        <tbody>${d.staff.map(m=>`<tr>
          <td data-label="Name"><b>${esc(m.name)}</b><br>
            <span class="tiny dim">${esc(m.email)}</span></td>
          <td data-label="Role">
            <select onchange="setRole(${m.id}, this.value)" ${m.id===SESSION.user.id?'disabled':''}>
              ${d.roles.map(r=>`<option value="${esc(r.key)}" ${r.key===m.role?'selected':''}>
                ${esc(r.label)}</option>`).join('')}
            </select>
          </td>
          <td data-label="Status">${m.active
            ? '<span class="badge badge-lime">Active</span>'
            : '<span class="badge badge-quiet">Disabled</span>'}
            ${m.must_change_password
              ? '<br><span class="badge badge-warn" style="margin-top:4px">Temp password</span>' : ''}</td>
          <td data-label="Added" class="tiny dim">${esc(fmtDate(m.created))}</td>
          <td data-label="">${m.id===SESSION.user.id ? '<span class="tiny dim">you</span>' :
            `<button class="btn btn-quiet btn-sm" onclick="toggleActive(${m.id},${m.active?0:1})">
              ${m.active?'Disable':'Enable'}</button>`}</td>
        </tr>`).join('')}</tbody>
      </table>
    </div>

    <div class="card">
      <h2>Add a staff member</h2>
      <p class="tiny muted">There's no email service wired up yet, so you set the
        first password and pass it on. They'll be forced to change it at sign-in.</p>
      <div class="form-grid">
        <label class="field"><span>Name</span><input id="st_name" type="text"></label>
        <label class="field"><span>Email</span><input id="st_email" type="email"></label>
        <label class="field"><span>Role</span>
          <select id="st_role">${d.roles.map(r=>
            `<option value="${esc(r.key)}">${esc(r.label)}</option>`).join('')}</select></label>
        <label class="field"><span>Temporary password</span>
          <input id="st_pass" type="text" placeholder="at least 8 characters"></label>
      </div>
      <button class="btn btn-primary" onclick="addStaff()">Create account</button>
    </div>

    <div class="card">
      <h2>What each role can reach</h2>
      <p class="tiny muted">The sidebar and the API are built from this same list.</p>
      <table><tbody>${d.roles.map(r=>`<tr>
        <td data-label="Role"><b>${esc(r.label.split(' — ')[0])}</b></td>
        <td data-label="Sections" class="muted">${r.modules.map(m=>esc(m)).join(' · ')}</td>
      </tr>`).join('')}</tbody></table>
    </div>`;
}

async function addStaff(){
  const d = await api('/api/admin/staff', {
    name: document.getElementById('st_name').value,
    email: document.getElementById('st_email').value,
    role: document.getElementById('st_role').value,
    password: document.getElementById('st_pass').value,
  });
  if(!d.ok){ toast(d.error); return; }
  toast(d.member.name + ' can now sign in');
  renderStaff(document.getElementById('setBody'));
}
async function setRole(id, role){
  const d = await api('/api/admin/staff/' + id, {role});
  if(!d.ok){ toast(d.error); }
  else toast('Role updated');
  renderStaff(document.getElementById('setBody'));
}
async function toggleActive(id, active){
  const d = await api('/api/admin/staff/' + id, {active: !!active});
  if(!d.ok){ toast(d.error); }
  else toast(active ? 'Account enabled' : 'Account disabled');
  renderStaff(document.getElementById('setBody'));
}

/* ── Email log ───────────────────────────────────────────────────
   Sending is never allowed to fail an order, which means a bounced
   confirmation is invisible unless it's written down. This is where it
   gets written down — `failed` is the row worth looking at. */
const EMAIL_STATUS_LABEL = {sent:'Sent', failed:'Failed', skipped:'Not sent'};

async function renderEmails(el){
  el.innerHTML = '<div class="empty">Loading…</div>';
  const d = await api('/api/admin/emails');
  if(!d.ok){ el.innerHTML = `<div class="empty">${esc(d.error)}</div>`; return; }
  const c = d.counts || {};
  const skipped = c.skipped || 0;
  el.innerHTML = `<div class="card">
    <h2>Email log</h2>
    <p class="tiny muted">Every send attempt, newest first. Last 200.</p>
    <div class="row" style="gap:14px;margin:10px 0 16px">
      <span class="tiny"><b>${c.sent||0}</b> sent</span>
      <span class="tiny" style="color:${(c.failed||0)?'var(--pink-ink)':'inherit'}">
        <b>${c.failed||0}</b> failed</span>
      <span class="tiny muted"><b>${skipped}</b> not sent</span>
      <span class="tiny muted">· last 7 days</span>
    </div>
    ${skipped ? `<p class="tiny muted" style="margin-bottom:14px">
      "Not sent" means no RESEND_API_KEY is configured — mail is off, and
      nothing else is wrong.</p>` : ''}
    <div class="row" style="gap:10px;align-items:center;margin-bottom:16px">
      <button class="btn btn-quiet btn-sm" id="testMailBtn" onclick="sendTestEmails()">
        Send one of each to me</button>
      <span class="tiny muted" id="testMailMsg">
        Sends all 9 templates to your own address, subject-prefixed [TEST].</span>
    </div>
    ${d.entries.length
      ? `<table><thead><tr><th>When</th><th>To</th><th>Subject</th><th>Status</th></tr></thead>
         <tbody>${d.entries.map(emailRow).join('')}</tbody></table>`
      : '<div class="empty">No emails yet.</div>'}
  </div>`;
}

/* The recipient is decided by the server from your own account row, never
   sent from here — see send_test_emails() for why. */
async function sendTestEmails(){
  const btn = document.getElementById('testMailBtn');
  const msg = document.getElementById('testMailMsg');
  btn.disabled = true;
  msg.textContent = 'Sending…';
  const d = await api('/api/admin/emails/test', {});
  if(!d.ok){
    msg.textContent = d.error || 'Could not send.';
    btn.disabled = false;
    return;
  }
  const failed = (d.failed || []).length;
  msg.textContent = `Sent ${(d.sent||[]).length} to ${d.to}`
    + (failed ? ` · ${failed} failed — see the log below` : '');
  renderEmails(document.getElementById('setBody'));
}

function emailRow(m){
  const tone = m.status === 'failed' ? 'var(--pink-ink)'
             : m.status === 'sent'   ? 'var(--lime-ink)' : 'var(--ink-dim)';
  return `<tr>
    <td data-label="When"><span class="tiny">${esc(m.created||'')}</span></td>
    <td data-label="To">${esc(m.to||'')}<br>
      <span class="tiny dim">${esc(m.kind||'')}</span></td>
    <td data-label="Subject">${esc(m.subject||'')}
      ${m.error?`<br><span class="tiny" style="color:var(--pink-ink)">${esc(m.error)}</span>`:''}</td>
    <td data-label="Status"><b style="color:${tone}">${esc(EMAIL_STATUS_LABEL[m.status]||m.status||'')}</b></td>
  </tr>`;
}

/* ── Audit log ───────────────────────────────────────────────── */
async function renderAudit(el){
  el.innerHTML = '<div class="empty">Loading…</div>';
  const d = await api('/api/admin/audit');
  if(!d.ok){ el.innerHTML = `<div class="empty">${esc(d.error)}</div>`; return; }
  el.innerHTML = `<div class="card">
    <h2>Audit log</h2>
    <p class="tiny muted">Append-only. The last 200 actions across the whole system.</p>
    ${d.entries.length
      ? `<table><tbody>${d.entries.map(rowFor).join('')}</tbody></table>`
      : '<div class="empty">Nothing recorded yet.</div>'}
  </div>`;
}
