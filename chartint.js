// Every chart of the app answers a touch: drag or tap across a line chart for the values of each line at that point,
// tap a bar or a donut segment for its value. Works on the app's own SVG charts without changing them: the values are
// read back from each chart's axis labels, the series names from its legend (matched by colour), the time / date from
// its bottom axis. Charts that show their own tips (a .tip box beside them) are left to themselves.
(() => {
  const tipEl = () => {
    let t = document.getElementById('citip');
    if (!t) {
      t = document.createElement('div'); t.id = 'citip';
      t.style.cssText = 'position:fixed;z-index:80;pointer-events:none;background:#1e1b2e;color:#fff;border-radius:10px;padding:7px 10px;font-size:12px;line-height:1.45;box-shadow:0 8px 24px rgba(0,0,0,.3);max-width:260px;display:none';
      document.body.appendChild(t);
    }
    return t;
  };
  const st = document.createElement('style');
  st.textContent = 'svg[viewBox]{touch-action:pan-y}.ci-x{pointer-events:none}#citip i{display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:6px;vertical-align:0}#citip b{font-variant-numeric:tabular-nums}';
  document.head.appendChild(st);
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
  const num = t => {
    const s = String(t || '').replace(/[₹,\s]/g, ''), m = /^([−-]?\d+(?:\.\d+)?)(k|K|L|lakh|cr)?%?$/.exec(s.replace('−', '-'));
    if (!m) return null;
    return parseFloat(m[1]) * ({k: 1e3, K: 1e3, L: 1e5, lakh: 1e5, cr: 1e7}[m[2]] || 1);
  };
  const isTime = t => /^\d{1,2}:\d{2}$/.test(String(t).trim());
  const tmin = t => { const [h, m] = String(t).trim().split(':').map(Number); return h * 60 + m; };
  const hm = v => { v = Math.round(v); v = ((v % 1440) + 1440) % 1440; return String(Math.floor(v / 60)).padStart(2, '0') + ':' + String(v % 60).padStart(2, '0'); };
  const fmtV = (v, ref) => {
    if (v === null || !isFinite(v)) return '—';
    const pctAxis = /%/.test(ref), a = Math.abs(v), d = a >= 100 ? 0 : a >= 10 ? 1 : 2;
    return v.toLocaleString('en-IN', {maximumFractionDigits: d}) + (pctAxis ? '%' : '');
  };
  // the chart's geometry in its own (viewBox) units
  function axes(svg) {
    const vb = svg.viewBox.baseVal, W = vb.width, H = vb.height;
    const texts = [...svg.querySelectorAll('text')].map(t => ({t, x: +t.getAttribute('x'), y: +t.getAttribute('y'), s: t.textContent.trim(), anchor: t.getAttribute('text-anchor') || 'start'})).filter(o => isFinite(o.x) && isFinite(o.y));
    const fit = pts => {   // value = a + b * coordinate, least squares over the tick labels
      if (pts.length < 2) return null;
      const n = pts.length, mx = pts.reduce((t, p) => t + p[0], 0) / n, my = pts.reduce((t, p) => t + p[1], 0) / n;
      const sxx = pts.reduce((t, p) => t + (p[0] - mx) ** 2, 0); if (!sxx) return null;
      const b = pts.reduce((t, p) => t + (p[0] - mx) * (p[1] - my), 0) / sxx; return {a: my - b * mx, b};
    };
    const left = texts.filter(o => o.x < W * .2 && o.anchor === 'end' && num(o.s) !== null), right = texts.filter(o => o.x > W * .8 && o.anchor !== 'end' && num(o.s) !== null && o.y < H - 14);
    const bottom = texts.filter(o => o.y > H - 22 && !(left.includes(o) || right.includes(o)));
    const yl = fit(left.map(o => [o.y - 3.5, num(o.s)])), yr = fit(right.map(o => [o.y - 3.5, num(o.s)]));
    const times = bottom.filter(o => isTime(o.s)), xt = times.length >= 2 ? fit(times.map(o => [o.x, tmin(o.s) + (o.s === '24:00' ? 0 : 0)])) : null;
    return {W, H, yl, yr, yUnit: left.map(o => o.s).join(' '), yrUnit: right.map(o => o.s).join(' '), xt, bottom};
  }
  const colourOf = el => { const cs = getComputedStyle(el); return el.tagName === 'rect' || (cs.fill && cs.fill !== 'none' && cs.stroke === 'none') ? cs.fill : cs.stroke; };
  const norm = c => { const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c || ''); return m ? m.slice(1, 4).join(',') : ''; };
  /** Legend of the card: colour -> name. */
  function legend(box) {
    const out = {};
    // the nearest enclosing block (up to the card) that holds swatches: <span><i style="background:…"></i>Name</span>
    for (let el = box, k = 0; el && k < 5 && !Object.keys(out).length; el = el.parentElement, k++) {
      el.querySelectorAll('span, .legend > div').forEach(sp => {
      const i = sp.querySelector(':scope > i'); if (!i) return;
      const cs = getComputedStyle(i), c = norm(cs.backgroundColor) && cs.backgroundColor !== 'rgba(0, 0, 0, 0)' ? norm(cs.backgroundColor) : norm(cs.borderTopColor);
      const name = sp.textContent.replace(/\s+/g, ' ').trim().split(/ (?=\d[\d,.]*\s*(MW|MU|%))/)[0];
      if (c && name && !out[c]) out[c] = name;
      });
      if (el.matches && el.matches('.card, section')) break;
    }
    return out;
  }
  /** Vertices of a polyline path "M x,y L x,y …" (areas closed with Z are left out). */
  function verts(p) {
    const d = p.getAttribute('d') || '';
    if (/[zZ]/.test(d) || /[CcQqAaSsTtHhVv]/.test(d)) return null;
    const v = []; d.replace(/[ML]\s*(-?[\d.]+)[ ,](-?[\d.]+)/g, (_, x, y) => { v.push([+x, +y]); return ''; });
    return v.length >= 2 ? v : null;
  }
  function clear() {
    document.querySelectorAll('.ci-x').forEach(e => e.remove());
    const t = document.getElementById('citip'); if (t) t.style.display = 'none';
  }
  function show(html, cx, cy) {
    const t = tipEl(); t.innerHTML = html; t.style.display = 'block';
    const w = t.offsetWidth, h = t.offsetHeight;
    t.style.left = Math.max(8, Math.min(cx + 14, window.innerWidth - w - 8)) + 'px';
    t.style.top = Math.max(8, cy - h - 16 < 60 ? cy + 18 : cy - h - 16) + 'px';
    clearTimeout(t._h); t._h = setTimeout(clear, 6000);
  }
  const NS = 'http://www.w3.org/2000/svg';
  function line(svg, ev) {
    const g = axes(svg), pt = svg.createSVGPoint(); pt.x = ev.clientX; pt.y = ev.clientY;
    const m = svg.getScreenCTM(); if (!m) return false;
    const p = pt.matrixTransform(m.inverse());
    const series = [...svg.querySelectorAll('path')].filter(e => !e.closest('.ci-x')).map(e => ({e, v: verts(e)})).filter(s => s.v && getComputedStyle(s.e).stroke !== 'none' && parseFloat(getComputedStyle(s.e).strokeWidth || 1) > .6);
    if (!series.length || !g.yl) return false;
    const tol = g.W * .04;
    const hits = series.map(s => { let b = null; s.v.forEach(q => { if (Math.abs(q[0] - p.x) <= tol && (!b || Math.abs(q[0] - p.x) < Math.abs(b[0] - p.x))) b = q; }); return b ? {s, q: b} : null; }).filter(Boolean);
    if (!hits.length) return false;
    const X = hits.reduce((b, h) => (Math.abs(h.q[0] - p.x) < Math.abs(b - p.x) ? h.q[0] : b), hits[0].q[0]);
    clear();
    const grp = document.createElementNS(NS, 'g'); grp.setAttribute('class', 'ci-x');
    const vl = document.createElementNS(NS, 'line');
    vl.setAttribute('x1', X); vl.setAttribute('x2', X); vl.setAttribute('y1', 4); vl.setAttribute('y2', g.H - 18);
    vl.setAttribute('stroke', 'currentColor'); vl.setAttribute('stroke-dasharray', '3 3'); vl.setAttribute('opacity', '.5'); grp.appendChild(vl);
    const leg = legend(svg.closest('.chart') || svg.parentElement), seen = new Set();
    const rows = hits.map((h, i) => {
      const col = colourOf(h.s.e), key = norm(col), name = leg[key] || (hits.length > 1 ? 'Series ' + (i + 1) : 'Value');
      const useR = g.yr && (h.s.e.dataset.axis === 'r'), sc = useR ? g.yr : g.yl, val = sc.a + sc.b * h.q[1];
      const c = document.createElementNS(NS, 'circle'); c.setAttribute('cx', h.q[0]); c.setAttribute('cy', h.q[1]); c.setAttribute('r', 3.4); c.setAttribute('fill', col); grp.appendChild(c);
      const label = name + (seen.has(name) ? ' (' + (i + 1) + ')' : ''); seen.add(name);
      return `<div><i style="background:${col}"></i>${esc(label)} <b>${fmtV(val, useR ? g.yrUnit : g.yUnit)}</b></div>`;
    });
    svg.appendChild(grp);
    let xs = '';
    if (g.xt) xs = hm(g.xt.a + g.xt.b * X);
    else if (g.bottom.length) xs = g.bottom.reduce((b, o) => (Math.abs(o.x - X) < Math.abs(b.x - X) ? o : b)).s;
    show((xs ? `<div style="font-weight:700;margin-bottom:2px">${esc(xs)}${g.xt ? '' : ' (nearest label)'}</div>` : '') + rows.join(''), ev.clientX, ev.clientY);
    return true;
  }
  function bar(svg, rect, ev) {
    const g = axes(svg), y = +rect.getAttribute('y'), h = +rect.getAttribute('height'), x = +rect.getAttribute('x'), w = +rect.getAttribute('width');
    if (!isFinite(h) || h <= 0 || w > g.W * .5) return false;
    const leg = legend(svg.closest('.chart') || svg.parentElement), col = colourOf(rect), name = leg[norm(col)] || '';
    const title = rect.querySelector('title') ? rect.querySelector('title').textContent : '';
    let val = null; if (g.yl) val = Math.abs((g.yl.a + g.yl.b * y) - (g.yl.a + g.yl.b * (y + h)));
    const cx = x + w / 2, near = g.bottom.length ? g.bottom.reduce((b, o) => (Math.abs(o.x - cx) < Math.abs(b.x - cx) ? o : b)) : null;
    if (!title && val === null) return false;
    show((near && Math.abs(near.x - cx) < Math.max(w, g.W * .06) ? `<div style="font-weight:700">${esc(near.s)}</div>` : '') + (title ? `<div>${esc(title).replace(/\n/g, '<br>')}</div>` : '') +
      (val !== null && !title ? `<div><i style="background:${col}"></i>${esc(name || 'Value')} <b>${fmtV(val, g.yUnit)}</b></div>` : ''), ev.clientX, ev.clientY);
    return true;
  }
  function donut(svg, c, ev) {
    const da = (c.getAttribute('stroke-dasharray') || '').split(/[ ,]+/).map(Number), r = +c.getAttribute('r');
    if (da.length < 2 || !r) return false;
    const share = da[0] / (2 * Math.PI * r) * 100, leg = legend(svg.closest('.chart') || svg.parentElement), col = colourOf(c), title = c.querySelector('title');
    show(`<div><i style="background:${col}"></i>${esc(title ? title.textContent : leg[norm(col)] || 'Share')} <b>${share.toLocaleString('en-IN', {maximumFractionDigits: 1})}%</b></div>`, ev.clientX, ev.clientY);
    return true;
  }
  function handle(ev) {
    const svg = ev.target.closest && ev.target.closest('svg');
    if (!svg || !svg.viewBox || !svg.viewBox.baseVal || !svg.viewBox.baseVal.width || svg.viewBox.baseVal.width < 120) return false;
    const box = svg.parentElement;
    if (box && box.querySelector(':scope > .tip')) return false;   // the chart shows its own tips
    const tipped = ev.target.closest('[data-tip]');
    if (tipped) { show(esc(tipped.dataset.tip).replace(/\n/g, '<br>'), ev.clientX, ev.clientY); return true; }
    if (ev.target.tagName === 'rect' && bar(svg, ev.target, ev)) return true;
    if (ev.target.tagName === 'circle' && ev.target.getAttribute('stroke-dasharray') && donut(svg, ev.target, ev)) return true;
    const rings = [...svg.querySelectorAll('circle[stroke-dasharray]')];
    if (rings.length >= 2 && !svg.querySelector('path')) {   // a donut touched in its middle: every share
      const leg = legend(svg.parentElement);
      show(rings.map(c => { const da = c.getAttribute('stroke-dasharray').split(/[ ,]+/).map(Number), r = +c.getAttribute('r'), col = colourOf(c);
        return `<div><i style="background:${col}"></i>${esc(leg[norm(col)] || '')} <b>${(da[0] / (2 * Math.PI * r) * 100).toLocaleString('en-IN', {maximumFractionDigits: 1})}%</b></div>`; }).join(''), ev.clientX, ev.clientY);
      return true;
    }
    return line(svg, ev);
  }
  document.addEventListener('pointerdown', e => { if (!handle(e)) { if (!e.target.closest || !e.target.closest('svg')) clear(); } }, {passive: true});
  document.addEventListener('pointermove', e => { if ((e.pointerType === 'mouse' && e.buttons === 0) || !e.target.closest || !e.target.closest('svg')) return; handle(e); }, {passive: true});
  window.addEventListener('scroll', () => { const t = document.getElementById('citip'); if (t && t.style.display === 'block') clear(); }, {passive: true});
})();
