/* ═══════════════ REPORTS ═══════════════
   Charts are inline SVG built from the same numbers shown in the table
   beside them — no chart library, and nothing that can render a shape the
   figures don't support. Every screen says what it counted and what it
   excluded, because a total that quietly includes cancellations is the
   classic way a dashboard lies. */

const repState = {days:30};

/* Minutes → the unit a human would use. A stage cleared in four minutes
   shown as "0 h" reads as broken instrumentation rather than as speed. */
function dur(mins){
  if(mins === null || mins === undefined) return '—';
  if(mins < 1)   return '< 1 min';
  if(mins < 90)  return Math.round(mins) + ' min';
  if(mins < 2880) return (mins/60).toFixed(1) + ' h';
  return (mins/1440).toFixed(1) + ' days';
}

async function renderReports(el, sub){
  const tabs = [['sales','Sales'],['production-throughput','Throughput'],
                ['stock-valuation','Stock valuation'],['ai-usage','AI usage']];
  el.innerHTML = `<div class="row" style="margin-bottom:18px">
    ${tabs.map(([k,label])=>`<button class="btn btn-sm ${(sub||'sales')===k?'btn-primary':'btn-quiet'}"
      onclick="goTo('reports','${k}')">${esc(label)}</button>`).join('')}
  </div><div id="repBody"></div>`;
  const body = document.getElementById('repBody');
  if(sub === 'production-throughput') return renderThroughput(body);
  if(sub === 'stock-valuation')       return renderStockValue(body);
  if(sub === 'ai-usage')              return renderAiUsage(body);
  return renderSales(body);
}

/* Bar chart as inline SVG. viewBox + preserveAspectRatio="none" lets it fill
   whatever width the card has without measuring anything in JS. */
function barChart(points, valueKey, label){
  const max = Math.max(1, ...points.map(p=>p[valueKey]));
  const n = points.length, w = 100 / n;
  const bars = points.map((p,i)=>{
    const h = (p[valueKey] / max) * 100;
    return `<rect x="${(i*w).toFixed(3)}" y="${(100-h).toFixed(3)}"
      width="${(w*0.72).toFixed(3)}" height="${h.toFixed(3)}"
      ><title>${esc(p.date)} · ${esc(String(p[valueKey]))}</title></rect>`;
  }).join('');
  const first = points[0], last = points[points.length-1];
  return `<div class="chart">
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img"
      aria-label="${esc(label)}">${bars}</svg>
    <div class="chart-axis">
      <span>${esc(first?fmtDate(first.date):'')}</span>
      <span class="dim">peak ${esc(String(max))}</span>
      <span>${esc(last?fmtDate(last.date):'')}</span>
    </div>
  </div>`;
}

/* ── Sales ───────────────────────────────────────────────────── */
async function renderSales(el){
  el.innerHTML = '<div class="empty">Loading…</div>';
  const d = await api('/api/admin/reports/sales?days='+repState.days);
  if(!d.ok){ el.innerHTML = `<div class="empty">${esc(d.error)}</div>`; return; }
  const t = d.totals;
  const gstTotal = d.gst.reduce((a,g)=>a+g.tax,0);
  el.innerHTML = `
    <div class="row" style="margin-bottom:14px">
      ${[30,90,365].map(n=>`<button class="chip ${repState.days===n?'on':''}"
        onclick="repState.days=${n};renderSales(document.getElementById('repBody'))">
        ${n===365?'1 year':n+' days'}</button>`).join('')}
    </div>
    <div class="grid g3" style="margin-bottom:18px">
      <div class="stat"><span>Revenue</span><b>${money(t.revenue)}</b></div>
      <div class="stat"><span>Orders</span><b>${t.orders}</b></div>
      <div class="stat"><span>Average order</span><b>${money(t.aov)}</b></div>
    </div>
    <div class="card">
      <h2>Revenue per day</h2>
      <p class="tiny muted">${t.pieces} piece(s) across ${t.orders} order(s).
        ${t.cancelled} cancelled order(s) are counted below but contribute no revenue.</p>
      ${barChart(d.series,'revenue','Revenue per day')}
    </div>
    <div class="card">
      <h2>By product</h2>
      ${d.products.length ? `<table>
        <thead><tr><th>Product</th><th>Pieces</th><th>Lines</th><th>Revenue</th></tr></thead>
        <tbody>${d.products.map(p=>`<tr>
          <td data-label="Product">${esc(p.product)}</td>
          <td data-label="Pieces">${p.qty}</td>
          <td data-label="Lines">${p.orders}</td>
          <td data-label="Revenue">${money(p.revenue)}</td>
        </tr>`).join('')}</tbody></table>` : '<div class="empty">Nothing sold in this window.</div>'}
    </div>
    <div class="card">
      <h2>GST collected</h2>
      ${d.gst.length ? `<table>
        <thead><tr><th>Rate</th><th>Taxable value</th><th>Tax</th></tr></thead>
        <tbody>${d.gst.map(g=>`<tr>
          <td data-label="Rate">${g.rate}%</td>
          <td data-label="Taxable">${money(g.taxable)}</td>
          <td data-label="Tax">${money(g.tax)}</td>
        </tr>`).join('')}
        <tr><td><b>Total</b></td><td></td><td><b>${money(gstTotal)}</b></td></tr>
        </tbody></table>` : '<div class="empty">No tax breakdowns in this window.</div>'}
      ${d.gst_covered < d.gst_total_orders ? `<p class="tiny dim" style="margin-top:10px">
        Covers ${d.gst_covered} of ${d.gst_total_orders} orders — the rest were
        placed before per-order tax breakdowns were stored, so their GST can't
        be split by rate here. Their revenue is still in the totals above.</p>`:''}
      <p class="tiny dim" style="margin-top:8px">This is what was charged, not
        a return. Reconcile against your filings before submitting anything.</p>
    </div>`;
}

/* ── Throughput ──────────────────────────────────────────────── */
async function renderThroughput(el){
  el.innerHTML = '<div class="empty">Loading…</div>';
  const d = await api('/api/admin/reports/throughput');
  if(!d.ok){ el.innerHTML = `<div class="empty">${esc(d.error)}</div>`; return; }
  const inFlight = d.pipeline.reduce((a,p)=>a+(p.stage<5?p.orders:0),0);
  el.innerHTML = `
    <div class="grid g3" style="margin-bottom:18px">
      <div class="stat"><span>In the pipeline</span><b>${inFlight}</b></div>
      <div class="stat"><span>Delivered</span><b>${(d.pipeline[5]||{}).orders||0}</b></div>
      <div class="stat"><span>Proofs approved</span><b>${d.proofs_approved}</b></div>
    </div>
    <div class="card">
      <h2>Where orders are sitting</h2>
      <table><tbody>${d.pipeline.map(p=>`<tr>
        <td data-label="Stage">${esc(p.label)}</td>
        <td data-label="Orders"><b>${p.orders}</b></td>
        <td data-label="" style="width:55%">
          <div class="meter"><i style="width:${inFlight+((d.pipeline[5]||{}).orders||0)
            ? (p.orders/Math.max(1,...d.pipeline.map(x=>x.orders))*100).toFixed(1) : 0}%"></i></div></td>
      </tr>`).join('')}</tbody></table>
      <p class="tiny dim">Cancelled orders excluded.</p>
    </div>
    <div class="card">
      <h2>Time spent at each stage</h2>
      <p class="tiny muted">From the audit log, counting only stages an order
        has actually left. An order still sitting somewhere has no duration
        yet — assuming "until now" would make a stalled queue look fast.</p>
      <table>
        <thead><tr><th>Stage</th><th>Average</th><th>Measured from</th></tr></thead>
        <tbody>${d.stage_time.map(s=>`<tr>
          <td data-label="Stage">${esc(s.label)}</td>
          <td data-label="Average">${s.avg_minutes===null?'<span class="dim">—</span>'
            :'<b>'+dur(s.avg_minutes)+'</b>'}</td>
          <td data-label="Sample" class="tiny dim">${s.n} completed move(s)</td>
        </tr>`).join('')}</tbody></table>
    </div>
    <div class="card">
      <h2>Dispatched per day</h2>
      ${barChart(d.dispatched,'count','Parcels dispatched per day')}
    </div>`;
}

/* ── Stock valuation ─────────────────────────────────────────── */
async function renderStockValue(el){
  el.innerHTML = '<div class="empty">Loading…</div>';
  const d = await api('/api/admin/reports/stock');
  if(!d.ok){ el.innerHTML = `<div class="empty">${esc(d.error)}</div>`; return; }
  el.innerHTML = `
    ${d.missing_cost ? `<div class="alert warn" style="margin-bottom:16px">
      <span class="material-symbols-outlined">warning</span>
      <span><b>${d.missing_cost} product(s) have no cost price.</b> They value at
        zero, so the figure below is not what your stock is worth. Set cost
        prices under Inventory → the product editor.</span>
    </div>`:''}
    <div class="grid g3" style="margin-bottom:18px">
      <div class="stat"><span>At cost</span><b>${money(d.cost_value)}</b></div>
      <div class="stat"><span>At lowest sell price</span><b>${money(d.retail_value)}</b></div>
      <div class="stat"><span>Variants counted</span><b>${d.counted_variants}/${d.total_variants}</b></div>
    </div>
    <div class="card" style="padding:0;overflow:hidden">
      <table>
        <thead><tr><th>Product</th><th>On hand</th><th>Unit cost</th>
          <th>At cost</th><th>At sell</th></tr></thead>
        <tbody>${d.products.map(p=>`<tr class="${p.negative?'row-off':''}">
          <td data-label="Product">${esc(p.product)}
            ${p.negative?`<br><span class="badge badge-warn">${p.negative} negative</span>`:''}</td>
          <td data-label="On hand">${p.qty}</td>
          <td data-label="Unit cost">${p.cost?money(p.cost):'<span class="dim">not set</span>'}</td>
          <td data-label="At cost">${money(p.value)}</td>
          <td data-label="At sell">${money(p.retail)}</td>
        </tr>`).join('')}</tbody>
      </table>
    </div>
    <p class="tiny dim" style="margin-top:12px">
      Only ${d.counted_variants} of ${d.total_variants} variants have ever had a
      stock movement — the rest have never been counted in, so they read as
      zero rather than as genuinely empty.
    </p>`;
}

/* ── AI usage ────────────────────────────────────────────────── */
async function renderAiUsage(el){
  el.innerHTML = '<div class="empty">Loading…</div>';
  const d = await api('/api/admin/reports/ai');
  if(!d.ok){ el.innerHTML = `<div class="empty">${esc(d.error)}</div>`; return; }
  el.innerHTML = `
    <div class="grid g3" style="margin-bottom:18px">
      <div class="stat"><span>Generations, all time</span><b>${d.total.count}</b></div>
      <div class="stat"><span>Spend, all time</span><b>${money(d.total.cost)}</b></div>
      <div class="stat"><span>Last 30 days</span><b>${d.series.reduce((a,s)=>a+s.count,0)}</b></div>
    </div>
    <div class="card">
      <h2>Generations per day</h2>
      ${barChart(d.series,'count','AI generations per day')}
    </div>
    <div class="card">
      <h2>By model</h2>
      ${d.models.length ? `<table>
        <thead><tr><th>Model</th><th>Generations</th><th>Cost</th></tr></thead>
        <tbody>${d.models.map(m=>`<tr>
          <td data-label="Model">${esc(m.model)}</td>
          <td data-label="Generations">${m.count}</td>
          <td data-label="Cost">${m.cost?money(m.cost):'<span class="dim">free</span>'}</td>
        </tr>`).join('')}</tbody></table>` : '<div class="empty">Nothing generated yet.</div>'}
      <p class="tiny dim" style="margin-top:10px">Pollinations and Gemini are
        free tiers and log a zero cost — a low total here means the free
        providers are carrying the load, not that nothing was generated.</p>
    </div>`;
}
