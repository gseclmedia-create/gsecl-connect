// Chart kit (4.1): small SVG / HTML charts shared by every page, in the corporate style of index.html (.vz-*).
// Each returns markup; all animate in on their own (CSS), respect "reduce motion", and use the page's colours.
// vzRing (gauge), vzDonut (parts of a whole with legend), vzBars (ranked horizontal bars), vzStack (one stacked bar),
// vzCols (columns over time), vzLine (line / area over time), vzKpis (figure tiles), vzHeat (risk matrix), vzLegend.

const VZ_COLORS = ['#1d4ed8', '#8e3291', '#0f766e', '#d97706', '#be123c', '#0891b2', '#7c3aed', '#65a30d', '#475569', '#db2777'];
const vzEsc = s => (typeof esc === 'function' ? esc(s) : String(s ?? ''));
const vzFmt = (v, d = 0) => (v === null || v === undefined || !isFinite(v) ? '—' : (typeof fmt === 'function' ? fmt(v, d) : Number(v).toFixed(d)));
const vzColor = (i, c) => c || VZ_COLORS[i % VZ_COLORS.length];

/** A gauge: pct 0–100 (or more), the figure in the middle, a label below. */
function vzRing(pct, o = {}) {
  const s = o.size || 92, sw = o.stroke || 10, r = (s - sw) / 2, C = 2 * Math.PI * r, v = Math.max(0, Math.min(100, +pct || 0));
  const col = o.color || (o.tone === 'bad' ? '#be123c' : o.tone === 'warn' ? '#d97706' : o.tone === 'ok' ? '#15803d' : 'var(--accent)');
  return `<div class="vz-ring" style="width:${s}px"><svg width="${s}" height="${s}" viewBox="0 0 ${s} ${s}" aria-hidden="true">
      <circle cx="${s / 2}" cy="${s / 2}" r="${r}" fill="none" stroke="var(--soft)" stroke-width="${sw}"/>
      <circle class="vz-arc" cx="${s / 2}" cy="${s / 2}" r="${r}" fill="none" stroke="${col}" stroke-width="${sw}" stroke-linecap="round"
        stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${(C * (1 - v / 100)).toFixed(1)}" style="--c:${C.toFixed(1)}" transform="rotate(-90 ${s / 2} ${s / 2})"/></svg>
    <b class="num" style="font-size:${Math.round(s / 5)}px;height:${s}px">${o.text !== undefined ? o.text : vzFmt(pct, o.dec || 0) + '%'}</b>
    ${o.label ? `<span>${vzEsc(o.label)}</span>` : ''}${o.sub ? `<small>${vzEsc(o.sub)}</small>` : ''}</div>`;
}
/** Parts of a whole: [{k, n, c}] as a donut with the total in the middle and a legend beside. */
function vzDonut(items, o = {}) {
  const list = items.filter(x => +x.n > 0), tot = list.reduce((t, x) => t + +x.n, 0), s = o.size || 120, sw = o.stroke || 18, r = (s - sw) / 2, C = 2 * Math.PI * r;
  if (!tot) return `<div class="empty">${vzEsc(o.empty || 'No data yet.')}</div>`;
  let off = 0;
  const arcs = list.map((x, i) => { const len = C * x.n / tot, a = `<circle class="vz-seg" cx="${s / 2}" cy="${s / 2}" r="${r}" fill="none" stroke="${vzColor(i, x.c)}" stroke-width="${sw}"
      stroke-dasharray="${Math.max(0, len - 1.5).toFixed(1)} ${(C - len + 1.5).toFixed(1)}" stroke-dashoffset="${(-off).toFixed(1)}" transform="rotate(-90 ${s / 2} ${s / 2})" style="animation-delay:${i * 70}ms"><title>${vzEsc(x.k)}: ${vzFmt(x.n)}</title></circle>`; off += len; return a; }).join('');
  return `<div class="vz-donut"><div class="vz-dc" style="width:${s}px;height:${s}px"><svg width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
      <circle cx="${s / 2}" cy="${s / 2}" r="${r}" fill="none" stroke="var(--soft)" stroke-width="${sw}"/>${arcs}</svg>
      <div class="vz-dm"><b class="num">${vzFmt(o.center !== undefined ? o.center : tot)}</b><span>${vzEsc(o.label || 'total')}</span></div></div>
    ${vzLegend(list.map((x, i) => ({k: x.k, c: vzColor(i, x.c), v: vzFmt(x.n) + (o.pct === false ? '' : ' · ' + vzFmt(x.n / tot * 100, 0) + '%')})))}</div>`;
}
const vzLegend = list => `<div class="vz-leg">${list.map(x => `<div><i style="background:${x.c}"></i><span>${vzEsc(x.k)}</span>${x.v !== undefined ? `<b class="num">${x.v}</b>` : ''}</div>`).join('')}</div>`;
/** Ranked bars: [{k, v, c, note, act}] (act: data attributes string for a tap). max: scale (default the largest). */
function vzBars(items, o = {}) {
  if (!items.length) return `<div class="empty">${vzEsc(o.empty || 'No data yet.')}</div>`;
  const max = o.max || Math.max(...items.map(x => +x.v || 0), 1);
  return `<div class="vz-bars">${items.map((x, i) => `<div class="vz-bar" ${x.act || ''} style="animation-delay:${i * 40}ms"><div class="vz-bh"><span>${vzEsc(x.k)}</span>
      <b class="num">${x.label !== undefined ? x.label : vzFmt(x.v, o.dec || 0) + (o.unit || '')}</b></div>
      <div class="vz-bt"><i style="width:${Math.max(0, Math.min(100, (+x.v || 0) / max * 100))}%;background:${vzColor(o.one ? 0 : i, x.c || o.color)};animation-delay:${i * 40}ms"></i>${x.mark !== undefined ? `<u style="left:${Math.min(100, x.mark / max * 100)}%"></u>` : ''}</div>
      ${x.note ? `<div class="vz-bn">${x.note}</div>` : ''}</div>`).join('')}</div>`;
}
/** One stacked bar per row: rows [{k, parts: [n, …]}], keys [{k, c}] for the parts. */
function vzStack(rows, keys, o = {}) {
  if (!rows.length) return `<div class="empty">${vzEsc(o.empty || 'No data yet.')}</div>`;
  const max = o.full ? 0 : Math.max(...rows.map(r => r.parts.reduce((t, n) => t + (+n || 0), 0)), 1);
  return `<div class="vz-stk">${rows.map((r, i) => { const tot = r.parts.reduce((t, n) => t + (+n || 0), 0), w = o.full ? 100 : tot / max * 100;
      return `<div class="vz-sr" ${r.act || ''}><div class="vz-bh"><span>${vzEsc(r.k)}</span><b class="num">${r.label !== undefined ? r.label : vzFmt(tot)}</b></div>
        <div class="vz-st" style="width:${w}%;animation-delay:${i * 40}ms">${r.parts.map((n, j) => (+n > 0 ? `<i style="flex:${+n};background:${keys[j].c}" title="${vzEsc(keys[j].k)}: ${vzFmt(+n)}"></i>` : '')).join('')}</div></div>`; }).join('')}</div>
    ${vzLegend(keys.map(k => ({k: k.k, c: k.c})))}`;
}
/** Columns: [{k (label), v, c}] e.g. per month; the latest highlighted. */
function vzCols(items, o = {}) {
  if (!items.length) return `<div class="empty">${vzEsc(o.empty || 'No data yet.')}</div>`;
  const max = Math.max(...items.map(x => +x.v || 0), 1), H = o.h || 120;
  return `<div class="vz-cols" style="height:${H + 34}px">${items.map((x, i) => `<div class="vz-col"><b class="num">${x.v ? vzFmt(x.v, o.dec || 0) : ''}</b>
      <i style="height:${Math.max(2, (+x.v || 0) / max * H)}px;background:${x.c || (i === items.length - 1 ? 'var(--accent)' : 'color-mix(in srgb, var(--accent) 45%, var(--soft))')};animation-delay:${i * 35}ms"></i><span>${vzEsc(x.k)}</span></div>`).join('')}</div>`;
}
/** Lines over the same x: series [{k, c, pts: [v|null]}], labels [x labels]; area under the first; optional today index. */
function vzLine(series, labels, o = {}) {
  const W = 340, H = o.h || 150, L = 34, R = 8, T = 10, B = 22, n = labels.length;
  if (n < 2) return `<div class="empty">${vzEsc(o.empty || 'Not enough data yet.')}</div>`;
  const all = series.flatMap(s => s.pts).filter(v => v !== null && v !== undefined && isFinite(v));
  const max = o.max || Math.max(...all, 1) * 1.08, min = o.min !== undefined ? o.min : 0;
  const x = i => L + (W - L - R) * i / (n - 1), y = v => T + (H - T - B) * (1 - (v - min) / ((max - min) || 1));
  const path = pts => { let d = '', pen = false; pts.forEach((v, i) => { if (v === null || v === undefined || !isFinite(v)) { pen = false; return; } d += (pen ? 'L' : 'M') + x(i).toFixed(1) + ',' + y(v).toFixed(1); pen = true; }); return d; };
  const ticks = [0, .25, .5, .75, 1].map(f => min + (max - min) * f);
  const every = Math.max(1, Math.ceil(n / 6));
  const first = series[0], area = o.area !== false && first ? (() => { const p = first.pts.map((v, i) => [i, v]).filter(([, v]) => v !== null && v !== undefined); return p.length > 1 ? `M${x(p[0][0])},${y(min)}` + p.map(([i, v]) => `L${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('') + `L${x(p[p.length - 1][0])},${y(min)}Z` : ''; })() : '';
  return `<div class="chart vz-line"><svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block" role="img" aria-label="${vzEsc(o.aria || 'chart')}">
      ${ticks.map(v => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)"/><text x="${L - 4}" y="${y(v) + 3}" font-size="8.5" text-anchor="end" fill="var(--muted)">${vzFmt(v, o.dec || 0)}${o.unit || ''}</text>`).join('')}
      ${labels.map((l, i) => (i % every === 0 || i === n - 1 ? `<text x="${x(i)}" y="${H - 6}" font-size="8.5" text-anchor="middle" fill="var(--muted)">${vzEsc(l)}</text>` : '')).join('')}
      ${area ? `<path d="${area}" fill="${vzColor(0, first.c)}" opacity=".12"/>` : ''}
      ${o.today !== undefined && o.today >= 0 ? `<line x1="${x(o.today)}" x2="${x(o.today)}" y1="${T}" y2="${H - B}" stroke="#be123c" stroke-dasharray="3 3"/><text x="${x(o.today) + 3}" y="${T + 8}" font-size="8.5" fill="#be123c">Today</text>` : ''}
      ${series.map((s, i) => `<path d="${path(s.pts)}" fill="none" stroke="${vzColor(i, s.c)}" stroke-width="${s.w || 2.2}" ${s.dash ? 'stroke-dasharray="4 3"' : ''} stroke-linejoin="round" stroke-linecap="round"/>`).join('')}
      ${series.filter(s => s.dots).map(s => s.pts.map((v, i) => (v === null || v === undefined ? '' : `<circle cx="${x(i)}" cy="${y(v)}" r="3.4" fill="${s.c}"/>`)).join('')).join('')}
    </svg></div>${o.legend !== false ? vzLegend(series.map((s, i) => ({k: s.k, c: vzColor(i, s.c)}))) : ''}`;
}
/** Figure tiles: [{k, v, sub, tone (ok|warn|bad), act}]. */
const vzKpis = (list, cols) => `<div class="vz-kpis" style="grid-template-columns:repeat(${cols || Math.min(list.length, 4)},1fr)">${list.map((x, i) => `<div class="vz-kpi ${x.tone || ''}" ${x.act || ''} style="animation-delay:${i * 50}ms">
  <span>${vzEsc(x.k)}</span><b class="num">${x.v}</b>${x.sub ? `<small>${vzEsc(x.sub)}</small>` : ''}</div>`).join('')}</div>`;
/** 5 × 5 risk matrix: cells [{p, i, n}] (probability, impact, count). */
function vzHeat(cells) {
  const tone = (p, i) => { const s = p * i; return s >= 15 ? '#be123c' : s >= 8 ? '#d97706' : s >= 4 ? '#ca8a04' : '#15803d'; };
  let h = '<div class="vz-heat"><span class="vz-hy">Probability</span><div class="vz-hg">';
  for (let p = 5; p >= 1; p--) for (let i = 1; i <= 5; i++) { const c = cells.find(x => x.p === p && x.i === i), n = c ? c.n : 0;
    h += `<div style="background:${tone(p, i)};opacity:${n ? 1 : .22}" title="Probability ${p}, impact ${i}">${n || ''}</div>`; }
  return h + '</div><span class="vz-hx">Impact →</span></div>';
}
