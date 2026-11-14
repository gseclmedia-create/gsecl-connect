// Generation pages, graphics first (4.4): an overview of charts above each page's existing content —
// Stations (loading, unit states, capacity use), Outages (by type, MW out, how long, longest), Merit order (cost now,
// generation-weighted cost, cheapest and costliest running), Hydro (dam storage gauges) and Solar (CUF per site).
// Uses S, FUEL_COLOR, TYPE_COLOR, RUN_MW, unitState, dateKey (app-main-2.js), HS (hysol.js), viz.js, $, esc, fmt.

const GP_TYPE_HEX = {Forced: '#be123c', Planned: '#d97706', RSD: '#4f46e5', Outage: '#475569', Running: '#15803d', Awaited: '#94a3b8', Standby: '#64748b', Off: '#cbd5e1'};
const gpNowKey = () => { const d = new Date(); return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()); };
const gpSet = (id, h) => { const b = $(id); if (b) b.innerHTML = h; };

/** Stations: installed against DC and generation, units by state, loading by station. */
function gpStationsOverview(g) {
  const units = g.stations.flatMap(s => s.blocks.flatMap(b => b.units)), st = {};
  units.forEach(u => { const t = unitState(u).type || 'Not in feed'; st[t] = (st[t] || 0) + 1; });
  const cap = g.stations.reduce((t, s) => t + s.blocks.reduce((u, b) => u + (b.cap || 0), 0), 0), T = g.totals;
  return `${vzKpis([{k: 'Installed', v: fmt(cap), sub: 'MW'}, {k: 'Declared (DC)', v: T.dc === null ? '—' : fmt(T.dc), sub: cap && T.dc ? fmt(T.dc / cap * 100, 0) + '% of installed' : 'MW'},
      {k: 'Generation', v: fmt(T.gen), sub: T.dc ? fmt(T.gen / T.dc * 100, 0) + '% of DC' : 'MW', tone: 'ok'}, {k: 'Schedule (SG)', v: T.sg === null ? '—' : fmt(T.sg), sub: T.deviation === null ? 'MW' : (T.deviation >= 0 ? '+' : '−') + fmt(Math.abs(T.deviation)) + ' MW gen − SG', tone: T.deviation < -20 ? 'bad' : ''}], 2)}
    <div class="card"><h2>Units by state <span class="more muted" style="font-weight:500;font-size:11.5px">${units.length} units</span></h2>
      ${vzDonut(Object.keys(st).sort((a, b) => st[b] - st[a]).map(k => ({k, n: st[k], c: GP_TYPE_HEX[k] || '#cbd5e1'})), {label: 'units', size: 104, stroke: 15})}</div>
    <div class="card"><h2>Capacity use <span class="more muted" style="font-weight:500;font-size:11.5px">MW · tap a station</span></h2>
      ${vzStack(g.stations.map((s, i) => { const c = s.blocks.reduce((t, b) => t + (b.cap || 0), 0), gen = Math.max(0, s.totals.gen || 0), dc = Math.max(gen, s.totals.dc || 0);
        return {k: s.station, label: fmt(gen) + ' / ' + fmt(c), act: `data-gst="${i}"`, parts: [gen, Math.max(0, dc - gen), Math.max(0, c - dc)]}; }),
      [{k: 'Generating', c: '#15803d'}, {k: 'Declared, not used', c: '#93c5fd'}, {k: 'Not declared', c: '#e2e8f0'}])}</div>`;
}

/** Outages: how many and how much by type, how long they have lasted, the longest ones. */
function gpOutagesOverview(o) {
  const rows = o.rows || [], types = ['Forced', 'Planned', 'RSD', 'Outage'].filter(t => rows.some(r => r.type === t));
  const mw = t => rows.filter(r => r.type === t).reduce((s, r) => s + (parseFloat(r.cap) || 0), 0), now = gpNowKey();
  const days = r => { const k = dateKey(r.since); return k ? Math.max(0, (now - k) / 864e5) : null; };
  const ages = [['under 1 day', 1], ['1–7 days', 7], ['1–4 weeks', 28], ['over 4 weeks', 1e9]];
  const longest = rows.map(r => ({r, d: days(r)})).filter(x => x.d !== null).sort((a, b) => b.d - a.d).slice(0, 8);
  return `<div class="card"><h2>Units out now <span class="more muted" style="font-weight:500;font-size:11.5px">SLDC list</span></h2>
      <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center"><div style="flex:1;min-width:170px">${vzDonut(types.map(t => ({k: t, n: rows.filter(r => r.type === t).length, c: GP_TYPE_HEX[t]})), {label: 'units', size: 100, stroke: 15, pct: false})}</div>
      <div style="flex:1;min-width:170px">${vzBars(types.map(t => ({k: t + ' MW', v: mw(t), c: GP_TYPE_HEX[t]})))}</div></div></div>
    <div class="card"><h2>How long they have been out</h2>${vzStack(types.map(t => ({k: t, parts: ages.map(([, max], i) => rows.filter(r => r.type === t && days(r) !== null && days(r) < max && days(r) >= (i ? ages[i - 1][1] : 0)).length)})),
      ages.map(([k], i) => ({k, c: ['#15803d', '#ca8a04', '#ea580c', '#be123c'][i]})))}</div>
    ${longest.length ? `<div class="card"><h2>Out the longest</h2>${vzBars(longest.map(x => ({k: x.r.unit, v: x.d, label: x.d < 2 ? fmt(x.d * 24, 0) + ' h' : fmt(x.d, 0) + ' days', c: GP_TYPE_HEX[x.r.type], note: esc([x.r.type, x.r.cap && x.r.cap + ' MW', (x.r.revised || x.r.schedule) && 'expected ' + (x.r.revised || x.r.schedule)].filter(Boolean).join(' · '))})))}</div>` : ''}`;
}

/** Merit order: the cost of what GSECL generates now, and where the cheap and the costly stations stand. */
function gpMeritOverview(g) {
  const rows = [];
  g.stations.forEach(s => s.blocks.forEach(b => { const m = (b.merit || [])[0]; if (m) rows.push({label: b.label, fuel: s.fuel, cost: m.cost, rank: m.rank, gen: Math.max(0, b.gen || 0), dc: b.dc || 0}); }));
  if (!rows.length) return '';
  const run = rows.filter(r => r.gen > RUN_MW), genT = run.reduce((t, r) => t + r.gen, 0), wavg = genT ? run.reduce((t, r) => t + r.gen * r.cost, 0) / genT : null;
  const sorted = rows.slice().sort((a, b) => a.cost - b.cost), cheapIdle = sorted.filter(r => r.fuel !== 'Hydro' && r.dc - r.gen > 20).slice(0, 1)[0];   // hydro is limited by water, not backed down
  return vzKpis([{k: 'Cost now', v: wavg === null ? '—' : '₹' + fmt(wavg, 2), sub: 'per kWh, weighted by generation'},
      {k: 'Cheapest', v: '₹' + fmt(sorted[0].cost, 2), sub: sorted[0].label, tone: 'ok'}, {k: 'Costliest', v: '₹' + fmt(sorted[sorted.length - 1].cost, 2), sub: sorted[sorted.length - 1].label, tone: 'warn'},
      {k: 'Cheap, backed down', v: cheapIdle ? fmt(cheapIdle.dc - cheapIdle.gen) + ' MW' : '—', sub: cheapIdle ? cheapIdle.label + ' at ₹' + fmt(cheapIdle.cost, 2) : 'none', tone: cheapIdle ? 'warn' : 'ok'}], 2)
    + `<div class="card"><h2>Variable cost ladder <span class="more muted" style="font-weight:500;font-size:11.5px">₹/kWh · bar colour = running or not</span></h2>
      ${vzBars(sorted.map(r => ({k: r.label, v: r.cost, label: '₹' + fmt(r.cost, 2) + ' · #' + r.rank, c: r.gen > RUN_MW ? '#15803d' : '#cbd5e1', note: r.gen > RUN_MW ? fmt(r.gen) + ' of ' + fmt(r.dc) + ' MW' : 'not generating'})))}</div>`;
}

/** Hydro: storage of each dam as a gauge. */
function gpHydroOverview(d) {
  const latest = key => d.levels.filter(l => l.dam === key).sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  const dams = d.dams.map(m => ({m, x: latest(m.key)})).filter(o => o.x);
  if (!dams.length) return '';
  return `<div class="card"><h2>Dam storage</h2><div class="vz-rings">${dams.map(({m, x}) => vzRing(x.pct !== undefined ? x.pct : x.frl ? x.level / x.frl * 100 : 0,
      {text: x.pct !== undefined ? fmt(x.pct, 0) + '%' : fmt(x.level, 1), label: m.name, sub: x.frl ? fmt(x.frl - x.level, 2) + ' ' + (m.unit || '') + ' below FRL' : '', color: '#0891b2', size: 84})).join('')}</div></div>`;
}

/** Solar: yesterday's CUF of each site. */
function gpSolarOverview(d) {
  const yday = typeof hsIso === 'function' ? hsIso(-1) : '', sites = (d.sites || []).filter(s => s.active);
  const mu = s => { const x = d.entries.find(e => e.date === yday && e.site === s.key); return x ? x.mu : null; };
  const rows = sites.map(s => ({s, mu: mu(s)})).filter(x => x.mu !== null && x.s.capacity_mw);
  if (!rows.length) return '';
  const cap = rows.reduce((t, x) => t + x.s.capacity_mw, 0), tot = rows.reduce((t, x) => t + x.mu, 0), cuf = tot * 1000 / (cap * 24) * 100;
  return `<div class="card"><h2>Solar yesterday <span class="more muted" style="font-weight:500;font-size:11.5px">capacity utilisation (CUF)</span></h2>
      <div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap">${vzRing(Math.min(100, cuf / 30 * 100), {text: fmt(cuf, 1) + '%', label: 'GSECL solar CUF', sub: fmt(tot, 2) + ' MU', color: '#f59e0b', size: 100})}
      <div style="flex:1;min-width:180px">${vzBars(rows.map(x => ({k: x.s.name || x.s.key, v: x.mu * 1000 / (x.s.capacity_mw * 24) * 100, label: fmt(x.mu * 1000 / (x.s.capacity_mw * 24) * 100, 1) + '%', c: '#f59e0b', note: fmt(x.mu, 3) + ' MU · ' + fmt(x.s.capacity_mw, 2) + ' MW'})).sort((a, b) => b.v - a.v), {max: 30})}</div></div>
      <div class="note-src">Gauge full at 30 % CUF.</div></div>`;
}

// ---- hooks: each page draws its overview after its own content
const gpWrap = (name, after) => {
  if (typeof globalThis[name] !== 'function') return;
  const f0 = globalThis[name];
  globalThis[name] = function () { const r = f0.apply(this, arguments); try { after(); } catch (e) { /* the page itself is drawn */ } return r; };
};
gpWrap('renderStations', () => { const g = S.gsecl; gpSet('stOverview', g && g.ok && typeof vzKpis === 'function' ? gpStationsOverview(g) : ''); });
gpWrap('renderOutages', () => { const o = S.outages; gpSet('outOverview', o && o.ok && typeof vzDonut === 'function' ? gpOutagesOverview(o) : ''); });
gpWrap('renderMerit', () => { const g = S.gsecl; gpSet('meritOverview', g && g.ok && typeof vzBars === 'function' ? gpMeritOverview(g) : ''); });
gpWrap('hyRender', () => { const box = $('hyBody'); if (box && HS.hy && typeof vzRing === 'function' && !box.querySelector('.gp-ov')) box.insertAdjacentHTML('afterbegin', '<div class="gp-ov">' + gpHydroOverview(HS.hy) + '</div>'); });
gpWrap('soRender', () => { const box = $('soBody'); if (box && HS.so && !HS.so.outside && typeof vzRing === 'function' && !box.querySelector('.gp-ov')) box.insertAdjacentHTML('afterbegin', '<div class="gp-ov">' + gpSolarOverview(HS.so) + '</div>'); });
