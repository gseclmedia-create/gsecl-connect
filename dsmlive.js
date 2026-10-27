// DSM › Live by block: the running 15-minute block (with its clock), the 3 blocks before and the 3 after, for every
// PPA group (unit), from the readings GSECL Connect keeps (BlockLog) and SLDC's schedule of the day. The service works
// the charge out (CERC DSM Regulations 2024, Reg 8(1)); the next blocks hold the latest MW and frequency.
// Uses $, esc, fmt (app-main-2.js), conCall / hasConnect (connect.js), appCan (coalstock.js).

const DL = {data: null, busy: false, err: '', at: 0, open: '', timer: null, st: '', unit: ''};
/** Station of a PPA group ("UTPS 3-5" -> UTPS). */
const dlStation = g => String(g).trim().split(/\s+/)[0];
/** The station / unit chosen (kept on the phone). */
function dlSel() {
  if (DL.st) return;
  try { const s = typeof conSaved === 'function' && conSaved('dl_sel'); if (s && s.data) { DL.st = s.data.st || ''; DL.unit = s.data.unit || ''; } } catch (e) { /* none */ }
}
function dlSelSave() { try { Connect.cacheSet('dl_sel', JSON.stringify({st: DL.st, unit: DL.unit})); } catch (e) { /* web without store */ } }

async function dlLoad(force = false) {
  if (DL.busy || typeof conCall !== 'function' || typeof hasConnect !== 'function' || !hasConnect()) return;
  if (!force && DL.at && Date.now() - DL.at < 55e3 && DL.data && Date.now() < DL.data.block_end) return;
  DL.busy = true;
  const r = await conCall('dsm_live', {});
  DL.busy = false;
  if (r.ok) { DL.data = r.data; DL.at = Date.now(); DL.err = ''; }
  else DL.err = /unknown action/i.test(r.error) ? 'Live DSM needs the updated GSECL Connect script (Code.gs).' : r.error;
  dlRender();
}

const dlRs = v => (v === null || v === undefined ? '—' : (v < 0 ? '−' : '') + '₹' + (Math.abs(v) >= 1e5 ? fmt(Math.abs(v) / 1e5, 2) + ' L' : fmt(Math.abs(v))));
const dlCls = v => (v === null || v === undefined ? '' : v > 0 ? 'neg' : v < 0 ? 'pos' : '');
function dlLeft() {
  const d = DL.data; if (!d) return '';
  const s = Math.max(0, Math.round((d.block_end - Date.now()) / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function dlRender() {
  const box = $('dlBody');
  if (!box) return;
  if (typeof appCan === 'function' && !appCan('dsm')) { box.innerHTML = ''; return; }
  const d = DL.data;
  if (!d) { box.innerHTML = DL.err ? `<div class="card"><h2>Live DSM by block</h2><div class="empty">${esc(DL.err)}</div></div>` : '<div class="card"><h2>Live DSM by block</h2><div class="sk" style="height:120px"></div></div>'; return; }
  dlSel();
  const stations = [...new Set(d.groups.map(g => dlStation(g.group)))];
  if (!stations.includes(DL.st)) { DL.st = stations[0] || ''; DL.unit = ''; }
  const units = d.groups.filter(g => dlStation(g.group) === DL.st);
  if (DL.unit && !units.some(g => g.group === DL.unit)) DL.unit = '';
  const shown = DL.unit ? units.filter(g => g.group === DL.unit) : units;
  if (shown.length === 1) DL.open = shown[0].group;
  const tot = k => shown.reduce((t, g) => t + (g[k] || 0), 0), totals = {past_rs: tot('past_rs'), now_rs: tot('now_rs'), next_rs: tot('next_rs')};
  const heads = (shown[0] || d.groups[0] || {blocks: []}).blocks;
  const cell = b => {
    if (!b || b.dev_mw === undefined) return '<td class="muted">—</td>';
    if (b.shutdown) return `<td style="${b.kind === 'now' ? 'background:var(--soft);' : ''}${b.kind === 'next' ? 'opacity:.75;' : ''}" title="${esc(b.band)}"><b class="muted">aux ${fmt(Math.abs(b.dev_mw), 1)}</b><small style="display:block" class="${dlCls(b.net_rs)}">${dlRs(b.net_rs)}</small></td>`;
    const col = b.beyond ? (b.dev_mw < 0 ? 'var(--neg)' : '#d97706') : 'var(--pos)';
    return `<td style="${b.kind === 'now' ? 'background:var(--soft);' : ''}${b.kind === 'next' ? 'opacity:.75;' : ''}"><b style="color:${col}">${b.dev_mw > 0 ? '+' : b.dev_mw < 0 ? '−' : ''}${fmt(Math.abs(b.dev_mw), 0)}</b><small style="display:block" class="${dlCls(b.net_rs)}">${dlRs(b.net_rs)}</small></td>`;
  };
  let h = `<div class="card"><h2>Live DSM by block <span class="more"><b class="num" id="dlClock">${dlLeft()}</b> <span class="muted" style="font-weight:500;font-size:11.5px">left in block ${d.cur_block}</span></span></h2>
    <div class="chips" style="padding-bottom:4px">${stations.map(st => `<button class="chip ${st === DL.st ? 'on' : ''}" data-dlst="${esc(st)}" style="padding:5px 12px">${esc(st)}</button>`).join('')}</div>
    ${units.length > 1 ? `<div class="chips" style="padding-bottom:6px">${[['', 'All units of ' + DL.st]].concat(units.map(g => [g.group, g.group])).map(([k, l]) => `<button class="chip ${DL.unit === k ? 'on' : ''}" data-dlunit="${esc(k)}" style="padding:4px 10px;font-size:12px">${esc(l)}</button>`).join('')}</div>` : ''}
    <div class="tstats" style="grid-template-columns:repeat(4,1fr)">
      <div><span>Last 3 blocks</span><b class="num ${dlCls(totals.past_rs)}">${dlRs(totals.past_rs)}</b><small>net, ${esc(DL.unit || DL.st)}</small></div>
      <div><span>Block ${d.cur_block} (projected)</span><b class="num ${dlCls(totals.now_rs)}">${dlRs(totals.now_rs)}</b><small>${esc(d.block_time)}</small></div>
      <div><span>Next 3 (predicted)</span><b class="num ${dlCls(totals.next_rs)}">${dlRs(totals.next_rs)}</b><small>at the latest MW</small></div>
      <div><span>Frequency</span><b class="num">${d.f_now ? fmt(d.f_now, 2) : '—'}</b><small>Hz</small></div>
    </div>
    <div style="overflow-x:auto"><table class="dt num" style="font-size:12px"><tr><th style="text-align:left">Unit / PPA</th>${heads.map(b => `<th style="${b.kind === 'now' ? 'background:var(--soft)' : ''}">${b.kind === 'now' ? 'Now · ' : b.kind === 'next' ? '+' : ''}B${b.block}<small style="display:block;font-weight:500">${esc(b.time.slice(0, 5))}</small></th>`).join('')}</tr>
    ${shown.map(g => `<tr data-dl="${esc(g.group)}" style="cursor:pointer"><td style="text-align:left"><b>${esc(g.group)}</b><small style="display:block">${g.last_mw === null ? '—' : fmt(g.last_mw) + ' MW'}${g.last_at ? ' · ' + esc(g.last_at) : ''}</small></td>${heads.map(hb => cell(g.blocks.find(b => b.block === hb.block))).join('')}</tr>
      ${DL.open === g.group ? `<tr><td colspan="${heads.length + 1}" style="text-align:left;padding:0">${dlDetail(g)}</td></tr>` : ''}`).join('')}
    </table></div>
    <div class="note-src">Deviation MW ex-bus (actual − schedule) and the block's DSM charge: <span class="neg">₹ payable</span>, <span class="pos">−₹ receivable</span>. Green within the limit (10 % of schedule, max 100 MW), red / amber beyond. “aux” = unit shut down (zero schedule, RSD / outage): its auxiliary drawal from the grid is charged at RR (Reg 8(9)).
      Readings as of ${esc(d.readings_at || '—')}${d.readings_age_min > 10 ? ` <b class="neg">(${d.readings_age_min} min old)</b>` : ''} · ${esc(d.sched)}. Tap a unit for the working. ${esc(d.method)}</div></div>`;
  box.innerHTML = h;
}

function dlDetail(g) {
  const n = g.blocks.find(b => b.kind === 'now'), a = n && n.advice;
  return `<div style="padding:8px 10px;background:var(--soft)">
    ${a ? `<div style="font-size:13px;margin-bottom:8px">To end block ${n.block} on schedule run <b>${fmt(a.to_schedule_mw, 0)} MW</b> for the remaining ${fmt(a.minutes_left, 1)} min (now ${a.now_mw === null ? '—' : fmt(a.now_mw) + ' MW'}); within the DSM limit: <b>${fmt(a.band_lo_mw, 0)}–${fmt(a.band_hi_mw, 0)} MW</b>.</div>` : ''}
    <table class="dt num" style="font-size:11.5px;width:100%"><tr><th>Block</th><th>SG</th><th>Actual</th><th>Dev</th><th>Dev %</th><th>Limit</th><th>Hz</th><th>Rate</th><th>₹</th></tr>
    ${g.blocks.map(b => `<tr><td>${b.block} <small>${esc(b.time)}</small>${b.kind === 'now' ? ' ●' : b.kind === 'next' ? ' ⋯' : ''}</td><td>${fmt(b.sg, 1)}</td><td>${fmt(b.act, 1)}${b.kind === 'now' && b.so_far !== undefined ? `<small style="display:block">so far ${fmt(b.so_far, 1)}</small>` : ''}</td>
      <td>${fmt(b.dev_mw, 1)}</td><td>${b.dev_pct === null || b.dev_pct === undefined ? '—' : fmt(b.dev_pct, 1) + '%'}</td><td>±${fmt(b.lim_mw, 1)}</td><td>${fmt(b.f, 2)}</td><td title="${esc(b.band || '')}">${b.rate_pct === undefined ? '—' : fmt(b.rate_pct, 1) + '%'}</td><td class="${dlCls(b.net_rs)}">${dlRs(b.net_rs)}</td></tr>`).join('')}</table>
    ${(g.blocks.find(b => b.shutdown) || {}).aux_src ? `<div class="note-src">${esc(g.blocks.find(b => b.shutdown).aux_src)} · ${esc(g.blocks.find(b => b.shutdown).band)}</div>` : ''}
    <div class="note-src">Auxiliary ${fmt(g.apc_pct, 2)} % taken off the SLDC generation · RR ${fmt((g.blocks.find(b => b.rr) || {}).rr, 3)} ₹/kWh · ● running block (average so far, the rest at the latest MW) · ⋯ predicted.</div></div>`;
}

document.addEventListener('click', e => {
  const st = e.target.closest('[data-dlst]'), un = e.target.closest('[data-dlunit]');
  if (st) { DL.st = st.dataset.dlst; DL.unit = ''; DL.open = ''; dlSelSave(); return dlRender(); }
  if (un) { DL.unit = un.dataset.dlunit; DL.open = DL.unit; dlSelSave(); return dlRender(); }
  const el = e.target.closest('[data-dl]');
  if (!el) return;
  DL.open = DL.open === el.dataset.dl ? '' : el.dataset.dl;
  dlRender();
});
function dlShow() {
  dlRender(); dlLoad(true);
  if (DL.timer) return;
  DL.timer = setInterval(() => {
    if (!$('v-dsm') || !$('v-dsm').classList.contains('on')) { clearInterval(DL.timer); DL.timer = null; return; }
    const c = $('dlClock'); if (c) c.textContent = dlLeft();
    if (DL.data && Date.now() >= DL.data.block_end + 20e3) dlLoad(true);   // a new block: read again (readings come in during the first minute)
    else if (Date.now() - DL.at > 60e3 && document.visibilityState === 'visible') dlLoad();
  }, 1000);
}
