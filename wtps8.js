// Connect › More › WTPS Unit 8: the live plant parameters of Wanakbori Unit 8 (800 MW, the unit's MIS page by BHEL),
// with headline KPIs, their trends and every parameter grouped by plant area. The GSECL Connect service reads the
// unit's page with the ID / password kept in its Script Properties (never in the app) and answers only employees
// with the 'wtps_u8' permission; others can ask for it here (access_request) and the super administrator approves it
// with the other approvals. While the page is open it is read again every 15 seconds (Live), the trends every 5 minutes.
// Uses $, esc, fmt, niceTicks, show() (app-main-2.js), conCall / conSaved (connect.js).

const U8 = {data: null, busy: false, err: '', at: 0, cat: 'gen', q: '', live: true, timer: 0, tr: {}, trBusy: {}, hours: 24, kpi: 'load',
  acc: null, accBusy: false, granted: false, reason: '', view: 'live', ref: null, refBusy: false, refOpen: false, refMsg: '', refErr: false};
try { U8.view = localStorage.getItem('u8view') === 'perf' ? 'perf' : 'live'; } catch (e) { /* live */ }
try { U8.live = localStorage.getItem('u8live') !== '0'; U8.hours = +localStorage.getItem('u8hours') || 24; U8.kpi = localStorage.getItem('u8kpi') || 'load'; } catch (e) { /* defaults */ }
const U8_RANGES = [[6, '6 h'], [24, '24 h'], [72, '3 days'], [168, '7 days'], [720, '30 days']];
// The tiles (in the order shown) and the decimals of each figure.
const U8_TILES = ['load', 'ms_t', 'ms_p', 'hrh_t', 'ms_f', 'coal', 'spc', 'fw_f', 'air', 'o2', 'aph', 'vac', 'eff', 'hr', 'freq', 'pf', 'mvar', 'sox', 'nox', 'dust'];
const U8_DEC = {ms_p: 1, ms_f: 0, fw_f: 0, coal: 1, air: 0, aph: 1, vac: 3, hr: 0, freq: 2, pf: 3, mvar: 1, sox: 0, nox: 0, dust: 1, spc: 3, load: 1, ms_t: 1, hrh_t: 1, o2: 2, eff: 2};
const U8_ICON = {swas: '💧', gen: '⚡', flue: '🌫️', metal: '🔥', mills: '⚙️', fuel: '⛏️', brg: '🌀', oil: '🛢️', cond: '❄️', turb: '🔄', boiler: '♨️'};
const U8_SHORT = {swas: 'SWAS', gen: 'Generator', flue: 'Flue gas', metal: 'Metal temp.', mills: 'Mills', fuel: 'Coal & oil', brg: 'Bearings', oil: 'Lube oil', cond: 'Condenser & FW', turb: 'Turbine', boiler: 'Boiler'};

/** Only with the permission given (or just approved); the service checks it again. Not in apps without a GSECL Connect sign-in. */
function u8Can() {
  if (U8.granted) return true;
  try { const p = JSON.parse(Native.account() || '{}').permissions; return !!(p && p.v === 2 && (p.view || []).includes('wtps_u8')); } catch (e) { return false; }
}
const u8Open = () => $('v-u8') && $('v-u8').classList.contains('on') && document.visibilityState === 'visible';
const u8Rows = () => U8.data ? U8.data.cats.flatMap(c => c.rows.map(r => Object.assign({cat: c.key, ct: c.title}, r))) : [];
const u8Kpi = k => U8.data && U8.data.kpis.find(x => x.k === k);
const u8F = (v, k) => v === null || v === undefined || v === '' || !isFinite(v) ? '—' : fmt(v, U8_DEC[k] !== undefined ? U8_DEC[k] : Math.abs(v) >= 1000 ? 0 : Math.abs(v) >= 100 ? 1 : 2);
const u8Val = r => r.bad ? `<span class="muted">${esc(r.v === '' ? '—' : String(r.v))}</span>` : esc(fmt(r.v, Math.abs(r.v) >= 1000 ? 0 : Math.abs(r.v) >= 100 ? 1 : 2));
const u8Hm = t => { const d = new Date(t); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
const u8Day = t => { const d = new Date(t); return d.getDate() + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()]; };

(() => {   // the page's own look
  const st = document.createElement('style');
  st.textContent = `.u8hero{border-radius:16px;padding:14px 14px 12px;margin-bottom:12px;color:#fff;background:linear-gradient(135deg,#2B1055 0%,#4c1d95 55%,#7c3aed 100%);box-shadow:0 8px 24px rgba(43,16,85,.25)}
  .u8hero .row{display:flex;align-items:center;gap:8px}.u8hero h2{color:#fff;margin:0;flex:1;font-size:15px;letter-spacing:.2px}.u8hero .sub{font-size:11.5px;opacity:.8;font-weight:500}
  .u8hero button{background:rgba(255,255,255,.14);color:#fff;border:1px solid rgba(255,255,255,.28);border-radius:999px;padding:4px 10px;font-size:12px}
  .u8hero .hs{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}.u8hero .hs div{background:rgba(255,255,255,.1);border-radius:10px;padding:6px 8px;font-size:11px}
  .u8hero .hs span{display:block;font-size:10.5px;opacity:.75}.u8hero .hs b{font-size:15px;font-variant-numeric:tabular-nums}
  .u8tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(104px,1fr));gap:8px;margin-bottom:12px}
  .u8t{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:7px 9px 4px;cursor:pointer;text-align:left;font:inherit;color:inherit}
  .u8t.on{border-color:var(--accent);box-shadow:0 0 0 2px color-mix(in srgb,var(--accent) 25%,transparent)}
  .u8t .l{font-size:10.5px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.u8t .v{font-size:16px;font-weight:700;font-variant-numeric:tabular-nums}
  .u8t .u{font-size:10px;color:var(--muted);font-weight:500}.u8t .d{display:block;font-size:10px;font-variant-numeric:tabular-nums}.u8t svg{display:block;width:100%;height:22px;margin-top:2px}
  .u8cats{display:flex;gap:6px;overflow-x:auto;padding-bottom:4px;margin:0 0 8px;scrollbar-width:none}.u8cats::-webkit-scrollbar{display:none}
  .u8cats .chip{white-space:nowrap;flex:none}.u8m{width:100%;border-collapse:collapse;font-size:12px}.u8m th,.u8m td{padding:5px 4px;border-bottom:1px solid var(--line);text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
  .u8m th:first-child,.u8m td:first-child{text-align:left;position:sticky;left:0;background:var(--card);white-space:normal;min-width:96px}.u8m th{font-size:11px;color:var(--muted);font-weight:600}
  .u8m .off{color:var(--muted)}.u8r{display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid var(--line);font-size:12.5px}.u8r:last-child{border-bottom:0}
  .u8r .n{flex:1;min-width:0}.u8r .b{flex:0 0 64px;height:5px;border-radius:3px;background:var(--line);overflow:hidden}.u8r .b i{display:block;height:100%;background:var(--accent);border-radius:3px}
  .u8r .x{font-weight:700;font-variant-numeric:tabular-nums;min-width:56px;text-align:right}.u8r .un{color:var(--muted);font-size:11px;min-width:50px}`;
  document.head.appendChild(st);
})();

// ---------------------------------------------------------------- reading

async function u8Load() {
  if (U8.busy || typeof conCall !== 'function') return;
  if (!U8.data) { const s = conSaved && conSaved('wtps_u8'); if (s && s.data && s.data.cats) U8.data = s.data; }
  U8.busy = true; u8Stamp();
  const r = await conCall('wtps_u8', {});
  U8.busy = false;
  if (r.ok) { U8.data = r.data; U8.err = ''; U8.at = Date.now(); try { Connect.cacheSet('wtps_u8', JSON.stringify(r.data)); } catch (e) { /* not kept */ } }
  else U8.err = /unknown action/i.test(r.error) ? 'The GSECL Connect script has not been updated yet: paste the new Code.gs and deploy a new version.' : r.error;
  if (u8Open()) u8Render();
}
async function u8Trend(hours, force = false) {
  const have = U8.tr[hours];
  if (U8.trBusy[hours] || (!force && have && Date.now() - have.at < 300e3)) return;
  U8.trBusy[hours] = true;
  const r = await conCall('wtps_u8_trend', {hours});
  U8.trBusy[hours] = false;
  if (r.ok) U8.tr[hours] = Object.assign(r.data, {at: Date.now()});
  if (u8Open()) u8Render();
}
/** The access state of someone without the permission: none / pending / rejected (or granted just now). */
async function u8Access(ask = false) {
  if (U8.accBusy) return;
  U8.accBusy = true; u8Render();
  const r = await conCall('access_request', {module: 'wtps_u8', ask, reason: U8.reason});
  U8.accBusy = false;
  if (r.ok) { U8.acc = r.data; if (r.data.status === 'granted') { U8.granted = true; U8.acc = null; u8Show(); return; } }
  else U8.acc = {status: 'error', error: /unknown action/i.test(r.error) ? 'The GSECL Connect script has not been updated yet.' : r.error};
  u8Render();
}

// ---------------------------------------------------------------- charts

/** The values of one KPI over the chosen hours: [[t, v]]. */
function u8Series(k, hours) {
  const d = U8.tr[hours]; if (!d) return [];
  const i = d.keys.indexOf(k); if (i < 0) return [];
  return d.rows.map(r => [r[0], r[i + 1]]).filter(p => p[1] !== null && p[1] !== undefined);
}
function u8Spark(pts) {
  if (pts.length < 3) return '<svg viewBox="0 0 100 22"></svg>';
  const vs = pts.map(p => p[1]), lo = Math.min(...vs), hi = Math.max(...vs), sp = hi - lo || 1, t0 = pts[0][0], tw = pts[pts.length - 1][0] - t0 || 1;
  const xy = pts.map(p => `${((p[0] - t0) / tw * 100).toFixed(1)},${(20 - (p[1] - lo) / sp * 18).toFixed(1)}`).join(' ');
  return `<svg viewBox="0 0 100 22" preserveAspectRatio="none"><polyline points="${xy}" fill="none" stroke="var(--accent)" stroke-width="1.6" vector-effect="non-scaling-stroke" stroke-linejoin="round"/></svg>`;
}
/** The big trend: area and line of one KPI (a gap in the log breaks it); drag across it for the values. */
function u8Chart(pts, k, unit, hours) {
  if (pts.length < 2) return `<div class="empty" style="padding:28px 8px">${U8.trBusy[hours] ? 'Reading the trend…' : 'The trend fills in as the readings are logged (every 5 minutes, kept 32 days).'}</div>`;
  const W = 340, H = 190, L = 42, R = 8, T = 10, B = 22, t1 = Date.now(), t0 = t1 - hours * 3600e3;
  const vs = pts.map(p => p[1]); let lo = Math.min(...vs), hi = Math.max(...vs);
  if (lo === hi) { const e = Math.abs(lo) * 0.02 || 1; lo -= e; hi += e; }
  const pad = (hi - lo) * 0.12; lo -= pad; hi += pad;
  const x = t => L + (t - t0) / (t1 - t0) * (W - L - R), y = v => T + (hi - v) / (hi - lo) * (H - T - B);
  const runs = []; let run = [];
  pts.forEach((p, i) => { if (i && p[0] - pts[i - 1][0] > Math.max(20 * 60e3, hours * 3600e3 / 120)) { runs.push(run); run = []; } run.push(p); }); runs.push(run);
  const line = rn => rn.map((p, i) => (i ? 'L' : 'M') + x(p[0]).toFixed(1) + ',' + y(p[1]).toFixed(1)).join('');
  const area = rn => rn.length < 2 ? '' : line(rn) + `L${x(rn[rn.length - 1][0]).toFixed(1)},${H - B}L${x(rn[0][0]).toFixed(1)},${H - B}Z`;
  const ticks = niceTicks(lo, hi, 4), dec = hi - lo < 0.1 ? 3 : hi - lo < 2 ? 2 : hi - lo < 20 ? 1 : 0;
  const stepH = hours <= 6 ? 1 : hours <= 24 ? 4 : hours <= 72 ? 12 : hours <= 168 ? 24 : 120, xt = [];
  for (let t = Math.ceil(t0 / (stepH * 3600e3)) * stepH * 3600e3; t <= t1; t += stepH * 3600e3) xt.push(t);
  const lab = t => hours <= 24 ? u8Hm(t) : hours <= 72 ? (new Date(t).getHours() ? u8Hm(t) : u8Day(t)) : u8Day(t);
  const hits = pts.map((p, i) => { const a = i ? (x(pts[i - 1][0]) + x(p[0])) / 2 : x(p[0]) - 2, b = i < pts.length - 1 ? (x(p[0]) + x(pts[i + 1][0])) / 2 : x(p[0]) + 2;
    return `<rect x="${a.toFixed(1)}" y="${T}" width="${Math.max(0.4, b - a).toFixed(1)}" height="${H - T - B}" fill="transparent" data-cx="${x(p[0]).toFixed(1)}" data-tip="${esc(u8Hm(p[0]))}" data-tiph="${esc(`<b>${u8Day(p[0])} ${u8Hm(p[0])}</b><br>${u8F(p[1], k)} ${unit}`)}"/>`; }).join('');
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="WTPS Unit 8 ${esc(k)} trend">
    <defs><linearGradient id="u8g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--accent)" stop-opacity=".28"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs>
    ${ticks.map(v => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/><text class="ax" x="${L - 4}" y="${(y(v) + 3.5).toFixed(1)}" text-anchor="end">${fmt(v, dec)}</text>`).join('')}
    ${xt.map(t => `<text class="ax" x="${x(t).toFixed(1)}" y="${H - 6}" text-anchor="middle">${lab(t)}</text>`).join('')}
    ${runs.map(rn => `<path d="${area(rn)}" fill="url(#u8g)"/><path d="${line(rn)}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`).join('')}
    <circle cx="${x(pts[pts.length - 1][0]).toFixed(1)}" cy="${y(pts[pts.length - 1][1]).toFixed(1)}" r="3.5" fill="var(--accent)" stroke="var(--card)" stroke-width="2"/>
    ${hits}</svg></div>`;
}
/** Load gauge: half circle, 0–800 MW. */
function u8Gauge(v) {
  const p = v === null || v === undefined ? 0 : Math.max(0, Math.min(1, v / 800)), len = Math.PI * 70;
  return `<svg viewBox="0 0 170 98" width="170" height="98" aria-label="Load ${u8F(v, 'load')} MW of 800">
    <path d="M15 88 A70 70 0 0 1 155 88" fill="none" stroke="rgba(255,255,255,.18)" stroke-width="13" stroke-linecap="round"/>
    <path d="M15 88 A70 70 0 0 1 155 88" fill="none" stroke="#fbbf24" stroke-width="13" stroke-linecap="round" stroke-dasharray="${(p * len).toFixed(1)} ${len.toFixed(1)}"/>
    <text x="85" y="70" text-anchor="middle" fill="#fff" style="font-size:26px;font-weight:800;font-variant-numeric:tabular-nums">${u8F(v, 'load')}</text>
    <text x="85" y="88" text-anchor="middle" fill="#fff" opacity=".75" style="font-size:11px">MW · ${fmt(p * 100, 1)} % of 800</text></svg>`;
}

// ---------------------------------------------------------------- page

function u8Stamp() {
  const el = $('u8Stamp'); if (!el) return;
  const t = U8.data && U8.data.at ? U8.data.at.slice(11, 19) : '';
  el.textContent = U8.busy ? 'Reading…' : t ? 'Read at ' + t + (U8.live ? ' · live every 15 s' : ' · live off') : '';
}

function u8Render() {
  const box = $('u8Body'); if (!box) return;
  const ae = document.activeElement;
  if (ae && ae.dataset && ae.dataset.u8ref !== undefined && box.contains(ae)) return u8Stamp();   // typing a reference value: no redraw
  const back = '<div class="chips" style="margin-bottom:8px"><button class="chip" data-u8="back">‹ Connect</button></div>';
  if (!u8Can()) { box.innerHTML = back + u8AccessHtml(); return; }
  const d = U8.data;
  if (!d) { box.innerHTML = back + (U8.err ? `<div class="alert err"><span>⚠</span><span>${esc(U8.err)}</span></div>` : '<div class="sk" style="height:230px;border-radius:16px;margin-bottom:12px"></div><div class="sk" style="height:200px"></div>'); return; }
  const kv = k => (u8Kpi(k) || {}).v, sel = u8Kpi(U8.kpi) || u8Kpi('load');
  const s24 = k => u8Series(k, 24), pts = u8Series(sel.k, U8.hours);
  const stat = pts.length ? {min: Math.min(...pts.map(p => p[1])), max: Math.max(...pts.map(p => p[1])), avg: pts.reduce((t, p) => t + p[1], 0) / pts.length} : null;
  const delta = k => { const s = s24(k), v = kv(k); if (s.length < 3 || v === null || v === undefined) return ''; const ago = s.filter(p => p[0] <= Date.now() - 3600e3).pop(); if (!ago) return '';
    const dv = v - ago[1], same = Math.abs(dv) < Math.max(Math.abs(v) * 0.002, 1e-3); return `<span class="d" style="color:${same ? 'var(--muted)' : dv > 0 ? '#16a34a' : '#dc2626'}">${same ? '→ steady' : (dv > 0 ? '▲ ' : '▼ ') + u8F(Math.abs(dv), k)} · 1 h</span>`; };
  const tile = k => { const q = u8Kpi(k); if (!q) return '';
    return `<button class="u8t ${sel.k === k ? 'on' : ''}" data-u8kpi="${k}"><div class="l">${esc(q.label)}</div><div class="v">${u8F(q.v, k)} <span class="u">${esc(q.u)}</span></div>${delta(k)}${u8Spark(s24(k))}</button>`; };
  box.innerHTML = back + `<div class="u8hero">
      <div class="row"><h2>WTPS Unit 8 <span class="sub">· 800 MW · live plant parameters</span></h2>
        <button data-u8="live">${U8.live ? '● Live' : 'Live off'}</button><button data-u8="ref" aria-label="Read now">↻</button></div>
      <div class="sub" id="u8Stamp" style="margin-top:2px"></div>
      ${U8.err ? `<div style="background:rgba(220,38,38,.3);border-radius:8px;padding:6px 8px;margin-top:6px;font-size:12px">⚠ ${esc(U8.err)}</div>` : ''}
      <div style="display:flex;gap:10px;align-items:center;margin-top:6px;flex-wrap:wrap;justify-content:center"><div style="flex:none">${u8Gauge(kv('load'))}</div>
        <div class="hs" style="flex:1;min-width:190px">
          <div><span>MS temp.</span><b>${u8F(kv('ms_t'), 'ms_t')}</b> °C</div><div><span>MS press.</span><b>${u8F(kv('ms_p'), 'ms_p')}</b></div><div><span>Coal flow</span><b>${u8F(kv('coal'), 'coal')}</b> t/h</div>
          <div><span>Frequency</span><b>${u8F(kv('freq'), 'freq')}</b> Hz</div><div><span>Reactive</span><b>${u8F(kv('mvar'), 'mvar')}</b> MVAr</div><div><span>Sp. coal</span><b>${u8F(kv('spc'), 'spc')}</b> kg/kWh</div></div></div>
    </div>
    <div class="seg" style="grid-template-columns:1fr 1fr;margin-bottom:12px"><button class="${U8.view !== 'perf' ? 'on' : ''}" data-u8view="live">Live parameters</button><button class="${U8.view === 'perf' ? 'on' : ''}" data-u8view="perf">Performance &amp; losses</button></div>
    <div class="card" id="u8TrendCard"><h2 style="display:flex;align-items:baseline;gap:6px">${esc(sel.label)} <span class="muted" style="font-weight:500;font-size:12px">${esc(sel.u)}</span>
        <span style="margin-left:auto;font-size:18px;font-weight:800;font-variant-numeric:tabular-nums">${u8F(sel.v, sel.k)}</span></h2>
      <div class="u8cats">${U8_RANGES.map(([h, l]) => `<button class="chip ${U8.hours === h ? 'on' : ''}" data-u8h="${h}">${l}</button>`).join('')}</div>
      ${u8Chart(pts, sel.k, sel.u, U8.hours)}
      ${stat ? `<div class="vals num" style="display:flex;justify-content:space-between;gap:6px;font-size:12px;margin-top:4px"><span>Min <b>${u8F(stat.min, sel.k)}</b></span><span>Avg <b>${u8F(stat.avg, sel.k)}</b></span><span>Max <b>${u8F(stat.max, sel.k)}</b></span><span class="muted">${pts.length} points</span></div>` : ''}
      <div class="note-src">Tap a figure below for its trend.</div></div>
    ${U8.view === 'perf' ? `<div class="u8tiles">${U8_PERF_TILES.map(tile).join('')}</div>${u8PerfHtml(d.perf)}` : `<div class="u8tiles">${U8_TILES.map(tile).join('')}</div>
    <div class="u8cats" id="u8Cats">${d.cats.map(c => `<button class="chip ${c.key === U8.cat && !U8.q ? 'on' : ''}" data-u8cat="${c.key}">${U8_ICON[c.key] || ''} ${esc(U8_SHORT[c.key] || c.title)} <span class="muted" style="font-size:10.5px">${c.rows.length}</span></button>`).join('')}</div>
    <input class="search" id="u8Q" type="search" placeholder="Search all ${d.count || ''} parameters (e.g. bearing, mill C, silica)" value="${esc(U8.q)}" style="margin:0 0 10px">
    <div id="u8List"></div>`}`;
  u8Stamp(); if (U8.view !== 'perf') u8List();
}

// ---------------------------------------------------------------- performance & losses

const U8_PERF_TILES = ['uhr', 'beff', 'hr', 'eff', 'loss', 'spc', 'vac', 'aph', 'o2'];
const U8_BLOSS = {dry_gas: ['Dry flue gas', '#7c3aed'], h2_moist: ['Moisture from H₂', '#0ea5e9'], fuel_moist: ['Coal moisture', '#14b8a6'], air_moist: ['Air moisture', '#94a3b8'],
  co: ['CO (incomplete)', '#f43f5e'], unburnt: ['Unburnt carbon', '#f59e0b'], radiation: ['Radiation', '#a3a3a3'], other: ['Other', '#d4d4d8']};
const u8St = st => ({ok: ['#16a34a', 'OK'], watch: ['#d97706', 'Watch'], alert: ['#dc2626', 'Alert']}[st] || ['#64748b', st]);
/** Big figure with the design value under it and the difference coloured (worse = red). */
const u8Big = (label, v, ref, unit, dec, worseIfHigher) => {
  const dv = v !== null && ref !== null && v !== undefined && ref !== undefined ? v - ref : null, bad = dv !== null && (worseIfHigher ? dv > 0 : dv < 0);
  return `<div style="border:1px solid var(--line);border-radius:12px;padding:8px 10px"><div class="muted" style="font-size:11px">${esc(label)}</div>
    <div style="font-size:20px;font-weight:800;font-variant-numeric:tabular-nums">${v === null || v === undefined ? '—' : fmt(v, dec)} <span class="muted" style="font-size:11px;font-weight:500">${unit}</span></div>
    ${ref !== null && ref !== undefined ? `<div style="font-size:11px" class="num">design ${fmt(ref, dec)}${dv !== null ? ` · <b style="color:${bad ? '#dc2626' : '#16a34a'}">${dv > 0 ? '+' : ''}${fmt(dv, dec)}</b>` : ''}</div>` : ''}</div>`;
};

function u8PerfHtml(p) {
  if (!p) return '<div class="card"><div class="empty">The performance is worked out once the GSECL Connect script has been updated.</div></div>';
  if (!p.ok) return `<div class="card"><div class="empty">${esc(p.note || 'Not available.')}</div></div>` + u8RefHtml();
  const b = p.boiler, t = p.turbine, u = p.unit, c = p.condenser, h = p.heaters;
  const pos = p.losses.filter(x => x.kcal > 0.05), neg = p.losses.filter(x => x.kcal < -0.05), hi = Math.max(1, ...pos.map(x => x.kcal));
  let s = `<div class="card"><h2>Heat rate & efficiency <span class="muted" style="font-weight:500;font-size:11.5px">at ${fmt(p.load, 0)} MW</span></h2>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
      ${u ? u8Big('Unit heat rate (gross)', u.hr, u.hr_ref, 'kcal/kWh', 0, true) : ''}${u ? u8Big('Unit efficiency (gross)', u.eff, u.eff_ref, '%', 2, false) : ''}
      ${b ? u8Big('Boiler efficiency', b.eff, b.eff_ref, '%', 2, false) : ''}${u8Big('Turbine heat rate', t.hr, t.hr_ref, 'kcal/kWh', 0, true)}</div>
    ${u ? `<div class="vals" style="font-size:12px;margin-top:8px">From the coal flow (${fmt(u8Kpi('coal')?.v, 1)} t/h at the set GCV) the unit heat rate would be <b>${fmt(u.direct, 0)}</b> kcal/kWh; the two agree when the as-fired GCV is about <b>${fmt(u.implied_gcv, 0)}</b> kcal/kg.</div>` : ''}</div>`;
  // where the heat rate goes: the controllable losses, ranked
  s += `<div class="card"><h2>Where the losses are <span class="muted" style="font-weight:500;font-size:11.5px">against design</span></h2>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:10px;text-align:center">
      <div style="background:#fee2e2;color:#991b1b;border-radius:10px;padding:6px"><div style="font-size:10.5px">Heat rate lost</div><b style="font-size:17px">${fmt(p.total_loss, 0)}</b><div style="font-size:10px">kcal/kWh</div></div>
      <div style="background:#fef3c7;color:#92400e;border-radius:10px;padding:6px"><div style="font-size:10.5px">Extra coal</div><b style="font-size:17px">${fmt(p.total_coal_t, 0)}</b><div style="font-size:10px">t/day at this load</div></div>
      <div style="background:#ede9fe;color:#5b21b6;border-radius:10px;padding:6px"><div style="font-size:10.5px">Cost</div><b style="font-size:17px">₹${fmt(p.total_lakh, 2)}</b><div style="font-size:10px">lakh/day</div></div></div>
    ${pos.map(x => `<details class="u8loss" style="border-bottom:1px solid var(--line);padding:6px 0"><summary style="list-style:none;cursor:pointer">
        <div style="display:flex;justify-content:space-between;gap:8px;font-size:12.5px"><b>${esc(x.label)}</b><span class="num"><b>${fmt(x.kcal, 1)}</b> kcal/kWh</span></div>
        <div style="height:7px;border-radius:4px;background:var(--line);margin:4px 0 2px;overflow:hidden"><i style="display:block;height:100%;width:${(x.kcal / hi * 100).toFixed(0)}%;background:${x.kcal / hi > 0.5 ? '#dc2626' : x.kcal / hi > 0.2 ? '#f59e0b' : '#7c3aed'}"></i></div>
        <div class="muted num" style="font-size:11px">${fmt(x.coal_t, 1)} t coal/day · ₹${fmt(x.lakh, 2)} lakh/day · tap for why</div></summary>
      <div style="font-size:12px;margin:6px 0 2px"><b>Why:</b> ${esc(x.why)}<br><b>What to check:</b> ${esc(x.fix)}</div></details>`).join('') || '<div class="empty">No loss against the design values.</div>'}
    ${neg.length ? `<div class="note-src" style="margin-top:8px">Better than design: ${neg.map(x => `${esc(x.label)} ${fmt(-x.kcal, 1)} kcal/kWh`).join(' · ')}</div>` : ''}</div>`;
  // boiler: the loss breakdown
  if (b) {
    const tot = b.losses.reduce((t2, x) => t2 + x.v, 0);
    s += `<div class="card"><h2>Boiler · ${fmt(b.eff, 2)} % <span class="muted" style="font-weight:500;font-size:11.5px">loss method</span></h2>
      <div style="display:flex;height:16px;border-radius:8px;overflow:hidden;margin:2px 0 8px">${b.losses.map(x => `<i title="${esc(U8_BLOSS[x.k][0])}" style="width:${(x.v / tot * 100).toFixed(1)}%;background:${U8_BLOSS[x.k][1]}"></i>`).join('')}</div>
      ${b.losses.map(x => `<div class="u8r"><div class="n"><i style="display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:6px;background:${U8_BLOSS[x.k][1]}"></i>${esc(U8_BLOSS[x.k][0])}</div><div class="x">${fmt(x.v, 2)}</div><div class="un">%</div></div>`).join('')}
      <div class="vals" style="font-size:12px;margin-top:6px">Flue gas at APH outlet <b>${fmt(b.gas_t, 1)} °C</b> · O₂ at ECO outlet <b>${fmt(b.o2, 2)} %</b> (excess air ${fmt(b.excess_air, 1)} %)${b.co !== null ? ` · CO <b>${fmt(b.co, 0)} ppm</b>` : ''}. Moisture losses depend on the coal and are not controllable; dry flue gas, CO and unburnt carbon are.</div></div>`;
  }
  // condenser and feed heaters
  if (c) s += `<div class="card"><h2>Condenser · ${fmt(c.p_mbar, 0)} mbar <span class="muted" style="font-weight:500;font-size:11.5px">expected ${fmt(c.p_exp_mbar, 0)}</span></h2>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px">${[['CW inlet', c.cw_in, '°C'], ['CW outlet', c.cw_out, '°C'], ['Saturation', c.t_sat, '°C'], ['CW rise', c.rise, '°C · exp. ' + fmt(c.rise_ref, 1)], ['TTD', c.ttd, '°C · design ' + fmt(c.ttd_ref, 1)], ['Back pressure', c.p_mbar, 'mbar']]
      .map(([l, v, un]) => `<div style="border:1px solid var(--line);border-radius:10px;padding:6px 8px"><div class="muted" style="font-size:10.5px">${l}</div><b class="num">${fmt(v, 1)}</b> <span class="muted" style="font-size:10px">${un}</span></div>`).join('')}</div>
    ${c.dev_mbar > 0 ? `<div class="vals" style="font-size:12px;margin-top:8px">${fmt(c.dev_mbar, 0)} mbar above expected: <b>${fmt(c.dev_flow_mbar, 0)}</b> from CW flow (temperature rise) and <b>${fmt(c.dev_ttd_mbar, 0)}</b> from TTD (tube fouling, air ingress).</div>` : ''}</div>`;
  if (h) s += `<div class="card"><h2>HP heaters · final FW ${fmt(h.final, 1)} °C <span class="muted" style="font-weight:500;font-size:11.5px">design ${fmt(h.final_ref, 1)}</span></h2>
    <table class="u8m"><tr><th>Temperature rise °C</th><th>HPH-6</th><th>HPH-7</th><th>HPH-8</th><th>6 DESH</th></tr>
    ${h.sides.map(x => `<tr><td>${x.side} side</td>${['hph6', 'hph7', 'hph8', 'desh'].map(k => `<td style="${x[k] !== null && x[k] < 3 ? 'color:#dc2626;font-weight:700' : ''}">${fmt(x[k], 1)}</td>`).join('')}</tr>`).join('')}</table>
    <div class="note-src">A rise near zero means the heater is bypassed or its extraction is closed.</div></div>`;
  // health checks
  const areas = [...new Set(p.checks.map(x => x.area))], order = {alert: 0, watch: 1, ok: 2};
  s += `<div class="card"><h2>Health checks</h2>${areas.map(a => `<div style="font-weight:700;font-size:12px;margin:8px 0 2px;color:var(--muted)">${esc(a)}</div>` +
    p.checks.filter(x => x.area === a).sort((x, y) => order[x.st] - order[y.st]).map(x => { const [col, lab] = u8St(x.st);
      return `<div class="u8r" style="align-items:flex-start"><span style="flex:none;margin-top:3px;width:9px;height:9px;border-radius:50%;background:${col}" title="${lab}"></span><div class="n">${esc(x.what)}${x.tip && x.st !== 'ok' ? `<div class="muted" style="font-size:11px">${esc(x.tip)}</div>` : ''}</div>
        <div class="x" style="color:${col}">${esc(typeof x.v === 'number' ? fmt(x.v, Math.abs(x.v) >= 100 ? 0 : 2) : x.v)}</div><div class="un">${esc(x.u)}${x.lim ? `<div style="font-size:10px">${esc(x.lim)}</div>` : ''}</div></div>`; }).join('')).join('')}</div>`;
  return s + u8RefHtml() + `<div class="note-src" style="margin:0 4px 14px">Worked out every 15 s from the unit's online readings, the coal analysis and the design values below (set by an administrator). Indicative: for a guarantee test use calibrated instruments and the lab's coal and ash analysis. Auxiliary power is not on the unit's page, so the heat rate is gross.</div>`;
}

/** The reference values (design data, coal analysis, cost); administrators can change them. */
function u8RefHtml() {
  const r = U8.ref;
  if (!r) { if (!U8.refBusy) { U8.refBusy = true; conCall('wtps_u8_ref', {}).then(x => { U8.refBusy = false; if (x.ok) { U8.ref = x.data; if (u8Open() && U8.view === 'perf') u8Render(); } }); } return ''; }
  const keys = Object.keys(r.labels);
  return `<details class="card" id="u8Ref" ${U8.refOpen ? 'open' : ''}><summary style="cursor:pointer;font-weight:700">Design values, coal analysis &amp; cost <span class="muted" style="font-weight:500;font-size:11.5px">${r.can_edit ? '· administrators can change' : ''}</span></summary>
    ${U8.refMsg ? `<div class="alert ${U8.refErr ? 'err' : ''}" style="margin:8px 0 0"><span>${U8.refErr ? '⚠' : '✓'}</span><span>${esc(U8.refMsg)}</span></div>` : ''}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 10px;margin-top:8px">${keys.map(k => `<label style="font-size:11px;color:var(--muted)">${esc(r.labels[k])}
      ${r.can_edit ? `<input class="search" data-u8ref="${k}" type="number" step="any" inputmode="decimal" value="${esc(r.ref[k])}" style="margin:2px 0 0;padding:6px 8px">` : `<div style="color:var(--text);font-weight:600;font-size:13px">${esc(r.ref[k])}</div>`}
      ${r.ref[k] !== r.def[k] ? `<span style="font-size:10px">default ${esc(r.def[k])}</span>` : ''}</label>`).join('')}</div>
    ${r.can_edit ? `<div style="display:flex;gap:8px;margin-top:10px"><button class="btn" data-u8="refsave" style="margin:0;background:var(--accent);color:#fff;border-color:var(--accent)">${U8.refBusy ? 'Saving…' : 'Save'}</button><button class="btn" data-u8="refdef" style="margin:0">Back to defaults</button></div>` : ''}
    <div class="note-src">The defaults are typical of a BHEL 800 MW supercritical unit and Indian coal: set them from the unit's design heat balance and the day's coal analysis.</div></details>`;
}
async function u8RefSave(defaults) {
  const set = {};
  document.querySelectorAll('[data-u8ref]').forEach(i => { set[i.dataset.u8ref] = defaults ? '' : i.value; });
  U8.refBusy = true; U8.refOpen = true; u8Render();
  const x = await conCall('wtps_u8_ref', {set});
  U8.refBusy = false;
  if (x.ok) { U8.ref = x.data; U8.refMsg = defaults ? 'Back to the default values.' : 'Saved. The performance is worked out again with these values.'; U8.refErr = false; u8Load(); }
  else { U8.refMsg = x.error; U8.refErr = true; }
  u8Render();
}

/** The parameters of the chosen plant area (mills and turbine bearings as tables), or every match of the search. */
function u8List() {
  const el = $('u8List'); if (!el || !U8.data) return;
  const q = U8.q.trim().toLowerCase();
  if (q) {
    const hit = u8Rows().filter(r => (r.d + ' ' + r.ct + ' ' + r.u).toLowerCase().includes(q)).slice(0, 150);
    el.innerHTML = `<div class="card"><h2>${hit.length} match${hit.length === 1 ? '' : 'es'}</h2>${hit.length ? u8Plain(hit, true) : '<div class="empty">No parameter has that name.</div>'}</div>`;
    return;
  }
  const c = U8.data.cats.find(x => x.key === U8.cat) || U8.data.cats[0];
  el.innerHTML = `<div class="card"><h2>${U8_ICON[c.key] || ''} ${esc(c.title)}</h2>${c.key === 'mills' ? u8Mills(c.rows) : c.key === 'brg' ? u8Bearings(c.rows) : u8Plain(c.rows, false, c.key === 'metal')}</div>`;
}
/** Name, value, unit; metal temperatures with a bar against the hottest. */
function u8Plain(rows, where, bars) {
  const hi = bars ? Math.max(...rows.filter(r => !r.bad).map(r => r.v), 1) : 0;
  return rows.map(r => `<div class="u8r"><div class="n">${esc(r.d)}${where ? `<div class="muted" style="font-size:10.5px">${esc(r.ct)}</div>` : ''}</div>
    ${bars && !r.bad ? `<div class="b"><i style="width:${Math.max(2, r.v / hi * 100).toFixed(0)}%;${r.v / hi > 0.97 ? 'background:#f59e0b' : ''}"></i></div>` : ''}
    <div class="x"${r.c ? ` style="color:${esc(r.c)}"` : ''}>${u8Val(r)}</div><div class="un">${esc(r.u)}</div></div>`).join('');
}
/** Coal mills A–H side by side: feed, current, outlet temperature, PA flow, classifier, bearings, winding. */
const U8_MILL_ROWS = [[/FEED RATE/, 'Feed rate', 't/h'], [/MOTOR BKR/, 'Motor current', 'A'], [/O\/L TEMP/, 'Outlet temp.', '°C'], [/PA I\/L FLOW/, 'PA flow', 't/h'],
  [/CLSFR/, 'Classifier speed', 'rpm'], [/THRUST PAD/, 'Thrust pad brg', '°C'], [/I\/P SHAFT/, 'I/P shaft brg', '°C'], [/GEAR BOX/, 'Gearbox', '°C'], [/MTR BRG/, 'Motor brg NDE', '°C'], [/WNDG/, 'Winding', '°C']];
function u8Mills(rows) {
  const L = 'ABCDEFGH'.split(''), cell = {}, used = new Set();
  rows.forEach((r, i) => { const m = /(?:MILL[- ]?|PULV |C\/M ")([A-H])\b/i.exec(r.d), t = U8_MILL_ROWS.findIndex(x => x[0].test(r.d.toUpperCase())); if (m && t >= 0) { cell[t + m[1].toUpperCase()] = r; used.add(i); } });
  const run = L.map(l => { const f = cell['0' + l]; return !!(f && !f.bad && f.v > 5); }), rest = rows.filter((r, i) => !used.has(i));
  return `<div class="note-src" style="margin:0 0 6px">${run.filter(Boolean).length} of 8 mills running (feed above 5 t/h) · total feed ${fmt(rows.filter(r => /FEED RATE/i.test(r.d) && !r.bad).reduce((t, r) => t + Math.max(0, r.v), 0), 1)} t/h</div>
    <div style="overflow-x:auto"><table class="u8m"><tr><th>Mill</th>${L.map((l, i) => `<th style="${run[i] ? 'color:#16a34a' : ''}">${l}${run[i] ? ' ●' : ''}</th>`).join('')}</tr>
    ${U8_MILL_ROWS.map((x, t) => `<tr><td>${esc(x[1])} <span class="muted" style="font-size:10px">${x[2]}</span></td>${L.map((l, i) => { const r = cell[t + l]; return `<td class="${run[i] ? '' : 'off'}">${r ? u8Val(r) : ''}</td>`; }).join('')}</tr>`).join('')}</table></div>
    ${rest.length ? `<div style="margin-top:8px">${u8Plain(rest)}</div>` : ''}`;
}
/** Turbine-generator bearings 1–8: metal temperatures, drain oil, casing and shaft vibration. */
const U8_BRG_ROWS = [[/MTL TMP TOP/, 'Metal temp. top', '°C'], [/MTL TMP BTM/, 'Metal temp. bottom', '°C'], [/DRAIN OIL/, 'Drain oil temp.', '°C'], [/CSG ABS VIB/, 'Casing vibration', 'mm/s'], [/REL SFT VIB/, 'Shaft vibration', 'µm']];
function u8Bearings(rows) {
  const cell = {}, used = new Set();
  rows.forEach((r, i) => { const m = /BRG-(\d)/i.exec(r.d), t = U8_BRG_ROWS.findIndex(x => x[0].test(r.d.toUpperCase())); if (m && t >= 0 && !/THR PAD/i.test(r.d)) { cell[t + '_' + m[1]] = r; used.add(i); } });
  const N = [1, 2, 3, 4, 5, 6, 7, 8], rest = rows.filter((r, i) => !used.has(i));
  return `<div class="note-src" style="margin:0 0 6px">Bearings 1–5 steam turbine, 6–7 generator, 8 exciter.</div><div style="overflow-x:auto"><table class="u8m"><tr><th>Bearing</th>${N.map(n => `<th>${n}</th>`).join('')}</tr>
    ${U8_BRG_ROWS.map((x, t) => `<tr><td>${esc(x[1])} <span class="muted" style="font-size:10px">${x[2]}</span></td>${N.map(n => { const r = cell[t + '_' + n]; return `<td>${r ? u8Val(r) : ''}</td>`; }).join('')}</tr>`).join('')}</table></div>
    ${rest.length ? `<div style="margin-top:8px">${u8Plain(rest)}</div>` : ''}`;
}

/** Without the permission: what the page is, and the request to the super administrator. */
function u8AccessHtml() {
  const a = U8.acc;
  if (!a) { if (!U8.accBusy) setTimeout(() => u8Access(false), 0); return '<div class="card"><div class="sk" style="height:120px"></div></div>'; }
  const intro = `<div class="card"><h2>⚡ WTPS Unit 8 · live plant parameters</h2><div class="vals" style="font-size:13px">Load, steam, coal mills, turbine bearings, generator, water chemistry and emissions of Wanakbori Unit 8 (800 MW), with trends. This page is given on approval by the super administrator.</div>`;
  if (a.status === 'pending') return intro + `<div class="alert" style="margin:10px 0 0"><span>🕓</span><span>Your request is waiting for the super administrator${a.at ? ' (asked ' + esc(String(a.at).slice(0, 16)) + ')' : ''}. You are told when it is decided.</span></div>
    <button class="btn" data-u8="chk" style="margin-top:10px">${U8.accBusy ? 'Checking…' : 'Check again'}</button></div>`;
  return intro + (a.status === 'rejected' ? `<div class="alert err" style="margin:10px 0 0"><span>✕</span><span>Your earlier request was not approved${a.note ? ': ' + esc(a.note) : ''}. You may ask again.</span></div>` : '')
    + (a.status === 'error' ? `<div class="alert err" style="margin:10px 0 0"><span>⚠</span><span>${esc(a.error)}</span></div>` : '')
    + `<label style="display:block;font-size:12px;color:var(--muted);margin-top:10px">Why you need it (optional)<input class="search" id="u8Reason" maxlength="150" value="${esc(U8.reason)}" placeholder="e.g. Unit 8 shift charge engineer" style="margin:4px 0 0"></label>
    <button class="btn" data-u8="ask" style="margin-top:10px;background:var(--accent);color:#fff;border-color:var(--accent)">${U8.accBusy ? 'Sending…' : 'Request access'}</button></div>`;
}

function u8Tick() {
  clearTimeout(U8.timer);
  if (!u8Open() || !u8Can()) return;
  U8.timer = setTimeout(() => { if (!u8Open()) return; if (U8.live) u8Load(); u8Trend(24); if (U8.hours !== 24) u8Trend(U8.hours); u8Tick(); }, U8.live ? 15000 : 300e3);
}
function u8Show() {
  u8Render(); if (!u8Can()) return;
  if (!U8.at || Date.now() - U8.at > 5000) u8Load();
  u8Trend(24); if (U8.hours !== 24) u8Trend(U8.hours);
  u8Tick();
}
const u8Keep = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* not kept */ } };

document.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('[data-u8],[data-u8cat],[data-u8kpi],[data-u8h],[data-u8view]'); if (!b || !$('v-u8') || !$('v-u8').contains(b)) return;
  if (b.dataset.u8view) { U8.view = b.dataset.u8view; u8Keep('u8view', U8.view); if (U8.view === 'perf' && !['uhr', 'beff', 'loss', 'hr', 'eff'].includes(U8.kpi)) U8.kpi = 'uhr'; return u8Render(); }
  if (b.dataset.u8cat) { U8.cat = b.dataset.u8cat; U8.q = ''; const q = $('u8Q'); if (q) q.value = ''; document.querySelectorAll('#u8Cats .chip').forEach(c => c.classList.toggle('on', c.dataset.u8cat === U8.cat)); return u8List(); }
  if (b.dataset.u8kpi) { U8.kpi = b.dataset.u8kpi; u8Keep('u8kpi', U8.kpi); u8Render(); const c = $('u8TrendCard'); if (c) c.scrollIntoView({behavior: 'smooth', block: 'start'}); return; }
  if (b.dataset.u8h) { U8.hours = +b.dataset.u8h; u8Keep('u8hours', U8.hours); u8Render(); return u8Trend(U8.hours); }
  const a = b.dataset.u8;
  if (a === 'back') return show('connect');
  if (a === 'ref') { u8Load(); return u8Trend(U8.hours, true); }
  if (a === 'live') { U8.live = !U8.live; u8Keep('u8live', U8.live ? '1' : '0'); u8Render(); return u8Tick(); }
  if (a === 'ask') { U8.reason = ($('u8Reason') || {}).value || ''; return u8Access(true); }
  if (a === 'chk') return u8Access(false);
  if (a === 'refsave') return u8RefSave(false);
  if (a === 'refdef') return u8RefSave(true);
});
document.addEventListener('input', e => {
  if (e.target.id === 'u8Reason') { U8.reason = e.target.value; return; }
  if (e.target.id !== 'u8Q') return;
  U8.q = e.target.value;
  document.querySelectorAll('#u8Cats .chip').forEach(c => c.classList.toggle('on', !U8.q && c.dataset.u8cat === U8.cat));
  u8List();
});
document.addEventListener('toggle', e => { if (e.target && e.target.id === 'u8Ref') U8.refOpen = e.target.open; }, true);
document.addEventListener('visibilitychange', () => { if (u8Open()) u8Show(); else clearTimeout(U8.timer); });
