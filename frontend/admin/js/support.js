/* ═══════════════ SUPPORT ═══════════════
   One inbox. Tickets arrive from the storefront when a customer asks about
   an order, or get logged here when a conversation happened somewhere we
   don't own — a phone call, a WhatsApp message.

   A public reply is emailed to the customer AND appears in their account.
   An internal note is neither — it stays staff-only, and mailer is never
   called for it. That distinction is the whole reason the compose box makes
   you choose. */

const supState = {open:null, scope:'open', q:'', canned:[]};

async function renderSupport(el, sub){
  const tabs = [['ticket-inbox','Ticket inbox'],['unassigned','Unassigned'],
                ['canned-replies','Canned replies']];
  el.innerHTML = `<div class="row" style="margin-bottom:18px">
    ${tabs.map(([k,label])=>`<button class="btn btn-sm ${(sub||'ticket-inbox')===k?'btn-primary':'btn-quiet'}"
      onclick="goTo('support','${k}')">${esc(label)}</button>`).join('')}
  </div><div id="supBody"></div>
  <div class="drawer-scrim" onclick="closeTicket()"></div>
  <aside class="drawer" id="tkDrawer"></aside>`;
  const body = document.getElementById('supBody');
  if(sub === 'canned-replies') return renderCanned(body);
  if(sub === 'unassigned'){ supState.scope = 'unassigned'; }
  else if(supState.scope === 'unassigned'){ supState.scope = 'open'; }
  return renderInbox(body);
}

async function renderInbox(el){
  el.innerHTML = '<div class="empty">Loading…</div>';
  const d = await api('/api/admin/support/tickets?scope='+supState.scope
    + (supState.q ? '&q='+encodeURIComponent(supState.q) : ''));
  if(!d.ok){ el.innerHTML = `<div class="empty">${esc(d.error)}</div>`; return; }
  const filters = [['open','Open',d.counts.open],['mine','Mine',d.counts.mine],
                   ['unassigned','Unassigned',d.counts.unassigned],
                   ['closed','Closed',d.counts.closed]];
  el.innerHTML = `
    <div class="row" style="margin-bottom:14px">
      ${filters.map(([k,label,n])=>`<button class="chip ${supState.scope===k?'on':''}"
        onclick="setScope('${k}')">${esc(label)} <b>${n}</b></button>`).join('')}
      <span style="flex:1"></span>
      <button class="btn btn-primary btn-sm" onclick="newTicketFor()">Log a conversation</button>
    </div>
    <div class="row" style="margin-bottom:14px">
      <input id="tkSearch" type="text" placeholder="Search subject, name or email"
        value="${esc(supState.q)}" style="max-width:320px"
        onkeydown="if(event.key==='Enter')searchTickets()">
      <button class="btn btn-quiet btn-sm" onclick="searchTickets()">Search</button>
      ${supState.q?`<button class="btn btn-quiet btn-sm" onclick="supState.q='';searchTickets()">Clear</button>`:''}
    </div>
    <div class="card" style="padding:0;overflow:hidden">
      ${d.tickets.length ? `<table>
        <thead><tr><th>Ticket</th><th>Customer</th><th>Assigned</th><th>Updated</th><th></th></tr></thead>
        <tbody>${d.tickets.map(t=>`<tr class="${t.status==='closed'?'row-off':''}">
          <td data-label="Ticket">
            ${t.priority==='high'?'<span class="badge badge-warn">High</span> ':''}
            <b>${esc(t.subject)}</b><br>
            <span class="tiny dim">#${t.id}${t.order?' · '+esc(t.order):''}
              · ${t.messages_count} message(s)</span></td>
          <td data-label="Customer">${esc(t.customer_name||'—')}<br>
            <span class="tiny dim">${esc(t.customer_email||'')}</span></td>
          <td data-label="Assigned">${t.assignee
            ? esc(t.assignee) : '<span class="badge badge-warn">nobody</span>'}</td>
          <td data-label="Updated" class="tiny dim">${esc(fmtWhen(t.updated))}<br>
            <span class="badge badge-quiet">${esc(t.status)}</span></td>
          <td data-label=""><button class="btn btn-quiet btn-sm"
            onclick="openTicket(${t.id})">Open</button></td>
        </tr>`).join('')}</tbody></table>`
        : `<div class="empty"><span class="material-symbols-outlined">support_agent</span>
           <br>Nothing here. Customers can raise a request from any order on the storefront.</div>`}
    </div>`;
}

function setScope(s){ supState.scope=s; renderInbox(document.getElementById('supBody')); }
function searchTickets(){
  const el=document.getElementById('tkSearch');
  supState.q=(el?el.value:'').trim();
  renderInbox(document.getElementById('supBody'));
}

/* ── Ticket drawer ───────────────────────────────────────────── */
async function openTicket(id){
  supState.open = id;
  const dr = document.getElementById('tkDrawer');
  if(!dr) return;
  dr.classList.add('on');
  document.querySelector('.drawer-scrim').classList.add('on');
  dr.innerHTML = '<div class="empty">Loading…</div>';
  const [d, canned] = await Promise.all([
    api('/api/admin/support/tickets/'+id),
    supState.canned.length ? Promise.resolve({ok:true, replies:supState.canned})
                           : api('/api/admin/support/canned'),
  ]);
  if(!d.ok){ dr.innerHTML = `<div class="empty">${esc(d.error)}</div>`; return; }
  if(canned.ok) supState.canned = canned.replies;
  const t = d.ticket;
  dr.innerHTML = `
    <div class="drawer-head">
      <div><h2>${esc(t.subject)}</h2>
        <p class="tiny muted">#${t.id} · ${esc(t.customer_name||'no account')}
          ${t.order?' · '+esc(t.order):''} · opened ${esc(fmtWhen(t.created))}</p></div>
      <button class="icon-btn" onclick="closeTicket()" aria-label="Close">
        <span class="material-symbols-outlined">close</span></button>
    </div>
    <div class="drawer-body">
      <div class="row" style="margin-bottom:16px">
        <select id="tkStatus" onchange="patchTicket(${t.id},{status:this.value})" style="max-width:150px">
          ${['open','pending','closed'].map(s=>
            `<option value="${s}"${t.status===s?' selected':''}>${s}</option>`).join('')}
        </select>
        <select id="tkPriority" onchange="patchTicket(${t.id},{priority:this.value})" style="max-width:150px">
          ${['low','normal','high'].map(s=>
            `<option value="${s}"${t.priority===s?' selected':''}>${s} priority</option>`).join('')}
        </select>
        <select id="tkAssignee" onchange="patchTicket(${t.id},{assignee_id:this.value?+this.value:null})" style="max-width:190px">
          <option value="">Unassigned</option>
          ${d.staff.map(s=>`<option value="${s.id}"${t.assignee_id===s.id?' selected':''}>
            ${esc(s.name)}</option>`).join('')}
        </select>
      </div>

      <div class="thread">
        ${t.messages.map(m=>`<div class="msg ${m.from_staff?'staff':''} ${m.internal?'note':''}">
          <div class="msg-head">
            <b>${m.internal?'Internal note':(m.from_staff?'You / staff':esc(t.customer_name||'Customer'))}</b>
            <span class="tiny dim">${esc(m.author||'')} · ${esc(fmtWhen(m.created))}</span>
          </div>
          <p>${esc(m.body).replace(/\n/g,'<br>')}</p>
        </div>`).join('')}
      </div>

      <section>
        <h3 class="tiny muted lbl">Reply</h3>
        ${supState.canned.length?`<div class="row" style="margin-bottom:8px">
          <select id="tkCanned" onchange="useCanned()" style="max-width:100%">
            <option value="">Insert a canned reply…</option>
            ${supState.canned.map(c=>`<option value="${c.id}">${esc(c.title)}</option>`).join('')}
          </select>
        </div>`:''}
        <textarea id="tkBody" rows="5" placeholder="Type your reply…"></textarea>
        <div class="row" style="margin-top:10px">
          <button class="btn btn-primary" onclick="sendReply(${t.id},false)">Send to customer</button>
          <button class="btn btn-quiet" onclick="sendReply(${t.id},true)">Save internal note</button>
        </div>
        <p class="tiny dim" style="margin-top:8px">
          There's no email yet — a reply reaches the customer by appearing on
          their <b>My orders → Help</b> page, so tell them there if it's urgent.
          An internal note is never shown to them.
        </p>
      </section>

      ${t.customer_id?`<button class="btn btn-quiet btn-sm"
        onclick="closeTicket();goTo('customers','all-customers');setTimeout(()=>openCustomer(${t.customer_id}),400)">
        Open customer</button>`:''}
    </div>`;
  const thread = dr.querySelector('.thread');
  if(thread) thread.scrollTop = thread.scrollHeight;
}
function closeTicket(){
  supState.open = null;
  const dr = document.getElementById('tkDrawer');
  if(dr) dr.classList.remove('on');
  const sc = document.querySelector('.drawer-scrim');
  if(sc) sc.classList.remove('on');
}

function useCanned(){
  const sel = document.getElementById('tkCanned');
  const c = supState.canned.find(x=>String(x.id)===sel.value);
  if(!c) return;
  const box = document.getElementById('tkBody');
  // Append rather than replace — half a typed reply shouldn't vanish because
  // someone wanted a standard paragraph after it.
  box.value = box.value ? box.value.replace(/\s*$/,'\n\n') + c.body : c.body;
  sel.value = '';
  box.focus();
}

async function patchTicket(id, patch){
  const d = await api('/api/admin/support/tickets/'+id, patch);
  if(!d.ok){ toast(d.error); openTicket(id); return; }
  toast('Updated');
  renderInbox(document.getElementById('supBody'));
}

async function sendReply(id, internal){
  const box = document.getElementById('tkBody');
  const d = await api('/api/admin/support/tickets/'+id+'/reply',
                      {body: box.value, internal: !!internal});
  if(!d.ok){ toast(d.error); return; }
  box.value = '';
  toast(internal ? 'Note saved' : 'Reply added');
  openTicket(id);
  renderInbox(document.getElementById('supBody'));
}

/* ── Log a conversation that came in elsewhere ───────────────── */
async function newTicketFor(userId, name){
  const subject = prompt(name ? 'Subject for '+name+"'s conversation:" : 'Subject:');
  if(!subject) return;
  const body = prompt('What was said? (saved as an internal note)') || '';
  const d = await api('/api/admin/support/tickets',
                      {subject, body, user_id: userId || null});
  if(!d.ok){ toast(d.error); return; }
  toast('Logged');
  renderInbox(document.getElementById('supBody'));
  openTicket(d.id);
}

/* ── Canned replies ──────────────────────────────────────────── */
async function renderCanned(el){
  el.innerHTML = '<div class="empty">Loading…</div>';
  const d = await api('/api/admin/support/canned');
  if(!d.ok){ el.innerHTML = `<div class="empty">${esc(d.error)}</div>`; return; }
  supState.canned = d.replies;
  el.innerHTML = `
    <div class="card">
      <h2>Canned replies</h2>
      <p class="tiny muted">Standard paragraphs you can drop into a reply and
        then edit. They're inserted, not sent — nothing goes out untouched.</p>
      ${d.replies.map(c=>`<div class="canned">
        <div class="spread">
          <b>${esc(c.title)}</b>
          <button class="btn btn-quiet btn-sm" onclick="deleteCanned(${c.id})">Remove</button>
        </div>
        <p class="tiny">${esc(c.body)}</p>
      </div>`).join('') || '<div class="empty">None saved.</div>'}
    </div>
    <div class="card">
      <h2>Add one</h2>
      <label class="field"><span>Title</span><input id="cnTitle" type="text"
        placeholder="e.g. Asking for artwork"></label>
      <label class="field"><span>Body</span><textarea id="cnBody" rows="4"></textarea></label>
      <button class="btn btn-primary" onclick="saveCanned()">Save</button>
    </div>`;
}
async function saveCanned(){
  const d = await api('/api/admin/support/canned', {
    title: document.getElementById('cnTitle').value,
    body: document.getElementById('cnBody').value,
  });
  if(!d.ok){ toast(d.error); return; }
  toast('Saved');
  renderCanned(document.getElementById('supBody'));
}
async function deleteCanned(id){
  const d = await api('/api/admin/support/canned/'+id, null, 'DELETE');
  if(!d.ok){ toast(d.error); return; }
  supState.canned = [];
  renderCanned(document.getElementById('supBody'));
}
