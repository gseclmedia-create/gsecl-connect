// Gujarat Power: set up for the whole Gujarat power system (APP_MODE 'gujarat',
// mode.js of the Gujarat Power build). Pages: Overview (the Gujarat page: live position, tomorrow's load forecast,
// 14 days, trends, IEX), Stations (every station SLDC lists, by sector), Outages (all sectors), DISCOM (drawal vs
// schedule) and Merit. Sign-in with the GSECL employee account. Data: the same SLDC / IEX readings the page already takes.
// Uses $, esc, fmt, niceTicks, S, show, SECTION, csvBtn, render, latestOutages from the page.

const GJ = {sec: '', fuel: '', osec: '', otype: '', oq: '', mcls: '', open: new Set(), dis: []};

// SLDC real-time station rows -> sector, fuel, name
const GJ_ST = [
  [/^UTPS/i, 'GSECL', 'Coal', 'Ukai TPS'], [/^WTPS/i, 'GSECL', 'Coal', 'Wanakbori TPS'], [/^GTPS/i, 'GSECL', 'Coal', 'Gandhinagar TPS'],
  [/^Sikka/i, 'GSECL', 'Coal', 'Sikka TPS'], [/^KLTPS/i, 'GSECL', 'Lignite', 'Kutch Lignite TPS'], [/^BLTPS/i, 'GSECL', 'Lignite', 'Bhavnagar Lignite TPS'],
  [/^Dhuvaran/i, 'GSECL', 'Gas', 'Dhuvaran GBPS'], [/^Utran/i, 'GSECL', 'Gas', 'Utran GBPS'], [/^Ukai \(Hydro/i, 'GSECL', 'Hydro', 'Ukai Hydro'],
  [/^Kadana/i, 'GSECL', 'Hydro', 'Kadana Hydro'],
  [/^SLPP/i, 'State IPP', 'Lignite', 'SLPP (GIPCL)'], [/^GSEG/i, 'State IPP', 'Gas', 'GSEG Hazira'], [/^Akrimota/i, 'State IPP', 'Lignite', 'Akrimota (GMDC)'],
  [/^GPPC/i, 'State IPP', 'Gas', 'GPPC Pipavav'],
  [/^EPGL/i, 'Private IPP', 'Coal', 'Essar Power (EPGL)'], [/^Sugen/i, 'Private IPP', 'Gas', 'Torrent Sugen + Unosugen'], [/^Adani/i, 'Private IPP', 'Coal', null],
  [/^CGPL/i, 'Central / UMPP', 'Coal', 'Tata CGPL Mundra (UMPP)'], [/^KAPP/i, 'Central / UMPP', 'Nuclear', 'Kakrapar (KAPP)'], [/^SSP/i, 'Central / UMPP', 'Hydro', 'Sardar Sarovar (SSP)'],
];
const GJ_SECTORS = ['GSECL', 'State IPP', 'Private IPP', 'Central / UMPP', 'Other'];
const GJ_SEC_COL = {'GSECL': '#8e3291', 'State IPP': '#10b981', 'Private IPP': '#2563eb', 'Central / UMPP': '#f59e0b', 'Other': '#94a3b8'};
const GJ_FUEL_COL = {Coal: '#f97316', Lignite: '#b45309', Gas: '#0891b2', Hydro: '#2563eb', Nuclear: '#7c3aed'};

/** "1200(1000+200)", "440(125)+ 1400(475.88)", "1148+383(0)" -> [{cap, share}] per '+' part outside brackets. */
function gjCapParts(s) {
  const parts = [], str = String(s || ''); let depth = 0, cur = '';
  for (const ch of str) { if (ch === '(') depth++; if (ch === ')') depth--; if (ch === '+' && depth === 0) { parts.push(cur); cur = ''; } else cur += ch; }
  parts.push(cur);
  return parts.map(p => { const m = /^\s*([\d.]+)\s*(?:\(([^)]*)\))?\s*$/.exec(p); if (!m) return null;
    const cap = +m[1], share = m[2] !== undefined ? m[2].split('+').reduce((t, x) => t + (+x || 0), 0) : cap; return {cap, share}; }).filter(Boolean);
}
const gjNums = s => String(s || '').replace(/\s/g, '').split('+').map(Number).filter(v => isFinite(v));

/** Stations from SLDC's real-time rows: [{name, sector, fuel, cap, share, sch, gen, parts: [{cap, share, sch, gen}]}]. */
function gjStations() {
  const rows = S.gsecl?.rt_rows || [];
  return rows.map(r => {
    const nm = String(r.StationName || '').trim(), m = GJ_ST.find(x => x[0].test(nm));
    const caps = gjCapParts(r.InstalledCapacity), sch = gjNums(r.Schedule), gen = gjNums(r.Generation);
    const parts = (caps.length >= Math.max(sch.length, gen.length) ? caps : Array.from({length: Math.max(sch.length, gen.length)}, (_, i) => caps[i] || {cap: 0, share: 0}))
      .map((c, i) => ({cap: c.cap, share: c.share, sch: sch[i] ?? null, gen: gen[i] ?? null}));
    const sum = k => parts.reduce((t, p) => t + (p[k] !== null && p[k] !== undefined ? Math.max(p[k], 0) : 0), 0);
    const sector = m ? m[1] : 'Other', central = sector === 'Central / UMPP';
    // central / UMPP: SLDC's generation is the whole station, so its load is against installed capacity
    return {raw: nm, name: m ? (m[3] || nm.replace(/-/g, ' ')) : nm, sector, central, fuel: m ? m[2] : '', cap: sum('cap'), share: sum('share'), sch: sum('sch'), gen: sum('gen'), base: central ? sum('cap') : sum('share'), parts};
  }).filter(s => s.name);
}

// ---------------------------------------------------------------- Stations

function gjStationsHtml() {
  const all = gjStations();
  if (!all.length) return `<div class="card"><div class="empty">${S.gsecl ? esc(S.gsecl.sldc_error || 'SLDC station data not available yet.') : 'Reading SLDC…'}</div></div>`;
  const list = all.filter(s => (!GJ.sec || s.sector === GJ.sec) && (!GJ.fuel || s.fuel === GJ.fuel));
  const inG = list.filter(s => !s.central), cen = list.filter(s => s.central);
  const tot = k => inG.reduce((t, s) => t + s[k], 0), gen = tot('gen'), share = tot('share'), sch = tot('sch');
  const bySec = GJ_SECTORS.map(sec => { const l = all.filter(s => s.sector === sec); return {sec, n: l.length, gen: l.reduce((t, s) => t + s.gen, 0), share: l.reduce((t, s) => t + s.base, 0), sch: l.reduce((t, s) => t + s.sch, 0)}; }).filter(x => x.n);
  const max = Math.max(...bySec.map(x => x.share), 1);
  const fuels = [...new Set(all.map(s => s.fuel).filter(Boolean))];
  const chip = (k, v, l, cur) => `<button class="chip ${cur === v ? 'on' : ''}" data-gj="${k}" data-gjv="${esc(v)}">${esc(l)}</button>`;
  const dev = v => `<span class="${v > 0 ? 'pos' : v < 0 ? 'neg' : ''}">${v > 0 ? '+' : v < 0 ? '−' : ''}${fmt(Math.abs(v))}</span>`;
  const load = (g, c, col) => c ? `${fmt(g / c * 100, 0)}%<span class="gload"><i style="width:${Math.min(100, g / c * 100)}%;background:${col}"></i></span>` : '—';
  return `<div class="dhero"><div class="t">Gujarat stations · live (SLDC)</div>
      <div class="v num" style="margin-top:8px">${fmt(gen)}<small style="font-size:14px;font-weight:600;opacity:.8">MW generating in Gujarat</small><span class="dpill p">${share ? fmt(gen / share * 100, 0) : '—'}% of capacity</span></div>
      <div class="dkpis" style="grid-template-columns:repeat(3,1fr)">
        <div class="dkpi"><span>Schedule</span><b class="num">${fmt(sch)}</b><small>MW</small></div>
        <div class="dkpi"><span>Gen − schedule</span><b class="num">${dev(gen - sch)}</b><small>MW</small></div>
        <div class="dkpi"><span>Capacity in Gujarat</span><b class="num">${fmt(share)}</b><small>MW (stations listed by SLDC)</small></div>
        ${cen.length ? `<div class="dkpi"><span>Central / UMPP schedule</span><b class="num">${fmt(cen.reduce((t, s) => t + s.sch, 0))}</b><small>MW to Gujarat · share ${fmt(cen.reduce((t, s) => t + s.share, 0))} MW</small></div>
        <div class="dkpi"><span>Central / UMPP stations</span><b class="num">${fmt(cen.reduce((t, s) => t + s.gen, 0))}</b><small>MW whole-station generation</small></div>
        <div class="dkpi"><span>Stations listed</span><b class="num">${list.length}</b><small>${inG.length} in Gujarat · ${cen.length} central / UMPP</small></div>` : ''}
      </div></div>
    <div class="card"><h2>By sector <span class="more muted" style="font-weight:500;font-size:11.5px">generation against Gujarat's share</span></h2>
      ${bySec.map(x => `<div class="srow" data-gj="sec" data-gjv="${esc(GJ.sec === x.sec ? '' : x.sec)}" style="cursor:pointer"><div class="top"><span class="nm"><i style="display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:6px;background:${GJ_SEC_COL[x.sec]}"></i>${esc(x.sec)} <span class="muted" style="font-weight:400">${x.n} stations</span></span>
        <span class="vals num"><b>${fmt(x.gen)}</b> / ${fmt(x.share)} MW · ${x.share ? fmt(x.gen / x.share * 100, 0) : '—'}%</span></div>
        <div class="bar" style="background:var(--soft)"><div class="f" style="width:${x.share / max * 100}%;background:color-mix(in srgb, ${GJ_SEC_COL[x.sec]} 25%, transparent);position:relative"><i style="position:absolute;left:0;top:0;bottom:0;width:${x.share ? Math.min(100, x.gen / x.share * 100) : 0}%;background:${GJ_SEC_COL[x.sec]};border-radius:inherit"></i></div></div></div>`).join('')}
      <div class="note-src">Against capacity in Gujarat (contracted share as SLDC shows it in brackets); central / UMPP stations against their installed capacity, as SLDC gives their whole-station generation. Touch a sector to filter.</div></div>
    <div class="chips">${chip('sec', '', 'All sectors', GJ.sec)}${GJ_SECTORS.filter(s => bySec.some(x => x.sec === s)).map(s => chip('sec', s, s, GJ.sec)).join('')}</div>
    <div class="chips">${chip('fuel', '', 'All fuels', GJ.fuel)}${fuels.map(f => chip('fuel', f, f, GJ.fuel)).join('')}</div>
    <div class="card"><h2>Stations ${GJ.sec || GJ.fuel ? `<span class="more muted" style="font-weight:500;font-size:11.5px">${esc([GJ.sec, GJ.fuel].filter(Boolean).join(' · '))}</span>` : ''}</h2><div style="overflow-x:auto"><table class="gt num">
      <tr><th>Station</th><th>Cap MW</th><th>Sch</th><th>Gen</th><th>Gen−Sch</th><th>Load</th></tr>
      ${GJ_SECTORS.filter(sec => list.some(s => s.sector === sec)).map(sec => `<tr class="tot"><td colspan="6" style="text-align:left">${esc(sec)}</td></tr>` + list.filter(s => s.sector === sec).sort((a, b) => b.share - a.share).map(s => {
        const open = GJ.open.has(s.raw) && s.parts.length > 1;
        return `<tr data-gj="open" data-gjv="${esc(s.raw)}" style="cursor:${s.parts.length > 1 ? 'pointer' : 'default'}"><td><i style="background:${GJ_FUEL_COL[s.fuel] || '#94a3b8'}"></i>${esc(s.name)}${s.parts.length > 1 ? ` <small class="muted">${open ? '▲' : '▼'}</small>` : ''}</td><td>${fmt(s.base)}${s.central && s.share !== s.cap ? `<br><small class="muted">Guj ${fmt(s.share)}</small>` : ''}</td><td>${fmt(s.sch)}</td><td><b>${fmt(s.gen)}</b></td><td>${s.central ? '<small class="muted">—</small>' : dev(s.gen - s.sch)}</td><td>${load(s.gen, s.base, GJ_FUEL_COL[s.fuel] || 'var(--accent)')}</td></tr>`
          + (open ? s.parts.map((p, i) => `<tr style="font-size:12px;color:var(--muted)"><td style="padding-left:22px">part ${i + 1} · ${fmt(p.cap)} MW${p.share !== p.cap ? ' (Guj ' + fmt(p.share) + ')' : ''}</td><td>${fmt(p.share)}</td><td>${p.sch === null ? '—' : fmt(p.sch)}</td><td>${p.gen === null ? '—' : fmt(p.gen)}</td><td>${p.sch === null || p.gen === null ? '—' : dev(p.gen - p.sch)}</td><td>${p.share && p.gen !== null ? fmt(Math.max(0, p.gen) / p.share * 100, 0) + '%' : '—'}</td></tr>`).join('') : '');
      }).join('')).join('')}
      <tr class="tot"><td>Total in Gujarat</td><td>${fmt(share)}</td><td>${fmt(sch)}</td><td>${fmt(gen)}</td><td>${dev(gen - sch)}</td><td>${load(gen, share, 'var(--accent)')}</td></tr></table></div>
      <div class="note-src">From SLDC real-time data ${esc(S.gsecl?.fetched_at || '')}. Load = generation ÷ capacity (central / UMPP: whole station; Gen − Sch not shown as their schedule is Gujarat's part only). Wind, solar and small plants are in the Overview mix (SLDC gives them as state totals).</div>
      ${csvBtn('gjSt', 'Gujarat_stations', ['Sector', 'Fuel', 'Station', 'Installed MW', 'Gujarat share MW', 'Schedule MW', 'Generation MW'], list.map(s => [s.sector, s.fuel, s.name, s.cap, s.share, s.sch, s.gen]))}</div>`;
}

// ---------------------------------------------------------------- Outages (all sectors)

function gjOutRows() { const o = S.outages; return o?.ok ? (o.all_rows || o.allRows || o.rows || []) : []; }
const gjSecOf = r => (r.sector === 'GSECL' ? 'GSECL' : r.sector === 'Central' ? 'Central' : 'Private');
const GJ_TYPE_COL = {Forced: 'var(--forced)', Planned: 'var(--planned)', RSD: 'var(--rsd)', Outage: 'var(--muted)'};

function gjOutagesHtml() {
  const o = S.outages;
  if (!o) return '<div class="card"><div class="sk" style="height:140px"></div></div>';
  if (!o.ok) return `<div class="card"><div class="empty">${esc(o.error || 'SLDC outage list not available.')}</div></div>`;
  const all = gjOutRows(), mw = r => parseFloat(r.cap) || 0, q = GJ.oq.toLowerCase();
  const list = all.filter(r => (!GJ.osec || gjSecOf(r) === GJ.osec) && (!GJ.otype || r.type === GJ.otype) && (!q || `${r.unit} ${r.reason}`.toLowerCase().includes(q)));
  const types = ['Forced', 'Planned', 'RSD', 'Outage'], secs = ['GSECL', 'Private', 'Central'];
  const sum = (l, f) => l.filter(f).reduce((t, r) => t + mw(r), 0);
  const days = r => { const m = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(r.since || ''); return m ? Math.floor((Date.now() - new Date(+m[3], m[2] - 1, +m[1]).getTime()) / 864e5) : null; };
  const W = 320, rowH = 26, max = Math.max(1, ...secs.map(s => sum(all, r => gjSecOf(r) === s)));
  const bars = secs.map((s, i) => { let x = 90; const segs = types.map(t => { const v = sum(all, r => gjSecOf(r) === s && r.type === t); const w = v / max * (W - 140); const seg = v ? `<rect x="${x}" y="${i * rowH + 6}" width="${w.toFixed(1)}" height="14" rx="2" style="fill:${GJ_TYPE_COL[t]}"><title>${s} ${t}: ${fmt(v)} MW</title></rect>` : ''; x += w; return seg; }).join('');
    return `<text x="0" y="${i * rowH + 17}" class="ax" style="font-size:11px">${s}</text>${segs}<text x="${x + 4}" y="${i * rowH + 17}" class="ax" style="font-size:11px;font-weight:700">${fmt(sum(all, r => gjSecOf(r) === s))} MW</text>`; }).join('');
  const chip = (k, v, l, cur) => `<button class="chip ${cur === v ? 'on' : ''}" data-gj="${k}" data-gjv="${esc(v)}">${esc(l)}</button>`;
  return `<div class="card"><h2>Gujarat unit outages <span class="more muted" style="font-weight:500;font-size:11.5px">SLDC ${esc(o.as_of || o.fetched_at || '')}</span></h2>
      <div class="tstats" style="grid-template-columns:repeat(4,1fr)">
        <div><span>Units out</span><b class="num">${all.length}</b><small>${fmt(sum(all, () => true))} MW</small></div>
        <div><span>Forced</span><b class="num neg">${fmt(sum(all, r => r.type === 'Forced'))}</b><small>MW · ${all.filter(r => r.type === 'Forced').length} units</small></div>
        <div><span>Planned</span><b class="num">${fmt(sum(all, r => r.type === 'Planned'))}</b><small>MW · ${all.filter(r => r.type === 'Planned').length} units</small></div>
        <div><span>Reserve shutdown</span><b class="num">${fmt(sum(all, r => r.type === 'RSD'))}</b><small>MW · ${all.filter(r => r.type === 'RSD').length} units</small></div></div>
      <div class="chart"><svg viewBox="0 0 ${W} ${secs.length * rowH + 6}" role="img" aria-label="MW out by sector and type">${bars}</svg></div>
      <div class="keyline">${types.map(t => `<span><i style="width:12px;height:10px;background:${GJ_TYPE_COL[t]}"></i>${t}</span>`).join('')}</div></div>
    <input class="search" id="gjOq" type="search" placeholder="Search unit or reason…" value="${esc(GJ.oq)}" autocomplete="off">
    <div class="chips">${chip('osec', '', 'All · ' + all.length, GJ.osec)}${secs.map(s => chip('osec', s, s + ' · ' + all.filter(r => gjSecOf(r) === s).length, GJ.osec)).join('')}</div>
    <div class="chips">${chip('otype', '', 'All types', GJ.otype)}${types.filter(t => all.some(r => r.type === t)).map(t => chip('otype', t, t, GJ.otype)).join('')}</div>
    ${list.map(r => { const d = days(r); return `<div class="card" style="border-left:4px solid ${GJ_TYPE_COL[r.type] || 'var(--muted)'};padding:12px 14px">
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:center"><b>${esc(r.unit)} <span class="badge b-${esc(r.type === 'Outage' ? 'Outage' : r.type)}">${esc(r.type)}</span> <span class="muted" style="font-weight:500;font-size:12px">${esc(gjSecOf(r))}</span></b><b class="num">${r.cap ? esc(r.cap) + ' <small class="muted">MW</small>' : ''}</b></div>
      <div class="vals" style="margin-top:4px">Out since <b>${esc(r.since || '—')}</b>${d !== null ? ` (${d} day${d === 1 ? '' : 's'})` : ''} · expected back <b>${esc(r.revised || r.schedule || '—')}</b></div>
      ${r.reason ? `<div class="vals" style="margin-top:4px">${esc(r.reason)}</div>` : ''}</div>`; }).join('') || '<div class="card"><div class="empty">No outage matches.</div></div>'}
    ${csvBtn('gjOut', 'Gujarat_unit_outages', ['Sector', 'Unit', 'MW', 'Type', 'Since', 'Expected back', 'Reason'], list.map(r => [gjSecOf(r), r.unit, r.cap, r.type, r.since, r.revised || r.schedule, r.reason]))}`;
}

// ---------------------------------------------------------------- DISCOM drawal vs schedule

function gjDiscomHtml() {
  const d = S.home?.ok ? S.home.discoms : null;
  if (!d || !d.length) return `<div class="card"><div class="empty">${S.home ? 'DISCOM drawal is not available from SLDC just now.' : 'Reading SLDC…'}</div></div>`;
  const list = d.filter(r => r.drawal !== null || r.schedule !== null);
  const isTot = r => /total|guvnl|gujarat/i.test(r.name), parts = list.filter(r => !isTot(r)), tot = list.find(isTot);
  const T = tot || {name: 'Total', drawal: parts.reduce((t, r) => t + (r.drawal || 0), 0), schedule: parts.reduce((t, r) => t + (r.schedule || 0), 0), dsm: parts.reduce((t, r) => t + (r.dsm || 0), 0)};
  const W = Math.max(($('v-gdis')?.clientWidth || 340) - 30, 280), rowH = 34, L = 92, max = Math.max(1, ...parts.flatMap(r => [r.drawal || 0, r.schedule || 0]));
  const xw = v => Math.max(0, v) / max * (W - L - 70);
  const bars = parts.map((r, i) => { const dv = (r.drawal || 0) - (r.schedule || 0); return `<text x="0" y="${i * rowH + 15}" class="ax" style="font-size:11px">${esc(r.name).slice(0, 14)}</text>
      <rect x="${L}" y="${i * rowH + 4}" width="${xw(r.schedule || 0).toFixed(1)}" height="11" rx="2" style="fill:var(--muted);opacity:.45"><title>Schedule ${fmt(r.schedule)} MW</title></rect>
      <rect x="${L}" y="${i * rowH + 17}" width="${xw(r.drawal || 0).toFixed(1)}" height="11" rx="2" style="fill:${dv > 0 ? 'var(--forced)' : 'var(--accent)'}"><title>Drawal ${fmt(r.drawal)} MW</title></rect>
      <text x="${L + Math.max(xw(r.drawal || 0), xw(r.schedule || 0)) + 4}" y="${i * rowH + 21}" class="ax" style="font-size:11px;font-weight:700;fill:${dv > 0 ? 'var(--neg)' : 'var(--pos)'}">${dv > 0 ? '+' : '−'}${fmt(Math.abs(dv))}</text>`; }).join('');
  // a short history of this session (each refresh), for the total
  const tdv = (T.drawal || 0) - (T.schedule || 0);
  if (!GJ.dis.length || Date.now() - GJ.dis[GJ.dis.length - 1].t > 50e3) GJ.dis.push({t: Date.now(), d: T.drawal || 0, s: T.schedule || 0});
  if (GJ.dis.length > 240) GJ.dis.shift();
  return `<div class="dhero"><div class="t">DISCOM drawal vs schedule · live (SLDC)</div>
      <div class="v num" style="margin-top:8px">${fmt(T.drawal)}<small style="font-size:14px;font-weight:600;opacity:.8">MW drawal</small><span class="dpill ${tdv > 0 ? 'r' : 'p'}">${tdv > 0 ? 'over' : 'under'} by ${fmt(Math.abs(tdv))} MW</span></div>
      <div class="dkpis" style="grid-template-columns:repeat(3,1fr)">
        <div class="dkpi"><span>Schedule</span><b class="num">${fmt(T.schedule)}</b><small>MW</small></div>
        <div class="dkpi"><span>Drawal − schedule</span><b class="num">${tdv > 0 ? '+' : '−'}${fmt(Math.abs(tdv))}</b><small>MW</small></div>
        <div class="dkpi"><span>DSM (SLDC)</span><b class="num">${T.dsm === null || T.dsm === undefined ? '—' : fmt(T.dsm)}</b><small>as SLDC shows it</small></div></div></div>
    <div class="card"><h2>By DISCOM</h2><div class="chart"><svg viewBox="0 0 ${W} ${parts.length * rowH + 4}" role="img" aria-label="DISCOM drawal and schedule">${bars}</svg></div>
      <div class="keyline"><span><i style="width:12px;height:10px;background:var(--muted);opacity:.45"></i>Schedule</span><span><i style="width:12px;height:10px;background:var(--accent)"></i>Drawal (under)</span><span><i style="width:12px;height:10px;background:var(--forced)"></i>Drawal (over)</span></div>
      <div style="overflow-x:auto;margin-top:8px"><table class="gt num"><tr><th>DISCOM</th><th>Drawal</th><th>Schedule</th><th>Diff</th><th>%</th><th>DSM</th></tr>
        ${list.map(r => { const dv = (r.drawal || 0) - (r.schedule || 0); return `<tr class="${isTot(r) ? 'tot' : ''}"><td>${esc(r.name)}</td><td>${fmt(r.drawal)}</td><td>${fmt(r.schedule)}</td><td class="${dv > 0 ? 'neg' : 'pos'}">${dv > 0 ? '+' : '−'}${fmt(Math.abs(dv))}</td><td>${r.schedule ? fmt(dv / r.schedule * 100, 1) : '—'}</td><td>${r.dsm === null || r.dsm === undefined ? '—' : fmt(r.dsm)}</td></tr>`; }).join('')}</table></div>
      <div class="note-src">MW, from SLDC real-time data (ReadRealTimeData1). Over-drawal (drawal above schedule) is shown red.</div>
      ${csvBtn('gjDis', 'DISCOM_drawal', ['DISCOM', 'Drawal MW', 'Schedule MW', 'Drawal - schedule MW', 'DSM'], list.map(r => [r.name, r.drawal, r.schedule, (r.drawal || 0) - (r.schedule || 0), r.dsm]))}</div>
    ${GJ.dis.length > 2 ? gjDisTrend() : ''}`;
}
function gjDisTrend() {
  const p = GJ.dis, W = 320, H = 130, L = 40, R = 6, T = 8, B = 18, vals = p.flatMap(x => [x.d, x.s]), hi = Math.max(...vals) * 1.01, lo = Math.min(...vals) * 0.99;
  const x = t => L + (t - p[0].t) / Math.max(1, p[p.length - 1].t - p[0].t) * (W - L - R), y = v => T + (hi - v) / ((hi - lo) || 1) * (H - T - B);
  const line = k => p.map((q, i) => (i ? 'L' : 'M') + x(q.t).toFixed(1) + ',' + y(q[k]).toFixed(1)).join('');
  const hm = t => new Date(t).toTimeString().slice(0, 5);
  return `<div class="card"><h2>Total drawal and schedule · this session <span class="more muted" style="font-weight:500;font-size:11.5px">${p.length} readings</span></h2>
    <div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="DISCOM total over this session">
      ${niceTicks(lo, hi, 3).map(v => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${L - 4}" y="${y(v) + 3.5}" text-anchor="end">${fmt(v / 1000, 1)}k</text>`).join('')}
      <text class="ax" x="${L}" y="${H - 4}">${hm(p[0].t)}</text><text class="ax" x="${W - R}" y="${H - 4}" text-anchor="end">${hm(p[p.length - 1].t)}</text>
      <path d="${line('s')}" fill="none" style="stroke:var(--muted)" stroke-width="1.6" stroke-dasharray="4 3"/><path d="${line('d')}" fill="none" style="stroke:var(--accent)" stroke-width="2.4"/></svg></div>
    <div class="keyline"><span><i style="width:16px;height:3px;background:var(--accent)"></i>Drawal</span><span><i style="width:16px;height:0;border-top:2px dashed var(--muted)"></i>Schedule</span><span>Recorded while the app is open</span></div></div>`;
}

// ---------------------------------------------------------------- Gujarat merit order (every generator of SLDC's list)

const GJ_MCLS = {must: ['Must-run share', '#16a34a'], cen: ['Central share (GETCO periphery)', '#f59e0b'], gsecl: ['GSECL', '#8e3291'], ipp: ['IPP / state in Gujarat', '#2563eb']};
/** Merit name -> live SLDC station (for the MW running now). */
const GJ_MLIVE = [[/AKRIMOTA/i, /^Akrimota/i], [/SLPP/i, /^SLPP/i], [/APL-?\s*I\b(?!I)/i, /^Adani-I$/i], [/APL-?\s*II\b/i, /^Adani-II$/i], [/EPGL/i, /^EPGL/i],
  [/^GPPC/i, /^GPPC/i], [/^GSEG/i, /^GSEG/i], [/CGPL/i, /^CGPL/i], [/^KAKRAPAR APS/i, /^KAPP/i], [/SARDAR SAROVAR/i, /^SSP/i]];

function gjMeritData() {
  const h = typeof meritHistory === 'function' ? meritHistory() : [];
  for (let i = h.length - 1; i >= 0; i--) if (Array.isArray(h[i].all) && h[i].all.length) return h[i];
  return typeof MERIT_BUILTIN_2 !== 'undefined' ? MERIT_BUILTIN_2 : null;
}
function gjMeritHtml() {
  const m = gjMeritData();
  if (!m) return '<div class="card"><div class="empty">Merit order not available.</div></div>';
  const st = gjStations(), blk = {};
  (S.gsecl?.stations || []).forEach(x => x.blocks.forEach(b => { blk[b.key] = b; }));
  const rows = m.all.map(([rank, name, cost, remark]) => {
    const up = String(name).toUpperCase(), gp = (typeof MERIT_PATTERNS !== 'undefined' ? MERIT_PATTERNS : []).find(([re]) => re.test(up));
    const cls = /compulsory/i.test(remark) ? 'must' : gp ? 'gsecl' : /getco peri/i.test(remark) ? 'cen' : 'ipp';
    let mw = null, cap = null;
    if (gp && blk[gp[1]]) { mw = blk[gp[1]].gen; cap = blk[gp[1]].cap; }
    let whole = false;
    if (!(gp && blk[gp[1]])) { const lm = GJ_MLIVE.find(([re]) => re.test(name)); const s2 = lm && st.find(x => lm[1].test(x.raw)); if (s2) { mw = s2.gen; cap = s2.base; whole = s2.central; } }
    return {rank, name, cost, remark, cls, mw, cap, whole};
  });
  const list = rows.filter(r => !GJ.mcls || r.cls === GJ.mcls), max = Math.max(...rows.map(r => r.cost || 0), 1);
  // cheaper in-state stations backed down while a costlier one runs
  const live = rows.filter(r => r.cap && r.mw !== null && r.cost !== null && (r.cls === 'gsecl' || r.cls === 'ipp'));
  const dear = live.filter(r => r.mw > r.cap * 0.1).sort((a, b) => b.cost - a.cost)[0];
  const cheapIdle = dear ? live.filter(r => r.cost < dear.cost && r.mw < r.cap * 0.55).sort((a, b) => a.cost - b.cost) : [];
  const chip = (v, l) => `<button class="chip ${GJ.mcls === v ? 'on' : ''}" data-gj="mcls" data-gjv="${v}">${esc(l)}</button>`;
  return `<div class="card"><h2>Gujarat merit order <span class="more muted" style="font-weight:500;font-size:11.5px">SLDC ${esc(m.asOf || '')} · ${rows.length} sources</span></h2>
      <div class="vals" style="font-size:12.5px">Merit order on the basis of agreement for variable cost (Rs/kWh), subject to change with fuel cost — every generator SLDC schedules for Gujarat, including central shares at the GETCO periphery. ${m.url ? `<a href="${esc(m.url)}" target="_blank" rel="noopener" style="color:var(--accent)">SLDC PDF</a>` : ''}</div>
      <div class="tstats" style="grid-template-columns:repeat(4,1fr);margin-top:8px">${Object.entries(GJ_MCLS).map(([k, [l, c]]) => { const g = rows.filter(r => r.cls === k && r.cost !== null); return `<div><span style="color:${c}">${esc(l)}</span><b class="num">${g.length}</b><small>${g.length ? '₹' + fmt(Math.min(...g.map(r => r.cost)), 2) + '–' + fmt(Math.max(...g.map(r => r.cost)), 2) : '—'}</small></div>`; }).join('')}</div></div>
    ${dear && cheapIdle.length ? `<div class="alert" style="background:#fff7ed;border-color:#fed7aa;color:#9a3412"><span>⚖</span><span><b>${esc(dear.name)}</b> (₹${fmt(dear.cost, 2)}) is running ${fmt(dear.mw)} MW while cheaper ${cheapIdle.slice(0, 3).map(r => `${esc(r.name)} (₹${fmt(r.cost, 2)}, ${fmt(r.mw)} of ${fmt(r.cap)} MW)`).join(', ')} ${cheapIdle.length > 1 ? 'are' : 'is'} below half load — check technical / grid reasons.</span></div>` : ''}
    <div class="chips">${chip('', 'All · ' + rows.length)}${Object.entries(GJ_MCLS).map(([k, [l]]) => chip(k, l)).join('')}</div>
    <div class="card">${list.map(r => `<div class="srow" style="cursor:default"><div class="top"><span class="nm"><span class="drank">${r.rank}</span>${esc(r.name)}</span><span class="vals num"><b>${r.cost === null ? 'NA' : '₹' + fmt(r.cost, 2)}</b></span></div>
        <div class="bar" style="background:var(--soft)"><div class="f" style="width:${r.cost === null ? 0 : r.cost / max * 100}%;background:${GJ_MCLS[r.cls][1]}"></div></div>
        <div class="vals">${esc(GJ_MCLS[r.cls][0])}${r.mw !== null ? ` · <b>${fmt(r.mw)} MW</b> ${r.whole ? 'station generating (whole station)' : 'running' + (r.cap ? ' of ' + fmt(r.cap) : '')}` : ''}${r.remark ? ' · ' + esc(r.remark) : ''}</div></div>`).join('')}</div>
    ${csvBtn('gjMer', 'Gujarat_merit_order_' + String(m.asOf || '').replace(/\D/g, ''), ['Rank', 'Generator', 'Variable cost Rs/kWh', 'Class', 'Running MW', 'Capacity / share MW', 'Remarks'], list.map(r => [r.rank, r.name, r.cost, GJ_MCLS[r.cls][0], r.mw, r.cap, r.remark]))}`;
}

// ---------------------------------------------------------------- set-up in Gujarat mode

function gjRender() {
  if (window.APP_MODE !== 'gujarat') return;
  const on = id => $(id) && $(id).classList.contains('on');
  if (on('v-gstn')) $('gjStBody').innerHTML = gjStationsHtml();
  if (on('v-gout')) { const f = document.activeElement && document.activeElement.id === 'gjOq'; $('gjOutBody').innerHTML = gjOutagesHtml(); if (f) { const e = $('gjOq'); e.focus(); e.setSelectionRange(e.value.length, e.value.length); } }
  if (on('v-gdis')) $('gjDisBody').innerHTML = gjDiscomHtml();
  if (on('v-gmer')) $('gjMerBody').innerHTML = gjMeritHtml();
}

(function gjSetup() {
  if (window.APP_MODE !== 'gujarat') return;
  document.documentElement.classList.add('gj-mode');
  document.title = 'Gujarat Power';
  const h1 = document.querySelector('.hero h1'), org = document.querySelector('.hero .org');
  if (h1) h1.textContent = 'Gujarat Power';
  if (org) org.textContent = 'Gujarat power system · SLDC live data';
  const ico = p => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
  $('nav').innerHTML = [
    ['grid', 'gen', 'Overview', '<path d="M3 12h4l3-8 4 16 3-8h4"/>'],
    ['gstn', 'gstn', 'Stations', '<path d="M3 21V10l5 3V10l5 3V6l8 4v11z"/>'],
    ['gout', 'gout', 'Outages', '<circle cx="12" cy="12" r="9"/><path d="M12 7v6"/><path d="M12 16.5h.01"/>'],
    ['gdis', 'gdis', 'DISCOM', '<path d="M4 20h16"/><path d="M7 16V9"/><path d="M12 16V5"/><path d="M17 16v-4"/>'],
    ['gmer', 'gmer', 'Merit', '<path d="M4 6h16"/><path d="M4 12h10"/><path d="M4 18h6"/>'],
  ].map(([v, sec, l, p]) => `<button data-v="${v}" data-sec="${sec}">${ico(p)}${l}</button>`).join('');
  Object.assign(SECTION, {gstn: 'gstn', gout: 'gout', gdis: 'gdis', gmer: 'gmer'});
  const r0 = window.render; window.render = function () { r0.apply(this, arguments); gjRender(); };
  const s0 = window.show; window.show = function (v) { s0(v); gjRender(); };
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-gj]'); if (!b) return;
    const k = b.dataset.gj, v = b.dataset.gjv || '';
    if (k === 'open') { GJ.open.has(v) ? GJ.open.delete(v) : GJ.open.add(v); }
    else GJ[k] = v;
    gjRender();
  });
  document.addEventListener('input', e => { if (e.target.id === 'gjOq') { GJ.oq = e.target.value; gjRender(); } });
  window.addEventListener('load', () => setTimeout(() => show('grid'), 50));
  setTimeout(() => { if (!document.querySelector('.view.on') || $('v-home').classList.contains('on')) show('grid'); }, 400);
})();
