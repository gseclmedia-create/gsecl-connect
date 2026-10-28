// Day picker for the trends: Today · Yesterday · 📅 any other day, in a month calendar where only the days with
// readings can be chosen (marked). Days with readings come from the service (trend_days: the readings log and its
// month history files); a picker may give its own test (e.g. the load profiles of the GSECL MU trend).
// Also the readings of one day from the service (history_get / station_trend), shared by the trends of that day.
// Uses $, esc (app-main-2.js), conCall, hasConnect (connect.js).

const DP = {sel: {}, has: {}, cb: {}, days: null, peri: new Set(), daysAt: 0, daysBusy: false, rows: {}, stt: {}, cal: null};
(() => {
  const st = document.createElement('style');
  st.textContent = `.dpcal{position:fixed;inset:0;z-index:90;background:rgba(15,23,42,.45);display:flex;align-items:center;justify-content:center;padding:16px}
.dpcal .box{background:var(--card);color:var(--ink);border-radius:16px;box-shadow:0 18px 50px rgba(0,0,0,.35);width:100%;max-width:340px;padding:14px}
.dpcal .hd{display:flex;align-items:center;justify-content:space-between;font-weight:800;margin-bottom:8px}
.dpcal .hd button{border:0;background:var(--soft);color:var(--ink);width:36px;height:36px;border-radius:10px;font-size:18px}
.dpcal .hd button:disabled{opacity:.3}
.dpcal .g{display:grid;grid-template-columns:repeat(7,1fr);gap:4px;text-align:center}
.dpcal .g span{font-size:11px;color:var(--muted);font-weight:700;padding:2px 0}
.dpcal .g button{border:0;border-radius:10px;height:38px;font:inherit;font-size:13.5px;background:transparent;color:var(--muted);opacity:.45}
.dpcal .g button.d{opacity:1;color:var(--ink);font-weight:800;background:var(--brandsoft);box-shadow:inset 0 0 0 1px var(--accent)}
.dpcal .g button.on{background:var(--accent);color:#fff}
.dpcal .g button.t{outline:2px solid var(--brand2);outline-offset:-2px}
.dpcal .ft{display:flex;justify-content:space-between;align-items:center;margin-top:10px;font-size:11.5px;color:var(--muted)}
.dpcal .ft i{display:inline-block;width:12px;height:12px;border-radius:4px;background:var(--brandsoft);box-shadow:inset 0 0 0 1px var(--accent);vertical-align:-2px;margin-right:4px}`;
  document.head.appendChild(st);
})();
const dpIso = t => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const dpStart = iso => new Date(iso + 'T00:00:00').getTime();
const dpToday = () => dpIso(Date.now());
const dpYday = () => dpIso(Date.now() - 864e5);
const DP_MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dpLabel = iso => iso === dpToday() ? 'Today' : iso === dpYday() ? 'Yesterday' : `${+iso.slice(8, 10)} ${DP_MON[+iso.slice(5, 7) - 1]} ${iso.slice(0, 4)}`;

/** The day chosen in picker `id` (yyyy-MM-dd; today at first). */
const dpGet = id => DP.sel[id] || dpToday();
/** Registers what picker `id` does when a day is chosen, and (optional) which days have data for it. */
function dpOn(id, fn, has) { DP.cb[id] = fn; if (has) DP.has[id] = has; }
const dpHas = (id, iso) => (DP.has[id] ? DP.has[id](iso) : !!(DP.days && DP.days[iso] >= 10));

/**
 * The chips: Today · Yesterday · 📅 (the chosen day when it is another one). extra: more chips (HTML) after them;
 * active = false when another choice of the card (e.g. "30 days") is on instead of a day.
 */
function dpChips(id, extra = '', active = true) {
  dpDaysLoad();
  const d = dpGet(id), other = d !== dpToday() && d !== dpYday(), on = c => (active && c ? 'on' : '');
  return `<div class="chips dpchips" style="padding:2px 0 6px">
    <button class="chip ${on(d === dpToday())}" data-dp="${esc(id)}" data-dpv="t" style="padding:4px 10px;font-size:12px">Today</button>
    <button class="chip ${on(d === dpYday())}" data-dp="${esc(id)}" data-dpv="y" style="padding:4px 10px;font-size:12px">Yesterday</button>
    <button class="chip ${on(other)}" data-dp="${esc(id)}" data-dpv="c" style="padding:4px 10px;font-size:12px">📅 ${other ? esc(dpLabel(d)) : 'Date'}</button>${extra}</div>`;
}
function dpSet(id, iso) { DP.sel[id] = iso; if (DP.cb[id]) DP.cb[id](iso); }

/** Days with readings from the service (every 30 minutes at most). */
async function dpDaysLoad(force) {
  if (DP.daysBusy || (!force && DP.days && Date.now() - DP.daysAt < 30 * 60e3) || typeof conCall !== 'function' || typeof hasConnect !== 'function' || !hasConnect()) return;
  DP.daysBusy = true;
  const r = await conCall('trend_days', {}).catch(() => ({ok: false}));
  DP.daysBusy = false; DP.daysAt = Date.now();
  if (r.ok && r.data && r.data.days) { DP.days = r.data.days; DP.peri = new Set(r.data.peri || []); if (DP.cal) dpCalDraw(); }
}

// ---------------------------------------------------------------- the calendar
function dpCalOpen(id) {
  const d = dpGet(id);
  DP.cal = {id, y: +d.slice(0, 4), m: +d.slice(5, 7) - 1};
  dpDaysLoad();
  dpCalDraw();
}
function dpCalDraw() {
  const c = DP.cal; if (!c) return;
  let el = document.getElementById('dpCal');
  if (!el) { el = document.createElement('div'); el.id = 'dpCal'; el.className = 'dpcal'; document.body.appendChild(el); }
  const first = new Date(c.y, c.m, 1), lead = (first.getDay() + 6) % 7, n = new Date(c.y, c.m + 1, 0).getDate(), today = dpToday(), sel = dpGet(c.id);
  const now = new Date(), atEnd = c.y > now.getFullYear() || (c.y === now.getFullYear() && c.m >= now.getMonth());
  let any = 0;
  const cells = Array.from({length: lead}, () => '<b></b>').concat(Array.from({length: n}, (_, i) => {
    const iso = `${c.y}-${String(c.m + 1).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`, ok = iso <= today && dpHas(c.id, iso);
    if (ok) any++;
    return `<button class="${ok ? 'd' : ''} ${iso === sel ? 'on' : ''} ${iso === today ? 't' : ''}" ${ok ? `data-dpday="${iso}"` : 'disabled'} aria-label="${iso}${ok ? ', readings' : ', no readings'}">${i + 1}</button>`;
  }));
  el.innerHTML = `<div class="box" role="dialog" aria-label="Choose a day">
    <div class="hd"><button data-dpmon="-1" aria-label="Previous month">‹</button><span>${DP_MON[c.m]} ${c.y}</span><button data-dpmon="1" ${atEnd ? 'disabled' : ''} aria-label="Next month">›</button></div>
    <div class="g">${['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map(x => `<span>${x}</span>`).join('')}${cells.join('')}</div>
    <div class="ft"><span><i></i>${DP.days || DP.has[c.id] ? (any ? 'readings kept · choose a marked day' : 'no readings kept in this month') : 'reading which days have data…'}</span><button class="btn" data-dpclose style="margin:0;padding:6px 12px">Close</button></div></div>`;
}
function dpCalClose() { DP.cal = null; const el = document.getElementById('dpCal'); if (el) el.remove(); }
document.addEventListener('click', e => {
  const t = e.target;
  const chip = t.closest && t.closest('[data-dp]');
  if (chip) {
    const id = chip.dataset.dp, v = chip.dataset.dpv;
    if (v === 't') dpSet(id, dpToday()); else if (v === 'y') dpSet(id, dpYday()); else dpCalOpen(id);
    return;
  }
  if (!DP.cal) return;
  const day = t.closest && t.closest('[data-dpday]');
  if (day) { const id = DP.cal.id; dpCalClose(); dpSet(id, day.dataset.dpday); return; }
  const mon = t.closest && t.closest('[data-dpmon]');
  if (mon) { const c = DP.cal, d = new Date(c.y, c.m + +mon.dataset.dpmon, 1); c.y = d.getFullYear(); c.m = d.getMonth(); dpCalDraw(); return; }
  if (t.closest && (t.closest('[data-dpclose]') || t.id === 'dpCal')) dpCalClose();
});

// ---------------------------------------------------------------- readings of one day (service)
/**
 * history_get rows of a day ([t, freq, catered, gsecl, thermal, hydro, solar, wind, total, drawal, schedule, dev]),
 * or null while they are read (then `then` is called). Today is read again after 3 minutes.
 */
function dpDayRows(iso, then) {
  const c = DP.rows[iso], fresh = c && (iso !== dpToday() || Date.now() - c.at < 3 * 60e3);
  if (c && c.rows && fresh) return c.rows;
  if (!(c && c.busy) && typeof conCall === 'function' && typeof hasConnect === 'function' && hasConnect()) {
    const t0 = dpStart(iso), slot = DP.rows[iso] = Object.assign(c || {}, {busy: true});
    conCall('history_get', {from: t0, to: Math.min(t0 + 864e5, Date.now())}).then(r => {
      slot.busy = false; slot.at = Date.now();
      slot.rows = r.ok && Array.isArray(r.data.rows) ? r.data.rows : (slot.rows || []);
      if (then) then();
    }).catch(() => { slot.busy = false; });
  }
  return c && c.rows ? c.rows : null;
}
/** station_trend of a day ({t, m, s, f}: the SLDC split and GSECL by fuel every 10 minutes), or null while read. */
function dpDayStt(iso, then) {
  const c = DP.stt[iso], fresh = c && (iso !== dpToday() || Date.now() - c.at < 5 * 60e3);
  if (c && c.data && fresh) return c.data;
  if (!(c && c.busy) && typeof conCall === 'function' && typeof hasConnect === 'function' && hasConnect()) {
    const t0 = dpStart(iso), slot = DP.stt[iso] = Object.assign(c || {}, {busy: true});
    conCall('station_trend', {from: t0, to: Math.min(t0 + 864e5, Date.now())}).then(r => {
      slot.busy = false; slot.at = Date.now();
      if (r.ok && r.data && r.data.t) slot.data = r.data; else if (!slot.data) slot.data = {t: [], m: {}, s: {}, f: {}};
      if (then) then();
    }).catch(() => { slot.busy = false; });
  }
  return c && c.data ? c.data : null;
}
