// My profile (4.2) and its own pages: Notifications, Settings & security, Change password, About & data sources.
// The profile card (photo, name, completeness, contact details), the links between the pages, the notification
// figures, the password rules and the list of data sources. The settings' own controls stay where they were
// (app-main-2.js, connect.js, work.js); this file only draws the new parts.
// Uses conAvatar, conName, conDate, conBtn, conPhoto (connect.js), alertLog, S, hasNative, show (app-main-2.js), viz.js, $, esc, fmt.

const PF_IC = {
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>', info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><path d="M12 7.5h.01"/>',
  out: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>', phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>', office: '<path d="M3 21h18M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16"/><path d="M9 8h2M13 8h2M9 12h2M13 12h2M10 21v-4h4v4"/>',
  drop: '<path d="M12 3s7 7.5 7 12a7 7 0 0 1-14 0c0-4.5 7-12 7-12z"/>', cake: '<path d="M4 21h16v-7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2z"/><path d="M12 12V8"/>',
  site: '<path d="M2 20h20M5 20V9l7-5 7 5v11"/>', team: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><circle cx="17.5" cy="9" r="2.5"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3.5"/>',
  check: '<path d="M5 12l5 5 9-10"/>', pulse: '<path d="M3 12h4l3-8 4 16 3-8h4"/>', grid: '<path d="M4 18h16M4 14l4-4 4 3 4-6 4 3"/>', rupee: '<path d="M6 4h12M6 9h12M9 4c4 0 6 2 6 5s-3 5-7 5l7 6"/>',
  cloud: '<path d="M7 18a5 5 0 0 1-.6-10A6 6 0 0 1 18 9a4.5 4.5 0 0 1-.5 9z"/>', train: '<rect x="5" y="3" width="14" height="14" rx="3"/><path d="M5 11h14M8 21l2-4M16 21l-2-4"/>',
  sheet: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M4 9h16M4 15h16M10 3v18"/>', build: '<path d="M2 20h20M5 20V9l7-5 7 5v11"/><path d="M9 20v-5h6v5"/>',
  shield: '<path d="M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6z"/><path d="M9 12l2 2 4-4"/>', spark: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/>',
  factory: '<path d="M2 21h20M4 21V11l5 3V11l5 3V7l6 4v10"/>',
};
const pfIc = (k, s = 18) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PF_IC[k] || ''}</svg>`;
const pfMe = () => { try { return JSON.parse(hasNative('account') ? Native.account() : '{}') || {}; } catch (e) { return {}; } };

/** The profile card: cover with photo, name and role; completeness gauge; contact details with icons. */
function pfCardHtml(me) {
  const fields = [['mobile', 'mobile number'], ['email', 'e-mail'], ['office_phone', 'office phone'], ['blood_group', 'blood group'], ['date_of_birth', 'date of birth'], ['photo_id', 'photo']];
  const missing = fields.filter(([k]) => !me[k]), done = Math.round((fields.length - missing.length) / fields.length * 100);
  const row = (ic, label, value, note) => value ? `<div class="pf-row"><span class="pf-ri">${pfIc(ic)}</span><span class="pf-rt"><small>${esc(label)}</small><b>${esc(value)}</b>${note ? `<i>${esc(note)}</i>` : ''}</span></div>` : '';
  return `<div class="pf-cover"><div class="pf-av">${conAvatar(me, 88)}<button class="pf-cam" data-wact="photo" aria-label="Change photo">${pfIc('camera', 16)}</button></div>
      <div class="pf-name">${esc(conName(me.full_name) || '—')}</div><div class="pf-role">${esc(me.designation || '')}</div>
      <div class="pf-chips"><span>No. ${esc(me.emp_no || '—')}</span>${me.class ? `<span>Class ${esc(me.class)}</span>` : ''}${me.station_short || me.station ? `<span>${esc(me.station_short || me.station)}</span>` : ''}${me.role && me.role !== 'employee' ? `<span class="pf-r">${esc(me.role === 'superadmin' ? 'Super admin' : me.role === 'admin' ? 'Administrator' : me.role)}</span>` : ''}</div></div>
    <div class="pf-comp">${vzRing(done, {size: 64, stroke: 8, tone: done === 100 ? 'ok' : 'warn'})}<div><b>Profile ${done}% complete</b><span>${missing.length ? 'Add your ' + missing.slice(0, 3).map(x => x[1]).join(', ') + ' so colleagues can reach you.' : 'Everything colleagues need is filled in.'}</span></div></div>
    <div class="pf-rows">${row('site', 'Station', me.station || me.station_short)}${row('team', 'Department', me.department)}
      ${row('phone', 'Mobile', me.mobile, me.show_mobile === false ? 'hidden from the directory' : '')}${row('office', 'Office phone', [me.office_phone, me.extension && 'Ext ' + me.extension].filter(Boolean).join(' · '))}
      ${row('mail', 'E-mail', me.email)}${row('drop', 'Blood group', me.blood_group)}${row('cake', 'Date of birth', me.date_of_birth ? conDate(me.date_of_birth) : '')}</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">${conBtn('Edit my contact details', 'editme', '', true)}<button class="btn" data-wact="photo" style="color:var(--accent)">${C.saving ? 'Uploading…' : 'Change photo'}</button></div>
    <input type="file" id="mePhotoFile" accept="image/*" hidden>
    <div class="note-src">Name, designation, station and department are maintained by HR.</div>`;
}

/** Links from My profile to its pages. */
function pfLinksRender() {
  const box = $('meLinks'); if (!box) return;
  const log = typeof alertLog === 'function' ? alertLog() : [], unread = log.filter(a => a.t > ((S.set || {}).seen || 0)).length;
  const row = (v, ic, col, t, sub, tag) => `<div class="tl-row" ${v === 'out' ? 'data-pfact="out"' : `data-v="${v}"`} style="--qc:${col}"><span class="qi">${pfIc(ic)}</span><span class="tx"><b>${t}</b><small>${sub}</small></span>${tag || '<span class="go">›</span>'}</div>`;
  box.innerHTML = `<h2>Account &amp; app</h2>
    ${row('alerts', 'bell', '#dc2626', 'Notifications', 'Outage and unit alerts, what to notify, background checks', unread ? `<span class="pf-badge">${unread > 99 ? '99+' : unread}</span>` : '')}
    ${row('settings', 'gear', '#475569', 'Settings &amp; security', 'Theme, colours, data refresh, app lock, two-step verification')}
    ${row('pass', 'lock', '#1d4ed8', 'Change password', 'Rules and the change screen')}
    ${row('about', 'info', '#0f766e', 'About &amp; data sources', 'Version, updates and where every figure comes from')}
    ${hasNative('logout') ? row('out', 'out', '#be123c', 'Sign out', 'On this device; your data on the phone is removed') : ''}`;
}

/** Notifications page: figures and the last 14 days. */
function pfAlertStats() {
  const box = $('alertStats'); if (!box || typeof alertLog !== 'function') return;
  const log = alertLog(), now = Date.now(), day = 864e5, t0 = new Date(); t0.setHours(0, 0, 0, 0);
  const since = d => log.filter(a => a.t >= now - d * day);
  const days = Array.from({length: 14}, (_, i) => { const a = t0.getTime() - (13 - i) * day; return {a, b: a + day}; });
  box.innerHTML = vzKpis([{k: 'Today', v: fmt(log.filter(a => a.t >= t0.getTime()).length)}, {k: 'Last 7 days', v: fmt(since(7).length)},
    {k: 'Forced outages', v: fmt(since(30).filter(a => a.kind !== 'sync').length), sub: 'last 30 days', tone: 'bad'}, {k: 'Units synchronised', v: fmt(since(30).filter(a => a.kind === 'sync').length), sub: 'last 30 days', tone: 'ok'}], 2)
    + (log.length ? `<div class="card"><h2>Last 14 days</h2>${vzStack(days.map(d => { const l = log.filter(a => a.t >= d.a && a.t < d.b); return {k: new Date(d.a).toLocaleDateString('en-IN', {weekday: 'short', day: '2-digit', month: 'short'}), parts: [l.filter(a => a.kind !== 'sync').length, l.filter(a => a.kind === 'sync').length]}; }).reverse().filter(r => r.parts[0] + r.parts[1]).slice(0, 10),
      [{k: 'Outage', c: '#be123c'}, {k: 'Synchronised', c: '#15803d'}], {empty: 'No notifications in the last 14 days.'})}</div>` : '');
}

/** Change password page: the rules the service checks. */
function pfRules() {
  const box = $('pwRules'); if (!box) return;
  box.innerHTML = [['At least 8 characters', 'longer is stronger: a short sentence works well'], ['Upper and lower case letters', 'e.g. a capital in the middle, not only at the start'],
    ['At least one number and one symbol', 'such as 7 and #'], ['Not your name, employee number or date of birth', 'and not the first-time password'],
    ['Not used for anything else', 'your e-mail or bank must have their own'], ['Never shared', 'GSECL staff will never ask for it']]
    .map(([t, s], i) => `<div class="pw-r" style="animation-delay:${i * 50}ms"><span>${pfIc('check', 16)}</span><div><b>${t}</b><small>${s}</small></div></div>`).join('');
}

/** About page: every source of the figures in the app. */
const PF_SOURCES = [
  ['factory', '#8e3291', 'GSECL generation feed', 'Unit-wise generation, declared capability and schedule of every GSECL station', 'every minute'],
  ['grid', '#1d4ed8', 'SLDC Gujarat (sldcguj.com)', 'Grid frequency, Gujarat catered demand, state generation mix, unit outages, merit order, DSM statements', '1–5 minutes'],
  ['pulse', '#0f766e', 'SLDC scheduling API', 'Block-wise DC and schedule with revisions, for PAF, AFC and DSM', 'every 15 minutes, relay phones'],
  ['rupee', '#d97706', 'IEX (iexindia.com)', 'Day-ahead and real-time market prices', 'every 5 minutes'],
  ['cloud', '#0891b2', 'Open-Meteo', 'Temperature, humidity, rain and sunshine for the load forecasts', 'every 3 hours'],
  ['build', '#475569', 'CEA', 'Installed capacity of India and Gujarat by source', 'monthly'],
  ['train', '#7c3aed', 'FOIS, Indian Railways', 'Coal rakes on the way and at the stations', 'relay phones'],
  ['sheet', '#15803d', 'GSECL Connect service (Google Sheet)', 'Employees, circulars, news, coal stock, outage register, PAF history, safety, approvals', 'on each request'],
  ['site', '#be123c', 'Projects portal and BHEL PEDM', 'Project progress, MDL and document status, MDCC, site reports, finance, risks', 'every 30 minutes'],
  ['shield', '#16a34a', 'SIMS safety portal', 'Safety observations, incidents and permits, both ways', 'every 5 minutes'],
  ['spark', '#7c3aed', 'Google Gemini (AI)', 'Summaries, the assistant, special days for the forecasts; figures always come from the sources above', 'when asked / daily'],
];
function pfSources() {
  const box = $('srcList'); if (!box) return;
  box.innerHTML = PF_SOURCES.map(([ic, col, n, w, f]) => `<div class="tl-row" style="--qc:${col};cursor:default"><span class="qi">${pfIc(ic)}</span><span class="tx"><b>${n}</b><small>${w}</small></span><span class="tag">${f}</span></div>`).join('')
    + '<div class="note-src" style="margin-top:8px">Only the trend readings and the last unit and outage status used for notifications are kept on this phone (90 days at most); everything else is read again when needed.</div>';
}

// ---- hooks: draw the new parts when their page opens
if (typeof SECTION !== 'undefined') Object.assign(SECTION, {alerts: 'me', settings: 'me', pass: 'me', about: 'me'});
if (typeof show === 'function') {
  const showPf = show;
  // eslint-disable-next-line no-global-assign
  show = function (v) {
    showPf(v);
    if (['info', 'alerts', 'settings', 'pass', 'about'].includes(v)) {
      if (typeof renderInfo === 'function') { try { renderInfo(); } catch (e) { /* the page still opens */ } }
      if (v === 'info') { pfLinksRender(); if (typeof meRender === 'function') meRender(); }
      if (v === 'alerts') pfAlertStats();
      if (v === 'pass') pfRules();
      if (v === 'about') pfSources();
      const btn = $('meBtn'); if (btn) btn.classList.add('active');
    }
  };
}
if (typeof document !== 'undefined') {
  // the profile menu opens the pages themselves (it used to scroll one long page)
  document.addEventListener('click', e => {
    const item = e.target.closest('#meMenu .mm-i[data-mm]');
    if (item && ['settings', 'about', 'pass'].includes(item.dataset.mm)) { e.stopImmediatePropagation(); if (typeof meMenu === 'function') meMenu(false); return show(item.dataset.mm); }
    if (e.target.closest('[data-pfact="out"]') && hasNative('logout') && confirm('Sign out on this phone?')) Native.logout();
  }, true);
  const pfPrevBack = window.appBack;
  window.appBack = () => {
    const on = ['alerts', 'settings', 'pass', 'about'].find(v => $('v-' + v) && $('v-' + v).classList.contains('on'));
    if (on) { show('info'); return true; }
    return pfPrevBack ? pfPrevBack() : false;
  };
}
