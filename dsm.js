// DSM view: GSECL deviation-settlement charges from SLDC Gujarat's weekly accounts.
// The app's :dsm module downloads and reads the PDFs and keeps the figures on the phone; this file
// only asks it for data (window.Dsm) and draws it with the page's own cards, charts and theme.
// Uses $, esc, fmt, niceTicks and show() from index.html.

const D = {
  fy: '', tab: 'fy', detail: null,      // detail: {type: 'week'|'station'|'month', id}
  data: null, week: null, open: new Set(), charts: [],
  status: {running: false, message: ''}, seenError: '', poll: 0,
};
const hasDsm = () => typeof window.Dsm !== 'undefined';
const DSM_TABS = [['fy', 'FY'], ['weeks', 'Weeks'], ['stations', 'Stations'], ['monthly', 'Monthly'], ['solar', 'Solar'], ['est', 'Estimate']];
const DSM_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ---------------------------------------------------------------- formatting

const dRup = v => '₹' + fmt(Math.abs(v || 0));
/** Net figure: positive is payable by GSECL (red), negative is receivable (green). */
const dNet = v => !v ? '<span class="na">₹0</span>' : `<span class="${v > 0 ? 'neg' : 'pos'}">${dRup(v)} ${v > 0 ? 'payable' : 'receivable'}</span>`;
const dDelta = v => `<span class="${v > 0 ? 'neg' : v < 0 ? 'pos' : 'na'}">${v >= 0 ? '+' : '−'}${dRup(v)}</span>`;
const dShort = v => { const a = Math.abs(v); return a >= 1e7 ? '₹' + fmt(a / 1e7, 2) + ' Cr' : a >= 1e5 ? '₹' + fmt(a / 1e5, 1) + ' L' : '₹' + fmt(a); };
const dDay = iso => iso ? `${iso.slice(8, 10)} ${DSM_MONTHS[+iso.slice(5, 7) - 1]}` : '—';
const dDate = iso => iso ? `${dDay(iso)} ${iso.slice(0, 4)}` : '—';
const dMonth = ym => `${DSM_MONTHS[+ym.slice(5, 7) - 1]} ${ym.slice(0, 4)}`;
const dQty = v => v === null || v === undefined ? '—' : fmt(v, 2);

// ---------------------------------------------------------------- data

/** Bridge rows arrive as arrays; give them names. */
const dRows = a => a.map(r => ({n: r[0], kind: r[1], key: r[2], name: r[3], date: r[4], sch: r[5], act: r[6], pay: r[7], rec: r[8], net: r[9], total: !!r[10]}));

function dsmLoad() {
  if (!hasDsm()) { D.data = null; return; }
  const j = JSON.parse(Dsm.data(D.fy));
  j.notices = j.notices || [];
  j.rows = dRows(j.rows || []);
  j.latest = j.notices.filter(n => n.latest).sort((a, b) => a.week - b.week);
  D.data = j;
  D.fy = j.fy || '';
}

const dSum = rows => rows.reduce((t, r) => { t.sch += r.sch || 0; t.act += r.act || 0; t.pay += r.pay || 0; t.rec += r.rec || 0; t.net += r.net || 0; return t; }, {sch: 0, act: 0, pay: 0, rec: 0, net: 0});
const dPick = (total, kind, key) => D.data.rows.filter(r => r.total === total && (kind === null || r.kind === kind) && (!key || r.key === key));
/** Week-by-week sums, in week order: [[notice, sum], ...] */
function dByWeek(kind = null, key = '') {
  const g = new Map();
  for (const r of dPick(true, kind, key)) (g.get(r.n) || g.set(r.n, []).get(r.n)).push(r);
  return D.data.latest.filter(n => g.has(n.id)).map(n => [n, dSum(g.get(n.id))]);
}
/** Calendar-month sums from the day-wise lines, so a week spanning two months is split correctly. */
function dByMonth(kind = null, key = '') {
  const g = new Map();
  for (const r of dPick(false, kind, key)) { const m = r.date.slice(0, 7); (g.get(m) || g.set(m, []).get(m)).push(r); }
  return [...g.keys()].sort().map(m => [m, dSum(g.get(m))]);
}
/** Per-station sums, largest net first: [{key, name, sum}] */
function dByStation(kind, month = '') {
  const src = month ? dPick(false, kind, '').filter(r => r.date.startsWith(month)) : dPick(true, kind, '');
  const g = new Map();
  for (const r of src) (g.get(r.key) || g.set(r.key, []).get(r.key)).push(r);
  return [...g].map(([key, l]) => ({key, name: l[l.length - 1].name, sum: dSum(l)})).sort((a, b) => b.sum.net - a.sum.net);
}

// ---------------------------------------------------------------- building blocks (page styles)

const dWeekPts = list => list.map(([n, s]) => ({l: 'W' + n.week, v: s.net, tip: `<b>Week ${n.week}</b> · ${dDay(n.from)} – ${dDay(n.to)} · ${dNetTxt(s.net)}`}));
const dMonthPts = list => list.map(([m, s]) => ({l: DSM_MONTHS[+m.slice(5, 7) - 1], v: s.net, tip: `<b>${dMonth(m)}</b> · ${dNetTxt(s.net)}`}));
const dNetTxt = v => !v ? '₹0' : `${dRup(v)} ${v > 0 ? 'payable' : 'receivable'}`;

/**
 * A chart card. pts: [{l, v, tip, parts?: [{v, c, name}]}]; o.cum: running total on a second axis (default on for
 * trends); o.stack: legend of the parts drawn stacked (e.g. stations and solar).
 */
function dChart(title, pts, note = '', o = {}) {
  const spec = {pts, cum: o.cum !== false && pts.length > 2, stack: o.stack || null};
  D.charts.push(spec);
  const key = spec.stack ? spec.stack.map(([name, c]) => `<span><i style="width:14px;height:8px;border-radius:3px;background:${c}"></i>${esc(name)}</span>`).join('')
    : '<span><i style="width:14px;height:8px;border-radius:3px;background:var(--neg)"></i>Payable</span><span><i style="width:14px;height:8px;border-radius:3px;background:var(--pos)"></i>Receivable</span>';
  return `<div class="card"><h2>${esc(title)}${note ? `<span class="more muted" style="font-weight:500;font-size:11.5px">${esc(note)}</span>` : ''}</h2>
    <div class="chart" data-dchart="${D.charts.length - 1}"></div>
    <div class="keyline">${key}<span><i style="width:14px;height:0;border-top:2px dashed var(--muted)"></i>Average</span>${spec.cum ? '<span><i style="width:14px;height:3px;background:var(--accent)"></i>Running total (right axis)</span>' : ''}</div>
    ${pts.length ? csvBtn('dsm' + (D.charts.length - 1), 'DSM_' + title, ['Period', 'Net deviation charges (Rs, + payable / − receivable)'].concat(spec.stack ? spec.stack.map(([n]) => n + ' (Rs)') : [], spec.cum ? ['Running total (Rs)'] : [], ['Details']),
      (() => { let run = 0; return pts.map(p => { run += p.v; return [p.l, p.v].concat(spec.stack ? (p.parts || []).map(q => q.v) : [], spec.cum ? [run] : [], [String(p.tip || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()]); }); })()) : ''}</div>`;
}

let dGrad = 0;
/** Bar chart of signed amounts (payable up in red, receivable down in green, or stacked parts), with the average
 *  and, optionally, the running total on a right-hand axis. Touch a bar for its figures. */
function dDrawChart(box, spec) {
  const pts = spec.pts || [];
  if (!pts.length) { box.innerHTML = '<div class="empty">No data downloaded for this period yet.</div>'; return; }
  const g = ++dGrad, W = Math.max(box.clientWidth || 320, 240), H = 220, L = 54, R = spec.cum ? 52 : 10, T = 28, B = 24;
  const up = p => p.parts ? p.parts.reduce((t, q) => t + Math.max(0, q.v), 0) : Math.max(0, p.v);
  const dn = p => p.parts ? p.parts.reduce((t, q) => t + Math.min(0, q.v), 0) : Math.min(0, p.v);
  const hi = Math.max(0, ...pts.map(up)) * 1.12 || 1, lo = Math.min(0, ...pts.map(dn)) * 1.12;
  const span = (hi - lo) || 1, slot = (W - L - R) / pts.length, bw = Math.max(2, Math.min(slot * 0.64, 30));
  const y = v => T + (hi - v) / span * (H - T - B), x = i => L + (i + 0.5) * slot;
  const every = Math.max(1, Math.ceil(pts.length / ((W - L - R) / 32)));
  const avg = pts.reduce((t, p) => t + p.v, 0) / pts.length;
  let run = 0; const cum = pts.map(p => (run += p.v));
  const cLo = Math.min(0, ...cum), cHi = Math.max(0, ...cum) * 1.08 || 1, yc = v => T + (cHi - v) / ((cHi - cLo) || 1) * (H - T - B);
  const top = pts.reduce((b, p, i) => (p.v > pts[b].v ? i : b), 0);
  const bar = (x0, v, base, fill) => { const a = y(base + Math.max(0, v)), b = y(base + Math.min(0, v)); return `<rect x="${x0.toFixed(1)}" y="${a.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(v ? 1.5 : 0, b - a).toFixed(1)}" rx="${Math.min(4, bw / 3).toFixed(1)}" style="fill:${fill}"/>`; };
  const bars = pts.map((p, i) => {
    const x0 = x(i) - bw / 2;
    if (!p.parts) return bar(x0, p.v, 0, `url(#dg${g}${p.v >= 0 ? 'p' : 'r'})`);
    let pos = 0, neg = 0;
    return p.parts.map(q => { const r = bar(x0, q.v, q.v >= 0 ? pos : neg, q.c); if (q.v >= 0) pos += q.v; else neg += q.v; return r; }).join('');
  }).join('');
  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img">
    <defs><linearGradient id="dg${g}p" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:#f87171"/><stop offset="1" style="stop-color:var(--neg)"/></linearGradient>
      <linearGradient id="dg${g}r" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--pos)"/><stop offset="1" style="stop-color:#4ade80"/></linearGradient></defs>
    ${niceTicks(lo, hi, 4).map(v => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${L - 6}" y="${y(v) + 3.5}" text-anchor="end">${v < 0 ? '−' : ''}${dShort(v)}</text>`).join('')}
    ${spec.cum ? niceTicks(cLo, cHi, 4).map(v => `<text class="ax" x="${W - R + 5}" y="${yc(v) + 3.5}" style="fill:var(--accent)">${v < 0 ? '−' : ''}${dShort(v).replace('₹', '')}</text>`).join('') : ''}
    <rect class="dhl" x="0" y="${T}" width="${slot}" height="${H - T - B}" style="fill:var(--soft);display:none"/>
    ${bars}
    <line x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}" style="stroke:var(--muted)" stroke-width="1"/>
    <line x1="${L}" x2="${W - R}" y1="${y(avg)}" y2="${y(avg)}" style="stroke:var(--muted)" stroke-width="1.2" stroke-dasharray="4 3"/>
    <text class="ax" x="${L + 3}" y="${y(avg) - 4}" text-anchor="start" style="paint-order:stroke;stroke:var(--card);stroke-width:3px">avg ${avg < 0 ? '−' : ''}${dShort(avg)}</text>
    ${pts[top].v > 0 ? `<text class="ax" x="${x(top)}" y="${y(up(pts[top])) - 5}" text-anchor="middle" style="fill:var(--ink);font-weight:700">${dShort(pts[top].v)}</text>` : ''}
    ${spec.cum ? `<path d="${cum.map((v, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ',' + yc(v).toFixed(1)).join('')}" fill="none" style="stroke:var(--accent)" stroke-width="2.2" stroke-linejoin="round"/>
      <circle cx="${x(cum.length - 1)}" cy="${yc(cum[cum.length - 1])}" r="3.5" style="fill:var(--accent);stroke:var(--card)" stroke-width="2"/>` : ''}
    ${pts.map((p, i) => i % every ? '' : `<text class="ax" x="${x(i)}" y="${H - 6}" text-anchor="middle">${esc(p.l)}</text>`).join('')}
  </svg><div class="tip" style="display:none;white-space:normal;text-align:left;min-width:150px"></div>`;
  const svg = box.querySelector('svg'), tip = box.querySelector('.tip'), hl = box.querySelector('.dhl');
  const at = ev => {
    const r = svg.getBoundingClientRect(), px = (ev.clientX - r.left) * W / r.width;
    const i = Math.min(pts.length - 1, Math.max(0, Math.floor((px - L) / slot)));
    hl.style.display = ''; hl.setAttribute('x', L + i * slot);
    tip.style.display = ''; tip.innerHTML = pts[i].tip + (pts[i].parts ? pts[i].parts.map(q => `<br><i style="display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:5px;background:${q.c}"></i>${esc(q.name)} ${dNetTxt(q.v)}`).join('') : '') + (spec.cum ? `<br><span style="opacity:.8">Running total ${dNetTxt(cum[i])}</span>` : '');
    const half = tip.offsetWidth / 2 + 4;
    tip.style.left = Math.min(Math.max(x(i) / W * r.width, half), r.width - half) + 'px';
  };
  svg.addEventListener('pointerdown', at);
  svg.addEventListener('pointermove', at);
  svg.addEventListener('pointerleave', ev => { if (ev.pointerType === 'mouse') { tip.style.display = 'none'; hl.style.display = 'none'; } });
}

function dSummary(title, net, tiles, note = '', o = {}) {
  const pay = Math.abs(o.pay || 0), rec = Math.abs(o.rec || 0), split = pay + rec;
  return `<div class="dhero">
    <div class="t">${esc(title)}</div>
    <div class="lbl2">Net deviation charges</div>
    <div class="v num">${net === null ? '—' : dRup(net)}${net ? `<span class="dpill ${net > 0 ? 'p' : 'r'}">${net > 0 ? 'Payable' : 'Receivable'}</span>` : ''}</div>
    ${split ? `<div class="dsplit"><i style="flex:${pay}"></i><i style="flex:${rec}"></i></div>
      <div class="dsplit-k num"><span><i class="p"></i>Payable ${dShort(pay)} · ${fmt(pay / split * 100, 0)}%</span><span><i class="r"></i>Receivable ${dShort(rec)} · ${fmt(rec / split * 100, 0)}%</span></div>` : ''}
    <div class="dkpis">${tiles.map(([l, v, sub]) => `<div class="dkpi"><span>${esc(l)}</span><b class="num">${v}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</div>`).join('')}</div>
    ${o.cover ? `<div class="dprog"><i style="width:${Math.min(100, o.cover[0] / Math.max(1, o.cover[1]) * 100)}%"></i></div><div class="dsub">${o.cover[0]} of ${o.cover[1]} published weeks downloaded</div>` : ''}
    ${note ? `<div class="dsub">${note}</div>` : ''}</div>`;
}

/** Station rows, ranked, with a two-sided bar: receivable to the left of the centre line, payable to the right. */
function dStationRows(list, solar, max = Math.max(1, ...list.map(s => solar ? Math.abs(s.sum.net) : Math.max(Math.abs(s.sum.pay), Math.abs(s.sum.rec))))) {
  if (!list.length) return '<div class="empty">Nothing downloaded for this selection yet.</div>';
  return list.map((s, i) => `<div class="srow drow" data-dact="station" data-darg="${esc(s.key)}">
    <div class="top"><span class="drank">${i + 1}</span><span class="nm">${esc(s.name)}</span><span class="vals num"><b>${dNet(s.sum.net)}</b></span></div>
    <div class="vals num">${solar ? `Scheduled ${dQty(s.sum.sch)} · Injected ${dQty(s.sum.act)}` : `Payable ${dShort(s.sum.pay)} · Receivable ${dShort(Math.abs(s.sum.rec))}`}</div>
    ${solar ? `<div class="bar"><div class="f" style="width:${Math.abs(s.sum.net) / max * 100}%;background:linear-gradient(90deg,#f59e0b,var(--neg))"></div></div>`
      : `<div class="dbi"><div class="l"><i style="width:${Math.abs(s.sum.rec) / max * 100}%"></i></div><div class="c"></div><div class="r"><i style="width:${Math.abs(s.sum.pay) / max * 100}%"></i></div></div>`}</div>`).join('')
    + (solar ? '' : '<div class="keyline"><span><i style="width:12px;height:8px;border-radius:3px;background:var(--pos)"></i>Receivable (left)</span><span><i style="width:12px;height:8px;border-radius:3px;background:var(--neg)"></i>Payable (right)</span></div>');
}

/** Share of the FY's payable charges by station (thermal, gas and hydro), as a donut. */
function dPayDonut(list) {
  const rows = list.filter(s => s.sum.pay > 0).sort((a, b) => b.sum.pay - a.sum.pay);
  if (rows.length < 2 || typeof oDonut !== 'function') return '';
  const items = rows.slice(0, 6).map((s, i) => ({label: s.name, value: s.sum.pay, colour: `var(--k${i + 1})`, act: '', arg: ''}))
    .concat(rows.length > 6 ? [{label: 'Others', value: rows.slice(6).reduce((t, s) => t + s.sum.pay, 0), colour: 'var(--off)'}] : []);
  const total = rows.reduce((t, s) => t + s.sum.pay, 0);
  const r = 40, c = 2 * Math.PI * r;
  let at = 0;
  const arcs = items.map(x => { const len = x.value / total * c, dash = Math.max(0.6, len - 1.4);
    const el = `<circle cx="50" cy="50" r="${r}" fill="none" stroke-width="16" style="stroke:${x.colour}" stroke-dasharray="${dash.toFixed(2)} ${(c - dash).toFixed(2)}" stroke-dashoffset="${(-at).toFixed(2)}" transform="rotate(-90 50 50)"
      data-tip="${esc(`<b>${esc(x.label)}</b><br>${dShort(x.value)} · ${fmt(x.value / total * 100, 1)}%`)}"/>`; at += len; return el; }).join('');
  return `<div class="card"><h2>Who pays the most ${conMoreD('share of gross DSM payable')}</h2>
    <div class="chart" style="display:grid;grid-template-columns:132px 1fr;gap:12px;align-items:center"><svg viewBox="0 0 100 100" width="132" height="132" role="img" aria-label="Share of DSM payable by station">
      <circle cx="50" cy="50" r="${r}" fill="none" stroke-width="16" style="stroke:var(--soft)"/>${arcs}
      <text x="50" y="49" text-anchor="middle" style="fill:var(--ink);font-size:11px;font-weight:700">${esc(dShort(total))}</text><text x="50" y="60" text-anchor="middle" style="fill:var(--muted);font-size:7.5px">gross payable</text></svg>
      <div>${items.map(x => `<div style="display:flex;justify-content:space-between;gap:6px;font-size:12px;padding:2px 0"><span><i style="display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:5px;background:${x.colour}"></i>${esc(x.label)}</span><b class="num">${fmt(x.value / total * 100, 0)}%</b></div>`).join('')}</div>
      <div class="tip" style="display:none;white-space:normal;min-width:120px"></div></div>
    ${csvBtn('dsmShare', `DSM_payable_share_FY_${D.fy}`, ['Station', 'Payable Rs', 'Share %'], rows.map(s => [s.name, Math.round(s.sum.pay), +(s.sum.pay / total * 100).toFixed(2)]))}</div>`;
}
const conMoreD = t => `<span class="more muted" style="font-weight:500;font-size:11.5px">${esc(t)}</span>`;

/** Station × week heat map of net charges (red payable, green receivable; stronger = larger). */
function dHeat(kind) {
  const weeks = D.data.latest, rows = dPick(true, kind, '');
  if (!rows.length || weeks.length < 2) return '';
  const byKey = new Map();
  for (const r of rows) { const m = byKey.get(r.key) || byKey.set(r.key, {name: r.name, w: new Map(), net: 0}).get(r.key); m.w.set(r.n, (m.w.get(r.n) || 0) + (r.net || 0)); m.net += r.net || 0; }
  const list = [...byKey.values()].sort((a, b) => b.net - a.net);
  const max = Math.max(1, ...list.flatMap(m => [...m.w.values()].map(Math.abs)));
  const VW = 340, L = 78, R = 4, RH = 15, T = 4, B = 16, cw = (VW - L - R) / weeks.length, H = T + list.length * RH + B;
  const every = Math.max(1, Math.ceil(weeks.length / 8));
  const cells = list.map((m, i) => weeks.map((n, j) => {
    const v = m.w.get(n.id);
    if (v === undefined) return '';
    const a = Math.min(1, 0.15 + Math.abs(v) / max * 0.85);
    return `<rect x="${(L + j * cw).toFixed(1)}" y="${T + i * RH + 1}" width="${Math.max(1, cw - 1).toFixed(1)}" height="${RH - 2}" rx="1.5" style="fill:var(${v >= 0 ? '--neg' : '--pos'});fill-opacity:${a.toFixed(2)}"
      data-tip="${esc(`<b>${esc(m.name)}</b> · Week ${n.week}<br>${dDay(n.from)} – ${dDay(n.to)}<br>${dNetTxt(v)}`)}"/>`;
  }).join('')).join('');
  return `<div class="card"><h2>Week-wise heat map ${conMoreD('touch a cell')}</h2><div class="chart"><svg viewBox="0 0 ${VW} ${H}" role="img" aria-label="Net DSM by station and week">
    ${list.map((m, i) => `<text class="ax" x="${L - 5}" y="${T + i * RH + 11}" text-anchor="end" style="fill:var(--ink)">${esc(m.name.length > 13 ? m.name.slice(0, 12) + '…' : m.name)}</text>`).join('')}
    ${cells}
    ${weeks.map((n, j) => j % every ? '' : `<text class="ax" x="${L + (j + 0.5) * cw}" y="${H - 4}" text-anchor="middle">W${n.week}</text>`).join('')}
  </svg><div class="tip" style="display:none;white-space:normal;text-align:left;min-width:150px"></div></div>
  <div class="keyline"><span><i style="width:12px;height:8px;border-radius:2px;background:var(--neg)"></i>Payable</span><span><i style="width:12px;height:8px;border-radius:2px;background:var(--pos)"></i>Receivable</span><span>Stronger colour = larger amount</span></div>
  ${csvBtn('dsmHeat' + kind, `DSM_station_week_FY_${D.fy}`, ['Station'].concat(weeks.map(n => 'W' + n.week)), list.map(m => [m.name].concat(weeks.map(n => m.w.has(n.id) ? Math.round(m.w.get(n.id)) : null))))}</div>`;
}

const dBack = label => `<div class="chips"><button class="chip" data-dact="back">‹ ${esc(label)}</button></div>`;
const dBtn = (label, act, arg = '', primary = false) => `<button class="btn" data-dact="${act}" data-darg="${esc(arg)}" style="${primary ? 'background:var(--accent);color:#fff;border-color:var(--accent)' : 'color:var(--accent)'}">${esc(label)}</button>`;
const dNoData = () => `<div class="card"><div class="empty">No week of FY ${esc(D.fy)} is downloaded yet.<br>Open <b>Weeks</b> and tap a week, or use “Download remaining” under <b>FY</b>.</div></div>`;

// ---------------------------------------------------------------- self-check (Dsm.health / healthAll)

/** Read once per load: the check walks every stored row of the year. */
function dHealth(fy) {
  D.health = D.health || {};
  if (!(fy in D.health)) { try { D.health[fy] = typeof Dsm.health === 'function' ? JSON.parse(Dsm.health(fy)) : null; } catch (e) { D.health[fy] = null; } }
  return D.health[fy];
}

function dHealthCard() {
  const h = dHealth(D.fy);
  if (!h || !h.fy) return '';
  const line = (icon, colour, text, extra = '') => `<div class="nrow" style="cursor:default"><span class="sd" style="background:${colour}"></span><div class="nb"><b>${icon} ${text}</b>${extra ? `<div class="nt">${extra}</div>` : ''}</div></div>`;
  let body = line(h.parsed === h.weeks ? '✓' : '⟳', h.parsed === h.weeks ? 'var(--run)' : 'var(--planned)', `${h.parsed} of ${h.weeks} weeks downloaded and read`,
    h.pending.length ? `Waiting: week ${h.pending.slice(0, 12).join(', ')}${h.pending.length > 12 ? '…' : ''}. They download automatically in the background (every few hours, with a connection), or now with “Fill history now”.` : '');
  if (h.gaps.length) body += line('ℹ', 'var(--off)', `Week ${h.gaps.join(', ')} not published by SLDC (yet)`, 'Not listed on the SLDC page, so nothing to download.');
  for (const f of h.failed) body += line('✗', 'var(--forced)', `Week ${f.week} REV-${f.rev} could not be read`, `${esc(f.error)}${f.gaveUp ? ' · automatic retries used up' : ` · retry ${f.attempts} of 3`} · <a data-dact="retry" data-darg="${f.id}" style="color:var(--accent)">Retry now</a>`);
  for (const i of h.issues.slice(0, 8)) body += line('⚠', 'var(--planned)', `Week ${i.week} REV-${i.rev}: ${esc(i.msg)}`, `<a data-dact="week" data-darg="${i.id}" style="color:var(--accent)">Open week</a>`);
  if (h.issues.length > 8) body += `<div class="note-src">${h.issues.length - 8} more checks need attention.</div>`;
  const all = D.allHealth;
  return `<div class="card"><h2>Data check · FY ${esc(h.fy)} ${h.ok ? '<span class="badge b-Running" style="margin-left:auto">All good</span>' : '<span class="badge b-Planned" style="margin-left:auto">Attention</span>'}</h2>${body}
    <div style="margin-top:10px">${dBtn('Fill history now', 'fill', '', true)} ${dBtn(all ? 'Hide all years' : 'All financial years', 'allh')}</div>
    ${all ? `<table class="dt num" style="margin-top:10px"><tr><th>FY</th><th>Weeks</th><th>Read</th><th>Waiting</th><th>Failed</th><th>Checks</th></tr>
      ${all.map(y => `<tr data-dact="fy" data-darg="${esc(y.fy)}" style="cursor:pointer"><td>${esc(y.fy)}</td><td>${y.weeks}</td><td>${y.parsed}</td><td>${y.pending.length || '—'}</td><td>${y.failed.length ? `<span class="neg">${y.failed.length}</span>` : '—'}</td><td>${y.ok ? '<span class="pos">✓</span>' : y.issues.length ? `<span class="neg">${y.issues.length}</span>` : '…'}</td></tr>`).join('')}</table>
      <div class="note-src">Every financial year SLDC lists is filled in automatically, newest first. Reports older than last year are read and then removed from the phone to save space; their figures stay.</div>` : ''}
    <div class="note-src">Checked on this phone: missing or failed weeks, weeks with no GSECL station, and day-wise figures that do not add up to the weekly total.</div></div>`;
}

// ---------------------------------------------------------------- tabs

function dTabFy() {
  const d = D.data, all = dSum(dPick(true, null, '')), conv = dSum(dPick(true, 0, '')), re = dSum(dPick(true, 1, ''));
  const weeks = new Set(d.notices.map(n => n.week)).size, pending = d.notices.filter(n => n.status !== 1).length;
  const checked = d.lastCheck ? new Date(d.lastCheck).toLocaleString('en-IN', {day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'}) : 'never';
  const wk = dByWeek(), avgW = wk.length ? all.net / wk.length : 0, worst = wk.reduce((a, b) => (!a || b[1].net > a[1].net ? b : a), null);
  let h = dSummary(`FY ${d.fy} · GSECL`, d.latest.length ? all.net : null, [
    ['Thermal / gas / hydro', dNet(conv.net)], ['Solar', dNet(re.net)],
    ['Average per week', dNet(avgW)], ['Highest week', worst ? 'W' + worst[0].week : '—', worst ? dNetTxt(worst[1].net) : ''],
  ], `SLDC site checked ${esc(checked)}, and automatically once a day`, {pay: all.pay, rec: all.rec, cover: [d.latest.length, weeks]});
  if (d.latest.length) {
    h += dChart('Weekly trend · net DSM', dWeekPts(wk));
    h += dChart('Monthly trend · net DSM', dMonthPts(dByMonth()));
    h += dPayDonut(dByStation(0));
    h += `<div class="card"><h2>Station-wise FY total <span class="more" data-dact="tab" data-darg="stations">Details ›</span></h2>${dStationRows(dByStation(0), false)}
      <div class="srow" data-dact="tab" data-darg="solar"><div class="top"><span class="nm">All solar plants</span><span class="vals num"><b>${dNet(re.net)}</b></span></div><div class="vals">See the Solar tab for plant-wise figures</div></div></div>`;
  }
  h += dHealthCard();
  h += `<div class="card"><h2>DSM data</h2>
    <p class="muted" style="font-size:12.5px;margin:0">Each SLDC report is downloaded once, read on this phone and kept; it is not fetched again. A new revision (REV) is picked up by the daily check and compared with the earlier one.</p>
    ${dBtn('Check SLDC site now', 'check', '', true)} ${pending ? dBtn(`Download remaining ${pending} of FY ${d.fy}`, 'all') : ''} ${dBtn('Re-read stored reports', 'reread')}
    <details style="margin-top:14px"><summary>GSECL stations</summary>
      <p class="muted" style="font-size:12.5px">One name per line, exactly as printed in the SLDC report. Solar plants whose name starts with GSECL are always included.</p>
      <textarea id="dsmStations" class="search" rows="9" style="font-family:monospace">${esc(hasDsm() ? Dsm.stations() : '')}</textarea>
      ${dBtn('Save list', 'savest', '', true)} ${dBtn('Reset to default', 'resetst')}
    </details></div>`;
  return h;
}

function dTabWeeks() {
  const d = D.data;
  if (!d.notices.length) return '<div class="card"><div class="empty">SLDC has no account listed for this year.</div></div>';
  const lat = d.notices.filter(n => n.latest), f = D.wf || '';
  const cnt = {pay: lat.filter(n => (n.net || 0) > 0).length, rec: lat.filter(n => (n.net || 0) < 0).length, rev: d.notices.filter(n => n.rev > 0).length, todo: d.notices.filter(n => n.status !== 1).length};
  const keep = n => !f || (f === 'pay' && n.latest && (n.net || 0) > 0) || (f === 'rec' && n.latest && (n.net || 0) < 0) || (f === 'rev' && n.rev > 0) || (f === 'todo' && n.status !== 1);
  return `<div class="card"><div class="tstats" style="grid-template-columns:repeat(4,1fr);margin:0">
      <div><span>Weeks</span><b class="num">${new Set(d.notices.map(n => n.week)).size}</b><small>${lat.length} downloaded</small></div>
      <div><span>Payable</span><b class="num neg">${cnt.pay}</b><small>weeks</small></div>
      <div><span>Receivable</span><b class="num pos">${cnt.rec}</b><small>weeks</small></div>
      <div><span>Revisions</span><b class="num">${cnt.rev}</b><small>REV-1 and later</small></div></div>
    <div class="chips" style="padding:10px 0 0">${[['', 'All'], ['pay', 'Payable'], ['rec', 'Receivable'], ['rev', 'Revised'], ['todo', 'Not downloaded']].map(([k, l]) => `<button class="chip ${f === k ? 'on' : ''}" data-dact="wf" data-darg="${k}" style="padding:5px 12px">${l}</button>`).join('')}</div></div>`
    + [...d.notices].filter(keep).sort((a, b) => b.week - a.week || b.rev - a.rev).map(n => {
    const stored = n.status === 1, prev = d.notices.filter(o => o.week === n.week && o.rev < n.rev && o.net !== null).sort((a, b) => b.rev - a.rev)[0];
    const colour = stored ? (n.latest ? 'var(--run)' : 'var(--off)') : n.status === 2 ? 'var(--forced)' : 'var(--line)';
    return `<div class="oq" style="--oc:${colour}" data-dact="${stored ? 'week' : 'get'}" data-darg="${n.id}">
      <div class="oq-h"><span class="nm">Week ${n.week}</span><span class="badge ${n.rev > 0 ? 'b-RSD' : 'b-Outage'}">REV-${n.rev}</span>
        <span class="cap num">${stored ? dNet(n.net || 0) : `<small>${n.status === 2 ? 'Failed · tap to retry' : 'Tap to download'}</small>`}</span></div>
      <div class="meta num"><div><span>Period</span>${dDay(n.from)} – ${dDate(n.to)}</div><div><span>Payment due</span>${dDate(n.due)}</div></div>
      ${stored && prev ? `<div class="rs">Change from REV-${prev.rev}: <b>${dDelta((n.net || 0) - prev.net)}</b></div>` : ''}
      ${stored && !n.latest ? '<div class="live">Superseded by a later revision</div>' : ''}
      ${n.status === 2 ? `<div class="live">${esc(n.error)}</div>` : ''}</div>`;
  }).join('');
}

function dTabStations() {
  if (!D.data.latest.length) return dNoData();
  const t = dSum(dPick(true, 0, '')), list = dByStation(0);
  return dSummary(`FY ${D.fy} · thermal, gas and hydro`, t.net, [['DSM payable', dRup(t.pay)], ['DSM receivable', dRup(Math.abs(t.rec))], ['Stations', list.length], ['Weeks', D.data.latest.length]], '', {pay: t.pay, rec: t.rec})
    + dChart('Weekly trend · net DSM', dWeekPts(dByWeek(0)))
    + dHeat(0)
    + `<div class="card"><h2>Stations <span class="more muted" style="font-weight:500;font-size:11.5px">tap for individual report</span></h2>${dStationRows(list, false)}</div>`;
}

function dTabMonthly() {
  if (!D.data.latest.length) return dNoData();
  const months = dByMonth(), conv = new Map(dByMonth(0)), re = new Map(dByMonth(1));
  const pts = months.map(([m, s]) => ({l: DSM_MONTHS[+m.slice(5, 7) - 1], v: s.net, tip: `<b>${dMonth(m)}</b> · ${dNetTxt(s.net)}`,
    parts: [{v: conv.get(m)?.net || 0, c: 'var(--accent)', name: 'Thermal / gas / hydro'}, {v: re.get(m)?.net || 0, c: '#f59e0b', name: 'Solar'}]}));
  return dChart(`FY ${D.fy} · monthly net DSM`, pts, '', {stack: [['Thermal / gas / hydro', 'var(--accent)'], ['Solar', '#f59e0b']]})
    + `<div class="card"><h2>Month-wise <span class="more muted" style="font-weight:500;font-size:11.5px">tap for station-wise report</span></h2>`
    + [...months].reverse().map(([m, s]) => `<div class="srow" data-dact="month" data-darg="${m}">
        <div class="top"><span class="nm">${dMonth(m)}</span><span class="vals num"><b>${dNet(s.net)}</b></span></div>
        <div class="vals num">Stations ${dNetTxt(conv.get(m)?.net || 0)} · Solar ${dNetTxt(re.get(m)?.net || 0)}</div></div>`).join('')
    + `<div class="note-src">Months are built from the day-wise figures, so a week that spans two months is split correctly. Only downloaded weeks are counted.</div></div>`;
}

function dTabSolar() {
  if (!D.data.latest.length) return dNoData();
  const t = dSum(dPick(true, 1, '')), list = dByStation(1);
  return dSummary(`FY ${D.fy} · GSECL solar plants`, t.net, [['Plants', list.length], ['Weeks', D.data.latest.length], ['Scheduled', dQty(t.sch)], ['Injected', dQty(t.act)]],
      'Solar deviation charges are always payable; the SLDC statement has no receivable column for them.')
    + dChart('Weekly trend · solar charges', dWeekPts(dByWeek(1)))
    + dChart('Monthly trend · solar charges', dMonthPts(dByMonth(1)))
    + dHeat(1)
    + `<div class="card"><h2>Plant-wise FY total <span class="more muted" style="font-weight:500;font-size:11.5px">tap for individual report</span></h2>${dStationRows(list, true)}</div>`;
}

// ---------------------------------------------------------------- estimate from live data (GSECL Connect service)

/**
 * DSM estimate for the last days, before SLDC publishes the account: the service works it out from the SLDC
 * generation and schedule the app sends every 10 minutes, block by block, at the block's IEX market price
 * (CERC DSM Regulations 2024 link the deviation rate to the market price). Not the official account.
 */
/** "SLDC schedule Rev 107 · read 24 Oct 23:40" for a day's estimate (latest revision SLDC had when read). */
const dRev = v => v && v.v ? `SLDC schedule Rev ${v.v} · read ${new Date(v.at).toLocaleString('en-IN', {day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false})}` : '';

async function dEstLoad(force) {
  if (D.estBusy || (!force && D.est && Date.now() - D.estAt < 10 * 60e3) || typeof conCall !== 'function' || !hasConnect()) return;
  D.estBusy = true; D.estErr = ''; dsmRender();
  const r = await conCall('dsm_estimate', {days: 7});
  D.estBusy = false;
  if (r.ok) { const keep = D.est ? D.est.days.filter(d => !r.data.days.some(x => x.date === d.date)) : []; D.est = r.data; D.est.days = r.data.days.concat(keep).sort((a, b) => (a.date < b.date ? 1 : -1)); D.estAt = Date.now(); if (!D.estDay && r.data.days.length) D.estDay = r.data.days[0].date; } else D.estErr = r.error;
  if (D.tab === 'est') dsmRender();
}

function dTabEst() {
  if (typeof hasConnect !== 'function' || !hasConnect()) return '<div class="card"><div class="empty">Sign in to GSECL Connect to see the estimate.</div></div>';
  if (!D.est) { setTimeout(() => dEstLoad(false), 0); return D.estErr ? `<div class="alert err"><span>⚠</span><span>${esc(D.estErr)}</span></div>` : '<div class="card"><div class="sk" style="height:160px"></div></div>'; }
  const days = D.est.days;
  if (!days.length) return `<div class="card"><h2>DSM estimate</h2><div class="empty">No live readings stored yet. The app sends SLDC generation and schedule every 10 minutes while it is open (and from phones with background monitoring); the estimate appears after the first day.</div>${dBtn('Refresh', 'estref')}</div>`;
  const day = days.find(d => d.date === D.estDay) || days[0];
  const pts = [...days].reverse().map(d => ({l: dDay(d.date), v: d.priced ? d.net : 0, tip: `<b>${dDate(d.date)}</b> · ${d.priced ? dNetTxt(d.net) : 'not priced'} · ${fmt(d.under, 0)} MWh under, ${fmt(d.over, 0)} MWh over`}));
  const totNet = days.reduce((t, d) => t + (d.priced ? d.net : 0), 0);
  const list = [...day.stations].sort((a, b) => b.net - a.net), max = Math.max(1, ...list.map(x => Math.max(x.pay, x.rec)));
  return dSummary(`DSM estimate · ${dDate(day.date)}`, day.priced ? day.net : null, [
      ['Under-injection', fmt(day.under, 1) + ' MWh', 'charged'], ['Over-injection', fmt(day.over, 1) + ' MWh', 'paid'],
      ['Blocks with data', day.blocks + ' / 96', day.priced + ' priced'], ['Frequency', day.freqMin ? fmt(day.freqMin, 2) + '–' + fmt(day.freqMax, 2) + ' Hz' : '—', day.freqLow !== null && day.freqLow !== undefined ? Math.round(day.freqLow * 100) + '% below 49.90' : '']],
      `${day.sldc_ver ? dRev(day.sldc_ver) + ' (latest; re-read after midnight)' : 'SLDC schedule revision: not read yet'} · last ${days.length} day(s): ${dNetTxt(totNet)} (estimate)`, {pay: day.pay, rec: day.rec})
    + `<div class="chips">${days.map(d => `<button class="chip ${d.date === day.date ? 'on' : ''}" data-dact="estday" data-darg="${d.date}">${dDay(d.date)}${d.sldc_ver && d.sldc_ver.v ? ` <small style="opacity:.75">R${d.sldc_ver.v}</small>` : ''}</button>`).join('')}<label class="chip" style="display:inline-flex;align-items:center;gap:6px;cursor:pointer">📅<input type="date" id="estDatePick" value="${esc(day.date)}" max="${esc(new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10))}" style="border:0;background:transparent;font:inherit;color:inherit;width:8.2em"></label></div>
      ${D.estPickBusy ? '<div class="note-src">Working out the chosen day…</div>' : ''}${D.estPickErr ? `<div class="alert err" style="margin:6px 0"><span>⚠</span><span>${esc(D.estPickErr)}</span></div>` : ''}${day.stored ? '<div class="note-src">From the stored daily DSM by group (the block readings of this day are no longer kept, so no block detail or frequency).</div>' : ''}`
    + dChart('Estimated net DSM by day (CERC DSM Regulations 2024)', pts, 'estimate', {cum: false})
    + (D.estGroup ? dEstBlocksHtml(day) : '')
    + `<div class="card"><h2>PPA groups · ${dDate(day.date)} <span class="more" data-dact="estref" style="cursor:pointer">Refresh</span></h2>${list.map((x, i) => `<div class="srow drow" data-dact="estgrp" data-darg="${esc(x.name)}" style="cursor:pointer">
        <div class="top"><span class="drank">${i + 1}</span><span class="nm">${esc(x.name)}</span><span class="vals num"><b>${day.priced ? dNet(x.net) : fmt(x.under - x.over, 1) + ' MWh'}</b></span></div>
        <div class="vals num">Under ${fmt(x.under, 1)} MWh · over ${fmt(x.over, 1)} MWh · ${x.blocks} blocks${x.rr ? ' · RR ₹' + fmt(x.rr, 2) + '/kWh' : ''} · <span style="color:var(--accent)">block detail ›</span></div>
        <div class="dbi"><div class="l"><i style="width:${x.rec / max * 100}%"></i></div><div class="c"></div><div class="r"><i style="width:${x.pay / max * 100}%"></i></div></div></div>`).join('')}
      ${day.no_schedule && day.no_schedule.length ? `<div class="note-src">Not estimated (no schedule in the SLDC real-time data): ${esc(day.no_schedule.join(', '))}.</div>` : ''}
      ${csvBtn('dsmEst', 'DSM_estimate_' + day.date, ['Station', 'Under-injection MWh', 'Over-injection MWh', 'Est. payable Rs', 'Est. receivable Rs', 'Est. net Rs', 'Blocks'], list.map(x => [x.name, +x.under.toFixed(2), +x.over.toFixed(2), Math.round(x.pay), Math.round(x.rec), Math.round(x.net), x.blocks]))}</div>
    <div class="card"><h2>How the estimate is made</h2><div class="vals" style="font-size:12.5px">CERC (Deviation Settlement Mechanism and Related Matters) Regulations, 2024 - Regulation 8(1) for a general seller, as notified (amendments of 2024, 2025 and 2026 do not change it), and 8(12) for forced outages. In each 15-minute block: deviation = actual injection − schedule (SLDC). Up to [10% of the schedule or 100 MW, whichever is less]: at RR when 49.97–50.03 Hz; over-injection −25% of RR per 0.01 Hz above 50.03 (50% at 50.05) and +2.15% per 0.01 Hz below 49.97 (115% at 49.90), zero at 50.05–50.10 Hz, seller pays 10% at 50.10 Hz and above, 115% below 49.90 Hz; under-injection −7.5% per 0.01 Hz above 50.03 (85% at 50.05), +7.15% per 0.01 Hz below 49.97 (150% at 49.90), 85% above 50.05 Hz, 150% below 49.90 Hz. Beyond the limit: over-injection zero (seller pays 10% at 50.10 Hz and above); under-injection at RR (f ≥ 50.00), 150% (49.90–50.00) or 200% (below 49.90). After a forced outage: RR for up to 8 blocks or until the schedule is revised. A unit shut down (zero schedule, no generation: reserve shutdown or outage) draws its auxiliaries from the grid: that drawal is charged at RR (Reg 8(9)); it is taken from AppSettings DSM_SHUTDOWN_AUX, else 0.5 % of the installed capacity. RR = energy charge rate of the PPA (SLDC merit order). Actual = SLDC real-time generation of the block; frequency = average of the readings in the block. Hydro is not included. A guide only: the SLDC account uses interface meter data and is final.</div></div>`;
}

/** A day chosen in the calendar: worked out by the service (block readings, else the stored daily DSM). */
async function dEstPickDay(iso) {
  if (!iso || !D.est) return;
  if (D.est.days.some(d => d.date === iso)) { D.estDay = iso; D.estGroup = null; return dsmRender(); }
  D.estPickBusy = true; D.estPickErr = ''; dsmRender();
  const r = await conCall('dsm_estimate', {date: iso});
  D.estPickBusy = false;
  if (r.ok && r.data.days.length) { D.est.days = D.est.days.filter(d => d.date !== iso).concat(r.data.days).sort((a, b) => (a.date < b.date ? 1 : -1)); D.estDay = iso; D.estGroup = null; }
  else D.estPickErr = r.ok ? 'No DSM figures for ' + dDate(iso) + ' (no readings were kept for that day).' : r.error;
  dsmRender();
}
document.addEventListener('change', e => { if (e.target && e.target.id === 'estDatePick') dEstPickDay(e.target.value); });

/** Block-wise working of one PPA group for the chosen day (dsm_blocks). */
async function dEstBlocks(group) {
  D.estGroup = group; D.estBlk = null; D.estBlkErr = ''; dsmRender();
  const r = await conCall('dsm_blocks', {date: D.estDay || (D.est?.days[0] || {}).date, group});
  if (r.ok) D.estBlk = r.data; else D.estBlkErr = r.error;
  dsmRender();
  setTimeout(() => { const el = document.getElementById('estBlk'); if (el) el.scrollIntoView({behavior: 'smooth', block: 'start'}); }, 60);
}
function dEstBlocksHtml(day) {
  const x = D.estBlk, rs = v => v === null || v === undefined ? '—' : (v < 0 ? '−' : '') + '₹' + fmt(Math.abs(v), 0);
  const head = `<h2>${esc(D.estGroup)} · ${dDate(day.date)} <span class="more" data-dact="estgrpx" style="cursor:pointer">Close</span></h2>${day.sldc_ver ? `<div class="vals" style="margin:-4px 0 8px">${esc(dRev(day.sldc_ver))}</div>` : ''}`;
  if (!x) return `<div class="card" id="estBlk">${head}${D.estBlkErr ? `<div class="alert err">${esc(D.estBlkErr)}</div>` : '<div class="sk" style="height:140px"></div>'}</div>`;
  const rows = x.detail || [];
  return `<div class="card" id="estBlk">${head}
    <div class="tstats" style="grid-template-columns:repeat(4,1fr)"><div><span>Net</span><b class="num">${dNet(x.net)}</b></div><div><span>Under / over</span><b class="num">${fmt(x.under, 2)} / ${fmt(x.over, 2)}</b><small>MWh</small></div>
      <div><span>Blocks</span><b class="num">${x.blocks}</b><small>of 96 with readings</small></div><div><span>RR</span><b class="num">${x.rr ? '₹' + fmt(x.rr, 2) : '—'}</b><small>per kWh</small></div></div>
    <div style="overflow-x:auto"><table class="gt num" style="font-size:11.5px"><tr><th>Block</th><th>Hz</th><th>SG</th><th>Actual</th><th>Dev MW</th><th>Dev %</th><th>Limit MWh</th><th>Within / beyond</th><th>Rate % RR</th><th>₹ (+ rec / − pay)</th></tr>
      ${rows.map(b => `<tr title="${esc(b.band1 + (b.beyond_mwh ? ' | ' + b.band2 : ''))}"><td>${b.block} <small class="muted">${b.time}</small></td><td>${fmt(b.f, 2)}</td><td>${fmt(b.sg, 1)}</td><td>${fmt(b.actual, 1)}</td>
        <td class="${b.dev_mw > 0 ? 'pos' : b.dev_mw < 0 ? 'neg' : ''}">${fmt(b.dev_mw, 1)}</td><td>${b.dev_pct === null ? '—' : fmt(b.dev_pct, 1)}</td><td>${fmt(b.limit_mwh, 2)}</td>
        <td>${fmt(b.within_mwh, 2)} / ${fmt(b.beyond_mwh, 2)}</td><td>${fmt(b.rate1_pct, 2)}${b.beyond_mwh ? ' / ' + fmt(b.rate2_pct, 0) : ''}</td><td class="${b.amount_rs > 0 ? 'pos' : b.amount_rs < 0 ? 'neg' : ''}"><b>${rs(b.amount_rs)}</b></td></tr>`).join('')}</table></div>
    <div class="note-src">MW are block averages of the readings (SG = SLDC schedule ex-bus, Actual = SLDC real-time generation). Limit = 10% of the block's scheduled energy or 25 MWh (100 MW × 15 min), whichever is less. Touch and hold a row for its frequency band.</div>
    ${csvBtn('dsmBlk', 'DSM_blocks_' + D.estGroup.replace(/\W+/g, '_') + '_' + day.date, ['Block', 'Time', 'Frequency Hz', 'Readings', 'SG MW', 'Actual MW', 'Actual source', 'DC MW', 'Deviation MW', 'Deviation MWh', 'Deviation %', 'Limit MWh', 'Within MWh', 'Beyond MWh', 'Rate within % RR', 'Band within', 'Rate beyond % RR', 'Band beyond', 'RR Rs/kWh', 'Amount Rs (+receivable / -payable)'],
      rows.map(b => [b.block, b.time, b.f, b.f_samples, b.sg, b.actual, b.actual_src, b.dc, b.dev_mw, b.dev_mwh, b.dev_pct, b.limit_mwh, b.within_mwh, b.beyond_mwh, b.rate1_pct, b.band1, b.rate2_pct, b.band2, b.rr, b.amount_rs]))}</div>`;
}

// ---------------------------------------------------------------- detail pages

function dDetailStation(key) {
  const solar = key.startsWith('1:'), kind = solar ? 1 : 0, rows = dPick(true, kind, key);
  const name = rows.length ? rows[rows.length - 1].name : key, t = dSum(rows), weeks = dByWeek(kind, key), months = dByMonth(kind, key);
  const top = weeks.reduce((a, b) => (!a || b[1].net > a[1].net ? b : a), null);
  const tiles = (solar ? [] : [['DSM payable', dRup(t.pay)], ['DSM receivable', dRup(t.rec)]]).concat([
    ['Scheduled', dQty(t.sch)], [solar ? 'Injected' : 'Injection / drawal', dQty(t.act)],
    ['Weeks in report', weeks.length], ['Highest week', top ? 'W' + top[0].week : '—', top ? dNetTxt(top[1].net) : '']]);
  return dBack(solar ? 'Solar' : 'Stations') + dSummary(`${name} · FY ${D.fy}`, t.net, tiles, '', solar ? {} : {pay: t.pay, rec: t.rec})
    + dChart('Weekly trend', dWeekPts(weeks)) + dChart('Monthly trend', dMonthPts(months))
    + `<div class="card"><h2>Monthly</h2><table class="dt num"><tr><th>Month</th>${solar ? '<th>Scheduled</th><th>Injected</th><th>Charges ₹</th>' : '<th>Payable ₹</th><th>Receivable ₹</th><th>Net ₹</th>'}</tr>
      ${months.map(([m, s]) => `<tr><td>${dMonth(m)}</td>${solar ? `<td>${dQty(s.sch)}</td><td>${dQty(s.act)}</td>` : `<td>${fmt(s.pay)}</td><td>${fmt(Math.abs(s.rec))}</td>`}<td>${fmt(s.net)}</td></tr>`).join('')}
      <tr class="hl"><td>Total</td>${solar ? `<td>${dQty(t.sch)}</td><td>${dQty(t.act)}</td>` : `<td>${fmt(months.reduce((a, m) => a + m[1].pay, 0))}</td><td>${fmt(Math.abs(months.reduce((a, m) => a + m[1].rec, 0)))}</td>`}<td>${fmt(months.reduce((a, m) => a + m[1].net, 0))}</td></tr></table></div>`
    + `<div class="card"><h2>Weekly <span class="more muted" style="font-weight:500;font-size:11.5px">tap to open the week</span></h2>${[...weeks].reverse().map(([n, s]) => `<div class="srow" data-dact="week" data-darg="${n.id}">
        <div class="top"><span class="nm">Week ${n.week} <span class="src-tag">REV-${n.rev}</span></span><span class="vals num"><b>${dNet(s.net)}</b></span></div>
        <div class="vals num">${dDay(n.from)} – ${dDate(n.to)} · Scheduled ${dQty(s.sch)} · Actual ${dQty(s.act)}</div></div>`).join('')}</div>`;
}

function dDetailMonth(m) {
  const days = D.data.rows.filter(r => !r.total && r.date.startsWith(m)), t = dSum(days), conv = dByStation(0, m), re = dByStation(1, m);
  const byDay = new Map();
  for (const r of days) byDay.set(r.date, (byDay.get(r.date) || 0) + (r.net || 0));
  const pts = [...byDay.keys()].sort().map(d => ({l: d.slice(8), v: byDay.get(d), tip: `<b>${dDate(d)}</b> · ${dNetTxt(byDay.get(d))}`}));
  return dBack('Monthly') + dSummary(`${dMonth(m)} · GSECL`, t.net, [['DSM payable', dRup(t.pay)], ['DSM receivable', dRup(Math.abs(t.rec))],
      ['Thermal / gas / hydro', dNet(conv.reduce((a, s) => a + s.sum.net, 0))], ['Solar', dNet(re.reduce((a, s) => a + s.sum.net, 0))]], `${byDay.size} day(s) covered by downloaded weeks`, {pay: t.pay, rec: t.rec})
    + dChart('Day-wise net DSM', pts)
    + `<div class="card"><h2>Stations</h2>${dStationRows(conv, false)}</div>`
    + (re.length ? `<div class="card"><h2>Solar plants</h2>${dStationRows(re, true)}</div>` : '');
}

function dDetailWeek(id) {
  if (!D.week || String(D.week.notice?.id) !== String(id)) {
    const j = JSON.parse(Dsm.week(String(id)));
    if (!j.notice) return dBack('Weeks') + '<div class="card"><div class="empty">This week is not stored on the phone.</div></div>';
    j.rows = dRows(j.rows);
    D.week = j;
  }
  const {notice: n, rows, prev} = D.week, totals = rows.filter(r => r.total), net = dSum(totals).net;
  const kindNet = k => dSum(totals.filter(r => r.kind === k)).net;
  const byDay = new Map();
  for (const r of rows) if (!r.total) byDay.set(r.date, (byDay.get(r.date) || 0) + (r.net || 0));
  const pts = [...byDay.keys()].sort().map(d => ({l: dDay(d), v: byDay.get(d), tip: `<b>${dDate(d)}</b> · ${dNetTxt(byDay.get(d))}`}));
  const prevTotal = prev ? Object.values(prev.nets).reduce((a, b) => a + b, 0) : 0;
  let h = dBack('Weeks') + dSummary(`Week ${n.week} · FY ${n.fy} · REV-${n.rev}`, net, [
      ['Period', `${dDay(n.from)} – ${dDate(n.to)}`], ['Payment due', dDate(n.due)],
      ['Thermal / gas / hydro', dNet(kindNet(0))], ['Solar', dNet(kindNet(1))],
    ].concat(prev ? [[`Change from REV-${prev.rev}`, dDelta(net - prevTotal)]] : []),
    n.rev > 0 && !prev ? 'Download the earlier revision of this week (Weeks tab) to see what changed.' : '', {pay: dSum(totals).pay, rec: dSum(totals).rec})
    + `<div style="margin:-4px 0 12px">${dBtn('Open SLDC PDF', 'pdf', n.id, true)}</div>`
    + dChart('Day-wise net DSM', pts);
  if (prev) {
    const changed = totals.filter(t => Math.abs((t.net || 0) - (prev.nets[t.key] ?? 1e99)) >= 0.5)
      .sort((a, b) => Math.abs((b.net || 0) - (prev.nets[b.key] || 0)) - Math.abs((a.net || 0) - (prev.nets[a.key] || 0)));
    h += `<div class="card"><h2>Revision check · REV-${prev.rev} → REV-${n.rev}</h2>${changed.length ? `<table class="dt num"><tr><th>Station / plant</th><th>REV-${prev.rev} ₹</th><th>REV-${n.rev} ₹</th><th>Change</th></tr>
      ${changed.map(t => `<tr><td>${esc(t.name)}</td><td>${t.key in prev.nets ? fmt(prev.nets[t.key]) : 'new'}</td><td>${fmt(t.net)}</td><td>${dDelta((t.net || 0) - (prev.nets[t.key] || 0))}</td></tr>`).join('')}</table>`
      : '<div class="empty">No GSECL station or plant changed in this revision.</div>'}</div>`;
  }
  for (const [kind, label] of [[0, 'Stations'], [1, 'Solar plants']]) {
    const list = totals.filter(t => t.kind === kind).sort((a, b) => (b.net || 0) - (a.net || 0));
    if (!list.length) continue;
    h += `<div class="credit" style="text-align:left;padding:4px 4px 8px;text-transform:uppercase;letter-spacing:.06em;font-weight:600">${label} · tap for day-wise figures</div>`
      + list.map(t => {
        const open = D.open.has(t.key);
        return `<div class="st ${open ? 'open' : ''}" style="--c:var(${(t.net || 0) >= 0 ? '--neg' : '--pos'})">
          <div class="st-h" data-dact="toggle" data-darg="${esc(t.key)}"><div><div class="nm">${esc(t.name)}</div>
            <div class="fu num">${kind ? `Scheduled ${dQty(t.sch)} · Injected ${dQty(t.act)}` : `Payable ${dRup(t.pay)} · Receivable ${dRup(t.rec)}`}</div></div>
            <div class="rt num"><b>${dNet(t.net || 0)}</b></div>
            <svg class="chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="m6 9 6 6 6-6"/></svg></div>
          <div class="st-b"><div style="overflow-x:auto"><table class="dt num"><tr><th>Date</th><th>Schedule</th><th>${kind ? 'Injected' : 'Inj / Drawal'}</th>${kind ? '' : '<th>Payable ₹</th><th>Receivable ₹</th>'}<th>${kind ? 'Charges ₹' : 'Net ₹'}</th></tr>
            ${rows.filter(r => r.key === t.key).map(r => `<tr class="${r.total ? 'hl' : ''}"><td>${r.total ? 'Total' : dDay(r.date)}</td><td>${dQty(r.sch)}</td><td>${dQty(r.act)}</td>${kind ? '' : `<td>${fmt(r.pay)}</td><td>${fmt(Math.abs(r.rec || 0))}</td>`}<td>${fmt(r.net)}</td></tr>`).join('')}
          </table></div><div class="note-src"><a data-dact="station" data-darg="${esc(t.key)}">Individual report of ${esc(t.name)} ›</a></div></div></div>`;
      }).join('');
  }
  return h;
}

// ---------------------------------------------------------------- render & interaction

function dsmRender() {
  const box = $('dsmBody');
  if (!hasDsm()) { box.innerHTML = '<div class="card"><div class="empty">DSM is available in the Android app.</div></div>'; return; }
  if (!D.data) dsmLoad();
  const d = D.data;
  D.charts = [];
  let h = D.status.running ? `<div class="alert"><span>⟳</span><span style="flex:1">${esc(D.status.message)}</span><b data-dact="stop" style="color:var(--accent)">Stop</b></div>` : '';
  if (!d || !d.years.length) {
    h += `<div class="card"><div class="empty">${D.status.running ? 'Reading the SLDC site for the first time…' : 'No DSM accounts yet.'}</div>${D.status.running ? '' : dBtn('Check SLDC site now', 'check', '', true)}</div>`;
  } else if (D.detail) {
    h += D.detail.type === 'week' ? dDetailWeek(D.detail.id) : D.detail.type === 'station' ? dDetailStation(D.detail.id) : dDetailMonth(D.detail.id);
  } else {
    h += `<div class="chips">${d.years.map(y => `<button class="chip ${y === d.fy ? 'on' : ''}" data-dact="fy" data-darg="${esc(y)}">FY ${esc(y)}</button>`).join('')}</div>
      <div class="seg" style="grid-template-columns:repeat(6,1fr)">${DSM_TABS.map(([k, l]) => `<button class="${D.tab === k ? 'on' : ''}" data-dact="tab" data-darg="${k}" style="padding:8px 2px;font-size:13px">${l}</button>`).join('')}</div>`;
    h += {fy: dTabFy, weeks: dTabWeeks, stations: dTabStations, monthly: dTabMonthly, solar: dTabSolar, est: dTabEst}[D.tab]();
  }
  box.innerHTML = h + '<div class="credit">Figures are provisional until SLDC finalises the account · Developed by <b>A D Bhatt</b>, EE, GSECL</div>';
  box.querySelectorAll('[data-dchart]').forEach(el => dDrawChart(el, D.charts[+el.dataset.dchart]));
}

function dsmGo(detail) { D.detail = detail; D.open.clear(); dsmRender(); window.scrollTo({top: 0}); }

document.addEventListener('click', e => {
  const el = e.target.closest('[data-dact]');
  if (!el || !hasDsm()) return;
  const arg = el.dataset.darg || '';
  switch (el.dataset.dact) {
    case 'tab': D.tab = arg; return dsmGo(null);
    case 'wf': D.wf = arg; return dsmRender();
    case 'estday': D.estDay = arg; D.estGroup = ''; return dsmRender();
    case 'estgrp': return dEstBlocks(arg);
    case 'estgrpx': D.estGroup = ''; return dsmRender();
    case 'estref': return dEstLoad(true);
    case 'fill': if (typeof Dsm.backfill === 'function') { Dsm.backfill(); dsmPoll(true); } return;
    case 'retry': if (typeof Dsm.retry === 'function') { Dsm.retry(arg); dsmPoll(true); } return;
    case 'allh': D.allHealth = D.allHealth ? null : (() => { try { return JSON.parse(Dsm.healthAll()); } catch (e) { return []; } })(); return dsmRender();
    case 'fy': D.fy = arg; D.data = null; return dsmGo(null);
    case 'back': return dsmGo(null);
    case 'week': return dsmGo({type: 'week', id: arg});
    case 'station': return dsmGo({type: 'station', id: arg});
    case 'month': return dsmGo({type: 'month', id: arg});
    case 'toggle': D.open.has(arg) ? D.open.delete(arg) : D.open.add(arg); return el.parentElement.classList.toggle('open');
    case 'pdf': return Dsm.openPdf(arg);
    case 'get': Dsm.fetchNotice(arg); return dsmPoll(true);
    case 'check': Dsm.check(); return dsmPoll(true);
    case 'reread': Dsm.reread(); return dsmPoll(true);
    case 'stop': Dsm.stop(); return dsmPoll(true);
    case 'all':
      if (confirm(`Download all remaining reports of FY ${D.fy}? Each is about 1–2 MB and takes a few minutes to read; it continues in the background.`)) { Dsm.fetchYear(D.fy); dsmPoll(true); }
      return;
    case 'savest': Dsm.setStations($('dsmStations').value); D.data = null; D.week = null; return dsmRender();
    case 'resetst': Dsm.setStations(''); D.data = null; D.week = null; return dsmRender();
  }
});

/** Follows a running download; when it ends, reloads the data so new weeks appear. */
function dsmPoll(expectStart = false) {
  clearTimeout(D.poll);
  if (!hasDsm()) return;
  const was = D.status.running;
  const s = JSON.parse(Dsm.status());
  if (s.error && s.errorId !== D.seenError) { D.seenError = s.errorId; if (D.inited) alert('DSM: ' + s.error); }
  D.inited = true;
  const changed = s.running !== was || (s.running && s.message !== D.status.message);
  D.status = s;
  if (was && !s.running) { D.data = null; D.week = null; D.health = null; if (D.allHealth) D.allHealth = null; }
  if ($('v-dsm').classList.contains('on')) {
    if (was && !s.running) dsmRender();
    else if (changed) {
      // While a detail page or the station editor is in use only the progress line changes.
      const bar = $('dsmBody').querySelector('.alert span[style]');
      if (bar && s.running) bar.textContent = s.message; else if (!document.activeElement?.matches?.('#dsmStations')) dsmRender();
    }
    D.poll = setTimeout(dsmPoll, s.running || expectStart ? 1500 : 10000);
  }
}

/** Called by show('dsm'). */
function dsmShow() {
  D.data = null; D.health = null;
  dsmPoll();
  dsmRender();
  setTimeout(dsmUpload, 1500);
}

/**
 * Sends the GSECL station totals of every week read on this phone (this and last financial year) to the
 * GSECL Connect service, for the daily management report. Each week is sent once (again when a newer revision
 * is read); the service keeps the newest revision of each week.
 */
let dsmUploading = false;
async function dsmUpload() {
  if (dsmUploading || !hasDsm() || typeof conCall !== 'function' || typeof hasConnect !== 'function' || !hasConnect()) return;
  dsmUploading = true;
  try {
    let done = {};
    try { const c = JSON.parse(Connect.cacheGet('dsm_uploaded') || 'null'); done = c ? JSON.parse(c.body) : {}; } catch (e) { done = {}; }
    const years = (JSON.parse(Dsm.data('')).years || []).slice(0, 2), weeks = [];
    for (const fy of years) {
      const j = JSON.parse(Dsm.data(fy)), rows = dRows(j.rows || []);
      for (const n of (j.notices || []).filter(x => x.latest)) {
        if (done[n.id] === n.rev) continue;
        const tot = rows.filter(r => r.n === n.id && r.total);
        if (!tot.length) continue;
        weeks.push({id: n.id, fy: n.fy, week: n.week, rev: n.rev, from: n.from, to: n.to, due: n.due,
          stations: tot.map(r => ({name: r.name, kind: r.kind, net: Math.round(r.net || 0), pay: Math.round(r.pay || 0), rec: Math.round(r.rec || 0)}))});
      }
    }
    for (let i = 0; i < weeks.length; i += 20) {
      const part = weeks.slice(i, i + 20);
      const r = await conCall('dsm_upload', {weeks: part});
      if (!r.ok) break;
      part.forEach(w => { done[w.id] = w.rev; });
      Connect.cacheSet('dsm_uploaded', JSON.stringify(done));
    }
  } catch (e) { /* tried again next time the DSM page opens */ }
  dsmUploading = false;
}

/** A tapped "new DSM account" notification asks for a particular week. */
window.dsmResume = () => {
  const id = hasDsm() ? Dsm.pendingWeek() : '';
  if (!id) return;
  D.data = null; D.week = null; D.fy = '';
  show('dsm');
  const n = JSON.parse(Dsm.week(id)).notice;
  if (n) { D.fy = n.fy; D.data = null; dsmGo({type: 'week', id}); }
};

/** Android back button: close a DSM detail first, then return to the dashboard; false lets the app close. */
window.appBack = () => {
  if ($('v-dsm').classList.contains('on') && D.detail) { dsmGo(null); return true; }
  if (!$('v-home').classList.contains('on')) { show('home'); return true; }
  return false;
};

window.addEventListener('resize', () => { if ($('v-dsm').classList.contains('on')) dsmRender(); });
window.dsmResume();
