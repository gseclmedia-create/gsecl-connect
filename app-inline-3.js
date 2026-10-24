
const OUTAGE_EVERY = 300, IEX_EVERY = 300;   // seconds; GSECL feed and SLDC data follow the refresh setting (S.set.refresh)
const SET_DEFAULT_EARLY = {refresh: 60, theme: 'system', palette: 'gsecl', seen: 0};
const FUEL_COLOR = {Coal: 'var(--coal)', Lignite: 'var(--lignite)', Gas: 'var(--gas)', Hydro: 'var(--hydro)'};
const TYPE_COLOR = {Forced: 'var(--forced)', Planned: 'var(--planned)', RSD: 'var(--rsd)', Outage: 'var(--outage)'};

const S = {busy: {}, set: {...SET_DEFAULT_EARLY}, gsecl: null, home: null, outages: null, iex: null, merit: null, stale: {}, guj: '', loading: 0, fuel: '', type: '', metric: 'freq', range: 24, basis: 'gen', mix: '', q: '', open: new Set()};
let tick = 0;

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const fmt = (v, d = 0) => v === null || v === undefined || !isFinite(v) ? '—' : Number(v).toLocaleString('en-IN', {maximumFractionDigits: d, minimumFractionDigits: d});
const mwTxt = v => v === null || v === undefined ? '<span class="na">—</span>' : fmt(v);
const devTxt = v => v === null || v === undefined ? '<span class="na">—</span>'
  : `<span class="${v > 0 ? 'pos' : v < 0 ? 'neg' : ''}">${v > 0 ? '+' : ''}${fmt(v)}</span>`;
const badge = t => `<span class="badge b-${esc(t)}">${esc(t)}</span>`;
/**
 * CSV export for every chart: csvBtn() keeps the chart's figures under an id and returns an "Export CSV" button;
 * touching it saves them (Native.exportCsv shares the file; in a browser it downloads). csvSave() for direct use.
 */
const CSV_REG = {};
const csvStamp = () => { const d = new Date(), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`; };
const csvCell = v => { if (v === null || v === undefined || (typeof v === 'number' && !isFinite(v))) return ''; const s = String(v); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
function csvSave(name, header, rows) {
  if (!rows || !rows.length) return alert('No figures to export for this selection.');
  const csv = [header].concat(rows).map(r => r.map(csvCell).join(',')).join('\r\n');
  const file = String(name || 'GSECL').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/_+$/, '') + '_' + csvStamp() + '.csv';
  if (typeof hasNative === 'function' && hasNative('exportCsv')) return Native.exportCsv(file, csv);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\ufeff' + csv], {type: 'text/csv'})); a.download = file; a.click();
}
function csvBtn(id, name, header, rows, label = 'Export CSV') {
  CSV_REG[id] = {name, header, rows};
  return `<div class="csvrow"><button class="csvb" data-csv="${esc(id)}">⤓ ${esc(label)}</button></div>`;
}
document.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('[data-csv]');
  if (!b) return;
  e.stopPropagation();
  const r = CSV_REG[b.dataset.csv];
  if (r) csvSave(r.name, r.header, typeof r.rows === 'function' ? r.rows() : r.rows);
}, true);
const csvTime = t => { const d = new Date(t), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };

const outRows = (kind, key) => S.outages?.ok ? (S.outages.match[kind][key] || []).map(i => S.outages.rows[i]) : [];

function unitState(u) {
  const o = outRows('units', u.key);
  if (o.length) return {type: o[0].type, color: TYPE_COLOR[o[0].type], outs: o};
  if (u.mw === null) return {type: null, color: 'var(--line)', outs: []};
  return u.mw > 0 ? {type: 'Running', color: 'var(--run)', outs: []} : {type: 'Off', color: 'var(--off)', outs: []};
}
const outDetail = o => esc([o.since && `Since ${o.since}`, o.revised && `Expected ${o.revised}`, o.reason].filter(Boolean).join(' · '));

// ---------------------------------------------------------------- loading

async function load(what) {
  if (S.busy[what]) return;   // previous request for this source still running (short refresh interval)
  S.busy[what] = true;
  S.loading++; $('refreshBtn').classList.add('spin'); $('meBtn').classList.add('busy');
  try {
    const fn = {gsecl: gseclLive, home: sldcHome, outages: sldcOutages, iex: iexPrices, merit: sldcMeritCheck}[what];
    const res = await fn();
    // A failed refresh keeps the last good data on screen and reports the error, instead of blanking the screen.
    if (res.ok) { res._at = Date.now(); LIVE.mine[what] = {at: res._at, res}; }
    if (res.ok || !S[what]?.ok) { S[what] = res; S.stale[what] = null; }
    else S.stale[what] = {error: res.error, since: S[what].fetched_at};
    if (!res.ok) liveUse(what);                 // another phone's reading, if this phone cannot reach the source
    if (what === 'home' && res.ok) recordSample();
    if ((what === 'outages' || what === 'gsecl') && res.ok) applyOutageSync();
    if (res.ok) genPush();
    if (res.ok) checkAlerts(what);
  } finally {
    S.busy[what] = false;
    S.loading--; if (!S.loading) { $('refreshBtn').classList.remove('spin'); $('meBtn').classList.remove('busy'); }
    render();
  }
}
/**
 * SLDC's site refuses Google's servers, so the app sends what it read (station-wise rows, grid summary, GSECL outage
 * list) to the GSECL Connect service for its generation log and the daily management report. At most every 10 minutes
 * per phone; the service keeps one reading per 10 minutes from whichever phone comes first.
 */
let genPushAt = 0;
function genPush() {
  if (Date.now() - genPushAt < 2 * 60e3 || typeof conCall !== 'function' || typeof hasConnect !== 'function' || !hasConnect()) return;   // every 2 min (other devices fill their gaps from it)
  const g = S.gsecl, h = S.home, o = S.outages;
  if (!(g?.ok && Array.isArray(g.rt_rows) && g.rt_rows.length) && !o?.ok) return;
  genPushAt = Date.now();
  conCall('gen_push', {
    rt: g?.ok && Array.isArray(g.rt_rows) ? g.rt_rows : null,
    rt2: h?.ok && h.raw2 ? h.raw2 : null,
    iex: S.iex?.ok ? {date: isoDay(Date.now()), rtm: S.iex.rtm || [], dam: S.iex.dam || []} : null,     // block prices for the DSM estimate
    outages: o?.ok ? (o.rows || o.allRows).map(r => ({unit: r.unit, type: r.type, cap: r.cap || '', since: r.since || '', back: r.revised || r.schedule || '', reason: r.reason || ''})) : null,
  }).catch(() => {});
}

// ---------------------------------------------------------------- shared live data (via GSECL Connect)

/**
 * Phones help each other: each reads the sources itself; a source it cannot reach (blocked network, source
 * busy) is filled with the newest reading another phone sent to the GSECL Connect service. Once a minute while
 * the app is open; a reading is uploaded only when the service asks for it (about one phone per minute).
 */
const LIVE = {mine: {}, copy: {}, need: [], busy: false, at: 0};
const LIVE_SRCS = ['gsecl', 'home', 'outages', 'iex', 'merit'];
function liveUse(what) {
  const r = LIVE.copy[what];
  if (!r || Date.now() - r.at > 20 * 60e3) return false;
  const cur = S[what];
  if (cur?.ok && !cur.relay_at && !S.stale[what]) return false;                   // own reading is fine
  if (cur?.ok && (cur.relay_at || cur._at || 0) >= r.at) return false;           // already showing something as new
  S[what] = Object.assign(JSON.parse(JSON.stringify(r.obj)), {relay_at: r.at});
  S.stale[what] = null;
  if (what === 'outages' || what === 'gsecl') applyOutageSync();
  return true;
}
async function liveSync(extraWant) {
  if (LIVE.busy || typeof conCall !== 'function' || typeof hasConnect !== 'function' || !hasConnect() || document.hidden) return;
  LIVE.busy = true;
  try {
    const want = LIVE_SRCS.filter(k => !S[k] || !S[k].ok || S[k].relay_at || S.stale[k]).concat(extraWant || []);
    const have = {}; Object.keys(LIVE.copy).forEach(k => { have[k] = LIVE.copy[k].at; });
    const put = {};
    LIVE.need.forEach(k => {
      const m = LIVE.mine[k];
      if (m && Date.now() - m.at < 6 * 60e3) { const {relay_at, ...plain} = m.res; put[k] = {at: m.at, data: JSON.stringify(plain)}; }
    });
    const r = await conCall('live', {want, have, put});
    LIVE.at = Date.now();
    if (!r.ok) return;
    LIVE.need = r.data.need || [];
    let changed = false;
    for (const [k, o] of Object.entries(r.data.data || {})) {
      try { LIVE.copy[k] = {at: o.at, obj: JSON.parse(o.data)}; } catch (e) { continue; }
      if (k === 'fois') { if (window.kLiveFois) window.kLiveFois(LIVE.copy[k]); continue; }
      if (liveUse(k)) changed = true;
    }
    if (changed) render();
  } finally { LIVE.busy = false; }
}
/**
 * Trend history from other devices: stretches of the last 48 h with no reading on this phone (app closed, phone
 * off) are filled from the readings any phone sent to the GSECL Connect service (one every ~2 minutes).
 */
let histFillAt = 0;
async function historyBackfill(force) {
  if (!hasNative('historyMerge') || !hasNative('historyRead') || typeof conCall !== 'function' || typeof hasConnect !== 'function' || !hasConnect()) return;
  if (!force && Date.now() - histFillAt < 20 * 60e3) return;
  histFillAt = Date.now();
  const since = Date.now() - 48 * 3600e3, gaps = [];
  let prev = since;
  for (const t of parseRows(Native.historyRead(String(since))).map(r => r[0]).sort((a, b) => a - b)) { if (t - prev > 12 * 60e3) gaps.push([prev, t]); prev = Math.max(prev, t); }
  if (Date.now() - prev > 12 * 60e3) gaps.push([prev, Date.now()]);
  if (!gaps.length) return;
  const r = await conCall('history_get', {from: gaps[0][0], to: gaps[gaps.length - 1][1]});
  if (!r.ok || !r.data.rows) return;
  const csv = r.data.rows.filter(x => gaps.some(([a, b]) => x[0] > a + 60e3 && x[0] < b - 60e3)).map(x => x.map(v => v === null || v === undefined ? '' : v).join(',')).join('\n');
  if (!csv) return;
  if (Native.historyMerge(csv) > 0) { trendKey = ''; if (typeof gdHist !== 'undefined') gdHist.key = ''; render(); }
}
setTimeout(() => historyBackfill(true), 12000);
setInterval(() => historyBackfill(false), 5 * 60e3);
document.addEventListener('visibilitychange', () => { if (!document.hidden) historyBackfill(false); });

/** For the Coal page: its own FOIS reading to share, or a request for another phone's. */
window.liveMine = (src, obj) => { LIVE.mine[src] = {at: Date.now(), res: obj}; };
window.liveWant = src => liveSync([src]);
setInterval(() => liveSync(), 60e3);
setTimeout(() => liveSync(), 8000);

/** SLDC rows of units the GSECL feed shows generating (above 2 MW) leave the outage list: the unit is back. */
function applyOutageSync() {
  const o = S.outages;
  if (!o?.ok || !o.allRows) return;
  const r = withoutSynced(o.allRows, S.gsecl);
  o.rows = r.rows; o.synced = r.synced; o.match = matchOutages(r.rows);
}
function refreshAll() { tick = 0; load('gsecl'); load('home'); load('outages'); load('iex'); load('merit'); }

// ---------------------------------------------------------------- header

function freqBand(f) {
  if (f >= 49.90 && f <= 50.05) return ['ok', 'Normal band'];
  if (f >= 49.80 && f <= 50.10) return ['warn', f < 50 ? 'Low' : 'High'];
  return ['bad', f < 50 ? 'Very low' : 'Very high'];
}

function renderHeader() {
  const g = S.gsecl, h = S.home;
  if (h?.ok) {
    if (h.freq) {
      const [cls, txt] = freqBand(h.freq.value);
      $('gFreq').innerHTML = `${fmt(h.freq.value, 3)}<small>Hz</small>`;
      $('gFreqT').className = 't ' + cls; $('gFreqT').textContent = txt;
    }
    if (h.catered) $('gCat').innerHTML = `${fmt(h.catered.value)}<small>MW</small>`;
    $('gCatT').textContent = h.relay_at ? 'Shared ' + new Date(h.relay_at).toTimeString().slice(0, 5) : 'SLDC live';
  } else if (h) {
    $('gFreq').textContent = '—'; $('gFreqT').className = 't bad'; $('gFreqT').textContent = 'Unavailable';
  }
  const P = S.iex;
  if (P?.ok && P.rtmIdx !== null && P.rtm) {
    $('gDam').innerHTML = `₹${fmt(P.rtm[P.rtmIdx] / 1000, 3)}<small>/unit</small>`;
    $('gDamT').textContent = blockLabel(P.rtmIdx);
  } else if (P) { $('gDam').textContent = '—'; $('gDamT').textContent = 'Unavailable'; }
  const dot = $('liveDot');
  if (g?.ok) {
    dot.className = 'dot' + (g.stale ? ' stale' : '');
    $('liveTxt').textContent = g.stale ? 'Feed delayed' : 'Live';
    $('stampFeed').textContent = `GSECL ${(g.data_time || '—').split(' ')[1] || '—'}` + (h?.ok && h.time ? ` · SLDC ${h.time.split(' ')[1]}` : '');
  } else if (g) {
    dot.className = 'dot err'; $('liveTxt').textContent = 'GSECL feed unreachable';
  }
}

function renderAlerts() {
  const a = [];
  const NAMES = {gsecl: 'GSECL feed', home: 'SLDC grid data', outages: 'SLDC unit outages', iex: 'IEX prices', merit: 'SLDC merit-order check'};
  for (const [k, s] of Object.entries(S.stale)) if (s) a.push(['', `${NAMES[k]}: latest refresh failed (${s.error}). Showing data fetched ${s.since}.`]);
  for (const k of Object.keys(NAMES)) if (S[k]?.relay_at) a.push(['', `${NAMES[k]}: this phone could not reach the source; showing the reading another phone shared through GSECL Connect at ${new Date(S[k].relay_at).toTimeString().slice(0, 5)}.`]);
  const g = S.gsecl;
  if (g && !g.ok) a.push(['err', `GSECL feed: ${g.error}`]);
  if (g?.ok) {
    if (g.stale) a.push(['', `GSECL feed time ${g.data_time || '(none)'} is more than 15 minutes old — source may not be updating.`]);
    if (g.feed_error) a.push(['err', `GSECL feed unreachable (${g.feed_error}). Generation and SG shown from SLDC; DC unavailable.`]);
    if (g.sldc_error) a.push(['', `SLDC schedule unavailable (${g.sldc_error}). SG shown from the GSECL feed.`]);
    if (g.missing.length) a.push(['', `Not available from either source: ${g.missing.join(', ')}. Shown as “—” and left out of Gen − SG.`]);
    if (g.fallback.genSldc.length) a.push(['', `Unit values missing in the GSECL feed; block generation taken from SLDC for: ${g.fallback.genSldc.join(', ')}.`]);
    if (g.unmapped.sg.length || g.unmapped.dc.length)
      a.push(['', `New feed keys not mapped to a PPA block: ${[...g.unmapped.sg.map(k => 'SG ' + k), ...g.unmapped.dc.map(k => 'DC ' + k)].join(', ')}`]);
  }
  if (S.home && !S.home.ok) a.push(['err', `SLDC grid data: ${S.home.error}`]);
  if (S.iex && !S.iex.ok) a.push(['err', `IEX prices: ${S.iex.error}`]);
  if (S.outages && !S.outages.ok) a.push(['err', `SLDC unit outages: ${S.outages.error}`]);
  // One compact line; the details open on touch (several long notes used to fill the screen).
  if (!a.length) { $('alerts').innerHTML = ''; return; }
  const errs = a.filter(x => x[0] === 'err').length, open = S.alertsOpen ? ' open' : '';
  $('alerts').innerHTML = `<details class="alx alx-note"${open}><summary><span>ⓘ</span><span>Data sources${errs ? ` · ${errs} not reachable just now` : ''}${a.length - errs ? ` · ${a.length - errs} note${a.length - errs > 1 ? 's' : ''}` : ''} · figures are from the sources that answered</span><b>Details</b></summary>
    ${a.map(([c, t]) => `<div class="alx-i ${c}">${esc(t)}</div>`).join('')}</details>`;
  $('alerts').querySelector('details').addEventListener('toggle', e => { S.alertsOpen = e.target.open; });
}

// ---------------------------------------------------------------- dashboard

// ================================================================ generation dashboard (3.9.1)

/** Today's (or another day's) GSECL readings from the stored history: [{m: minutes since midnight, v: MW}]. */
/** Readings of one day as {m (minute of day), v, t}; col 3 = GSECL generation, 2 = Gujarat catered, 6 = solar, 7 = wind. */
function gdDay(rows, dayStartMs, col = 3) {
  return rows.filter(r => r[0] >= dayStartMs && r[0] < dayStartMs + 864e5 && r[col] !== null && r[col] !== undefined && isFinite(r[col])).map(r => ({m: (r[0] - dayStartMs) / 60e3, v: r[col], t: r[0]}));
}
/** Energy (MU) of readings up to minute `upTo`, trapezoids; gaps over 30 min are not bridged. */
function gdEnergy(pts, upTo = 1440) {
  let mwh = 0;
  for (let i = 1; i < pts.length && pts[i].m <= upTo; i++) { const dt = pts[i].m - pts[i - 1].m; if (dt > 0 && dt <= 30) mwh += (pts[i].v + pts[i - 1].v) / 2 * dt / 60; }
  return mwh / 1000;
}
let gdHist = {key: '', rows: []};

/**
 * "Today so far" is worked out from the readings kept by the GSECL Connect service (one every ~2 minutes, whichever
 * device sent first), so every device shows the same figures. The phone's own readings are used only when the service
 * cannot be reached. Read again every 3 minutes.
 */
let gdShared = {at: 0, busy: false, rows: null, from: 0};
async function gdSharedLoad() {
  if (gdShared.busy || Date.now() - gdShared.at < 3 * 60e3 || typeof conCall !== 'function' || typeof hasConnect !== 'function' || !hasConnect()) return;
  const now = new Date(), y0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() - 864e5;
  gdShared.busy = true;
  const r = await conCall('history_get', {from: y0, to: Date.now()});
  gdShared.busy = false; gdShared.at = Date.now();
  if (r.ok && Array.isArray(r.data.rows)) { gdShared.rows = r.data.rows; gdShared.from = y0; if ($('gdToday')) $('gdToday').innerHTML = gdTodayHtml(); }
}
/** The day's readings for "Today so far": the shared ones when there are enough, else this device's. */
function gdRows(localRows, t0) {
  setTimeout(gdSharedLoad, 0);
  const sh = gdShared.rows;
  if (sh && gdShared.from <= t0 - 864e5 && sh.filter(r => r[0] >= t0 && r[3] !== null).length >= 5) return {rows: sh, shared: true};
  return {rows: localRows, shared: false};
}
/** Time-weighted average MW of readings (the same gaps rule as the energy), so it agrees with the MU figure. */
function gdAvg(pts) {
  let mwh = 0, min = 0;
  for (let i = 1; i < pts.length; i++) { const dt = pts[i].m - pts[i - 1].m; if (dt > 0 && dt <= 30) { mwh += (pts[i].v + pts[i - 1].v) / 2 * dt; min += dt; } }
  return min ? mwh / min : (pts.length ? pts.reduce((t, p) => t + p.v, 0) / pts.length : 0);
}

function gdHeroHtml(g) {
  const T = g.totals, st = g.stations;
  const cap = st.reduce((t, s) => t + s.blocks.reduce((u, b) => u + (b.cap || 0), 0), 0);
  const units = st.flatMap(s => s.blocks.flatMap(b => b.units)), on = units.filter(u => (u.mw ?? 0) > RUN_MW).length, known = units.filter(u => u.mw !== null).length;
  const catered = S.home?.ok && S.home.catered ? S.home.catered.value : null;
  const dcPct = T.dc ? T.gen / T.dc * 100 : null, plf = cap ? T.gen / cap * 100 : null, d = T.deviation;
  const scale = Math.max(T.dc || 0, T.gen || 0, T.sg || 0, 1);
  return `<div class="dhero">
    <div class="t" style="display:flex;justify-content:space-between;gap:8px"><span>GSECL generation · live</span><span style="opacity:.75;font-weight:600;letter-spacing:.02em;text-transform:none">${esc(g.data_time || '')}${g.stale ? ' · <b style="color:#fde68a">stale</b>' : ''}</span></div>
    <div class="v num" style="margin-top:8px">${fmt(T.gen)}<small style="font-size:14px;font-weight:600;opacity:.8">MW</small>${dcPct !== null ? `<span class="dpill ${dcPct >= 85 ? 'r' : 'p'}">${fmt(dcPct, 0)}% of DC</span>` : ''}</div>
    <div class="gbar"><i style="width:${Math.min(100, T.gen / scale * 100)}%"></i>${T.sg ? `<b style="left:calc(${Math.min(100, T.sg / scale * 100)}% - 1px)"></b>` : ''}</div>
    <div class="dsplit-k num"><span>Generation ${fmt(T.gen)} MW</span><span>▮ Schedule ${T.sg === null ? '—' : fmt(T.sg)} · DC ${T.dc === null ? '—' : fmt(T.dc)} MW</span></div>
    <div class="dkpis" style="grid-template-columns:repeat(3,1fr)">
      <div class="dkpi"><span>Gen − schedule</span><b class="num ${d > 0 ? 'pos' : d < 0 ? 'neg' : ''}">${d === null ? '—' : (d > 0 ? '+' : d < 0 ? '−' : '') + fmt(Math.abs(d))}</b><small>${d === null ? 'no schedule' : d > 0 ? 'over schedule' : d < 0 ? 'under schedule' : 'on schedule'}</small></div>
      <div class="dkpi"><span>Loading now</span><b class="num">${plf === null ? '—' : fmt(plf, 1) + '%'}</b><small>gross MW of ${cap ? fmt(cap) + ' MW' : 'capacity'}</small></div>
      <div class="dkpi"><span>Units on bar</span><b class="num">${on} / ${known || units.length}</b><small>above ${RUN_MW} MW</small></div>
      <div class="dkpi"><span>Undeclared</span><b class="num">${cap && T.dc !== null ? fmt(Math.max(0, cap - T.dc)) : '—'}</b><small>MW capacity not in DC</small></div>
      <div class="dkpi"><span>DC unused</span><b class="num">${T.dc !== null ? fmt(Math.max(0, T.dc - T.gen)) : '—'}</b><small>MW (backing down)</small></div>
      <div class="dkpi"><span>Share of Gujarat</span><b class="num">${catered ? fmt(T.gen / catered * 100, 1) + '%' : '—'}</b><small>${catered ? 'of ' + fmt(catered) + ' MW catered' : 'catered n/a'}</small></div>
    </div></div>`;
}

function gdTodayHtml() {
  if (!hasNative('historyRead')) return '<h2>Today so far</h2><div class="empty">Daily figures are worked out from the readings the app stores on the phone.</div>';
  const now = new Date(), t0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime(), y0 = t0 - 864e5;
  const key = Math.floor(Date.now() / 60e3) + '';
  if (gdHist.key !== key) gdHist = {key, rows: parseRows(Native.historyRead(String(y0)))};
  const src = gdRows(gdHist.rows, t0);
  const A = gdDay(src.rows, t0), B = gdDay(src.rows, y0), nowM = (Date.now() - t0) / 60e3;
  if (A.length < 2) return '<h2>Today so far</h2><div class="empty">Not enough readings yet today. They are recorded while the app is open and by the background monitor (Profile).</div>';
  const eA = gdEnergy(A), eB = gdEnergy(B, nowM), pk = A.reduce((b, p) => (p.v > b.v ? p : b)), lo = A.reduce((b, p) => (p.v < b.v ? p : b));
  const avg = gdAvg(A), hm = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(Math.floor(m % 60)).padStart(2, '0')}`;
  const ch = eB ? (eA - eB) / eB * 100 : null;
  const W = 340, H = 120, L = 34, R = 6, Tp = 8, Bt = 18, all = A.concat(B).map(p => p.v), hi = Math.max(...all) * 1.06, lw = Math.min(...all) * 0.94;
  const x = m => L + m / 1440 * (W - L - R), y = v => Tp + (hi - v) / ((hi - lw) || 1) * (H - Tp - Bt);
  const line = l => { let d = '', prev = null; l.forEach(p => { d += (prev !== null && p.m - prev <= 30 ? 'L' : 'M') + x(p.m).toFixed(1) + ',' + y(p.v).toFixed(1); prev = p.m; }); return d; };
  return `<h2>Today so far <span class="more muted" style="font-weight:500;font-size:11.5px">${src.shared ? 'GSECL Connect · ' : 'this device · '}${A.length} readings</span></h2>
    <div class="tstats" style="grid-template-columns:repeat(4,1fr)">
      <div><span>Energy</span><b class="num">${fmt(eA, 2)}</b><small>MU till ${hm(A[A.length - 1].m)}</small></div>
      <div><span>vs yesterday</span><b class="num ${ch === null ? '' : ch >= 0 ? 'pos' : 'neg'}">${ch === null ? '—' : (ch >= 0 ? '+' : '−') + fmt(Math.abs(ch), 1) + '%'}</b><small>${eB ? fmt(eB, 2) + ' MU same time' : 'no data'}</small></div>
      <div><span>Peak</span><b class="num">${fmt(pk.v)}</b><small>MW at ${hm(pk.m)}</small></div>
      <div><span>Average</span><b class="num">${fmt(avg)}</b><small>low ${fmt(lo.v)} at ${hm(lo.m)}</small></div>
    </div>
    <div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="GSECL generation today and yesterday">
      ${niceTicks(lw, hi, 3).map(v => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${L - 4}" y="${y(v) + 3.5}" text-anchor="end">${Math.abs(v) >= 1000 ? fmt(v / 1000, 1) + 'k' : fmt(v)}</text>`).join('')}
      ${[0, 6, 12, 18, 24].map((h, i) => `<text class="ax" x="${x(h * 60)}" y="${H - 4}" text-anchor="${i === 0 ? 'start' : i === 4 ? 'end' : 'middle'}">${String(h).padStart(2, '0')}:00</text>`).join('')}
      <path d="${line(B)}" fill="none" style="stroke:var(--muted)" stroke-width="1.6" stroke-dasharray="4 3"/>
      <path d="${line(A)}" fill="none" style="stroke:var(--accent)" stroke-width="2.4" stroke-linejoin="round"/>
      <line x1="${x(nowM)}" x2="${x(nowM)}" y1="${Tp}" y2="${H - Bt}" style="stroke:var(--brand2)" stroke-width="1" stroke-dasharray="2 2"/>
    </svg></div>
    <div class="keyline"><span><i style="width:16px;height:3px;background:var(--accent)"></i>Today</span><span><i style="width:16px;height:0;border-top:2px dashed var(--muted)"></i>Yesterday</span><span>MW · SLDC GSECL total</span></div>
    ${gdGujHtml(src.rows, t0, hm, src.shared)}
    ${csvBtn('gdToday', 'GSECL_generation_today', ['Time', 'Today MW', 'Yesterday MW'], A.map(p => [hm(p.m), p.v, (B.find(q => Math.abs(q.m - p.m) <= 3) || {}).v ?? null]))}`;
}

/** GSECL against Gujarat today so far: energy (MU) and maximum MW of GSECL, Gujarat catered, solar and wind, with GSECL's share. */
function gdGujHtml(rows, t0, hm, shared) {
  const line = (label, col) => { const p = gdDay(rows, t0, col); if (p.length < 2) return null; const pk = p.reduce((b, x) => (x.v > b.v ? x : b)); return {label, mu: gdEnergy(p), max: pk.v, at: hm(pk.m)}; };
  const G = line('GSECL generation', 3), J = line('Gujarat catered', 2), So = line('Gujarat solar', 6), Wi = line('Gujarat wind', 7);
  if (!G || !J) return '';
  const tr = x => x ? `<tr><td>${x.label}</td><td><b>${fmt(x.mu, 2)}</b></td><td>${fmt(x.max)}</td><td>${x.at}</td><td>${J.mu ? fmt(x.mu / J.mu * 100, 1) + '%' : '—'}</td></tr>` : '';
  return `<h2 style="margin-top:14px">GSECL and Gujarat today</h2><div style="overflow-x:auto"><table class="gt num">
    <tr><th></th><th>Energy MU</th><th>Max MW</th><th>at</th><th>of Gujarat MU</th></tr>
    ${tr(J)}${tr(G)}
    <tr class="tot"><td>GSECL share</td><td>${fmt(G.mu / J.mu * 100, 1)}%</td><td>${fmt(G.max / J.max * 100, 1)}%</td><td></td><td></td></tr>
    ${tr(So)}${tr(Wi)}</table></div>
    <div class="note-src">Till ${hm(Math.min((Date.now() - t0) / 60e3, Math.max(...gdDay(rows, t0).map(p => p.m))))}, from ${shared ? 'the readings kept by GSECL Connect (the same on every device)' : 'the readings on this device'}. Share of max = GSECL max MW ÷ Gujarat catered max MW. Solar and wind are Gujarat totals (SLDC).</div>`;
}

function gdFuelHtml(g) {
  const fuels = {};
  for (const s of g.stations) {
    const f = fuels[s.fuel] || (fuels[s.fuel] = {gen: 0, dc: 0, cap: 0, sg: 0, on: 0, units: 0});
    for (const b of s.blocks) { f.gen += b.gen || 0; f.dc += b.dc || 0; f.cap += b.cap || 0; f.sg += b.sg || 0; for (const u of b.units) { f.units++; if ((u.mw ?? 0) > RUN_MW) f.on++; } }
  }
  const ring = (pct, c) => { const r = 16, cc = 2 * Math.PI * r, v = Math.max(0, Math.min(1, pct)); return `<svg width="44" height="44" viewBox="0 0 44 44"><circle cx="22" cy="22" r="${r}" fill="none" stroke-width="6" style="stroke:var(--soft)"/><circle cx="22" cy="22" r="${r}" fill="none" stroke-width="6" stroke-linecap="round" style="stroke:${c}" stroke-dasharray="${(v * cc).toFixed(1)} ${cc.toFixed(1)}" transform="rotate(-90 22 22)"/><text x="22" y="25.5" text-anchor="middle" style="font-size:9.5px;font-weight:700;fill:var(--ink)">${Math.round(v * 100)}%</text></svg>`; };
  return `<div class="gfuel">${Object.entries(fuels).map(([k, f]) => `<div class="gf" style="--c:${FUEL_COLOR[k] || 'var(--accent)'}" data-fuel="${esc(k)}">
      <span class="n">${esc(k)}</span>${ring(f.cap ? f.gen / f.cap : 0, FUEL_COLOR[k] || 'var(--accent)')}
      <span class="v num">${fmt(f.gen)} <small>MW</small></span>
      <span class="s num">DC ${fmt(f.dc)} · SG ${fmt(f.sg)} · ${f.on}/${f.units} units · cap ${fmt(f.cap)}</span></div>`).join('')}</div>`;
}

function gdTableHtml(g) {
  const rows = g.stations.map((s, i) => ({i, s, cap: s.blocks.reduce((t, b) => t + (b.cap || 0), 0), dc: s.totals.dc, sg: s.totals.sg, gen: s.totals.gen,
    dev: s.blocks.some(b => b.deviation !== null) ? s.blocks.reduce((t, b) => t + (b.deviation || 0), 0) : null}));
  const tot = {cap: rows.reduce((t, r) => t + r.cap, 0), dc: g.totals.dc, sg: g.totals.sg, gen: g.totals.gen, dev: g.totals.deviation};
  const load = (gen, cap, c) => cap ? `${fmt(gen / cap * 100, 0)}%<span class="gload"><i style="width:${Math.min(100, gen / cap * 100)}%;background:${c}"></i></span>` : '—';
  const dev = v => v === null || v === undefined ? '—' : `<span class="${v > 0 ? 'pos' : v < 0 ? 'neg' : ''}">${v > 0 ? '+' : v < 0 ? '−' : ''}${fmt(Math.abs(v))}</span>`;
  return `<div style="overflow-x:auto"><table class="gt num"><tr><th>Station</th><th>Cap</th><th>DC</th><th>SG</th><th>Gen</th><th>Gen−SG</th><th>Load</th></tr>
    ${rows.map(r => `<tr data-gst="${r.i}"><td><i style="background:${FUEL_COLOR[r.s.fuel]}"></i>${esc(r.s.station.replace(/ (TPS|GBPS|Hydro)$/, ' $1'))}</td><td>${r.cap ? fmt(r.cap) : '—'}</td><td>${mwTxt(r.dc)}</td><td>${mwTxt(r.sg)}</td><td><b>${fmt(r.gen)}</b></td><td>${dev(r.dev)}</td><td>${load(r.gen, r.cap, FUEL_COLOR[r.s.fuel])}</td></tr>`).join('')}
    <tr class="tot"><td>GSECL</td><td>${fmt(tot.cap)}</td><td>${mwTxt(tot.dc)}</td><td>${mwTxt(tot.sg)}</td><td>${fmt(tot.gen)}</td><td>${dev(tot.dev)}</td><td>${load(tot.gen, tot.cap, 'var(--accent)')}</td></tr></table></div>
    <div class="note-src">MW. Cap = installed (SLDC) · DC = declared capability · SG = SLDC schedule · Load = generation ÷ installed. Touch a station for its blocks and units.</div>
    ${csvBtn('gdTable', 'GSECL_station_position', ['Station', 'Fuel', 'Installed MW', 'DC MW', 'SG MW', 'Generation MW', 'Gen-SG MW', 'Loading %'],
      rows.map(r => [r.s.station, r.s.fuel, r.cap || null, r.dc, r.sg, r.gen, r.dev, r.cap ? +(r.gen / r.cap * 100).toFixed(1) : null]))}`;
}

function gdUnitsHtml(g) {
  let on = 0, all = 0;
  const h = g.stations.map(s => {
    const units = s.blocks.flatMap(b => b.units);
    const run = units.filter(u => (u.mw ?? 0) > RUN_MW).length; on += run; all += units.length;
    return `<div class="gub"><div class="h">${esc(s.station)}<span>${run}/${units.length} on bar · ${fmt(s.totals.gen)} MW</span></div><div class="gtiles">${units.map(u => {
      const st = unitState(u), running = (u.mw ?? 0) > RUN_MW, colour = st.type === 'Running' ? FUEL_COLOR[s.fuel] : st.type && st.type !== 'Off' ? TYPE_COLOR[st.type] : null;
      return `<div class="gtile2 ${colour ? '' : 'off'}" style="${colour ? '--c:' + colour : ''}" title="${esc(u.label)}"><b class="num">${running ? fmt(u.mw) : st.type && st.type !== 'Running' && st.type !== 'Off' ? esc(st.type) : '0'}</b>${esc(u.label.replace(/^Unit /, 'U-').replace(/ · .*$/, ''))}</div>`;
    }).join('')}</div></div>`;
  }).join('');
  $('gdUnitsNote').textContent = `${on} of ${all} units on bar`;
  return h + `<div class="keyline"><span><i style="width:12px;height:10px;border-radius:3px;background:var(--coal)"></i>Running (fuel colour, MW)</span><span><i style="width:12px;height:10px;border-radius:3px;background:var(--forced)"></i>Forced</span><span><i style="width:12px;height:10px;border-radius:3px;background:var(--planned)"></i>Planned</span><span><i style="width:12px;height:10px;border-radius:3px;background:var(--rsd)"></i>RSD</span><span><i style="width:12px;height:10px;border-radius:3px;border:1px dashed var(--muted)"></i>Off</span></div>`;
}

function gdGridHtml(g) {
  const h = S.home?.ok ? S.home : null, f = h?.freq?.value, cat = h?.catered?.value, mix = h?.mix || {};
  const P = S.iex?.ok ? S.iex : null, rtm = P && P.rtmIdx !== null && P.rtm ? P.rtm[P.rtmIdx] : null;
  const re = (mix.solar || 0) + (mix.wind || 0);
  return `<div class="tstats" style="grid-template-columns:repeat(3,1fr);margin:0">
    <div><span>Frequency</span><b class="num ${f && (f < 49.9 || f > 50.05) ? 'neg' : ''}">${f ? fmt(f, 2) : '—'}</b><small>Hz · band 49.90–50.05</small></div>
    <div><span>Gujarat catered</span><b class="num">${cat ? fmt(cat) : '—'}</b><small>MW</small></div>
    <div><span>GSECL share</span><b class="num">${cat && g?.ok ? fmt(g.totals.gen / cat * 100, 1) + '%' : '—'}</b><small>of catered</small></div>
    <div><span>Solar + wind</span><b class="num">${re ? fmt(re) : '—'}</b><small>MW in Gujarat</small></div>
    <div><span>Gujarat total gen</span><b class="num">${mix.total ? fmt(mix.total) : '—'}</b><small>MW</small></div>
    <div><span>IEX RTM now</span><b class="num">${rtm !== null && rtm !== undefined ? '₹' + fmt(rtm / 1000, 2) : '—'}</b><small>per unit</small></div></div>`;
}

// ---------------------------------------------------------------- PAF and fixed cost by PPA group (CERC formulas)

/**
 * PAF now = declared capacity (ex-bus) ÷ [installed × (1 − normative aux)], live from the DC in the GSECL feed;
 * day / MTD / YTD and the AFC to date come from the GSECL Connect service (paf_report), which keeps the daily values.
 */
let gdPafHist = {at: 0, busy: false, data: null, err: ''};
async function gdPafLoad() {
  if (gdPafHist.busy || Date.now() - gdPafHist.at < 10 * 60e3 || typeof conCall !== 'function' || typeof hasConnect !== 'function' || !hasConnect()) return;
  gdPafHist.busy = true;
  try {
    const r = await conCall('paf_report', {date: isoDay(Date.now())});
    gdPafHist.at = Date.now();
    if (r.ok) { gdPafHist.data = r.data; gdPafHist.err = ''; try { Connect.cacheSet('paf_card', JSON.stringify(r.data)); } catch (e) { /* no copy */ } }
    else gdPafHist.err = r.error;
  } catch (e) { gdPafHist.err = String(e.message || e); gdPafHist.at = Date.now(); }
  gdPafHist.busy = false;
  if (S.gsecl?.ok) $('gdPaf').innerHTML = gdPafHtml(S.gsecl);
}
function gdPafHtml(g) {
  setTimeout(gdPafLoad, 0);
  if (!gdPafHist.data && typeof conSaved === 'function') { const c = conSaved('paf_card'); if (c) gdPafHist.data = c.data; }
  const d = gdPafHist.data, head = '<h2>Plant availability (PAF) &amp; fixed cost <span class="more" data-pafgo="1" style="cursor:pointer">Statement ›</span></h2>';
  if (!d) return head + `<div class="empty">${gdPafHist.err ? esc(gdPafHist.err) : (typeof hasConnect === 'function' && hasConnect()) ? 'Reading the PAF statement…' : 'Sign in to GSECL Connect for PAF and fixed cost.'}</div>`;
  const blk = {}; g.stations.forEach(s => s.blocks.forEach(b => { blk[b.key] = b; }));
  const pc = v => v === null || v === undefined ? '—' : fmt(v, 1) + '%';
  // Units on reserve shutdown count as available (the feed declares 0 DC for them); hydro = installed less units out.
  const outRowsNow = S.outages?.ok ? (S.outages.rows || []) : null;
  const live = d.rows.map(r => {
    const bs = (r.blocks || []).map(k => blk[k]), ok = k => bs.length && bs.every(b => b && b[k] !== null && b[k] !== undefined);
    const k = 1 - r.aux / 100, ex = r.ic * k;
    let re = null; try { re = r.unit_re ? new RegExp(r.unit_re, 'i') : null; } catch (e) { re = null; }
    const mine = outRowsNow && re ? outRowsNow.filter(o => re.test(String(o.unit || '').toUpperCase().replace(/\s+/g, ' ').trim())) : [];
    const rsd = mine.filter(o => o.type === 'RSD').reduce((t, o) => t + (parseFloat(o.cap) || 0), 0), down = mine.filter(o => o.type !== 'RSD').reduce((t, o) => t + (parseFloat(o.cap) || 0), 0);
    let dc = ok('dc') ? bs.reduce((t, b) => t + b.dc, 0) : null;
    if (r.category === 'HYDRO' && outRowsNow) dc = Math.max(0, r.ic - down) * k;
    else if (dc !== null && outRowsNow) dc = Math.min(dc + rsd * k, Math.max(Math.max(0, r.ic - down) * k, dc));
    return Object.assign({}, r, {now: dc !== null && ex ? dc * 100 / ex : null, plfNow: ok('sg') && ex ? bs.reduce((t, b) => t + b.sg, 0) * 100 / ex : null});
  });
  const w = (l, k) => { const x = l.filter(r => r[k] !== null && r[k] !== undefined), c = x.reduce((t, r) => t + r.ic, 0); return c ? x.reduce((t, r) => t + r[k] * r.ic, 0) / c : null; };
  const T = d.totals.find(t => t.group === 'TOTAL (GSECL)') || {}, nowAll = w(live, 'now'), plfAll = w(live, 'plfNow');
  const col = (v, t) => v === null || v === undefined ? '' : v >= t ? 'color:var(--run)' : 'color:var(--forced)';
  return head + `<div class="tstats" style="grid-template-columns:repeat(4,1fr)">
      <div><span>PAF now</span><b class="num" style="${col(nowAll, T.target_paf)}">${pc(nowAll)}</b><small>PLF now ${pc(plfAll)}</small></div>
      <div><span>MTD</span><b class="num" style="${col(T.mtd, T.target_paf)}">${pc(T.mtd)}</b><small>day ${pc(T.daily)}</small></div>
      <div><span>YTD</span><b class="num" style="${col(T.ytd, T.target_paf)}">${pc(T.ytd)}</b><small>target ${pc(T.target_paf)}</small></div>
      <div><span>AFC loss</span><b class="num neg">${T.afc_loss === null || T.afc_loss === undefined ? '—' : '₹' + fmt(-T.afc_loss, 1) + ' Cr'}</b><small>${T.afc_loss === null || T.afc_loss === undefined ? 'needs past daily PAF' : 'of ₹' + fmt(T.afc_target || 0, 0) + ' Cr to date'}</small></div></div>
    ${(d.missing_days || []).length ? `<div class="note-src" style="color:#b45309">YTD covers only the days with data so far; load the past daily PAF (Sheet tab PafImport) for the YTD and AFC loss of the statement.</div>` : ''}
    <div style="overflow-x:auto"><table class="gt num"><tr><th>PPA group</th><th>Now</th><th>Day</th><th>MTD</th><th>YTD</th><th>Target</th><th>AFC loss ₹ Cr</th></tr>
      ${live.map(r => `<tr data-pafgo="1" style="cursor:pointer"><td>${esc(r.group)}</td><td style="${col(r.now, r.target_paf)}">${pc(r.now)}</td><td>${pc(r.daily)}</td><td>${pc(r.mtd)}</td><td style="${col(r.ytd, r.target_paf)}"><b>${pc(r.ytd)}</b></td><td>${pc(r.target_paf)}</td><td style="${r.afc_loss < 0 ? 'color:var(--forced)' : ''}">${r.afc_loss === null || r.afc_loss === undefined ? '—' : fmt(r.afc_loss, 2)}</td></tr>`).join('')}
      <tr class="tot"><td>GSECL</td><td>${pc(nowAll)}</td><td>${pc(T.daily)}</td><td>${pc(T.mtd)}</td><td>${pc(T.ytd)}</td><td>${pc(T.target_paf)}</td><td>${T.afc_loss === undefined ? '—' : fmt(T.afc_loss, 2)}</td></tr></table></div>
    <div class="note-src">PAF = declared capacity ex-bus ÷ [installed × (1 − normative aux)] (CERC Tariff Regulations 2024); "now" from the DC in the GSECL feed, day / MTD / YTD from the stored daily values. PLF = schedule ex-bus on the same base. Touch for the full AFC recovery statement.</div>`;
}
document.addEventListener('click', e => {
  if (!e.target.closest('[data-pafgo]')) return;
  if (typeof conOpenTab !== 'function' || typeof wOpen !== 'function') return;
  show('connect'); conOpenTab('more'); wOpen('pafafc');
});

function gdRender() {
  const g = S.gsecl;
  if (!g) return;
  if (!g.ok) { $('gdHero').innerHTML = `<div class="alert err">${esc(g.error)}</div>`; return; }
  $('gdHero').innerHTML = gdHeroHtml(g);
  $('gdToday').innerHTML = gdTodayHtml();
  $('gdFuel').innerHTML = gdFuelHtml(g);
  $('gdPaf').innerHTML = gdPafHtml(g);
  $('gdTable').innerHTML = gdTableHtml(g);
  $('gdUnits').innerHTML = gdUnitsHtml(g);
  $('gdGrid').innerHTML = gdGridHtml(g);
}
document.addEventListener('click', e => {
  const r = e.target.closest('[data-gst]');
  if (r) { S.open.add(+r.dataset.gst); show('stations'); setTimeout(() => { const el = $('st-' + r.dataset.gst); if (el) el.scrollIntoView({behavior: 'smooth', block: 'start'}); }, 50); return; }
  const f = e.target.closest('.gf[data-fuel]');
  if (f) { S.fuel = f.dataset.fuel; show('stations'); }
});

function renderHome() {
  const g = S.gsecl;
  gdRender();
  if (g?.ok) {
    renderMix(g);

  }

  const o = S.outages;
  if (o?.ok) {
    const gs = o.rows;
    const by = t => gs.filter(r => r.type === t);
    const capOf = rs => rs.reduce((s, r) => s + (parseFloat(r.cap) || 0), 0);
    $('outCounts').innerHTML = ['Forced', 'Planned', 'RSD'].map(t =>
      `<div class="oc ${t}" data-type="${t}"><b class="num">${by(t).length}</b><span>${t} · ${fmt(capOf(by(t)))} MW</span></div>`).join('');
    const recent = [...gs].sort((a, b) => dateKey(b.since) - dateKey(a.since)).slice(0, 3);
    ($('outRecent') || {}).innerHTML = `<div class="muted" style="font-size:12px;margin:12px 0 2px">Latest outages · as of ${esc(o.as_of || o.fetched_at)}</div>` +
      recent.map(r => `<div class="unit"><span class="sd" style="background:${TYPE_COLOR[r.type]}"></span>
        <div class="ub"><div class="un">${esc(r.unit)} ${badge(r.type)}</div><div class="od">${outDetail(r)}</div></div>
        <div class="um num">${esc(r.cap || '')}<small> MW</small></div></div>`).join('');
    const n = gs.length;
    $('navCnt').hidden = !n; $('navCnt').textContent = n;
  } else if (o) {
    $('outCounts').innerHTML = `<div class="muted" style="grid-column:1/-1">${esc(o.error)}</div>`;
    ($('outRecent') || {}).innerHTML = '';
  }
}

function dateKey(s) {
  const m = String(s || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\s*(\d{1,2})?:?(\d{2})?/);
  return m ? Date.UTC(+m[3], m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0)) : 0;
}

// ---------------------------------------------------------------- stations

function renderStations() {
  const g = S.gsecl;
  const fuels = g?.ok ? Object.keys(g.by_fuel) : [];
  $('fuelChips').innerHTML = ['', ...fuels].map(f => `<button class="chip ${S.fuel === f ? 'on' : ''}" data-fuel="${esc(f)}">
      ${f ? `<span class="sw" style="background:${FUEL_COLOR[f]}"></span>${esc(f)}` : 'All stations'}</button>`).join('');
  if (!g) { $('stationList').innerHTML = '<div class="sk" style="height:300px"></div>'; return; }
  if (!g.ok) { $('stationList').innerHTML = `<div class="alert err">${esc(g.error)}</div>`; return; }

  let html = '';
  g.stations.forEach((s, i) => {
    if (S.fuel && s.fuel !== S.fuel) return;
    const t = s.totals;
    html += `<div class="st ${S.open.has(i) ? 'open' : ''}" id="st-${i}" style="--c:${FUEL_COLOR[s.fuel]}">
      <div class="st-h" data-toggle="${i}">
        <div><div class="nm">${esc(s.station)}</div><div class="fu">${esc(s.fuel)} · ${s.blocks.length} PPA block${s.blocks.length > 1 ? 's' : ''}</div></div>
        <div class="rt"><b class="num">${fmt(t.gen)} MW</b><span class="num">SG ${fmt(t.sg)} · DC ${fmt(t.dc)}</span></div>
        <svg class="chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="m6 9 6 6 6-6"/></svg>
      </div><div class="st-b"><div class="utr" id="utr-${i}"></div>`;
    for (const b of s.blocks) {
      html += `<div class="blk"><div class="blk-h">${esc(b.label)}<span>${b.dc ? Math.round((b.gen || 0) / b.dc * 100) + '% of DC' : ''}</span></div>
        <div class="blk-sub num">${b.cap ? `Capacity ${fmt(b.cap)} MW · ${Math.round(Math.max(b.gen || 0, 0) / b.cap * 100)}% loading` : ''}
          ${b.sgSrc ? `<span class="src-tag ${b.sgSrc === 'SLDC' ? '' : 'warn'}">SG: ${esc(b.sgSrc)}</span>` : ''}
          ${b.genSrc === 'SLDC' ? '<span class="src-tag warn">Gen: SLDC total</span>' : ''}</div>
        ${b.noDc ? `<div class="blk-ref">${esc(b.noDc)}</div>` : ''}
        <div class="blk-ref num">${b.merit ? 'Variable cost ' + b.merit.map(m => `<b>₹${fmt(m.cost, 2)}</b>/kWh${m.note ? ' (' + esc(m.note) + ')' : ''} · merit #${m.rank}`).join('; ') + rateChange(b.key) : 'Variable cost: not in SLDC merit order'}</div>
        <div class="blk-ref num">${b.techMinNote ? esc(b.techMinNote) + ' — SLDC list'
          : b.techMinOnBar !== null ? `Tech-min of units on bar: <b>${fmt(b.techMinOnBar, 1)} MW</b>${b.techMinComplete ? '' : ' (some units not listed)'} — SLDC list`
          : b.units.some(u => u.techMin !== null) ? 'Tech-min: no unit on bar' : 'Tech-min: not in SLDC list'}</div>
        <div class="nums num"><div><span>Gen</span><b>${mwTxt(b.gen)}</b></div><div><span>SG</span><b>${mwTxt(b.sg)}</b></div>
        <div><span>DC</span><b>${mwTxt(b.dc)}</b></div><div><span>Gen−SG</span><b>${devTxt(b.deviation)}</b></div></div>`;
      for (const u of b.units) {
        const st = unitState(u);
        html += `<div class="unit"><span class="sd" style="background:${st.color}"></span>
          <div class="ub"><div class="un">${esc(u.label)}<small>${esc(u.key)}</small> ${st.type ? badge(st.type) : '<span class="na" style="font-size:12px">not in feed</span>'}</div>
          ${st.outs.map(o => `<div class="od">${outDetail(o)}</div>`).join('')}</div>
          <div class="um num">${mwTxt(u.mw)}<small> MW</small>${u.techMin !== null ? `<span class="tm">TM ${fmt(u.techMin, 1)}</span>` : ''}</div></div>`;
      }
      for (const o of outRows('blocks', b.key))
        html += `<div class="unit"><span class="sd" style="background:${TYPE_COLOR[o.type]}"></span>
          <div class="ub"><div class="un">${esc(o.unit)}<small>SLDC</small> ${badge(o.type)}</div><div class="od">${outDetail(o)}</div></div>
          <div class="um num">${esc(o.cap || '')}<small> MW cap</small></div></div>`;
      html += '</div>';
    }
    html += '</div></div>';
  });
  $('stationList').innerHTML = html;
  S.open.forEach(i => renderUnitTrend(i));
}

// ---------------------------------------------------------------- outages

function renderOutages() {
  const o = S.outages;
  if (!o) { $('outList').innerHTML = '<div class="sk" style="height:110px;margin-bottom:10px"></div>'.repeat(3); $('typeChips').innerHTML = ''; return; }
  if (!o.ok) { $('outList').innerHTML = `<div class="alert err">${esc(o.error)}</div>`; $('typeChips').innerHTML = ''; return; }

  const inSector = o.rows.map((r, i) => ({...r, i}));
  const types = ['Forced', 'Planned', 'RSD', 'Outage'].filter(t => inSector.some(r => r.type === t));
  if (S.type && !types.includes(S.type)) S.type = '';
  $('typeChips').innerHTML = [['', `All · ${inSector.length}`], ...types.map(t => [t, `${t} · ${inSector.filter(r => r.type === t).length}`])]
    .map(([t, l]) => `<button class="chip ${S.type === t ? 'on' : ''}" data-type="${t}">${t ? `<span class="sw" style="background:${TYPE_COLOR[t]}"></span>` : ''}${esc(l)}</button>`).join('');

  const q = S.q.toLowerCase();
  const rows = inSector.filter(r => (!S.type || r.type === S.type) && (!q || `${r.unit} ${r.reason}`.toLowerCase().includes(q)))
    .sort((a, b) => dateKey(b.since) - dateKey(a.since));   // latest outage first
  // Current MW of the matched feed unit, for GSECL rows.
  const liveMw = {};
  if (S.gsecl?.ok) for (const s of S.gsecl.stations) for (const b of s.blocks) for (const u of b.units) liveMw[u.key] = u.mw;
  const unitFor = {};
  for (const [k, ix] of Object.entries(o.match.units)) for (const i of ix) unitFor[i] = k;

  const notes = [];
  if (o.synced?.length) notes.push(`Not shown, generating now: ${o.synced.map(r => `<b>${esc(r.unit)}</b> ${fmt(r.mw)} MW`).join(', ')} (SLDC still lists ${o.synced.length === 1 ? 'it' : 'them'}).`);
  if (o.duplicates) notes.push(`SLDC lists ${o.duplicates} older row${o.duplicates === 1 ? '' : 's'} for units listed again; only each unit's latest outage is shown.`);
  $('outList').innerHTML = (notes.length ? `<div class="note-src" style="margin:0 4px 10px">${notes.join(' ')}</div>` : '') + (rows.length ? rows.map(r => `<div class="oq" style="--oc:${TYPE_COLOR[r.type]}">
      <div class="oq-h"><span class="nm">${esc(r.unit)}</span>${badge(r.type)}<span class="cap num">${esc(r.cap || '—')}<small> MW</small></span></div>
      <div class="meta num">
        <div><span>Out since</span>${esc(r.since || '—')}</div><div><span>Expected back</span>${esc(r.revised || r.schedule || '—')}</div>
        <div><span>Forced / Plan MW</span>${esc(r.force || '–')} / ${esc(r.plan || '–')}</div><div><span>Available MW</span>${esc(r.available || '–')}</div>
      </div>
      ${r.reason ? `<div class="rs">${esc(r.reason)}</div>` : ''}
      ${unitFor[r.i] && unitFor[r.i] in liveMw ? `<div class="live">GSECL feed now: <b>${mwTxt(liveMw[unitFor[r.i]])} MW</b> (${esc(unitFor[r.i])})</div>` : ''}
      ${r.older ? `<div class="live">Latest of ${r.older + 1} SLDC rows for this unit</div>` : ''}
    </div>`).join('') : '<div class="card muted">No outages match.</div>')
    + csvBtn('outSldc', 'GSECL_SLDC_outages', ['Unit', 'Type', 'Capacity MW', 'Out since', 'Expected back', 'Forced MW', 'Planned MW', 'Available MW', 'Reason'],
      rows.map(r => [r.unit, r.type, r.cap, r.since, r.revised || r.schedule, r.force, r.plan, r.available, r.reason]));
}

// ---------------------------------------------------------------- info

function renderInfo() {
  renderSettings();
  if (typeof tsRender === 'function' && !$('twoStep').dataset.done) tsRender();
  renderAlertBadge();
  renderNotify();
  if (!hasNative('historyInfo')) { $('histInfo').textContent = 'Not available.'; return; }
  const [n, first, bytes] = Native.historyInfo().split(',').map(Number);
  $('histInfo').innerHTML = n
    ? `<b class="num" style="color:var(--ink)">${fmt(n)}</b> readings since ${esc(tFmt(first, true))} · ${fmt(bytes / 1024)} KB on this phone. Older than 90 days is removed automatically.`
    : 'No readings stored yet.';
}

// ---------------------------------------------------------------- trends (stored on the phone)

const METRICS = {
  freq:    {label: 'Grid frequency', unit: 'Hz', col: 1, dp: 3},
  catered: {label: 'Gujarat catered', unit: 'MW', col: 2, dp: 0},
  gen:     {label: 'GSECL generation', unit: 'MW', col: 3, dp: 0},
  guj:     {label: 'Gujarat generation without solar and wind', unit: 'MW', col: 8, dp: 0},
};
/** Gujarat generation without solar and wind = SLDC's "Gujarat total generation with RE" − solar − wind. */
const gujConv = r => (r[8] === null || r[6] === null ? null : r[8] - r[6] - (r[7] ?? 0));
const RANGES = [['1 h', 1], ['3 h', 3], ['6 h', 6], ['24 h', 24], ['7 d', 168], ['30 d', 720], ['90 d', 2160], ['Custom', 'custom']];
/** The period shown: the last S.range hours, or the custom from / to. */
function trendWindow() {
  if (S.range === 'custom' && S.cFrom && S.cTo > S.cFrom) return {t0: S.cFrom, t1: S.cTo, long: S.cTo - S.cFrom > 26 * 3600e3};
  const h = +S.range || 24;
  return {t0: Date.now() - h * 3600e3, t1: Date.now(), long: h > 24};
}
const hasNative = n => typeof window.Native !== 'undefined' && typeof window.Native[n] === 'function';
let trendRows = null, trendKey = '';

/**
 * Called after each SLDC summary refresh. Frequency, catered, GSECL total, Gujarat solar and wind come from
 * SLDC's summary; GSECL thermal and hydro from SLDC's station-wise data read with the dashboard (if recent).
 * The background monitor records the same values from the same sources.
 */
function recordSample() {
  const h = S.home;
  if (!h?.ok) return;
  const f = S.gsecl?.rt_fuel && Date.now() - S.gsecl.rt_fuel.at < 6 * 60e3 ? S.gsecl.rt_fuel : null;
  const v = x => (x === null || x === undefined || !isFinite(x) ? '' : String(x));
  const ok = hasNative('historyAppend2')
    ? (hasNative('historyAppend3') ? Native.historyAppend3(v(h.freq?.value), v(h.catered?.value), v(h.mix?.gsecl), v(f?.thermal), v(f?.hydro), v(h.mix?.solar), v(h.mix?.wind), v(h.mix?.total))
      : Native.historyAppend2(v(h.freq?.value), v(h.catered?.value), v(h.mix?.gsecl), v(f?.thermal), v(f?.hydro), v(h.mix?.solar), v(h.mix?.wind)))
    : hasNative('historyAppend') && Native.historyAppend(v(h.freq?.value), v(h.catered?.value), v(h.mix?.gsecl));
  if (ok) trendKey = '';
}

/** GSECL generation shown in the trend: all, thermal (coal + lignite + gas), or thermal + hydro. */
const GEN_BASIS = {all: ['All GSECL', r => r[3]], thermal: ['Thermal', r => r[4]], th_hy: ['Thermal + Hydro', r => (r[4] === null ? null : r[4] + (r[5] ?? 0))]};
/** Series of the comparison trend: [key, label, column, colour]. One MW axis: all are generation in MW. */
const MIX_SERIES = [['thermal', 'GSECL thermal', 4, 'var(--s2)'], ['hydro', 'GSECL hydro', 5, 'var(--s1)'], ['solar', 'Gujarat solar', 6, 'var(--s4)'], ['wind', 'Gujarat wind', 7, 'var(--s3)'],
  ['gujconv', 'Gujarat without RE', r => gujConv(r), 'var(--s5)']];
/** A series' value in a reading: a column, or a figure worked out from several. */
const mixVal = (r, col) => (typeof col === 'function' ? col(r) : r[col]);
const COLS = ['Time', 'Frequency (Hz)', 'Gujarat catered (MW)', 'GSECL total (MW)', 'GSECL thermal (MW)', 'GSECL hydro (MW)', 'Gujarat solar (MW)', 'Gujarat wind (MW)', 'Gujarat total generation (MW)', 'Gujarat without solar and wind (MW)'];
const parseRows = csv => csv.split('\n').filter(Boolean).map(l => l.split(',')).map(a => [+a[0], ...[1, 2, 3, 4, 5, 6, 7, 8].map(i => (a[i] === undefined || a[i] === '' ? null : +a[i]))]);

function trendData() {
  const {t0: since, t1: until} = trendWindow();
  const key = S.range === 'custom' ? `c${S.cFrom}-${S.cTo}` : S.range + '';
  if (trendKey !== key || !trendRows) {
    trendRows = parseRows(hasNative('historyRead') ? Native.historyRead(String(since)) : '');
    trendKey = key;
  }
  trendRows = trendRows.filter(r => r[0] <= until || S.range !== 'custom');
  if (!METRICS[S.metric]) return [];                                 // the comparison chart reads trendRows itself
  const val = S.metric === 'gen' ? GEN_BASIS[S.genBasis || 'all'][1] : S.metric === 'guj' ? gujConv : (r => r[METRICS[S.metric].col]);
  return trendRows.filter(r => r[0] >= since && r[0] <= until).map(r => ({t: r[0], v: val(r)})).filter(p => p.v !== null && isFinite(p.v));
}

const tFmt = (t, withDate) => {
  const d = new Date(t), p = n => String(n).padStart(2, '0');
  const hm = p(d.getHours()) + ':' + p(d.getMinutes());
  return withDate ? p(d.getDate()) + '/' + p(d.getMonth() + 1) + ' ' + hm : hm;
};

function niceTicks(lo, hi, n) {
  const span = hi - lo || 1, raw = span / n, mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map(s => s * mag).find(s => span / s <= n) || 10 * mag;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(+v.toFixed(6));
  return out;
}

function renderTrends() {
  document.querySelectorAll('#trendMetric button').forEach(b => b.classList.toggle('on', b.dataset.metric === S.metric));
  $('trendRange').innerHTML = RANGES.map(([l, h]) => `<button class="chip ${S.range === h ? 'on' : ''}" data-range="${h}">${l}</button>`).join('');
  $('trendCustom').hidden = S.range !== 'custom';
  if (S.range === 'custom') {
    const loc = t => { const d = new Date(t - new Date(t).getTimezoneOffset() * 60e3); return d.toISOString().slice(0, 16); };
    if (!S.cFrom) { S.cTo = Date.now(); S.cFrom = S.cTo - 48 * 3600e3; }
    if (document.activeElement !== $('tcFrom')) $('tcFrom').value = loc(S.cFrom);
    if (document.activeElement !== $('tcTo')) $('tcTo').value = loc(S.cTo);
  }
  $('trendBasis').hidden = S.metric !== 'gen' && S.metric !== 'mix';
  $('trendBasis').innerHTML = S.metric === 'gen'
    ? Object.entries(GEN_BASIS).map(([k, [l]]) => `<button class="chip ${(S.genBasis || 'all') === k ? 'on' : ''}" data-gbasis="${k}" style="padding:5px 12px">${l}</button>`).join('')
    : MIX_SERIES.map(([k, l, , c]) => `<button class="chip ${mixOn().includes(k) ? 'on' : ''}" data-mixs="${k}" style="padding:5px 12px"><span class="sw" style="background:${c}"></span>${l}</button>`).join('');
  $('trendKey').innerHTML = '';
  renderTrendBg();
  if (S.metric === 'mix') return renderMixTrend();
  const m = S.metric === 'gen' ? {...METRICS.gen, label: 'GSECL ' + GEN_BASIS[S.genBasis || 'all'][0].replace('All GSECL', 'generation').toLowerCase()} : METRICS[S.metric];
  const pts = trendData();
  const box = $('trendChart');
  $('trendNote').textContent = `${pts.length} readings`;
  if (pts.length < 2) {
    $('trendStats').innerHTML = '';
    box.innerHTML = `<div class="empty">No ${esc(m.label.toLowerCase())} history for this period yet.<br>The app records a reading every minute while open and about every 15 minutes in the background.</div>`;
    return;
  }
  // Stats on the raw readings.
  let mn = pts[0], mx = pts[0], sum = 0;
  for (const p of pts) { if (p.v < mn.v) mn = p; if (p.v > mx.v) mx = p; sum += p.v; }
  const last = pts[pts.length - 1], {long} = trendWindow();
  $('trendStats').innerHTML = [['Now', last], ['Min', mn], ['Max', mx]].map(([l, p]) =>
    `<div><span>${l}</span><b>${fmt(p.v, m.dp)}</b><small>${tFmt(p.t, long)}</small></div>`).join('') +
    `<div><span>Average</span><b>${fmt(sum / pts.length, m.dp)}</b><small>${esc(m.unit)}</small></div>`;

  // Downsample to ~1 point per 2 px by time-bucket averaging.
  const W = Math.max(box.clientWidth || 320, 240), H = 190, L = 46, R = 10, T = 10, B = 24;
  const {t0, t1} = trendWindow();
  const nb = Math.floor((W - L - R) / 2), bw = (t1 - t0) / nb, buckets = new Map();
  for (const p of pts) {
    const k = Math.min(nb - 1, Math.floor((p.t - t0) / bw));
    const b = buckets.get(k) || {t: 0, v: 0, n: 0};
    b.t += p.t; b.v += p.v; b.n++; buckets.set(k, b);
  }
  const ds = [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([k, b]) => ({k, t: b.t / b.n, v: b.v / b.n}));

  let lo = mn.v, hi = mx.v;
  if (S.metric === 'freq') { lo = Math.min(lo, 49.9); hi = Math.max(hi, 50.05); }
  const padY = (hi - lo) * 0.08 || (S.metric === 'freq' ? 0.02 : 10);
  lo -= padY; hi += padY;
  const x = t => L + (t - t0) / (t1 - t0) * (W - L - R);
  const y = v => T + (hi - v) / (hi - lo) * (H - T - B);

  // Break the line where readings are missing for more than ~3 sample intervals (min 20 min).
  const gapMs = Math.max(20 * 60e3, bw * 3);
  let d = '', area = '', seg = [];
  const flush = () => {
    if (seg.length) {
      d += 'M' + seg.map(p => x(p.t).toFixed(1) + ',' + y(p.v).toFixed(1)).join('L');
      area += `M${x(seg[0].t).toFixed(1)},${H - B}L` + seg.map(p => x(p.t).toFixed(1) + ',' + y(p.v).toFixed(1)).join('L') + `L${x(seg[seg.length - 1].t).toFixed(1)},${H - B}Z`;
    }
    seg = [];
  };
  ds.forEach((p, i) => { if (i && p.t - ds[i - 1].t > gapMs) flush(); seg.push(p); });
  flush();

  const yt = niceTicks(lo, hi, 4);
  const xt = Array.from({length: 5}, (_, i) => t0 + (t1 - t0) * i / 4);
  const band = S.metric === 'freq'
    ? `<rect x="${L}" y="${y(50.05)}" width="${W - L - R}" height="${y(49.9) - y(50.05)}" fill="rgba(22,163,74,.10)"/>
       <text class="ax" x="${W - R - 4}" y="${y(50.05) + 12}" text-anchor="end" style="fill:var(--pos);paint-order:stroke;stroke:var(--card);stroke-width:3px">Normal band 49.90–50.05</text>` : '';
  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="${esc(m.label)} trend">
    <defs><linearGradient id="ag" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--brand)" stop-opacity=".22"/><stop offset="1" style="stop-color:var(--brand)" stop-opacity="0"/></linearGradient></defs>
    ${yt.map(v => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${L - 6}" y="${y(v) + 3.5}" text-anchor="end">${fmt(v, S.metric === 'freq' ? 2 : 0)}</text>`).join('')}
    ${band}
    ${xt.map((t, i) => `<text class="ax" x="${x(t)}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : i === 4 ? 'end' : 'middle'}">${tFmt(t, long)}</text>`).join('')}
    ${S.metric === 'freq' ? '' : `<path d="${area}" fill="url(#ag)"/>`}
    <path d="${d}" fill="none" style="stroke:var(--brand)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    <g id="cross" style="display:none"><line id="cx" y1="${T}" y2="${H - B}" stroke="var(--ink)" stroke-width="1" stroke-dasharray="3 3"/>
      <circle id="cd" r="5" style="fill:var(--brand);stroke:var(--card)" stroke-width="2"/></g>
  </svg><div class="tip" id="tip" style="display:none"></div>`;

  // Crosshair + tooltip: drag or tap anywhere on the chart.
  const svg = box.querySelector('svg'), tip = $('tip'), cross = $('cross');
  const at = ev => {
    const r = svg.getBoundingClientRect(), px = (ev.clientX - r.left) * W / r.width;
    const t = t0 + (px - L) / (W - L - R) * (t1 - t0);
    let best = ds[0];
    for (const p of ds) if (Math.abs(p.t - t) < Math.abs(best.t - t)) best = p;
    const bx = x(best.t), by = y(best.v);
    cross.style.display = '';
    $('cx').setAttribute('x1', bx); $('cx').setAttribute('x2', bx);
    $('cd').setAttribute('cx', bx); $('cd').setAttribute('cy', by);
    tip.style.display = '';
    tip.innerHTML = `<b>${fmt(best.v, m.dp)} ${esc(m.unit)}</b> · ${tFmt(best.t, true)}`;
    const left = bx / W * r.width;
    tip.style.left = Math.min(Math.max(left, 70), r.width - 70) + 'px';
  };
  svg.addEventListener('pointerdown', at);
  svg.addEventListener('pointermove', at);
  // On touch the tooltip stays after lifting the finger; only a mouse leaving the chart hides it.
  svg.addEventListener('pointerleave', ev => { if (ev.pointerType === 'mouse') { cross.style.display = 'none'; tip.style.display = 'none'; } });
}

// ---------------------------------------------------------------- unit-wise generation of a station (Stations)

const UT_RANGES = [['6 h', 6], ['24 h', 24], ['3 d', 72], ['7 d', 168], ['30 d', 720], ['Custom', 'custom']];

/** Lines over time on one MW axis: series [{label, colour, pts: [{t, v}]}]. Returns the SVG + tip markup and wires the touch. */
function timeLines(box, series, t0, t1, o = {}) {
  const W = Math.max(box.clientWidth || 300, 240), H = o.h || 180, L = 46, R = 8, T = 8, B = 22, long = t1 - t0 > 26 * 3600e3;
  const nb = Math.floor((W - L - R) / 3), bw = (t1 - t0) / nb;
  series.forEach(s => {
    const m = new Map();
    for (const p of s.pts) { const k = Math.min(nb - 1, Math.max(0, Math.floor((p.t - t0) / bw))); const b = m.get(k) || {t: 0, v: 0, n: 0}; b.t += p.t; b.v += p.v; b.n++; m.set(k, b); }
    s.ds = [...m.entries()].sort((a, b) => a[0] - b[0]).map(([, b]) => ({t: b.t / b.n, v: b.v / b.n}));
  });
  const vals = series.flatMap(s => s.ds.map(p => p.v));
  const hi = Math.max(1, ...vals) * 1.08, lo = Math.min(0, ...vals);
  const x = t => L + (t - t0) / (t1 - t0) * (W - L - R), y = v => T + (hi - v) / (hi - lo) * (H - T - B), gap = Math.max(25 * 60e3, bw * 3);
  const path = ds => { let d = ''; ds.forEach((p, i) => { d += (i && p.t - ds[i - 1].t <= gap ? 'L' : 'M') + x(p.t).toFixed(1) + ',' + y(p.v).toFixed(1); }); return d; };
  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="${esc(o.label || 'Trend')}">
    ${niceTicks(lo, hi, 4).map(v => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${L - 5}" y="${y(v) + 3.5}" text-anchor="end">${fmt(v, 0)}</text>`).join('')}
    ${[0, 1, 2, 3, 4].map(i => { const t = t0 + (t1 - t0) * i / 4; return `<text class="ax" x="${x(t)}" y="${H - 5}" text-anchor="${i === 0 ? 'start' : i === 4 ? 'end' : 'middle'}">${tFmt(t, long)}</text>`; }).join('')}
    ${series.map(s => `<path d="${path(s.ds)}" fill="none" style="stroke:${s.colour}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`).join('')}
    <line class="xh2" y1="${T}" y2="${H - B}" stroke="var(--ink)" stroke-width="1" stroke-dasharray="3 3" style="display:none"/>
  </svg><div class="tip" style="display:none;white-space:normal;text-align:left;min-width:140px"></div>`;
  const svg = box.querySelector('svg'), tip = box.querySelector('.tip'), xh = box.querySelector('.xh2');
  const at = ev => {
    const r = svg.getBoundingClientRect(), t = t0 + ((ev.clientX - r.left) * W / r.width - L) / (W - L - R) * (t1 - t0);
    const near = series.map(s => s.ds.reduce((b, p) => (!b || Math.abs(p.t - t) < Math.abs(b.t - t) ? p : b), null));
    const ok = p => p && Math.abs(p.t - t) <= bw * 2;
    xh.style.display = ''; xh.setAttribute('x1', x(t)); xh.setAttribute('x2', x(t));
    tip.style.display = '';
    tip.innerHTML = `<b>${tFmt(t, true)}</b>` + series.map((s, i) => `<br><i style="display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:5px;background:${s.colour}"></i>${esc(s.label)} ${ok(near[i]) ? fmt(near[i].v, 0) + ' MW' : '—'}`).join('');
    const half = tip.offsetWidth / 2 + 4;
    tip.style.left = Math.min(Math.max(x(t) / W * r.width, half), r.width - half) + 'px';
  };
  svg.addEventListener('pointerdown', at);
  svg.addEventListener('pointermove', at);
}

function renderUnitTrend(i) {
  const box = $('utr-' + i), st = S.gsecl?.stations?.[i];
  if (!box || !st || !hasNative('unitHistoryRead')) { if (box) box.innerHTML = ''; return; }
  const U = S.ut || (S.ut = {range: 24, from: 0, to: 0});
  const allUnits = st.blocks.flatMap(b => b.units);
  // Units chosen for this station (all by default; at most 8 lines, the colours available).
  const pick = (U.pick || (U.pick = {}))[st.station];
  const units = (pick ? allUnits.filter(u => pick.includes(u.key)) : allUnits).slice(0, 8);
  const custom = U.range === 'custom' && U.from && U.to > U.from;
  const t1 = custom ? U.to : Date.now(), t0 = custom ? U.from : t1 - (+U.range || 24) * 3600e3;
  const lines = Native.unitHistoryRead(String(t0), String(t1), units.map(u => u.key).join(',')).split('\n').filter(Boolean).map(l => l.split(','));
  const series = units.map((u, k) => ({label: u.label, colour: `var(--k${k + 1})`, pts: lines.map(a => ({t: +a[0], v: a[k + 1] === '' || a[k + 1] === undefined ? null : +a[k + 1]})).filter(p => p.v !== null && isFinite(p.v))}));
  const loc = t => new Date(t - new Date(t).getTimezoneOffset() * 60e3).toISOString().slice(0, 16);
  const colourOf = key => `var(--k${allUnits.findIndex(u => u.key === key) % 8 + 1})`;
  series.forEach((s, k) => { s.colour = colourOf(units[k].key); });
  box.innerHTML = `<div class="blk"><div class="blk-h">Unit-wise generation<span>${lines.length} readings</span></div>
    ${allUnits.length > 1 ? `<div class="chips" style="padding:2px 0 4px;flex-wrap:wrap;overflow:visible">${allUnits.length > 2 ? `<button class="chip ${units.length === allUnits.length ? 'on' : ''}" data-utu="*" data-uti="${i}" style="padding:4px 10px;font-size:12px">All units</button>` : ''}${allUnits.map(u => `<button class="chip ${units.includes(u) ? 'on' : ''}" data-utu="${esc(u.key)}" data-uti="${i}" style="padding:4px 10px;font-size:12px"><span class="sw" style="background:${colourOf(u.key)}"></span>${esc(u.label)}</button>`).join('')}</div>` : ''}
    <div class="chips" style="padding:4px 0 6px">${UT_RANGES.map(([l, h]) => `<button class="chip ${U.range === h ? 'on' : ''}" data-utr="${h}" data-uti="${i}" style="padding:4px 10px;font-size:12px">${l}</button>`).join('')}</div>
    ${U.range === 'custom' ? `<div style="display:grid;grid-template-columns:1fr 1fr auto;gap:6px;align-items:end;margin-bottom:6px">
      <label style="font-size:11px;color:var(--muted)">From<input class="search" id="utF-${i}" type="datetime-local" value="${loc(U.from || Date.now() - 48 * 3600e3)}" style="margin:2px 0 0;padding:7px"></label>
      <label style="font-size:11px;color:var(--muted)">To<input class="search" id="utT-${i}" type="datetime-local" value="${loc(U.to || Date.now())}" style="margin:2px 0 0;padding:7px"></label>
      <button class="btn" data-utapply="${i}" style="background:var(--accent);color:#fff;border-color:var(--accent);margin:0">Show</button></div>` : ''}
    <div class="chart" id="utc-${i}"></div>
    <div class="keyline">${series.map(s => { const last = s.pts[s.pts.length - 1]; return `<span><i style="width:14px;height:3px;background:${s.colour}"></i>${esc(s.label)}${last ? ` <b style="color:var(--ink)">${fmt(last.v, 0)}</b>` : ''}</span>`; }).join('')}</div>
    ${lines.length ? csvBtn('ut' + i, `${st.station} unit-wise generation`, ['Time'].concat(units.map(u => `${u.label} (${u.key}) MW`)), lines.map(a => [csvTime(+a[0])].concat(units.map((u, k) => a[k + 1] === undefined || a[k + 1] === '' ? '' : +a[k + 1])))) : ''}</div>`;
  const c = $('utc-' + i);
  if (!series.some(s => s.pts.length >= 2)) { c.innerHTML = '<div class="empty">No unit readings stored for this period yet. They are recorded from this version on, while the app is open and by the background monitor.</div>'; return; }
  timeLines(c, series, t0, t1, {label: st.station + ' unit-wise generation'});
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-utr],[data-utapply],[data-utu]');
  if (!b) return;
  const U = S.ut || (S.ut = {range: 24});
  if (b.dataset.utu !== undefined) {
    const st = S.gsecl?.stations?.[b.dataset.uti];
    if (!st) return;
    const keys = st.blocks.flatMap(x => x.units).map(u => u.key), P = U.pick || (U.pick = {});
    let on = P[st.station] || keys.slice();
    if (b.dataset.utu === '*') on = keys.slice();
    else if (on.length === keys.length && keys.length > 2) on = [b.dataset.utu];          // from "all", the first touch shows that unit alone
    else on = on.includes(b.dataset.utu) ? on.filter(k => k !== b.dataset.utu) : on.concat(b.dataset.utu);
    P[st.station] = on.length ? keys.filter(k => on.includes(k)) : keys.slice();
    return renderUnitTrend(+b.dataset.uti);
  }
  if (b.dataset.utr !== undefined) { U.range = b.dataset.utr === 'custom' ? 'custom' : +b.dataset.utr; if (U.range === 'custom' && !U.from) { U.to = Date.now(); U.from = U.to - 48 * 3600e3; } }
  else { const i = b.dataset.utapply, a = new Date($('utF-' + i).value).getTime(), z = new Date($('utT-' + i).value).getTime(); if (!(a < z)) return alert('Choose a start before the end.'); U.from = a; U.to = z; }
  S.open.forEach(i => renderUnitTrend(i));
});

// ---------------------------------------------------------------- the same hours of two days

const CMP_METRICS = [['catered', 'Gujarat catered', r => r[2]], ['gsecl', 'GSECL generation (all)', r => r[3]], ['thermal', 'GSECL thermal', r => r[4]],
  ['th_hy', 'GSECL thermal + hydro', r => (r[4] === null ? null : r[4] + (r[5] ?? 0))], ['solar', 'Gujarat solar', r => r[6]], ['wind', 'Gujarat wind', r => r[7]],
  ['guj', 'Gujarat generation without solar and wind', gujConv], ['freq', 'Grid frequency', r => r[1]]];
const isoDay = t => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const dayStart = iso => new Date(iso + 'T00:00:00').getTime();
let cmpRows = null, cmpKey = '';

function renderCompare() {
  const C2 = S.cmp || (S.cmp = {metric: 'catered', when: 'yday', a: isoDay(Date.now()), b: isoDay(Date.now() - 864e5)});
  $('cmpMetric').innerHTML = CMP_METRICS.map(([k, l]) => `<option value="${k}" ${C2.metric === k ? 'selected' : ''}>${esc(l)}</option>`).join('');
  $('cmpWhen').innerHTML = [['yday', 'Today vs yesterday'], ['week', 'Today vs same day last week'], ['pick', 'Choose days']].map(([k, l]) => `<button class="chip ${C2.when === k ? 'on' : ''}" data-cmpw="${k}" style="padding:5px 12px">${l}</button>`).join('');
  if (C2.when !== 'pick') { C2.a = isoDay(Date.now()); C2.b = isoDay(Date.now() - (C2.when === 'week' ? 7 : 1) * 864e5); }
  $('cmpDates').hidden = C2.when !== 'pick';
  $('cmpA').value = C2.a; $('cmpB').value = C2.b;
  const [, label, val] = CMP_METRICS.find(m => m[0] === C2.metric), dp = C2.metric === 'freq' ? 3 : 0, unit = C2.metric === 'freq' ? 'Hz' : 'MW';
  const from = Math.min(dayStart(C2.a), dayStart(C2.b)), key = from + '|' + Math.floor(Date.now() / 60e3);
  if (cmpKey !== key) { cmpRows = parseRows(hasNative('historyRead') ? Native.historyRead(String(from)) : ''); cmpKey = key; }
  const day = iso => { const t0 = dayStart(iso); return cmpRows.filter(r => r[0] >= t0 && r[0] < t0 + 864e5).map(r => ({m: (r[0] - t0) / 60e3, v: val(r)})).filter(p => p.v !== null && isFinite(p.v)); };
  const A = day(C2.a), B = day(C2.b), box = $('cmpChart');
  const dlab = iso => conDate(iso).replace(/ \d{4}$/, '');
  $('cmpNote').textContent = `${dlab(C2.a)} vs ${dlab(C2.b)}`;
  if (A.length < 2 && B.length < 2) { $('cmpStats').innerHTML = ''; $('cmpKey').innerHTML = ''; box.innerHTML = `<div class="empty">No ${esc(label.toLowerCase())} readings stored for these days. Readings are kept for 90 days.</div>`; return; }
  // Value at the same time of day: the latest time that day A has, or now.
  const nowM = C2.a === isoDay(Date.now()) ? (Date.now() - dayStart(C2.a)) / 60e3 : 1440;
  const near = (list, m) => list.reduce((b, p) => (!b || Math.abs(p.m - m) < Math.abs(b.m - m) ? p : b), null);
  const aNow = near(A.filter(p => p.m <= nowM), nowM), bNow = aNow ? near(B, aNow.m) : null;
  const stat = l => l.length ? {max: Math.max(...l.map(p => p.v)), avg: l.reduce((t, p) => t + p.v, 0) / l.length} : null;
  const sa = stat(A), sb = stat(B.filter(p => p.m <= nowM)), hm = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(Math.round(m % 60)).padStart(2, '0')}`;
  const diff = aNow && bNow ? aNow.v - bNow.v : null;
  $('cmpStats').innerHTML = `<div><span>${esc(dlab(C2.a))}${aNow ? ' ' + hm(aNow.m) : ''}</span><b>${aNow ? fmt(aNow.v, dp) : '—'}</b><small>${unit}</small></div>
    <div><span>${esc(dlab(C2.b))} same time</span><b>${bNow ? fmt(bNow.v, dp) : '—'}</b><small>${unit}</small></div>
    <div><span>Difference</span><b class="${diff === null ? '' : diff >= 0 ? 'pos' : 'neg'}">${diff === null ? '—' : (diff >= 0 ? '+' : '−') + fmt(Math.abs(diff), dp)}</b><small>${diff !== null && bNow.v ? (diff >= 0 ? '+' : '−') + fmt(Math.abs(diff / bNow.v * 100), 1) + '%' : ''}</small></div>
    <div><span>Average so far</span><b>${sa ? fmt(sa.avg, dp) : '—'}</b><small>vs ${sb ? fmt(sb.avg, dp) : '—'}</small></div>`;
  const W = Math.max(box.clientWidth || 320, 240), H = 190, L = 50, R = 10, T = 10, B2 = 24;
  const all = A.concat(B).map(p => p.v);
  let lo = Math.min(...all), hi = Math.max(...all);
  if (C2.metric !== 'freq') lo = Math.min(0, lo);
  const pad = (hi - lo) * 0.08 || 1; lo -= C2.metric === 'freq' ? pad : 0; hi += pad;
  const x = m => L + m / 1440 * (W - L - R), y = v => T + (hi - v) / (hi - lo) * (H - T - B2);
  const line = l => { let d = '', prev = null; l.forEach(p => { d += (prev !== null && p.m - prev <= 30 ? 'L' : 'M') + x(p.m).toFixed(1) + ',' + y(p.v).toFixed(1); prev = p.m; }); return d; };
  const kt = v => (C2.metric === 'freq' ? fmt(v, 2) : Math.abs(v) >= 10000 ? fmt(v / 1000, 0) + 'k' : fmt(v, 0));
  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="${esc(label)} on two days">
    ${niceTicks(lo, hi, 4).map(v => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${L - 6}" y="${y(v) + 3.5}" text-anchor="end">${kt(v)}</text>`).join('')}
    ${[0, 6, 12, 18, 24].map((h, i) => `<text class="ax" x="${x(h * 60)}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : i === 4 ? 'end' : 'middle'}">${String(h).padStart(2, '0')}:00</text>`).join('')}
    <path d="${line(B)}" fill="none" style="stroke:var(--s2)" stroke-width="2" stroke-dasharray="5 3" stroke-linejoin="round"/>
    <path d="${line(A)}" fill="none" style="stroke:var(--s1)" stroke-width="2.2" stroke-linejoin="round"/>
    <line id="cmx" y1="${T}" y2="${H - B2}" stroke="var(--ink)" stroke-width="1" stroke-dasharray="3 3" style="display:none"/>
  </svg><div class="tip" id="ctip" style="display:none;white-space:normal;text-align:left;min-width:140px"></div>`;
  const mins = [...new Set(A.concat(B).map(p => Math.round(p.m)))].sort((p, q) => p - q), at15 = (l, m) => { const p = near(l, m); return p && Math.abs(p.m - m) <= 8 ? p.v : null; };
  $('cmpKey').innerHTML = `<div class="keyline"><span><i style="width:16px;height:3px;background:var(--s1)"></i>${esc(dlab(C2.a))}</span><span><i style="width:16px;height:0;border-top:2px dashed var(--s2)"></i>${esc(dlab(C2.b))}</span><span>${esc(label)} · ${unit}</span></div>`
    + csvBtn('cmp', `GSECL_${C2.metric}_${C2.a}_vs_${C2.b}`, ['Time of day', `${C2.a} (${unit})`, `${C2.b} (${unit})`],
      () => mins.filter((m, k) => !k || m - mins[k - 1] >= 1).map(m => [hm(m), at15(A, m), at15(B, m)]));
  const svg = box.querySelector('svg'), tip = $('ctip');
  const at = ev => {
    const r = svg.getBoundingClientRect(), m = Math.max(0, Math.min(1440, ((ev.clientX - r.left) * W / r.width - L) / (W - L - R) * 1440));
    const a = near(A, m), b = near(B, m), ok = p => p && Math.abs(p.m - m) <= 20;
    $('cmx').style.display = ''; $('cmx').setAttribute('x1', x(m)); $('cmx').setAttribute('x2', x(m));
    tip.style.display = '';
    tip.innerHTML = `<b>${hm(m)}</b><br><i style="display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:5px;background:var(--s1)"></i>${esc(dlab(C2.a))} ${ok(a) ? fmt(a.v, dp) : '—'}<br><i style="display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:5px;background:var(--s2)"></i>${esc(dlab(C2.b))} ${ok(b) ? fmt(b.v, dp) : '—'}`;
    const half = tip.offsetWidth / 2 + 4;
    tip.style.left = Math.min(Math.max(x(m) / W * r.width, half), r.width - half) + 'px';
  };
  svg.addEventListener('pointerdown', at);
  svg.addEventListener('pointermove', at);
}
$('cmpMetric').addEventListener('change', e => { S.cmp.metric = e.target.value; renderCompare(); });

// ================================================================ Gujarat solar & wind forecast, net load and ramp

/**
 * Weather forecast (Open-Meteo, free; hourly, 2 days ahead and 7 days back) at Gujarat's main solar and wind areas,
 * turned into MW with factors fitted on this phone's own record of SLDC's Gujarat solar and wind (last 7 days), so
 * the forecast follows the installed fleet without anyone entering capacities. Demand is the last 3 days' profile
 * of Gujarat catered, levelled to today. Net load = demand − solar − wind: what thermal, hydro and imports carry.
 */
const RE_SOLAR_PTS = [[23.85, 69.8], [23.9, 71.2], [22.25, 72.2], [24.2, 71.6], [22.3, 70.8]];       // Khavda, Charanka, Dholera, Radhanpur, Rajkot
const RE_WIND_PTS = [[23.2, 69.7], [22.4, 70.1], [21.65, 69.6], [21.6, 71.2], [23.85, 69.8]];         // Kutch, Jamnagar, Porbandar, Amreli, Khavda
const RE = {data: null, at: 0, busy: false, error: ''};
/** Capacity factor of a typical wind turbine at hub-height wind speed v (m/s). */
const windCf = v => (v < 3 || v > 25 ? 0 : v >= 12 ? 1 : Math.pow((v - 3) / 9, 3));

async function reFcLoad(force) {
  if (RE.busy || (!force && RE.data && Date.now() - RE.at < 3 * 3600e3)) return renderReFc();
  RE.busy = true; renderReFc();
  const pts = RE_SOLAR_PTS.concat(RE_WIND_PTS);
  const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + pts.map(p => p[0]).join(',') + '&longitude=' + pts.map(p => p[1]).join(',') +
    '&hourly=shortwave_radiation,wind_speed_100m&past_days=7&forecast_days=2&timezone=Asia%2FKolkata';
  const r = await httpGet(url, 40);
  RE.busy = false;
  if (!r.ok) { RE.error = r.error; return renderReFc(); }
  try {
    const all = JSON.parse(r.body), list = Array.isArray(all) ? all : [all];
    const times = list[0].hourly.time.map(t => new Date(t + ':00+05:30').getTime());
    const nS = RE_SOLAR_PTS.length;
    const sIdx = times.map((_, i) => list.slice(0, nS).reduce((t, l) => t + (l.hourly.shortwave_radiation[i] || 0), 0) / nS / 1000);
    const wIdx = times.map((_, i) => list.slice(nS).reduce((t, l) => t + windCf((l.hourly.wind_speed_100m[i] || 0) / 3.6), 0) / (list.length - nS));
    RE.data = {times, sIdx, wIdx}; RE.at = Date.now(); RE.error = '';
  } catch (e) { RE.error = 'The weather forecast came in an unexpected format.'; }
  renderReFc();
}

function renderReFc() {
  const box = $('reFc');
  if (!box) return;
  const head = `<h2>Solar &amp; wind forecast · net load <span class="more" data-refc="1" style="cursor:pointer">Refresh</span></h2>`;
  if (!RE.data) { box.innerHTML = head + (RE.busy ? '<div class="sk" style="height:200px"></div>' : `<div class="empty">${esc(RE.error || 'Open the Gujarat page with a connection to load the weather forecast.')}</div>`); return; }
  if (!hasNative('historyRead')) { box.innerHTML = head + '<div class="empty">The forecast is fitted on the readings the app stores on the phone.</div>'; return; }
  const {times, sIdx, wIdx} = RE.data, now = Date.now(), hour = 3600e3;
  const slot = t => Math.floor((t - 1800e3) / hour) * hour + 1800e3;          // IST hours start at :30 UTC
  // Hourly averages of the stored record: catered (2), solar (6), wind (7).
  const rows = parseRows(Native.historyRead(String(now - 8 * 864e5))), byHour = new Map();
  for (const r of rows) { const h = slot(r[0]), b = byHour.get(h) || byHour.set(h, {c: [], s: [], w: []}).get(h); if (r[2] !== null) b.c.push(r[2]); if (r[6] !== null) b.s.push(r[6]); if (r[7] !== null) b.w.push(r[7]); }
  const avg = a => (a.length ? a.reduce((t, v) => t + v, 0) / a.length : null), actual = (t, k) => { const b = byHour.get(t); return b ? avg(b[k]) : null; };
  // Fit MW = k × index (least squares through zero) on the past hours that have both.
  const fit = (idx, k) => { let xy = 0, xx = 0; times.forEach((t, i) => { const a = actual(t, k); if (t < now - hour && a !== null && idx[i] > 0.03) { xy += a * idx[i]; xx += idx[i] * idx[i]; } }); return xx > 0 ? xy / xx : null; };
  const kS = fit(sIdx, 's'), kW = fit(wIdx, 'w');
  if (kS === null && kW === null) { box.innerHTML = head + '<div class="empty">Not enough stored solar / wind readings yet to fit the forecast (needs a few days of the Gujarat trend, recorded while the app is open or by the background monitor).</div>'; return; }
  // Demand: the same hour on the last 3 days, levelled by today's last 3 hours against that profile.
  const prof = t => avg([1, 2, 3].map(d => actual(t - d * 864e5, 'c')).filter(v => v !== null));
  let num = 0, den = 0; for (let t = slot(now) - 3 * hour; t < now - hour; t += hour) { const a = actual(t, 'c'), p = prof(t); if (a !== null && p) { num += a; den += p; } }
  const level = den ? num / den : 1;
  const from = slot(now) - 12 * hour, to = from + 48 * hour;
  const H = times.map((t, i) => ({t, solar: kS === null ? null : Math.max(0, kS * sIdx[i]), wind: kW === null ? null : Math.max(0, kW * wIdx[i]),
    demand: t >= now - hour ? (prof(t) === null ? null : prof(t) * level) : actual(t, 'c'), aS: actual(t, 's'), aW: actual(t, 'w')})).filter(p => p.t >= from && p.t < to);
  H.forEach(p => { p.net = p.demand === null ? null : p.demand - (p.solar || 0) - (p.wind || 0); });
  const fut = H.filter(p => p.t >= now && p.net !== null);
  let ramp = null; for (let i = 1; i < fut.length; i++) { const d = fut[i].net - fut[i - 1].net; if (!ramp || d > ramp.d) ramp = {d, t: fut[i - 1].t}; }
  // The evening pick-up: lowest net load around midday to the highest after it, within the next 24 h.
  // Midday low of the net load (solar at its best) in the next 24 h, then its evening high within 12 h after it.
  const day = fut.filter(p => p.t < now + 24 * hour), low = day.filter(p => { const h = new Date(p.t).getHours(); return h >= 10 && h <= 15; }).reduce((b, p) => (!b || p.net < b.net ? p : b), null);
  const high = low ? fut.filter(p => p.t > low.t && p.t <= low.t + 12 * hour).reduce((b, p) => (!b || p.net > b.net ? p : b), null) : null;
  const sPeak = fut.filter(p => p.solar !== null).reduce((b, p) => (!b || p.solar > b.solar ? p : b), null);
  const hh = t => { const d = new Date(t); return String(d.getHours()).padStart(2, '0') + ':00'; }, dd = t => (new Date(t).toDateString() === new Date().toDateString() ? 'today' : 'tomorrow');
  const W = Math.max(box.clientWidth || 320, 240), Ht = 220, L = 46, R = 8, T = 10, B = 24;
  const vals = H.flatMap(p => [p.demand, p.net, p.solar, p.wind]).filter(v => v !== null && isFinite(v));
  const hi = Math.max(1, ...vals) * 1.06, lo = Math.min(0, ...vals);
  const x = t => L + (t - from) / (to - from) * (W - L - R), y = v => T + (hi - v) / (hi - lo) * (Ht - T - B);
  const path = (k, cond = () => true) => { let d = '', pen = false; H.forEach(p => { const v = p[k]; if (v === null || !cond(p)) { pen = false; return; } d += (pen ? 'L' : 'M') + x(p.t).toFixed(1) + ',' + y(v).toFixed(1); pen = true; }); return d; };
  box.innerHTML = head + `<div class="tstats" style="grid-template-columns:repeat(2,1fr)">
      <div><span>Solar peak</span><b class="num">${sPeak ? fmt(sPeak.solar) : '—'}</b><small>${sPeak ? 'MW at ' + hh(sPeak.t) + ' ' + dd(sPeak.t) : 'not fitted'}</small></div>
      <div><span>Wind, next 24 h</span><b class="num">${kW === null ? '—' : fmt(avg(day.map(p => p.wind).filter(v => v !== null)))}</b><small>MW average</small></div>
      <div><span>Evening pick-up</span><b class="num neg">${high && low ? '+' + fmt(high.net - low.net) : '—'}</b><small>${high && low ? `MW from ${hh(low.t)} to ${hh(high.t)} ${dd(high.t)}` : ''}</small></div>
      <div><span>Steepest ramp</span><b class="num">${ramp ? '+' + fmt(ramp.d) : '—'}</b><small>${ramp ? `MW/h, ${hh(ramp.t)}–${hh(ramp.t + hour)} ${dd(ramp.t)}` : ''}</small></div></div>
    <div class="chart"><svg viewBox="0 0 ${W} ${Ht}" height="${Ht}" role="img" aria-label="Gujarat demand, solar, wind and net load forecast">
      ${niceTicks(lo, hi, 4).map(v => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${L - 5}" y="${y(v) + 3.5}" text-anchor="end">${Math.abs(v) >= 1000 ? fmt(v / 1000, 0) + 'k' : fmt(v)}</text>`).join('')}
      <rect x="${x(now)}" y="${T}" width="${W - R - x(now)}" height="${Ht - T - B}" style="fill:var(--soft);opacity:.55"/>
      <line x1="${x(now)}" x2="${x(now)}" y1="${T}" y2="${Ht - B}" style="stroke:var(--brand2)" stroke-width="1.2" stroke-dasharray="3 3"/><text class="ax" x="${x(now) + 3}" y="${T + 9}">now · forecast →</text>
      ${[0, 12, 24, 36, 48].map((h, i) => `<text class="ax" x="${x(from + h * hour)}" y="${Ht - 6}" text-anchor="${i === 0 ? 'start' : i === 4 ? 'end' : 'middle'}">${hh(from + h * hour)}</text>`).join('')}
      <path d="${path('demand')}" fill="none" style="stroke:var(--muted)" stroke-width="1.8"/>
      <path d="${path('solar')}" fill="none" style="stroke:#f59e0b" stroke-width="2"/>
      <path d="${path('aS', p => p.t < now)}" fill="none" style="stroke:#f59e0b" stroke-width="1" stroke-dasharray="2 2"/>
      <path d="${path('wind')}" fill="none" style="stroke:var(--s1)" stroke-width="2"/>
      <path d="${path('net')}" fill="none" style="stroke:var(--accent)" stroke-width="2.8" stroke-linejoin="round"/>
      ${low && high ? `<line x1="${x(low.t)}" x2="${x(high.t)}" y1="${y(low.net)}" y2="${y(high.net)}" style="stroke:var(--neg)" stroke-width="1.2" stroke-dasharray="4 3"/>` : ''}
    </svg></div>
    <div class="keyline"><span><i style="width:14px;height:3px;background:var(--accent)"></i>Net load (demand − solar − wind)</span><span><i style="width:14px;height:3px;background:var(--muted)"></i>Gujarat demand</span><span><i style="width:14px;height:3px;background:#f59e0b"></i>Solar</span><span><i style="width:14px;height:3px;background:var(--s1)"></i>Wind</span><span>dotted: actual solar</span></div>
    <div class="note-src">Net load is what thermal, hydro and imports must carry; its rise when solar falls is the evening ramp GSECL units have to follow. Weather: Open-Meteo. Solar ×${kS === null ? '—' : fmt(kS, 0)}, wind ×${kW === null ? '—' : fmt(kW, 0)} MW fitted on the last 7 days; demand = last 3 days' profile × ${fmt(level, 3)}. An estimate, not SLDC's forecast.</div>
    ${csvBtn('reFc', 'Gujarat_RE_forecast_net_load', ['Time', 'Demand MW', 'Solar forecast MW', 'Wind forecast MW', 'Net load MW', 'Actual solar MW', 'Actual wind MW'],
      H.map(p => [csvTime(p.t), p.demand === null ? null : Math.round(p.demand), p.solar === null ? null : Math.round(p.solar), p.wind === null ? null : Math.round(p.wind), p.net === null ? null : Math.round(p.net), p.aS === null ? null : Math.round(p.aS), p.aW === null ? null : Math.round(p.aW)]))}`;
}
document.addEventListener('click', e => { if (e.target.closest('[data-refc]')) reFcLoad(true); });
$('cmpA').addEventListener('change', e => { if (e.target.value) { S.cmp.a = e.target.value; renderCompare(); } });
$('cmpB').addEventListener('change', e => { if (e.target.value) { S.cmp.b = e.target.value; renderCompare(); } });
document.addEventListener('click', e => { const b = e.target.closest('[data-cmpw]'); if (b) { S.cmp.when = b.dataset.cmpw; renderCompare(); } });

// ---------------------------------------------------------------- comparison trend: GSECL thermal / hydro, Gujarat solar / wind

const mixOn = () => S.mixOn || ['thermal', 'hydro', 'solar', 'gujconv'];

function renderMixTrend() {
  const box = $('trendChart'), {t0: since, t1: until, long} = trendWindow();
  trendData();                                                         // fills trendRows for the period
  const on = MIX_SERIES.filter(s => mixOn().includes(s[0]));
  const rows = (trendRows || []).filter(r => r[0] >= since && r[0] <= until);
  const series = on.map(([k, label, col, colour]) => ({k, label, colour, pts: rows.map(r => ({t: r[0], v: mixVal(r, col)})).filter(p => p.v !== null && isFinite(p.v))}));
  $('trendNote').textContent = `${rows.length} readings`;
  if (!series.some(s => s.pts.length >= 2)) {
    $('trendStats').innerHTML = '';
    box.innerHTML = `<div class="empty">No thermal / solar readings for this period yet.<br>They are recorded from this version on: every minute while the app is open, and in the background as set in Profile.</div>`;
    return;
  }
  $('trendStats').innerHTML = series.map(s => { const last = s.pts[s.pts.length - 1];
    return `<div><span><i style="display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:4px;background:${s.colour}"></i>${esc(s.label)}</span><b>${last ? fmt(last.v, 0) : '—'}</b><small>${last ? 'MW · ' + tFmt(last.t, long) : ''}</small></div>`; }).join('');
  const W = Math.max(box.clientWidth || 320, 240), H = 220, L = 52, R = 10, T = 10, B = 24;
  const t0 = since, t1 = until, nb = Math.floor((W - L - R) / 3), bw = (t1 - t0) / nb;
  // Each series averaged into time buckets, so long periods stay light.
  series.forEach(s => {
    const m = new Map();
    for (const p of s.pts) { const k = Math.min(nb - 1, Math.floor((p.t - t0) / bw)); const b = m.get(k) || {t: 0, v: 0, n: 0}; b.t += p.t; b.v += p.v; b.n++; m.set(k, b); }
    s.ds = [...m.entries()].sort((a, b) => a[0] - b[0]).map(([, b]) => ({t: b.t / b.n, v: b.v / b.n}));
  });
  const hi = Math.max(1, ...series.flatMap(s => s.ds.map(p => p.v))) * 1.08, lo = Math.min(0, ...series.flatMap(s => s.ds.map(p => p.v)));
  const x = t => L + (t - t0) / (t1 - t0) * (W - L - R), y = v => T + (hi - v) / (hi - lo) * (H - T - B);
  const gapMs = Math.max(20 * 60e3, bw * 3);
  const path = ds => { let d = '', pen = false; ds.forEach((p, i) => { pen = pen && p.t - ds[i - 1].t <= gapMs; d += (pen ? 'L' : 'M') + x(p.t).toFixed(1) + ',' + y(p.v).toFixed(1); pen = true; }); return d; };
  const kt = v => (Math.abs(v) >= 10000 ? fmt(v / 1000, 0) + 'k' : fmt(v, 0));
  const xt = Array.from({length: 5}, (_, i) => t0 + (t1 - t0) * i / 4);
  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="GSECL thermal and hydro, Gujarat solar and wind generation">
    ${niceTicks(lo, hi, 4).map(v => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${L - 6}" y="${y(v) + 3.5}" text-anchor="end">${kt(v)}</text>`).join('')}
    ${xt.map((t, i) => `<text class="ax" x="${x(t)}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : i === 4 ? 'end' : 'middle'}">${tFmt(t, long)}</text>`).join('')}
    ${series.map(s => `<path d="${path(s.ds)}" fill="none" style="stroke:${s.colour}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`).join('')}
    <line id="mxh" y1="${T}" y2="${H - B}" stroke="var(--ink)" stroke-width="1" stroke-dasharray="3 3" style="display:none"/>
    ${series.map((s, i) => `<circle id="mxd${i}" r="4" style="fill:${s.colour};stroke:var(--card);display:none" stroke-width="2"/>`).join('')}
  </svg><div class="tip" id="mtip" style="display:none;white-space:normal;text-align:left;min-width:150px"></div>`;
  $('trendKey').innerHTML = `<div class="keyline">${series.map(s => `<span><i style="width:14px;height:3px;background:${s.colour}"></i>${esc(s.label)}</span>`).join('')}<span>MW · GSECL thermal = coal + lignite + gas · Gujarat without RE = Gujarat generation − solar − wind</span></div>`;
  const svg = box.querySelector('svg'), tip = $('mtip');
  const at = ev => {
    const r = svg.getBoundingClientRect(), t = t0 + ((ev.clientX - r.left) * W / r.width - L) / (W - L - R) * (t1 - t0);
    const near = series.map(s => s.ds.reduce((b, p) => (!b || Math.abs(p.t - t) < Math.abs(b.t - t) ? p : b), null));
    const ref = near.filter(Boolean).reduce((b, p) => (!b || Math.abs(p.t - t) < Math.abs(b.t - t) ? p : b), null);
    if (!ref) return;
    $('mxh').style.display = ''; $('mxh').setAttribute('x1', x(ref.t)); $('mxh').setAttribute('x2', x(ref.t));
    near.forEach((p, i) => { const c = $('mxd' + i); if (p && Math.abs(p.t - ref.t) < bw * 2) { c.style.display = ''; c.setAttribute('cx', x(p.t)); c.setAttribute('cy', y(p.v)); } else c.style.display = 'none'; });
    tip.style.display = '';
    tip.innerHTML = `<b>${tFmt(ref.t, true)}</b>` + series.map((s, i) => `<br><i style="display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:5px;background:${s.colour}"></i>${esc(s.label)} ${near[i] && Math.abs(near[i].t - ref.t) < bw * 2 ? fmt(near[i].v, 0) + ' MW' : '—'}`).join('');
    const half = tip.offsetWidth / 2 + 4;
    tip.style.left = Math.min(Math.max(x(ref.t) / W * r.width, half), r.width - half) + 'px';
  };
  svg.addEventListener('pointerdown', at);
  svg.addEventListener('pointermove', at);
}

/** The readings of the chosen period as a CSV file, for Excel or another system. */
function exportTrends() {
  const {t0: since, t1: until} = trendWindow();
  trendData();
  const rows = (trendRows || []).filter(r => r[0] >= since && r[0] <= until);
  if (!rows.length) return alert('No readings in this period to export.');
  csvSave(`GSECL_trends_${S.range === 'custom' ? 'custom' : RANGES.find(x => x[1] === S.range)[0].replace(' ', '')}`, COLS,
    rows.map(r => [csvTime(r[0])].concat(r.slice(1, 9), [gujConv(r)])));
}

/** "Recorded in the background every 5 min · last 12:40" under the trend. */
function renderTrendBg() {
  const el = $('trendBg');
  if (!el) return;
  if (!hasNative('monitorMinutes')) { el.textContent = ''; return; }
  const m = Native.monitorMinutes(), last = Native.monitorLastAt();
  el.textContent = (m > 0 ? `Recorded in the background every ${m} min` : 'Recorded in the background about every 15 min') + (last ? ` · last ${tFmt(last, Date.now() - last > 864e5)}` : '');
}

function renderMonitor() {
  if (!$('monSeg')) return;
  if (!hasNative('monitorMinutes')) { $('monCard').hidden = true; return; }
  const m = Native.monitorMinutes();
  document.querySelectorAll('#monSeg button').forEach(b => b.classList.toggle('on', +b.dataset.mon === m));
  const last = Native.monitorLastAt();
  $('monNote').textContent = (m > 0 ? `A reading every ${m} minutes, outages and syncs checked with it.` : 'Basic: Android runs the check about every 15 minutes, later in battery saver; no notification in the shade.')
    + (last ? ` Last background reading ${tFmt(last, true)}.` : '');
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-mon],[data-gbasis],[data-mixs]');
  if (!b) return;
  if (b.dataset.mon !== undefined) { if (hasNative('monitorSet')) Native.monitorSet(+b.dataset.mon); return setTimeout(() => { renderMonitor(); renderTrendBg(); }, 300); }
  if (b.dataset.gbasis) { S.genBasis = b.dataset.gbasis; return renderTrends(); }
  if (b.dataset.mixs) { const k = b.dataset.mixs, on = mixOn(); S.mixOn = on.includes(k) ? (on.length > 1 ? on.filter(x => x !== k) : on) : on.concat(k); return renderTrends(); }
});

// ---------------------------------------------------------------- IEX price chart

function renderPrices() {
  const P = S.iex, box = $('iexChart');
  if (!P) return;
  if (!P.ok) { $('iexStats').innerHTML = ''; box.innerHTML = `<div class="empty">${esc(P.error)}</div>`; return; }
  const u = v => v === null || v === undefined ? null : v / 1000;          // Rs/MWh -> Rs/unit
  const rtm = (P.rtm || []).map(u), dam = (P.dam || []).map(u);
  const avg = a => { const v = a.filter(x => x !== null); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
  const rNow = P.rtmIdx !== null ? rtm[P.rtmIdx] : null, dNow = dam[P.cur] ?? null;
  $('iexNote').textContent = `Block ${blockLabel(P.cur)}`;
  $('iexStats').innerHTML = [['RTM now', rNow, P.rtmIdx !== null ? blockLabel(P.rtmIdx) : '—'], ['DAM now', dNow, blockLabel(P.cur)],
    ['RTM avg', avg(rtm), 'today so far'], ['DAM avg', avg(dam), 'today']]
    .map(([l, v, s]) => `<div><span>${l}</span><b>${v === null ? '—' : '₹' + fmt(v, 2)}</b><small>${esc(s)}</small></div>`).join('');

  if (!$('iexCsv')) box.insertAdjacentHTML('afterend', '<div id="iexCsv"></div>');
  $('iexCsv').innerHTML = csvBtn('iex', 'IEX_prices_today', ['Block', 'RTM (Rs/unit)', 'DAM (Rs/unit)'], Array.from({length: 96}, (_, k) => [blockLabel(k), rtm[k] ?? null, dam[k] ?? null]).filter(r => r[1] !== null || r[2] !== null));
  const W = Math.max(box.clientWidth || 320, 240), H = 190, L = 40, R = 10, T = 12, B = 24;
  const all = [...rtm, ...dam].filter(v => v !== null);
  if (!all.length) { box.innerHTML = '<div class="empty">IEX has not published prices for today yet.</div>'; return; }
  const hi = Math.max(...all) * 1.08 || 1, lo = 0;
  const x = i => L + (i + 0.5) / 96 * (W - L - R);
  const y = v => T + (hi - v) / (hi - lo) * (H - T - B);
  const path = a => { let d = '', pen = false; a.forEach((v, i) => { if (v === null) { pen = false; return; } d += (pen ? 'L' : 'M') + x(i).toFixed(1) + ',' + y(v).toFixed(1); pen = true; }); return d; };
  const yt = niceTicks(lo, hi, 4);
  const lastR = rtm.reduce((k, v, i) => v !== null ? i : k, -1);
  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="IEX RTM and DAM prices today">
    ${yt.map(v => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${L - 6}" y="${y(v) + 3.5}" text-anchor="end">₹${fmt(v, v < 10 ? 1 : 0)}</text>`).join('')}
    ${[0, 6, 12, 18, 24].map((h, i) => `<text class="ax" x="${L + h / 24 * (W - L - R)}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : i === 4 ? 'end' : 'middle'}">${String(h).padStart(2, '0')}:00</text>`).join('')}
    <rect x="${x(P.cur) - (W - L - R) / 192}" y="${T}" width="${(W - L - R) / 96}" height="${H - T - B}" fill="rgba(142,50,145,.12)"/>
    <path d="${path(dam)}" fill="none" style="stroke:var(--brand2)" stroke-width="2" stroke-dasharray="5 4" stroke-linejoin="round"/>
    <path d="${path(rtm)}" fill="none" style="stroke:var(--brand)" stroke-width="2" stroke-linejoin="round"/>
    ${lastR >= 0 ? `<circle cx="${x(lastR)}" cy="${y(rtm[lastR])}" r="4" style="fill:var(--brand);stroke:var(--card)" stroke-width="2"/>` : ''}
    <g id="pcross" style="display:none"><line id="pcx" y1="${T}" y2="${H - B}" stroke="var(--ink)" stroke-width="1" stroke-dasharray="3 3"/></g>
  </svg><div class="tip" id="ptip" style="display:none"></div>`;

  const svg = box.querySelector('svg'), tip = $('ptip'), cross = $('pcross');
  const at = ev => {
    const r = svg.getBoundingClientRect(), px = (ev.clientX - r.left) * W / r.width;
    const i = Math.min(95, Math.max(0, Math.floor((px - L) / (W - L - R) * 96)));
    cross.style.display = ''; $('pcx').setAttribute('x1', x(i)); $('pcx').setAttribute('x2', x(i));
    tip.style.display = '';
    tip.innerHTML = `<b>${blockLabel(i)}</b> · RTM ${rtm[i] === null ? '—' : '₹' + fmt(rtm[i], 2)} · DAM ${dam[i] === null ? '—' : '₹' + fmt(dam[i], 2)}`;
    tip.style.left = Math.min(Math.max(x(i) / W * r.width, 110), r.width - 110) + 'px';
  };
  svg.addEventListener('pointerdown', at);
  svg.addEventListener('pointermove', at);
  // On touch the tooltip stays after lifting the finger; only a mouse leaving the chart hides it.
  svg.addEventListener('pointerleave', ev => { if (ev.pointerType === 'mouse') { cross.style.display = 'none'; tip.style.display = 'none'; } });
}

// ---------------------------------------------------------------- Gujarat generation (SLDC)

const GUJ_PARTS = [
  ['solar', 'Solar', '#f59e0b'], ['wind', 'Wind', '#0ea5e9'], ['gsecl', 'GSECL', '#8e3291'],
  ['privateIpp', 'Private IPP', '#2563eb'], ['publicIpp', 'Public IPP', '#10b981'], ['torrent', 'Torrent', '#db2777'],
  ['other', 'Other', '#94a3b8'],
];

function renderGujarat() {
  const h = S.home;
  if (!h) return;
  if (!h.ok || !h.mix) { $('gujList').innerHTML = `<div class="muted" style="grid-column:1/-1">${esc(h.error || 'Not available')}</div>`; return; }
  const m = h.mix, known = GUJ_PARTS.slice(0, 6).reduce((s, [k]) => s + Math.max(m[k] || 0, 0), 0);
  const total = m.total ?? known;
  const vals = {...m, other: Math.max(total - known, 0)};   // central-sector / others not itemised by SLDC
  const cat = h.catered?.value ?? null, imp = cat !== null ? cat - total : null;
  $('gujTime').textContent = h.time ? 'SLDC ' + h.time.split(' ')[1] : '';
  $('gujStats').innerHTML = [['Total generation', total, 'incl. RE'], ['Gujarat catered', cat, 'demand met'],
    [imp !== null && imp < 0 ? 'Net export' : 'Net import', imp !== null ? Math.abs(imp) : null, 'catered − generation']]
    .map(([l, v, s]) => `<div><span>${l}</span><b>${v === null ? '—' : fmt(v)}</b><small>${s} · MW</small></div>`).join('');
  const parts = GUJ_PARTS.filter(([k]) => (vals[k] || 0) > 0);
  if (S.guj && !parts.some(([k]) => k === S.guj)) S.guj = '';
  $('gujStack').innerHTML = parts.map(([k, l, c]) =>
    `<i data-guj="${k}" class="${S.guj && S.guj !== k ? 'dim' : ''}" style="width:${vals[k] / total * 100}%;background:${c}" title="${l}"></i>`).join('');
  $('gujList').innerHTML = GUJ_PARTS.filter(([k]) => vals[k] !== null && vals[k] !== undefined).map(([k, l, c]) => {
    const v = vals[k], p = total ? Math.max(v, 0) / total * 100 : 0;
    return `<div class="grow ${S.guj === k ? 'on' : S.guj ? 'dim' : ''}" data-guj="${k}"><span class="sw" style="background:${c}"></span>
      <span class="gn">${l}</span><span class="gv num">${fmt(v)} MW<small>${p > 0 && p < 10 ? p.toFixed(1) : Math.round(p)}%</small></span></div>`;
  }).join('');
  const d = h.discoms;
  $('discoms').innerHTML = d && d.length ? `<div class="muted" style="font-size:12px;margin:12px 0 2px">Drawal vs schedule (MW)</div>
    <table class="dt num"><tr><th>Utility</th><th>Drawal</th><th>Schedule</th><th>DSM</th></tr>` +
    d.map((r, i) => `<tr class="${i === 0 ? 'hl' : ''}"><td>${esc(r.name)}</td><td>${fmt(r.drawal)}</td><td>${fmt(r.schedule)}</td>
      <td class="${r.dsm > 0 ? 'neg' : r.dsm < 0 ? 'pos' : ''}">${r.dsm > 0 ? '+' : ''}${fmt(r.dsm)}</td></tr>`).join('') + '</table>' : '';
}

// ---------------------------------------------------------------- notifications

/** Unit names for notifications, e.g. "Wanakbori TPS Unit 3". */
function sendUnitLabels() {
  if (!hasNative('alertsSetLabels')) return;
  const labels = {};
  for (const st of STATIONS) for (const b of st.blocks) for (const [k, [l]] of Object.entries(b.units)) labels[k] = `${st.station} ${l}`;
  Native.alertsSetLabels(JSON.stringify(labels));
  if (hasNative('alertsSetSldcMap')) {
    const map = {};
    for (const st of STATIONS) for (const b of st.blocks) for (const [k, [, sldc]] of Object.entries(b.units)) if (sldc) map[normName(sldc)] = k;
    // combined-cycle stages: SLDC lists GT and STG, the feed has the stage's units (e.g. DGB-GT1 -> dgb1+dgb2)
    for (const st of STATIONS) for (const b of st.blocks) for (const n of b.sldcNames || []) map[normName(n)] = Object.keys(b.units).join('+');
    Native.alertsSetSldcMap(JSON.stringify(map));
  }
}

function checkAlerts(what) {
  if (!hasNative('alertsEvaluate')) return;
  if (what === 'gsecl' && S.gsecl?.ok) {
    const units = {};
    for (const s of S.gsecl.stations) for (const b of s.blocks) for (const u of b.units) if (u.mw !== null) units[u.key] = u.mw;
    Native.alertsEvaluate(JSON.stringify(units), '');
    if (hasNative('unitHistoryAppend')) Native.unitHistoryAppend(JSON.stringify(units));   // for the unit-wise trends
  }
  if (what === 'outages' && S.outages?.ok) {
    Native.alertsEvaluate('', JSON.stringify((S.outages.allRows || S.outages.rows).map(r =>
      ({unit: r.unit, type: r.type, since: r.since || '', revised: r.revised || r.schedule || '', reason: r.reason || ''}))));
  }
}

function renderNotify() {
  if (!hasNative('alertsPrefs')) { $('notifyPerm').innerHTML = ''; return; }
  const [o, s, x] = Native.alertsPrefs().split(',');
  document.querySelectorAll('[data-pref]').forEach(b => b.classList.toggle('on', ({outage: o, sync: s, other: x}[b.dataset.pref]) === '1'));
  renderMonitor();
  $('notifyPerm').innerHTML = Native.alertsPermitted() ? ''
    : '<div class="alert"><span>⚠</span><span>Notifications are blocked for this app. Allow them in Android Settings → Apps → GSECL Gen → Notifications.</span></div>';
}

// ---------------------------------------------------------------- settings: refresh rate, theme, palette

const PALETTES = {
  gsecl:  {name: 'GSECL',  hero: ['#2b1055', '#5b1d6e', '#8e3291'], light: ['#8e3291', '#f47b57'], dark: ['#c06ad0', '#dd6a44']},
  ocean:  {name: 'Ocean',  hero: ['#0a2a66', '#123f8f', '#0e7490'], light: ['#1d4ed8', '#0891b2'], dark: ['#1d4ed8', '#0891b2']},
  forest: {name: 'Forest', hero: ['#052e1f', '#065f46', '#047857'], light: ['#047857', '#ca8a04'], dark: ['#10a374', '#c2850a']},
  sunset: {name: 'Sunset', hero: ['#431407', '#7c2d12', '#c2410c'], light: ['#c2410c', '#7c3aed'], dark: ['#ea580c', '#8b5cf6']},
};
const SET_DEFAULT = {refresh: 60, theme: 'system', palette: 'gsecl', seen: 0};

function loadSettings() {
  try { return {...SET_DEFAULT, ...JSON.parse((hasNative('storeGet') && Native.storeGet('settings')) || '{}')}; }
  catch (e) { return {...SET_DEFAULT}; }
}
function saveSettings() { if (hasNative('storeSet')) Native.storeSet('settings', JSON.stringify(S.set)); }

/** "System" follows the phone's dark-mode setting (the WebView itself always reports light). */
function isDark() {
  if (S.set.theme !== 'system') return S.set.theme === 'dark';
  return hasNative('isSystemDark') ? Native.isSystemDark() : matchMedia('(prefers-color-scheme: dark)').matches;
}

function applyTheme() {
  const p = PALETTES[S.set.palette] || PALETTES.gsecl, dark = isDark(), [b1, b2] = dark ? p.dark : p.light;
  const r = document.documentElement;
  r.dataset.theme = dark ? 'dark' : 'light';
  r.style.setProperty('--brand', b1); r.style.setProperty('--brand2', b2); r.style.setProperty('--accent', b1);
  p.hero.forEach((c, i) => r.style.setProperty('--h' + (i + 1), c));
  if (hasNative('setBars')) Native.setBars(p.hero[0], dark ? '#171e28' : '#ffffff', dark);
}
/** Called by the app when the phone switches between light and dark mode. */
window.onSystemTheme = () => { if (S.set.theme === 'system') { applyTheme(); render(); } };

function renderSettings() {
  $('refRange').value = S.set.refresh;
  $('refVal').textContent = S.set.refresh + ' s';
  document.querySelectorAll('#themeSeg button').forEach(b => b.classList.toggle('on', b.dataset.themeset === S.set.theme));
  $('palList').innerHTML = Object.entries(PALETTES).map(([k, p]) => `<button class="pal ${S.set.palette === k ? 'on' : ''}" data-pal="${k}">
    <i style="background:linear-gradient(135deg, ${p.hero[0]}, ${p.hero[2]} 60%, ${p.light[1]})"></i>${esc(p.name)}</button>`).join('');
}

// ---------------------------------------------------------------- notification history (logged by the app)

function alertLog() {
  try { return hasNative('alertsHistory') ? JSON.parse(Native.alertsHistory()) : []; } catch (e) { return []; }
}

function renderAlertBadge(log = alertLog()) {
  const n = log.filter(a => a.t > S.set.seen).length;
  $('bellCnt').hidden = !n; $('bellCnt').textContent = n > 99 ? '99+' : n;
  $('meCnt').hidden = !n; $('meCnt').textContent = n > 99 ? '99+' : n;
}

function renderAlertLog() {
  const log = alertLog();
  renderAlertBadge(log);
  if (!log.length) { $('alertList').innerHTML = '<div class="muted" style="font-size:13px">No notifications yet. Forced-outage and unit-synchronised alerts appear here with their time.</div>'; return; }
  const day = t => new Date(t).toLocaleDateString('en-GB', {weekday: 'short', day: '2-digit', month: 'short', year: 'numeric'});
  let html = '', last = '';
  for (const a of [...log].reverse()) {
    const d = day(a.t);
    if (d !== last) { html += `<div class="nday">${esc(d)}</div>`; last = d; }
    html += `<div class="nrow"><span class="sd" style="background:${a.kind === 'sync' ? 'var(--run)' : 'var(--forced)'}"></span>
      <div class="nb"><b>${esc(a.title)}${a.t > S.set.seen ? '<span class="nnew">NEW</span>' : ''}</b><div class="nt">${esc(a.text)}</div></div>
      <span class="tm2 num">${tFmt(a.t, false)}</span></div>`;
  }
  $('alertList').innerHTML = html;
}

// ---------------------------------------------------------------- merit order: one row per fuel for gas stations

/** Rate of one merit entry (matched by fuel note for gas stations) in a stored revision. */
function entryCost(rev, key, note) {
  const list = rev.blocks[key];
  if (!list) return null;
  const e = note ? list.find(x => x[2] === note) : list[0];
  return e ? e[0] : null;
}

// ---------------------------------------------------------------- merit order (variable cost)

/** " · ▲ ₹0.12 since 25.09.2026" when the latest revision changed this block's lowest rate. */
function rateChange(key) {
  const h = meritHistory();
  if (h.length < 2) return '';
  const cur = h[h.length - 1].blocks[key]?.[0]?.[0], prev = h[h.length - 2].blocks[key]?.[0]?.[0];
  if (cur == null || prev == null || cur === prev) return h.length >= 2 && cur === prev ? ` · unchanged since ${esc(h[h.length - 2].asOf)}` : '';
  const d = cur - prev;
  return ` · <span class="${d > 0 ? 'neg' : 'pos'}">${d > 0 ? '▲' : '▼'} ₹${fmt(Math.abs(d), 2)}</span> since ${esc(h[h.length - 2].asOf)}`;
}

/** Table: GSECL blocks (cheapest first) against the last four stored revisions, with the change between them. */
function renderMeritHistory(rows) {
  const h = meritHistory().slice(-4);
  let html = `<div class="muted" style="font-size:12px;margin:12px 0 2px">Variable cost history (₹/kWh)</div>
    <div style="overflow-x:auto"><table class="dt num"><tr><th>Block</th>${h.map(e => `<th>${esc(e.asOf)}</th>`).join('')}</tr>`;
  for (const {b, m, multi} of rows) {
    const note = multi ? m.note : null;
    html += `<tr><td>${esc(b.label)}${note ? '<br><span class="muted" style="font-size:11px">' + esc(note) + '</span>' : ''}</td>` + h.map((e, i) => {
      const v = entryCost(e, b.key, note), p = i ? entryCost(h[i - 1], b.key, note) : null;
      const arrow = v != null && p != null && v !== p ? ` <span class="${v > p ? 'neg' : 'pos'}">${v > p ? '▲' : '▼'}</span>` : '';
      return `<td>${v == null ? '—' : fmt(v, 2)}${arrow}</td>`;
    }).join('') + '</tr>';
  }
  html += '</table></div>';
  if (h.length < 2) html += '<div class="muted" style="font-size:11.5px;margin-top:4px">History starts with this revision; each new SLDC merit order adds a column.</div>';
  $('meritHist').innerHTML = html;
}

function renderMerit() {
  const g = S.gsecl;
  if (!g?.ok) return;
  // Gas stations have one merit entry per fuel (high-seas / spot gas), each with its own rank and rate.
  const rows = [];
  g.stations.forEach((s, si) => s.blocks.forEach(b => (b.merit || []).forEach(m => rows.push({s, si, b, m, multi: b.merit.length > 1}))));
  rows.sort((a, b) => a.m.cost - b.m.cost || a.m.rank - b.m.rank);
  const max = Math.max(...rows.map(r => Math.max(r.b.dc || 0, r.b.gen || 0, r.b.sg || 0, r.b.cap || 0)), 1);
  $('meritList').innerHTML = rows.map(({s, si, b, m, multi}) => {
    const gen = Math.max(b.gen || 0, 0);
    let bar, text;
    if (multi) {
      // SG and DC on this fuel come from the GSECL feed's fuel-wise lines; generation is the whole stage.
      const fu = fuelSgDc(g, b.key, m.note);
      bar = `<div class="f" style="width:${Math.max(fu.sg || 0, 0) / max * 100}%;background:${FUEL_COLOR[s.fuel]}"></div>`;
      text = `SG on this gas ${fu.sg === null ? '—' : fmt(fu.sg)} MW · DC ${fu.dc === null ? '—' : fmt(fu.dc)} MW · stage generation ${fmt(gen)} MW`;
    } else {
      bar = `<div class="f" style="width:${gen / max * 100}%;background:${FUEL_COLOR[s.fuel]}"></div>
        ${b.sg ? `<div class="sg" style="left:calc(${Math.min(b.sg / max * 100, 100)}% - 1px)"></div>` : ''}`;
      text = `${fmt(gen)} / ${fmt(b.dc)} MW · ${gen <= 1 ? 'Not generating' : b.dc ? Math.round(gen / b.dc * 100) + '% of DC' : ''}`;
    }
    return `<div class="mo" data-st="${si}"><span class="rk">#${m.rank}</span><span class="nm">${esc(b.label)}${multi ? ` · ${esc(m.note)}` : ''}</span><span class="vc num">₹${fmt(m.cost, 2)}</span>
      <div class="bar">${bar}</div><span class="st2 num">${text}</span></div>`;
  }).join('');
  renderMeritHistory(rows);
  const mc = S.merit, hist = meritHistory();
  $('meritSrc').innerHTML = `Variable cost: SLDC merit order of ${esc(MERIT.asOf)}, rank out of ${MERIT.total} (all sources supplying Gujarat). For gas, the bar is the schedule on that gas (GSECL feed). ` +
    `${hist.length} revision${hist.length > 1 ? 's' : ''} stored on this phone; new SLDC revisions are added automatically when the app is open.` +
    (mc?.ok && mc.added ? ` <b style="color:var(--pos)">New merit order ${esc(mc.date)} added.</b>` : '') +
    (mc && !mc.ok && mc.url ? ` <b style="color:#b45309">${esc(mc.error)}</b>` : '');
}

// ---------------------------------------------------------------- fuel mix donut

function renderMix(g) {
  const basis = S.basis;
  const fuels = Object.entries(g.by_fuel);
  const pos = t => Math.max(t[basis] || 0, 0);   // stopped units can show a small negative (auxiliary) draw
  const total = fuels.reduce((s, [, t]) => s + pos(t), 0);
  if (S.mix && !g.by_fuel[S.mix]) S.mix = '';
  const R = 58, SW = 20, C = 2 * Math.PI * R, GAP = 3;
  let off = 0;
  const arcs = fuels.map(([fu, t]) => {
    const v = pos(t);
    if (!total || v <= 0) return '';
    const len = v / total * C;
    const sel = S.mix === fu, dim = S.mix && !sel;
    const a = `<circle class="seg-arc" data-mix="${esc(fu)}" cx="75" cy="75" r="${R}" fill="none" stroke="${FUEL_COLOR[fu]}"
      stroke-width="${sel ? SW + 8 : SW}" stroke-dasharray="${Math.max(len - GAP, 0.5).toFixed(2)} ${C.toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}" opacity="${dim ? .3 : 1}"/>`;
    off += len;
    return a;
  }).join('');
  const s = S.mix ? g.by_fuel[S.mix] : null;
  const centre = s
    ? `<div><span>${esc(S.mix)}</span><b class="num">${total ? Math.round(pos(s) / total * 100) : 0}%</b><span class="num">${fmt(s[basis])} MW</span></div>`
    : `<div><span>Total ${basis === 'gen' ? 'generation' : 'DC'}</span><b class="num">${fmt(total)}</b><span>MW</span></div>`;
  $('donut').innerHTML = `<svg width="150" height="150" viewBox="0 0 150 150">
      <circle cx="75" cy="75" r="${R}" fill="none" stroke="var(--soft)" stroke-width="${SW}"/>${arcs}</svg><div class="c">${centre}</div>`;

  $('mixList').innerHTML = fuels.map(([fu, t]) => {
    const v = t[basis] || 0, p = total ? pos(t) / total * 100 : 0;
    return `<div class="mrow ${S.mix === fu ? 'on' : S.mix ? 'dim' : ''}" data-mix="${esc(fu)}">
      <span class="sw" style="background:${FUEL_COLOR[fu]}"></span><span class="nm">${esc(fu)}</span><span class="pc num">${p > 0 && p < 10 ? p.toFixed(1) : Math.round(p)}%</span>
      <span class="mb"><i style="width:${p}%;background:${FUEL_COLOR[fu]}"></i></span>
      <span class="mw num">${fmt(v)} MW${basis === 'gen' && t.dc ? ` · ${Math.round(t.gen / t.dc * 100)}% of DC` : ''}</span></div>`;
  }).join('');

  if (!s) { $('mixDetail').innerHTML = '<div class="muted" style="font-size:12px;margin-top:8px">Tap a fuel to see its stations.</div>'; return; }
  const sts = g.stations.filter(x => x.fuel === S.mix);
  const max = Math.max(...sts.map(x => Math.max(x.totals.dc || 0, x.totals.gen)), 1);
  $('mixDetail').innerHTML = `<div class="mixdet"><div class="hd"><b>${esc(S.mix)} stations</b>
      <span class="muted" style="font-size:12px">Gen ${fmt(s.gen)} · DC ${fmt(s.dc)} MW</span><span class="gofuel" data-fuel="${esc(S.mix)}">Open ›</span></div>` +
    sts.map(x => `<div class="srow" data-st="${g.stations.indexOf(x)}"><div class="top"><span class="nm">${esc(x.station)}</span>
      <span class="vals num"><b>${fmt(x.totals.gen)}</b> / ${fmt(x.totals.dc)} MW</span></div>
      <div class="bar"><div class="f" style="width:${x.totals.gen / max * 100}%;background:${FUEL_COLOR[x.fuel]}"></div></div></div>`).join('') + '</div>';
}

function render() { renderHeader(); renderAlerts(); renderHome(); renderGujarat(); renderTrends(); renderPrices(); renderMerit(); renderStations(); renderOutages(); renderInfo(); if ($('v-alerts').classList.contains('on')) renderAlertLog(); }

// ---------------------------------------------------------------- interaction

const SECTION = {home: 'gen', stations: 'gen', outages: 'gen', grid: 'gen', merit: 'gen', alerts: 'gen', dsm: 'dsm', coal: 'coal', safety: 'safety', connect: 'connect', chat: 'chat', info: 'me'};
function show(v) {
  const sec = SECTION[v] || 'gen';
  document.querySelectorAll('.view').forEach(s => s.classList.toggle('on', s.id === 'v-' + v));
  document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('on', b.dataset.sec === sec));
  $('meBtn').classList.toggle('active', sec === 'me');            // Profile opens from the top-right button
  document.querySelectorAll('#genTabs button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
  // The generation sub-tabs and its live-data warnings belong to the Generation section only.
  $('genTabs').hidden = sec !== 'gen';
  $('alerts').hidden = sec !== 'gen';
  if (sec === 'gen' && v !== 'alerts') document.querySelector('#nav button[data-sec="gen"]').dataset.v = v;   // come back to the same sub-tab
  window.scrollTo({top: 0});
  if (v === 'grid') { renderTrends(); renderCompare(); renderPrices(); reFcLoad(); }
  if (v === 'dsm') dsmShow();
  if (v === 'coal') kShow();
  if (v === 'safety') ySafetyShow();
  if (v === 'connect') conShow();
  if (v === 'chat') chShow(); else if (typeof chTick === 'function') chTick();
  if (v === 'info') meRender();
  if (v === 'alerts') { renderAlertLog(); S.set.seen = Date.now(); saveSettings(); setTimeout(renderAlertBadge, 0); }
}
document.addEventListener('click', e => {
  const el = e.target.closest('[data-v],[data-go],[data-st],[data-toggle],[data-fuel],[data-type],[data-metric],[data-range],[data-basis],[data-mix],[data-guj],[data-pref],[data-themeset],[data-pal]');
  if (!el) return;
  const d = el.dataset;
  if (d.v) return show(d.v);
  if (d.themeset) { S.set.theme = d.themeset; saveSettings(); applyTheme(); return render(); }
  if (d.pal) { S.set.palette = d.pal; saveSettings(); applyTheme(); return render(); }
  if (d.guj) { S.guj = S.guj === d.guj ? '' : d.guj; return renderGujarat(); }
  if (d.pref) { const on = !el.classList.contains('on'); Native.alertsSetPref(d.pref, on); return renderNotify(); }
  if (d.metric) { S.metric = d.metric; return renderTrends(); }
  if (d.range) { S.range = d.range === 'custom' ? 'custom' : +d.range; return renderTrends(); }
  if (d.basis) { S.basis = d.basis; document.querySelectorAll('#mixBasis button').forEach(b => b.classList.toggle('on', b.dataset.basis === S.basis)); return S.gsecl?.ok && renderMix(S.gsecl); }
  if (d.mix) { S.mix = S.mix === d.mix ? '' : d.mix; return S.gsecl?.ok && renderMix(S.gsecl); }
  if (d.go) return show(d.go);
  if (d.st !== undefined) {                       // dashboard station row -> open it in Stations
    const i = +d.st;
    S.fuel = ''; S.open.add(i); renderStations(); show('stations');
    setTimeout(() => $('st-' + i)?.scrollIntoView({behavior: 'smooth', block: 'start'}), 60);
    return;
  }
  if (d.toggle !== undefined) {
    const i = +d.toggle;
    S.open.has(i) ? S.open.delete(i) : S.open.add(i);
    $('st-' + i).classList.toggle('open');
    if (S.open.has(i)) renderUnitTrend(i);
    return;
  }
  if (d.fuel !== undefined) {                     // legend tile or filter chip
    S.fuel = d.fuel; renderStations();
    if (el.classList.contains('lg') || el.classList.contains('gofuel')) show('stations');
    return;
  }
  if (d.type !== undefined) {                     // outage count tile or type chip
    if (el.classList.contains('oc')) show('outages');
    S.type = d.type; renderOutages();
  }
});
$('outSearch').addEventListener('input', e => { S.q = e.target.value; renderOutages(); });
$('refreshBtn').addEventListener('click', () => { refreshAll(); meMenu(false); });

/** Profile button: initials of the signed-in employee, and the menu. */
function meMenu(open) {
  const m = $('meMenu');
  if (open === undefined) open = m.hidden;
  if (open) {
    let me = {};
    try { me = JSON.parse(hasNative('account') ? Native.account() : '{}') || {}; } catch (e) { me = {}; }
    const name = typeof conName === 'function' ? conName(me.full_name || '') : (me.full_name || '');
    $('mmName').textContent = name || 'GSECL Connect';
    $('mmSub').textContent = [me.designation, me.station_short || me.station, me.emp_no && 'No. ' + me.emp_no].filter(Boolean).join(' · ');
    $('mmAv').textContent = name ? name.split(' ').filter(Boolean).map((w, i, a) => (i === 0 || i === a.length - 1 ? w[0] : '')).join('').toUpperCase() : 'G';
    const at = /(\d{2}:\d{2}):\d{2}$/.exec(String(S.gsecl?.fetched_at || ''));
    $('mmRef').textContent = at ? 'last ' + at[1] : '';
  }
  m.hidden = !open;
}
$('meBtn').addEventListener('click', e => { e.stopPropagation(); meMenu(); });
document.addEventListener('click', e => {
  if ($('meMenu').hidden) return;
  const item = e.target.closest('.mm-i');
  if (!e.target.closest('#meMenu') || item) setTimeout(() => meMenu(false), 0);
  if (!item || !item.dataset.mm) return;
  const act = item.dataset.mm;
  if (act === 'pass') { if (hasNative('changePassword')) Native.changePassword(); }
  else if (act === 'out') { if (hasNative('logout') && confirm('Sign out on this phone?')) Native.logout(); }
  else { show('info'); setTimeout(() => { const t = act === 'about' ? document.querySelector('#v-info .about') : document.querySelector('#v-info .set-row'); if (t) t.scrollIntoView({behavior: 'smooth', block: 'start'}); }, 60); }
});
window.addEventListener('load', function meInitials() {
  try {
    const me = JSON.parse(hasNative('account') ? Native.account() : '{}') || {};
    const n = typeof conName === 'function' ? conName(me.full_name || '') : '';
    if (n) $('meInit').textContent = n.split(' ').filter(Boolean).map((w, i, a) => (i === 0 || i === a.length - 1 ? w[0] : '')).join('').toUpperCase();
  } catch (e) { /* keep the icon */ }
});
$('trendExport').addEventListener('click', exportTrends);
$('tcApply').addEventListener('click', () => {
  const a = new Date($('tcFrom').value).getTime(), b = new Date($('tcTo').value).getTime();
  if (!(a < b)) return alert('Choose a start before the end.');
  S.cFrom = a; S.cTo = b; trendKey = ''; renderTrends();
});
$('histClear').addEventListener('click', () => {
  if (hasNative('historyClear') && confirm('Delete all stored trend readings from this phone?')) { Native.historyClear(); trendKey = ''; renderTrends(); renderInfo(); }
});
window.addEventListener('resize', () => { renderTrends(); renderPrices(); });
$('refRange').addEventListener('input', e => { S.set.refresh = +e.target.value; $('refVal').textContent = S.set.refresh + ' s'; });
$('accPass').addEventListener('click', () => { if (hasNative('changePassword')) Native.changePassword(); });
// ================================================================ version, what's new, app updates

/** What changed in this version (shown in Profile › About); the newest first. */
const RELEASE_NOTES = [
  ['3.13.9', '24 Oct 2026', [
    'Generation › Today so far, GSECL and Gujarat today: worked out from the readings kept by GSECL Connect, so every device shows the same energy, peak, low and average (this device’s own readings only when the service cannot be reached); the average is time-weighted, in line with the MU']],
  ['3.13.8', '24 Oct 2026', [
    'Generation: notes on the data sources are shown at the foot of the page as a note, not as an error at the top',
    'Outage list sent to GSECL Connect now includes the unit capacity (for the web version)']],
  ['3.13.7', '24 Oct 2026', [
    'Coal › Stock: rakes received in the stock ledger and the daily rake requirement come from the rake trend (rake came inside the station in FOIS); for a day FOIS shows none, the Rake Unloading entry from the Google Sheet is used, so no available figure is left out',
    'Coal › Rake trend: the same rule for received and released']],
  ['3.13.6', '23 Oct 2026', [
    'Blocked or removed accounts are signed out at once, also when only the background monitor or notifications are running; the sign-in screen says why',
    'Publishing (circulars, news, notices) and administration (employees, block / unblock, password reset, phones, login activity) are for super administrators only']],
  ['3.13.5', '23 Oct 2026', [
    'Generation › Dashboard: GSECL and Gujarat today - energy (MU) and maximum MW of Gujarat catered and GSECL with GSECL’s share, and Gujarat solar and wind MU',
    'Daily report: GSECL and Gujarat table - maximum MW and time, MU, share of GSECL (maximum and energy), solar and wind MU',
    'Employees (administrators): Block access / Unblock with a reason - a blocked person is signed out on every phone and told their access is blocked']],
  ['3.13.4', '23 Oct 2026', [
    'Coal › Stock: daily rake requirement at 85 % PLF in the stock ledger (rakes needed per day and rakes received), with a card showing the basis - capacity, actual specific coal, coal per rake - and the 7-day average received against it',
    'DSM: actual injection is now generation less auxiliary consumption (9 % for units up to 210 MW, 5.25 % for 500 MW and above), as SLDC generation is not ex-bus']],
  ['3.13.3', '23 Oct 2026', [
    'SLDC DC / SG relay: reads the API key, token and month lists in the form SLDC actually sends (checked against the live service)']],
  ['3.13.2', '23 Oct 2026', [
    'SLDC DC / SG relay: starts right after the update; a phone not yet allowed asks again within an hour (status in the Sheet menu Test SLDC DC/SG API)']],
  ['3.13.1', '23 Oct 2026', [
    'SLDC DC / SG: SLDC accepts Indian networks only, so the relay phone (a super administrator, or as set in the Sheet) fetches it every 15 minutes and shares it with every device; the year so far is filled in a few hours']],
  ['3.13.0', '23 Oct 2026', [
    'PAF & AFC recovery: full FY 2026-27 history - April to September from the MIS (Digest), October from the daily dashboards and statement; YTD, MTD, cumulative and AFC loss as in the GSECL statement',
    'SLDC DC / SG API (official declared capacity on-bar / off-bar and schedule, 96 blocks) used for PAF, PLF and the DSM estimate when set up',
    'Efficiency: FY 2026-27 up to September (MIS) - generation, PLF, availability, heat rate, specific coal and oil, aux power, coal consumption and GCV',
    'Outage register: April–September outages from the MIS added',
    'Coal › Rake trend: received = rake came inside the station, released = left after being inside (FOIS), the same on every device']],
  ['3.12.2', '23 Oct 2026', [
    'Trends: gaps in this phone’s history (app closed, phone off) are filled from the readings other devices sent to GSECL Connect (last 48 hours, every ~2 minutes)',
    'PAF: normative ex-bus capacity of each PPA group as in the GSECL dashboard (target DC), so PAF = actual DC ÷ target DC as in the daily statement']],
  ['3.12.1', '23 Oct 2026', [
    'PAF: units on reserve shutdown (RSD) count as available (the DC feed shows 0 for them) - gas stations on RSD no longer show 0%; hydro PAF = installed capacity less units on forced / planned outage',
    'AFC actual, loss and asking rate are shown only when YTD PAF covers the year so far; until the past daily PAF is loaded (Sheet tab PafImport) a note explains it, instead of a misleading loss']],
  ['3.12.0', '23 Oct 2026', [
    'PAF and PLF as per CERC Tariff Regulations 2024: PAF = declared capacity ex-bus ÷ [installed × (1 − normative aux)], PLF on the SLDC schedule; by PPA group (UTPS 3-5 … KHPS) with daily, MTD and YTD',
    'New: Connect › More › PAF & fixed cost (AFC) recovery - the GSECL statement with target, cumulative previous month, daily asking rate, AFC to date and loss, reasons, day-wise detail, CSV',
    'DSM estimate as per CERC DSM Regulations 2024 (Reg 8(1) frequency bands and volume limits, Reg 8(12) forced outage) at each PPA group’s energy charge rate, with a block-by-block working',
    'Generation: PAF card now shows PAF live from the declared capacity, day / MTD / YTD and the AFC loss; "PLF now" renamed "Loading now" (gross MW ÷ installed)',
    'Daily report: PAF and AFC recovery statement, CERC DSM estimate, outage MW filled in, tables printed at one size']],
  ['3.11.0', '23 Oct 2026', [
    'Shared live data: when this phone cannot reach SLDC, the GSECL feed, IEX or FOIS, it shows the latest reading another phone shared through GSECL Connect (checked every minute, marked “Shared” with its time)',
    'Each phone shares its own readings when the service asks for them; FOIS rake lists are also kept in the Google Sheet (tab FoisRakes)']],
  ['3.10.3', '22 Oct 2026', [
    'Fix: the Generation dashboard stayed on "Connecting…" in 3.10.2 (an error in the page)',
    'Page errors are now shown briefly and reported, so problems can be fixed quickly']],
  ['3.10.2', '22 Oct 2026', [
    'New: Connect › More › AOH / COH planning - planned shutdowns of every unit by financial year (FY 2026-27 and 2027-28 loaded; later years can be added), year timeline with boiler certificate expiry, under shutdown now / next 90 days, CSV export',
    'Boiler certificate check: certificates that run out before the unit’s next planned shutdown are flagged for extension',
    'Unit details (capacity, make, commissioning, boiler no. and expiry) updated from the latest list']],
  ['3.10.1', '22 Oct 2026', [
    'Chat: read receipts - ✓ sent, ✓✓ read (blue when everyone has read); tap your message to see who in a group has read it',
    'Stability: the app no longer closes when Android stops the page renderer (low memory); the background monitor cannot crash the app after an update; crash details are sent to the service to help fix problems']],
  ['3.10.0', '22 Oct 2026', [
    'New Chat tab: end-to-end encrypted messages and documents between GSECL employees - one-to-one and groups (admins add or remove members), replies, delete for everyone, security number to check in person',
    'Messages are encrypted on the phone; the GSECL Connect service and Google keep only encrypted data and cannot read them',
    'Message an employee straight from People (Connect)',
    'Notification of new messages every 15 minutes when the app is closed (the text is not shown in the notification)']],
  ['3.9.4', '22 Oct 2026', [
    'Generation: new Plant availability (PAF) card - PAF now, today so far, yesterday and cumulative PAF (since the first day with data, month to date and FY to date) for thermal, lignite and gas stations and GSECL (RSD counts as available, hydro not included), units not available, CSV export']],
  ['3.9.3', '22 Oct 2026', [
    'DSM: new Estimate tab - deviation charges worked out block by block from live generation, schedule and IEX prices, before SLDC publishes the account',
    'Daily management report redesigned: summary with highlights, generation by fuel and station, PAF of thermal, lignite and gas, outages by kind with days out and overdue returns, DSM estimate and accounts, coal, safety',
    'Outage dates in the report corrected (they were read month-first)',
    'Coal stock: availability days at 85% PLF worked out for every plant, including Sikka']],
  ['3.9.2', '22 Oct 2026', [
    'Daily management report: SLDC generation and outages now come from the app (SLDC does not answer the Google servers)',
    'Tablets: two-column layout up to 1500 px wide, three columns above',
    'Data-source warnings folded into one line']],
  ['3.9.1', '22 Oct 2026', [
    'New Generation dashboard: live summary, today vs yesterday, fuel-wise loading, station table, unit status board, grid context',
    'Profile button at the top right with the menu (profile, notifications, refresh, settings, sign out)',
    'Gujarat page: solar & wind forecast with net load and evening ramp',
    'Outage register: reliability by unit (MTBF, MTTR), repeat boiler tube leaks, cause-wise trend',
    'Daily management report (PDF) for administrators, also e-mailed every morning',
    'Security: app lock with fingerprint / screen lock, encrypted storage on the phone, 7-day sign-in renewed on use, FOIS login kept in the Google Sheet',
    'App updates: a new version put in the Drive folder is offered here and as a notification',
    'Tablets: pages fill the screen in two or three columns; bottom bar spacing fixed']],
  ['3.9.0', '22 Oct 2026', ['DSM pages redesigned; all financial years downloaded automatically with a data check', 'India & Gujarat installed capacity from CEA every month']],
  ['3.8.1', '22 Oct 2026', ['Faster employee administration; new employees appear in minutes']],
  ['3.8.0', '21 Oct 2026', ['Google Authenticator as an alternative to the e-mailed code', 'Code mails removed from the sender\'s Sent folder']],
  ['3.7.1', '21 Oct 2026', ['Super administrator role and approval of extra phones']],
  ['3.7.0', '21 Oct 2026', ['Register / forgot password with e-mail code, one phone per account, login activity, corporate design']],
  ['3.6.0', '19 Oct 2026', ['Efficiency history from 2014-15, outage donuts, birthdays today only']],
];

let updMsg = '', updErr = false;
function renderUpdate() {
  if (!hasNative('updateInfo')) { $('aboutVer').textContent = 'Version 3.9.1'; $('updCard').innerHTML = ''; return; }
  let u = {};
  try { u = JSON.parse(Native.updateInfo()); } catch (e) { u = {}; }
  const cur = u.current || '—', L = u.latest || null, notes = RELEASE_NOTES.find(r => r[0] === cur) || RELEASE_NOTES[0];
  $('aboutVer').textContent = 'Version ' + cur + (u.built ? ' · released ' + u.built : '') + (u.update ? ' · update available' : '');
  const when = u.checked ? new Date(u.checked).toLocaleString('en-IN', {day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'}) : 'not yet';
  $('updCard').innerHTML = `<h2>App version &amp; updates</h2>
    ${u.update ? `<div class="updb" data-upd="install"><div><b>Version ${esc(L.version)} is available</b><span>${L.size ? fmt(L.size / 1048576, 1) + ' MB · ' : ''}${esc(L.date || '')}</span></div><span class="go">Install</span></div>
      ${L.notes ? `<div class="vals" style="margin:-4px 0 10px">${esc(L.notes)}</div>` : ''}` : `<div class="vals" style="margin-bottom:8px">✓ You have the latest version (${esc(cur)}). Last checked ${esc(when)}.</div>`}
    <div class="tstats" style="grid-template-columns:repeat(3,1fr);margin:0 0 10px"><div><span>Installed</span><b class="num">${esc(cur)}</b><small>build ${esc(String(u.code || '—'))}</small></div>
      <div><span>Released</span><b class="num" style="font-size:12.5px;white-space:normal">${esc(u.built || notes[1])}</b></div>
      <div><span>Latest offered</span><b class="num">${u.update ? esc(L.version) : esc(cur)}</b><small>${u.update && L.date ? esc(L.date) : 'checked ' + esc(when)}</small></div></div>
    <b style="font-size:13px">What's new in ${esc(notes[0])} · ${esc(notes[1])}</b><ul class="wn">${notes[2].map(n => `<li>${esc(n)}</li>`).join('')}</ul>
    <details style="margin-top:8px"><summary style="font-size:13px">Version history</summary>${RELEASE_NOTES.filter(r => r !== notes).map(r => `<div style="margin-top:8px;font-size:12.5px"><b>${esc(r[0])}</b> <span class="muted">· ${esc(r[1])}</span><ul class="wn" style="margin-top:2px">${r[2].map(n => `<li>${esc(n)}</li>`).join('')}</ul></div>`).join('')}</details>
    ${updMsg ? `<div class="alert ${updErr ? 'err' : ''}" style="margin:10px 0 0"><span>${updErr ? '⚠' : 'ℹ'}</span><span>${esc(updMsg)}</span></div>` : ''}
    <div style="margin-top:10px"><button class="btn" data-upd="check" style="color:var(--accent)">Check for updates</button>${u.update ? ' <button class="btn" data-upd="install" style="background:var(--accent);color:#fff;border-color:var(--accent)">Download and install</button>' : ''}</div>
    <div class="note-src">Updates are published by the administrator in the GSECL Connect Drive folder “App updates”; the app checks a few times a day. Android installs an update only if it comes from the same publisher as this app.</div>`;
  $('updBanner').innerHTML = u.update ? `<div class="updb" data-upd="open"><div><b>Update available · version ${esc(L.version)}</b><span>Tap to see what's new and install</span></div><span class="go">Update</span></div>` : '';
}
window.onUpdateInfo = renderUpdate;
window.onUpdateMsg = (msg, err) => { updMsg = msg; updErr = !!err; renderUpdate(); };
window.showUpdate = () => { show('info'); setTimeout(() => $('updCard').scrollIntoView({behavior: 'smooth', block: 'start'}), 80); };
document.addEventListener('click', e => {
  const b = e.target.closest('[data-upd]');
  if (!b) return;
  const a = b.dataset.upd;
  if (a === 'open') return window.showUpdate();
  if (a === 'check') { updMsg = 'Checking…'; updErr = false; renderUpdate(); if (hasNative('updateCheck')) Native.updateCheck(); setTimeout(() => { if (updMsg === 'Checking…') { updMsg = ''; renderUpdate(); } }, 15000); return; }
  if (a === 'install') { updMsg = 'Preparing the download…'; updErr = false; renderUpdate(); if (hasNative('updateInstall')) Native.updateInstall(); }
});
window.addEventListener('load', () => { renderUpdate(); if (hasNative('updateRequested') && Native.updateRequested()) window.showUpdate(); });

/** App lock switch (Profile › Account). */
function renderLock() {
  if (!hasNative('appLock')) return;
  const st = Native.appLock();
  $('lockRow').hidden = false;
  $('lockSw').classList.toggle('on', st === 'on');
  $('lockSw').disabled = st === 'none';
  $('lockNote').textContent = st === 'none' ? 'This phone has no screen lock (PIN, pattern, password or fingerprint). Set one in the phone settings to lock the app.'
    : 'Ask for your fingerprint or screen lock when the app is opened, and after a minute away.';
}
$('lockSw').addEventListener('click', () => { if (Native.appLock() === 'none') return; Native.setAppLock(Native.appLock() !== 'on'); renderLock(); });
renderLock();
$('accOut').addEventListener('click', () => { if (hasNative('logout') && confirm('Sign out on this phone?')) Native.logout(); });
$('refRange').addEventListener('change', () => { saveSettings(); tick = 0; });
$('alertClear').addEventListener('click', () => {
  if (hasNative('alertsHistoryClear') && confirm('Clear the notification history?')) { Native.alertsHistoryClear(); renderAlertLog(); }
});

setInterval(() => {
  tick++;
  const every = S.set.refresh;
  if (tick % every === 0) { load('gsecl'); load('home'); }
  if (tick % OUTAGE_EVERY === 0) load('outages');
  if (tick % IEX_EVERY === 0) load('iex');
  const n = every - (tick % every);
  $('stampNext').textContent = S.loading ? 'Updating…' : `Next update ${n}s`;
}, 1000);

S.set = loadSettings();
applyTheme();
sendUnitLabels();
render();
refreshAll();
