// Corporate dashboard layer (4.0): Overview / In depth views of the Generation dashboard, auto insights from the live
// data, the station loading leaderboard, numbers that count to their value, and entrance motion when a view opens.
// Builds on app-main-2.js (gdRender, show, S, FUEL_COLOR, RUN_MW, blockLabel, fmt, esc, $); nothing here changes a figure.

const UI = {cu: {}, mode: 'ov', firstData: true};
try { UI.mode = localStorage.getItem('gsecl_home_mode') === 'deep' ? 'deep' : 'ov'; } catch (e) { /* default */ }
const uiReduced = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } };

/** Numbers marked data-cu="key" data-to="value" (data-dec="decimals") count from their last value to the new one. */
function uiCountUp(root) {
  (root || document).querySelectorAll('[data-cu]').forEach(el => {
    const k = el.dataset.cu, to = Number(el.dataset.to), dec = Number(el.dataset.dec || 0);
    if (!isFinite(to)) return;
    const from = UI.cu[k] !== undefined ? UI.cu[k] : to * 0.7;
    UI.cu[k] = to;
    if (uiReduced() || Math.abs(from - to) < Math.pow(10, -dec) / 2) { el.textContent = fmt(to, dec); return; }
    const t0 = performance.now(), dur = 850;
    const step = now => { const p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - p, 3); el.textContent = fmt(from + (to - from) * e, dec); if (p < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  });
}

/** A view that opens plays its entrance (cards rise in turn, charts draw, bars fill) once, not on each refresh. */
function uiEnter(el) {
  if (!el || uiReduced()) return;
  el.classList.remove('enter'); void el.offsetWidth; el.classList.add('enter');
  clearTimeout(el._enterT); el._enterT = setTimeout(() => el.classList.remove('enter'), 1500);
}

const uiIc = {
  up: '<path d="M3 17l6-6 4 4 8-8"/><path d="M14 7h7v7"/>', down: '<path d="M3 7l6 6 4-4 8 8"/><path d="M14 17h7v-7"/>',
  warn: '<path d="M12 3l9.5 16.5h-19z"/><path d="M12 10v4M12 17.5h.01"/>', ok: '<circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/>',
  wave: '<path d="M2 12c2.5-5 5-5 7.5 0s5 5 7.5 0 3.5-3 5-1"/>', rupee: '<path d="M6 4h12M6 9h12M9 4c4 0 6 2 6 5s-3 5-7 5l7 6"/>',
  pie: '<path d="M21 12A9 9 0 1 1 12 3v9z"/><path d="M15 3.5A9 9 0 0 1 20.5 9H15z"/>', target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
};
const uiSvg = (k, s = 18) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${uiIc[k] || uiIc.ok}</svg>`;
const uiStName = s => String(s.station || '').replace(/\s+(TPS|GBPS|CCPP|Hydro)$/i, '');

/** Station figures: [{i, s, cap, gen, dc, sg, dev, load}] (load in % of installed). */
function uiStations(g) {
  return g.stations.map((s, i) => {
    const cap = s.blocks.reduce((t, b) => t + (b.cap || 0), 0), gen = s.totals.gen || 0;
    const dev = s.blocks.some(b => b.deviation !== null) ? s.blocks.reduce((t, b) => t + (b.deviation || 0), 0) : null;
    return {i, s, cap, gen, dc: s.totals.dc, sg: s.totals.sg, dev, load: cap ? gen / cap * 100 : null};
  }).filter(x => x.cap > 0);
}

/** Highlights worked out from the live data (no AI): loading, schedule, outages, grid, market, PAF. */
function gdInsightsHtml(g) {
  const L = [], st = uiStations(g), add = (icon, tone, html) => L.push({icon, tone, html});
  const running = st.filter(x => x.gen > RUN_MW).sort((a, b) => b.load - a.load);
  if (running.length) add('up', 'ok', `<b>${esc(uiStName(running[0].s))}</b> is loaded highest, at ${fmt(running[0].load, 0)}% of installed capacity (${fmt(running[0].gen)} MW).`);
  if (running.length > 1) { const lo = running[running.length - 1]; add('down', 'mid', `<b>${esc(uiStName(lo.s))}</b> runs lowest, at ${fmt(lo.load, 0)}% (${fmt(lo.gen)} of ${fmt(lo.cap)} MW).`); }
  const devs = st.filter(x => x.dev !== null).sort((a, b) => a.dev - b.dev);
  if (devs.length && devs[0].dev < -15) add('warn', 'bad', `<b>${esc(uiStName(devs[0].s))}</b> is ${fmt(-devs[0].dev)} MW below its schedule: DSM exposure while it lasts.`);
  if (devs.length && devs[devs.length - 1].dev > 15) add('up', 'mid', `<b>${esc(uiStName(devs[devs.length - 1].s))}</b> is ${fmt(devs[devs.length - 1].dev)} MW above its schedule.`);
  const T = g.totals;
  if (T.deviation !== null && Math.abs(T.deviation) <= 15 && devs.length) add('target', 'ok', `GSECL as a whole is on schedule (${T.deviation >= 0 ? '+' : '−'}${fmt(Math.abs(T.deviation))} MW).`);
  const o = S.outages && S.outages.ok ? S.outages.rows || [] : null;
  if (o) {
    const f = o.filter(r => r.type === 'Forced'), mw = f.reduce((t, r) => t + (parseFloat(r.cap) || 0), 0);
    add(f.length ? 'warn' : 'ok', f.length ? 'bad' : 'ok', f.length ? `<b>${f.length} unit${f.length > 1 ? 's' : ''}</b> on forced outage, ${fmt(mw)} MW out${f[0] && f[0].unit ? ' (' + esc(f.slice(0, 3).map(r => r.unit).join(', ')) + (f.length > 3 ? '…' : '') + ')' : ''}.` : 'No GSECL unit is on forced outage.');
  }
  const h = S.home && S.home.ok ? S.home : null, fq = h && h.freq ? h.freq.value : null;
  if (fq) add('wave', fq < 49.9 || fq > 50.05 ? 'bad' : 'ok', `Grid frequency <b>${fmt(fq, 2)} Hz</b>${fq < 49.9 ? ': below the band, generation is valuable now' : fq > 50.05 ? ': above the band' : ', inside the 49.90–50.05 band'}.`);
  const cat = h && h.catered ? h.catered.value : null;
  if (cat && T.gen) add('pie', 'mid', `GSECL meets <b>${fmt(T.gen / cat * 100, 1)}%</b> of Gujarat's ${fmt(cat)} MW demand.`);
  const P = S.iex && S.iex.ok ? S.iex : null;
  if (P && Array.isArray(P.rtm) && P.rtm.some(v => v)) {
    let mx = -1, mi = 0; P.rtm.forEach((v, i) => { if (v > mx) { mx = v; mi = i; } });
    const now = P.rtmIdx !== null && P.rtmIdx !== undefined ? P.rtm[P.rtmIdx] : null;
    add('rupee', mx >= 8000 ? 'bad' : 'mid', `IEX real-time price peaks at <b>₹${fmt(mx / 1000, 2)}</b> per unit (${esc(typeof blockLabel === 'function' ? blockLabel(mi) : '')})${now ? `; ₹${fmt(now / 1000, 2)} now` : ''}.`);
  }
  const pd = typeof gdPafHist !== 'undefined' && gdPafHist.data ? (gdPafHist.data.totals || []).find(t => t.group === 'TOTAL (GSECL)') : null;
  if (pd && pd.mtd !== null && pd.mtd !== undefined && pd.target_paf) add('target', pd.mtd >= pd.target_paf ? 'ok' : 'bad', `PAF this month <b>${fmt(pd.mtd, 1)}%</b> against the ${fmt(pd.target_paf, 1)}% target${pd.mtd < pd.target_paf ? ': fixed cost at risk' : ''}.`);
  if (!L.length) return '';
  // the ones to act on first: problems, then the rest in their order
  L.sort((x, y) => (x.tone === 'bad' ? 0 : 1) - (y.tone === 'bad' ? 0 : 1));
  const insRow = x => `<div class="ins-i ${x.tone}"><span class="ins-ic">${uiSvg(x.icon)}</span><span class="ins-t">${x.html}</span></div>`;
  return `<h2>Key insights <span class="more muted" style="font-weight:500;font-size:11.5px">from the live data</span></h2>
    <div class="ins">${L.slice(0, 5).map(insRow).join('')}</div>
    ${L.length > 5 ? `<details class="ins-more"><summary>${L.length - 5} more insight${L.length > 6 ? 's' : ''}</summary><div class="ins">${L.slice(5).map(insRow).join('')}</div></details>` : ''}`;
}

/** Stations ranked by loading, with the DC mark: tap one for its blocks and units. */
function gdLeaderHtml(g) {
  const st = uiStations(g).sort((a, b) => (b.load || 0) - (a.load || 0));
  if (!st.length) return '';
  return `<h2>Station loading <span class="more" data-go="stations">Stations ›</span></h2>
    ${st.map(x => {
      const dcp = x.dc && x.cap ? Math.min(100, x.dc / x.cap * 100) : null, w = Math.min(100, Math.max(0, x.load || 0));
      return `<div class="lb" data-gst="${x.i}"><div class="lb-h"><span><i style="background:${FUEL_COLOR[x.s.fuel] || 'var(--accent)'}"></i>${esc(uiStName(x.s))}</span>
        <b class="num">${fmt(x.gen)} <small>MW · ${fmt(x.load || 0, 0)}%</small></b></div>
        <div class="lb-bar"><i style="width:${w}%;background:${FUEL_COLOR[x.s.fuel] || 'var(--accent)'}"></i>${dcp !== null ? `<u style="left:${dcp}%" title="DC ${fmt(x.dc)} MW"></u>` : ''}</div></div>`;
    }).join('')}
    <div class="keyline"><span><i style="width:14px;height:6px;border-radius:3px;background:var(--coal)"></i>Generation, % of installed</span><span><i style="width:2px;height:10px;background:var(--ink)"></i>Declared capability (DC)</span></div>`;
}

/** Overview / In depth switch of the Generation dashboard. */
function uiHomeMode(mode, animate) {
  UI.mode = mode === 'deep' ? 'deep' : 'ov';
  try { localStorage.setItem('gsecl_home_mode', UI.mode); } catch (e) { /* not kept */ }
  const v = $('v-home'); if (!v) return;
  v.classList.toggle('m-ov', UI.mode === 'ov'); v.classList.toggle('m-deep', UI.mode === 'deep');
  document.querySelectorAll('#homeMode button').forEach(b => b.classList.toggle('on', b.dataset.hm === UI.mode));
  const ind = $('homeModeInd'); if (ind) ind.style.transform = UI.mode === 'deep' ? 'translateX(100%)' : 'none';
  if (animate) uiEnter(v);
}

// ---- hooks into the existing app
if (typeof gdRender === 'function') {
  const gdRender0 = gdRender;
  // eslint-disable-next-line no-global-assign
  gdRender = function () {
    gdRender0();
    const g = S.gsecl;
    if (!g || !g.ok) return;
    if ($('gdInsights')) { const h = gdInsightsHtml(g); $('gdInsights').innerHTML = h; $('gdInsights').hidden = !h; }
    if ($('gdLeader')) { const h = gdLeaderHtml(g); $('gdLeader').innerHTML = h; $('gdLeader').hidden = !h; }
    uiCountUp($('v-home'));
    if (UI.firstData) { UI.firstData = false; if ($('v-home') && $('v-home').classList.contains('on')) uiEnter($('v-home')); }
  };
}
if (typeof show === 'function') {
  const show0 = show;
  // eslint-disable-next-line no-global-assign
  show = function (v) { show0(v); uiEnter($('v-' + v)); };
}
if (typeof document !== 'undefined') {
  document.addEventListener('click', e => { const b = e.target.closest('#homeMode [data-hm]'); if (b) uiHomeMode(b.dataset.hm, true); });
  uiHomeMode(UI.mode, false);
}

// ---------------------------------------------------------------- Customize: order and choice of the dashboard's cards
// Kept on this phone (localStorage gsecl_layout_home): {order: [ids], hidden: [ids]}. The cards are moved, never redrawn,
// so their own refreshes go on as before. Drag by the handle, or use the arrows; the switch shows or hides a card.

const UI_CARDS = [
  ['gdHero', 'Live generation', 'both'], ['gdInsights', 'Key insights', 'ov'], ['gdLeader', 'Station loading', 'ov'], ['gdToday', 'Today so far (chart)', 'both'],
  ['gdSrc', 'Generation sources (chart)', 'deep'], ['gdFuel', 'Fuel-wise generation', 'both'], ['gdPaf', 'PAF & fixed cost', 'deep'], ['gdTableCard', 'Station-wise table', 'deep'],
  ['gdUnitsCard', 'Unit status board', 'deep'], ['gdOutCard', 'Unit outages', 'both'], ['gdGridCard', 'Grid context', 'deep'],
];
const UI_TAG = {ov: 'Overview', deep: 'In depth', both: 'Both views'};
function uiLayoutGet() {
  let l = null; try { l = JSON.parse(localStorage.getItem('gsecl_layout_home') || 'null'); } catch (e) { l = null; }
  const ids = UI_CARDS.map(c => c[0]), order = (l && Array.isArray(l.order) ? l.order.filter(id => ids.includes(id)) : []);
  ids.forEach(id => { if (!order.includes(id)) order.push(id); });          // cards added in a later version join at the end
  return {order, hidden: l && Array.isArray(l.hidden) ? l.hidden.filter(id => ids.includes(id)) : []};
}
function uiLayoutPut(l) { try { localStorage.setItem('gsecl_layout_home', JSON.stringify(l)); } catch (e) { /* not kept */ } }
/** Puts the cards in the chosen order (before the credit line) and hides the ones switched off. */
function uiLayoutApply(l) {
  const v = $('v-home'); if (!v) return;
  const end = v.querySelector(':scope > .credit');
  l.order.forEach(id => { const el = $(id); if (el && el.parentNode === v) v.insertBefore(el, end); });
  UI_CARDS.forEach(([id]) => { const el = $(id); if (el) el.classList.toggle('u-hide', l.hidden.includes(id)); });
}
function uiCustRender() {
  const p = $('custPanel'); if (!p) return;
  const l = uiLayoutGet(), name = {}; UI_CARDS.forEach(c => { name[c[0]] = c; });
  p.innerHTML = `<h2>Customize dashboard <span class="more" data-cust="done">Done</span></h2>
    <div class="muted" style="font-size:12.5px;margin:-4px 0 8px">Drag ⋮⋮ or use the arrows to move a card; the switch shows or hides it. Saved on this phone.</div>
    <div class="cu-list" id="cuList">${l.order.map((id, i) => `<div class="cu-row${l.hidden.includes(id) ? ' off' : ''}" data-id="${id}">
      <span class="cu-grip" aria-label="Drag to move">⋮⋮</span><span class="cu-n">${esc(name[id][1])}<small>${UI_TAG[name[id][2]]}</small></span>
      <button class="cu-b" data-cmv="-1" aria-label="Move up" ${i === 0 ? 'disabled' : ''}>↑</button><button class="cu-b" data-cmv="1" aria-label="Move down" ${i === l.order.length - 1 ? 'disabled' : ''}>↓</button>
      <label class="sw" aria-label="Show ${esc(name[id][1])}"><input type="checkbox" data-cshow ${l.hidden.includes(id) ? '' : 'checked'}><span></span></label></div>`).join('')}</div>
    <div style="display:flex;gap:8px;margin-top:10px"><button class="btn" data-cust="reset" style="color:var(--accent)">Reset to standard</button></div>`;
}
function uiCust(open) {
  const p = $('custPanel'), v = $('v-home'); if (!p || !v) return;
  p.hidden = !open; v.classList.toggle('customizing', open); $('custBtn')?.classList.toggle('on', open);
  if (open) { uiCustRender(); p.scrollIntoView({behavior: uiReduced() ? 'auto' : 'smooth', block: 'start'}); }
}
/** The order shown in the panel becomes the layout. */
function uiCustCommit() {
  const l = uiLayoutGet();
  l.order = [...document.querySelectorAll('#cuList .cu-row')].map(r => r.dataset.id);
  uiLayoutPut(l); uiLayoutApply(l);
}
if (typeof document !== 'undefined') {
  document.addEventListener('click', e => {
    if (e.target.closest('#custBtn')) return uiCust($('custPanel').hidden);
    const c = e.target.closest('[data-cust]');
    if (c) { if (c.dataset.cust === 'done') return uiCust(false); if (c.dataset.cust === 'reset' && confirm('Back to the standard layout?')) { uiLayoutPut({order: UI_CARDS.map(x => x[0]), hidden: []}); uiLayoutApply(uiLayoutGet()); return uiCustRender(); } return; }
    const m = e.target.closest('[data-cmv]');
    if (m) {
      const row = m.closest('.cu-row'), sib = m.dataset.cmv === '-1' ? row.previousElementSibling : row.nextElementSibling;
      if (!sib) return;
      if (m.dataset.cmv === '-1') row.parentNode.insertBefore(row, sib); else row.parentNode.insertBefore(sib, row);
      row.classList.add('moved'); setTimeout(() => row.classList.remove('moved'), 400);
      uiCustCommit(); const id = row.dataset.id; uiCustRender();
      const again = document.querySelector(`#cuList .cu-row[data-id="${id}"]`); if (again) { again.classList.add('moved'); setTimeout(() => again.classList.remove('moved'), 400); }
    }
  });
  document.addEventListener('change', e => {
    if (!e.target.matches('[data-cshow]')) return;
    const id = e.target.closest('.cu-row').dataset.id, l = uiLayoutGet();
    l.hidden = l.hidden.filter(x => x !== id); if (!e.target.checked) l.hidden.push(id);
    e.target.closest('.cu-row').classList.toggle('off', !e.target.checked);
    uiLayoutPut(l); uiLayoutApply(l);
  });
  // drag by the handle (touch or mouse): the row follows the finger and the others make room
  let drag = null;
  document.addEventListener('pointerdown', e => {
    const g = e.target.closest('.cu-grip'); if (!g) return;
    const row = g.closest('.cu-row'); e.preventDefault();
    drag = {row, y0: e.clientY, id: e.pointerId}; row.classList.add('drag'); g.setPointerCapture && g.setPointerCapture(e.pointerId);
  });
  document.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    const {row} = drag, dy = e.clientY - drag.y0;
    row.style.transform = `translateY(${dy}px)`;
    const prev = row.previousElementSibling, next = row.nextElementSibling, r = row.getBoundingClientRect();
    if (prev && dy < 0 && r.top + r.height / 2 < prev.getBoundingClientRect().top + prev.offsetHeight / 2) { row.parentNode.insertBefore(row, prev); drag.y0 -= prev.offsetHeight; row.style.transform = `translateY(${e.clientY - drag.y0}px)`; }
    else if (next && dy > 0 && r.top + r.height / 2 > next.getBoundingClientRect().top + next.offsetHeight / 2) { row.parentNode.insertBefore(next, row); drag.y0 += next.offsetHeight; row.style.transform = `translateY(${e.clientY - drag.y0}px)`; }
  });
  const dragEnd = e => { if (!drag || e.pointerId !== drag.id) return; drag.row.classList.remove('drag'); drag.row.style.transform = ''; drag = null; uiCustCommit(); uiCustRender(); };
  document.addEventListener('pointerup', dragEnd); document.addEventListener('pointercancel', dragEnd);
  uiLayoutApply(uiLayoutGet());
}
