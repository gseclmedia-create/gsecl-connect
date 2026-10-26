// GSECL Connect for the web: the DSM page. SLDC's weekly UI-RE PDFs are read on the Android phones, so here the page
// shows the CERC estimate (worked out by the service) and the weekly accounts those phones uploaded (dsm_weeks).
// Loaded after dsm.js; replaces its dsmShow / dsmRender.
(() => {
  const W = { fy: '', data: null, busy: false, err: '', open: '' };
  const inr = v => (v < 0 ? '−' : '') + '₹' + (Math.abs(v) >= 1e7 ? (Math.abs(v) / 1e7).toFixed(2) + ' Cr' : Math.abs(v) >= 1e5 ? (Math.abs(v) / 1e5).toFixed(2) + ' L' : Math.round(Math.abs(v)).toLocaleString('en-IN'));
  const netCls = v => (v > 0 ? 'neg' : v < 0 ? 'pos' : '');          // net payable (+) is a cost

  async function load(fy) {
    if (W.busy) return;
    W.busy = true; W.err = ''; dsmRender();
    const r = await conCall('dsm_weeks', fy ? { fy } : {});
    W.busy = false;
    if (r.ok) { W.data = r.data; W.fy = r.data.fy || ''; } else W.err = /unknown action/i.test(r.error) ? 'Update the GSECL Connect script in the Google Sheet (new Code.gs) for the weekly accounts.' : r.error;
    dsmRender();
  }

  function weekly() {
    if (!W.data && !W.busy && !W.err) { setTimeout(() => load(''), 0); return '<div class="card"><div class="sk" style="height:160px"></div></div>'; }
    if (W.err) return `<div class="alert err"><span>⚠</span><span>${esc(W.err)}</span></div>`;
    if (!W.data) return '<div class="card"><div class="sk" style="height:160px"></div></div>';
    const d = W.data;
    if (!d.weeks.length) return '<div class="card"><div class="empty">No weekly accounts in the Sheet yet. They are uploaded by the Android app on phones with DSM access, after it reads SLDC’s UI-RE notices.</div></div>';
    const sum = l => l.reduce((t, x) => ({ net: t.net + x.net, pay: t.pay + x.pay, rec: t.rec + x.rec }), { net: 0, pay: 0, rec: 0 });
    const fyTot = sum(d.weeks.flatMap(w => w.stations));
    const st = {}; d.weeks.forEach(w => w.stations.forEach(x => { const s = st[x.name] || (st[x.name] = { name: x.name, net: 0, pay: 0, rec: 0, n: 0 }); s.net += x.net; s.pay += x.pay; s.rec += x.rec; s.n++; }));
    const stations = Object.values(st).sort((a, b) => b.net - a.net);
    return `${d.years.length > 1 ? `<div class="chips">${d.years.map(y => `<button class="chip ${y === d.fy ? 'on' : ''}" data-wdsm="fy" data-warg="${esc(y)}">FY ${esc(y)}</button>`).join('')}</div>` : ''}
      <div class="card"><h2>FY ${esc(d.fy)} · SLDC weekly accounts <span class="more muted" style="font-weight:500;font-size:11.5px">${d.weeks.length} weeks</span></h2>
        <div class="tstats" style="grid-template-columns:repeat(3,1fr)"><div><span>Net</span><b class="num ${netCls(fyTot.net)}">${inr(fyTot.net)}</b><small>${fyTot.net > 0 ? 'payable' : 'receivable'}</small></div>
          <div><span>Payable</span><b class="num">${inr(fyTot.pay)}</b><small>under-injection etc.</small></div><div><span>Receivable</span><b class="num">${inr(fyTot.rec)}</b><small>over-injection</small></div></div></div>
      <div class="card"><h2>Weeks</h2>${d.weeks.map(w => { const t = sum(w.stations), open = W.open === String(w.week);
        return `<div class="srow" data-wdsm="wk" data-warg="${w.week}" style="cursor:pointer"><div class="top"><span class="nm">Week ${w.week}${w.rev ? ' · Rev ' + w.rev : ''}</span><span class="vals num"><b class="${netCls(t.net)}">${inr(t.net)}</b></span></div>
          <div class="vals">${esc(w.from)} – ${esc(w.to)}${w.due ? ' · due ' + esc(w.due) : ''} · ${w.stations.length} stations ${open ? '▲' : '▼'}</div>
          ${open ? `<table class="gt num" style="margin-top:8px"><tr><th>Station</th><th>Payable</th><th>Receivable</th><th>Net</th></tr>${[...w.stations].sort((a, b) => b.net - a.net).map(x => `<tr><td>${esc(x.name)}</td><td>${inr(x.pay)}</td><td>${inr(x.rec)}</td><td class="${netCls(x.net)}"><b>${inr(x.net)}</b></td></tr>`).join('')}</table>` : ''}</div>`; }).join('')}</div>
      <div class="card"><h2>Stations · FY ${esc(d.fy)}</h2><div style="overflow-x:auto"><table class="gt num"><tr><th>Station</th><th>Weeks</th><th>Payable</th><th>Receivable</th><th>Net</th></tr>
        ${stations.map(x => `<tr><td>${esc(x.name)}</td><td>${x.n}</td><td>${inr(x.pay)}</td><td>${inr(x.rec)}</td><td class="${netCls(x.net)}"><b>${inr(x.net)}</b></td></tr>`).join('')}</table></div>
        <div class="note-src">From the SLDC UI-RE notices read by the Android app (latest revision of each week). Net = payable − receivable.</div></div>`;
  }

  window.dsmShow = function () { if (!['est', 'wk'].includes(D.tab)) D.tab = 'est'; dsmRender(); };
  window.dsmRender = function () {
    const box = $('dsmBody'); if (!box) return;
    if (!['est', 'wk'].includes(D.tab)) D.tab = 'est';
    D.charts = [];
    let h = `<div class="seg" style="grid-template-columns:repeat(2,1fr)">${[['est', 'Estimate'], ['wk', 'Weekly accounts']].map(([k, l]) => `<button class="${D.tab === k ? 'on' : ''}" data-dact="tab" data-darg="${k}">${l}</button>`).join('')}</div>`;
    h += D.tab === 'est' ? dTabEst() : weekly();
    box.innerHTML = h + '<div class="credit">Estimate: CERC DSM Regulations 2024 · weekly accounts as published by SLDC · Developed by <b>A D Bhatt</b>, EE, GSECL</div>';
    box.querySelectorAll('[data-dchart]').forEach(el => dDrawChart(el, D.charts[+el.dataset.dchart]));
  };
  window.dsmPoll = function () {};
  window.dsmUpload = function () {};
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-wdsm]'); if (!el) return;
    const a = el.dataset.warg || '';
    if (el.dataset.wdsm === 'fy') { W.data = null; return load(a); }
    if (el.dataset.wdsm === 'wk') { W.open = W.open === a ? '' : a; return dsmRender(); }
  });
})();
