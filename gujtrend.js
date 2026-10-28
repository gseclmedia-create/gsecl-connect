// Gujarat › two trends:
//  1. Frequency with Gujarat's over / under drawal at the regional periphery, by 15-minute block (SLDC "Gujarat At
//     periphery": drawal − schedule; bars up = over-drawal, down = under-drawal; frequency line on the right axis).
//     From the readings GSECL Connect keeps (history_get rows: [t, freq, catered, gsecl, …, drawal, schedule, dev]).
//  2. GSECL MU in two parts, 00:00–17:00 and 17:00–24:00: hour by hour for Today, Yesterday or a chosen day (with the
//     day before), or each of the last 30 days as two lines (with the average MW of each part, so the evening ramp-up
//     shows), from the daily load profiles (96 blocks of GSECL generation).
// Both choose the day with the day picker (daypick.js): only days with readings can be chosen.
// Uses $, esc, fmt, csvBtn, niceTicks (app-main-2.js), gdShared / gdSharedLoad (app-main-2.js), LF (loadfc.js).

const GT = {days: 30, split: 'day'};   // split: 'day' (hourly, the day chosen) or '30' (the last 30 days)
(() => { const st = document.createElement('style'); st.textContent = '#gujOd .tstats small,#gseclSplit .tstats small{white-space:normal}'; document.head.appendChild(st); })();
const gtHm = m => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const gtIso = t => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const GT_MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const gtDm = iso => `${iso.slice(8, 10)} ${GT_MON[+iso.slice(5, 7) - 1]}`;

/** 96 blocks of a day: mean deviation, drawal, schedule and frequency of the readings in each block. */
function gtBlocks(rows, t0) {
  const acc = Array.from({length: 96}, () => ({dev: 0, dn: 0, d: 0, s: 0, f: 0, fn: 0}));
  (rows || []).forEach(r => {
    const b = Math.floor((r[0] - t0) / 9e5); if (b < 0 || b > 95) return;
    const a = acc[b];
    if (r.length > 11 && r[11] !== null && isFinite(r[11])) { a.dev += r[11]; a.d += r[9]; a.s += r[10]; a.dn++; }
    if (r[1] && r[1] > 45 && r[1] < 55) { a.f += r[1]; a.fn++; }
  });
  return acc.map((a, i) => ({i, dev: a.dn ? a.dev / a.dn : null, drawal: a.dn ? a.d / a.dn : null, sched: a.dn ? a.s / a.dn : null, f: a.fn ? a.f / a.fn : null, n: a.dn}));
}

function gtOdHtml() {
  const iso = dpGet('od'), t0 = dpStart(iso), recent = iso === dpToday() || iso === dpYday();
  const sh = typeof gdShared !== 'undefined' && gdShared.rows && gdShared.from <= dpStart(dpYday()) ? gdShared.rows : null;
  const rows = recent && sh ? sh : dpDayRows(iso, gtRender);
  const head = `<h2>Frequency and over / under drawal <span class="more muted" style="font-weight:500;font-size:11.5px">${esc(dpLabel(iso))}</span></h2>${dpChips('od')}`;
  if (!rows) { if (recent) setTimeout(() => typeof gdSharedLoad === 'function' && gdSharedLoad(), 0); return head + '<div class="sk" style="height:180px"></div>'; }
  const B = gtBlocks(rows, t0), has = B.filter(b => b.dev !== null), hasF = B.filter(b => b.f !== null);
  if (!has.length && !hasF.length) return head + '<div class="empty">No readings for this day yet.</div>';
  const W = 340, H = 200, L = 40, R = 38, T = 10, Bt = 22, bw = (W - L - R) / 96;
  const dmax = Math.max(100, ...has.map(b => Math.abs(b.dev))) * 1.15, fs = hasF.map(b => b.f), flo = Math.min(49.85, ...fs) - 0.02, fhi = Math.max(50.15, ...fs) + 0.02;
  const y = v => T + (dmax - v) / (2 * dmax) * (H - T - Bt), yf = v => T + (fhi - v) / (fhi - flo) * (H - T - Bt), x = i => L + i * bw;
  const fpath = B.map(b => b.f === null ? null : [x(b.i) + bw / 2, yf(b.f)]).reduce((d, p, i, a) => p ? d + (i && a[i - 1] ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1) : d, '');
  const od = has.filter(b => b.dev > 0), ud = has.filter(b => b.dev < 0), mu = l => l.reduce((t, b) => t + b.dev / 4, 0) / 1000;
  const mx = od.reduce((m, b) => (!m || b.dev > m.dev ? b : m), null), mn = ud.reduce((m, b) => (!m || b.dev < m.dev ? b : m), null);
  const lowF = has.filter(b => b.dev > 0 && b.f !== null && b.f < 49.9).length, last = has[has.length - 1], lastF = hasF[hasF.length - 1];
  // the tip of a block (touch anywhere in its column, or drag): drawal against schedule and the frequency together
  const tip = b => `<div style="font-weight:700;margin-bottom:2px">Block ${b.i + 1} · ${gtHm(b.i * 15)}–${gtHm(b.i * 15 + 15)}</div>` +
    (b.dev !== null ? `<div><i style="background:${b.dev > 0 ? 'var(--neg)' : 'var(--pos)'}"></i>${b.dev >= 0 ? 'Over-drawal' : 'Under-drawal'} <b>${b.dev >= 0 ? '+' : '−'}${fmt(Math.abs(b.dev))} MW</b></div><div>Drawal ${fmt(b.drawal)} · schedule ${fmt(b.sched)} MW</div>` : '<div>No drawal reading</div>') +
    `<div><i style="background:#0284c7"></i>Frequency <b>${b.f !== null ? fmt(b.f, 2) + ' Hz' : '—'}</b></div>`;
  return head + `<div class="tstats" style="grid-template-columns:repeat(4,1fr)">
      <div><span>${iso !== dpToday() ? 'Last block' : 'Now'}</span><b class="num ${last && last.dev > 0 ? 'neg' : 'pos'}">${last ? (last.dev >= 0 ? '+' : '−') + fmt(Math.abs(last.dev)) : '—'}</b><small>MW ${last ? (last.dev >= 0 ? 'over' : 'under') + ' · ' + gtHm(last.i * 15) : ''}${lastF ? ' · ' + fmt(lastF.f, 2) + ' Hz' : ''}</small></div>
      <div><span>Over-drawal</span><b class="num neg">${fmt(mu(od), 2)}</b><small>MU · max +${mx ? fmt(mx.dev) + ' MW at ' + gtHm(mx.i * 15) : '—'}</small></div>
      <div><span>Under-drawal</span><b class="num pos">${fmt(Math.abs(mu(ud)), 2)}</b><small>MU · max −${mn ? fmt(Math.abs(mn.dev)) + ' MW at ' + gtHm(mn.i * 15) : '—'}</small></div>
      <div><span>Over-drawn below 49.90 Hz</span><b class="num ${lowF ? 'neg' : ''}">${lowF}</b><small>blocks of ${has.length}</small></div></div>
    ${has.length ? '' : '<div class="note-src">Over / under drawal is kept from GSECL Connect 3.15.6 on; only the frequency is shown for earlier readings.</div>'}
    <div class="chart"><svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="Gujarat over and under drawal with frequency">
      ${niceTicks(-dmax, dmax, 4).map(v => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${L - 4}" y="${y(v) + 3.5}" text-anchor="end">${v > 0 ? '+' : v < 0 ? '−' : ''}${fmt(Math.abs(v))}</text>`).join('')}
      ${[49.9, 50, 50.05].filter(v => v > flo && v < fhi).map(v => `<text class="ax" x="${W - R + 4}" y="${yf(v) + 3.5}" style="fill:#0284c7">${v.toFixed(2)}</text>`).join('')}
      <line x1="${L}" x2="${W - R}" y1="${yf(49.9)}" y2="${yf(49.9)}" stroke="#0284c7" stroke-opacity=".35" stroke-dasharray="2 3"/>
      ${has.map(b => `<rect x="${(x(b.i) + bw * 0.1).toFixed(1)}" y="${Math.min(y(0), y(b.dev)).toFixed(1)}" width="${(bw * 0.8).toFixed(2)}" height="${Math.max(0.6, Math.abs(y(b.dev) - y(0))).toFixed(1)}" style="fill:${b.dev > 0 ? 'var(--neg)' : 'var(--pos)'}" fill-opacity=".85"/>`).join('')}
      <line x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}" style="stroke:var(--muted)" stroke-width="1"/>
      <path d="${fpath}" fill="none" stroke="#0284c7" stroke-width="1.8" stroke-linejoin="round" data-axis="r"/>
      ${[0, 6, 12, 18, 24].map((h, i) => `<text class="ax" x="${x(h * 4)}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : i === 4 ? 'end' : 'middle'}">${String(h).padStart(2, '0')}:00</text>`).join('')}
      ${B.filter(b => b.dev !== null || b.f !== null).map(b => `<rect x="${x(b.i).toFixed(1)}" y="${T}" width="${bw.toFixed(2)}" height="${H - T - Bt}" fill="transparent" data-cx="${(x(b.i) + bw / 2).toFixed(1)}" data-tip="block" data-tiph="${esc(tip(b))}"/>`).join('')}
    </svg></div>
    <div class="keyline"><span><i style="width:12px;height:8px;background:var(--neg)"></i>Over-drawal MW (+)</span><span><i style="width:12px;height:8px;background:var(--pos)"></i>Under-drawal MW (−)</span><span><i style="width:16px;height:3px;background:#0284c7"></i>Frequency Hz</span></div>
    <div class="note-src">SLDC “Gujarat At periphery”: drawal − schedule, average of each 15-minute block, from the readings GSECL Connect keeps (every ~2 minutes). Touch or drag across the chart for each block's drawal and frequency.</div>
    ${csvBtn('gujOd', 'Gujarat_over_under_drawal_' + gtIso(t0), ['Block', 'Time', 'Drawal MW', 'Schedule MW', 'Deviation MW (+ over, - under)', 'Frequency Hz'], B.filter(b => b.dev !== null || b.f !== null).map(b => [b.i + 1, gtHm(b.i * 15), b.drawal === null ? null : Math.round(b.drawal), b.sched === null ? null : Math.round(b.sched), b.dev === null ? null : Math.round(b.dev), b.f === null ? null : +b.f.toFixed(3)]))}`;
}

/** GSECL MU of a day 00:00–17:00 (blocks 1–68) and 17:00–24:00 (69–96), with the average MW of each part. */
function gtSplit(g, partial) {
  if (!Array.isArray(g)) return null;
  const part = (a, b) => { const v = g.slice(a, b).filter(x => x !== null && x !== undefined); return {n: v.length, mu: v.reduce((t, x) => t + x, 0) / 4 / 1000, avg: v.length ? v.reduce((t, x) => t + x, 0) / v.length : null, max: v.length ? Math.max(...v) : null}; };
  const a = part(0, 68), b = part(68, 96);
  if (partial ? !b.n : (a.n < 60 || b.n < 24)) return null;   // a finished day needs most of its blocks; today once 17:00 has passed
  return {day: a, eve: b};
}
/** Hour by hour of one day: [{h, mw (average), mu, n}] from its 96 blocks. */
function gtHours(g) {
  return Array.from({length: 24}, (_, h) => { const v = (g || []).slice(h * 4, h * 4 + 4).filter(x => x !== null && x !== undefined && isFinite(x));
    return {h, n: v.length, mw: v.length ? v.reduce((t, x) => t + x, 0) / v.length : null, mu: v.reduce((t, x) => t + x, 0) / 4 / 1000}; });
}
function gtSplitDayHtml(days, head) {
  const iso = dpGet('gsplit'), d = days.find(x => x.date === iso), prevIso = dpIso(dpStart(iso) - 864e5 + 3600e3), p = days.find(x => x.date === prevIso);
  if (!d || !d.g) return head + `<div class="empty">No GSECL readings by block for ${esc(dpLabel(iso))}.</div>`;
  const H1 = gtHours(d.g), H0 = p && p.g ? gtHours(p.g) : null;
  const part = (a, b) => { const l = H1.slice(a, b).filter(x => x.n); return {mu: l.reduce((t, x) => t + x.mu, 0), avg: l.length ? l.reduce((t, x) => t + x.mw, 0) / l.length : null, max: l.length ? Math.max(...l.map(x => x.mw)) : null, n: l.length}; };
  const A = part(0, 17), E = part(17, 24), today = iso === dpToday(), ramp = A.avg !== null && E.avg !== null ? E.avg - A.avg : null;
  const W = 340, Hh = 190, L = 38, R = 8, T = 10, Bt = 22, bw = (W - L - R) / 24;
  const vals = H1.concat(H0 || []).filter(x => x.n).map(x => x.mw), hi = Math.max(...vals) * 1.08, lo = Math.max(0, Math.min(...vals) * 0.8);
  const y = v => T + (hi - v) / ((hi - lo) || 1) * (Hh - T - Bt), x = h => L + h * bw;
  let cum0 = 0, cum1 = 0;
  const tip = o => {
    if (o.h < 17) cum0 += o.mu; else cum1 += o.mu;
    const q = H0 && H0[o.h];
    return `<div style="font-weight:700;margin-bottom:2px">${String(o.h).padStart(2, '0')}:00–${String(o.h + 1).padStart(2, '0')}:00</div><div><i style="background:${o.h < 17 ? 'var(--accent)' : '#f59e0b'}"></i>Average <b>${fmt(o.mw)} MW</b> · ${fmt(o.mu, 3)} MU</div>` +
      `<div>${o.h < 17 ? '00–17 h' : '17–24 h'} till this hour <b>${fmt(o.h < 17 ? cum0 : cum1, 2)} MU</b></div>` + (q && q.n ? `<div><i style="background:var(--muted)"></i>${esc(dpLabel(prevIso))} <b>${fmt(q.mw)} MW</b></div>` : '');
  };
  const bars = H1.map(o => (o.n ? `<rect x="${(x(o.h) + bw * .12).toFixed(1)}" y="${y(o.mw).toFixed(1)}" width="${(bw * .76).toFixed(1)}" height="${Math.max(1, y(lo) - y(o.mw)).toFixed(1)}" rx="2" style="fill:${o.h < 17 ? 'var(--accent)' : '#f59e0b'}"/>` : '')).join('');
  const prev = H0 ? H0.reduce((dd, o) => (o.n ? dd + (dd && H0[o.h - 1] && H0[o.h - 1].n ? 'L' : 'M') + (x(o.h) + bw / 2).toFixed(1) + ',' + y(o.mw).toFixed(1) : dd), '') : '';
  const cols = H1.map(o => (o.n ? `<rect x="${x(o.h).toFixed(1)}" y="${T}" width="${bw.toFixed(1)}" height="${Hh - T - Bt}" fill="transparent" data-cx="${(x(o.h) + bw / 2).toFixed(1)}" data-tip="hour" data-tiph="${esc(tip(o))}"/>` : '')).join('');
  return head + `<div class="tstats" style="grid-template-columns:repeat(4,1fr)">
      <div><span>00–17 h</span><b class="num">${fmt(A.mu, 2)}</b><small>MU · avg ${fmt(A.avg)} MW${today && A.n < 17 ? ' · so far' : ''}</small></div>
      <div><span>17–24 h</span><b class="num">${E.n ? fmt(E.mu, 2) : '—'}</b><small>MU · avg ${fmt(E.avg)} MW${today && E.n && E.n < 7 ? ' · so far' : ''}</small></div>
      <div><span>Ramp-up</span><b class="num ${ramp === null ? '' : ramp >= 0 ? 'pos' : 'neg'}">${ramp === null ? '—' : (ramp >= 0 ? '+' : '−') + fmt(Math.abs(ramp))}</b><small>MW evening avg − day avg</small></div>
      <div><span>Day</span><b class="num">${fmt(A.mu + E.mu, 2)}</b><small>MU · peak hour ${fmt(Math.max(E.max || 0, A.max || 0))} MW</small></div></div>
    <div class="chart"><svg viewBox="0 0 ${W} ${Hh}" height="${Hh}" role="img" aria-label="GSECL generation hour by hour">
      ${niceTicks(lo, hi, 4).map(v => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${L - 4}" y="${y(v) + 3.5}" text-anchor="end">${fmt(v)}</text>`).join('')}
      <line x1="${x(17)}" x2="${x(17)}" y1="${T}" y2="${Hh - Bt}" stroke="#f59e0b" stroke-dasharray="3 3" opacity=".8"/>
      ${bars}${prev ? `<path d="${prev}" fill="none" style="stroke:var(--muted)" stroke-width="1.6" stroke-dasharray="4 3"/>` : ''}
      ${[0, 6, 12, 17, 24].map((h, i) => `<text class="ax" x="${x(h)}" y="${Hh - 6}" text-anchor="${i === 0 ? 'start' : i === 4 ? 'end' : 'middle'}">${String(h).padStart(2, '0')}:00</text>`).join('')}
      ${cols}</svg></div>
    <div class="keyline"><span><i style="width:12px;height:8px;background:var(--accent)"></i>00:00–17:00</span><span><i style="width:12px;height:8px;background:#f59e0b"></i>17:00–24:00 (peak period)</span>${H0 ? `<span><i style="width:16px;height:0;border-top:2px dashed var(--muted)"></i>${esc(dpLabel(prevIso))}</span>` : ''}<span>average MW of each hour</span></div>
    <div class="note-src">GSECL generation (SLDC) by 15-minute block, averaged per hour. Touch or drag across the bars for the hour's MW and MU.</div>
    ${csvBtn('gseclHours', 'GSECL_hourly_' + iso, ['Hour', 'Average MW', 'MU', 'Part', 'Previous day MW'], H1.map(o => [String(o.h).padStart(2, '0') + ':00', o.mw === null ? null : Math.round(o.mw), +o.mu.toFixed(3), o.h < 17 ? '00-17' : '17-24', H0 && H0[o.h].mw !== null ? Math.round(H0[o.h].mw) : null]))}`;
}
function gtSplitHtml() {
  const days = typeof LF !== 'undefined' && LF.data && LF.data.days;
  const head = `<h2>GSECL MU · 00–17 h and 17–24 h <span class="more muted" style="font-weight:500;font-size:11.5px">${GT.split === '30' ? 'last 30 days' : 'hour by hour'}</span></h2>` +
    dpChips('gsplit', `<button class="chip ${GT.split === '30' ? 'on' : ''}" data-gtsplit="30" style="padding:4px 10px;font-size:12px">30 days</button>`, GT.split !== '30');
  if (!days) return head + '<div class="sk" style="height:180px"></div>';
  if (GT.split !== '30') return gtSplitDayHtml(days, head);
  const today = gtIso(Date.now());
  const list = days.filter(d => d.g && d.date >= gtIso(Date.now() - GT.days * 864e5)).map(d => Object.assign({date: d.date}, gtSplit(d.g, d.date === today) || {})).filter(d => d.day);
  if (list.length < 2) return head + '<div class="empty">GSECL generation by block is not in the profiles yet: it comes with the updated GSECL Connect script.</div>';
  const n = list.length, W = 340, H = 180, L = 36, R = 8, T = 10, Bt = 22, step = (W - L - R) / Math.max(1, n - 1);
  const vals = list.flatMap(d => [d.day.mu, d.eve.mu]), hi = Math.max(...vals) * 1.1, lo = Math.min(...vals) * 0.85;
  const x = i => L + i * step, y = v => T + (hi - v) / ((hi - lo) || 1) * (H - T - Bt);
  const path = k => list.map((d, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ',' + y(d[k].mu).toFixed(1)).join('');
  const every = Math.max(1, Math.ceil(n / 6)), done = list.filter(d => d.date !== today), y1 = done[done.length - 1];
  const ramp = d => d.day.avg && d.eve.avg ? d.eve.avg - d.day.avg : null;
  const avgRamp = done.length ? done.reduce((t, d) => t + (ramp(d) || 0), 0) / done.length : null;
  return head + `<div class="tstats" style="grid-template-columns:repeat(4,1fr)">
      <div><span>00–17 h ${y1 ? gtDm(y1.date) : ''}</span><b class="num">${y1 ? fmt(y1.day.mu, 2) : '—'}</b><small>MU · avg ${y1 ? fmt(y1.day.avg) : '—'} MW</small></div>
      <div><span>17–24 h ${y1 ? gtDm(y1.date) : ''}</span><b class="num">${y1 ? fmt(y1.eve.mu, 2) : '—'}</b><small>MU · avg ${y1 ? fmt(y1.eve.avg) : '—'} MW</small></div>
      <div><span>Ramp-up ${y1 ? gtDm(y1.date) : ''}</span><b class="num ${y1 && ramp(y1) >= 0 ? 'pos' : 'neg'}">${y1 && ramp(y1) !== null ? (ramp(y1) >= 0 ? '+' : '−') + fmt(Math.abs(ramp(y1))) : '—'}</b><small>MW evening avg − day avg</small></div>
      <div><span>Ramp-up, ${done.length} days</span><b class="num ${avgRamp >= 0 ? 'pos' : 'neg'}">${avgRamp === null ? '—' : (avgRamp >= 0 ? '+' : '−') + fmt(Math.abs(avgRamp))}</b><small>MW average</small></div></div>
    <div class="chart"><svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="GSECL MU 00-17 and 17-24 hours by day">
      ${niceTicks(lo, hi, 4).map(v => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${L - 4}" y="${y(v) + 3.5}" text-anchor="end">${fmt(v)}</text>`).join('')}
      <path d="${path('day')}" fill="none" style="stroke:var(--accent)" stroke-width="2.2" stroke-linejoin="round"/>
      <path d="${path('eve')}" fill="none" stroke="#f59e0b" stroke-width="2.2" stroke-linejoin="round"/>
      ${list.map((d, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(d.day.mu).toFixed(1)}" r="2.4" style="fill:var(--accent)"/><circle cx="${x(i).toFixed(1)}" cy="${y(d.eve.mu).toFixed(1)}" r="2.4" fill="#f59e0b"/>`).join('')}
      ${list.map((d, i) => i % every && i !== n - 1 ? '' : `<text class="ax" x="${x(i).toFixed(1)}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}">${gtDm(d.date)}</text>`).join('')}
    </svg></div>
    <div class="keyline"><span><i style="width:16px;height:3px;background:var(--accent)"></i>00:00–17:00 MU</span><span><i style="width:16px;height:3px;background:#f59e0b"></i>17:00–24:00 MU (peak period)</span></div>
    <div style="overflow-x:auto;margin-top:8px"><table class="dt num"><tr><th>Date</th><th>00–17 MU</th><th>avg MW</th><th>17–24 MU</th><th>avg MW</th><th>max MW</th><th>Ramp-up MW</th></tr>
      ${[...list].reverse().slice(0, 10).map(d => `<tr><td>${gtDm(d.date)}${d.date === today ? ' <small>(so far)</small>' : ''}</td><td>${fmt(d.day.mu, 2)}</td><td>${fmt(d.day.avg)}</td><td>${fmt(d.eve.mu, 2)}</td><td>${fmt(d.eve.avg)}</td><td>${fmt(d.eve.max)}</td><td class="${ramp(d) >= 0 ? 'pos' : 'neg'}">${ramp(d) === null ? '—' : (ramp(d) >= 0 ? '+' : '−') + fmt(Math.abs(ramp(d)))}</td></tr>`).join('')}</table></div>
    <div class="note-src">GSECL generation (SLDC) by 15-minute block. 00–17 h is 17 hours and 17–24 h is 7 hours, so compare the average MW: ramp-up = evening average − day average.</div>
    ${csvBtn('gseclSplit', 'GSECL_MU_day_evening', ['Date', 'MU 00-17', 'Avg MW 00-17', 'MU 17-24', 'Avg MW 17-24', 'Max MW 17-24', 'Ramp-up MW'], list.map(d => [d.date, +d.day.mu.toFixed(3), d.day.avg === null ? null : Math.round(d.day.avg), +d.eve.mu.toFixed(3), d.eve.avg === null ? null : Math.round(d.eve.avg), d.eve.max, ramp(d) === null ? null : Math.round(ramp(d))]))}`;
}

function gtRender() {
  if (!$('v-grid') || !$('v-grid').classList.contains('on')) return;
  const a = $('gujOd'), b = $('gseclSplit');
  try { if (a) a.innerHTML = gtOdHtml(); } catch (e) { if (a) a.innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; }
  try { if (b) b.innerHTML = gtSplitHtml(); } catch (e) { if (b) b.innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; }
}
document.addEventListener('click', e => { const b = e.target.closest && e.target.closest('[data-gtsplit]'); if (b) { GT.split = '30'; gtRender(); } });
dpOn('od', gtRender);
dpOn('gsplit', () => { GT.split = 'day'; gtRender(); }, iso => !!(typeof LF !== 'undefined' && LF.data && LF.data.days && LF.data.days.some(d => d.date === iso && d.g)));
// readings: refresh with the shared log every 3 minutes while the Gujarat tab is open (only with auto-refresh on)
setInterval(() => { if (typeof appAuto === 'function' && !appAuto()) return; if ($('v-grid') && $('v-grid').classList.contains('on') && document.visibilityState === 'visible' && typeof gdSharedLoad === 'function') gdSharedLoad().then(gtRender); }, 3 * 60e3);
