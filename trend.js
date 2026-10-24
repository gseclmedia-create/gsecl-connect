// Graphs for the Connect "More" sections: efficiency trends (several parameters of one unit, or one
// parameter across stations / units) and the outage register (station-wise and unit-wise hours, a
// unit timeline, causes and the year-wise record). The outage register is worked out on the phone
// from one answer of the service, so changing a filter needs no further request.
// Uses W, wLoad, wSel, wBtn, wNum, wPeriod, wKey from work.js; con* from connect.js; $, esc, fmt, niceTicks from index.html.

const T_REG = {};                                    // chart id -> {xs, tip(i)} for the crosshair
const T_SLOTS = 6;                                   // series colours --s1 … --s6 (checked for colour-blind separation)
const tCol = slot => `var(--s${slot + 1})`;

/** A colour slot that stays with its series while it is selected, whatever else is switched on or off. */
function tSlot(group, key) {
  const g = (W.slots = W.slots || {})[group] || (W.slots[group] = {});
  if (g[key] === undefined) { const used = new Set(Object.values(g)); let i = 0; while (used.has(i)) i++; g[key] = i; }
  return g[key];
}
const tFree = (group, key) => { if (W.slots && W.slots[group]) delete W.slots[group][key]; };
const tDec = span => (span < 2 ? 2 : span < 20 ? 1 : 0);
const tShort = v => Math.abs(v) >= 10000 ? fmt(v / 1000, Math.abs(v) >= 100000 ? 0 : 1) + 'k' : null;
const tLegend = items => `<div class="keyline">${items.map(([colour, name, value]) => `<span><i style="width:10px;height:10px;border-radius:50%;background:${colour}"></i>${esc(name)}${value === undefined ? '' : ` <b style="color:var(--ink)">${value}</b>`}</span>`).join('')}</div>`;

/**
 * Line chart. labels: x labels; series: [{name, slot, vals}] where a missing figure is null and
 * breaks the line. One y axis only: series on one chart must share a unit (or be indexed).
 */
function tLine(id, labels, series, o = {}) {
  const all = series.flatMap(s => s.vals).filter(v => v !== null && v !== undefined && !isNaN(v));
  if (!all.length || !labels.length) return conEmpty('No figures to plot for this selection.');
  const VW = 340, H = o.h || 180, L = 44, R = 14, T = 12, B = 22;
  let lo = Math.min(...all), hi = Math.max(...all);
  if (lo === hi) { const k = Math.abs(lo) * 0.05 || 1; lo -= k; hi += k; }
  const pad = (hi - lo) * 0.1, floor = Math.min(...all) >= 0 ? 0 : -Infinity;
  lo = Math.max(floor, lo - pad); hi += pad;
  const dec = tDec(hi - lo), show = v => tShort(v) || fmt(v, dec);
  const x = i => labels.length === 1 ? (L + VW - R) / 2 : L + i * (VW - L - R) / (labels.length - 1), y = v => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const ok = v => v !== null && v !== undefined && !isNaN(v);
  const path = vals => { let d = '', pen = false; vals.forEach((v, i) => { if (!ok(v)) { pen = false; return; } d += (pen ? 'L' : 'M') + x(i).toFixed(1) + ',' + y(v).toFixed(1); pen = true; }); return d; };
  const every = Math.max(1, Math.ceil(labels.length / 6));
  T_REG[id] = {xs: labels.map((_, i) => x(i)), vw: VW, tip: i => `<b>${esc(labels[i])}</b>` + series.map(s => `<br><i style="display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:5px;background:${tCol(s.slot)}"></i>${series.length > 1 ? esc(s.name) + ' ' : ''}${ok(s.vals[i]) ? fmt(s.vals[i], Math.max(dec, 2)) + (o.unit || '') : '—'}`).join('')};
  return `<div class="chart tch" data-tch="${id}"><svg viewBox="0 0 ${VW} ${H}" role="img" aria-label="${esc(o.label || 'Trend')}">
    ${niceTicks(lo, hi, 4).map(v => `<line class="grid" x1="${L}" x2="${VW - R}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${L - 5}" y="${y(v) + 3.5}" text-anchor="end">${show(v)}</text>`).join('')}
    <line class="xh" x1="0" x2="0" y1="${T}" y2="${H - B}" style="stroke:var(--muted);display:none" stroke-width="1"/>
    ${series.map(s => `<path d="${path(s.vals)}" fill="none" style="stroke:${tCol(s.slot)}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`).join('')}
    ${series.map(s => s.vals.map((v, i) => ok(v) ? `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="4" style="fill:${tCol(s.slot)};stroke:var(--card)" stroke-width="2"/>` : '').join('')).join('')}
    ${labels.map((l, i) => i !== labels.length - 1 && (i % every || labels.length - 1 - i < every) ? '' : `<text class="ax" x="${x(i)}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : i === labels.length - 1 ? 'end' : 'middle'}">${esc(o.short ? o.short(l) : l)}</text>`).join('')}
  </svg><div class="tip" style="display:none;white-space:normal;text-align:left;min-width:120px"></div></div>`
    + (o.noCsv ? '' : csvBtn(id, o.label || 'GSECL_trend', [o.xName || 'Period'].concat(series.map(s => s.name + (o.unit ? ` (${o.unit.trim()})` : ''))), labels.map((l, i) => [l].concat(series.map(s => (ok(s.vals[i]) ? s.vals[i] : null))))));
}

// Touch a line chart: crosshair on the nearest year and the figures of every line there.
// Touch any mark that carries data-tip (bars, timeline): its details.
function tTouch(ev) {
  const box = ev.target.closest && ev.target.closest('.chart');
  if (!box) return;
  const tip = box.querySelector('.tip'), svg = box.querySelector('svg');
  if (!tip || (box.dataset.tch && !svg)) return;
  const r = (box.dataset.tch ? svg : box).getBoundingClientRect();
  let html, px;
  const reg = box.dataset.tch && T_REG[box.dataset.tch];
  if (reg) {
    const vx = (ev.clientX - r.left) * reg.vw / r.width;
    let i = 0; reg.xs.forEach((x, k) => { if (Math.abs(x - vx) < Math.abs(reg.xs[i] - vx)) i = k; });
    const xh = box.querySelector('.xh');
    xh.style.display = ''; xh.setAttribute('x1', reg.xs[i]); xh.setAttribute('x2', reg.xs[i]);
    html = reg.tip(i); px = reg.xs[i] / reg.vw * r.width;
  } else {
    const mark = ev.target.closest('[data-tip]');
    if (!mark) return;
    html = mark.dataset.tip; px = ev.clientX - r.left;
  }
  tip.style.display = ''; tip.innerHTML = html;
  const half = tip.offsetWidth / 2 + 4;
  tip.style.left = Math.min(Math.max(px, half), Math.max(half, r.width - half)) + 'px';
}
document.addEventListener('pointerdown', tTouch);
document.addEventListener('pointermove', ev => { if (ev.target.closest && ev.target.closest('.tch')) tTouch(ev); });

/** Horizontal stacked bars with the figures written out, one row per station or unit. rows: [{label, sub, vals, text, act, arg}] */
function tBars(rows, colours) {
  const max = Math.max(1e-9, ...rows.map(r => r.vals.reduce((t, v) => t + v, 0)));
  return rows.map(r => {
    const total = r.vals.reduce((t, v) => t + v, 0);
    return `<div class="srow" ${r.act ? `data-tact="${r.act}" data-targ="${esc(r.arg)}"` : 'style="cursor:default"'}><div class="top"><span class="nm">${esc(r.label)}${r.sub ? ` <small class="muted" style="font-weight:500">${esc(r.sub)}</small>` : ''}</span><span class="vals num"><b style="color:var(--ink)">${fmt(total, 1)} h</b>${r.act ? ' ›' : ''}</span></div>
      <div style="display:flex;gap:2px;height:12px;margin:6px 0 4px;width:${Math.max(total / max * 100, total ? 1.5 : 0)}%">${r.vals.map((v, i) => v > 0 ? `<i style="flex:${v} 0 0;min-width:2px;border-radius:3px;background:${colours[i]}"></i>` : '').join('')}</div>
      <div class="vals num">${r.text}</div></div>`;
  }).join('');
}

// ================================================================ Efficiency

const eOk = v => v !== null && v !== undefined && v !== '' && !isNaN(v);
const eYear = y => String(y).replace(/^\d\d/, '');                       // "2024-25" -> "24-25" on the axis
const eUnits = (d, st) => [...new Set(d.rows.filter(r => r.station === st).map(r => r.unit))].sort((a, b) => (a === 'Station' ? -1 : b === 'Station' ? 1 : String(a).localeCompare(String(b), undefined, {numeric: true})));
const eWrap = 'style="flex-wrap:wrap;overflow:visible"';

function wEfficiency() {
  const d = W.data.efficiency;
  if (!d) return W.busy ? conSpin() : '';
  if (!d.rows.length) return `<div class="card">${conEmpty('No efficiency figures entered yet.')}${d.can_edit ? wBtn('Enter a year', 'editeff', '|Station', true) : ''}</div>`;
  const mode = W.sel.emode || 'trend';
  const stations = [...new Set(d.rows.map(r => r.station))].sort(), st = stations.includes(W.sel.estation) ? W.sel.estation : stations[0];
  const units = eUnits(d, st), unit = units.includes(W.sel.eunit) ? W.sel.eunit : units[0];
  const pick = `<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">${wSel('estation', st, null, stations)}${wSel('eunit', unit, null, units)}</div>`;
  const h = `<div class="seg" style="grid-template-columns:repeat(3,1fr);margin-bottom:10px">${[['trend', 'Parameters'], ['compare', 'Compare'], ['table', 'Table']].map(([k, l]) => `<button class="${mode === k ? 'on' : ''}" data-tact="emode" data-targ="${k}">${l}</button>`).join('')}</div>`;
  const edit = d.can_edit ? `<div style="margin-bottom:12px">${wBtn('Enter or correct a year', 'editeff', st + '|' + unit, true)}</div>` : '';
  return h + (mode === 'trend' ? pick + eTrend(d, st, unit) : mode === 'compare' ? eCompare(d, stations, st) : pick + eTable(d, st, unit)) + edit;
}

/** Several parameters of one station / unit over the years: a chart each (own scale), or indexed on one chart. */
function eTrend(d, st, unit) {
  const rows = d.rows.filter(r => r.station === st && r.unit === unit).sort((a, b) => a.year.localeCompare(b.year));
  const has = d.metrics.filter(m => rows.some(r => eOk(r.values[m])));
  if (!has.length) return `<div class="card">${conEmpty('No figures entered for this selection.')}</div>`;
  let on = (W.sel.emet || []).filter(m => has.includes(m));
  if (!on.length) { on = has.slice(0, 3); W.sel.emet = on; }
  on.forEach(m => tSlot('emet', m));
  const years = rows.map(r => r.year), indexed = !!W.sel.eindex && on.length > 1;
  const vals = m => rows.map(r => eOk(r.values[m]) ? +r.values[m] : null);
  const change = v => { const a = v.filter(x => x !== null); if (a.length < 2 || !a[a.length - 2]) return ''; const p = (a[a.length - 1] - a[a.length - 2]) / Math.abs(a[a.length - 2]) * 100; return ` <span class="muted">${p >= 0 ? '+' : '−'}${fmt(Math.abs(p), 1)}% on the year before</span>`; };
  let h = `<div class="card"><h2>Parameters ${conMore(on.length + ' of ' + has.length + ' shown · up to ' + T_SLOTS)}</h2>
      <div class="chips" ${eWrap}>${has.map(m => `<button class="chip ${on.includes(m) ? 'on' : ''}" data-tact="emet" data-targ="${esc(m)}" style="padding:5px 11px;font-size:12px">${esc(m)}</button>`).join('')}</div>
      ${on.length > 1 ? `<div class="seg" style="grid-template-columns:1fr 1fr"><button class="${indexed ? '' : 'on'}" data-tact="eindex" data-targ="">Own scale each</button><button class="${indexed ? 'on' : ''}" data-tact="eindex" data-targ="1">Indexed together</button></div>` : ''}</div>`;
  if (indexed) {
    const series = on.map(m => { const v = vals(m), base = v.find(x => x !== null && x !== 0); return {name: m, slot: tSlot('emet', m), vals: v.map(x => x === null || !base ? null : x / base * 100)}; });
    const last = s => { const a = s.vals.filter(x => x !== null); return a.length ? fmt(a[a.length - 1], 1) : '—'; };
    return h + `<div class="card"><h2>${esc(st)} · ${esc(unit)} ${conMore('first year entered = 100')}</h2>${tLine('eIdx', years, series, {h: 220, short: eYear, label: 'Indexed parameters'})}
      ${tLegend(series.map(s => [tCol(s.slot), s.name, last(s)]))}
      <div class="note-src">Each parameter is shown relative to its own first entered year (= 100), so parameters with different units can be compared for how much they moved. Touch the chart for the figures of a year.</div></div>`;
  }
  return h + on.map((m, i) => { const v = vals(m), a = v.filter(x => x !== null), latest = a.length ? a[a.length - 1] : null;
    return `<div class="card"><h2><i style="width:10px;height:10px;border-radius:50%;flex:none;background:${tCol(tSlot('emet', m))}"></i>${esc(m)}</h2>
      <div style="margin:-6px 0 6px;font-size:12.5px"><b class="num" style="font-size:20px">${latest === null ? '—' : fmt(latest, Math.abs(latest) >= 1000 ? 0 : Math.abs(latest) >= 100 ? 1 : 2)}</b> <span class="muted">${esc(years[v.lastIndexOf(latest)] || '')}</span>${change(v)}</div>
      ${tLine('eM' + i, years, [{name: m, slot: tSlot('emet', m), vals: v}], {h: 140, short: eYear, label: m})}</div>`; }).join('')
    + `<div class="note-src" style="margin:0 4px 12px">${esc(st)} · ${esc(unit)}. Each parameter has its own scale; the years line up from chart to chart. Touch a chart for the figure of a year.</div>`;
}

/** One parameter across stations, or across the units of one station. */
function eCompare(d, stations, st) {
  const level = W.sel.clevel || 'st', metric = d.metrics.includes(W.sel.cmetric) ? W.sel.cmetric : d.metrics[0];
  const cand = level === 'st' ? stations.filter(s => d.rows.some(r => r.station === s && r.unit === 'Station')).map(s => [s + '|Station', s])
    : eUnits(d, st).filter(u => u !== 'Station').map(u => [st + '|' + u, 'Unit ' + u]);
  const group = 'cser_' + level + (level === 'un' ? st : '');
  let on = (W.sel[group] || []).filter(k => cand.some(c => c[0] === k));
  if (!W.sel[group]) { on = cand.slice(0, T_SLOTS).map(c => c[0]); W.sel[group] = on; }
  on.forEach(k => tSlot(group, k));
  const of = k => { const [s, u] = k.split('|'); return d.rows.filter(r => r.station === s && r.unit === u); };
  const years = [...new Set(on.flatMap(k => of(k).filter(r => eOk(r.values[metric])).map(r => r.year)))].sort();
  const series = cand.filter(c => on.includes(c[0])).map(([k, name]) => { const by = {}; of(k).forEach(r => { by[r.year] = r.values[metric]; }); return {name, slot: tSlot(group, k), vals: years.map(y => eOk(by[y]) ? +by[y] : null)}; });
  const last = s => { const a = s.vals.filter(x => x !== null); return a.length ? fmt(a[a.length - 1], 2) : '—'; };
  return `<div class="seg" style="grid-template-columns:1fr 1fr;margin-bottom:8px"><button class="${level === 'st' ? 'on' : ''}" data-tact="clevel" data-targ="st">Between stations</button><button class="${level === 'un' ? 'on' : ''}" data-tact="clevel" data-targ="un">Units of a station</button></div>
    <div style="display:grid;grid-template-columns:${level === 'un' ? '1fr 1fr' : '1fr'};gap:8px">${level === 'un' ? wSel('estation', st, null, stations) : ''}${wSel('cmetric', metric, null, d.metrics)}</div>
    <div class="card"><h2>${level === 'st' ? 'Stations' : 'Units of ' + esc(st)} ${conMore('up to ' + T_SLOTS + ' lines')}</h2>
      ${cand.length ? `<div class="chips" ${eWrap}>${cand.map(([k, name]) => `<button class="chip ${on.includes(k) ? 'on' : ''}" data-tact="cser" data-targ="${esc(group + '\u0001' + k)}" style="padding:5px 11px;font-size:12px">${esc(name)}</button>`).join('')}</div>`
        : conEmpty(level === 'st' ? 'No station-level figures are entered. Choose “Units of a station”.' : 'No unit-wise figures are entered for this station.')}</div>
    ${series.length ? `<div class="card"><h2>${esc(metric)}</h2>${tLine('eCmp', years, series, {h: 220, short: eYear, label: metric})}${tLegend(series.map(s => [tCol(s.slot), s.name, last(s)]))}
      <div class="note-src">The figure beside each name is its latest year. Touch the chart for the figures of a year.</div></div>
    <div class="card"><h2>${esc(metric)} · figures</h2><div style="overflow-x:auto"><table class="dt num"><tr><th>Year</th>${series.map(s => `<th>${esc(s.name)}</th>`).join('')}</tr>
      ${years.map((y, i) => `<tr><td>${esc(y)}</td>${series.map(s => `<td>${wNum(s.vals[i])}</td>`).join('')}</tr>`).reverse().join('')}</table></div></div>` : ''}`;
}

function eTable(d, st, unit) {
  const rows = d.rows.filter(r => r.station === st && r.unit === unit).sort((a, b) => b.year.localeCompare(a.year));
  return `<div class="card"><h2>${esc(st)} · ${esc(unit)} ${conMore('latest year first')}</h2>${rows.length ? `<div style="overflow-x:auto"><table class="dt num"><tr><th>Parameter</th>${rows.map(r => `<th>${esc(r.year)}</th>`).join('')}</tr>
    ${d.metrics.map(m => `<tr><td>${esc(m)}</td>${rows.map(r => `<td>${wNum(r.values[m])}</td>`).join('')}</tr>`).join('')}</table></div>` : conEmpty('No figures entered for this selection.')}</div>`;
}

// ================================================================ Outage register

const O_CLS = [['forced', 'Forced', 'var(--forced)'], ['planned', 'Planned', 'var(--planned)'], ['reserve', 'Reserve', 'var(--rsd)']];
const O_COL = {forced: 'var(--forced)', planned: 'var(--planned)', reserve: 'var(--rsd)', other: 'var(--outage)'};
const oMs = s => (s ? new Date(String(s).replace(' ', 'T') + ':00+05:30').getTime() : 0);     // sheet times are IST
const oClock = t => new Date(t).toLocaleTimeString('en-IN', {hour: '2-digit', minute: '2-digit'});

function oUse(d, key, stamp) {
  W.data.opack = d; W.data.opackKey = key; W.data.ostamp = stamp; W.data.oshown = 30;
  // What the entry form (work.js) reads.
  W.data.ometa = {units: d.units.filter(u => u.status !== 'Decommissioned'), all_units: d.units, types: d.types, can_edit: d.can_edit};
  W.data.olist = {items: d.items};
}

/** The register for the chosen period: the copy on the phone at once, the service only if that is over 10 minutes old. */
async function oLoad(force = false) {
  const q = wPeriod(), key = wKey('opack', q), saved = conSaved(key);
  if (saved) oUse(saved.data, key, Date.now() - saved.age * 60000);
  else if (W.data.opackKey !== key) W.data.opack = null;
  if (saved && !force && saved.age < 10) return conRender();
  W.busy = true; W.error = ''; conRender();
  const r = await conCall('outage_pack', q);
  W.busy = false;
  // A service that has not been redeployed yet does not know this request: use the earlier screen.
  if (!r.ok && /unknown action/i.test(r.error)) { W.data.opackOff = true; return wOutages(false, true); }
  if (r.ok) { Connect.cacheSet(key, JSON.stringify(r.data)); if (wKey('opack', wPeriod()) === key) oUse(r.data, key, Date.now()); }
  else if (!W.data.opack) W.error = r.error;
  conRender();
}

/** Totals, station / unit / cause breakdowns and the year-wise record for the chosen station or unit. */
function oCalc() {
  const d = W.data.opack, from = oMs(d.period.from + ' 00:00'), to = oMs(d.period.to + ' 00:00') + 864e5, now = Date.now(), clock = (to - from) / 36e5;
  const master = {}; d.units.forEach(u => { master[u.code.toUpperCase()] = u; });
  const st = (W.sel.ostation || '').toUpperCase(), code = st ? (W.sel.ounit || '').toUpperCase() : '';
  const inScope = (c, station) => (code ? c === code : st ? String(station).toUpperCase() === st : true);
  const blank = () => ({forced: 0, planned: 0, reserve: 0, other: 0, trips: 0, forcedTrips: 0});
  const agg = {}, types = {}, items = [];
  d.items.forEach(x => {
    const c = String(x.code).toUpperCase(), station = (master[c] && master[c].station) || x.station || '';
    const trip = oMs(x.trip_at), end = x.sync_at ? oMs(x.sync_at) : x.ongoing ? now : trip;
    const hrs = Math.max(0, (Math.min(end, to) - Math.max(trip, from)) / 36e5), isTrip = x.count_as_trip && trip >= from && trip <= to;
    const cls = O_COL[x.cls] ? x.cls : 'other', a = agg[c] || (agg[c] = blank());
    a[cls] += hrs;
    if (isTrip) { a.trips++; if (cls === 'forced') a.forcedTrips++; }
    if (!inScope(c, station)) return;
    items.push({...x, cls, station, t0: Math.max(trip, from), t1: Math.max(Math.max(trip, from), Math.min(end, to)), hrsIn: hrs});
    if (hrs > 0 || isTrip) { const t = types[x.type_label] || (types[x.type_label] = {label: x.type_label, cls, hours: 0, count: 0}); t.hours += hrs; if (isTrip) t.count++; }
  });
  const order = (d.station_order || []).map(s => s.toUpperCase()), rank = s => { const i = order.indexOf(String(s).toUpperCase()); return i < 0 ? 99 : i; };
  const codes = [...new Set(d.units.filter(u => u.status !== 'Decommissioned').map(u => u.code.toUpperCase()).concat(Object.keys(agg)))];
  const unitRows = codes.map(c => { const u = master[c] || {code: c, station: '', unit: c, capacity_mw: 0}; return {code: u.code, station: u.station, unit: u.unit, cap: u.capacity_mw || 0, ...(agg[c] || blank())}; })
    .sort((a, b) => rank(a.station) - rank(b.station) || String(a.code).localeCompare(String(b.code), undefined, {numeric: true}));
  const sum = (rows, k) => rows.reduce((t, r) => t + r[k], 0);
  // Percentages are capacity-weighted, as in the outage report.
  const pct = (rows, k) => { const cap = sum(rows, 'cap'); return cap ? rows.reduce((t, r) => t + r[k] * r.cap, 0) / (cap * clock) * 100 : 0; };
  const total = rows => ({units: rows.length, cap: sum(rows, 'cap'), forced: sum(rows, 'forced'), planned: sum(rows, 'planned'), reserve: sum(rows, 'reserve'), other: sum(rows, 'other'),
    trips: sum(rows, 'trips'), forcedTrips: sum(rows, 'forcedTrips'), forcedPct: pct(rows, 'forced'), plannedPct: pct(rows, 'planned'), reservePct: pct(rows, 'reserve')});
  const scope = unitRows.filter(r => inScope(r.code.toUpperCase(), r.station));
  const stationRows = [...new Set(unitRows.map(r => r.station))].map(s => ({station: s, ...total(unitRows.filter(r => r.station === s))}));
  const years = {};
  scope.forEach(r => Object.entries(d.years[r.code.toUpperCase()] || {}).forEach(([fy, v]) => { const y = years[fy] || (years[fy] = {fy, trips: 0, forcedTrips: 0, forced: 0, planned: 0, reserve: 0}); y.trips += v[0]; y.forcedTrips += v[1]; y.forced += v[2]; y.planned += v[3]; y.reserve += v[4]; }));
  return {from, to, clock, items, scope, stationRows, totals: total(scope), types: Object.values(types).sort((a, b) => b.hours - a.hours), years: Object.values(years).sort((a, b) => a.fy.localeCompare(b.fy)).slice(-8), st, code};
}

const oHrs = r => O_CLS.map(([k, l, c]) => `<i style="display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:4px;background:${c}"></i>${l} ${fmt(r[k], 1)}`).join(' &nbsp; ');

/** A donut whose slices can be touched to filter: items [{label, value, colour, act, arg}]. */
function oDonut(items, centre, sub, title) {
  const total = items.reduce((t, x) => t + x.value, 0);
  if (!total) return `<div class="empty" style="min-height:120px">No outage hours</div>`;
  const r = 40, c = 2 * Math.PI * r, gap = items.length > 1 ? 1.6 : 0;
  let at = 0;
  const arcs = items.map(x => {
    const len = x.value / total * c, dash = Math.max(0.6, len - gap);
    const s = `<circle cx="50" cy="50" r="${r}" fill="none" stroke-width="16" style="stroke:${x.colour};cursor:pointer" stroke-dasharray="${dash.toFixed(2)} ${(c - dash).toFixed(2)}"
      stroke-dashoffset="${(-at).toFixed(2)}" transform="rotate(-90 50 50)" ${x.act ? `data-tact="${x.act}" data-targ="${esc(x.arg)}"` : ''}
      data-tip="${esc(`<b>${esc(x.label)}</b><br>${fmt(x.value, 1)} h · ${fmt(x.value / total * 100, 1)}%`)}"/>`;
    at += len;
    return s;
  }).join('');
  return `<div class="chart" style="text-align:center"><div class="muted" style="font-size:11.5px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">${esc(title)}</div>
    <svg viewBox="0 0 100 100" width="132" height="132" role="img" aria-label="${esc(title)}" style="display:inline-block;width:132px">
    <circle cx="50" cy="50" r="${r}" fill="none" stroke-width="16" style="stroke:var(--soft)"/>${arcs}
    <text x="50" y="49" text-anchor="middle" style="fill:var(--ink);font-size:12px;font-weight:700">${esc(centre)}</text><text x="50" y="60" text-anchor="middle" style="fill:var(--muted);font-size:7.5px">${esc(sub)}</text></svg>
    <div class="tip" style="display:none;white-space:normal;min-width:120px"></div>
    <div style="text-align:left;margin-top:4px">${items.map(x => `<div ${x.act ? `data-tact="${x.act}" data-targ="${esc(x.arg)}" style="cursor:pointer;` : 'style="'}display:flex;justify-content:space-between;gap:6px;font-size:12px;padding:2px 0"><span><i style="display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:5px;background:${x.colour}"></i>${esc(x.label)}</span><b class="num">${fmt(x.value / total * 100, 0)}%</b></div>`).join('')}</div></div>`;
}

/**
 * Two donuts of outage hours: by kind (touch to show only that kind in the list), and by station, by unit
 * of the chosen station, or by cause for one unit (touch a station or unit to filter the whole page to it).
 */
function oDonuts(c) {
  const t = c.totals, hrs = t.forced + t.planned + t.reserve + t.other;
  if (!hrs) return '';
  const kinds = O_CLS.map(([k, l, col]) => ({label: l, value: t[k], colour: col, act: 'ocls', arg: k})).concat(t.other ? [{label: 'Type not recorded', value: t.other, colour: O_COL.other}] : []).filter(x => x.value > 0);
  const out = r => r.forced + r.planned + r.reserve + r.other;
  let items, title;
  if (!c.st) {
    const rows = c.stationRows.map(s => ({label: s.station || '—', value: out(s), act: 'ost', arg: s.station})).filter(x => x.value > 0).sort((a, b) => b.value - a.value);
    items = rows.slice(0, 7).concat(rows.length > 7 ? [{label: 'Other stations', value: rows.slice(7).reduce((s, x) => s + x.value, 0)}] : []);
    title = 'By station';
  } else if (!c.code) {
    const rows = c.scope.map(u => ({label: 'Unit ' + u.unit, value: out(u), act: 'oun', arg: u.code})).filter(x => x.value > 0).sort((a, b) => b.value - a.value);
    items = rows.slice(0, 7).concat(rows.length > 7 ? [{label: 'Other units', value: rows.slice(7).reduce((s, x) => s + x.value, 0)}] : []);
    title = c.st + ' by unit';
  } else {
    items = c.types.filter(x => x.hours > 0).slice(0, 8).map(x => ({label: x.label, value: x.hours}));
    title = c.code + ' by cause';
  }
  items.forEach((x, i) => { x.colour = `var(--k${i + 1})`; });
  const back = c.code ? `<a data-tact="oun" data-targ="" style="color:var(--accent)">‹ all units of ${esc(c.st)}</a>` : c.st ? `<a data-tact="ost" data-targ="" style="color:var(--accent)">‹ all stations</a>` : '';
  return `<div class="card"><h2>Outage hours at a glance ${conMore('touch to filter')}</h2>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;align-items:start">${oDonut(kinds, fmt(hrs, 0), 'hours out', 'By kind')}${oDonut(items, String(items.length), title === 'By station' ? 'stations' : c.code ? 'causes' : 'units', title)}</div>
    <div class="note-src">${back ? back + ' · ' : ''}Touching a kind shows only those outages in the list below; touching a station or unit filters the whole page.${(W.sel.ocls || '') ? ` Showing ${esc(W.sel.ocls)} only — <a data-tact="ocls" data-targ="" style="color:var(--accent)">show all kinds</a>.` : ''}</div></div>`;
}

/** When each unit was out during the period, coloured by the kind of outage. */
function oTimeline(c) {
  const live = c.items.filter(x => x.t1 > x.t0), codes = [...new Set(live.map(x => x.code))];
  if (!codes.length) return '';
  const hours = k => live.filter(x => x.code === k).reduce((t, x) => t + x.hrsIn, 0);
  const shown = (codes.length > 24 ? [...codes].sort((a, b) => hours(b) - hours(a)).slice(0, 24) : codes).sort((a, b) => String(a).localeCompare(String(b), undefined, {numeric: true}));
  const VW = 340, L = 62, R = 8, T = 6, RH = 18, B = 20, H = T + shown.length * RH + B;
  const x = t => L + (t - c.from) / (c.to - c.from) * (VW - L - R), day = t => { const dt = new Date(t); return dt.getDate() + ' ' + CON_MON[dt.getMonth()]; };
  const ticks = [0, 1, 2, 3, 4].map(i => c.from + (c.to - c.from) * i / 4);
  return `<div class="card"><h2>Unit timeline ${conMore(codes.length > 24 ? 'the 24 units with most hours' : 'touch a bar')}</h2><div class="chart"><svg viewBox="0 0 ${VW} ${H}" role="img" aria-label="When each unit was out">
    ${ticks.map((t, i) => `<line class="grid" x1="${x(t)}" x2="${x(t)}" y1="${T}" y2="${H - B}"/><text class="ax" x="${x(t)}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : i === 4 ? 'end' : 'middle'}">${day(i === 4 ? t - 1 : t)}</text>`).join('')}
    ${shown.map((k, i) => `<text class="ax" x="${L - 6}" y="${T + i * RH + 12.5}" text-anchor="end" style="fill:var(--ink)">${esc(k)}</text><rect x="${L}" y="${T + i * RH + 4}" width="${VW - L - R}" height="10" rx="3" style="fill:var(--soft)"/>`).join('')}
    ${live.filter(o => shown.includes(o.code)).map(o => { const i = shown.indexOf(o.code), w = Math.max(2, x(o.t1) - x(o.t0));
      return `<rect x="${x(o.t0).toFixed(1)}" y="${T + i * RH + 4}" width="${w.toFixed(1)}" height="10" rx="${Math.min(3, w / 2)}" style="fill:${O_COL[o.cls]};stroke:var(--card)" stroke-width="${w > 5 ? 1 : 0}" data-tip="${esc(`<b>${esc(o.code)}</b> · ${esc(o.type_label)}<br>${conDate(o.trip_at, true)} → ${o.sync_at ? conDate(o.sync_at, true) : o.ongoing ? 'still out' : '—'}<br>${fmt(o.hrsIn, 1)} h in this period`)}"/>`; }).join('')}
  </svg><div class="tip" style="display:none;white-space:normal;text-align:left;min-width:170px"></div></div>
  ${tLegend(O_CLS.map(([, l, col]) => [col, l]).concat(c.items.some(x => x.cls === 'other') ? [[O_COL.other, 'Type not recorded']] : []))}</div>`;
}

/** Hours lost by financial year (the whole record), stacked by kind, with the number of trips. */
function oYears(c) {
  const ys = c.years;
  if (ys.length < 2) return '';
  const VW = 340, H = 190, L = 40, R = 8, T = 18, B = 22, hi = Math.max(1, ...ys.map(y => y.forced + y.planned + y.reserve)) * 1.08;
  const slot = (VW - L - R) / ys.length, bw = Math.min(slot * 0.56, 24), y = v => T + (1 - v / hi) * (H - T - B), show = v => tShort(v) || fmt(v, 0);
  return `<div class="card"><h2>Year-wise record ${conMore('hours out · trips above')}</h2><div class="chart"><svg viewBox="0 0 ${VW} ${H}" role="img" aria-label="Outage hours by financial year">
    ${niceTicks(0, hi, 4).map(v => `<line class="grid" x1="${L}" x2="${VW - R}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${L - 5}" y="${y(v) + 3.5}" text-anchor="end">${show(v)}</text>`).join('')}
    ${ys.map((r, i) => { const cx = L + (i + 0.5) * slot; let base = 0;
      const bars = O_CLS.map(([k, , col]) => { const v = r[k]; if (v <= 0) return ''; const y1 = y(base + v), hgt = Math.max(0, y(base) - y1 - 2); base += v; return `<rect x="${(cx - bw / 2).toFixed(1)}" y="${y1.toFixed(1)}" width="${bw.toFixed(1)}" height="${hgt.toFixed(1)}" rx="2" style="fill:${col}"/>`; }).join('');
      return bars + `<text class="ax" x="${cx}" y="${y(base) - 5}" text-anchor="middle" style="fill:var(--ink)">${r.trips}</text><text class="ax" x="${cx}" y="${H - 6}" text-anchor="middle">${esc(eYear(r.fy))}</text>
        <rect x="${L + i * slot}" y="${T}" width="${slot}" height="${H - T - B}" fill="transparent" data-tip="${esc(`<b>${esc(r.fy)}</b> · ${r.trips} trips (${r.forcedTrips} forced)<br>Forced ${fmt(r.forced, 0)} h<br>Planned ${fmt(r.planned, 0)} h<br>Reserve ${fmt(r.reserve, 0)} h`)}"/>`; }).join('')}
  </svg><div class="tip" style="display:none;white-space:normal;text-align:left;min-width:150px"></div></div>
  ${tLegend(O_CLS.map(([, l, col]) => [col, l]))}<div class="note-src">By the financial year in which each outage began, over the whole register. Touch a column for its figures.</div>
  ${csvBtn('oYrs', 'GSECL_outages_year_wise_' + (c.code || c.st || 'all'), ['Financial year', 'Trips', 'Forced trips', 'Forced h', 'Planned h', 'Reserve h'], ys.map(r => [r.fy, r.trips, r.forcedTrips, +r.forced.toFixed(1), +r.planned.toFixed(1), +r.reserve.toFixed(1)]))}</div>`;
}

// ---------------------------------------------------------------- reliability analytics

const oIsBtl = x => /^BTL$/i.test(String(x.type || '')) || /tube/i.test(String(x.type_label || ''));

/**
 * Per unit over the chosen period: forced trips, MTBF (hours in the period not on outage / forced trips),
 * MTTR (forced outage hours / forced trips), and boiler tube leaks.
 */
function oReliability(c) {
  const byUnit = new Map();
  for (const x of c.items) {
    const u = byUnit.get(x.code) || byUnit.set(x.code, {code: x.code, station: x.station, unit: x.unit, forced: 0, trips: 0, outH: 0, forcedH: 0, btl: []}).get(x.code);
    u.outH += x.hrsIn;
    const inPeriod = oMs(x.trip_at) >= c.from && oMs(x.trip_at) < c.to;
    if (x.cls === 'forced') { u.forcedH += x.hrsIn; if (inPeriod && x.count_as_trip !== false) u.trips++; }
    if (oIsBtl(x) && inPeriod) u.btl.push(x);
  }
  const rows = [...byUnit.values()].filter(u => u.trips || u.btl.length).map(u => ({...u,
    mtbf: u.trips ? Math.max(0, c.clock - u.outH) / u.trips : null, mttr: u.trips ? u.forcedH / u.trips : null}))
    .sort((a, b) => b.trips - a.trips || (a.mtbf ?? 1e9) - (b.mtbf ?? 1e9));
  if (!rows.length) return `<div class="card"><h2>Reliability ${conMore('forced outages')}</h2>${conEmpty('No forced outage in this period.')}</div>`;
  const repeat = rows.filter(u => u.btl.length >= 2).sort((a, b) => b.btl.length - a.btl.length);
  const days = (a, b) => Math.round((oMs(b.trip_at) - oMs(a.trip_at)) / 864e5);
  let h = `<div class="card"><h2>Reliability by unit ${conMore(c.clock < 24 * 60 ? 'choose a financial year for a fuller picture' : 'forced outages in the period')}</h2>
    <div style="overflow-x:auto"><table class="dt num"><tr><th>Unit</th><th>Forced trips</th><th>MTBF h</th><th>MTTR h</th><th>Tube leaks</th></tr>
    ${rows.slice(0, 25).map(u => `<tr data-tact="oun" data-targ="${esc(u.code)}" style="cursor:pointer"><td>${esc(u.code)}</td><td>${u.trips}</td>
      <td>${u.mtbf === null ? '—' : `<span class="${u.mtbf < 720 ? 'neg' : ''}">${fmt(u.mtbf, 0)}</span>`}</td><td>${u.mttr === null ? '—' : fmt(u.mttr, 1)}</td>
      <td>${u.btl.length ? `<b class="${u.btl.length >= 2 ? 'neg' : ''}">${u.btl.length}</b>` : '—'}</td></tr>`).join('')}</table></div>
    <div class="note-src">MTBF = hours in the period not on any outage ÷ forced trips (red: under 30 days). MTTR = forced outage hours ÷ forced trips. Touch a unit for its outages.</div>
    ${csvBtn('oRel', 'GSECL_unit_reliability_' + c.from, ['Unit', 'Station', 'Forced trips', 'MTBF h', 'MTTR h', 'Boiler tube leaks', 'Outage hours (all kinds)'],
      rows.map(u => [u.code, u.station, u.trips, u.mtbf === null ? null : +u.mtbf.toFixed(1), u.mttr === null ? null : +u.mttr.toFixed(2), u.btl.length, +u.outH.toFixed(1)]))}</div>`;
  h += `<div class="card"><h2>Repeat boiler tube leaks ${conMore(repeat.length ? repeat.length + ' unit(s)' : 'none')}</h2>` + (repeat.length
    ? repeat.map(u => { const l = [...u.btl].sort((a, b) => oMs(a.trip_at) - oMs(b.trip_at)), gaps = l.slice(1).map((x, i) => days(l[i], x));
      return `<div class="oq" style="--oc:var(--forced)"><div class="oq-h"><span class="nm">${esc(u.code)}</span><span class="badge b-Forced">${l.length} leaks</span>
          <span class="cap num">${gaps.length ? 'every ' + fmt(gaps.reduce((t, g) => t + g, 0) / gaps.length, 0) + '<small> days</small>' : ''}</span></div>
        <div class="live">${l.map((x, i) => `${conDate(x.trip_at)}${i ? ` <span class="muted">(+${gaps[i - 1]} d)</span>` : ''}${x.reason ? ' · ' + esc(String(x.reason).slice(0, 60)) : ''}`).join('<br>')}</div></div>`; }).join('')
      + '<div class="note-src">Two or more boiler tube leaks of one unit in the period, with the days between them: a short gap points to an unresolved cause (water chemistry, erosion zone, weld quality).</div>'
    : conEmpty('No unit had more than one boiler tube leak in this period.')) + '</div>';
  return h;
}

/** Outage hours by cause, month by month (week by week for periods up to two months): stacked columns. */
function oCauseTrend(c) {
  const live = c.items.filter(x => x.hrsIn > 0);
  if (!live.length) return '';
  const weekly = c.to - c.from <= 62 * 864e5;
  const keyOf = t => { const d = new Date(t); if (!weekly) return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; const m = new Date(d); m.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return m.toISOString().slice(0, 10); };
  const label = k => weekly ? conDate(k).replace(/ \d{4}$/, '') : CON_MON[+k.slice(5, 7) - 1] + ' ' + k.slice(2, 4);
  // Hours are put in the bucket of the outage start (the part inside the period).
  const totals = {};
  live.forEach(x => { totals[x.type_label] = (totals[x.type_label] || 0) + x.hrsIn; });
  const top = Object.entries(totals).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k]) => k);
  const causeOf = x => (top.includes(x.type_label) ? x.type_label : 'Other causes');
  const causes = top.concat(Object.keys(totals).length > top.length ? ['Other causes'] : []);
  const buckets = new Map();
  for (let t = c.from; t < c.to; t += weekly ? 7 * 864e5 : 28 * 864e5) buckets.set(keyOf(t), {});
  live.forEach(x => { const k = keyOf(Math.max(oMs(x.trip_at), c.from)); const b = buckets.get(k) || buckets.set(k, {}).get(k); b[causeOf(x)] = (b[causeOf(x)] || 0) + x.hrsIn; });
  const keys = [...buckets.keys()].sort();
  if (keys.length < 2) return '';
  const colour = i => `var(--k${i + 1})`;
  const VW = 340, H = 200, L = 40, R = 8, T = 10, B = 22, max = Math.max(1, ...keys.map(k => Object.values(buckets.get(k)).reduce((t, v) => t + v, 0))) * 1.1;
  const slot = (VW - L - R) / keys.length, bw = Math.min(slot * 0.62, 26), y = v => T + (1 - v / max) * (H - T - B), every = Math.max(1, Math.ceil(keys.length / 7));
  const cols = keys.map((k, i) => { let base = 0; const b = buckets.get(k), cx = L + (i + 0.5) * slot;
    const rects = causes.map((cause, j) => { const v = b[cause] || 0; if (!v) return ''; const y1 = y(base + v), hh = y(base) - y1; base += v;
      return `<rect x="${(cx - bw / 2).toFixed(1)}" y="${y1.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0.5, hh - 1).toFixed(1)}" rx="2" style="fill:${colour(j)}"/>`; }).join('');
    return rects + `<rect x="${L + i * slot}" y="${T}" width="${slot}" height="${H - T - B}" fill="transparent" data-tip="${esc(`<b>${label(k)}</b>` + causes.filter(cs => b[cs]).map(cs => `<br>${esc(cs)} ${fmt(b[cs], 1)} h`).join('') || '<br>No outage')}"/>`; }).join('');
  return `<div class="card"><h2>Cause-wise trend ${conMore(weekly ? 'hours per week' : 'hours per month')}</h2><div class="chart"><svg viewBox="0 0 ${VW} ${H}" role="img" aria-label="Outage hours by cause over time">
    ${niceTicks(0, max, 4).map(v => `<line class="grid" x1="${L}" x2="${VW - R}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${L - 5}" y="${y(v) + 3.5}" text-anchor="end">${tShort(v) || fmt(v, 0)}</text>`).join('')}
    ${cols}${keys.map((k, i) => i % every ? '' : `<text class="ax" x="${L + (i + 0.5) * slot}" y="${H - 6}" text-anchor="middle">${esc(label(k))}</text>`).join('')}
  </svg><div class="tip" style="display:none;white-space:normal;text-align:left;min-width:150px"></div></div>
  ${tLegend(causes.map((cs, j) => [colour(j), cs]))}
  ${csvBtn('oCause', 'GSECL_outage_hours_by_cause_' + c.from, [weekly ? 'Week from' : 'Month'].concat(causes), keys.map(k => [k].concat(causes.map(cs => +(buckets.get(k)[cs] || 0).toFixed(1)))))}</div>`;
}

function oReg() {
  const d = W.data.opack;
  if (!d) return W.busy ? conSpin() : '';
  const c = oCalc(), t = c.totals, p = wPeriod();
  const stations = [...new Set(d.units.map(u => u.station).filter(Boolean))].sort(), st = W.sel.ostation || '';
  const stUnits = d.units.filter(u => u.station === st && (u.status !== 'Decommissioned' || c.scope.some(r => r.code === u.code)));
  let h = `<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">${wSel('period', W.sel.period || 'month', null, ['month', '30', 'fy', 'lastfy', 'custom'], ['This month', 'Last 30 days', 'This financial year', 'Last financial year', 'Custom dates'])}${wSel('ostation', st, 'All stations', stations)}</div>
    ${W.sel.period === 'custom' ? `<div style="display:grid;grid-template-columns:1fr 1fr auto;gap:6px;align-items:end;margin-bottom:8px">
      <label style="font-size:11px;color:var(--muted)">From<input class="search" id="oFrom" type="date" value="${esc(W.sel.pfrom || p.from)}" style="margin:2px 0 0;padding:8px"></label>
      <label style="font-size:11px;color:var(--muted)">To<input class="search" id="oTo" type="date" value="${esc(W.sel.pto || p.to)}" style="margin:2px 0 0;padding:8px"></label>
      <button class="btn" data-tact="oapply" style="background:var(--accent);color:#fff;border-color:var(--accent);margin:0">Show</button></div>` : ''}
    ${st ? wSel('ounit', W.sel.ounit || '', 'All units of ' + st, stUnits.map(u => u.code), stUnits.map(u => `Unit ${u.unit} · ${u.code} · ${fmt(u.capacity_mw)} MW`)) : ''}
    <div class="note-src" style="text-align:center;margin:0 0 8px">${W.busy ? 'Reading the outage register…' : `Read from the Google Sheet at ${oClock(W.data.ostamp)}`} · <a data-tact="oreload">Refresh</a></div>`;
  if (d.can_edit) h += `<div style="margin-bottom:10px">${wBtn('Record an outage', 'editout', '', true)}</div>`;
  h += `<div class="card"><h2>${conDate(p.from)} – ${conDate(p.to)} ${conMore(c.code || c.st || 'All GSECL')}</h2><div class="tstats" style="grid-template-columns:repeat(3,1fr)">
      <div><span>Trips</span><b class="num">${t.trips}</b><small>${wNum(t.forced + t.planned + t.reserve + t.other, 1)} h out</small></div>
      <div><span>Forced</span><b class="num neg">${t.forcedTrips}</b><small>${wNum(t.forced, 1)} h · ${wNum(t.forcedPct)}%</small></div>
      <div><span>Planned</span><b class="num">${wNum(t.plannedPct)}%</b><small>${wNum(t.planned, 1)} h</small></div></div>
    <div class="note-src">Reserve shutdown ${wNum(t.reserve, 1)} h (${wNum(t.reservePct)}%). Percentages are of the period's hours, weighted by unit capacity (${fmt(t.cap)} MW in ${t.units} unit${t.units === 1 ? '' : 's'}).</div></div>`;
  h += oDonuts(c);
  const colours = O_CLS.map(x => x[2]);
  const per = `${p.from}_${p.to}`, hrsHead = O_CLS.map(([, l]) => l + ' h');
  if (!st) h += `<div class="card"><h2>Station-wise ${conMore('touch a station for its units')}</h2>${tBars(c.stationRows.map(s => ({label: s.station || '—', sub: `${s.units} units · ${fmt(s.cap)} MW`, vals: O_CLS.map(([k]) => s[k]), text: oHrs(s) + ` &nbsp; · ${s.trips} trip${s.trips === 1 ? '' : 's'} · forced ${wNum(s.forcedPct)}%`, act: 'ost', arg: s.station})), colours)}
    ${csvBtn('oSt', 'GSECL_outage_hours_by_station_' + per, ['Station', 'Units', 'Capacity MW'].concat(hrsHead, ['Trips', 'Forced trips', 'Forced %', 'Planned %', 'Reserve %']), c.stationRows.map(s => [s.station, s.units, s.cap].concat(O_CLS.map(([k]) => +s[k].toFixed(2)), [s.trips, s.forcedTrips, +s.forcedPct.toFixed(2), +s.plannedPct.toFixed(2), +s.reservePct.toFixed(2)])))}</div>`;
  else if (!c.code) h += `<div class="card"><h2>${esc(st)} · unit-wise ${conMore('touch a unit')}</h2>${tBars(c.scope.map(u => ({label: 'Unit ' + u.unit, sub: `${u.code} · ${fmt(u.cap)} MW`, vals: O_CLS.map(([k]) => u[k]), text: oHrs(u) + ` &nbsp; · ${u.trips} trip${u.trips === 1 ? '' : 's'}`, act: 'oun', arg: u.code})), colours)}
    ${csvBtn('oUn', `${st}_outage_hours_by_unit_` + per, ['Unit', 'Code', 'Capacity MW'].concat(hrsHead, ['Trips', 'Forced trips']), c.scope.map(u => [u.unit, u.code, u.cap].concat(O_CLS.map(([k]) => +u[k].toFixed(2)), [u.trips, u.forcedTrips])))}</div>`;
  h += oTimeline(c);
  h += oReliability(c);
  h += oCauseTrend(c);
  if (c.types.length) { const max = Math.max(1e-9, ...c.types.map(x => x.hours));
    h += `<div class="card"><h2>By cause ${conMore('hours · trips')}</h2>${c.types.map(x => `<div class="srow" style="cursor:default"><div class="top"><span class="nm">${esc(x.label)}</span><span class="vals num"><b style="color:var(--ink)">${fmt(x.hours, 1)} h</b> · ${x.count} trip${x.count === 1 ? '' : 's'}</span></div>
      <div style="height:10px;margin-top:6px;border-radius:3px;width:${Math.max(x.hours / max * 100, x.hours ? 1.5 : 0)}%;background:${O_COL[x.cls]}"></div></div>`).join('')}${tLegend(O_CLS.map(([, l, col]) => [col, l]))}</div>`; }
  h += oYears(c);
  const cls = W.sel.ocls || '', list = c.items.filter(x => !cls || x.cls === cls), shown = W.data.oshown || 30;
  const listCsv = csvBtn('oList', 'GSECL_outages_' + (c.code || c.st || 'all') + '_' + per, ['Station', 'Unit', 'Code', 'Kind', 'Type', 'Tripped', 'Synchronised', 'Hours (total)', 'Hours in period', 'Reason', 'Remarks'],
    list.map(x => [x.station, x.unit, x.code, x.cls, x.type_label || x.type, x.trip_at, x.sync_at || (x.ongoing ? 'ongoing' : ''), x.hours, +x.hrsIn.toFixed(2), x.reason, x.remarks]), 'Export list CSV');
  h += `<div class="card"><h2>${list.length} outage${list.length === 1 ? '' : 's'}</h2><div class="chips" style="padding-bottom:0">${[['', 'All'], ['forced', 'Forced'], ['planned', 'Planned'], ['reserve', 'Reserve']].map(([v, l]) => `<button class="chip ${cls === v ? 'on' : ''}" data-tact="ocls" data-targ="${v}">${l}</button>`).join('')}</div></div>`
    + (list.slice(0, shown).map(x => `<div class="oq" style="--oc:${O_COL[x.cls]}">
      <div class="oq-h"><span class="nm">${esc((x.station || '') + ' ' + (x.unit || x.code))}</span><span class="badge ${x.cls === 'forced' ? 'b-Forced' : x.cls === 'planned' ? 'b-Planned' : 'b-RSD'}">${esc(x.type_label || x.type)}</span>
        <span class="cap num">${x.ongoing ? 'Ongoing' : wNum(x.hours, 1) + '<small> h</small>'}</span></div>
      <div class="meta num"><div><span>Tripped</span>${conDate(x.trip_at, true)}</div><div><span>Synchronised</span>${x.sync_at ? conDate(x.sync_at, true) : '—'}</div></div>
      <div class="rs">${esc(x.reason)}</div>${x.remarks ? `<div class="live">${esc(x.remarks)}</div>` : ''}
      <div class="live">${esc(x.entered_by ? 'Entered by ' + x.entered_by : '')}${d.can_edit ? ` <a data-wact="editout" data-warg="${x.id}" style="color:var(--accent)">Edit</a> · <a data-wact="delout" data-warg="${x.id}" style="color:var(--neg)">Delete</a>` : ''}</div></div>`).join('') || `<div class="card">${conEmpty('No outage in this period.')}</div>`)
    + (list.length > shown ? `<div style="text-align:center"><button class="btn" data-tact="omore" style="color:var(--accent)">Show more (${list.length - shown} left)</button></div>` : '')
    + (list.length ? listCsv : '');
  return h;
}

// ================================================================ Installed capacity (Connect > More)

// Sources in a fixed order with their colours (--k1 … --k8; checked for colour-blind separation in this order).
const CAP_ORDER = ['Coal', 'Lignite', 'Gas & diesel', 'Hydro', 'Nuclear', 'Solar', 'Wind', 'Other RE'];
const capCol = c => `var(--k${CAP_ORDER.indexOf(c) + 1})`;
/** Station type / fuel text -> capacity source. */
const capOf = t => { t = String(t || '').toLowerCase(); return /lignite/.test(t) ? 'Lignite' : /coal|thermal/.test(t) ? 'Coal' : /gas|diesel/.test(t) ? 'Gas & diesel'
  : /hydro/.test(t) ? 'Hydro' : /nuclear/.test(t) ? 'Nuclear' : /solar/.test(t) ? 'Solar' : /wind/.test(t) ? 'Wind' : 'Other RE'; };
const capLegend = list => `<div class="keyline">${list.map(c => `<span><i style="width:10px;height:10px;border-radius:2px;background:${capCol(c)}"></i>${esc(c)}</span>`).join('')}</div>`;

/** One horizontal bar split by source; the figures are in data-tip (touch) and in the table below. */
function capBar(values, total, label, sub) {
  const parts = CAP_ORDER.map(c => [c, values[c] || 0]).filter(([, v]) => v > 0);
  return `<div style="margin:10px 0 12px"><div style="display:flex;justify-content:space-between;font-size:13px"><b>${esc(label)}</b><span class="muted num">${esc(sub || '')}</span></div>
    <div class="chart" style="margin-top:5px"><div style="display:flex;gap:2px;height:22px;border-radius:5px;overflow:hidden">${parts.map(([c, v]) => {
      const pct = v / total * 100;
      return `<i data-tip="${esc(`<b>${esc(c)}</b> · ${fmt(v)} MW · ${fmt(pct, 1)}%`)}" style="flex:${v} 0 0;min-width:3px;background:${capCol(c)};display:flex;align-items:center;justify-content:center;font-style:normal;font-size:10.5px;font-weight:700;color:#fff;overflow:hidden">${pct >= 9 ? Math.round(pct) + '%' : ''}</i>`;
    }).join('')}</div><div class="tip" style="display:none"></div></div></div>`;
}

/** Donut of a capacity mix: slices by source with gaps, the total in the middle; touch a slice for MW and share. */
function capDonut(values, total, label, size = 116) {
  const parts = CAP_ORDER.map(c => [c, values[c] || 0]).filter(([, v]) => v > 0);
  const r = 40, c = 2 * Math.PI * r, gap = parts.length > 1 ? 1.6 : 0;
  let at = 0;
  const arcs = parts.map(([k, v]) => {
    const len = v / total * c, dash = Math.max(0.6, len - gap);
    const seg = `<circle cx="50" cy="50" r="${r}" fill="none" stroke-width="16" style="stroke:${capCol(k)}" stroke-dasharray="${dash.toFixed(2)} ${(c - dash).toFixed(2)}" stroke-dashoffset="${(-at).toFixed(2)}" transform="rotate(-90 50 50)"
      data-tip="${esc(`<b>${esc(label)} · ${esc(k)}</b><br>${fmt(v)} MW · ${fmt(v / total * 100, 1)}%`)}"/>`;
    at += len;
    return seg;
  }).join('');
  const big = total >= 100000 ? fmt(total / 1000, 0) + 'k' : fmt(total);
  return `<div class="chart" style="text-align:center"><svg viewBox="0 0 100 100" width="${size}" height="${size}" role="img" aria-label="${esc(label)} installed capacity by source" style="display:inline-block;width:${size}px">
    <circle cx="50" cy="50" r="${r}" fill="none" stroke-width="16" style="stroke:var(--soft)"/>${arcs}
    <text x="50" y="49" text-anchor="middle" style="fill:var(--ink);font-size:13px;font-weight:700">${big}</text><text x="50" y="61" text-anchor="middle" style="fill:var(--muted);font-size:8px">MW</text></svg>
    <div style="font-size:12.5px;font-weight:700;margin-top:2px">${esc(label)}</div><div class="tip" style="display:none;white-space:normal;min-width:120px"></div></div>`;
}

function wCapacity() {
  const d = W.data.capacity;
  if (!d) return W.busy ? conSpin() : '';
  const ents = d.entities.filter(e => e.has_data);
  if (!ents.length) return `<div class="card">${conEmpty('No capacity figures entered.')}</div>`;
  const byName = n => ents.find(e => e.name.toLowerCase() === n.toLowerCase());
  const vals = e => Object.fromEntries(d.categories.map((c, i) => [c, e.values[i] || 0]));
  const used = CAP_ORDER.filter(c => ents.some(e => (vals(e)[c] || 0) > 0));
  let h = `<div class="card"><h2>Installed capacity mix ${conMore('touch a slice')}</h2><div style="display:grid;grid-template-columns:repeat(${Math.min(3, ents.length)},1fr);gap:4px">${ents.map(e => capDonut(vals(e), e.total, e.name, ents.length > 2 ? 104 : 130)).join('')}</div>${capLegend(used)}</div>
    <div class="card"><h2>Share by source ${conMore('touch a part for MW')}</h2>${ents.map(e => capBar(vals(e), e.total, e.name, `${fmt(e.total)} MW · ${conDate(e.as_on)}`)).join('')}${capLegend(used)}
    <div class="note-src">Each bar is 100% of that entity's installed capacity, so the mix can be compared even though the totals differ a lot.</div></div>`;
  // GSECL against Gujarat, source by source.
  const g = byName('GSECL'), guj = byName('Gujarat');
  if (g && guj) {
    const gv = vals(g), jv = vals(guj), rows = used.filter(c => jv[c] > 0);
    h += `<div class="card"><h2>GSECL's share of Gujarat ${conMore(fmt(g.total / guj.total * 100, 1) + '% overall')}</h2>${rows.map(c => { const pct = (gv[c] || 0) / jv[c] * 100;
      return `<div class="srow" style="cursor:default"><div class="top"><span class="nm"><i style="display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px;background:${capCol(c)}"></i>${esc(c)}</span><span class="vals num"><b style="color:var(--ink)">${fmt(pct, 1)}%</b> · ${fmt(gv[c] || 0)} of ${fmt(jv[c])} MW</span></div>
        <div style="height:10px;margin-top:6px;border-radius:3px;background:var(--soft);overflow:hidden"><div style="height:100%;width:${Math.min(100, pct)}%;background:${capCol(c)};border-radius:3px"></div></div></div>`; }).join('')}</div>`;
  }
  // Totals over time, where more than one statement has been entered.
  const hist = ents.filter(e => (e.history || []).filter(x => x.as_on).length >= 2);
  hist.forEach((e, i) => {
    const pts = e.history.filter(x => x.as_on);
    h += `<div class="card"><h2>${esc(e.name)} installed capacity over time ${conMore('MW')}</h2>${tLine('capH' + i, pts.map(x => x.as_on), [{name: e.name, slot: 0, vals: pts.map(x => x.total)}], {h: 150, short: s => conDate(s).replace(/^\d+ /, ''), label: e.name + ' capacity'})}</div>`;
  });
  h += `<div class="card"><h2>Installed capacity by source ${conMore('MW')}</h2><div style="overflow-x:auto"><table class="dt num"><tr><th>Source</th>${ents.map(e => `<th>${esc(e.name)}</th>`).join('')}</tr>
      ${d.categories.map((c, i) => `<tr><td><i style="display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:5px;background:${capCol(c)}"></i>${esc(c)}</td>${ents.map(e => `<td>${wNum(e.values[i], 0)}</td>`).join('')}</tr>`).join('')}
      <tr class="hl"><td>Total</td>${ents.map(e => `<td>${wNum(e.total, 0)}</td>`).join('')}</tr></table></div>
      <div class="note-src">${ents.map(e => `${esc(e.name)}: as on ${conDate(e.as_on)}${e.source ? ' (' + esc(e.source) + ')' : ''}`).join(' · ')}</div></div>`;
  return h;
}

/** Stations page: installed MW of each station and the GSECL mix, above the station list. */
function wStationsChart(d) {
  const st = d.stations.filter(s => s.installed_mw > 0).map(s => ({...s, src: capOf(s.type || (s.units[0] || {}).fuel)})).sort((a, b) => b.installed_mw - a.installed_mw);
  if (!st.length) return '';
  const total = st.reduce((t, s) => t + s.installed_mw, 0), max = st[0].installed_mw, mix = {};
  st.forEach(s => { mix[s.src] = (mix[s.src] || 0) + s.installed_mw; });
  return `<div class="card"><h2>Installed capacity by station ${conMore('touch a station for its units')}</h2>
    <div style="display:grid;grid-template-columns:auto 1fr;gap:12px;align-items:center">${capDonut(mix, total, 'GSECL', 120)}<div>${CAP_ORDER.filter(c => mix[c]).map(c => `<div style="display:flex;justify-content:space-between;font-size:12.5px;padding:3px 0"><span><i style="display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px;background:${capCol(c)}"></i>${esc(c)}</span><b class="num">${fmt(mix[c])} MW · ${fmt(mix[c] / total * 100, 1)}%</b></div>`).join('')}</div></div>
    ${st.map(s => `<div class="srow" data-wact="foldgo" data-warg="${esc(s.short_name)}"><div class="top"><span class="nm">${esc(s.short_name)} <small class="muted" style="font-weight:500">${esc(s.src)} · ${s.unit_count} unit${s.unit_count === 1 ? '' : 's'}</small></span><span class="vals num"><b style="color:var(--ink)">${fmt(s.installed_mw)} MW</b> · ${fmt(s.installed_mw / total * 100, 1)}%</span></div>
      <div style="height:10px;margin-top:6px;border-radius:3px;width:${Math.max(2, s.installed_mw / max * 100)}%;background:${capCol(s.src)}"></div></div>`).join('')}
    ${capLegend(CAP_ORDER.filter(c => mix[c]))}</div>`;
}

// ================================================================ Merit order from SLDC (Connect > More)

/**
 * GSECL stations in SLDC's merit order, from the revisions the Generation section reads from SLDC and keeps on
 * the phone (meritHistory in logic.js), so this page follows every new SLDC revision without anyone entering it.
 */
function wMeritSldc() {
  if (typeof meritHistory !== 'function' || typeof STATIONS === 'undefined') return '';
  const hist = meritHistory();
  if (!hist.length) return '';
  const k = Math.min(+(W.sel.msldc ?? hist.length - 1), hist.length - 1), cur = hist[k], prev = hist[k - 1];
  const label = key => { for (const st of STATIONS) for (const b of st.blocks) if (b.key === key) return [b.label, st.fuel]; return [key, '']; };
  const rows = [];
  Object.entries(cur.blocks || {}).forEach(([key, list]) => list.forEach(([cost, rank, note]) => {
    if (cost === null || cost === undefined) return;
    const was = prev && (prev.blocks[key] || []).find(x => (x[2] || null) === (note || null));
    const [name, fuel] = label(key);
    rows.push({name: name + (note ? ' · ' + note : ''), fuel, cost, rank, was: was ? was[0] : null});
  }));
  rows.sort((a, b) => a.cost - b.cost || a.rank - b.rank);
  const max = Math.max(1, ...rows.map(r => r.cost));
  const col = f => (typeof FUEL_COLOR !== 'undefined' && FUEL_COLOR[f]) || 'var(--accent)';
  return `<div class="card"><h2>SLDC merit order · GSECL ${conMore('updated from SLDC')}</h2>
    ${hist.length > 1 ? wSel('msldc', k, null, hist.map((_, i) => i), hist.map(e => 'Revision of ' + e.asOf)) : ''}
    <div class="note-src" style="margin:0 0 8px">Revision of <b>${esc(cur.asOf)}</b>${cur.total ? ` · rank out of ${cur.total} sources supplying Gujarat` : ''}${prev ? ` · change from ${esc(prev.asOf)} shown` : ''}. New SLDC revisions are added automatically whenever the app reads the Generation data.</div>
    ${rows.map((r, i) => `<div class="mo"><span class="rk">#${r.rank}</span><span class="nm">${esc(r.name)}</span><span class="vc num">₹${fmt(r.cost, 2)}${r.was !== null && r.was !== r.cost ? ` <small class="${r.cost > r.was ? 'neg' : 'pos'}">${r.cost > r.was ? '▲' : '▼'} ${fmt(Math.abs(r.cost - r.was), 2)}</small>` : ''}</span>
      <div class="bar"><div class="f" style="width:${r.cost / max * 100}%;background:${col(r.fuel)}"></div></div><div class="st2">${esc(r.fuel || '')}${i === 0 ? ' · cheapest GSECL source' : ''}</div></div>`).join('')}</div>`;
}

// ================================================================ interaction

document.addEventListener('click', e => {
  const el = e.target.closest('[data-tact]');
  if (!el || !hasConnect()) return;
  const arg = el.dataset.targ || '', top = () => window.scrollTo({top: 0});
  const flip = (group, key, list) => {
    const i = list.indexOf(key);
    if (i >= 0) { if (list.length === 1) return list; tFree(group, key); return list.filter(k => k !== key); }
    if (list.length >= T_SLOTS) { alert(`Up to ${T_SLOTS} lines can be shown at a time. Switch one off first.`); return list; }
    return list.concat(key);
  };
  switch (el.dataset.tact) {
    case 'emode': W.sel.emode = arg; return conRender();
    case 'eindex': W.sel.eindex = !!arg; return conRender();
    case 'clevel': W.sel.clevel = arg; return conRender();
    case 'emet': W.sel.emet = flip('emet', arg, W.sel.emet || []); return conRender();
    case 'cser': { const [group, key] = arg.split('\u0001'); W.sel[group] = flip(group, key, W.sel[group] || []); return conRender(); }
    case 'ost': W.sel.ostation = arg; W.sel.ounit = ''; conRender(); return top();
    case 'oun': W.sel.ounit = arg; conRender(); return top();
    case 'ocls': W.sel.ocls = arg; W.data.oshown = 30; return conRender();
    case 'omore': W.data.oshown = (W.data.oshown || 30) + 30; return conRender();
    case 'oreload': return oLoad(true);
    case 'oapply': {
      const a = $('oFrom').value, b = $('oTo').value;
      if (!a || !b || a > b) return alert('Choose a start date before the end date.');
      W.sel.pfrom = a; W.sel.pto = b; return oLoad();
    }
    case 'reload': return wOpen(W.page, true);
  }
});

// ================================================================ fetched ahead

/**
 * Soon after the app starts, the sections this employee may open are fetched together in one request
 * and kept on the phone, so opening one shows it at once. Only what is missing or old is asked for.
 */
async function wWarm() {
  if (!hasConnect() || typeof wCan !== 'function') return;
  const want = [['stations', 'stations', 'stations', 60], ['efficiency', 'efficiency', 'efficiency', 360], ['boilers', 'boilers', 'boilers', 60], ['merit', 'merit', 'merit', 60], ['capacity', 'capacity', 'stations', 360]]
    .filter(([key, , module, age]) => wCan(module, 'view') && !((conSaved(wKey(key, {})) || {age: 1e9}).age < age)).map(([key, action]) => [key, action, {}]);
  const q = wPeriod(), okey = wKey('opack', q);
  if (wCan('outages', 'view') && !((conSaved(okey) || {age: 1e9}).age < 10)) want.push([null, 'outage_pack', q]);
  if (want.length < 2 || !conBatchOk) return;                 // one section alone is fetched when it is opened
  const res = await conBatch(want.map(([, action, params]) => [action, params]));
  want.forEach(([key, action, params], i) => {
    const r = res[i];
    if (!r || !r.ok) return;
    Connect.cacheSet(key ? wKey(key, params) : okey, JSON.stringify(r.data));
    if (key && !W.data[key]) { W.data[key] = r.data; (W.stamp = W.stamp || {})[key] = Date.now(); }
  });
}
setTimeout(() => { wWarm().catch(() => {}); }, 6000);
