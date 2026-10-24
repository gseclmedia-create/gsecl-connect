// Connect › More › PAF & fixed cost (AFC) recovery: the GSECL statement by PPA group - target, cumulative
// previous month, daily / MTD / YTD PAF, daily asking rate, AFC to date (target, actual, loss), PLF - with the
// CERC formulas, and a day-wise detail of each group. Data: service actions paf_report / paf_detail / paf_remark.
// Uses W, wBack, wOpen, conRender, conCall, esc, fmt, csvBtn from work.js / connect.js / index.html.

const PF = {date: '', exclude: false, data: null, busy: false, err: '', detail: null, group: ''};
const pfIso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const pfPc = v => v === null || v === undefined ? '—' : fmt(v, 2) + '%';
const pfCr = v => v === null || v === undefined ? '—' : fmt(v, 2);

async function pafLoad(fresh) {
  if (!PF.date) PF.date = pfIso(new Date());
  const key = 'paf_' + PF.date + '_' + (PF.exclude ? 1 : 0);
  const saved = !fresh && conSaved(key);
  if (saved) { PF.data = saved.data; conRender(); if (saved.age < 5) return; }
  PF.busy = true; PF.err = ''; conRender();
  const r = await conCall('paf_report', {date: PF.date, exclude: PF.exclude, fresh: !!fresh});
  PF.busy = false;
  if (r.ok) { PF.data = r.data; Connect.cacheSet(key, JSON.stringify(r.data)); } else PF.err = r.error;
  conRender();
}

async function pafDetail(group) {
  PF.group = group; PF.detail = null; conRender(); window.scrollTo({top: 0});
  const r = await conCall('paf_detail', {group, to: PF.date});
  if (r.ok) PF.detail = r.data; else PF.err = r.error;
  conRender();
}

/** Rows in statement order: each category's groups, its total, COAL total after STPS, TH after gas, GSECL last. */
function pafOrder(d) {
  const T = name => d.totals.find(t => t.group === name), out = [];
  const after = {DOM: 'TOTAL (DOM)', COAL: 'TOTAL (COAL)', LIGNITE: 'TOTAL (LIGNITE)', GAS: 'TOTAL (GAS)', HYDRO: 'TOTAL (HY)'};
  d.rows.forEach((r, i) => {
    out.push(r);
    const next = d.rows[i + 1];
    if (!next || next.category !== r.category) {
      if (T(after[r.category])) out.push(T(after[r.category]));
      if (r.category === 'GAS' && T('TOTAL (TH)')) out.push(T('TOTAL (TH)'));
    }
  });
  if (T('TOTAL (GSECL)')) out.push(T('TOTAL (GSECL)'));
  return out;
}

function wPafAfc() {
  if (PF.group) return wPafDetail();
  const d = PF.data;
  const ctl = `<div class="card" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><label style="font-size:12px;color:var(--muted)">As on <input type="date" class="search" id="pfDate" value="${esc(PF.date || pfIso(new Date()))}" style="margin:0 0 0 4px;width:auto"></label>
    <button class="chip ${PF.exclude ? 'on' : ''}" data-fact="excl">Leave out KLTPS 4 &amp; DGPS 1</button><button class="chip" data-fact="ref">${PF.busy ? 'Reading…' : 'Refresh'}</button></div>`;
  if (!d) return ctl + (PF.err ? conErr(PF.err) : conSpin());
  const red = (v, t) => v !== null && v !== undefined && t && v < t ? 'background:rgba(220,38,38,.10);color:var(--forced)' : '';
  const rows = pafOrder(d);
  const table = `<div style="overflow-x:auto"><table class="gt num pf"><tr><th rowspan="2">PPA group</th><th colspan="2">Target ${esc(d.fy)}</th><th rowspan="2">Cum. prev. month</th><th colspan="3">Actual PAF</th><th rowspan="2">Daily asking rate</th><th colspan="3">AFC to date (₹ Cr)</th><th colspan="3">PLF (CERC)</th></tr>
    <tr><th>%</th><th>₹ Cr</th><th>Daily</th><th>MTD</th><th>YTD</th><th>Target</th><th>Actual</th><th>Loss</th><th>Daily</th><th>MTD</th><th>YTD</th></tr>
    ${rows.map(x => `<tr class="${x.total ? 'tot' : ''}" ${x.total ? '' : `data-fact="grp" data-farg="${esc(x.group)}" style="cursor:pointer"`}><td>${esc(x.group)}</td><td>${pfPc(x.target_paf)}</td><td>${pfCr(x.afc)}</td><td>${pfPc(x.cum_prev)}</td>
      <td style="${red(x.daily, x.target_paf)}">${pfPc(x.daily)}</td><td style="${red(x.mtd, x.target_paf)}">${pfPc(x.mtd)}</td><td style="${red(x.ytd, x.target_paf)}"><b>${pfPc(x.ytd)}</b></td>
      <td style="${x.asking > 100 ? 'color:var(--forced);font-weight:700' : ''}">${pfPc(x.asking)}</td><td>${pfCr(x.afc_target)}</td><td>${pfCr(x.afc_actual)}</td><td style="${x.afc_loss < 0 ? 'color:var(--forced);font-weight:700' : ''}">${pfCr(x.afc_loss)}</td>
      <td>${pfPc(x.plf_daily)}</td><td>${pfPc(x.plf_mtd)}</td><td>${pfPc(x.plf_ytd)}</td></tr>`).join('')}</table></div>`;
  const g = d.totals.find(t => t.group === 'TOTAL (GSECL)') || {};
  const reasons = d.rows.filter(r => r.remarks || (d.can_edit && r.daily !== null && r.daily < r.target_paf));
  const miss = d.missing_days || [], few = d.rows.filter(r => r.afc && !r.ytd_complete);
  const warn = few.length ? `<div class="alert" style="background:#fff7ed;border-color:#fed7aa;color:#9a3412"><span>⚠</span><span><b>Past daily PAF not loaded yet.</b> YTD now covers ${Math.min(...few.map(r => r.days_ytd))} of ${d.days_elapsed} days for ${few.length} group${few.length > 1 ? 's' : ''}, so AFC actual, loss and asking rate are not worked out (they would be misleading). Paste the daily PAF from 01.04 in the Sheet tab PafImport and run the menu "Merge past PAF".</span></div>` : '';
  return ctl + warn + `<div class="card"><h2>GSECL AFC recovery status · ${conDate(d.date)}</h2>
      <div class="tstats" style="grid-template-columns:repeat(4,1fr)"><div><span>PAF YTD</span><b class="num ${g.ytd < g.target_paf ? 'neg' : 'pos'}">${pfPc(g.ytd)}</b><small>target ${pfPc(g.target_paf)}</small></div>
        <div><span>PAF MTD / day</span><b class="num">${pfPc(g.mtd)}</b><small>day ${pfPc(g.daily)}</small></div>
        <div><span>AFC to date</span><b class="num">${g.afc_actual === null || g.afc_actual === undefined ? '—' : '₹' + pfCr(g.afc_actual) + ' Cr'}</b><small>of ₹${pfCr(g.afc_target)} Cr</small></div>
        <div><span>Fixed cost loss</span><b class="num neg">${g.afc_loss === null || g.afc_loss === undefined ? '—' : '₹' + pfCr(-g.afc_loss) + ' Cr'}</b><small>${g.afc_loss === null || g.afc_loss === undefined ? 'needs past PAF' : 'day ' + d.days_elapsed + ' of ' + d.days_in_fy}</small></div></div>
      ${table}
      <div class="note-src">Touch a group for its day-wise PAF and PLF. Red = below target. ${PF.exclude ? 'KLTPS 4 and DGPS 1 left out of the station availability. ' : ''}</div>
      ${csvBtn('pafafc', 'GSECL_AFC_recovery_' + d.date, ['PPA group', 'Target PAF %', 'AFC Rs Cr', 'Cum prev month %', 'Daily PAF %', 'MTD PAF %', 'YTD PAF %', 'Daily asking rate %', 'AFC target Rs Cr', 'AFC actual Rs Cr', 'AFC loss Rs Cr', 'PLF daily %', 'PLF MTD %', 'PLF YTD %', 'Days with data (YTD)', 'Remarks'],
        rows.map(x => [x.group, x.target_paf, x.afc, x.cum_prev, x.daily, x.mtd, x.ytd, x.asking, x.afc_target, x.afc_actual, x.afc_loss, x.plf_daily, x.plf_mtd, x.plf_ytd, x.days_ytd ?? '', x.remarks || ''].map(v => typeof v === 'number' ? +v.toFixed(3) : v)))}</div>
    ${reasons.length ? `<div class="card"><h2>Reasons for non-achievement (daily)</h2>${reasons.map(r => `<div class="srow" style="cursor:default"><div class="top"><span class="nm">${esc(r.group)}</span><span class="vals num">${pfPc(r.daily)}</span></div>
      <div class="vals" style="white-space:normal">${esc(r.remarks || '—')}</div>${d.can_edit ? `<a data-fact="remark" data-farg="${esc(r.group)}" style="color:var(--accent);font-size:12px;cursor:pointer">Edit remarks</a>` : ''}</div>`).join('')}</div>` : ''}
    <div class="card"><h2>How it is worked out</h2><div class="vals" style="font-size:12.5px;white-space:normal">
      <p style="margin:0 0 6px"><b>PAF</b> = 10000 × Σ DCi / [N × IC × (100 − AUX)] % - CERC (Terms and Conditions of Tariff) Regulations 2024, Reg 2(59) and 62(4). DCi = average declared capacity (ex-bus MW) of day i, IC = installed capacity, AUX = normative auxiliary consumption. MTD / YTD = average of the daily values.</p>
      <p style="margin:0 0 6px"><b>PLF</b> = 10000 × Σ SGi / [N × IC × (100 − AUX)] % - Reg 2(60). SGi = scheduled generation (ex-bus) of time block i.</p>
      <p style="margin:0 0 6px"><b>AFC to date</b>: target = annual AFC × ${d.days_elapsed} / ${d.days_in_fy}; actual = target × min(1, YTD PAF / target PAF); loss = actual − target. <b>Daily asking rate</b> = (target × ${d.days_in_fy} − YTD × ${d.days_elapsed}) / ${d.days_in_fy - d.days_elapsed + 1}. Totals are weighted by installed capacity.</p>
      <p style="margin:0">Daily DC and SG come from the readings the app logs (GSECL DC/SG feed, SLDC), averaged per 15-minute block; days loaded from the PafImport tab are used as given.</p></div>
      <div style="overflow-x:auto;margin-top:8px"><table class="gt num" style="font-size:11.5px"><tr><th>PPA group</th><th>IC MW</th><th>AUX %</th><th>Basis of AUX</th><th>Days (YTD)</th></tr>
        ${d.rows.map(r => `<tr><td>${esc(r.group)}</td><td>${fmt(r.ic, 1)}</td><td>${fmt(r.aux, 2)}</td><td style="text-align:left;white-space:normal;font-size:11px">${esc(r.aux_source || '')}</td><td>${r.days_ytd} / ${d.days_elapsed}</td></tr>`).join('')}</table></div>
      <div class="note-src">IC, AUX, targets and AFC are kept in the Sheet tab PpaGroups (one set per financial year). Set AUX to the GERC-approved normative value of each station.</div></div>`;
}

function wPafDetail() {
  const d = PF.detail, back = `<div class="chips"><button class="chip" data-fact="back">‹ AFC recovery</button></div>`;
  if (!d) return back + (PF.err ? conErr(PF.err) : conSpin());
  const g = d.group, days = [...d.days].reverse();
  return back + `<div class="card"><h2>${esc(g.group)} · day-wise</h2>
    <div class="vals">IC ${fmt(g.ic, 1)} MW · AUX ${fmt(g.aux, 2)}% · ex-bus ${fmt(g.ic * (1 - g.aux / 100), 1)} MW · target ${fmt(g.target, 2)}% · blocks ${esc(g.blocks.join(', '))}</div>
    <div style="overflow-x:auto;margin-top:8px"><table class="gt num"><tr><th>Date</th><th>DC MW</th><th>PAF</th><th>SG MW</th><th>PLF</th><th>Blocks</th><th>Source</th></tr>
      ${days.map(x => `<tr><td>${conDate(x.date)}</td><td>${x.dc === null ? '—' : fmt(x.dc, 1)}</td><td style="${x.paf !== null && x.paf < g.target ? 'color:var(--forced);font-weight:700' : ''}">${pfPc(x.paf)}</td><td>${x.sg === null ? '—' : fmt(x.sg, 1)}</td><td>${pfPc(x.plf)}</td><td>${x.blocks ?? '—'}</td><td style="text-align:left">${esc(x.source || '')}</td></tr>`).join('') || '<tr><td colspan="7">No data yet</td></tr>'}</table></div>
    ${csvBtn('pafgrp', 'PAF_' + g.group.replace(/\W+/g, '_'), ['Date', 'DC ex-bus MW', 'PAF %', 'SG ex-bus MW', 'PLF %', 'Blocks', 'Source'], d.days.map(x => [x.date, x.dc, x.paf, x.sg, x.plf, x.blocks, x.source]))}</div>`;
}

document.addEventListener('click', async e => {
  const el = e.target.closest('[data-fact]');
  if (!el || !hasConnect()) return;
  const arg = el.dataset.farg || '';
  switch (el.dataset.fact) {
    case 'excl': PF.exclude = !PF.exclude; PF.data = null; return pafLoad(false);
    case 'ref': return pafLoad(true);
    case 'grp': return pafDetail(arg);
    case 'back': PF.group = ''; PF.detail = null; return conRender();
    case 'remark': {
      const cur = (PF.data.rows.find(r => r.group === arg) || {}).remarks || '';
      const text = prompt(`Reasons for non-achievement · ${arg} · ${PF.date}`, cur);
      if (text === null) return;
      const r = await conCall('paf_remark', {date: PF.date, group: arg, remarks: text});
      if (!r.ok) { PF.err = r.error; return conRender(); }
      return pafLoad(true);
    }
  }
});
document.addEventListener('change', e => { if (e.target.id === 'pfDate' && e.target.value) { PF.date = e.target.value; PF.data = null; pafLoad(false); } });

(function pfStyle() {
  const s = document.createElement('style');
  s.textContent = `table.pf th { text-align: center; white-space: nowrap; } table.pf td, table.pf td:first-child { white-space: nowrap; } table.pf tr.tot td { background: #fff3c4; color: #3b1450; }
  @media (prefers-color-scheme: dark) { table.pf tr.tot td { background: rgba(250, 204, 21, .15); color: inherit; } }`;
  document.head.appendChild(s);
})();
