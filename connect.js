// Connect views: home, employee directory, circulars, news, notifications, birthdays, and the
// signed-in employee's own profile. Data comes from the GSECL Connect service through the app
// (window.Connect); the sign-in token stays in the app and never reaches this page.
// Uses $, esc, fmt, show() from index.html.

const C = {
  tab: 'home', detail: null,            // detail: {type: 'emp'|'circular'|'news'|'birthdays', id}
  home: null, dir: null, notes: null, read: new Set(),
  q: '', station: '', dept: '', blood: '',
  circ: {cat: '', q: '', items: null, page: 0, more: false, busy: false, error: ''},
  news: {items: null, page: 0, more: false, busy: false, error: ''},
  item: null, itemError: '', photos: {}, busy: 0, error: '', editMe: false, saving: false, meError: '',
};
const hasConnect = () => typeof window.Connect !== 'undefined';
// The Connect home is a hub (welcome, quick actions, today, latest, tools); every section opens as its own page with
// a back arrow. Super administrators also get the console (sa.js) as a section.
const CON_TABS = [['home', 'Connect'], ['dir', 'People'], ['circ', 'Circulars'], ['news', 'News'], ['notes', 'Notices'], ['more', 'Tools'], ['sa', 'Super admin']];
const CON_TAB_SUB = {dir: 'Directory · works offline', circ: 'Circulars and the AI assistant', news: 'News from GSECL', notes: 'Notices sent to you', more: 'Plant information, publishing and administration', sa: 'Sheet menu tasks, checks and settings'};
/** Line icons (24 × 24, stroke) used by the hub and the tool lists. */
const CON_IC = {
  people: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><circle cx="17.5" cy="9" r="2.5"/><path d="M17 14.5a5 5 0 0 1 4.5 5"/>',
  doc: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h6"/>',
  news: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 8h10M7 12h6M7 16h4"/><rect x="14" y="11" width="3" height="5" rx=".5"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  sync: '<path d="M21 12a9 9 0 0 1-15.5 6.2L3 16"/><path d="M3 21v-5h5"/><path d="M3 12a9 9 0 0 1 15.5-6.2L21 8"/><path d="M21 3v5h-5"/>',
  cake: '<path d="M4 21h16v-7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2z"/><path d="M4 16c2 1.5 4 1.5 6 0s4-1.5 6 0 4 1.5 4 0"/><path d="M12 12V8"/><path d="M12 5.5c.8-.8.8-2 0-2.5-.8.5-.8 1.7 0 2.5z"/>',
  spark: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
  chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.4A8 8 0 1 1 21 12z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  shield: '<path d="M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
  plant: '<path d="M3 21h18"/><path d="M5 21V10l5 3V10l5 3V6h4v15"/>',
  boiler: '<rect x="6" y="3" width="12" height="18" rx="3"/><path d="M10 8h4M10 12h4"/><circle cx="12" cy="17" r="1.5"/>',
  chart: '<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 6-7"/>',
  cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>',
  gauge: '<path d="M12 14l4-4"/><path d="M3.3 17a9 9 0 1 1 17.4 0"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>',
  coin: '<circle cx="12" cy="12" r="9"/><path d="M9 9h6M9 12h6M12 12l-3 4"/>',
  pie: '<path d="M21 12A9 9 0 1 1 12 3v9z"/><path d="M15 3.5A9 9 0 0 1 20.5 9H15z"/>',
  send: '<path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/>',
  photo: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>',
  idcard: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2.2"/><path d="M5.5 16a3.5 3.5 0 0 1 7 0M15 10h3M15 13h3"/>',
  pulse: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/>',
  report: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 17v-3M12 17v-6M15 17v-2"/>',
  live: '<circle cx="12" cy="12" r="2"/><path d="M16.2 7.8a6 6 0 0 1 0 8.4M7.8 16.2a6 6 0 0 1 0-8.4M19 5a10 10 0 0 1 0 14M5 19A10 10 0 0 1 5 5"/>',
  key: '<circle cx="7.5" cy="15.5" r="3.5"/><path d="M10 13l10-10M16 7l3 3M14 9l2 2"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
};
const conIc = (name, size = 22) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${CON_IC[name] || CON_IC.list}</svg>`;
/** The heading of a section page: back arrow (to the Connect home, or to `back`), title and a line below it. */
const conPageHead = (title, sub = '', back = 'home') => `<div class="pg-h"><button class="pg-back" data-cact="${back}" aria-label="Back">‹</button><div class="pg-t">${esc(title)}${sub ? `<small>${esc(sub)}</small>` : ''}</div></div>`;
const CON_CATEGORIES = ['Circular', 'Office Order', 'Notice', 'Policy', 'Tender', 'Recruitment', 'Other'];
const CON_BLOOD = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const CON_MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ---------------------------------------------------------------- service calls

const conPending = {};
let conSeq = 0;
window.__connectDone = (id, ok, body, error) => { const p = conPending[id]; delete conPending[id]; if (p) p({ok, body, error}); };
const conAsk = fn => new Promise(resolve => { const id = 'c' + (++conSeq); conPending[id] = resolve; fn(id); });

/** One service action: {ok, data, error}. */
async function conCall(action, params = {}) {
  const r = await conAsk(id => Connect.call(id, action, JSON.stringify(params)));
  let data = null;
  if (r.ok) { try { data = JSON.parse(r.body); } catch (e) { return {ok: false, data: null, error: 'Unexpected answer from the service'}; } }
  return {ok: r.ok, data, error: r.error};
}

function conSaved(key) {
  try { const s = JSON.parse(Connect.cacheGet(key) || 'null'); return s ? {age: s.age, data: JSON.parse(s.body)} : null; }
  catch (e) { return null; }
}

/** Offline-first: the copy on the phone if younger than maxAge minutes, else the service; the saved copy again if that fails. */
async function conCached(key, maxAge, force, action, params = {}) {
  const saved = conSaved(key);
  if (!force && saved && saved.age < maxAge) return {ok: true, data: saved.data};
  const fresh = await conCall(action, params);
  if (fresh.ok) { Connect.cacheSet(key, JSON.stringify(fresh.data)); return fresh; }
  return saved ? {ok: true, data: saved.data, stale: fresh.error} : fresh;
}

/**
 * Several actions in one round trip. Each call to the service costs a few seconds whatever it asks
 * for, so the opening screen sends its requests together. A service that does not know "batch" yet
 * (script not redeployed) gets them side by side instead.
 */
let conBatchOk = true;
async function conBatch(calls) {
  if (conBatchOk && calls.length > 1) {
    const r = await conCall('batch', {calls: calls.map(([action, params]) => ({action, params: params || {}}))});
    if (r.ok && Array.isArray(r.data.results)) return r.data.results.map(x => ({ok: !!x.success, data: x.data || null, error: x.error || ''}));
    if (/unknown action/i.test(r.error)) conBatchOk = false;
    else return calls.map(() => ({ok: false, data: null, error: r.error}));
  }
  return Promise.all(calls.map(([action, params]) => conCall(action, params || {})));
}

// ---------------------------------------------------------------- formatting

const CON_TITLES = new Set(['mr', 'mrs', 'ms', 'miss', 'dr', 'shri', 'shree', 'sri', 'smt', 'kum', 'km', 'er', 'prof', 'sh']);
/** "Mr. RAJESH PATEL" -> "Rajesh Patel": no leading title, and ALL-CAPS names shown in normal case. */
function conName(full) {
  const parts = String(full || '').trim().split(/\s+/);
  while (parts.length > 1 && CON_TITLES.has(parts[0].replace(/\.$/, '').toLowerCase())) parts.shift();
  let name = parts.join(' ');
  const letters = name.replace(/[^A-Za-z]/g, '');
  if (letters.length > 1 && letters === letters.toUpperCase()) name = name.toLowerCase().replace(/(^|[\s.])([a-z])/g, (m, a, b) => a + b.toUpperCase());
  return name;
}
const conInitials = name => { const p = conName(name).split(' ').filter(Boolean); return ((p[0] || '').slice(0, 1) + (p.length > 1 ? p[p.length - 1].slice(0, 1) : '')).toUpperCase(); };
/** "2026-05-31" or "2026-05-31 14:05:00" -> "31 May 2026" (+ time when asked). */
function conDate(s, withTime = false) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(String(s || ''));
  if (!m) return esc(s || '—');
  return `${m[3]} ${CON_MON[+m[2] - 1]} ${m[1]}` + (withTime && m[4] ? `, ${m[4]}:${m[5]}` : '');
}
const conAvatar = (e, size = 40) => `<span style="width:${size}px;height:${size}px;border-radius:50%;flex:none;display:grid;place-items:center;font-weight:700;font-size:${Math.round(size * 0.38)}px;color:#fff;background:linear-gradient(135deg,var(--brand),var(--brand2));overflow:hidden">${
  e.photo_id && C.photos[e.photo_id] ? `<img src="${C.photos[e.photo_id]}" style="width:100%;height:100%;object-fit:cover" alt="">` : esc(conInitials(e.full_name))}</span>`;
/** The photo with a status dot: green when the employee's app access is active, grey when it is not. */
const conAvatarDot = (e, size = 40) => {
  const d = Math.max(10, Math.round(size * 0.28)), on = !e.app_blocked;
  return `<span style="position:relative;flex:none;display:inline-block">${conAvatar(e, size)}<i title="${on ? 'Active' : 'Inactive'}" aria-label="${on ? 'Active' : 'Inactive'}"
    style="position:absolute;right:0;bottom:0;width:${d}px;height:${d}px;border-radius:50%;background:${on ? '#22c55e' : '#9ca3af'};border:2px solid var(--card,#fff)"></i></span>`;
};
const conMore = t => `<span class="more muted" style="font-weight:500;font-size:11.5px">${esc(t)}</span>`;
const conBack = label => conPageHead(label, '', 'back');
const conBtn = (label, act, arg = '', primary = false) => `<button class="btn" data-cact="${act}" data-carg="${esc(arg)}" style="${primary ? 'background:var(--accent);color:#fff;border-color:var(--accent)' : 'color:var(--accent)'}">${esc(label)}</button>`;
const conEmpty = t => `<div class="empty">${esc(t)}</div>`;
const conErr = t => t ? `<div class="alert err"><span>⚠</span><span>${esc(t)}</span></div>` : '';
const conSpin = () => '<div class="sk" style="height:86px;margin-bottom:10px"></div>'.repeat(3);

// ---------------------------------------------------------------- data loading

async function conLoadHome(force = false) {
  const r = await conCached('home', 5, force, 'home');
  if (r.ok) C.home = r.data; else C.error = r.error;
}

/** The whole directory is kept on the phone; the service resends it only when the employee sheet changed. */
async function conLoadDirectory(force = false) {
  const saved = conSaved('directory');
  if (saved && !C.dir) C.dir = saved.data;
  if (saved && !force && saved.age < 24 * 60) return;
  const r = await conCall('directory', {version: C.dir?.employees?.length ? C.dir.version : null});
  if (!r.ok) { if (!C.dir) C.error = r.error; return; }
  if (!r.data.unchanged) C.dir = {version: r.data.version, employees: r.data.employees || [], stations: r.data.stations || [], departments: r.data.departments || []};
  if (C.dir) Connect.cacheSet('directory', JSON.stringify(C.dir));
}

async function conLoadNotes(force = false) {
  C.read = new Set(JSON.parse(Connect.readIds() || '[]'));
  const r = await conCached('notifications', 5, force, 'notifications');
  if (r.ok) C.notes = r.data.items || [];
  conBadge();
}

function conBadge() {
  const n = (C.notes || []).filter(x => !C.read.has(x.id)).length, el = $('conCnt');
  if (el) { el.hidden = !n; el.textContent = n; }
}

async function conLoadList(kind, reset, force = false) {
  const L = C[kind];
  if (L.busy) return;
  L.busy = true; L.error = '';
  if (reset) { L.page = 0; L.items = null; }
  const page = L.page + 1, searching = kind === 'circ' && !!L.q.trim();
  const params = kind === 'circ' ? {page, q: L.q.trim() || null, category: L.cat || null} : {page};
  const action = kind === 'circ' ? 'circulars' : 'news', key = kind === 'circ' ? 'circulars_' + (L.cat || 'all') : 'news_1';
  // The first page is kept on the phone: show it at once, and ask the service only if it is over 30 minutes old.
  const saved = page === 1 && !searching ? conSaved(key) : null;
  if (saved) {
    L.items = saved.data.items || []; L.page = 1; L.more = !!saved.data.has_more;
    if (!force && saved.age < 30) { L.busy = false; return conRender(); }
  }
  conRender();
  const r = await conCall(action, params);
  L.busy = false;
  if (r.ok) {
    if (page === 1 && !searching) Connect.cacheSet(key, JSON.stringify(r.data));
    L.items = (page === 1 ? [] : L.items || []).concat(r.data.items || []); L.page = page; L.more = !!r.data.has_more;
  } else if (!saved) { L.error = r.error; L.items = L.items || []; }
  conRender();
}

async function conLoadItem(type, id) {
  C.item = null; C.itemError = '';
  const r = type === 'circular' ? await conCached('circular_' + id, 24 * 60, false, 'circular', {id: +id})
    : type === 'news' ? await conCached('news_item_' + id, 24 * 60, false, 'news_item', {id: +id})
    : await conCall('employee', {emp_no: id});
  if (r.ok) C.item = r.data.circular || r.data.news || r.data.employee;
  else if (type === 'emp') C.item = (C.dir?.employees || []).find(e => e.emp_no === id) || null;   // the offline copy will do
  if (!C.item) C.itemError = r.error || 'Not found';
  if (C.detail && String(C.detail.id) === String(id)) conRender();
  const pic = C.item && (C.item.photo_id || C.item.image_id);
  if (pic) conPhoto(pic);
}

/** Loads a picture once and redraws whatever is showing it. */
async function conPhoto(fileId) {
  if (!fileId || C.photos[fileId] !== undefined) return;
  C.photos[fileId] = '';
  const r = await conAsk(id => Connect.image(id, fileId));
  if (r.ok) { C.photos[fileId] = r.body; conRender(); meRender(); }
}

// ---------------------------------------------------------------- lists

const conBirthdayKey = offset => { const d = new Date(); d.setDate(d.getDate() + offset); return String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const conBirthdays = key => (C.dir?.employees || []).filter(e => e.birthday === key).sort((a, b) => conName(a.full_name).localeCompare(conName(b.full_name)));

const conBloodOf = e => String(e.blood_group || '').toUpperCase().replace(/\s|VE$/g, '').replace(/POSITIVE$/, '+').replace(/NEGATIVE$/, '-');
/** "O+", "b-", "AB+ve" typed in the search box: a blood group, matched exactly (not as text). */
const conBloodWord = w => { const b = w.toUpperCase().replace(/VE$/, ''); return CON_BLOOD.includes(b) ? b : null; };
const conEmpRow = e => `<div class="srow" data-cact="emp" data-carg="${esc(e.emp_no)}"><div style="display:flex;align-items:center;gap:10px">${conAvatarDot(e)}
  <div style="min-width:0;flex:1"><div class="nm" style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(conName(e.full_name))}</div>
  <div class="vals" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc([e.designation, e.station_short || e.station].filter(Boolean).join(' · '))}</div></div>
  ${C.showBlood && conBloodOf(e) ? `<span class="badge b-Forced" style="flex:none">${esc(conBloodOf(e))}</span>` : ''}
  ${e.mobile ? `<button class="refresh" data-cact="dial" data-carg="${esc(e.mobile)}" aria-label="Call" style="background:var(--soft);color:var(--accent)"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.300-1.300a2 2 0 0 1 2.100-.400c.900.300 1.800.600 2.800.700a2 2 0 0 1 1.700 2z"/></svg></button>` : ''}</div></div>`;

const conCircRow = c => `<div class="oq" style="--oc:${c.is_important ? 'var(--forced)' : 'var(--accent)'}" data-cact="circular" data-carg="${c.id}">
  <div class="oq-h"><span class="nm" style="font-size:14px">${esc(c.title)}</span></div>
  <div class="live">${[c.category && `<span class="src-tag" style="margin-left:0">${esc(c.category)}</span>`, c.is_important ? '<span class="badge b-Forced">Important</span>' : '', conDate(c.issue_date), esc(c.circular_no || ''), esc(c.station || 'All GSECL')].filter(Boolean).join(' · ')}</div>
  ${c.summary ? `<div class="rs" style="margin-top:6px">${esc(c.summary)}</div>` : ''}
  ${c.ai && c.ai.summary ? `<div class="rs" style="margin-top:6px"><span class="src-tag" style="margin-left:0">AI</span> ${esc(c.ai.summary)}</div>` : ''}</div>`;

const conNewsRow = n => `<div class="oq" style="--oc:var(--brand2)" data-cact="news" data-carg="${n.id}">
  <div class="oq-h"><span class="nm" style="font-size:14px">${esc(n.title)}</span></div>
  <div class="live">${conDate(n.published_at, true)} · ${esc(n.station || 'All GSECL')}</div>
  ${n.excerpt ? `<div class="rs" style="margin-top:6px">${esc(n.excerpt)}</div>` : ''}</div>`;

function conTabHome() {
  const h = C.home, me = h?.user || JSON.parse(Native.account() || '{}');
  const today = conBirthdays(conBirthdayKey(0)), unreadList = (C.notes || []).filter(x => !C.read.has(x.id)), unread = unreadList.length;
  const hr = new Date().getHours(), hello = hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';
  const tile = (act, arg, label, icon, color, count, soft) => `<button class="qa" data-cact="${act}" data-carg="${esc(arg)}" style="--qc:${color}"><span class="qi">${conIc(icon)}</span>${esc(label)}${count ? `<span class="qn${soft ? ' soft' : ''}">${esc(String(count))}</span>` : ''}</button>`;
  const chat = !!document.querySelector('[data-v="chat"]');
  let s = `<div class="hub-hero"><div class="hh">${conAvatar(me, 52)}<div class="hi"><div class="hg">${hello}</div>
      <div class="hn">${esc(conName(me.full_name) || 'GSECL Connect')}</div><div class="hd">${esc([me.designation, me.station_short || me.station].filter(Boolean).join(' · '))}</div></div>
      <span class="hub-acts"><button class="hub-bell sync${C.busy ? ' on' : ''}" data-cact="sync" aria-label="Sync now">${conIc('sync', 20)}</button>
      <button class="hub-bell${unread ? ' ring' : ''}" data-cact="tab" data-carg="notes" aria-label="Notices${unread ? ', ' + unread + ' unread' : ''}">${conIc('bell')}${unread ? `<b>${unread > 99 ? '99+' : unread}</b>` : ''}</button></span></div>
    <button class="hub-search" data-cact="tab" data-carg="dir">${conIc('search', 18)}Search people, phone numbers, blood group…</button>
    <div class="hub-sync${C.busy ? ' on' : ''}"><i></i>${C.busy ? 'Syncing with GSECL Connect…' : C.syncedAt ? 'Up to date · synced ' + new Date(C.syncedAt).toLocaleTimeString('en-IN', {hour: '2-digit', minute: '2-digit'}) : 'Saved copy on this phone'}</div></div>
    <div class="qa-grid">
      ${tile('tab', 'dir', 'People', 'people', '#2563eb', h ? fmt(h.employee_count) : '', true)}
      ${tile('tab', 'circ', 'Circulars', 'doc', 'var(--accent)')}
      ${tile('tab', 'news', 'News', 'news', 'var(--brand2)')}
      ${tile('tab', 'notes', 'Notices', 'bell', '#dc2626', unread)}
      ${tile('birthdays', '', 'Birthdays', 'cake', '#db2777', C.dir ? today.length : '', true)}
      ${tile('ask', '', 'Ask AI', 'spark', '#7c3aed')}
      ${chat ? tile('view', 'chat', 'Chat', 'chat', '#0891b2') : tile('tab', 'more', 'Tools', 'list', '#0891b2')}
      ${tile('view', 'info', 'My profile', 'user', '#475569')}
    </div>`;
  if (me.role === 'superadmin') s += `<button class="sa-banner" data-cact="tab" data-carg="sa"><span class="qi">${conIc('shield')}</span><span style="flex:1;min-width:0"><b>Super admin console</b>
      <small>Sheet menu tasks, checks, settings and service health</small></span><span class="muted" style="font-size:20px">›</span></button>`;
  if (unreadList.length) s += `<div class="card"><h2>New for you <span class="more" data-cact="tab" data-carg="notes">All ›</span></h2>${unreadList.slice(0, 3).map(n => `<div class="tl-row" data-cact="note" data-carg="${n.id}" style="--qc:${n.type === 'urgent' ? 'var(--forced)' : 'var(--accent)'}">
      <span class="qi">${conIc(n.type === 'circular' ? 'doc' : n.type === 'news' ? 'news' : 'bell', 18)}</span><span class="tx"><b>${esc(n.title)}</b><small>${esc(n.message || '')}</small></span><span class="tag">${conDate(n.created_at)}</span></div>`).join('')}</div>`;
  if (today.length) s += `<div class="card"><h2>Birthdays today 🎂 <span class="more" data-cact="birthdays">All ›</span></h2><div class="bd-strip">${today.slice(0, 12).map(e => `<div data-cact="emp" data-carg="${esc(e.emp_no)}" style="cursor:pointer">${conAvatar(e, 56)}<span class="nm">${esc(conName(e.full_name).split(' ')[0])}</span></div>`).join('')}</div></div>`;
  if (!h) return s + conErr(C.error) + (C.busy ? conSpin() : '') + conToolsCard();
  const circ = (h.latest_circulars || []).slice(0, 3), news = (h.latest_news || []).slice(0, 3);
  s += `<div class="card"><h2>Latest circulars <span class="more" data-cact="tab" data-carg="circ">All ›</span></h2>${circ.length ? circ.map(c => `<div class="tl-row" data-cact="circular" data-carg="${c.id}" style="--qc:${c.is_important ? 'var(--forced)' : 'var(--accent)'}">
      <span class="qi">${conIc('doc', 18)}</span><span class="tx"><b>${esc(c.title)}</b><small>${esc([c.category, conDate(c.issue_date), c.station || 'All GSECL'].filter(Boolean).join(' · '))}</small></span>${c.is_important ? '<span class="tag" style="color:var(--forced)">Important</span>' : '<span class="go">›</span>'}</div>`).join('') : conEmpty('No circulars yet.')}</div>`;
  s += `<div class="card"><h2>Latest news <span class="more" data-cact="tab" data-carg="news">All ›</span></h2>${news.length ? news.map(n => `<div class="tl-row" data-cact="news" data-carg="${n.id}" style="--qc:var(--brand2)">
      <span class="qi">${conIc('news', 18)}</span><span class="tx"><b>${esc(n.title)}</b><small>${esc(conDate(n.published_at, true) + ' · ' + (n.station || 'All GSECL'))}</small></span><span class="go">›</span></div>`).join('') : conEmpty('No news yet.')}</div>`;
  return s + conToolsCard();
}

/** The tools this employee has (W_PAGES of work.js), on the hub: the first five, then a link to all. */
function conToolsCard() {
  if (typeof W_PAGES === 'undefined' || typeof wCan !== 'function' || typeof wToolRow !== 'function') return '';
  const rows = W_PAGES.filter(p => wCan(p[3], p[4]));
  if (!rows.length) return '';
  return `<div class="card"><h2>Your tools <span class="more" data-cact="tab" data-carg="more">All ›</span></h2>${rows.slice(0, 5).map(p => wToolRow(p, 'tool')).join('')}
    ${rows.length > 5 ? `<div class="tl-row" data-cact="tab" data-carg="more"><span class="qi">${conIc('list', 18)}</span><span class="tx"><b>${rows.length - 5} more tools</b><small>Plant information, publishing and administration</small></span><span class="go">›</span></div>` : ''}</div>`;
}

function conDirMatches() {
  let words = C.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const typed = words.map(conBloodWord).filter(Boolean), blood = C.blood || typed[0] || '';
  words = words.filter(w => !conBloodWord(w));
  C.showBlood = !!blood;
  return (C.dir?.employees || []).filter(e => {
    if (C.station && String(e.station_id) !== C.station) return false;
    if (C.dept && String(e.department_id) !== C.dept) return false;
    if (blood && conBloodOf(e) !== blood) return false;
    if (!words.length) return true;
    const hay = e._s || (e._s = [e.full_name, e.emp_no, e.designation, e.department, e.station, e.station_short, e.mobile, e.extension, e.email].filter(Boolean).join(' ').toLowerCase());
    return words.every(w => hay.includes(w));
  });
}

// The whole list is reachable: the first rows are drawn at once and the next ones as the end of the list scrolls into view.
const CON_DIR_FIRST = 100, CON_DIR_STEP = 200;
function conDirList() {
  const list = conDirMatches(), shown = list.slice(0, CON_DIR_FIRST);
  C.dirShown = shown.length;
  const h = `<div class="card"><h2>${fmt(list.length)} employee${list.length === 1 ? '' : 's'}</h2>
    ${shown.map(conEmpRow).join('') || conEmpty(C.showBlood ? 'No employee of this blood group matches. Blood group is shown only where it is recorded in the employee record.' : 'No employee matches.')}
    ${conDirMoreBtn(list.length)}</div>`;
  C.showBlood = false;                                   // the blood-group badge is for this list only
  setTimeout(conDirWatch, 0);
  return h;
}
const conDirMoreBtn = total => total > C.dirShown ? `<div id="conDirMore" style="text-align:center;padding:10px 0 2px">${conBtn(`Show more (${fmt(total - C.dirShown)} more)`, 'dirmore')}</div>` : '';
/** The next rows of the same list, added below the ones shown. */
function conDirAppend() {
  const more = $('conDirMore'); if (!more) return;
  const list = conDirMatches(), next = list.slice(C.dirShown, C.dirShown + CON_DIR_STEP);
  C.dirShown += next.length;
  more.insertAdjacentHTML('beforebegin', next.map(conEmpRow).join(''));
  C.showBlood = false;
  if (C.dirShown >= list.length) more.remove(); else more.outerHTML = conDirMoreBtn(list.length);
  conDirWatch();
}
function conDirWatch() {
  const more = $('conDirMore');
  if (!more || typeof IntersectionObserver === 'undefined') return;
  if (C.dirObs) C.dirObs.disconnect();
  C.dirObs = new IntersectionObserver(es => { if (es.some(x => x.isIntersecting)) { C.dirObs.disconnect(); conDirAppend(); } }, {rootMargin: '600px 0px'});
  C.dirObs.observe(more);
}

/** Departments that have someone at the chosen station (all departments when no station is chosen), with the count. */
function conDirDepts() {
  const emps = (C.dir?.employees || []).filter(e => !C.station || String(e.station_id) === C.station), n = {};
  emps.forEach(e => { n[e.department_id] = (n[e.department_id] || 0) + 1; });
  return (C.dir?.departments || []).filter(d => !C.station || n[d.id]).map(d => ({...d, count: n[d.id] || 0}));
}
function conDeptSelect() {
  const list = conDirDepts();
  if (C.dept && !list.some(d => String(d.id) === C.dept)) C.dept = '';
  return `<select class="search" data-csel="dept" id="conDept" style="margin:0"><option value="">${C.station ? `All departments (${list.length})` : 'All departments'}</option>${list.map(x => `<option value="${x.id}" ${String(x.id) === C.dept ? 'selected' : ''}>${esc(x.short_name || x.name)}${C.station ? ` · ${x.count}` : ''}</option>`).join('')}</select>`;
}

/** Blood groups with the number of people of each (at the chosen station / department). */
function conBloodOptions() {
  const n = {};
  (C.dir?.employees || []).filter(e => (!C.station || String(e.station_id) === C.station) && (!C.dept || String(e.department_id) === C.dept))
    .forEach(e => { const b = conBloodOf(e); if (b) n[b] = (n[b] || 0) + 1; });
  return `<option value="">Any blood group</option>` + CON_BLOOD.map(b => `<option value="${b}" ${C.blood === b ? 'selected' : ''}>Blood group ${b} · ${n[b] || 0}</option>`).join('');
}

function conTabDir() {
  if (!C.dir) return conErr(C.error) + (C.busy ? conSpin() : `<div class="card">${conEmpty('The directory has not been downloaded yet.')}${conBtn('Download directory', 'syncdir', '', true)}</div>`);
  const opt = (list, cur, all, label) => `<select class="search" data-csel="${label}" style="margin:0"><option value="">${all}</option>${list.map(x => `<option value="${x.id}" ${String(x.id) === cur ? 'selected' : ''}>${esc(x.short_name || x.name)}</option>`).join('')}</select>`;
  return `<input class="search" id="conQ" type="search" placeholder="Search name, number, designation, phone, blood group…" value="${esc(C.q)}" autocomplete="off">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">${opt(C.dir.stations, C.station, 'All stations', 'station')}${conDeptSelect()}</div>
    <select class="search" data-csel="blood" id="conBlood" style="margin:-2px 0 10px">${conBloodOptions()}</select>
    <div id="conDirList">${conDirList()}</div>
    <div class="note-src" style="text-align:center">Kept on this phone, so search works offline. <a data-cact="syncdir">Refresh directory</a></div>`;
}

function conListTail(L, kind) {
  return conErr(L.error) + (L.busy ? conSpin() : L.more ? `<div style="text-align:center">${conBtn('Load more', 'more', kind)}</div>` : '');
}

// ---------------------------------------------------------------- circulars assistant (circ_ask on the service)
// Questions about the circulars (LTC, leave, allowances …) answered by AI from the circulars' own text, for the
// employee's designation and class, with the circulars it used. The last two exchanges go with a follow-up question.
const CA = {q: '', busy: false, hist: [], err: '', state: null, reading: false, note: ''};
function conCircAsk() {
  if (!CA.state && !CA.stateBusy && hasConnect()) { CA.stateBusy = true; conCall('circ_ai', {}).then(r => { CA.stateBusy = false; if (r.ok) { CA.state = r.data; if (C.tab === 'circ' && !C.detail) conRender(); } }); }
  const st = CA.state, para = t => esc(t).replace(/\n/g, '<br>');
  const turns = CA.hist.map(h => `<div class="ca-q">${esc(h.q)}</div><div class="ca-a" role="article">${para(h.a)}
      ${h.sources && h.sources.length ? `<div class="ca-src">From: ${h.sources.map(s => s.id ? `<button class="chip" data-cact="circular" data-carg="${s.id}" style="padding:3px 10px;font-size:12px">📄 ${esc([s.no, s.title].filter(Boolean).join(' · ').slice(0, 60))}</button>` : `<span class="chip" style="padding:3px 10px;font-size:12px">📄 ${esc(s.title.slice(0, 60))}</span>`).join('')}</div>` : ''}</div>`).join('');
  return `<div class="card ca"><h2>🤖 Ask about circulars <span class="more muted" style="font-weight:500;font-size:11.5px">AI · answers from the circulars</span></h2>
    ${turns}
    ${CA.busy ? '<div class="ca-a"><span class="muted">Reading the circulars…</span></div>' : ''}
    ${CA.err ? conErr(CA.err) : ''}
    <label for="conAskQ" class="muted" style="font-size:12px;display:block;margin-top:${CA.hist.length ? 10 : 0}px">${CA.hist.length ? 'Ask a follow-up, or a new question' : 'Your question'}</label>
    <textarea class="search" id="conAskQ" rows="2" maxlength="600" placeholder="e.g. What is my LTC entitlement? · Leave encashment for Class III · Uniform allowance rate" style="margin:4px 0 8px;resize:vertical">${esc(CA.q)}</textarea>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">${conBtn(CA.busy ? 'Asking…' : 'Ask', 'circask', '', true)}${CA.hist.length ? conBtn('New conversation', 'circnew') : ''}</div>
    <div class="note-src" style="margin-top:8px">Answers are written by AI${st && st.ai ? ' (' + esc(st.ai === 'Gemini' ? 'Google Gemini' : st.ai) + ')' : ''} from the circulars${st ? ` (${st.read} read so far; new ones are read automatically)` : ''} for your designation and class, and can be wrong: check the circular named before acting on it. Your question goes to ${st && st.ai === 'Claude' ? 'Anthropic' : 'Google'}, the AI provider.${CA.note ? ' ' + esc(CA.note) : ''}</div></div>`;
}
async function conCircAskGo() {
  const q = String(CA.q || '').trim();
  if (CA.busy || q.length < 3) { if (q.length < 3) { CA.err = 'Type your question about the circulars.'; conRender(); } return; }
  CA.busy = true; CA.err = ''; conRender();
  const r = await conCall('circ_ask', {q, history: CA.hist.slice(-2).map(h => ({q: h.q, a: h.a}))});
  CA.busy = false;
  if (r.ok) { CA.hist.push({q, a: r.data.answer, sources: r.data.sources || []}); CA.q = ''; CA.note = r.data.remaining !== undefined ? r.data.remaining + ' questions left today.' : ''; }
  else CA.err = /unknown action/i.test(r.error || '') ? 'The circulars assistant comes with the updated GSECL Connect script.' : r.error;
  conRender();
  const a = document.querySelectorAll('.ca-a'); if (a.length) a[a.length - 1].scrollIntoView({block: 'nearest', behavior: 'smooth'});
}
async function conCircRead() {
  if (CA.reading) return;
  CA.reading = true; CA.err = ''; conRender();
  const r = await conCall('circ_ai', {read: true, limit: 8});
  CA.reading = false;
  if (r.ok) { CA.state = r.data; CA.note = r.data.ran ? r.data.ran.message + (r.data.ran.read >= 8 ? ' More remain: tap again.' : '') : ''; } else CA.err = r.error;
  conRender();
}

function conTabCirc() {
  const L = C.circ;
  return conCircAsk() + `<input class="search" id="conCircQ" type="search" placeholder="Search circulars… (press Enter)" value="${esc(L.q)}" autocomplete="off">
    <div class="chips">${[['', 'All']].concat(CON_CATEGORIES.map(c => [c, c])).map(([v, l]) => `<button class="chip ${L.cat === v ? 'on' : ''}" data-cact="cat" data-carg="${esc(v)}">${esc(l)}</button>`).join('')}</div>
    ${L.items && !L.items.length && !L.busy && !L.error ? `<div class="card">${conEmpty('No circulars found.')}</div>` : (L.items || []).map(conCircRow).join('')}${conListTail(L, 'circ')}`;
}

function conTabNews() {
  const L = C.news;
  return (L.items && !L.items.length && !L.busy && !L.error ? `<div class="card">${conEmpty('No news yet.')}</div>` : (L.items || []).map(conNewsRow).join('')) + conListTail(L, 'news');
}

function conTabNotes() {
  if (!C.notes) return C.busy ? conSpin() : `<div class="card">${conEmpty('Could not load notices.')}</div>`;
  if (!C.notes.length) return `<div class="card">${conEmpty('No notices for you.')}</div>`;
  const dot = {urgent: 'var(--forced)', circular: 'var(--accent)', news: 'var(--brand2)'};
  return `<div class="card"><h2>Notices <span class="more" data-cact="readall">Mark all read</span></h2>${C.notes.map(n => `<div class="nrow" data-cact="note" data-carg="${n.id}">
    <span class="sd" style="background:${C.read.has(n.id) ? 'var(--line)' : dot[n.type] || 'var(--run)'}"></span>
    <div class="nb"><b>${esc(n.title)}${C.read.has(n.id) ? '' : '<span class="nnew">NEW</span>'}</b><div class="nt">${esc(n.message)}</div></div>
    <span class="tm2">${conDate(n.created_at)}</span></div>`).join('')}</div>`;
}

// ---------------------------------------------------------------- detail pages

const conField = (label, value) => value ? `<div><span>${esc(label)}</span>${value}</div>` : '';

function conDetailEmp(id) {
  const e = C.item || (C.dir?.employees || []).find(x => x.emp_no === id);
  if (!e) return conBack('Directory') + (C.itemError ? conErr(C.itemError) : conSpin());
  const name = conName(e.full_name);
  const act = (label, a, arg) => arg ? conBtn(label, a, arg) : '';
  return conBack('Directory') + `<div class="card"><div style="display:flex;align-items:center;gap:14px">${conAvatarDot(e, 72)}
      <div style="min-width:0"><div style="font-size:18px;font-weight:700">${esc(name)}</div>
      <div class="muted" style="font-size:13px">${esc(e.designation || '')}</div>
      <div class="muted" style="font-size:12.5px">Employee no. ${esc(e.emp_no)}${e.class ? ' · Class ' + esc(e.class) : ''}</div></div></div>
    <div class="muted" style="font-size:12.5px;margin-top:10px;display:flex;align-items:center;gap:6px"><i style="width:9px;height:9px;border-radius:50%;background:${e.app_blocked ? '#9ca3af' : '#22c55e'}"></i>${e.app_blocked ? 'Inactive in GSECL Connect' : 'Active in GSECL Connect'}</div>
    <div class="oq" style="box-shadow:none;padding:0;margin:14px 0 0;border:0"><div class="meta num">
      ${conField('Station', esc(e.station || e.station_short || ''))}${conField('Department', esc(e.department || ''))}
      ${conField('Mobile', esc(e.mobile || ''))}${conField('Office phone', esc([e.office_phone, e.extension && 'Ext ' + e.extension].filter(Boolean).join(' · ')))}
      ${conField('E-mail', esc(e.email || ''))}${conField('Blood group', esc(e.blood_group || ''))}
    </div></div>
    <div>${!e.app_blocked && typeof window.chatWith === 'function' && typeof window.Chat !== 'undefined' ? conBtn('Message (encrypted)', 'chatwith', e.emp_no, true) + ' ' : ''}${act('Call', 'dial', e.mobile)} ${act('SMS', 'sms', e.mobile)} ${act('WhatsApp', 'whatsapp', e.mobile)} ${act('Call office', 'dial', e.office_phone)} ${act('E-mail', 'email', e.email)}
      ${conBtn('Save contact', 'savecontact', e.emp_no)} ${conBtn('Share', 'sharecontact', e.emp_no)}</div></div>`;
}

function conDetailCircular() {
  const c = C.item;
  if (!c) return conBack('Circulars') + (C.itemError ? conErr(C.itemError) : conSpin());
  const a = c.attachment;
  return conBack('Circulars') + `<div class="card"><div style="font-size:17px;font-weight:700;margin-bottom:6px">${esc(c.title)}</div>
    <div>${c.is_important ? '<span class="badge b-Forced">Important</span> ' : ''}<span class="src-tag" style="margin-left:0">${esc(c.category || '')}</span></div>
    <div class="oq" style="box-shadow:none;padding:0;margin:12px 0 0;border:0"><div class="meta num">
      ${conField('Circular no.', esc(c.circular_no || ''))}${conField('Issue date', conDate(c.issue_date))}
      ${conField('Issued by', esc(c.issued_by || ''))}${conField('Applies to', esc(c.station || 'All GSECL'))}</div>
      ${c.summary ? `<div class="rs" style="white-space:pre-wrap">${esc(c.summary)}</div>` : ''}</div>
    ${c.ai && c.ai.summary ? `<div class="blk" style="border-left:4px solid #7c3aed"><div class="blk-h">In short <span>AI · Google Gemini</span></div>
      <div style="white-space:pre-wrap">${esc(c.ai.summary)}</div>${c.ai.gu ? `<div lang="gu" style="white-space:pre-wrap;margin-top:8px">${esc(c.ai.gu)}</div>` : ''}
      ${(c.ai.keywords || []).length ? `<div style="margin-top:8px">${c.ai.keywords.map(k => `<span class="src-tag" style="margin:0 4px 4px 0">${esc(k)}</span>`).join('')}</div>` : ''}
      <div class="blk-sub">Written by AI from the document; the circular itself is what applies.</div></div>` : ''}
    ${a ? `<div class="blk"><div class="blk-h">${esc(a.name || 'Document')}<span>${a.size ? fmt(a.size / 1024) + ' KB' : ''}</span></div>${conBtn(C.opening ? 'Opening…' : 'Open document', 'openfile', a.id, true)}
      <div class="blk-sub">Downloaded once, then kept on this phone.</div></div>` : '<div class="note-src">No document attached.</div>'}</div>`;
}

function conDetailNews() {
  const n = C.item;
  if (!n) return conBack('News') + (C.itemError ? conErr(C.itemError) : conSpin());
  const pic = n.image_id && C.photos[n.image_id];
  return conBack('News') + `<div class="card">${pic ? `<img src="${pic}" alt="" style="width:100%;border-radius:12px;margin-bottom:12px">` : n.image_id ? '<div class="sk" style="height:160px;margin-bottom:12px"></div>' : ''}
    <div style="font-size:17px;font-weight:700">${esc(n.title)}</div>
    <div class="muted" style="font-size:12.5px;margin:4px 0 12px">${conDate(n.published_at, true)} · ${esc(n.station || 'All GSECL')}</div>
    <div style="white-space:pre-wrap;font-size:14px">${esc(n.body || n.excerpt || '')}</div></div>`;
}

/** Today's birthdays in full (the employee cards, with call / message / WhatsApp from each). */
function conDetailBirthdays() {
  const now = new Date(), list = conBirthdays(conBirthdayKey(0));
  return conBack('Home') + `<div class="card"><h2>Birthdays today · ${now.getDate()} ${CON_MON[now.getMonth()]}</h2>${
    list.length ? list.map(conEmpRow).join('') : conEmpty(C.dir ? 'No birthdays today.' : 'The directory has not been downloaded yet.')}</div>`;
}

// ---------------------------------------------------------------- render & interaction

function conRender() {
  const box = $('conBody');
  if (!box || !$('v-connect').classList.contains('on')) return;
  if (!hasConnect()) { box.innerHTML = `<div class="card">${conEmpty('Connect is available in the Android app.')}</div>`; return; }
  const keep = document.activeElement?.id, caret = document.activeElement?.selectionStart;
  let h;
  if (C.detail) {
    h = C.detail.type === 'emp' ? conDetailEmp(C.detail.id) : C.detail.type === 'circular' ? conDetailCircular() : C.detail.type === 'news' ? conDetailNews() : conDetailBirthdays();
  } else {
    const inner = C.tab === 'more' && typeof W !== 'undefined' && (W.page || W.form);   // a tool's own page has its own back
    const sa = C.tab === 'sa' && typeof saInner === 'function' && saInner();             // so has a console page
    const head = C.tab === 'home' || inner || sa ? '' : conPageHead((CON_TABS.find(t => t[0] === C.tab) || ['', ''])[1], CON_TAB_SUB[C.tab] || '');
    h = head + ({home: conTabHome, dir: conTabDir, circ: conTabCirc, news: conTabNews, notes: conTabNotes, more: () => wTab(),
      sa: () => (typeof saRender === 'function' ? saRender() : conEmpty('The console comes with the updated app.'))}[C.tab] || conTabHome)();
  }
  // Saved data is on screen while a fresh copy is fetched; say so quietly instead of blanking the page.
  const updating = (C.busy || C.circ.busy || C.news.busy || (typeof W !== 'undefined' && W.busy) || (typeof SA !== 'undefined' && (SA.loading || SA.busy))) ? '<div class="sync-bar" role="progressbar" aria-label="Updating"></div>' : '';
  box.innerHTML = updating + h + '<div class="credit">Developed by <b>A D Bhatt</b>, EE, GSECL</div>';
  // a new page slides in (from the right going in, from the left coming back); redraws of the same page stay still
  const key = [C.tab, C.detail ? C.detail.type + C.detail.id : '', typeof W !== 'undefined' ? W.page + (W.form ? 'f' : '') : '', typeof SA !== 'undefined' ? SA.view + SA.cur : ''].join('|');
  if (key !== C.navKey) {
    C.navKey = key;
    box.classList.remove('nav-fwd', 'nav-back'); void box.offsetWidth;
    box.classList.add(C.navDir === 'back' ? 'nav-back' : 'nav-fwd');
    clearTimeout(C.navT); C.navT = setTimeout(() => box.classList.remove('nav-fwd', 'nav-back'), 650);
  }
  if (keep && $(keep)) { $(keep).focus(); try { $(keep).setSelectionRange(caret, caret); } catch (e) { /* not a text box */ } }
}

function conGo(detail) { C.detail = detail; conRender(); window.scrollTo({top: 0}); }

function conOpenTab(tab, force = false) {
  C.tab = tab; C.detail = null; C.error = '';
  if (tab === 'circ' && (force || !C.circ.items)) conLoadList('circ', true, force);
  if (tab === 'news' && (force || !C.news.items)) conLoadList('news', true, force);
  conRender();
  window.scrollTo({top: 0});
}

/** Opening the Connect view: show what is saved at once, then refresh only what has gone old, in one request. */
async function conRefresh(force = false) {
  const saved = {home: conSaved('home'), notifications: conSaved('notifications'), directory: conSaved('directory')};
  if (saved.home && !C.home) C.home = saved.home.data;
  if (saved.notifications && !C.notes) C.notes = saved.notifications.data.items || [];
  if (saved.directory && !C.dir) C.dir = saved.directory.data;
  C.read = new Set(JSON.parse(Connect.readIds() || '[]'));
  conBadge(); conRender(); meRender();

  const maxAge = {home: 5, notifications: 5, directory: 24 * 60};
  const need = Object.keys(maxAge).filter(k => force || !saved[k] || saved[k].age >= maxAge[k]);
  if (!need.length) return;
  C.busy++; conRender();
  const res = await conBatch(need.map(k => [k, k === 'directory' ? {version: C.dir?.employees?.length ? C.dir.version : null} : {}]));
  need.forEach((k, i) => {
    const r = res[i];
    if (!r.ok) { if (!saved[k]) C.error = r.error; return; }
    if (k === 'home') C.home = r.data;
    if (k === 'notifications') C.notes = r.data.items || [];
    if (k === 'directory') {
      if (!r.data.unchanged) C.dir = {version: r.data.version, employees: r.data.employees || [], stations: r.data.stations || [], departments: r.data.departments || []};
      if (C.dir) Connect.cacheSet('directory', JSON.stringify(C.dir));
    } else Connect.cacheSet(k, JSON.stringify(r.data));
  });
  C.busy--; C.syncedAt = Date.now(); conBadge(); conRender(); meRender();
  // The home answer carries the directory's version: a changed Employees tab (someone added in the Sheet) is
  // fetched now instead of at the next daily refresh.
  const v = C.home && C.home.dir_version;
  if (v && C.dir && C.dir.version !== v && !need.includes('directory')) {
    C.busy++; conRender();
    await conLoadDirectory(true);
    C.busy--; conRender();
  }
}

const conFind = empNo => (C.item && C.item.emp_no === empNo ? C.item : (C.dir?.employees || []).find(e => e.emp_no === empNo)) || {};
function conShareText(e) {
  return [conName(e.full_name), e.designation, [e.department, e.station].filter(Boolean).join(', '), e.mobile && 'Mobile: ' + e.mobile,
    e.office_phone && 'Office: ' + e.office_phone + (e.extension ? ` (Ext ${e.extension})` : ''), e.email && 'Email: ' + e.email].filter(Boolean).join('\n');
}

document.addEventListener('click', async e => {
  const el = e.target.closest('[data-cact]');
  if (!el || !hasConnect()) return;
  const arg = el.dataset.carg || '';
  switch (el.dataset.cact) {
    case 'tab': if (arg === 'more' && typeof W !== 'undefined') { W.page = ''; W.form = null; } if (arg === 'sa' && typeof saOpen === 'function') saOpen(); return conOpenTab(arg);
    case 'home': if (typeof W !== 'undefined') { W.page = ''; W.form = null; } return conOpenTab('home');
    case 'sync': if (!C.busy) conRefresh(true); return;
    case 'back': return conGo(null);
    case 'view': return typeof show === 'function' && show(arg);
    case 'tool': C.tab = 'more'; C.detail = null; return typeof wOpen === 'function' && wOpen(arg);
    case 'ask': conOpenTab('circ'); return setTimeout(() => { const q = $('conAskQ'); if (q) { q.scrollIntoView({block: 'center', behavior: 'smooth'}); q.focus(); } }, 60);
    case 'emp': conGo({type: 'emp', id: arg}); return conLoadItem('emp', arg);
    case 'circular': conGo({type: 'circular', id: arg}); return conLoadItem('circular', arg);
    case 'news': conGo({type: 'news', id: arg}); return conLoadItem('news', arg);
    case 'birthdays': return conGo({type: 'birthdays'});
    case 'cat': C.circ.cat = arg; return conLoadList('circ', true);
    case 'more': return conLoadList(arg, false);
    case 'dirmore': return conDirAppend();
    case 'circask': return conCircAskGo();
    case 'circnew': CA.hist = []; CA.q = ''; CA.err = ''; CA.note = ''; return conRender();
    case 'circread': return conCircRead();
    case 'syncdir': C.busy++; conRender(); await conLoadDirectory(true); C.busy--; return conRender();
    case 'dial': e.stopPropagation(); return Connect.dial(arg);
    case 'sms': return Connect.sms(arg);
    case 'whatsapp': return Connect.whatsapp(arg);
    case 'email': return Connect.email(arg);
    case 'chatwith': return window.chatWith(arg);
    case 'savecontact': { const p = conFind(arg); return Connect.saveContact(JSON.stringify({...p, name: conName(p.full_name)})); }
    case 'sharecontact': return Connect.share(conShareText(conFind(arg)));
    case 'openfile': {
      if (C.opening) return;
      C.opening = true; conRender();
      const r = await conAsk(id => Connect.openFile(id, arg));
      C.opening = false; conRender();
      if (!r.ok) alert(r.error);
      return;
    }
    case 'readall': Connect.markRead(JSON.stringify(C.notes.map(n => n.id))); C.read = new Set(C.notes.map(n => n.id)); conBadge(); return conRender();
    case 'note': {
      const n = (C.notes || []).find(x => String(x.id) === arg);
      if (!n) return;
      Connect.markRead(JSON.stringify([n.id])); C.read.add(n.id); conBadge();
      if (n.type === 'circular' && n.ref_id) { conGo({type: 'circular', id: n.ref_id}); return conLoadItem('circular', n.ref_id); }
      if (n.type === 'news' && n.ref_id) { conGo({type: 'news', id: n.ref_id}); return conLoadItem('news', n.ref_id); }
      return conRender();
    }
    case 'editme': C.editMe = true; C.meError = ''; return meRender();
    case 'cancelme': C.editMe = false; return meRender();
    case 'saveme': return meSave();
  }
});

document.addEventListener('input', e => {
  // Typing in the directory search redraws only the list, so the keyboard stays up.
  if (e.target.id === 'conQ') { C.q = e.target.value; $('conDirList').innerHTML = conDirList(); }
  if (e.target.id === 'conAskQ') CA.q = e.target.value;
});
document.addEventListener('change', e => {
  const sel = e.target.dataset?.csel;
  if (sel === 'station') { C.station = e.target.value; $('conDept').outerHTML = conDeptSelect(); $('conBlood').innerHTML = conBloodOptions(); $('conDirList').innerHTML = conDirList(); }
  if (sel === 'dept') { C.dept = e.target.value; $('conBlood').innerHTML = conBloodOptions(); $('conDirList').innerHTML = conDirList(); }
  if (sel === 'blood') { C.blood = e.target.value; $('conDirList').innerHTML = conDirList(); }
});
document.addEventListener('keydown', e => {
  if (e.target.id === 'conCircQ' && e.key === 'Enter') { C.circ.q = e.target.value; e.target.blur(); conLoadList('circ', true); }
});

// Which way the next page moves: back arrows and "home" slide it in from the left, everything else from the right.
document.addEventListener('click', e => {
  C.navDir = e.target.closest('.pg-back, [data-cact="back"], [data-cact="home"], [data-wact="back"], [data-wact="cancel"], [data-sact="home"]') ? 'back' : 'fwd';
}, true);

/** Called by show('connect'). */
function conShow() {
  conRender();
  if (!hasConnect()) return;
  conRefresh(false);                 // asks only for what is older than its limit (home 5 min, notices 5 min)
}

// ---------------------------------------------------------------- my profile (top of the Profile view)

function meRender() {
  const box = $('meCard');
  if (!box || !hasNative('account')) return;
  const me = JSON.parse(Native.account() || '{}');
  if (me.photo_id) conPhoto(me.photo_id);
  const row = (l, v) => `<div class="set-row" style="margin:8px 0 0"><div><span>${esc(l)}</span><b>${esc(v || '—')}</b></div></div>`;
  if (!C.editMe && typeof pfCardHtml === 'function') { box.innerHTML = pfCardHtml(me); if (typeof pfLinksRender === 'function') pfLinksRender(); return; }
  if (!C.editMe) {
    box.innerHTML = `<h2>My profile</h2><div style="display:flex;align-items:center;gap:14px">${conAvatar(me, 64)}
        <div style="min-width:0"><div style="font-size:18px;font-weight:700">${esc(conName(me.full_name) || '—')}</div>
        <div class="muted" style="font-size:13px">${esc(me.designation || '')}</div>
        <div class="muted" style="font-size:12.5px">Employee no. ${esc(me.emp_no || '—')}</div></div></div>
      ${row('Station', me.station || me.station_short)}${row('Department', me.department)}
      ${row('Mobile', me.mobile ? me.mobile + (me.show_mobile === false ? ' (hidden from the directory)' : '') : '')}
      ${row('Office phone', [me.office_phone, me.extension && 'Ext ' + me.extension].filter(Boolean).join(' · '))}
      ${row('E-mail', me.email)}${row('Blood group', me.blood_group)}${row('Date of birth', me.date_of_birth ? conDate(me.date_of_birth) : '')}
      ${conBtn('Edit my contact details', 'editme', '', true)} <button class="btn" data-wact="photo" style="color:var(--accent)">${C.saving ? 'Uploading…' : 'Change photo'}</button>
      <input type="file" id="mePhotoFile" accept="image/*" hidden>
      <div class="note-src">Name, designation, station and department are maintained by HR.</div>`;
    return;
  }
  const inp = (id, label, value, type = 'text') => `<label style="display:block;font-size:12px;color:var(--muted);margin-top:10px">${esc(label)}<input class="search" id="${id}" type="${type}" value="${esc(value || '')}" style="margin:4px 0 0"></label>`;
  box.innerHTML = `<h2>Edit my contact details</h2>${conErr(C.meError)}
    ${inp('meMobile', 'Mobile', me.mobile, 'tel')}${inp('meEmail', 'E-mail', me.email, 'email')}
    ${inp('meOffice', 'Office phone', me.office_phone, 'tel')}${inp('meExt', 'Extension', me.extension)}
    <label style="display:block;font-size:12px;color:var(--muted);margin-top:10px">Blood group<select class="search" id="meBlood" style="margin:4px 0 0"><option value="">Not given</option>${CON_BLOOD.map(b => `<option ${me.blood_group === b ? 'selected' : ''}>${b}</option>`).join('')}</select></label>
    ${inp('meDob', 'Date of birth', (me.date_of_birth || '').slice(0, 10), 'date')}
    <div class="tg" style="border-top:0"><div><b>Show my mobile number</b><span>Other employees can see and call it from the directory.</span></div><button class="sw-t ${me.show_mobile === false ? '' : 'on'}" id="meShow" aria-label="Show my mobile number"></button></div>
    ${conBtn(C.saving ? 'Saving…' : 'Save', 'saveme', '', true)} ${conBtn('Cancel', 'cancelme')}`;
  $('meShow').addEventListener('click', ev => ev.currentTarget.classList.toggle('on'));
}

async function meSave() {
  if (C.saving) return;
  const params = {mobile: $('meMobile').value.trim(), email: $('meEmail').value.trim(), office_phone: $('meOffice').value.trim(),
    extension: $('meExt').value.trim(), blood_group: $('meBlood').value, date_of_birth: $('meDob').value, show_mobile: $('meShow').classList.contains('on')};
  C.saving = true; C.meError = '';
  const r = await conCall('update_profile', params);
  C.saving = false;
  if (r.ok) { C.editMe = false; C.home = null; }      // the app has stored the updated record
  else C.meError = r.error;
  meRender();
}

/** A tapped Connect notification asks for a circular, a news item, or the notices list. */
window.connectResume = () => {
  if (!hasConnect()) return;
  let n;
  try { n = JSON.parse(Connect.pendingNotice() || 'null'); } catch (e) { n = null; }
  if (!n) return;
  if (n.type === 'chat') return window.chatOpenConv && window.chatOpenConv(n.ref_id);
  show('connect');
  if (n.type === 'circular' && n.ref_id) { conGo({type: 'circular', id: n.ref_id}); conLoadItem('circular', n.ref_id); }
  else if (n.type === 'news' && n.ref_id) { conGo({type: 'news', id: n.ref_id}); conLoadItem('news', n.ref_id); }
  else if (n.type === 'birthday') conGo({type: 'birthdays'});
  else conOpenTab('notes');
};

/** Android back button: close a Connect or DSM detail first, then return to the dashboard; false lets the app close. */
const dsmBack = window.appBack;
window.appBack = () => {
  if ($('v-connect').classList.contains('on')) {
    if (C.detail) { conGo(null); return true; }
    if (C.tab !== 'home') { conOpenTab('home'); return true; }
  }
  if ($('v-info').classList.contains('on') && C.editMe) { C.editMe = false; meRender(); return true; }
  return dsmBack ? dsmBack() : false;
};

if (hasConnect()) { conLoadNotes(false); meRender(); }
window.connectResume();
