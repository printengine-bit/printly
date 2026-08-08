/* ═══════════════ AUTH ═══════════════ */
let authMode='login';
function openLogin(){ document.getElementById('loginModal').classList.add('on'); }
function closeLogin(){ document.getElementById('loginModal').classList.remove('on'); }
function toggleAuthMode(){
  authMode = authMode==='login' ? 'signup' : 'login';
  const isSignup = authMode==='signup';
  document.getElementById('authTitle').textContent = isSignup ? 'Create your Print Engine account' : 'Sign in to Print Engine';
  document.getElementById('authNameRow').style.display = isSignup ? 'block' : 'none';
  document.getElementById('authSubmitBtn').textContent = isSignup ? 'Create account →' : 'Sign in →';
  document.getElementById('authToggleText').textContent = isSignup ? 'Already have an account?' : 'New to Print Engine?';
  document.getElementById('authToggleLink').textContent = isSignup ? 'Sign in' : 'Create an account';
}
function _initials(name){
  return (name||'').trim().split(/\s+/).slice(0,2).map(w=>w[0]||'').join('').toUpperCase();
}
function applyAuthUI(){
  const pill=document.getElementById('userPill');
  if(state.user){
    pill.innerHTML=esc(state.user.name.split(' ')[0])+
      ' <span class="material-symbols-outlined" style="font-size:16px;vertical-align:-3px">expand_more</span>';
    pill.onclick=toggleUserMenu;
    document.getElementById('userAvatar').textContent=_initials(state.user.name);
    document.getElementById('userDdName').textContent=state.user.name;
    document.getElementById('userDdEmail').textContent=state.user.email;
  } else {
    pill.textContent='Sign in';
    pill.onclick=openLogin;
    closeUserMenu();
  }
}
function toggleUserMenu(){
  document.getElementById('userDropdown').classList.toggle('on');
}
function closeUserMenu(){
  document.getElementById('userDropdown').classList.remove('on');
}
/* Opens the account hub on a specific tab — the dropdown's Profile,
   Addresses and Settings items all route here, since those three are the
   only genuinely new pages; Orders/Wishlist/My designs stay on their
   existing top-level views (see v-account's comment in index.html). */
function openAccount(tab){
  closeUserMenu();
  if(!state.user){ openLogin(); return; }
  go('account');
  setAccountTab(tab);
}
async function doLogin(){
  const email=document.getElementById('authEmail').value.trim();
  const password=document.getElementById('authPassword').value;
  const name=document.getElementById('authName').value.trim();
  if(!email||!password){ toast('Enter email and password'); return; }
  if(authMode==='signup' && !name){ toast('Enter your name'); return; }
  const btn=document.getElementById('authSubmitBtn');
  btn.disabled=true;
  try{
    const path = authMode==='signup' ? '/api/auth/signup' : '/api/auth/login';
    const body = authMode==='signup' ? {name,email,password} : {email,password};
    const res=await fetch(BACKEND+path,{method:'POST',headers:{'Content-Type':'application/json'},
      credentials:'include', body:JSON.stringify(body)});
    const d=await res.json();
    if(!d.ok){ toast(d.error||'Something went wrong'); return; }
    state.user=d.user;
    applyAuthUI(); loadWishlist();
    closeLogin(); toast('Welcome, '+d.user.name.split(' ')[0]+'! You are signed in.');
  }catch(err){
    toast('Could not reach the server — try again.');
  }
  btn.disabled=false;
}
async function doLogout(){
  try{ await fetch(BACKEND+'/api/auth/logout',{method:'POST',credentials:'include'}); }catch(e){}
  state.user=null; state.wishlist=new Set(); applyAuthUI(); refreshWishlistUI(); toast('Signed out');
  if(state.view==='orders'||state.view==='wishlist') go('home');
}
async function checkSession(){
  try{
    const res=await fetch(BACKEND+'/api/auth/me',{credentials:'include'});
    const d=await res.json();
    if(d.ok && d.user){ state.user=d.user; applyAuthUI(); loadWishlist(); }
  }catch(err){ /* backend offline — stay signed out locally */ }
}

/* ── Password reset ───────────────────────────────────────────────
   Two modals: ask for a link (#forgotModal), then set the new password
   (#resetModal). The second is opened by initReset() when the page loads
   with a ?reset=<token> query string — the link in the email. That needs no
   Flask route of its own, because a query string doesn't change which view
   is served. */
function openForgot(){
  closeLogin();
  const pre=document.getElementById('authEmail').value.trim();
  if(pre) document.getElementById('forgotEmail').value=pre;
  document.getElementById('forgotMsg').textContent='';
  document.getElementById('forgotModal').classList.add('on');
}
function closeForgot(){ document.getElementById('forgotModal').classList.remove('on'); }
function closeReset(){ document.getElementById('resetModal').classList.remove('on'); }

async function doForgot(){
  const email=document.getElementById('forgotEmail').value.trim();
  if(!email){ toast('Enter your email'); return; }
  const btn=document.getElementById('forgotBtn'), msg=document.getElementById('forgotMsg');
  btn.disabled=true;
  try{
    const res=await fetch(BACKEND+'/api/auth/forgot',{method:'POST',
      headers:{'Content-Type':'application/json'},credentials:'include',
      body:JSON.stringify({email})});
    const d=await res.json();
    // The server answers identically whether or not the account exists, so
    // this message must not imply the address was found.
    msg.textContent=d.message||'If that address has an account, a reset link is on its way.';
  }catch(err){
    msg.textContent='Could not reach the server — try again.';
  }
  btn.disabled=false;
}

async function doReset(){
  const password=document.getElementById('resetPassword').value;
  if(password.length<8){ toast('Password must be at least 8 characters'); return; }
  const btn=document.getElementById('resetBtn'), msg=document.getElementById('resetMsg');
  btn.disabled=true;
  try{
    const res=await fetch(BACKEND+'/api/auth/reset',{method:'POST',
      headers:{'Content-Type':'application/json'},credentials:'include',
      body:JSON.stringify({token:resetToken,password})});
    const d=await res.json();
    if(!d.ok){ msg.textContent=d.error||'Something went wrong'; btn.disabled=false; return; }
    closeReset();
    toast('Password updated — sign in with it now.');
    openLogin();
  }catch(err){
    msg.textContent='Could not reach the server — try again.';
  }
  btn.disabled=false;
}

let resetToken='';
/* Called once at boot from init.js. */
function initReset(){
  const token=new URLSearchParams(location.search).get('reset');
  if(!token) return;
  resetToken=token;
  // Strip the token out of the address bar so it doesn't sit in history, get
  // screenshotted, or leak through a Referer header on the next click.
  history.replaceState({}, '', location.pathname);
  document.getElementById('resetModal').classList.add('on');
  enhancePasswordFields(document.getElementById('resetModal'));
}

/* ── Reveal a password ────────────────────────────────────────────
   A password field that shows only dots is where typos go unnoticed, and
   "at least 8 characters" is exactly the rule people fail silently.

   Applied by walking the DOM rather than by hand at each field, so any
   password input added later is covered without remembering to wire it up.
   Call again after rendering one into the page. */
function enhancePasswordFields(root){
  (root || document).querySelectorAll('input[type=password]').forEach(inp=>{
    if(inp.dataset.pwWired) return;
    inp.dataset.pwWired='1';
    const wrap=document.createElement('span');
    wrap.className='pw-wrap';
    inp.parentNode.insertBefore(wrap,inp);
    wrap.appendChild(inp);
    const btn=document.createElement('button');
    btn.type='button';                    // inside a <form>: must not submit
    btn.className='pw-toggle';
    btn.setAttribute('aria-pressed','false');
    btn.setAttribute('aria-label','Show password');
    btn.innerHTML='<span class="material-symbols-outlined">visibility</span>';
    btn.onclick=()=>{
      const show=inp.type==='password';
      inp.type=show?'text':'password';
      btn.setAttribute('aria-pressed',String(show));
      btn.setAttribute('aria-label',show?'Hide password':'Show password');
      btn.firstChild.textContent=show?'visibility_off':'visibility';
      // Put the caret back at the end — a field that jumps to position 0 on
      // reveal is worse than not being able to read it.
      const at=inp.value.length;
      inp.focus();
      try{ inp.setSelectionRange(at,at); }catch(err){}
    };
    wrap.appendChild(btn);
  });
}
