/* ═══════════════ ACCOUNT HUB ═══════════════
   Profile, address book and settings — see v-account's comment in
   index.html for why Orders/Designs/Wishlist/Support live on their own
   existing views instead of being re-plumbed in here. */
state.accountTab = state.accountTab || 'profile';
state.addresses = [];
state._addrEditing = null;   // null | 'new' | an address id

function setAccountTab(tab){
  state.accountTab = tab;
  state._addrEditing = null;
  renderAccount();
}

function renderAccount(){
  document.querySelectorAll('.account-nav button')
    .forEach(b=>b.classList.toggle('on', b.dataset.tab===state.accountTab));
  const el=document.getElementById('accountBody'); if(!el) return;
  if(!state.user){
    el.innerHTML=`<div class="empty">
      <span class="material-symbols-outlined">account_circle</span><br>
      Sign in to manage your account.<br><br>
      <button class="btn btn-primary" onclick="openLogin()">Sign in →</button></div>`;
    return;
  }
  if(state.accountTab==='addresses'){ renderAddressTab(el); return; }
  if(state.accountTab==='settings'){ renderSettingsTab(el); return; }
  renderProfileTab(el);
}

/* ── Profile ──────────────────────────────────────────────────── */
function renderProfileTab(el){
  el.innerHTML=`
    <div class="card card-pad" style="max-width:420px">
      <h3 class="t-h3" style="margin-bottom:18px">Profile</h3>
      <label class="field"><span>Name</span>
        <input id="pf_name" type="text" value="${esc(state.user.name)}"></label>
      <label class="field"><span>Email</span>
        <input type="email" value="${esc(state.user.email)}" disabled></label>
      <p class="t-dim" style="font-size:12px;margin:-8px 0 16px">
        Email is your sign-in — email <a href="mailto:hello@printengine.in">hello@printengine.in</a> to change it.</p>
      <label class="field"><span>Mobile number (optional)</span>
        <input id="pf_phone" type="tel" inputmode="numeric" maxlength="10"
               placeholder="10-digit mobile" value="${esc(state.user.phone||'')}"></label>
      <button class="btn btn-primary" id="pf_save" onclick="saveProfile()">Save changes</button>
    </div>`;
}
async function saveProfile(){
  const name=document.getElementById('pf_name').value.trim();
  const phone=document.getElementById('pf_phone').value.trim();
  const btn=document.getElementById('pf_save'); btn.disabled=true;
  let d;
  try{
    const res=await fetch(BACKEND+'/api/auth/profile',{method:'POST',
      headers:{'Content-Type':'application/json'},credentials:'include',
      body:JSON.stringify({name,phone})});
    d=await res.json();
  }catch(err){ toast('Could not reach the server — try again.'); btn.disabled=false; return; }
  btn.disabled=false;
  if(!d.ok){ toast(d.error||'Could not save.'); return; }
  state.user=d.user; applyAuthUI(); toast('Profile updated');
}

/* ── Addresses ────────────────────────────────────────────────────
   Reuses SHIP_FIELDS from cart.js (the checkout form's own field list)
   for the shared name/phone/line1.../pincode set, so the two forms can
   never drift into asking for different things. */
async function loadAddresses(){
  try{
    const res=await fetch(BACKEND+'/api/account/addresses',{credentials:'include'});
    const d=await res.json();
    if(d.ok) state.addresses=d.addresses;
  }catch(err){ /* the tab still renders, just empty */ }
}

async function renderAddressTab(el){
  el.innerHTML='<div class="empty">Loading…</div>';
  await loadAddresses();
  if(state.accountTab!=='addresses') return;   // tab changed while awaiting
  if(state._addrEditing!==null){ el.innerHTML=addressFormHtml(); return; }
  el.innerHTML=`
    <div class="row" style="justify-content:space-between;align-items:center;margin-bottom:16px">
      <h3 class="t-h3">Saved addresses</h3>
      <button class="btn btn-primary btn-sm" onclick="openAddressForm('new')">+ Add address</button>
    </div>
    ${state.addresses.length ? `<div class="stack" style="gap:12px">
      ${state.addresses.map(addressCardHtml).join('')}</div>`
    : `<div class="empty">
        <span class="material-symbols-outlined">location_on</span><br>
        No saved addresses yet.<br><br>
        <button class="btn btn-primary" onclick="openAddressForm('new')">Add your first address →</button></div>`}`;
}

function addressCardHtml(a){
  return `
    <div class="card card-pad addr-card">
      <div class="row" style="justify-content:space-between;align-items:flex-start">
        <div>
          <div class="row" style="gap:8px;align-items:center;margin-bottom:4px">
            <b>${esc(a.label||'Address')}</b>
            ${a.is_default?'<span class="badge badge-lime">Default</span>':''}
          </div>
          <div class="t-mut" style="font-size:13.5px;line-height:1.6">
            ${esc(a.name)} · ${esc(a.phone)}<br>
            ${esc(a.line1)}${a.line2?', '+esc(a.line2):''}<br>
            ${esc(a.city)}, ${esc(a.state)} ${esc(a.pincode)}
          </div>
        </div>
        <div class="row" style="gap:6px;flex-shrink:0">
          <button class="btn btn-quiet btn-sm" onclick="openAddressForm(${a.id})">Edit</button>
          <button class="btn btn-quiet btn-sm" onclick="deleteAddress(${a.id})">Delete</button>
        </div>
      </div>
    </div>`;
}

function openAddressForm(which){
  state._addrEditing=which;
  renderAccount();
}
function closeAddressForm(){
  state._addrEditing=null;
  renderAccount();
}

function addressFormHtml(){
  const editing = state._addrEditing!=='new'
    ? state.addresses.find(a=>a.id===state._addrEditing) : null;
  const v = editing || {label:'',name:'',phone:'',line1:'',line2:'',city:'',state:'',pincode:'',is_default:false};
  return `
    <div class="card card-pad" style="max-width:520px">
      <h3 class="t-h3" style="margin-bottom:16px">${editing?'Edit address':'Add address'}</h3>
      <label class="field"><span>Label (optional)</span>
        <input id="ad_label" type="text" placeholder="e.g. Home, Office" value="${esc(v.label)}"></label>
      <div class="ship-grid">${SHIP_FIELDS.map(([k,label,type,auto])=>`
        <label class="field ${k==='line1'||k==='line2'?'span2':''}">
          <span>${label}</span>
          <input id="ad_${k}" type="${type}" autocomplete="${auto}" value="${esc(v[k]||'')}"
                 ${k==='pincode'?'inputmode="numeric" maxlength="6"':''}
                 ${k==='phone'?'inputmode="numeric" maxlength="10"':''}>
        </label>`).join('')}</div>
      <label class="row" style="gap:8px;align-items:center;margin:4px 0 18px;cursor:pointer">
        <input id="ad_default" type="checkbox" style="width:auto" ${v.is_default?'checked':''}>
        <span class="t-mut" style="font-size:13px">Set as default address</span>
      </label>
      <div class="row" style="gap:8px">
        <button class="btn btn-primary" id="ad_save" onclick="saveAddress()">Save address</button>
        <button class="btn btn-quiet" onclick="closeAddressForm()">Cancel</button>
      </div>
    </div>`;
}

async function saveAddress(){
  const v={label:document.getElementById('ad_label').value.trim()};
  SHIP_FIELDS.forEach(([k])=>{ v[k]=document.getElementById('ad_'+k).value.trim(); });
  v.is_default=document.getElementById('ad_default').checked;
  const btn=document.getElementById('ad_save'); btn.disabled=true;
  const isNew = state._addrEditing==='new';
  const path = isNew ? '/api/account/addresses' : '/api/account/addresses/'+state._addrEditing;
  let d;
  try{
    const res=await fetch(BACKEND+path,{method:'POST',
      headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify(v)});
    d=await res.json();
  }catch(err){ toast('Could not reach the server — try again.'); btn.disabled=false; return; }
  btn.disabled=false;
  if(!d.ok){ toast(d.error||'Could not save.'); return; }
  toast(isNew?'Address added':'Address updated');
  state._addrEditing=null;
  renderAccount();
}

async function deleteAddress(id){
  if(!confirm('Remove this address?')) return;
  let d;
  try{
    const res=await fetch(BACKEND+'/api/account/addresses/'+id,{method:'DELETE',credentials:'include'});
    d=await res.json();
  }catch(err){ toast('Could not reach the server — try again.'); return; }
  if(!d.ok){ toast(d.error||'Could not delete.'); return; }
  toast('Address removed');
  renderAccount();
}

/* ── Settings ─────────────────────────────────────────────────── */
function renderSettingsTab(el){
  el.innerHTML=`
    <div class="card card-pad" style="max-width:420px">
      <h3 class="t-h3" style="margin-bottom:18px">Change password</h3>
      <label class="field"><span>Current password</span>
        <input id="pw_current" type="password"></label>
      <label class="field"><span>New password</span>
        <input id="pw_new" type="password" placeholder="At least 8 characters"></label>
      <button class="btn btn-primary" id="pw_save" onclick="changePassword()">Update password</button>
    </div>`;
  enhancePasswordFields();
}
async function changePassword(){
  const current=document.getElementById('pw_current').value;
  const password=document.getElementById('pw_new').value;
  if(password.length<8){ toast('New password must be at least 8 characters'); return; }
  const btn=document.getElementById('pw_save'); btn.disabled=true;
  let d;
  try{
    const res=await fetch(BACKEND+'/api/auth/change-password',{method:'POST',
      headers:{'Content-Type':'application/json'},credentials:'include',
      body:JSON.stringify({current,password})});
    d=await res.json();
  }catch(err){ toast('Could not reach the server — try again.'); btn.disabled=false; return; }
  btn.disabled=false;
  if(!d.ok){ toast(d.error||'Could not update password.'); return; }
  toast('Password updated');
  document.getElementById('pw_current').value='';
  document.getElementById('pw_new').value='';
}
