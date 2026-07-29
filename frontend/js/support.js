/* ═══════════════ HELP / SUPPORT (customer side) ═══════════════
   There is no email transport, so a support conversation lives here: the
   customer raises a request against an order, staff answer in the panel,
   and the reply appears on this page. That has to be said out loud rather
   than implied, or people wait for an email that never arrives.

   Deliberately part of My Orders instead of a separate page — "something is
   wrong with my order" is a thought people have while looking at the order,
   not while hunting for a contact link in the footer. */

async function renderHelp(){
  const el = document.getElementById('helpBody');
  if(!el) return;
  if(!state.user){ el.innerHTML=''; return; }
  el.innerHTML = '<p class="t-dim" style="font-size:13px">Loading…</p>';
  let tickets = [];
  try{
    const res = await fetch(BACKEND+'/api/support/tickets', {credentials:'include'});
    const d = await res.json();
    if(d.ok) tickets = d.tickets;
  }catch(err){
    el.innerHTML = '<p class="t-dim" style="font-size:13px">Could not reach the server.</p>';
    return;
  }
  state.tickets = tickets;

  el.innerHTML = `
    <div class="card card-pad" style="margin-top:24px">
      <div class="spread" style="margin-bottom:6px">
        <h3 class="t-h3">Need <span class="t-lime">help?</span></h3>
        <button class="btn btn-quiet btn-sm" onclick="openHelpForm()">Raise a request</button>
      </div>
      <p class="t-mut" style="font-size:13px;margin-bottom:18px">
        Ask us anything about an order — a change of size, a delivery address,
        a problem with the print. We answer here, on this page.
      </p>
      <div id="helpForm" style="display:none">
        <div class="field"><label>Which order?</label>
          <select id="hlOrder"></select></div>
        <div class="field"><label>Subject</label>
          <input type="text" id="hlSubject" placeholder="e.g. Wrong size on one tee"></div>
        <div class="field"><label>What's happened?</label>
          <textarea id="hlBody" rows="4" placeholder="Tell us what you need…"></textarea></div>
        <div class="row" style="gap:8px">
          <button class="btn btn-primary" onclick="submitHelp()">Send request</button>
          <button class="btn btn-quiet" onclick="closeHelpForm()">Cancel</button>
        </div>
      </div>
      <div id="helpList">${ticketList(tickets)}</div>
    </div>`;
}

function ticketList(tickets){
  if(!tickets.length){
    return `<p class="t-dim" style="font-size:13px">No requests yet.</p>`;
  }
  return tickets.map(t=>`
    <details class="acc tk">
      <summary>
        <span>${esc(t.subject)}
          <span class="t-dim" style="font-weight:400">
            · ${esc(t.order || 'general')} · ${esc(fmtDate(t.created))}</span></span>
        <span class="badge ${t.status==='closed'?'badge-quiet':'badge-lime'}">${esc(t.status)}</span>
      </summary>
      <div class="tk-thread">
        ${(t.messages||[]).map(m=>`
          <div class="tk-msg ${m.from_staff?'them':''}">
            <div class="t-dim" style="font-size:11px;margin-bottom:3px">
              ${m.from_staff?'Printly':'You'} · ${esc(fmtWhen(m.created))}</div>
            <p>${esc(m.body).replace(/\n/g,'<br>')}</p>
          </div>`).join('')}
      </div>
      ${t.status!=='closed'?`
        <div class="row" style="gap:8px;margin-top:12px">
          <input type="text" id="tkr_${t.id}" placeholder="Reply…" style="flex:1">
          <button class="btn btn-quiet btn-sm" onclick="replyTicket(${t.id})">Send</button>
        </div>`:`<p class="t-dim" style="font-size:12px;margin-top:10px">
          This request is closed. Replying reopens it — raise a new one if it's
          about something else.</p>
        <div class="row" style="gap:8px;margin-top:8px">
          <input type="text" id="tkr_${t.id}" placeholder="Reply to reopen…" style="flex:1">
          <button class="btn btn-quiet btn-sm" onclick="replyTicket(${t.id})">Send</button>
        </div>`}
    </details>`).join('');
}

function openHelpForm(){
  const sel = document.getElementById('hlOrder');
  const orders = state.myOrders || [];
  sel.innerHTML = `<option value="">Not about a specific order</option>` +
    orders.map(o=>`<option value="${esc(o.id)}">${esc(o.id)} · ${fmtDate(o.created)}</option>`).join('');
  document.getElementById('helpForm').style.display = 'block';
  document.getElementById('hlSubject').focus();
}
function closeHelpForm(){
  const f = document.getElementById('helpForm');
  if(f) f.style.display = 'none';
}

async function submitHelp(){
  const body = {
    order: document.getElementById('hlOrder').value || null,
    subject: document.getElementById('hlSubject').value.trim(),
    body: document.getElementById('hlBody').value.trim(),
  };
  try{
    const res = await fetch(BACKEND+'/api/support/tickets', {
      method:'POST', credentials:'include',
      headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)});
    const d = await res.json();
    if(!d.ok){ toast(d.error || 'Could not send that.'); return; }
    toast('Sent — we usually reply the same day');
    closeHelpForm();
    renderHelp();
  }catch(err){ toast('Could not reach the server — try again.'); }
}

async function replyTicket(id){
  const box = document.getElementById('tkr_'+id);
  const text = (box.value || '').trim();
  if(!text){ toast('Type something first'); return; }
  try{
    const res = await fetch(BACKEND+'/api/support/tickets/'+id+'/reply', {
      method:'POST', credentials:'include',
      headers:{'Content-Type':'application/json'}, body:JSON.stringify({body:text})});
    const d = await res.json();
    if(!d.ok){ toast(d.error || 'Could not send that.'); return; }
    box.value = '';
    toast('Sent');
    renderHelp();
  }catch(err){ toast('Could not reach the server — try again.'); }
}
