// Header (4.5): the highlights ticker under the grid line, and the daily pop-up of today's news and highlights.
// Ticker: worked out from the live data already loaded (S.home, S.gsecl, S.outages, S.iex, the day's readings, alerts,
// PAF, news) and redrawn only when its text changes. Tapping it opens today's highlights.
// Daily pop-up: on the first opening of each day (this device), once the first data is in: news the administrator marked
// "Show in the daily pop-up" (picture, headline, text) and the highlights. Uses app-main-2.js, connect.js, $, esc, fmt.

const TB = {sig: '', items: [], dpDone: false};

/** Today's highlights: [{t: html, k: up|dn|wa|'', ic, c}] from what the app has now. */
function tbItems() {
  const L = [], add = (t, k, ic, c) => L.push({t, k: k || '', ic: ic || '•', c: c || '#1d4ed8'});
  const h = S.home && S.home.ok ? S.home : null, g = S.gsecl && S.gsecl.ok ? S.gsecl : null, cat = h && h.catered ? h.catered.value : null;
  if (cat) add(`Gujarat catered <b>${fmt(cat)} MW</b>`, '', '⚡', '#1d4ed8');
  if (g) add(`GSECL generation <b>${fmt(g.totals.gen)} MW</b>${cat ? ` <i>(${fmt(g.totals.gen / cat * 100, 1)}% of Gujarat)</i>` : ''}`, '', '🏭', '#8e3291');
  // energy so far today, GSECL and Gujarat, from the day's readings
  try {
    const now = new Date(), t0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const rows = (typeof gdShared !== 'undefined' && gdShared.rows) || (typeof gdHist !== 'undefined' && gdHist.rows) || [];
    if (rows.length && typeof gdDay === 'function' && typeof gdEnergy === 'function') {
      const gm = gdEnergy(gdDay(rows, t0, 3)), cm = gdEnergy(gdDay(rows, t0, 2));
      if (gm > 0.5) add(`GSECL today <b>${fmt(gm, 1)} MU</b>${cm > 1 ? ` <i>· Gujarat ${fmt(cm, 1)} MU · GSECL share ${fmt(gm / cm * 100, 1)}%</i>` : ''}`, '', '📊', '#0f766e');
    }
  } catch (e) { /* no readings yet */ }
  if (g) {
    const st = g.stations.map(s => ({s, cap: s.blocks.reduce((t, b) => t + (b.cap || 0), 0)})).filter(x => x.s.totals.gen > 0).sort((a, b) => b.s.totals.gen - a.s.totals.gen);
    if (st.length) add(`Top station <b>${esc(st[0].s.station)}</b> ${fmt(st[0].s.totals.gen)} MW${st[0].cap ? ` <i>(${fmt(st[0].s.totals.gen / st[0].cap * 100, 0)}% loading)</i>` : ''}`, 'up', '🏆', '#15803d');
    const units = g.stations.flatMap(s => s.blocks.flatMap(b => b.units)), on = units.filter(u => (u.mw || 0) > RUN_MW).length;
    add(`Units on bar <b>${on} / ${units.length}</b>`, '', '🔌', '#475569');
    if (g.totals.deviation !== null && Math.abs(g.totals.deviation) > 15) add(`GSECL ${g.totals.deviation > 0 ? 'above' : 'below'} schedule <b>${fmt(Math.abs(g.totals.deviation))} MW</b>`, g.totals.deviation > 0 ? 'up' : 'dn', '📈', g.totals.deviation > 0 ? '#15803d' : '#be123c');
  }
  const o = S.outages && S.outages.ok ? S.outages.rows || [] : null;
  if (o) {
    const f = o.filter(r => r.type === 'Forced');
    add(f.length ? `Forced outage <b>${f.length} unit${f.length > 1 ? 's' : ''}</b> <i>${esc(f.slice(0, 3).map(r => r.unit).join(', '))}${f.length > 3 ? '…' : ''} · ${fmt(f.reduce((t, r) => t + (parseFloat(r.cap) || 0), 0))} MW</i>` : 'No GSECL unit on forced outage', f.length ? 'dn' : 'up', '🛑', f.length ? '#be123c' : '#15803d');
  }
  // trips and syncs of the last 6 hours (the app's own notifications)
  try {
    if (typeof alertLog === 'function') alertLog().filter(a => Date.now() - a.t < 6 * 36e5).slice(-4).reverse().forEach(a =>
      add(`${a.kind === 'sync' ? 'Synchronised' : 'Tripped'} <b>${esc(String(a.title || '').replace(/^.*?:\s*/, ''))}</b> <i>${new Date(a.t).toTimeString().slice(0, 5)}</i>`, a.kind === 'sync' ? 'up' : 'dn', a.kind === 'sync' ? '🔼' : '🔻', a.kind === 'sync' ? '#15803d' : '#be123c'));
  } catch (e) { /* none */ }
  const fq = h && h.freq ? h.freq.value : null;
  if (fq) add(`Frequency <b>${fmt(fq, 2)} Hz</b>${fq < 49.9 ? ' <i>below band</i>' : fq > 50.05 ? ' <i>above band</i>' : ''}`, fq < 49.9 || fq > 50.05 ? 'wa' : '', '〰', fq < 49.9 || fq > 50.05 ? '#d97706' : '#475569');
  const P = S.iex && S.iex.ok ? S.iex : null;
  if (P && Array.isArray(P.rtm) && P.rtm.some(v => v)) {
    let mx = -1, mi = 0; P.rtm.forEach((v, i) => { if (v > mx) { mx = v; mi = i; } });
    const now = P.rtmIdx !== null && P.rtmIdx !== undefined ? P.rtm[P.rtmIdx] : null;
    add(`IEX RTM ${now ? `<b>₹${fmt(now / 1000, 2)}</b> now · ` : ''}peak <b>₹${fmt(mx / 1000, 2)}</b> <i>${typeof blockLabel === 'function' ? esc(blockLabel(mi)) : ''}</i>`, mx >= 8000 ? 'wa' : '', '₹', '#d97706');
  }
  const pd = typeof gdPafHist !== 'undefined' && gdPafHist.data ? (gdPafHist.data.totals || []).find(t => t.group === 'TOTAL (GSECL)') : null;
  if (pd && pd.mtd !== null && pd.mtd !== undefined) add(`PAF this month <b>${fmt(pd.mtd, 1)}%</b>${pd.target_paf ? ` <i>target ${fmt(pd.target_paf, 1)}%</i>` : ''}`, pd.target_paf && pd.mtd < pd.target_paf ? 'dn' : 'up', '🎯', pd.target_paf && pd.mtd < pd.target_paf ? '#be123c' : '#15803d');
  const n = typeof C !== 'undefined' && C.home && (C.home.latest_news || [])[0];
  if (n) add(`News: <b>${esc(n.title)}</b>`, '', '📰', '#f47b57');
  return L;
}

/** Redraws the ticker when its text changes (speed follows its length). */
function tbRender() {
  const box = $('tickIn'); if (!box) return;
  const items = tbItems(), sig = items.map(x => x.t).join('|');
  TB.items = items;
  if (sig === TB.sig) return;
  TB.sig = sig;
  if (!items.length) { box.innerHTML = '<span><i>Reading the latest position…</i></span>'; return; }
  const one = items.map(x => `<span class="${x.k}">${x.t}</span>`).join('');
  box.innerHTML = one + one;                                            // twice, so the loop has no gap
  box.style.setProperty('--tdur', Math.max(25, Math.round(sig.replace(/<[^>]+>/g, '').length * 0.22)) + 's');
  tbDailyMaybe();
}

// ---------------------------------------------------------------- the daily pop-up

const tbToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const tbSeen = () => { try { return localStorage.getItem('gsecl_dp_day'); } catch (e) { return tbToday(); } };
/** Once a day, after the first live data, when the app is signed in (not over another pop-up or the sign-in). */
async function tbDailyMaybe(force) {
  if (TB.dpDone && !force) return;
  if (!force && (tbSeen() === tbToday() || !(S.gsecl && S.gsecl.ok))) return;
  if (typeof hasConnect !== 'function' || !hasConnect() || document.querySelector('.dp-bg, #webLogin, .askbox')) return;
  TB.dpDone = true;
  try { localStorage.setItem('gsecl_dp_day', tbToday()); } catch (e) { /* shown again next time */ }
  let news = [];
  try { const r = typeof conCached === 'function' ? await conCached('home', 5, false, 'home') : null; if (r && r.ok) news = r.data.popup || []; } catch (e) { news = []; }
  tbDailyShow(news);
}
function tbDailyShow(news) {
  const me = (() => { try { return JSON.parse(Native.account() || '{}'); } catch (e) { return {}; } })();
  const hr = new Date().getHours(), hello = hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';
  const name = typeof conName === 'function' ? conName(me.full_name) || '' : '';
  const box = document.createElement('div');
  box.className = 'dp-bg';
  box.innerHTML = `<div class="dp" role="dialog" aria-modal="true" aria-label="Today's highlights"><div class="dp-h"><b>${esc(hello)}${name ? ', ' + esc(name) : ''}</b>
      <span>Today's highlights · ${new Date().toLocaleDateString('en-IN', {weekday: 'long', day: 'numeric', month: 'long'})}</span><button class="dp-x" data-dpact="close" aria-label="Close">×</button></div>
    <div class="dp-b">${news.map((n, i) => `<div class="dp-news" style="animation-delay:${i * 80}ms">${n.image_id ? `<img id="dpImg${i}" alt="" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">` : ''}<div><b>${esc(n.title)}</b><p>${esc(String(n.body || n.excerpt || '').slice(0, 420))}</p></div></div>`).join('')}
      <div class="dp-hl">${TB.items.slice(0, 9).map((x, i) => `<div style="animation-delay:${(news.length + i) * 50}ms"><span class="ic" style="background:${x.c}">${x.ic}</span><span>${x.t}</span></div>`).join('') || '<div>Reading the latest position…</div>'}</div>
      <div class="dp-f">${news.length ? '<button data-dpact="news" style="background:var(--soft);color:var(--ink)">All news</button>' : ''}<button data-dpact="close" style="background:var(--accent);color:#fff">Continue</button></div></div></div>`;
  document.body.appendChild(box);
  // pictures through the app (kept encrypted on the phone)
  news.forEach((n, i) => { if (n.image_id && typeof conAsk === 'function' && typeof Connect !== 'undefined' && Connect.image) conAsk(id => Connect.image(id, n.image_id)).then(r => { const im = $('dpImg' + i); if (im && r.ok) im.src = r.body; }); });
}

// ---------------------------------------------------------------- hooks
if (typeof renderHeader === 'function') {
  const renderHeader0 = renderHeader;
  // eslint-disable-next-line no-global-assign
  renderHeader = function () { const r = renderHeader0.apply(this, arguments); try { tbRender(); } catch (e) { /* header itself is drawn */ } return r; };
}
if (typeof document !== 'undefined') {
  document.addEventListener('click', e => {
    if (e.target.closest('#tickBar')) return tbDailyShow([]);
    const b = e.target.closest('[data-dpact]'); if (!b) return;
    const bg = b.closest('.dp-bg'); if (bg) { bg.style.opacity = '0'; bg.style.transition = 'opacity .18s ease'; setTimeout(() => bg.remove(), 180); }
    if (b.dataset.dpact === 'news' && typeof show === 'function') { show('connect'); if (typeof conOpenTab === 'function') conOpenTab('news'); }
  });
  document.addEventListener('click', e => { if (e.target.classList && e.target.classList.contains('dp-bg')) e.target.remove(); });
  setInterval(() => { try { tbRender(); } catch (e) { /* next time */ } }, 60000);
  const tbPrevBack = window.appBack;
  window.appBack = () => { const p = document.querySelector('.dp-bg'); if (p) { p.remove(); return true; } return tbPrevBack ? tbPrevBack() : false; };
}
