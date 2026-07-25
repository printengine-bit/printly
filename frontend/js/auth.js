/* ═══════════════ AUTH ═══════════════ */
let authMode='login';
function openLogin(){ document.getElementById('loginModal').classList.add('on'); }
function closeLogin(){ document.getElementById('loginModal').classList.remove('on'); }
function toggleAuthMode(){
  authMode = authMode==='login' ? 'signup' : 'login';
  const isSignup = authMode==='signup';
  document.getElementById('authTitle').textContent = isSignup ? 'Create your Printly account' : 'Sign in to Printly';
  document.getElementById('authNameRow').style.display = isSignup ? 'block' : 'none';
  document.getElementById('authSubmitBtn').textContent = isSignup ? 'Create account →' : 'Sign in →';
  document.getElementById('authToggleText').textContent = isSignup ? 'Already have an account?' : 'New to Printly?';
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
  document.querySelector('.nav-btn[data-v="admin"]').style.display =
    (state.user && state.user.role==='admin') ? '' : 'none';
}
function userPillClick(){
  if(confirm('Sign out of Printly?')) doLogout();
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
    applyAuthUI();
    closeLogin(); toast('Welcome, '+d.user.name.split(' ')[0]+'! You are signed in.');
  }catch(err){
    toast('Could not reach the server — try again.');
  }
  btn.disabled=false;
}
async function doLogout(){
  try{ await fetch(BACKEND+'/api/auth/logout',{method:'POST',credentials:'include'}); }catch(e){}
  state.user=null; applyAuthUI(); toast('Signed out');
  if(state.view==='admin'||state.view==='orders') go('home');
}
async function checkSession(){
  try{
    const res=await fetch(BACKEND+'/api/auth/me',{credentials:'include'});
    const d=await res.json();
    if(d.ok && d.user){ state.user=d.user; applyAuthUI(); }
  }catch(err){ /* backend offline — stay signed out locally */ }
}
