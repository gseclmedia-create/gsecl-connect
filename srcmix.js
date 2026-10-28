// Generation by source over a day, as in Gujarat Power: stacked MW areas every 10 minutes, a dashed line on top, and a
// drag across the chart for every source at that time (the crosshair columns carry the values, chartint.js).
//  - Generation page: GSECL by fuel (coal, lignite, gas, hydro; the rest of the SLDC GSECL figure as solar / other).
//  - Gujarat page: Gujarat supply by source (the SLDC generation split) with Gujarat catered.
// From the readings kept by the service (station_trend), for Today, Yesterday or a chosen day (daypick.js).
// Uses $, esc, fmt, niceTicks, csvBtn (app-main-2.js), dp* (daypick.js).

const SM_GSECL = [['Coal', 'Coal', 'var(--coal)'], ['Lignite', 'Lignite', 'var(--lignite)'], ['Gas', 'Gas', 'var(--gas)'], ['Hydro', 'Hydro', 'var(--hydro)'], ['other', 'Solar / other', '#f59e0b']];
const SM_GUJ = [['gsecl', 'GSECL', '#8e3291'], ['pub', 'State IPP', '#16a34a'], ['pvt', 'Private IPP', '#2563eb'], ['tor', 'Torrent', '#db2777'], ['other', 'Other / central share', '#94a3b8'], ['wind', 'Wind', '#0ea5e9'], ['solar', 'Solar', '#f59e0b']];
const smOk = v => v !== null && v !== undefined && isFinite(v);
const smHm = m => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(Math.floor(m % 60)).padStart(2, '0')}`;

/**
 * Stacked areas against minutes of the day. layers: [{name, col, vals}], line: {name, vals} or null. The chart is
 * split in columns (one per reading) that carry the tip of that time: every source, the total and the line.
 */
function smStack(layers, line, xs, unit = 'MW') {
  const W = 340, H = 210, L = 40, R = 8, T = 10, B = 20, n = xs.length, cum = xs.map(() => 0);
  const tops = layers.map(l => l.vals.map((v, i) => (cum[i] += Math.max(0, v || 0))));
  const hi = Math.max(1, ...tops[tops.length - 1], ...(line ? line.vals.filter(smOk) : [])) * 1.05;
  const x = m => L + m / 1440 * (W - L - R), y = v => T + (hi - v) / hi * (H - T - B);
  // a gap of more than 30 minutes breaks the areas
  const runs = []; let run = [];
  xs.forEach((m, i) => { if (run.length && m - xs[run[run.length - 1]] > 30) { runs.push(run); run = []; } run.push(i); });
  if (run.length) runs.push(run);
  let paths = '';
  layers.forEach((l, k) => runs.forEach(r => {
    if (r.length < 2) return;
    const top = r.map(i => x(xs[i]).toFixed(1) + ',' + y(tops[k][i]).toFixed(1)), bot = r.slice().reverse().map(i => x(xs[i]).toFixed(1) + ',' + y(k ? tops[k - 1][i] : 0).toFixed(1));
    paths += `<path d="M${top.join('L')}L${bot.join('L')}Z" fill="${l.col}" opacity=".88"/>`;
  }));
  let ln = '';
  if (line) { let pen = false, prev = null; xs.forEach((m, i) => { const v = line.vals[i]; if (!smOk(v)) { pen = false; return; } ln += (pen && m - prev <= 30 ? 'L' : 'M') + x(m).toFixed(1) + ',' + y(v).toFixed(1); pen = true; prev = m; }); }
  const cols = xs.map((m, i) => {
    const a = i ? (xs[i - 1] + m) / 2 : m - 5, b = i < n - 1 ? (m + xs[i + 1]) / 2 : m + 5, tot = tops[tops.length - 1][i];
    const tip = `<div style="font-weight:700;margin-bottom:2px">${smHm(m)}</div>` + layers.slice().reverse().map(l => `<div><i style="background:${l.col}"></i>${esc(l.name)} <b>${smOk(l.vals[i]) ? fmt(l.vals[i]) : '—'}</b></div>`).join('') +
      `<div style="border-top:1px solid rgba(255,255,255,.25);margin-top:3px;padding-top:2px">Total <b>${fmt(tot)} ${unit}</b></div>` + (line && smOk(line.vals[i]) ? `<div>${esc(line.name)} <b>${fmt(line.vals[i])} ${unit}</b></div>` : '');
    return `<rect x="${x(Math.max(0, a)).toFixed(1)}" y="${T}" width="${Math.max(0.5, x(Math.min(1440, b)) - x(Math.max(0, a))).toFixed(1)}" height="${H - T - B}" fill="transparent" data-cx="${x(m).toFixed(1)}" data-tip="${esc(smHm(m))}" data-tiph="${esc(tip)}"/>`;
  }).join('');
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="Generation by source">
    ${niceTicks(0, hi, 4).map(v => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${L - 4}" y="${y(v) + 3.5}" text-anchor="end">${v >= 1000 ? fmt(v / 1000, v % 1000 ? 1 : 0) + 'k' : fmt(v)}</text>`).join('')}
    ${paths}${ln ? `<path d="${ln}" fill="none" style="stroke:var(--ink)" stroke-width="1.6" stroke-dasharray="4 3"/>` : ''}
    ${[0, 6, 12, 18, 24].map((h, i) => `<text class="ax" x="${x(h * 60)}" y="${H - 5}" text-anchor="${i === 0 ? 'start' : i === 4 ? 'end' : 'middle'}">${String(h).padStart(2, '0')}:00</text>`).join('')}
    ${cols}</svg></div>`;
}
/** MU of a series over the day (trapezoids; gaps over 30 minutes left out). */
function smMu(xs, vals) {
  let s = 0; for (let i = 1; i < xs.length; i++) { const d = xs[i] - xs[i - 1]; if (d > 0 && d <= 30 && smOk(vals[i]) && smOk(vals[i - 1])) s += (vals[i] + vals[i - 1]) / 2 * d / 60; }
  return s / 1000;
}

function smCard(kind) {
  const id = kind === 'gsecl' ? 'gsrc' : 'jsrc', iso = dpGet(id);
  const title = kind === 'gsecl' ? 'GSECL generation by source' : 'Gujarat supply by source';
  const head = `<h2>${title} <span class="more muted" style="font-weight:500;font-size:11.5px">MW · drag for values</span></h2>${dpChips(id)}`;
  const tr = dpDayStt(iso, smRender);
  if (!tr) return head + '<div class="sk" style="height:210px"></div>';
  const t0 = dpStart(iso), idx = tr.t.map((t, i) => [t, i]).filter(([t]) => t >= t0 && t < t0 + 864e5), xs = idx.map(([t]) => (t - t0) / 60e3);
  if (idx.length < 2) return head + `<div class="empty">No readings kept for ${esc(dpLabel(iso).toLowerCase() === 'today' ? 'today yet' : dpLabel(iso))}.</div>`;
  const at = (arr, i) => (arr && smOk(arr[i]) ? arr[i] : null);
  let layers, line;
  if (kind === 'gsecl') {
    const f = tr.f || {};
    if (!f.Coal || !idx.some(([, i]) => smOk(f.Coal[i]))) return head + '<div class="empty">GSECL by fuel is kept from this version of the service on.</div>';
    const g = idx.map(([, i]) => at(tr.m.gsecl, i));
    layers = SM_GSECL.map(([k, name, col]) => ({name, col, vals: k === 'other'
      ? idx.map(([, i], j) => (smOk(g[j]) ? Math.max(0, g[j] - ['Coal', 'Lignite', 'Gas', 'Hydro'].reduce((t, q) => t + (at(f[q], i) || 0), 0)) : 0))
      : idx.map(([, i]) => at(f[k], i) || 0)}));
    line = {name: 'GSECL (SLDC)', vals: g};
  } else {
    const known = ['gsecl', 'pub', 'pvt', 'tor', 'wind', 'solar'];
    layers = SM_GUJ.map(([k, name, col]) => ({name, col, vals: k === 'other'
      ? idx.map(([, i]) => { const t = at(tr.m.total, i); return smOk(t) ? Math.max(0, t - known.reduce((s, q) => s + (at(tr.m[q], i) || 0), 0)) : 0; })
      : idx.map(([, i]) => at(tr.m[k], i) || 0)}));
    line = {name: 'Catered', vals: idx.map(([, i]) => at(tr.m.cat, i))};
  }
  const mus = layers.map(l => smMu(xs, l.vals)), tot = mus.reduce((a, b) => a + b, 0), last = xs.length - 1;
  const csvHead = ['Time'].concat(layers.map(l => l.name + ' MW'), [line.name + ' MW']);
  return head + `<div class="tstats" style="grid-template-columns:repeat(3,1fr)">
      <div><span>${iso === dpToday() ? 'Now' : 'Last reading'}</span><b class="num">${fmt(layers.reduce((s, l) => s + (l.vals[last] || 0), 0))}</b><small>MW at ${smHm(xs[last])}</small></div>
      <div><span>Energy</span><b class="num">${fmt(tot, 2)}</b><small>MU ${iso === dpToday() ? 'so far' : 'in the day'}</small></div>
      <div><span>${esc(line.name)}</span><b class="num">${fmt(smMu(xs, line.vals), 2)}</b><small>MU</small></div></div>
    ${smStack(layers, line, xs)}
    <div class="keyline">${layers.map((l, k) => `<span><i style="width:10px;height:10px;background:${l.col}"></i>${esc(l.name)} <b style="color:var(--ink)">${fmt(mus[k], 1)}</b> MU</span>`).join('')}<span><i style="width:16px;height:0;border-top:2px dashed var(--ink)"></i>${esc(line.name)}</span></div>
    <div class="note-src">${kind === 'gsecl' ? 'GSECL stations of the SLDC station-wise data by fuel; solar / other = the SLDC GSECL figure less the stations.' : 'SLDC generation split; other / central share = Gujarat generation less the named sources.'} Readings kept by GSECL Connect every 10 minutes.</div>
    ${csvBtn(id, (kind === 'gsecl' ? 'GSECL' : 'Gujarat') + '_generation_by_source_' + iso, csvHead, xs.map((m, j) => [smHm(m)].concat(layers.map(l => Math.round(l.vals[j])), [smOk(line.vals[j]) ? Math.round(line.vals[j]) : null])))}`;
}

function smRender() {
  [['gdSrc', 'home', 'gsecl'], ['gujSrc', 'grid', 'guj']].forEach(([el, view, kind]) => {
    const box = $(el), sec = $('v-' + view);
    if (!box || !sec || !sec.classList.contains('on')) return;
    try { box.innerHTML = smCard(kind); } catch (e) { box.innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; }
  });
}
dpOn('gsrc', smRender);
dpOn('jsrc', smRender);
