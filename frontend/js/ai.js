/* ═══════════════ AI DESIGNER ═══════════════ */
async function aiDesign(){
  const brief=document.getElementById('aiBrief').value.trim();
  if(!brief){ toast('Describe your design idea first'); return; }
  const btn=document.getElementById('aiBtn');
  const btnHTML=btn.innerHTML;
  btn.innerHTML='<span class="spin"></span>Designing…'; btn.disabled=true;
  try{
    const res=await fetch('https://api.anthropic.com/v1/messages',{
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        model:'claude-sonnet-4-6', max_tokens:1000,
        messages:[{role:'user',content:
`You are a t-shirt graphic designer. Brief: "${brief}".
Current shirt colour: ${state.shirtColor}.
Respond ONLY with JSON, no markdown fences, exactly this shape:
{"shirt":"#hex (best shirt colour for this design)",
 "lines":[{"text":"LINE 1","size":40,"color":"#hex","font":"Archivo Narrow|Georgia|Impact|Courier New|Brush Script MT","bold":true},
          {"text":"line 2","size":24,"color":"#hex","font":"...","bold":false}],
 "reason":"one short sentence"}
Rules: 1-3 lines max, punchy short text (each under 22 chars), high contrast vs shirt colour, fonts only from the list.`}]
      })
    });
    const data=await res.json();
    let txt=(data.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('\n');
    txt=txt.replace(/```json|```/g,'').trim();
    const d=JSON.parse(txt);
    // apply
    if(d.shirt && /^#([0-9a-f]{6})$/i.test(d.shirt)){ state.shirtColor=d.shirt;
      document.querySelectorAll('.sw').forEach(x=>x.classList.remove('on')); }
    state.layers[state.side]=[];
    const P=pa(), cx=P.x+P.w/2, cy=P.y+P.h/2;
    const n=d.lines.length, startY=cy-((n-1)*30);
    d.lines.forEach((ln,i)=>{
      state.layers[state.side].push({type:'text',text:ln.text.slice(0,26),
        x:cx,y:startY+i*60,size:Math.min(60,ln.size||34),
        font:ln.font||'Archivo Narrow',color:ln.color||'#0D1F3C',bold:!!ln.bold});
    });
    state.sel=-1; renderLayers(); draw();
    toast('✨ '+(d.reason||'AI design applied — edit freely'));
  }catch(err){
    console.error(err);
    toast('AI is busy — try once more');
  }
  btn.innerHTML=btnHTML; btn.disabled=false;
}

/* ═══════════════ AI IMAGE (production backend) ═══════════════ */
// Relative path: works unchanged whether served from localhost, an ngrok
// tunnel, or a real domain, as long as the backend serves this same file
// (see printly_backend.py's "/" route). Falls back to localhost:5001 if
// this file is opened directly (file://), since a relative path has no
// origin to resolve against there.
const BACKEND=location.protocol==='file:' ? 'http://127.0.0.1:5001' : '';
const AI_QUEUE_MAX_RETRIES=5;
function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
async function aiImage(){
  const brief=document.getElementById('aiImgBrief').value.trim();
  if(!brief){ toast('Describe the image you want'); return; }
  // ── Gate: window-shoppers can try a few, then must sign in ──
  if(!state.user){
    if(state.aiTries>=3){
      openLogin();
      toast('Sign in to keep generating AI images');
      return;
    }
    state.aiTries++;
  }
  const btn=document.getElementById('aiImgBtn');
  const btnHTML=btn.innerHTML;
  btn.innerHTML='<span class="spin"></span>Generating…'; btn.disabled=true;
  const body=JSON.stringify({prompt:brief,
    style:document.getElementById('aiImgStyle').value,
    provider:document.getElementById('aiImgProvider').value});
  try{
    let d=null;
    for(let attempt=0; attempt<=AI_QUEUE_MAX_RETRIES; attempt++){
      const res=await fetch(BACKEND+'/api/generate-image',{
        method:'POST',headers:{'Content-Type':'application/json'}, body});
      d=await res.json();
      if(res.status===429 && d.queued){
        if(attempt===AI_QUEUE_MAX_RETRIES) throw new Error("Still busy — please try again in a bit.");
        btn.innerHTML=`<span class="spin"></span>#${d.position} in queue — retrying in ${d.retry_after_s}s…`;
        await sleep(d.retry_after_s*1000);
        continue;
      }
      break;
    }
    if(!d.ok) throw new Error(d.error||'Generation failed');
    const img=new Image();
    img.onload=()=>{
      const P=pa();
      const ratio=img.width/img.height, w=Math.min(170,P.w-24), h=w/ratio;
      state.layers[state.side].push({type:'img',img,x:P.x+P.w/2,y:P.y+P.h/2,w,h});
      state.sel=state.layers[state.side].length-1;
      renderLayers(); draw();
      const left = state.user ? '' : ` · ${Math.max(0,3-state.aiTries)} free left`;
      toast('🎨 Image placed via '+d.provider+(d.cost_inr?' (₹'+d.cost_inr+')':' (free)')+left);
    };
    img.src=d.image;
  }catch(err){
    console.error(err);
    toast(err.message.includes('fetch')?'Backend not running — start printly_backend.py':err.message);
  }
  btn.innerHTML=btnHTML; btn.disabled=false;
}
