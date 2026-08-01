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
function applyAuthUI(){
  const pill=document.getElementById('userPill');
  if(state.user){
    pill.textContent='👤 '+state.user.name.split(' ')[0];
    pill.onclick=userPillClick;
  } else {
    pill.textContent='Sign in';
    pill.onclick=openLogin;
  }
}
function userPillClick(){
  if(confirm('Sign out of Print Engine?')) doLogout();
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
