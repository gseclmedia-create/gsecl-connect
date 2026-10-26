// Coal views: GSECL coal rakes on the railway (inside a station or in transit), outstanding
// indents, expected arrivals, receipts/releases and route positions. The app's :rake module reads
// the railway reports and keeps them on the phone (window.Rake); this file only draws them.
// Uses $, esc, fmt, show() from index.html.

const K = {
  tab: 'stock', detail: null,               // detail: {type: 'rake', id} | {type: 'route', from, to}
  data: null, busy: false, error: '',
  f: {station: '', washery: '', ld: '', ed: '', status: '', sort: 'eta', desc: false},
  routes: {},                              // "FROM|TO" -> [stations] | null (not available) | 'wait'
  range: 7, events: null, actStation: '',
  pick: {from: '', to: ''},
};
const hasRake = () => typeof window.Rake !== 'undefined';
const K_TABS = [['sum', 'Summary'], ['rakes', 'Rakes'], ['fc', 'Forecast'], ['ind', 'Indents'], ['map', 'Map'], ['act', 'Activity'], ['route', 'Routes']];
const K_MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const K_STATION_COLOR = {UKAI: 'var(--coal)', WTPS: 'var(--hydro)', GTPS: 'var(--gas)', SIKKA: 'var(--rsd)'};
const K_CAT_COLOR = {Washed: 'var(--run)', Unwashed: 'var(--coal)', Imported: 'var(--hydro)', Oil: 'var(--rsd)'};

// ---------------------------------------------------------------- engine calls

const kPending = {};
let kSeq = 0;
window.__rakeDone = (id, ok, body, error) => { const p = kPending[id]; delete kPending[id]; if (p) p({ok, body, error}); };
const kAsk = fn => new Promise(resolve => { const id = 'k' + (++kSeq); kPending[id] = resolve; fn(id); });

function kLoadCached() { try { K.data = JSON.parse(Rake.cached()); } catch (e) { K.data = {last_sync: '', rakes: [], indents: []}; } }

async function kRefresh() {
  if (K.busy) return;
  K.busy = true; K.error = ''; kRender();
  const r = await kAsk(id => Rake.refresh(id));
  K.busy = false;
  if (r.ok) {
    try { K.data = JSON.parse(r.body); K.relayAt = 0; if (window.liveMine) window.liveMine('fois', K.data); } catch (e) { K.error = 'Unexpected answer'; }
    K.events = null;
  } else { K.error = r.error; if (window.liveWant) window.liveWant('fois'); }      // another phone's FOIS reading, if shared
  kRender();
}

/** FOIS rakes read by another phone and shared through GSECL Connect (used when this phone cannot read FOIS). */
window.kLiveFois = copy => {
  const own = K.data && K.data.last_sync ? Date.parse(K.data.last_sync) || 0 : 0;
  if (!copy || !copy.obj || (!K.error && own >= copy.at - 60e3)) return;
  K.data = copy.obj; K.relayAt = copy.at; K.error = ''; K.events = null;
  kRender();
};

/** Route stations for a source/destination pair; fetched once, then remembered. */
async function kRoute(from, to) {
  const key = from + '|' + to;
  if (K.routes[key] !== undefined) return K.routes[key] === 'wait' ? null : K.routes[key];
  K.routes[key] = 'wait';
  const r = await kAsk(id => Rake.route(id, from, to));
  let list = null;
  if (r.ok) { try { list = JSON.parse(r.body); } catch (e) { list = null; } }
  K.routes[key] = list && list.length ? list : null;
  return K.routes[key];
}
const kRouteOf = r => { const v = K.routes[(r.station_from || '') + '|' + r.station_to]; return Array.isArray(v) ? v : null; };

/** Where a rake is on its route, anchored on the station the railway last confirmed it at; null if unknown. */
function kProgress(r) {
  const st = kRouteOf(r);
  if (!st) return null;
  const code = (/[a-zA-Z]+/.exec(r.current_location || '') || [''])[0].toUpperCase();
  const at = code && st.find(s => s.code.toUpperCase() === code);
  if (!at) return null;
  const total = Math.max(...st.map(s => s.km));
  return {station: at, total, remaining: Math.max(0, total - at.km), frac: total ? Math.min(1, at.km / total) : 0};
}

// ---------------------------------------------------------------- helpers

const kRakes = () => K.data?.rakes || [];
const kInside = r => r.status === 'Inside';
const kStations = () => [...new Set(kRakes().map(r => r.station_to).concat((K.data?.indents || []).map(i => i.station_to)))].filter(Boolean).sort();
/** "03-08-2026 14:20" or "2026-08-03 ..." -> "2026-08-03" */
function kIso(s) {
  let m = /(\d{2})[-/](\d{2})[-/](\d{4})/.exec(String(s || ''));
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  m = /(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
  return m ? m[0] : '';
}
const kDay = iso => iso ? `${iso.slice(8, 10)} ${K_MON[+iso.slice(5, 7) - 1]}` : '—';
const kToday = (offset = 0) => { const d = new Date(); d.setDate(d.getDate() + offset); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const kBtn = (label, act, arg = '', primary = false) => `<button class="btn" data-kact="${act}" data-karg="${esc(arg)}" style="${primary ? 'background:var(--accent);color:#fff;border-color:var(--accent)' : 'color:var(--accent)'}">${esc(label)}</button>`;
const kBack = label => `<div class="chips"><button class="chip" data-kact="back">‹ ${esc(label)}</button></div>`;
const kEmpty = t => `<div class="empty">${esc(t)}</div>`;
const kMore = t => `<span class="more muted" style="font-weight:500;font-size:11.5px">${esc(t)}</span>`;
const kSel = (name, cur, all, values, labels = values) => `<select class="search" data-ksel="${name}" style="margin:0"><option value="">${esc(all)}</option>${values.map((v, i) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(labels[i])}</option>`).join('')}</select>`;
const kStatus = r => `<span class="badge ${kInside(r) ? 'b-Running' : 'b-RSD'}">${kInside(r) ? 'Inside' : 'In transit'}</span>`;

// ---------------------------------------------------------------- tabs

function kTabSum() {
  const rakes = kRakes(), inside = rakes.filter(kInside).length;
  let h = `<div class="card"><h2>Rake inventory ${kMore(K.data.last_sync ? 'synced ' + K.data.last_sync : 'not synced yet')}</h2>
    <div class="tstats" style="grid-template-columns:repeat(3,1fr)">
      <div data-kact="status" data-karg=""><span>Total active</span><b class="num">${rakes.length}</b></div>
      <div data-kact="status" data-karg="Inside"><span>Inside station</span><b class="num">${inside}</b></div>
      <div data-kact="status" data-karg="In Pipeline"><span>In transit</span><b class="num">${rakes.length - inside}</b></div>
    </div>
    ${kBtn(K.busy ? 'Reading railway reports…' : 'Refresh now', 'refresh', '', true)}
    <div class="tg" style="border-top:0;padding-bottom:0"><div><b>Auto-refresh every 2 minutes</b><span>In the background, with a notification when rakes are added or leave.</span></div><button class="sw-t ${Rake.autoRefresh() ? 'on' : ''}" data-kact="auto" aria-label="Auto-refresh"></button></div></div>`;
  if (!rakes.length) return h + `<div class="card">${kEmpty(K.busy ? 'Reading the railway reports for the first time…' : 'No rakes saved yet. Tap “Refresh now”.')}</div>`;

  const st = kStations(), max = Math.max(1, ...st.map(s => rakes.filter(r => r.station_to === s).length));
  h += `<div class="card"><h2>Rakes by station ${kMore('tap to list')}</h2>${st.map(s => {
    const all = rakes.filter(r => r.station_to === s), ins = all.filter(kInside).length;
    return `<div class="srow" data-kact="station" data-karg="${esc(s)}"><div class="top"><span class="nm">${esc(s)}</span><span class="vals num"><b>${all.length}</b> rakes · ${ins} inside · ${all.length - ins} in transit</span></div>
      <div class="stack" style="height:10px;margin-top:6px;width:${all.length / max * 100}%"><i style="width:${all.length ? ins / all.length * 100 : 0}%;background:var(--run)"></i><i style="width:${all.length ? (all.length - ins) / all.length * 100 : 0}%;background:var(--rsd)"></i></div></div>`;
  }).join('')}
    <div class="keyline"><span><i style="width:14px;height:8px;border-radius:4px;background:var(--run)"></i>Inside</span><span><i style="width:14px;height:8px;border-radius:4px;background:var(--rsd)"></i>In transit</span></div></div>`;

  const wash = [...new Set(rakes.map(r => r.mapped_consignor))].sort();
  h += `<div class="card"><h2>By washery / consignor</h2><table class="dt num"><tr><th>Washery</th><th>Total</th><th>Inside</th><th>Transit</th></tr>${wash.map(w => {
    const all = rakes.filter(r => r.mapped_consignor === w), ins = all.filter(kInside).length;
    return `<tr data-kact="washery" data-karg="${esc(w)}"><td>${esc(w)} <span class="src-tag">${esc(all[0].consignor_category || '')}</span></td><td>${all.length}</td><td>${ins}</td><td>${all.length - ins}</td></tr>`;
  }).join('')}<tr class="hl"><td>Total</td><td>${rakes.length}</td><td>${inside}</td><td>${rakes.length - inside}</td></tr></table></div>`;

  const today = kEvents(kToday(), kToday());
  h += `<div class="card"><h2>Today's activity <span class="more" data-kact="tab" data-karg="act">History ›</span></h2>
    <table class="dt num"><tr><th>Station</th><th>Received</th><th>Released</th></tr>${st.map(s => `<tr><td>${esc(s)}</td><td>${today.filter(e => e.station === s && e.type === 'RECEIVED').length}</td><td>${today.filter(e => e.station === s && e.type === 'RELEASED').length}</td></tr>`).join('')}</table>
    <div class="note-src">Receipts and releases are worked out on this phone by comparing one sync with the next, so they are complete only while the app keeps syncing.</div></div>`;
  h += `<div class="card"><h2>Saved data</h2><p class="muted" style="font-size:12.5px;margin:0">Rakes and indents from the last sync are kept on this phone and shown when there is no network.</p>${kBtn('Clear saved rakes and sync again', 'wipe')}</div>`;
  return h;
}

function kFiltered() {
  const f = K.f;
  const list = kRakes().filter(r => (!f.station || r.station_to === f.station) && (!f.washery || r.mapped_consignor === f.washery)
    && (!f.status || r.status === f.status) && (!f.ld || r.loading_date === f.ld) && (!f.ed || kIso(r.expected_arrival) === f.ed));
  const key = {eta: r => kIso(r.expected_arrival) + (r.expected_arrival || ''), load: r => r.loading_date + (r.loading_time || ''), km: r => r.rmng_km ?? 1e9, name: r => r.rake_name}[f.sort];
  list.sort((a, b) => { const x = key(a), y = key(b); return (x < y ? -1 : x > y ? 1 : 0) * (f.desc ? -1 : 1); });
  return list;
}

const kRakeCard = r => `<div class="oq" style="--oc:${kInside(r) ? 'var(--run)' : 'var(--rsd)'}" data-kact="rake" data-karg="${r.id}">
  <div class="oq-h"><span class="nm">${esc(r.rake_name || r.load_name || 'Rake')}</span>${kStatus(r)}<span class="cap num">${esc(r.station_to)}</span></div>
  <div class="meta num"><div><span>Consignor</span>${esc(r.mapped_consignor)} <span class="src-tag">${esc(r.consignor_category || '')}</span></div><div><span>From</span>${esc(r.station_from || '—')}</div>
    <div><span>Loaded</span>${kDay(r.loading_date)}</div><div><span>Expected arrival</span>${esc(r.expected_arrival || '—')}</div>
    <div><span>Now at</span>${esc(r.current_location || '—')}</div><div><span>Remaining</span>${kInside(r) ? 'Arrived' : r.rmng_km !== null && r.rmng_km !== undefined ? fmt(r.rmng_km) + ' km' : '—'}</div></div>
  ${r.status_code || r.status_time ? `<div class="live">${esc([r.status_code, r.status_time].filter(Boolean).join(' · '))}</div>` : ''}</div>`;

function kTabRakes() {
  const rakes = kRakes(), f = K.f;
  if (!rakes.length) return `<div class="card">${kEmpty('No rakes saved yet. Open Summary and tap “Refresh now”.')}</div>`;
  const uniq = fn => [...new Set(rakes.map(fn).filter(Boolean))].sort();
  const lds = uniq(r => r.loading_date), eds = uniq(r => kIso(r.expected_arrival)), list = kFiltered();
  return `<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">
      ${kSel('station', f.station, 'All stations', kStations())}${kSel('washery', f.washery, 'All washeries', uniq(r => r.mapped_consignor))}
      ${kSel('ld', f.ld, 'Any loading date', lds, lds.map(kDay))}${kSel('ed', f.ed, 'Any expected date', eds, eds.map(kDay))}
      ${kSel('status', f.status, 'Inside and in transit', ['Inside', 'In Pipeline'], ['Inside station', 'In transit'])}
      ${kSel('sort', f.sort, 'Sort', ['eta', 'load', 'km', 'name'], ['By expected arrival', 'By loading date', 'By remaining km', 'By rake name']).replace('<option value="">Sort</option>', '')}</div>
    <div class="card"><h2>${list.length} of ${rakes.length} rakes <span class="more" data-kact="clear">Clear filters</span></h2><div class="note-src" style="margin:0">Tap a rake for full details and its route.</div></div>
    ${list.map(kRakeCard).join('') || `<div class="card">${kEmpty('No rake matches these filters.')}</div>`}`;
}

function kTabForecast() {
  const rakes = kRakes(), st = kStations();
  if (!rakes.length) return `<div class="card">${kEmpty('No rakes saved yet.')}</div>`;
  const days = [0, 1, 2, 3, 4, 5].map(kToday);
  const cell = (s, d) => rakes.filter(r => r.station_to === s && !kInside(r) && kIso(r.expected_arrival) === d).length;
  const later = s => rakes.filter(r => r.station_to === s && !kInside(r) && !days.includes(kIso(r.expected_arrival))).length;
  return `<div class="card"><h2>Expected arrivals · next 6 days ${kMore('tap a number to list')}</h2><div style="overflow-x:auto"><table class="dt num">
    <tr><th>Station</th><th>Inside</th>${days.map((d, i) => `<th>${kDay(d)}<br>D+${i}</th>`).join('')}<th>Other</th></tr>
    ${st.map(s => `<tr><td><b>${esc(s)}</b></td><td data-kact="fcin" data-karg="${esc(s)}">${rakes.filter(r => r.station_to === s && kInside(r)).length}</td>
      ${days.map(d => { const n = cell(s, d); return `<td ${n ? `data-kact="fc" data-karg="${esc(s)}|${d}" style="font-weight:700;color:var(--accent)"` : 'class="na"'}>${n || '·'}</td>`; }).join('')}<td>${later(s) || '·'}</td></tr>`).join('')}
    <tr class="hl"><td>Total</td><td>${rakes.filter(kInside).length}</td>${days.map(d => `<td>${st.reduce((t, s) => t + cell(s, d), 0)}</td>`).join('')}<td>${st.reduce((t, s) => t + later(s), 0)}</td></tr></table></div>
    <div class="note-src">By the railway's expected arrival time for rakes still in transit. “Other” is rakes expected later, already overdue, or with no expected time.</div></div>`;
}

function kTabIndents() {
  const ind = K.data?.indents || [];
  if (!ind.length) return `<div class="card">${kEmpty('No outstanding indents in the last sync.')}</div>`;
  const st = [...new Set(ind.map(i => i.station_to))].sort(), sum = (l, k) => l.reduce((t, i) => t + (i[k] || 0), 0);
  const shown = ind.filter(i => !K.f.station || i.station_to === K.f.station);
  return `<div class="card"><h2>Outstanding indents ${kMore('rake demand not yet supplied')}</h2><table class="dt num"><tr><th>Station</th><th>Demands</th><th>Outstanding</th><th>Supplied</th></tr>
      ${st.map(s => { const l = ind.filter(i => i.station_to === s); return `<tr data-kact="indst" data-karg="${esc(s)}"><td>${esc(s)}</td><td>${l.length}</td><td>${sum(l, 'outstanding_units')}</td><td>${sum(l, 'supplied_units')}</td></tr>`; }).join('')}
      <tr class="hl"><td>Total</td><td>${ind.length}</td><td>${sum(ind, 'outstanding_units')}</td><td>${sum(ind, 'supplied_units')}</td></tr></table>
      ${K.f.station ? `<div class="note-src">Showing ${esc(K.f.station)} only. <a data-kact="indst" data-karg="">Show all</a></div>` : ''}</div>`
    + shown.map(i => `<div class="oq" style="--oc:var(--planned)"><div class="oq-h"><span class="nm">${esc(i.station_from)} → ${esc(i.station_to)}</span><span class="cap num">${i.outstanding_units ?? '—'}<small> outstanding</small></span></div>
      <div class="meta num"><div><span>Demand</span>${esc(i.demand_id)} · ${esc(i.demand_date || '')}</div><div><span>Expected loading</span>${esc(i.expected_loading_date || '—')}</div>
        <div><span>Consignor</span>${esc(i.raw_consignor || '—')}</div><div><span>Wagons</span>${esc(i.indent_type || '—')} · indented ${i.indented_units ?? '—'} · supplied ${i.supplied_units ?? 0}</div></div>
      ${i.commodity ? `<div class="live">${esc(i.commodity)}</div>` : ''}</div>`).join('');
}

function kEvents(from, to) {
  try { return JSON.parse(Rake.events(from || '', to || '')); } catch (e) { return []; }
}

function kTabActivity() {
  const from = K.range ? kToday(1 - K.range) : '', to = kToday();
  const ev = kEvents(from, to), st = kStations();
  const loaded = kRakes().filter(r => r.loading_date && (!from || r.loading_date >= from) && r.loading_date <= to);
  const n = (s, t) => ev.filter(e => e.station === s && e.type === t).length;
  const shown = ev.filter(e => !K.actStation || e.station === K.actStation).sort((a, b) => b.at - a.at);
  return `<div class="chips">${[[1, 'Today'], [7, '7 days'], [30, '30 days'], [0, 'All']].map(([d, l]) => `<button class="chip ${K.range === d ? 'on' : ''}" data-kact="range" data-karg="${d}">${l}</button>`).join('')}</div>
    <div class="card"><h2>By station ${kMore(from ? `${kDay(from)} – ${kDay(to)}` : 'all saved history')}</h2><table class="dt num"><tr><th>Station</th><th>Loaded</th><th>Received</th><th>Released</th><th>Balance</th></tr>
      ${st.map(s => `<tr data-kact="actst" data-karg="${esc(s)}"><td>${esc(s)}</td><td>${loaded.filter(r => r.station_to === s).length}</td><td>${n(s, 'RECEIVED')}</td><td>${n(s, 'RELEASED')}</td><td>${n(s, 'RECEIVED') - n(s, 'RELEASED')}</td></tr>`).join('')}</table>
      <div class="note-src">Loaded = rakes in the current list loaded in this period. Received / released are detected on this phone between syncs.${K.actStation ? ` Showing ${esc(K.actStation)} below. <a data-kact="actst" data-karg="">Show all</a>` : ''}</div></div>
    <div class="card"><h2>Receipts and releases</h2>${shown.length ? shown.slice(0, 150).map(e => `<div class="nrow"><span class="sd" style="background:${e.type === 'RECEIVED' ? 'var(--run)' : 'var(--planned)'}"></span>
      <div class="nb"><b>${esc(e.rake || e.load)} ${e.type === 'RECEIVED' ? 'received at' : 'released from'} ${esc(e.station)}</b><div class="nt">${esc([e.consignor, e.from && 'from ' + e.from].filter(Boolean).join(' · '))}</div></div>
      <span class="tm2">${kDay(e.date)}</span></div>`).join('') : kEmpty('No receipt or release recorded in this period.')}</div>`;
}

function kTabRoute() {
  const transit = kRakes().filter(r => !kInside(r));
  if (!kRakes().length) return `<div class="card">${kEmpty('No rakes saved yet.')}</div>`;
  const pairs = [...new Set(transit.filter(r => r.station_from).map(r => r.station_from + '|' + r.station_to))];
  const waiting = pairs.filter(p => K.routes[p] === undefined || K.routes[p] === 'wait').length;
  const st = kStations();
  let h = `<div class="card"><h2>Fleet line-up ${kMore('tap a dot for the rake')}</h2>${st.map(s => {
    const on = transit.filter(r => r.station_to === s), placed = on.map(r => [r, kProgress(r)]).filter(x => x[1]);
    return `<div style="margin-bottom:14px"><div class="blk-h">${esc(s)}<span>${on.length} in transit${on.length - placed.length ? ` · ${on.length - placed.length} without a confirmed position` : ''}</span></div>
      <div style="position:relative;height:34px;margin:6px 8px 0"><div style="position:absolute;left:0;right:0;top:16px;height:3px;border-radius:2px;background:var(--line)"></div>
        ${placed.map(([r, p], i) => `<span data-kact="rake" data-karg="${r.id}" title="${esc(r.rake_name)}" style="position:absolute;left:calc(${(p.frac * 100).toFixed(1)}% - 8px);top:${4 + (r.id % 3) * 8}px;width:16px;height:16px;border-radius:50%;border:2px solid var(--card);background:${K_CAT_COLOR[r.consignor_category] || 'var(--accent)'}"></span>`).join('')}</div>
      <div class="keyline" style="justify-content:space-between;margin-top:2px"><span>Source</span><span>${esc(s)}</span></div></div>`;
  }).join('')}
    <div class="keyline">${Object.entries(K_CAT_COLOR).map(([k, c]) => `<span><i style="width:10px;height:10px;border-radius:50%;background:${c}"></i>${k}</span>`).join('')}</div>
    ${waiting ? `<div class="note-src">Working out positions for ${waiting} route${waiting > 1 ? 's' : ''}…</div>` : ''}</div>`;
  const sources = [...new Set(kRakes().map(r => r.station_from).filter(Boolean))].sort();
  h += `<div class="card"><h2>Route tracker</h2><p class="muted" style="font-size:12.5px;margin:0 0 8px">Pick a loading siding and a plant to see the rail route between them and the rakes on it.</p>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">${kSel('pfrom', K.pick.from, 'Source siding', sources)}${kSel('pto', K.pick.to, 'Destination plant', st)}</div>
    ${kBtn('Show route', 'pickroute', '', true)}</div>`;
  return h;
}

// ---------------------------------------------------------------- detail pages

/** Route drawn from the stations' real coordinates (no map tiles), with rakes marked on it. */
function kRouteSvg(stations, marks) {
  const pts = stations.filter(s => s.lat !== null && s.lng !== null);
  if (pts.length < 2) return '';
  const W = 320, H = 200, pad = 16;
  const lats = pts.map(p => p.lat), lngs = pts.map(p => p.lng);
  const x0 = Math.min(...lngs), x1 = Math.max(...lngs), y0 = Math.min(...lats), y1 = Math.max(...lats);
  const sc = Math.min((W - 2 * pad) / ((x1 - x0) || 1), (H - 2 * pad) / ((y1 - y0) || 1));
  const X = p => pad + (p.lng - x0) * sc + ((W - 2 * pad) - (x1 - x0) * sc) / 2, Y = p => H - pad - (p.lat - y0) * sc - ((H - 2 * pad) - (y1 - y0) * sc) / 2;
  const first = pts[0], last = pts[pts.length - 1];
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Route">
    <polyline points="${pts.map(p => X(p).toFixed(1) + ',' + Y(p).toFixed(1)).join(' ')}" fill="none" style="stroke:var(--accent)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${X(first)}" cy="${Y(first)}" r="5" style="fill:var(--card);stroke:var(--accent)" stroke-width="2.5"/><text class="ax" x="${X(first)}" y="${Y(first) - 9}" text-anchor="middle">${esc(first.code)}</text>
    <circle cx="${X(last)}" cy="${Y(last)}" r="5" style="fill:var(--accent)"/><text class="ax" x="${X(last)}" y="${Y(last) - 9}" text-anchor="middle">${esc(last.code)}</text>
    ${marks.filter(m => m.lat !== null && m.lng !== null).map(m => `<circle cx="${X(m)}" cy="${Y(m)}" r="6" style="fill:var(--forced);stroke:var(--card)" stroke-width="2"/>`).join('')}
  </svg></div><div class="keyline"><span><i style="width:10px;height:10px;border-radius:50%;background:var(--forced)"></i>Rake position (last confirmed station)</span></div>`;
}

function kStationTable(stations, atCode) {
  return `<div style="max-height:320px;overflow:auto"><table class="dt num"><tr><th>Station</th><th>Code</th><th>km</th></tr>${stations.map(s => `<tr class="${s.code === atCode ? 'hl' : ''}"><td>${esc(s.name || s.code)}${s.code === atCode ? ' <span class="badge b-Forced">Rake here</span>' : ''}</td><td>${esc(s.code)}</td><td>${fmt(s.km)}</td></tr>`).join('')}</table></div>`;
}

function kDetailRake(id) {
  const r = kRakes().find(x => String(x.id) === String(id));
  if (!r) return kBack('Rakes') + `<div class="card">${kEmpty('This rake is no longer in the list.')}</div>`;
  const route = kRouteOf(r), p = kProgress(r), key = (r.station_from || '') + '|' + r.station_to;
  const row = (l, v) => v === null || v === undefined || v === '' ? '' : `<div><span>${esc(l)}</span>${esc(v)}</div>`;
  let h = kBack('Rakes') + `<div class="card"><div style="display:flex;align-items:center;gap:8px"><div style="font-size:18px;font-weight:700;flex:1">${esc(r.rake_name || r.load_name)}</div>${kStatus(r)}</div>
    <div class="muted" style="font-size:12.5px">${esc(r.station_from || '—')} → ${esc(r.station_to)} · ${esc(r.mapped_consignor)} (${esc(r.consignor_category || '')})</div>
    ${p ? `<div class="bar" style="margin-top:12px"><div class="f" style="width:${(p.frac * 100).toFixed(1)}%;background:var(--accent)"></div></div>
      <div class="keyline" style="justify-content:space-between"><span>${fmt(p.total - p.remaining)} km done</span><span><b>${fmt(p.remaining)} km</b> to go of ${fmt(p.total)}</span></div>` : ''}
    <div class="oq" style="box-shadow:none;padding:0;margin:12px 0 0;border:0"><div class="meta num">
      ${row('Now at', p ? `${p.station.name || p.station.code} (${p.station.code})` : r.current_location)}${row('Remaining (railway figure)', kInside(r) ? 'Arrived' : r.rmng_km !== null ? fmt(r.rmng_km) + ' km' : '')}
      ${row('Expected arrival', r.expected_arrival)}${row('Status', [r.status_code, r.status_time].filter(Boolean).join(' · '))}
      ${row('Loaded', [kDay(r.loading_date), r.loading_time].filter(Boolean).join(' · '))}${row('Load name', r.load_name)}
      ${row('Consignor (as reported)', r.raw_consignor)}${row('Consignee', r.consignee)}${row('Commodity', r.commodity)}${row('Wagons', [r.load_type, r.total_units && r.total_units + ' units', r.loaded_empty].filter(Boolean).join(' · '))}
      ${row('Loco', [r.loco_number, r.loco_type].filter(Boolean).join(' · '))}${row('Zone / division', [r.zone, r.division].filter(Boolean).join(' / '))}
      ${row('From division', r.division_from)}${row('Transit time', r.transit_time)}${row('Placement reason', r.placement_reason)}${row('CC rake', r.cc_rake)}
    </div></div></div>`;
  if (!r.station_from) return h;
  if (K.routes[key] === undefined || K.routes[key] === 'wait') h += `<div class="card"><h2>Route</h2><div class="sk" style="height:120px"></div></div>`;
  else if (!route) h += `<div class="card"><h2>Route</h2>${kEmpty('Route details are not available for this rake right now.')}</div>`;
  else h += `<div class="card"><h2>Route · ${route.length} stations · ${fmt(Math.max(...route.map(s => s.km)))} km</h2>${kRouteSvg(route, p ? [p.station] : [])}${kStationTable(route, p?.station.code)}
    ${p ? '' : '<div class="note-src">The railway has not yet reported this rake at a station on this route, so its position is not marked.</div>'}</div>`;
  return h;
}

function kDetailRoute(from, to) {
  const key = from + '|' + to, route = Array.isArray(K.routes[key]) ? K.routes[key] : null;
  let h = kBack('Routes');
  if (K.routes[key] === undefined || K.routes[key] === 'wait') return h + `<div class="card"><h2>${esc(from)} → ${esc(to)}</h2><div class="sk" style="height:160px"></div></div>`;
  if (!route) return h + `<div class="card"><h2>${esc(from)} → ${esc(to)}</h2>${kEmpty('No rail route could be found between these two.')}</div>`;
  const on = kRakes().filter(r => !kInside(r) && r.station_from === from && r.station_to === to), marks = on.map(kProgress).filter(Boolean);
  h += `<div class="card"><h2>${esc(from)} → ${esc(to)} · ${route.length} stations · ${fmt(Math.max(...route.map(s => s.km)))} km</h2>${kRouteSvg(route, marks.map(m => m.station))}</div>
    <div class="card"><h2>Rakes on this route (${on.length})</h2></div>${on.map(kRakeCard).join('') || `<div class="card">${kEmpty('No rake is in transit on exactly this route right now.')}</div>`}
    <div class="card"><h2>Stations</h2>${kStationTable(route, '')}</div>`;
  return h;
}

// ---------------------------------------------------------------- render & interaction

function kRender() {
  const box = $('coalBody');
  if (!box || !$('v-coal').classList.contains('on')) return;
  if (!hasRake()) { box.innerHTML = `<div class="card">${kEmpty('Coal rake tracking is available in the Android app.')}</div>`; return; }
  if (!K.data) kLoadCached();
  let h = (K.busy ? '<div class="alert"><span>⟳</span><span>Reading the railway rake reports… this can take up to a minute.</span></div>' : '')
    + (K.error ? `<div class="alert err"><span>⚠</span><span>${esc(K.error)}</span></div>` : '')
    + (K.relayAt ? `<div class="alert"><span>ℹ</span><span>FOIS could not be read on this phone; showing the rake position another phone shared through GSECL Connect at ${new Date(K.relayAt).toTimeString().slice(0, 5)}.</span></div>` : '');
  if (K.detail) h += K.detail.type === 'rake' ? kDetailRake(K.detail.id) : kDetailRoute(K.detail.from, K.detail.to);
  else {
    // Stock and Entry (coalstock.js) and the railway tabs are offered according to the employee's access.
    const tabs = kTabs();
    if (!tabs.length) { box.innerHTML = `<div class="card">${kEmpty('You have not been given access to the coal pages.')}</div>`; return; }
    if (!tabs.some(t => t[0] === K.tab)) K.tab = tabs[0][0];
    h += `<div class="chips">${tabs.map(([k, l]) => `<button class="chip ${K.tab === k ? 'on' : ''}" data-kact="tab" data-karg="${k}">${l}</button>`).join('')}</div>`
      + {stock: sTabStock, entry: sTabEntry, sum: kTabSum, rakes: kTabRakes, fc: kTabForecast, ind: kTabIndents, act: kTabActivity, route: kTabRoute, map: kTabMap}[K.tab]();
  }
  box.innerHTML = h + '<div class="credit">Developed by <b>A D Bhatt</b>, EE, GSECL</div>';
  spAfterRender();
  kmAfterRender();
}

function kGo(detail) { K.detail = detail; kRender(); window.scrollTo({top: 0}); }
function kOpenTab(tab) {
  K.tab = tab; K.detail = null; kRender(); window.scrollTo({top: 0});
  if (tab === 'route') kWarmRoutes();
}
function kList(filter) { K.f = {...K.f, station: '', washery: '', ld: '', ed: '', status: '', ...filter}; kOpenTab('rakes'); }

/** Looks up the route of every in-transit rake (one request per distinct source/destination), redrawing as they arrive. */
async function kWarmRoutes() {
  const pairs = [...new Set(kRakes().filter(r => !kInside(r) && r.station_from).map(r => r.station_from + '|' + r.station_to))].filter(p => K.routes[p] === undefined);
  for (const p of pairs) {
    const [from, to] = p.split('|');
    await kRoute(from, to);
    if (K.tab === 'route' && !K.detail) kRender();
  }
}

document.addEventListener('click', async e => {
  const el = e.target.closest('[data-kact]');
  if (!el || !hasRake()) return;
  const arg = el.dataset.karg || '';
  switch (el.dataset.kact) {
    case 'tab': return kOpenTab(arg);
    case 'back': return kGo(null);
    case 'refresh': return kRefresh();
    case 'auto': Rake.setAutoRefresh(!el.classList.contains('on')); return kRender();
    case 'wipe': if (confirm('Clear the saved rakes and indents and read them again?')) { Rake.wipe(); K.data = null; kLoadCached(); kRefresh(); } return;
    case 'status': return kList({status: arg});
    case 'station': return kList({station: arg});
    case 'washery': return kList({washery: arg});
    case 'fcin': return kList({station: arg, status: 'Inside'});
    case 'fc': { const [s, d] = arg.split('|'); return kList({station: s, ed: d, status: 'In Pipeline'}); }
    case 'clear': return kList({});
    case 'indst': K.f.station = arg; return kRender();
    case 'range': K.range = +arg; return kRender();
    case 'mapst': KM.station = arg; if (KM.view) KM.view.touched = false; return kRender();
    case 'actst': K.actStation = arg; return kRender();
    case 'rake': {
      kGo({type: 'rake', id: arg});
      const r = kRakes().find(x => String(x.id) === arg);
      if (r && r.station_from) { await kRoute(r.station_from, r.station_to); if (K.detail && K.detail.id === arg) kRender(); }
      return;
    }
    case 'pickroute': {
      const {from, to} = K.pick;
      if (!from || !to) return alert('Choose a source siding and a destination plant.');
      kGo({type: 'route', from, to});
      await kRoute(from, to);
      if (K.detail && K.detail.type === 'route') kRender();
      return;
    }
  }
});

document.addEventListener('change', e => {
  const sel = e.target.dataset?.ksel;
  if (!sel) return;
  if (sel === 'pfrom') { K.pick.from = e.target.value; return; }
  if (sel === 'pto') { K.pick.to = e.target.value; return; }
  K.f[sel] = e.target.value;
  kRender();
});

/** Called by show('coal'). The first visit of a session reads fresh reports if what is saved is empty. */
function kShow() {
  if (hasRake() && !K.data) { kLoadCached(); if (!kRakes().length && appCan('rakes')) kRefresh(); }
  kRender();
}

/** Android back button: close a Coal detail, then go back to its Summary; otherwise ask the other sections. */
const kPrevBack = window.appBack;
window.appBack = () => {
  if ($('v-coal').classList.contains('on')) {
    if (K.detail) { kGo(null); return true; }
    const first = (kTabs()[0] || ['sum'])[0];
    if (K.tab !== first) { kOpenTab(first); return true; }
  }
  return kPrevBack ? kPrevBack() : false;
};

// While the coal / rakes page is open: FOIS read again every 2 minutes (the background sync does the same when on).
setInterval(() => {
  try {
    const sec = document.getElementById('v-coal') || document.querySelector('[data-section="coal"]');
    const open = sec ? sec.classList.contains('on') || sec.offsetParent !== null : false;
    if (open && typeof hasRake === 'function' && hasRake() && appCan('rakes') && !K.busy && document.visibilityState === 'visible') kRefresh();
  } catch (e) { /* next time */ }
}, 2 * 60e3);
