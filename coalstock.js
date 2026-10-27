// Coal stock position: the dashboard and the two daily entry forms of the GSECL coal portal
// (Coal Stock Position, Rake Unloading Status), kept in the GSECL Connect Google Sheet. Shown as the
// "Stock" and "Entry" tabs of the Coal view, next to the railway (FOIS) rake tabs from coal.js.
// Also decides which pages the signed-in employee may see (granted from Connect > More > Employees).
// Uses conCall/conSaved from connect.js, K/kRakes/kInside from coal.js, and $, esc, fmt, niceTicks, show().

const SP = {
  data: null, busy: false, error: '', note: '', date: '',
  scope: 'ALL', range: 15,
  days: 90,                                   // days of entries read from the sheet (more when a custom trend period asks for it)
  cal: {open: false, month: ''},              // the "position as of" calendar
  tr: {range: 30, from: '', to: '', scope: 'ALL'},   // receipt / consumption / stock trend
  form: 'stock', edit: {stock: null, unload: null}, saving: false,
};
const SP_NAME = {WTPS: 'Wanakbori', GTPS: 'Gandhinagar', STPS: 'Sikka', UTPS: 'Ukai', BLTPS: 'Bhavnagar lignite', KLTPS: 'Kutch lignite'};
const spLignite = p => (SP.data?.lignite_plants || ['BLTPS', 'KLTPS']).includes(p);
const SP_FOIS = {UKAI: 'UTPS', GTPS: 'GTPS', WTPS: 'WTPS', SIKKA: 'STPS'};          // railway destination -> plant code
const SP_MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ---------------------------------------------------------------- who may see what

/**
 * Page access comes with the signed-in employee's record: view/edit lists set by the administrator.
 * A service script from before page access existed (no "v" marker) gets the earlier behaviour: every
 * page is shown, and the coal stock pages explain that the script needs updating.
 */
function appCan(module, how = 'view') {
  let p = null;
  try { p = JSON.parse(Native.account() || '{}').permissions; } catch (e) { p = null; }
  if (!p || p.v !== 2) return how === 'view';
  return ((how === 'edit' ? p.edit : p.view) || []).includes(module);
}
const appSeeSection = sec => ({gen: appCan('generation'), dsm: appCan('dsm'), coal: appCan('rakes') || appCan('coal'), safety: appCan('safety_obs') || appCan('safety_inc') || appCan('safety_ptw'), connect: true, me: true}[sec] !== false);

/** Hides the bottom-bar entries of pages this employee has not been given. */
function appApplyAccess() {
  if (typeof Native === 'undefined' || !Native.account) return;
  document.querySelectorAll('#nav button').forEach(b => { b.hidden = !appSeeSection(b.dataset.sec); });
  const shown = [...document.querySelectorAll('#nav button')].filter(b => !b.hidden).length;
  $('nav').style.gridTemplateColumns = `repeat(${shown}, 1fr)`;
}
/** Tabs of the Coal view this employee may open. */
function kTabs() {
  const rakes = appCan('rakes'), coal = appCan('coal');
  return [].concat(coal ? [['stock', 'Stock']] : [], rakes ? K_TABS : [], coal && appCan('coal', 'edit') ? [['entry', 'Entry']] : []);
}

// ---------------------------------------------------------------- formatting

const spMt = (v, d = 2) => v === null || v === undefined ? '—' : fmt(v, d);
const spDay = iso => iso ? `${iso.slice(8, 10)} ${SP_MON[+iso.slice(5, 7) - 1]}` : '—';
const spDate = iso => iso ? `${spDay(iso)} ${iso.slice(0, 4)}` : '—';
const spIso = (offset = 0) => { const d = new Date(); d.setDate(d.getDate() + offset); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
/** Availability colour: under 5 days critical, under 10 low, otherwise comfortable. */
const spBadge = days => `<span class="badge ${days < 5 ? 'b-Forced' : days < 10 ? 'b-Planned' : 'b-Running'}">${fmt(days, 1)} days</span>`;
const spBtn = (label, act, arg = '', primary = false) => `<button class="btn" data-sact="${act}" data-sarg="${esc(arg)}" style="${primary ? 'background:var(--accent);color:#fff;border-color:var(--accent)' : 'color:var(--accent)'}">${esc(label)}</button>`;
/** Hours as a number <-> "HH:MM:SS" (demurrage is typed as a duration but stored as hours). */
function spHms(hours) {
  if (hours === null || hours === undefined || hours === '' || isNaN(hours)) return '';
  const sec = Math.round(Number(hours) * 3600), p = n => String(n).padStart(2, '0');
  return `${p(Math.floor(sec / 3600))}:${p(Math.floor(sec % 3600 / 60))}:${p(sec % 60)}`;
}
/** "8", "08:30" or "08:30:00" -> hours; null when it is not a valid duration. */
function spHours(text) {
  const m = /^(\d{1,3})(?::([0-5]\d))?(?::([0-5]\d))?$/.exec(String(text).trim());
  return m ? Math.round((+m[1] + (+m[2] || 0) / 60 + (+m[3] || 0) / 3600) * 1e6) / 1e6 : null;
}
const spEmpty = t => `<div class="empty">${esc(t)}</div>`;
const spMsg = () => (SP.error ? `<div class="alert err"><span>⚠</span><span>${esc(SP.error)}</span></div>` : '')
  + (SP.note ? `<div class="alert" style="background:#dcfce7;color:#166534;border-color:#bbf7d0"><span>✓</span><span>${esc(SP.note)}</span></div>` : '');

// ---------------------------------------------------------------- data

/** Seconds between re-reads of the sheet while a coal stock tab is open; 0 = only on opening and on demand. Set in Profile. */
const spInterval = () => (typeof S !== 'undefined' && S.set && S.set.coalSync !== undefined ? +S.set.coalSync : 60);

/**
 * Reads the coal entries from the Google Sheet. The saved copy is shown first; the sheet is then read
 * again unless that was done within the sync interval. A quiet read (the timer) redraws only if
 * something changed, and never while a figure is being typed, so the form and keyboard are left alone.
 */
async function spLoad(force = false, quiet = false) {
  if (SP.busy || typeof Connect === 'undefined') return;
  const saved = conSaved('coal_data');
  if (saved && !SP.data) SP.data = saved.data;
  if (!force && SP.last && Date.now() - SP.last < Math.max(spInterval(), 20) * 1000) return quiet ? undefined : kRender();
  SP.busy = true;
  if (!quiet) { SP.error = ''; kRender(); }
  const r = await conCall('coal_data', {days: SP.days});
  SP.busy = false;
  if (r.ok) {
    const body = JSON.stringify(r.data), changed = body !== JSON.stringify(SP.data);
    SP.data = r.data; SP.last = Date.now(); SP.error = '';
    Connect.cacheSet('coal_data', body);
    if (quiet && !changed) return spStamp();
  } else if (!quiet || !SP.data) {
    SP.error = /unknown action/i.test(r.error) ? 'The GSECL Connect script in the Google Sheet has not been updated yet, so coal stock data is not available. Paste the new Code.gs and deploy a new version.' : r.error;
  } else return;
  if (quiet && document.activeElement && /^sp_/.test(document.activeElement.id || '')) return;   // typing: show it at the next redraw
  spKeepTyped();
  kRender();
}

/** Before a redraw of the entry form, remember what has been typed but not saved. */
function spKeepTyped() {
  if (!$('sp_date') || !SP.edit[SP.form]) return;
  const v = spRead();
  if (v.dem_text) { if (v.dem_hrs === '') v.dem_hrs = v.dem_text; delete v.dem_text; }
  SP.edit[SP.form] = {...SP.edit[SP.form], ...v};
}

const spClock = () => (SP.last ? new Date(SP.last).toLocaleTimeString('en-IN', {hour: '2-digit', minute: '2-digit', second: '2-digit'}) : '—');
/** "Synced from Google Sheet 12:40:05 · Sync now" */
const spSyncLine = () => `<div class="note-src" id="spStamp" style="text-align:center;margin:0 0 8px">${SP.busy ? 'Reading the Google Sheet…' : `Synced from the Google Sheet at ${spClock()}`}${
  spInterval() ? ` · every ${spInterval() < 60 ? spInterval() + ' s' : spInterval() / 60 + ' min'}` : ' · automatic sync off'} · <a data-sact="sync">Sync now</a></div>`;
function spStamp() { const el = $('spStamp'); if (el) el.outerHTML = spSyncLine(); }

// While a coal stock tab is on screen, re-read the sheet at the chosen interval, so entries changed or
// deleted in the sheet (or entered from another phone) show up without reopening the app.
setInterval(() => {
  const n = spInterval();
  if (!n || document.hidden || typeof K === 'undefined' || !$('v-coal').classList.contains('on') || K.detail || !['stock', 'entry'].includes(K.tab) || SP.saving) return;
  if (!SP.last || Date.now() - SP.last >= n * 1000) spLoad(true, true);
}, 5000);

const spStock = () => SP.data?.stock || [];
const spUnload = () => SP.data?.unloading || [];
/** Latest date that has a completed stock figure (the portal's "position as of"). */
function spLatest() {
  const done = spStock().filter(r => (r.end_stock || 0) > 0).map(r => r.date);
  const all = done.length ? done : spStock().map(r => r.date);
  return all.length ? all.reduce((a, b) => (a > b ? a : b)) : '';
}
const spOn = (rows, date) => rows.filter(r => r.date === date);
const spPrevOf = (rows, plant, date) => rows.filter(r => r.plant === plant && r.date < date).sort((a, b) => (a.date < b.date ? 1 : -1))[0] || null;

// ---------------------------------------------------------------- Stock tab (the portal dashboard)

function sTabStock() {
  if (typeof Connect === 'undefined') return `<div class="card">${spEmpty('Coal stock position is available in the Android app.')}</div>`;
  if (!SP.data && !SP.busy && !SP.error) { spLoad(); return '<div class="sk" style="height:120px"></div>'; }
  let h = spMsg() + spSyncLine();
  if (!SP.data) return h;
  const dates = [...new Set(spStock().map(r => r.date))].sort().reverse();
  const date = dates.includes(SP.date) ? SP.date : spLatest();
  if (!date) return h + `<div class="card">${spEmpty('No coal stock position has been entered yet.')}${appCan('coal', 'edit') ? spBtn('Enter today\'s figures', 'tab', 'entry', true) : ''}</div>` + sFois();
  const rows = SP.data.plants.map(p => spOn(spStock(), date).find(r => r.plant === p)).filter(Boolean);
  const coalRows = rows.filter(r => !spLignite(r.plant)), ligRows = rows.filter(r => spLignite(r.plant));
  const sum = k => coalRows.reduce((t, r) => t + (r[k] || 0), 0), avg = coalRows.length ? sum('availability_days') / coalRows.length : 0;
  const critical = rows.filter(r => (r.availability_days || 0) < 5 && (r.end_stock || 0) > 0);

  h += sCalendar(dates, date);
  if (critical.length) h += `<div class="alert err"><span>⚠</span><span>Critical stock (under 5 days): ${critical.map(r => `${r.plant} ${fmt(r.availability_days, 1)} days`).join(', ')}</span></div>`;
  h += `<div class="card"><h2>GSECL coal stock position <span class="more muted" style="font-weight:500;font-size:11.5px">${spDate(date)}</span></h2>
    <div class="gen"><div><div class="lbl">Total coal stock</div><div class="big num">${spMt(sum('end_stock'), 0)} <small>MT</small></div></div></div>
    <div class="tstats" style="grid-template-columns:repeat(3,1fr);margin-top:12px">
      <div><span>Daily receipt</span><b class="num pos">+${spMt(sum('receipt'), 0)}</b><small>MT</small></div>
      <div><span>Daily consumption</span><b class="num" style="color:var(--coal)">−${spMt(sum('consumption'), 0)}</b><small>MT</small></div>
      <div><span>Avg availability</span><b class="num">${fmt(avg, 1)} days</b><small>${coalRows.length} plant${coalRows.length === 1 ? '' : 's'}</small></div>
    </div></div>`;
  h += sLignite(date);

  setTimeout(spRakeEvLoad, 0);
  const req = spRakeReq(), recd = p => spRecd(p, date), reqTot = Object.values(req).reduce((t, x) => t + x.rakes_per_day, 0);
  const recdAll = rows.map(r => recd(r.plant)), recdTot = recdAll.some(x => x.n !== null) ? {n: recdAll.reduce((t, x) => t + (x.n || 0), 0), src: recdAll.some(x => x.src === 'fois') ? 'fois' : 'entry', entered: null} : null;
  h += `<div class="card"><h2>Power station stock ledger <span class="more muted" style="font-weight:500;font-size:11.5px">MT · rakes</span></h2><div style="overflow-x:auto"><table class="dt num">
    <tr><th>Station</th><th>Prev<br>stock</th><th>Receipt</th><th>Consump.</th><th>End<br>stock</th><th>Avail.</th><th>Rakes<br>req./day</th><th>Rakes<br>recd.</th></tr>
    ${rows.map(r => `<tr><td><b>${esc(r.plant)}</b>${spLignite(r.plant) ? ' <small class="muted">lignite</small>' : ''}</td><td>${spMt(r.prev_stock, 0)}</td><td class="pos">+${spMt(r.receipt, 0)}</td><td style="color:var(--coal)">−${spMt(r.consumption, 0)}</td><td><b>${spMt(r.end_stock, 0)}</b></td><td>${spBadge(r.availability_days || 0)}</td><td><b>${req[r.plant] ? fmt(req[r.plant].rakes_per_day, 1) : '—'}</b></td><td>${spRecdCell(recd(r.plant), req[r.plant])}</td></tr>`).join('')}
    <tr class="hl"><td>GSECL coal</td><td>${spMt(sum('prev_stock'), 0)}</td><td class="pos">+${spMt(sum('receipt'), 0)}</td><td style="color:var(--coal)">−${spMt(sum('consumption'), 0)}</td><td>${spMt(sum('end_stock'), 0)}</td><td>${spBadge(avg)}</td><td>${reqTot ? fmt(reqTot, 1) : '—'}</td><td>${spRecdCell(recdTot, reqTot ? {rakes_per_day: reqTot} : null)}</td></tr></table></div>
    <div class="note-src">Rakes req./day = rakes needed each day at 85 % PLF (basis in the card below). Rakes recd. = rakes that came inside the station that day in FOIS (rake trend); where FOIS shows none for the day, the Rake Unloading entry from the Google Sheet is used (entered figure in brackets where it differs); red when short of the requirement.${spRakeEv.list ? '' : ' Reading the FOIS events…'}</div>
    ${SP.data.plants.filter(p => !rows.some(r => r.plant === p)).length ? `<div class="note-src">No entry for ${SP.data.plants.filter(p => !rows.some(r => r.plant === p)).join(', ')} on this date.</div>` : ''}</div>`;

  h += sRakeReq(rows, date);

  h += `<div class="card"><h2>Stock against storage capacity</h2>${rows.filter(r => !spLignite(r.plant) || r.max_capacity_mt).map(r => {
    const pct = r.max_capacity_mt ? Math.min(100, (r.end_stock || 0) / r.max_capacity_mt * 100) : 0;
    return `<div class="srow" style="cursor:default"><div class="top"><span class="nm">${esc(r.plant)} <span class="muted" style="font-weight:400">${esc(SP_NAME[r.plant] || '')}</span></span><span class="vals num"><b>${r.max_capacity_mt ? fmt(pct, 0) + '%' : '—'}</b></span></div>
      <div class="vals num">${spMt(r.end_stock, 0)} of ${spMt(r.max_capacity_mt, 0)} MT · ${fmt(r.availability_days || 0, 1)} of ${r.max_capacity_days ?? '—'} days</div>
      <div class="bar"><div class="f" style="width:${pct}%;background:var(${(r.availability_days || 0) < 5 ? '--forced' : (r.availability_days || 0) < 10 ? '--planned' : '--run'})"></div></div></div>`;
  }).join('')}</div>`;

  h += sTrend() + sCombo() + sRakeTrend() + sUnloadTable() + sFois();
  return h;
}

/**
 * "Position as of" date chosen on a month calendar. Days with an entry are highlighted and can be
 * chosen; the chosen day is filled; days without figures are greyed.
 */
function sCalendar(dates, date) {
  const have = new Set(dates), C = SP.cal;
  if (!C.month) C.month = date.slice(0, 7);
  const [y, m] = C.month.split('-').map(Number), first = new Date(y, m - 1, 1), days = new Date(y, m, 0).getDate();
  const lead = (first.getDay() + 6) % 7, iso = d => `${C.month}-${String(d).padStart(2, '0')}`;
  const months = [...new Set(dates.map(d => d.slice(0, 7)))].sort(), prev = months.filter(x => x < C.month).pop(), next = months.find(x => x > C.month);
  const cells = Array.from({length: lead}, () => '<span></span>').concat(Array.from({length: days}, (_, k) => {
    const d = iso(k + 1), on = d === date, ok = have.has(d);
    return `<button ${ok ? `data-sact="calday" data-sarg="${d}"` : 'disabled'} style="border:0;border-radius:10px;padding:8px 0;font:inherit;font-size:13px;font-weight:${ok ? 700 : 400};
      background:${on ? 'var(--accent)' : ok ? 'color-mix(in srgb, var(--accent) 16%, transparent)' : 'transparent'};color:${on ? '#fff' : ok ? 'var(--ink)' : 'var(--muted)'};opacity:${ok ? 1 : .45}">${k + 1}</button>`;
  })).join('');
  return `<div class="card" style="padding:10px 12px"><div style="display:flex;align-items:center;gap:8px;cursor:pointer" data-sact="cal">
      <span style="font-size:18px">📅</span><div style="flex:1"><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.05em">Position as of</div><b>${spDate(date)}</b></div>
      <span class="muted" style="font-size:12px">${dates.length} days with figures ${C.open ? '▲' : '▼'}</span></div>
    ${C.open ? `<div style="display:flex;align-items:center;justify-content:space-between;margin:12px 0 6px">
        <button class="btn" ${prev ? `data-sact="calm" data-sarg="${prev}"` : 'disabled'} style="margin:0;padding:6px 12px">‹</button>
        <b>${SP_MON[m - 1]} ${y}</b>
        <button class="btn" ${next ? `data-sact="calm" data-sarg="${next}"` : 'disabled'} style="margin:0;padding:6px 12px">›</button></div>
      <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px;text-align:center">
        ${['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map(w => `<span class="muted" style="font-size:11px">${w}</span>`).join('')}${cells}</div>
      <div class="keyline"><span><i style="width:12px;height:12px;border-radius:4px;background:color-mix(in srgb, var(--accent) 16%, transparent)"></i>figures entered</span><span><i style="width:12px;height:12px;border-radius:4px;background:var(--accent)"></i>shown</span></div>` : ''}</div>`;
}

// ---------------------------------------------------------------- receipt, consumption and stock, date-wise

const SP_TR = [['7', '7 days'], ['15', '15 days'], ['30', '30 days'], ['90', '90 days'], ['custom', 'Custom']];
const spIsoAgo = n => { const d = new Date(Date.now() - n * 864e5); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

/** Two charts on one date axis: end-of-day stock (MT), and daily receipt against consumption (MT). */
function sTrend() {
  const T = SP.tr, plants = SP.data.plants;
  const from = T.range === 'custom' && T.from ? T.from : spIsoAgo((+T.range || 30) - 1), to = T.range === 'custom' && T.to ? T.to : spIsoAgo(0);
  const oldest = spIsoAgo(SP.days - 1);
  if (from < oldest && !SP.busy) {                       // older than what was read: read further back once
    SP.days = Math.min(1500, Math.ceil((Date.now() - new Date(from + 'T00:00:00').getTime()) / 864e5) + 2);
    setTimeout(() => spLoad(true), 0);
  }
  const scope = T.scope === 'ALL' ? plants : [T.scope];
  const rows = spStock().filter(r => r.date >= from && r.date <= to && scope.includes(r.plant));
  const dates = [...new Set(rows.map(r => r.date))].sort();
  const sum = (d, k) => rows.filter(r => r.date === d).reduce((t, r) => t + (r[k] || 0), 0);
  SP.trend = {dates, scope, rows};
  const tot = k => rows.reduce((t, r) => t + (r[k] || 0), 0);
  return `<div class="card"><h2>Receipt, consumption and stock <span class="more muted" style="font-weight:500;font-size:11.5px">MT, date-wise</span></h2>
    <div class="chips" style="padding-bottom:6px">${['ALL'].concat(plants).map(p => `<button class="chip ${T.scope === p ? 'on' : ''}" data-sact="trscope" data-sarg="${p}" style="padding:5px 12px">${p === 'ALL' ? 'All GSECL' : p}</button>`).join('')}</div>
    <div class="chips" style="padding-bottom:6px">${SP_TR.map(([k, l]) => `<button class="chip ${String(T.range) === k ? 'on' : ''}" data-sact="trrange" data-sarg="${k}" style="padding:5px 12px">${l}</button>`).join('')}</div>
    ${T.range === 'custom' ? `<div style="display:grid;grid-template-columns:1fr 1fr auto;gap:6px;align-items:end;margin-bottom:8px">
      <label style="font-size:11px;color:var(--muted)">From<input class="search" id="spTrF" type="date" value="${from}" style="margin:2px 0 0;padding:8px"></label>
      <label style="font-size:11px;color:var(--muted)">To<input class="search" id="spTrT" type="date" value="${to}" style="margin:2px 0 0;padding:8px"></label>
      <button class="btn" data-sact="trapply" style="background:var(--accent);color:#fff;border-color:var(--accent);margin:0">Show</button></div>` : ''}
    ${dates.length ? `<div class="tstats" style="grid-template-columns:repeat(3,1fr)">
        <div><span>Receipt</span><b class="num pos">${spMt(tot('receipt'), 0)}</b><small>MT in ${dates.length} days</small></div>
        <div><span>Consumption</span><b class="num" style="color:var(--coal)">${spMt(tot('consumption'), 0)}</b><small>MT</small></div>
        <div><span>Stock ${spDay(dates[dates.length - 1])}</span><b class="num">${spMt(sum(dates[dates.length - 1], 'end_stock'), 0)}</b><small>MT · was ${spMt(sum(dates[0], 'end_stock'), 0)} on ${spDay(dates[0])}</small></div></div>
      <div class="muted" style="font-size:12px;margin:10px 0 2px">End-of-day stock (MT)</div><div class="chart" id="spTrStock"></div>
      <div class="muted" style="font-size:12px;margin:10px 0 2px">Receipt and consumption per day (MT)</div><div class="chart" id="spTrFlow"></div>
      <div class="keyline"><span><i style="width:14px;height:8px;border-radius:3px;background:var(--run)"></i>Receipt</span><span><i style="width:14px;height:8px;border-radius:3px;background:var(--coal)"></i>Consumption</span>${T.scope === 'ALL' ? plants.map((p, i) => `<span><i style="width:14px;height:3px;background:var(--s${i + 1})"></i>${p} stock</span>`).join('') : '<span><i style="width:14px;height:3px;background:var(--accent)"></i>Stock</span>'}</div>
      ${csvBtn('spTr', `Coal_${T.scope === 'ALL' ? 'GSECL' : T.scope}_${from}_${to}`, ['Date', 'Plant', 'Opening stock MT', 'Receipt MT', 'Consumption MT', 'End stock MT', 'Availability days'],
        rows.slice().sort((a, b) => a.date.localeCompare(b.date) || String(a.plant).localeCompare(String(b.plant))).map(r => [r.date, r.plant, r.prev_stock, r.receipt, r.consumption, r.end_stock, r.availability_days]))}`
      : spEmpty(SP.busy ? 'Reading the Google Sheet…' : 'No entries in this period.')}</div>`;
}

function sDrawTrend() {
  const T = SP.trend, sb = $('spTrStock'), fb = $('spTrFlow');
  if (!T || !sb || !fb || !T.dates.length) return;
  const n = T.dates.length, W = Math.max(sb.clientWidth || 300, 240), L = 48, R = 8, Tp = 8, B = 22;
  const slot = (W - L - R) / n, x = i => L + (i + 0.5) * slot, every = Math.max(1, Math.ceil(n / ((W - L - R) / 40)));
  const kt = v => (v >= 100000 ? fmt(v / 100000, v >= 1e6 ? 0 : 1) + 'L' : v >= 1000 ? fmt(v / 1000, 0) + 'k' : fmt(v, 0));
  const xl = H => T.dates.map((d, i) => (i % every && i !== n - 1 ? '' : `<text class="ax" x="${x(i)}" y="${H - 5}" text-anchor="middle">${spDay(d)}</text>`)).join('');
  const val = (d, p, k) => { const r = T.rows.find(x => x.date === d && x.plant === p); return r ? r[k] : null; };
  const sum = (d, k) => T.rows.filter(r => r.date === d).reduce((t, r) => t + (r[k] || 0), 0);
  // Stock lines: one per plant for All GSECL (they are of similar size), or the plant's own.
  const lines = SP.tr.scope === 'ALL' ? T.scope.map((p, i) => ({name: p, colour: `var(--s${i + 1})`, v: T.dates.map(d => val(d, p, 'end_stock'))})) : [{name: T.scope[0], colour: 'var(--accent)', v: T.dates.map(d => val(d, T.scope[0], 'end_stock'))}];
  const H1 = 170, hi1 = Math.max(1, ...lines.flatMap(l => l.v.filter(v => v !== null))) * 1.1, y1 = v => Tp + (1 - v / hi1) * (H1 - Tp - B);
  const path = v => { let d = '', pen = false; v.forEach((q, i) => { if (q === null) { pen = false; return; } d += (pen ? 'L' : 'M') + x(i).toFixed(1) + ',' + y1(q).toFixed(1); pen = true; }); return d; };
  sb.innerHTML = `<svg viewBox="0 0 ${W} ${H1}" height="${H1}" role="img" aria-label="End-of-day coal stock">
    ${niceTicks(0, hi1, 4).map(v => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y1(v)}" y2="${y1(v)}"/><text class="ax" x="${L - 5}" y="${y1(v) + 3.5}" text-anchor="end">${kt(v)}</text>`).join('')}
    ${lines.map(l => `<path d="${path(l.v)}" fill="none" style="stroke:${l.colour}" stroke-width="2" stroke-linejoin="round"/>${l.v.map((q, i) => (q === null ? '' : `<circle cx="${x(i)}" cy="${y1(q)}" r="${n > 40 ? 0 : 3}" style="fill:${l.colour}"/>`)).join('')}`).join('')}
    ${xl(H1)}${T.dates.map((d, i) => `<rect x="${L + i * slot}" y="${Tp}" width="${slot}" height="${H1 - Tp - B}" fill="transparent" data-tip="${esc(`<b>${spDate(d)}</b>` + lines.map(l => `<br>${esc(l.name)} stock ${l.v[i] === null ? '—' : fmt(l.v[i], 0) + ' MT'}`).join(''))}"/>`).join('')}
  </svg><div class="tip" style="display:none;white-space:normal;text-align:left;min-width:150px"></div>`;
  const H2 = 160, hi2 = Math.max(1, ...T.dates.map(d => Math.max(sum(d, 'receipt'), sum(d, 'consumption')))) * 1.1, y2 = v => Tp + (1 - v / hi2) * (H2 - Tp - B);
  const bw = Math.max(2, Math.min(slot * 0.36, 14));
  fb.innerHTML = `<svg viewBox="0 0 ${W} ${H2}" height="${H2}" role="img" aria-label="Daily coal receipt and consumption">
    ${niceTicks(0, hi2, 4).map(v => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y2(v)}" y2="${y2(v)}"/><text class="ax" x="${L - 5}" y="${y2(v) + 3.5}" text-anchor="end">${kt(v)}</text>`).join('')}
    ${T.dates.map((d, i) => { const r = sum(d, 'receipt'), c = sum(d, 'consumption');
      return `<rect x="${x(i) - bw - 1}" y="${y2(r)}" width="${bw}" height="${Math.max(0, y2(0) - y2(r))}" rx="2" style="fill:var(--run)"/><rect x="${x(i) + 1}" y="${y2(c)}" width="${bw}" height="${Math.max(0, y2(0) - y2(c))}" rx="2" style="fill:var(--coal)"/>
        <rect x="${L + i * slot}" y="${Tp}" width="${slot}" height="${H2 - Tp - B}" fill="transparent" data-tip="${esc(`<b>${spDate(d)}</b><br>Receipt ${fmt(r, 0)} MT<br>Consumption ${fmt(c, 0)} MT<br>Net ${r - c >= 0 ? '+' : '−'}${fmt(Math.abs(r - c), 0)} MT`)}"/>`; }).join('')}
    ${xl(H2)}
  </svg><div class="tip" style="display:none;white-space:normal;text-align:left;min-width:140px"></div>`;
}

/** Receipt and consumption bars with availability (days) and rakes received lines, by day. */
function sCombo() {
  const from = spIso(1 - SP.range), plants = SP.scope === 'ALL' ? SP.data.plants : [SP.scope];
  const dates = [...new Set(spStock().filter(r => r.date >= from && plants.includes(r.plant)).map(r => r.date))].sort();
  const pts = dates.map(d => {
    const st = spOn(spStock(), d).filter(r => plants.includes(r.plant));
    // rakes received: FOIS (a rake inside the station counts as received), else the entered unloading figure
    const rkPlants = plants.filter(p => (SP.data.rake_plants || SP.data.plants).includes(p)), rk = rkPlants.reduce((t, p) => t + (spRecd(p, d).n || 0), 0);
    return {d, rec: st.reduce((t, r) => t + (r.receipt || 0), 0), con: st.reduce((t, r) => t + (r.consumption || 0), 0),
      av: st.length ? st.reduce((t, r) => t + (r.availability_days || 0), 0) / st.length : 0, rk};
  });
  SP.combo = pts;
  return `<div class="card"><h2>Coal and rake movement</h2>
    <div class="chips" style="padding-bottom:6px">${['ALL'].concat(SP.data.plants).map(p => `<button class="chip ${SP.scope === p ? 'on' : ''}" data-sact="scope" data-sarg="${p}" style="padding:5px 12px">${p === 'ALL' ? 'All GSECL' : p}</button>`).join('')}</div>
    <div class="seg" style="margin-bottom:8px">${[7, 15, 30].map(n => `<button class="${SP.range === n ? 'on' : ''}" data-sact="range" data-sarg="${n}">${n} days</button>`).join('')}</div>
    <div class="chart" id="spCombo"></div>
    <div class="keyline"><span><i style="width:14px;height:8px;border-radius:4px;background:var(--run)"></i>Receipt MT</span><span><i style="width:14px;height:8px;border-radius:4px;background:var(--coal)"></i>Consumption MT</span>
      <span><i style="width:14px;height:3px;background:var(--accent)"></i>Availability days</span><span><i style="width:14px;height:3px;background:var(--hydro)"></i>Rakes received</span></div>
    ${pts.length ? csvBtn('spCombo', `Coal_rake_movement_${SP.scope === 'ALL' ? 'GSECL' : SP.scope}_${SP.range}d`, ['Date', 'Receipt MT', 'Consumption MT', 'Availability days (avg)', 'Rakes received'], pts.map(p => [p.d, p.rec, p.con, +p.av.toFixed(2), p.rk])) : ''}</div>`;
}

function sDrawCombo() {
  const box = $('spCombo'), pts = SP.combo || [];
  if (!box) return;
  if (!pts.length) { box.innerHTML = spEmpty('No entries in this period.'); return; }
  const W = Math.max(box.clientWidth || 320, 240), H = 210, L = 46, R = 30, T = 28, B = 22;
  const hiL = Math.max(1, ...pts.map(p => Math.max(p.rec, p.con))) * 1.1, hiR = Math.max(1, ...pts.map(p => Math.max(p.av, p.rk))) * 1.15;
  const slot = (W - L - R) / pts.length, bw = Math.min(slot * 0.34, 14);
  const x = i => L + (i + 0.5) * slot, yL = v => T + (1 - v / hiL) * (H - T - B), yR = v => T + (1 - v / hiR) * (H - T - B);
  const line = k => pts.map((p, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ',' + yR(p[k]).toFixed(1)).join('');
  const every = Math.max(1, Math.ceil(pts.length / ((W - L - R) / 34)));
  const kt = v => v >= 1000 ? fmt(v / 1000, v >= 10000 ? 0 : 1) + 'k' : fmt(v);
  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img">
    ${niceTicks(0, hiL, 4).map(v => `<line class="grid" x1="${L}" x2="${W - R}" y1="${yL(v)}" y2="${yL(v)}"/><text class="ax" x="${L - 5}" y="${yL(v) + 3.5}" text-anchor="end">${kt(v)}</text>`).join('')}
    ${niceTicks(0, hiR, 4).map(v => `<text class="ax" x="${W - R + 5}" y="${yR(v) + 3.5}">${fmt(v)}</text>`).join('')}
    <rect class="dhl" x="0" y="${T}" width="${slot}" height="${H - T - B}" style="fill:var(--soft);display:none"/>
    ${pts.map((p, i) => `<rect x="${x(i) - bw - 1}" y="${yL(p.rec)}" width="${bw}" height="${Math.max(0, yL(0) - yL(p.rec))}" rx="2" style="fill:var(--run)"/><rect x="${x(i) + 1}" y="${yL(p.con)}" width="${bw}" height="${Math.max(0, yL(0) - yL(p.con))}" rx="2" style="fill:var(--coal)"/>`).join('')}
    <path d="${line('av')}" fill="none" style="stroke:var(--accent)" stroke-width="2" stroke-linejoin="round"/>
    <path d="${line('rk')}" fill="none" style="stroke:var(--hydro)" stroke-width="2" stroke-linejoin="round" stroke-dasharray="4 3"/>
    ${pts.map((p, i) => `<circle cx="${x(i)}" cy="${yR(p.av)}" r="2.500" style="fill:var(--accent)"/>`).join('')}
    ${pts.map((p, i) => i % every ? '' : `<text class="ax" x="${x(i)}" y="${H - 6}" text-anchor="middle">${spDay(p.d)}</text>`).join('')}
  </svg><div class="tip" style="display:none"></div>`;
  const svg = box.querySelector('svg'), tip = box.querySelector('.tip'), hl = box.querySelector('.dhl');
  const at = ev => {
    const r = svg.getBoundingClientRect(), px = (ev.clientX - r.left) * W / r.width, i = Math.min(pts.length - 1, Math.max(0, Math.floor((px - L) / slot))), p = pts[i];
    hl.style.display = ''; hl.setAttribute('x', L + i * slot);
    tip.style.display = ''; tip.innerHTML = `<b>${spDay(p.d)}</b> · +${fmt(p.rec)} / −${fmt(p.con)} MT · ${fmt(p.av, 1)} d · ${fmt(p.rk)} rakes`;
    const half = tip.offsetWidth / 2 + 4;
    tip.style.left = Math.min(Math.max(x(i) / W * r.width, half), r.width - half) + 'px';
  };
  svg.addEventListener('pointerdown', at);
  svg.addEventListener('pointermove', at);
}

/**
 * Rake receipts and releases from FOIS, the same on every device: received = the rake's FOIS status became
 * "Inside" the station; released = a rake that was inside has left the FOIS report (worked out by the GSECL
 * Connect service from the rake lists the phones share). Loaded = rakes in the current list loaded that day.
 */
let spRakeEv = {at: 0, busy: false, list: null};
async function spRakeEvLoad() {
  if (spRakeEv.busy || Date.now() - spRakeEv.at < 5 * 60e3 || typeof conCall !== 'function' || !hasConnect()) return;
  spRakeEv.busy = true;
  const r = await conCall('rake_trend', {days: 31});
  spRakeEv.busy = false; spRakeEv.at = Date.now();
  if (r.ok) { spRakeEv.list = r.data.events || []; if (typeof kRender === 'function') kRender(); }
}
// ---------------------------------------------------------------- rakes needed at 85 % PLF

/**
 * {plant: {capacity_mw, kg_per_kwh, kg_src, mt_per_day, rake_mt, rake_src, rakes_per_day}} from the service; worked out
 * here from the plant master (3,800 MT a rake) when the script in the Sheet is older.
 */
function spRakeReq() {
  if (SP.data?.rake_req && Object.keys(SP.data.rake_req).length) return SP.data.rake_req;
  const out = {};
  Object.entries(SP.data?.master || {}).forEach(([p, m]) => {
    if (!m.capacity_mw) return;
    const kg = m.coal_kg_per_kwh || 0.7, mt = m.capacity_mw * 24 * 0.85 * kg;
    out[p] = {capacity_mw: m.capacity_mw, kg_per_kwh: kg, kg_src: 'plant master', mt_per_day: Math.round(mt), rake_mt: 3800, rake_src: 'default', rakes_per_day: Math.round(mt / 3800 * 100) / 100};
  });
  return out;
}
/** Rakes entered as received (Rake Unloading form) at a plant on a date, or null. */
const spRecdEntered = (plant, date) => { const u = spUnload().find(r => r.plant === plant && r.date === date); return u && u.received !== null && u.received !== undefined ? u.received : null; };
/** The first day the FOIS events cover (rake_trend of the last 31 days). */
const spEvFrom = () => spIso(-30);
/**
 * Rakes received at a plant on a date: rakes that came inside the station in FOIS (rake trend events, the same on every
 * device); the Rake Unloading entry where the FOIS events do not cover the date. {n, src, entered}
 */
function spRecd(plant, date) {
  const entered = spRecdEntered(plant, date), ev = spRakeEv.list;
  const au = (SP.data?.unload_auto?.days || []).find(r => r.plant === plant && r.date === date);   // the service's FOIS unloading figures first
  if (au) return {n: au.received, src: 'fois', entered};
  const covered = !!ev && date >= spEvFrom() && date <= spIso(0);
  const n = covered ? ev.filter(e => e.type === 'RECEIVED' && !e.baseline && e.date === date && (SP_FOIS[e.station] || e.station) === plant).length : null;
  // Nothing available is left out: FOIS when it saw rakes come in; else the entered figure (no FOIS list shared that day,
  // or a day before the events); 0 only when FOIS covered the day and nothing was entered.
  if (n) return {n, src: 'fois', entered};
  if (entered !== null) return {n: entered, src: 'entry', entered};
  return {n, src: covered ? 'fois' : '', entered};
}
/** Received against required: short in red, met in green; the entered figure in brackets where it differs. */
const spRecdCell = (x, req) => !x || x.n === null || x.n === undefined ? '—'
  : `<b class="${req && x.n + 0.05 < req.rakes_per_day ? 'neg' : 'pos'}">${fmt(x.n, 0)}</b>${x.src === 'fois' && x.entered !== null && x.entered !== x.n ? ` <small class="muted">(${fmt(x.entered, 0)})</small>` : ''}`;

/** Rakes needed per day at 85 % PLF, with the basis, the last 7 days received and the gap. */
function sRakeReq(rows, date) {
  const req = spRakeReq(), plants = SP.data.plants.filter(p => req[p]);
  if (!plants.length) return '';
  const from = (() => { const d = new Date(date + 'T12:00:00'); d.setDate(d.getDate() - 6); return d.toISOString().slice(0, 10); })();
  const week = p => { const l = [0, 1, 2, 3, 4, 5, 6].map(i => { const d = new Date(date + 'T12:00:00'); d.setDate(d.getDate() - i); return spRecd(p, d.toISOString().slice(0, 10)).n; }).filter(v => v !== null && v !== undefined);
    return l.length ? {avg: l.reduce((t, v) => t + v, 0) / l.length, n: l.length} : null; };
  let tReq = 0, tMt = 0, tWeek = 0, anyWeek = false;
  const body = plants.map(p => {
    const x = req[p], w = week(p), gap = w ? w.avg - x.rakes_per_day : null;
    tReq += x.rakes_per_day; tMt += x.mt_per_day; if (w) { tWeek += w.avg; anyWeek = true; }
    return `<tr><td><b>${esc(p)}</b></td><td>${fmt(x.capacity_mw, 0)}</td><td>${fmt(x.kg_per_kwh, 3)}</td><td>${fmt(x.mt_per_day, 0)}</td><td>${fmt(x.rake_mt, 0)}</td><td><b>${fmt(x.rakes_per_day, 1)}</b></td>
      <td>${w ? fmt(w.avg, 1) : '—'}</td><td class="${gap === null ? '' : gap < -0.05 ? 'neg' : 'pos'}">${gap === null ? '—' : (gap > 0 ? '+' : '') + fmt(gap, 1)}</td></tr>`;
  }).join('');
  const basis = plants.map(p => `${p}: sp. coal ${req[p].kg_src}, rake ${req[p].rake_src}`).join(' · ');
  return `<div class="card"><h2>Daily rake requirement <span class="more muted" style="font-weight:500;font-size:11.5px">at 85 % PLF</span></h2><div style="overflow-x:auto"><table class="dt num">
    <tr><th>Station</th><th>MW</th><th>Sp. coal<br><small>kg/kWh</small></th><th>Coal/day<br><small>MT</small></th><th>MT/rake</th><th>Rakes/day<br><small>required</small></th><th>Recd/day<br><small>7-day avg</small></th><th>Gap</th></tr>
    ${body}
    <tr class="hl"><td>GSECL</td><td></td><td></td><td>${fmt(tMt, 0)}</td><td></td><td>${fmt(tReq, 1)}</td><td>${anyWeek ? fmt(tWeek, 1) : '—'}</td><td class="${anyWeek ? (tWeek - tReq < -0.05 ? 'neg' : 'pos') : ''}">${anyWeek ? (tWeek - tReq > 0 ? '+' : '') + fmt(tWeek - tReq, 1) : '—'}</td></tr></table></div>
    <div class="note-src">Coal per day = MW × 24 h × 0.85 × specific coal; rakes per day = coal per day ÷ coal per rake. ${esc(basis)}. Received = rakes that came inside the station in FOIS (rake trend), ${spDay(from)} – ${spDay(date)}; for a day FOIS shows none, the Rake Unloading entry from the Google Sheet.</div></div>`;
}

/** Lignite stations (no rakes): stock, receipt, consumption and days at 85 % PLF, for the chosen date or the latest entry. */
function sLignite(date) {
  const plants = (SP.data.lignite_plants || []).filter(p => SP.data.plants.includes(p));
  if (!plants.length) return '';
  const pick = p => spOn(spStock(), date).find(r => r.plant === p) || spStock().filter(r => r.plant === p && r.date <= date).sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  const rows = plants.map(p => [p, pick(p)]), master = SP.data.master || {};
  return `<div class="card"><h2>Lignite stock position <span class="more muted" style="font-weight:500;font-size:11.5px">BLTPS · KLTPS</span></h2>
    ${rows.map(([p, r]) => { const m = master[p] || {}; if (!r) return `<div class="srow" style="cursor:default"><div class="top"><span class="nm">${p} <span class="muted" style="font-weight:400">${esc(SP_NAME[p])}</span></span><span class="vals muted">not entered</span></div></div>`;
      const d = r.availability_days || 0, pct = m.max_capacity_mt ? Math.min(100, (r.end_stock || 0) / m.max_capacity_mt * 100) : Math.min(100, d / 30 * 100);
      return `<div class="srow" style="cursor:default"><div class="top"><span class="nm">${p} <span class="muted" style="font-weight:400">${esc(SP_NAME[p])}${r.date !== date ? ' · ' + spDay(r.date) : ''}</span></span><span class="vals num"><b>${spMt(r.end_stock, 0)}</b> MT ${spBadge(d)}</span></div>
        <div class="vals num">+${spMt(r.receipt, 0)} received · −${spMt(r.consumption, 0)} burnt · needs ${spMt(m.mt_per_day, 0)} MT a day at 85 % PLF (${fmt(m.capacity_mw, 0)} MW × ${fmt(m.coal_kg_per_kwh, 2)} kg/kWh)${m.max_capacity_mt ? ' · storage ' + spMt(m.max_capacity_mt, 0) + ' MT' : ''}</div>
        <div class="bar"><div class="f" style="width:${pct}%;background:var(${d < 5 ? '--forced' : d < 10 ? '--planned' : '--run'})"></div></div></div>`; }).join('')}
    <div class="note-src">Lignite reaches these stations without rakes, so only the stock position is kept. Specific lignite and storage can be set in the CoalPlants tab.</div></div>`;
}

function sRakeTrend() {
  setTimeout(spRakeEvLoad, 0);
  const plants = SP.data.unloading_plants, days = [0, -1, -2, -3, -4, -5, -6].map(spIso);
  const rakes = typeof kRakes === 'function' && appCan('rakes') ? kRakes() : [];
  const transit = rakes.filter(r => !kInside(r) && plants.includes(SP_FOIS[r.station_to])).length;
  const ev = spRakeEv.list, inPlants = e => plants.includes(SP_FOIS[e.station] || e.station);
  const au = SP.data?.unload_auto?.days || [];
  const n = (d, type) => { const a = au.filter(r => r.date === d && plants.includes(r.plant)); if (a.length) return a.reduce((t, r) => t + (type === 'RECEIVED' ? r.received : r.released), 0);
    return ev ? ev.filter(e => e.date === d && e.type === type && inPlants(e) && !e.baseline).length : null; };
  const entered = (d, k) => { const u = spOn(spUnload(), d).filter(r => plants.includes(r.plant)); return u.length ? u.reduce((t, r) => t + (r[k] || 0), 0) : null; };
  // FOIS first; the entered figure where FOIS has none for the day (no list shared), so nothing available is left out.
  const cell = (v, alt) => v === null || (!v && alt) ? (alt === null ? (v === null ? '—' : v) : `<span class="muted">${alt}</span>`) : v + (alt !== null && alt !== v ? ` <small class="muted">(${alt})</small>` : '');
  return `<div class="card"><h2>Rake trend · last 7 days <span class="more muted" style="font-weight:500;font-size:11.5px">${plants.join(' + ')}</span></h2>
    <table class="dt num"><tr><th>Date</th><th>Loaded</th><th>Received</th><th>Released</th></tr>
    ${days.map(d => `<tr><td>${spDay(d)}</td><td>${rakes.length ? rakes.filter(r => r.loading_date === d && plants.includes(SP_FOIS[r.station_to])).length : '—'}</td>
      <td>${cell(n(d, 'RECEIVED'), entered(d, 'received'))}</td><td>${cell(n(d, 'RELEASED'), entered(d, 'released'))}</td></tr>`).join('')}</table>
    <div class="note-src">${rakes.length ? `In transit now: <b>${transit}</b> rakes. ` : ''}Received = rake came inside the station; released = rake that was inside left the FOIS report (from the FOIS lists shared through GSECL Connect, the same on every device). Figures in brackets are the entered ones where they differ.${ev ? '' : ' Reading the FOIS events…'}</div></div>`;
}

/** Rake unloading status worked out from FOIS (the service: placement / release of every rake). */
const spAuto = () => SP.data?.unload_auto || {days: [], rakes: [], basis: null};
function sUnloadTable() {
  const A = spAuto(), plants = SP.data.unloading_plants;
  if (!A.days.length) return sUnloadEntered();
  const dates = [...new Set(A.days.map(r => r.date))].sort();
  const date = dates.includes(SP.udate) ? SP.udate : dates[dates.length - 1];
  const row = p => A.days.find(r => r.date === date && r.plant === p) || {};
  const ent = p => spOn(spUnload(), date).find(r => r.plant === p);
  const tot = k => plants.reduce((t, p) => t + (row(p)[k] || 0), 0);
  const hm = h => (h === null || h === undefined ? '—' : spHms(h).slice(0, -3));
  const withEnt = (p, k, v) => { const e = ent(p); return e && e[k] !== null && e[k] !== undefined && Math.round(e[k]) !== Math.round(v || 0) ? ` <small class="muted">(entered ${fmt(e[k])})</small>` : ''; };
  const line = (label, k, f = v => fmt(v), total = true, entK) => `<tr><td>${label}</td>${plants.map(p => `<td>${row(p)[k] === undefined || row(p)[k] === null ? '—' : f(row(p)[k])}${entK ? withEnt(p, entK, row(p)[k]) : ''}</td>`).join('')}<td><b>${total ? f(tot(k)) : ''}</b></td></tr>`;
  const b = A.basis || {}, est = tot('wagons_est');
  const rakes = A.rakes.filter(r => plants.includes(r.plant) && (r.placed_date === date || r.released_date === date || (r.placed_date < date && (r.inside || r.released_date > date))));
  const free = b.free_hours || 7;
  const week = dates.slice(-7).reverse();
  return `<div class="card"><h2>Rake unloading status <span class="more muted" style="font-weight:500;font-size:11.5px">from FOIS · ${spDate(date)}</span></h2>
    <div class="chips" style="margin-bottom:8px">${dates.slice(-7).map(d => `<button class="chip ${d === date ? 'on' : ''}" data-sact="uday" data-sarg="${d}">${spDay(d)}</button>`).join('')}</div>
    <div style="overflow-x:auto"><table class="dt num">
    <tr><th>Metric</th>${plants.map(p => `<th>${p}</th>`).join('')}<th>GSECL</th></tr>
    ${line('Pre. day balance (nos)', 'pre_day_bal')}${line('Received (nos)', 'received', v => fmt(v), true, 'received')}${line('Released (nos)', 'released', v => fmt(v), true, 'released')}${line('Balance (nos)', 'balance')}
    ${line('Wagons placed (nos)', 'wagons', v => fmt(v), true, 'wagons')}
    ${line('Detention (hh:mm)', 'detention_hrs', hm)}${line('Avg. detention / rake', 'detention_avg', hm, false)}
    ${line('Demurrage (hh:mm)', 'dem_hrs', hm)}${line('Demurrage wagon-hours', 'dem_wagon_hrs', v => fmt(v, 1))}${line('Demurrage charge (₹, est.)', 'dem_charge', v => '₹' + fmt(v))}
    </table></div>
    <div class="note-src">Received = rake came inside the station in FOIS (placement time: the FOIS status time, else when it was first seen inside); released = it left the FOIS report. Detention = placement to release of the rakes released that day; demurrage = detention beyond ${fmt(free)} h free time; wagon-hours = demurrage hours × wagons; charge at ₹${fmt(b.rate || 150)} per wagon-hour (AppSettings RAKE_FREE_HOURS, DEMURRAGE_RATE).${est ? ` ${est} rake${est > 1 ? 's' : ''} without a FOIS wagon count taken as ${b.wagons_default || 58} wagons.` : ''} Figures typed in the form are shown in brackets where they differ.${A.from ? ` FOIS tracking from ${spDate(A.from)}.` : ''}</div></div>
  <div class="card"><h2>Rakes on ${spDate(date)} <span class="more muted" style="font-weight:500;font-size:11.5px">${rakes.length}</span></h2>
    ${rakes.length ? `<div style="overflow-x:auto"><table class="dt num"><tr><th>Rake</th><th>Plant</th><th>Placed</th><th>Released</th><th>Detention</th><th>Demurrage</th><th>Wagons</th></tr>
      ${rakes.map(r => { const dem = Math.max(0, r.hrs - free); return `<tr><td style="text-align:left">${esc(r.rake)}<br><small class="muted">${esc([r.consignor, r.from].filter(Boolean).join(' · '))}</small></td><td>${esc(r.plant)}</td>
        <td>${esc(r.placed)}${r.placed_src === 'fois' ? '' : ' <small class="muted">seen</small>'}</td><td>${r.inside ? '<span class="muted">inside</span>' : esc(r.released)}</td>
        <td>${hm(r.hrs)}${r.inside ? ' <small class="muted">so far</small>' : ''}</td><td class="${dem > 0 ? 'neg' : ''}">${dem > 0 ? hm(dem) : '—'}</td><td>${r.wagons ? fmt(r.wagons) : '<span class="muted">' + (b.wagons_default || 58) + '*</span>'}</td></tr>`; }).join('')}</table></div>` : spEmpty('No rake placed or released on this day.')}</div>
  <div class="card"><h2>Unloading · last ${week.length} days <span class="more muted" style="font-weight:500;font-size:11.5px">${plants.join(' + ')}</span></h2><div style="overflow-x:auto"><table class="dt num">
    <tr><th>Date</th><th>Recd</th><th>Rel.</th><th>Bal.</th><th>Wagons</th><th>Demurrage<br><small>wagon-h</small></th><th>Charge<br><small>₹ est.</small></th></tr>
    ${week.map(d => { const r = A.days.filter(x => x.date === d && plants.includes(x.plant)), t = k => r.reduce((a, x) => a + (x[k] || 0), 0);
      return `<tr data-sact="uday" data-sarg="${d}" style="cursor:pointer"><td>${spDay(d)}</td><td>${fmt(t('received'))}</td><td>${fmt(t('released'))}</td><td>${fmt(t('balance'))}</td><td>${fmt(t('wagons'))}</td><td class="${t('dem_wagon_hrs') > 0 ? 'neg' : ''}">${fmt(t('dem_wagon_hrs'), 1)}</td><td>${fmt(t('dem_charge'))}</td></tr>`; }).join('')}</table></div></div>`;
}
/** Before FOIS tracking (or an older service): the figures typed in the form. */
function sUnloadEntered() {
  const plants = SP.data.unloading_plants, dates = [...new Set(spUnload().map(r => r.date))].sort();
  const date = dates[dates.length - 1];
  if (!date) return `<div class="card"><h2>Rake unloading status</h2>${spEmpty('No FOIS rake data has been shared yet, and nothing has been entered.')}</div>`;
  const row = p => spOn(spUnload(), date).find(r => r.plant === p) || {};
  const line = (label, k, d = 0) => `<tr><td>${label}</td>${plants.map(p => `<td>${row(p)[k] === undefined || row(p)[k] === null ? '—' : fmt(row(p)[k], d)}</td>`).join('')}</tr>`;
  return `<div class="card"><h2>Rake unloading status <span class="more muted" style="font-weight:500;font-size:11.5px">entered · ${spDate(date)}</span></h2><div style="overflow-x:auto"><table class="dt num">
    <tr><th>Metric</th>${plants.map(p => `<th>${p}</th>`).join('')}</tr>${line('Pre. day balance (nos)', 'pre_day_bal')}${line('Received (nos)', 'received')}${line('Released (nos)', 'released')}${line('Balance (nos)', 'balance')}
    <tr><td>Demurrage (hh:mm:ss)</td>${plants.map(p => `<td>${row(p).dem_hrs === undefined || row(p).dem_hrs === null ? '—' : spHms(row(p).dem_hrs)}</td>`).join('')}</tr></table></div></div>`;
}

/** The railway side of the portal dashboard: pipeline summary and the 5-day forecast. */
function sFois() {
  if (!appCan('rakes') || typeof kRakes !== 'function') return '';
  const cols = ['UTPS', 'GTPS', 'WTPS'], rakes = kRakes().filter(r => cols.includes(SP_FOIS[r.station_to]));
  if (!rakes.length) return `<div class="card"><h2>Railway pipeline (FOIS)</h2>${spEmpty('No rake data on this phone yet. Open the Summary tab and tap “Refresh now”.')}</div>`;
  const n = (c, f) => rakes.filter(r => SP_FOIS[r.station_to] === c && f(r)).length;
  const kIsoDate = r => { const m = /(\d{2})[-/](\d{2})[-/](\d{4})/.exec(r.expected_arrival || ''); return m ? `${m[3]}-${m[2]}-${m[1]}` : (/(\d{4}-\d{2}-\d{2})/.exec(r.expected_arrival || '') || [''])[0]; };
  const tr = (label, f, cls = '') => `<tr class="${cls}"><td>${label}</td>${cols.map(c => `<td>${n(c, f)}</td>`).join('')}<td><b>${cols.reduce((t, c) => t + n(c, f), 0)}</b></td></tr>`;
  return `<div class="card"><h2>Railway pipeline (FOIS) <span class="more" data-sact="tab" data-sarg="rakes">Rake list ›</span></h2><table class="dt num">
      <tr><th>Status</th>${cols.map(c => `<th>${c}</th>`).join('')}<th>GSECL</th></tr>
      ${tr('Inside station', kInside)}${tr('In pipeline', r => !kInside(r))}${tr('Total', () => true, 'hl')}</table></div>
    <div class="card"><h2>5-day pipeline forecast <span class="more" data-sact="tab" data-sarg="fc">Matrix ›</span></h2><table class="dt num">
      <tr><th>Day</th>${cols.map(c => `<th>${c}</th>`).join('')}<th>GSECL</th></tr>
      ${[0, 1, 2, 3, 4].map(i => tr(`${spDay(spIso(i))} <span class="muted">D+${i}</span>`, r => !kInside(r) && kIsoDate(r) === spIso(i))).join('')}</table>
      <div class="note-src">Expected arrivals of rakes in transit, from the railway data last synced ${esc(K.data?.last_sync || '—')}.</div></div>`;
}

// ---------------------------------------------------------------- Entry tab (the two forms)

const SP_STOCK_FIELDS = [['prev_stock', 'Previous Day Stock (MT)', '0.01'], ['receipt', 'Coal Receipt (MT)', '0.01'], ['consumption', 'Coal Consumption (MT)', '0.01'],
  ['end_stock', 'End of Day Stock (MT) (Auto-calc)', '0.01'], ['availability_days', 'Stock Availability (Days)', '0.0001'], ['max_capacity_mt', 'Max Capacity Limit (MT)', '0.01'], ['max_capacity_days', 'Max Storage Capacity (Days)', '1']];
const SP_UNLOAD_FIELDS = [['pre_day_bal', 'Pre. Day Balance (nos)', '1'], ['received', 'Rakes Received (nos)', '1'], ['released', 'Rakes Released (nos)', '1'], ['balance', 'Balance (nos) (Auto-calc)', '1'],
  ['dem_hrs', 'Demurrage (hrs)', '0.01'], ['wagons', 'Wagons Placed (nos)', '1'], ['wagon_hr', 'Wagon / Hr (Auto-calc)', '0.0001']];

/** Values the form opens with: the saved entry for that date and plant, else carried forward from the previous entry. */
function spStart(kind, date, plant) {
  const rows = kind === 'stock' ? spStock() : spUnload();
  const cur = rows.find(r => r.date === date && r.plant === plant), prev = plant ? spPrevOf(rows, plant, date) : null;
  if (cur) return {...cur, existing: true};
  if (kind === 'stock') return {date, plant, prev_stock: prev?.end_stock ?? '', max_capacity_mt: prev?.max_capacity_mt ?? '', max_capacity_days: prev?.max_capacity_days ?? '', carried: !!prev};
  const a = spAuto().days.find(r => r.date === date && r.plant === plant);
  if (a) return {date, plant, pre_day_bal: a.pre_day_bal, received: a.received, released: a.released, balance: a.balance, wagons: a.wagons, dem_hrs: a.dem_hrs,
    wagon_hr: Math.round(a.wagons / 24 * 10000) / 10000, detention_time: spHms(a.detention_hrs || 0), fois: true};
  return {date, plant, pre_day_bal: prev?.balance ?? '', detention_time: '', carried: !!prev};
}

function sTabEntry() {
  if (!SP.data && !SP.busy && !SP.error) { spLoad(); return '<div class="sk" style="height:120px"></div>'; }
  if (!SP.data) return spMsg();
  if (!SP.data.can_edit) return `<div class="card">${spEmpty('You have not been given permission to enter coal data.')}</div>`;
  const kind = SP.form, plants = kind === 'stock' ? SP.data.plants : SP.data.unloading_plants, lock = SP.data.lock;
  if (!SP.edit[kind]) SP.edit[kind] = spStart(kind, spIso(), lock && plants.includes(lock) ? lock : '');
  const v = SP.edit[kind], master = (kind === 'stock' && SP.data.master && SP.data.master[v.plant]) || {};
  // Storage capacity is fixed per station and availability follows from the end stock, so they are not typed.
  const fixed = k => (k === 'availability_days' && !!master.mt_per_day) || (k === 'max_capacity_mt' && !!master.max_capacity_mt) || (k === 'max_capacity_days' && !!master.max_capacity_days);
  const val = k => (k === 'max_capacity_mt' && master.max_capacity_mt) || (k === 'max_capacity_days' && master.max_capacity_days) || (v[k] === null || v[k] === undefined ? '' : v[k]);
  const num = ([k, label, step]) => { const auto = /Auto-calc/.test(label) || fixed(k); return `<label style="display:block;font-size:12px;color:var(--muted);margin-top:10px">${esc(label.replace(' (Auto-calc)', ''))}${auto ? ' <span style="color:var(--accent)">(auto-calc)</span>' : ''}
    <input class="search" id="sp_${k}" type="number" inputmode="decimal" step="${step}" min="0" value="${esc(val(k))}" placeholder="${step === '1' ? '0' : (0).toFixed(step.length - 2)}" ${k === 'balance' || k === 'wagon_hr' || fixed(k) ? 'readonly' : ''} style="margin:4px 0 0">${fixed(k) ? `<span style="display:block;margin-top:2px">${k === 'availability_days' ? 'End stock ÷ ' + fmt(master.mt_per_day, 1) + ' MT/day (' + fmt(master.capacity_mw) + ' MW × 24 h × ' + fmt(master.plf * 100) + '% PLF × ' + master.coal_kg_per_kwh + ' kg/kWh)' : 'Fixed for this station'}</span>` : ''}</label>`; };
  const lig = kind === 'stock' && master.fuel === 'Lignite';
  const fields = (kind === 'stock' ? SP_STOCK_FIELDS : SP_UNLOAD_FIELDS).map(f => (lig ? [f[0], f[1].replace('Coal ', 'Lignite ') + (/^max_capacity/.test(f[0]) ? ' (optional)' : ''), f[2]] : f));
  const cant = lock && !plants.includes(lock);
  let h = `<div class="seg two" style="margin-bottom:10px;padding:3px"><button class="${kind === 'stock' ? 'on' : ''}" data-sact="form" data-sarg="stock" style="padding:8px">Coal / lignite stock</button><button class="${kind === 'unload' ? 'on' : ''}" data-sact="form" data-sarg="unload" style="padding:8px">Rake unloading status</button></div>`
    + spMsg() + spSyncLine();
  if (cant) return h + `<div class="card">${spEmpty(`Rake unloading status is entered for ${plants.join(', ')} only; your station is ${lock}.`)}</div>`;
  h += `<div class="card"><h2>${kind === 'stock' ? (lig ? 'Lignite Stock Position Form' : 'Coal / Lignite Stock Position Form') : 'Rake Unloading Status Form'}</h2>
    ${kind === 'unload' && v.fois && !v.existing ? '<div class="note-src" style="margin-bottom:6px">Opened with the figures worked out from FOIS for this day; correct them if needed and save.</div>' : ''}
    <label style="display:block;font-size:12px;color:var(--muted)">Select Date<input class="search" id="sp_date" type="date" value="${esc(v.date)}" max="${spIso()}" style="margin:4px 0 0"></label>
    <label style="display:block;font-size:12px;color:var(--muted);margin-top:10px">Power Plant<select class="search" id="sp_plant" ${lock ? 'disabled' : ''} style="margin:4px 0 0"><option value="">-- Select Plant --</option>${plants.map(p => `<option value="${p}" ${v.plant === p ? 'selected' : ''}>${p} (${SP_NAME[p]})</option>`).join('')}</select></label>
    <div class="note-src" id="sp_state" style="margin-top:6px">${v.existing ? 'An entry already exists for this date and plant; saving will replace it.' : v.carried ? 'Opening figures are carried forward from the previous entry of this plant.' : ''}</div>
    ${fields.map(f => f[0] !== 'dem_hrs' ? num(f) : `<label style="display:block;font-size:12px;color:var(--muted);margin-top:10px">Demurrage (HH:MM:SS)
        <input class="search" id="sp_dem_hrs" type="text" inputmode="numeric" maxlength="9" placeholder="00:00:00" value="${esc(typeof v.dem_hrs === 'string' && v.dem_hrs.includes(':') ? v.dem_hrs : spHms(v.dem_hrs))}" style="margin:4px 0 0">
        <span style="display:block;margin-top:2px">Type the digits only, e.g. 023000 for 2 h 30 min.</span></label>`).join('')}
    ${kind === 'stock' ? '<div class="note-src" id="sp_hint"></div>'
      : `<label style="display:block;font-size:12px;color:var(--muted);margin-top:10px">Detention Time (HH:MM:SS)<input class="search" id="sp_detention_time" type="text" inputmode="numeric" maxlength="9" placeholder="08:30:00" value="${esc(val('detention_time'))}" style="margin:4px 0 0">
        <span style="display:block;margin-top:2px">Type the digits only, e.g. 083000; the colons are added for you.</span></label>`}
    <div>${spBtn(SP.saving ? 'Saving…' : 'Save', 'save', '', true)} ${spBtn('Clear', 'clear')}</div></div>`;

  const past = (kind === 'stock' ? spStock() : spUnload()).filter(r => !lock || r.plant === lock).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.plant.localeCompare(b.plant))).slice(0, 20);
  h += `<div class="card"><h2>Past entries <span class="more muted" style="font-weight:500;font-size:11.5px">tap to correct</span></h2>${past.length ? `<div style="overflow-x:auto"><table class="dt num">
    ${kind === 'stock' ? '<tr><th>Date</th><th>Plant</th><th>Receipt</th><th>Consumption</th><th>End stock</th><th>Days</th></tr>' : '<tr><th>Date</th><th>Plant</th><th>Received</th><th>Released</th><th>Balance</th><th>Detention</th></tr>'}
    ${past.map(r => `<tr data-sact="edit" data-sarg="${r.date}|${r.plant}"><td>${spDay(r.date)}</td><td>${r.plant}</td>${kind === 'stock'
      ? `<td>${spMt(r.receipt, 0)}</td><td>${spMt(r.consumption, 0)}</td><td>${spMt(r.end_stock, 0)}</td><td>${fmt(r.availability_days || 0, 1)}</td>`
      : `<td>${fmt(r.received)}</td><td>${fmt(r.released)}</td><td>${fmt(r.balance)}</td><td>${esc(r.detention_time || '—')}</td>`}</tr>`).join('')}</table></div>` : spEmpty('Nothing entered yet.')}</div>`;
  return h;
}

/** Live arithmetic while typing, without redrawing the form (so the keyboard stays up). */
function spCalc(changed) {
  const n = id => { const el = $('sp_' + id); return el && el.value !== '' ? parseFloat(el.value) || 0 : 0; };
  if (SP.form === 'stock') {
    // End of day stock = previous day stock + receipt - consumption (may be overwritten with a measured figure).
    if (['prev_stock', 'receipt', 'consumption'].includes(changed)) $('sp_end_stock').value = (n('prev_stock') + n('receipt') - n('consumption')).toFixed(2);
    const end = n('end_stock'), con = n('consumption'), cap = n('max_capacity_mt'), hint = $('sp_hint');
    const m = (SP.data.master || {})[$('sp_plant').value || SP.data.lock || ''] || {};
    // Availability (days) = end of day stock / coal burnt per day at the station's normative PLF.
    if (m.mt_per_day) $('sp_availability_days').value = (end / m.mt_per_day).toFixed(4);
    if (hint) hint.innerHTML = [m.mt_per_day ? '' : (con > 0 ? `At today's consumption this stock lasts <b>${fmt(end / con, 1)} days</b> (for reference). This station's capacity figures are not set yet, so enter availability and capacity here; an administrator can fix them in the CoalPlants tab of the sheet.` : ''),
      cap > 0 ? `Stock is <b>${fmt(end / cap * 100, 0)}%</b> of the capacity limit.` : '', end < 0 ? '<span class="neg">End stock is negative — check the figures.</span>' : ''].filter(Boolean).join(' ');
  } else {
    $('sp_balance').value = n('pre_day_bal') + n('received') - n('released');        // balance = previous + received - released
    $('sp_wagon_hr').value = (n('wagons') / 24).toFixed(4);                          // wagons per hour over the day
  }
}

function spRead() {
  const kind = SP.form, v = {date: $('sp_date').value, plant: $('sp_plant').value || SP.data.lock || ''};
  (kind === 'stock' ? SP_STOCK_FIELDS : SP_UNLOAD_FIELDS).forEach(([k]) => { v[k] = $('sp_' + k).value; });
  if (kind === 'unload') {
    v.dem_text = $('sp_dem_hrs').value.trim() || '00:00:00';
    const h = spHours(v.dem_text);
    v.dem_hrs = h === null ? '' : h;
    const t = $('sp_detention_time').value.trim();
    v.detention_time = /^\d{1,3}:\d{2}$/.test(t) ? t + ':00' : /^\d{1,2}$/.test(t) ? t.padStart(2, '0') + ':00:00' : t;
  }
  return v;
}

async function spSave() {
  if (SP.saving) return;
  const kind = SP.form, v = spRead();
  SP.edit[kind] = {...SP.edit[kind], ...v, ...(v.dem_text ? {dem_hrs: v.dem_hrs === '' ? v.dem_text : v.dem_hrs} : {})};
  delete v.dem_text;
  SP.note = '';
  const ligSave = kind === 'stock' && spLignite(v.plant);
  const need = kind === 'stock' ? ['prev_stock', 'receipt', 'consumption', 'availability_days', 'max_capacity_mt', 'max_capacity_days'].filter(k => $('sp_' + k) && !$('sp_' + k).readOnly && !(ligSave && /^max_capacity/.test(k))) : ['pre_day_bal', 'received', 'released', 'dem_hrs', 'wagons'];
  SP.error = !v.date ? 'Choose the date.' : !v.plant ? 'Choose the power plant.'
    : kind === 'unload' && v.dem_hrs === '' ? 'Demurrage must be hours:minutes:seconds with minutes and seconds under 60, for example 02:30:00.'
    : need.some(k => v[k] === '') ? 'Fill in every figure (enter 0 where there is none).'
    : kind === 'unload' && v.detention_time && !/^\d{1,3}:[0-5]\d:[0-5]\d$/.test(v.detention_time) ? 'Detention time must be hours:minutes:seconds with minutes and seconds under 60, for example 08:30:00.' : '';
  if (SP.error) { kRender(); return window.scrollTo({top: 0}); }
  SP.saving = true; kRender();
  const r = await conCall(kind === 'stock' ? 'save_coal_stock' : 'save_rake_unloading', {fields: v});
  SP.saving = false;
  if (!r.ok) { SP.error = r.error; kRender(); return window.scrollTo({top: 0}); }
  SP.edit[kind] = null;
  await spLoad(true);
  SP.note = r.data.message || 'Saved'; kRender(); window.scrollTo({top: 0});
}

// ---------------------------------------------------------------- interaction

document.addEventListener('click', e => {
  const el = e.target.closest('[data-sact]');
  if (!el) return;
  const arg = el.dataset.sarg || '';
  switch (el.dataset.sact) {
    case 'tab': return kOpenTab(arg);
    case 'sync': return spLoad(true);
    case 'scope': SP.scope = arg; return kRender();
    case 'cal': SP.cal.open = !SP.cal.open; if (SP.cal.open) SP.cal.month = (SP.date || spLatest() || '').slice(0, 7); return kRender();
    case 'calm': SP.cal.month = arg; return kRender();
    case 'calday': SP.date = arg; SP.cal.open = false; return kRender();
    case 'trscope': SP.tr.scope = arg; return kRender();
    case 'trrange': SP.tr.range = arg === 'custom' ? 'custom' : +arg; if (arg === 'custom' && !SP.tr.from) { SP.tr.from = spIsoAgo(59); SP.tr.to = spIsoAgo(0); } return kRender();
    case 'trapply': {
      const a = $('spTrF').value, b = $('spTrT').value;
      if (!a || !b || a > b) return alert('Choose a start date before the end date.');
      SP.tr.from = a; SP.tr.to = b; return kRender();
    }
    case 'range': SP.range = +arg; return kRender();
    case 'form': SP.form = arg; SP.error = ''; SP.note = ''; return kRender();
    case 'uday': SP.udate = arg; return kRender();
    case 'clear': SP.edit[SP.form] = null; SP.error = ''; SP.note = ''; return kRender();
    case 'edit': { const [d, p] = arg.split('|'); SP.edit[SP.form] = spStart(SP.form, d, p); SP.error = ''; SP.note = ''; kRender(); return window.scrollTo({top: 0}); }
    case 'save': return spSave();
  }
});
/** "083000" -> "08:30:00" as the digits are typed, left to right: hours, minutes, seconds (seven digits = 3-digit hours). */
function spTime(text) {
  const d = text.replace(/\D/g, '').slice(0, 7), h = d.length === 7 ? 3 : 2;
  return [d.slice(0, h), d.slice(h, h + 2), d.slice(h + 2, h + 4)].filter(Boolean).join(':');
}
document.addEventListener('input', e => {
  if (e.target.id === 'sp_detention_time' || e.target.id === 'sp_dem_hrs') { e.target.value = spTime(e.target.value); return; }
  if (e.target.id && e.target.id.startsWith('sp_') && e.target.type === 'number') spCalc(e.target.id.slice(3));
});
document.addEventListener('change', e => {
  if (e.target.dataset?.ssel === 'date') { SP.date = e.target.value; return kRender(); }
  // A different date or plant loads that day's saved entry, or carries the previous one forward.
  if (e.target.id === 'sp_date' || e.target.id === 'sp_plant') {
    SP.edit[SP.form] = spStart(SP.form, $('sp_date').value, $('sp_plant').value || SP.data.lock || '');
    SP.error = ''; SP.note = ''; kRender();
  }
});

/** After the Coal view is drawn: chart, the form's reference line, and a re-read of the sheet if it is due. */
function spAfterRender() {
  if (['stock', 'entry'].includes(K.tab) && !K.detail && SP.data && !SP.busy && (!SP.last || (spInterval() && Date.now() - SP.last >= spInterval() * 1000))) setTimeout(() => spLoad(true, true), 0);
  if ($('spCombo')) sDrawCombo();
  if ($('spTrStock')) sDrawTrend();
  if ($('sp_date') && SP.data?.can_edit) spCalc('');
}

// Pages the employee has not been given are not offered, and cannot be opened by other routes either.
const spShow = window.show;
window.show = show = v => {
  appApplyAccess();
  if (typeof APP_SOLAR_ONLY !== 'undefined' && APP_SOLAR_ONLY) return spShow('solar');   // outside solar-entry sign-in: the solar page only
  if (typeof SECTION !== 'undefined' && !appSeeSection(SECTION[v] || 'gen')) v = appCan('generation') ? 'home' : 'connect';
  return spShow(v);
};
appApplyAccess();
if (!appCan('generation') && !(typeof APP_SOLAR_ONLY !== 'undefined' && APP_SOLAR_ONLY)) show('connect');

// ---------------------------------------------------------------- Profile: how often the coal sheet is re-read

function spRenderSetting() {
  document.querySelectorAll('#coalSyncSeg button').forEach(b => b.classList.toggle('on', +b.dataset.coalsync === spInterval()));
  const row = $('coalSyncRow'), seg = $('coalSyncSeg'), on = appCan('coal');
  if (row) row.hidden = !on;
  if (seg) seg.hidden = !on;
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-coalsync]');
  if (!b) return;
  S.set.coalSync = +b.dataset.coalsync;
  saveSettings();
  spRenderSetting();
});
spRenderSetting();
