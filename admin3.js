// Activity centre (Login activity) and Approval desk (Approvals), 4.6: both pages drawn afresh from the same service
// answers (activity, devreq), in tabs, with avatars, rings and timelines. Every action keeps its handler in work.js /
// admin2.js: secack, unblkdev, aev, devok, devno (data-wact) and blockdev (data-adact). Uses viz.js, conAvatar,
// conName, conDate, conMore, conEmpty, conSpin, csvBtn, tLine, tLegend, tCol, wEvKind, W, esc, fmt, $.

const AD_TABS = [['ov', 'Overview'], ['people', 'People'], ['sec', 'Security'], ['log', 'Log']];
const AD_KIND = {in: ['Sign-in', '#15803d', '↪'], bad: ['Refused', '#be123c', '⛔'], dev: ['Phone & password', '#4f46e5', '🔑']};
const adRel = t => { const d = new Date(String(t).replace(' ', 'T')), m = (Date.now() - d.getTime()) / 6e4; if (isNaN(m)) return ''; return m < 1 ? 'now' : m < 60 ? Math.round(m) + ' min' : m < 1440 ? Math.round(m / 60) + ' h' : Math.round(m / 1440) + ' d'; };
const adAv = (name, size, ring) => `<span class="ad-av" style="--r:${ring || 'transparent'}">${conAvatar({full_name: name || '?'}, size)}</span>`;
const adSeg = (cur, list, act) => `<div class="ad-seg" role="tablist">${list.map(([k, l, n, soft]) => `<button class="${cur === k ? 'on' : ''}" data-adtab="${act}|${k}" role="tab">${esc(l)}${n ? `<b class="${soft ? 'soft' : ''}">${n}</b>` : ''}</button>`).join('')}</div>`;

// ---------------------------------------------------------------- Activity centre

function adActivity() {
  const d = W.data.activity;
  if (!d) return W.busy ? conSpin() : '';
  const tab = W.sel.atab || 'ov', today = d.days[d.days.length - 1] || {};
  const todayIso = new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
  const used = d.today || (d.last24 || []).filter(r => String(r.at).slice(0, 10) === todayIso);
  const open = (d.security_alerts || []).filter(a => !a.ack), sw = (d.device_signins || []).filter(x => !x.blocked).length;
  const live = d.live || [];
  let h = `<div class="ad-hero"><div class="ad-ht"><div><b>Activity centre</b><span><i class="ad-pulse"></i>${fmt(d.live_count)} live now · ${fmt(d.today_count)} used today</span></div>
      <div class="ad-stack">${live.slice(0, 6).map(r => adAv(r.name, 30, '#4ade80')).join('')}${live.length > 6 ? `<span class="ad-more">+${live.length - 6}</span>` : ''}</div></div>
    <div class="vz-rings">${vzRing(d.today_count ? d.live_count / d.today_count * 100 : 0, {text: fmt(d.live_count), label: 'Live now', sub: 'of ' + fmt(d.today_count) + ' today', color: '#4ade80', size: 82})}
      ${vzRing(d.registered_phones ? d.today_count / d.registered_phones * 100 : 0, {text: fmt(d.today_count), label: 'Used today', sub: 'of ' + fmt(d.registered_phones) + ' phones', color: '#60a5fa', size: 82})}
      ${vzRing(today.signins ? (today.signins - (today.refused || 0)) / today.signins * 100 : 100, {label: 'Sign-ins OK', sub: fmt(today.signins || 0) + ' today', color: '#a78bfa', size: 82})}</div></div>`;
  if (open.length) h += `<div class="ad-alarm" data-adtab="act|sec"><span>⚠</span><div><b>${open.length} security alert${open.length > 1 ? 's' : ''} to act on</b><small>Tap to open Security</small></div></div>`;
  h += adSeg(tab, [['ov', 'Overview'], ['people', 'People', used.length, 1], ['sec', 'Security', open.length + sw || ''], ['log', 'Log']], 'act');
  h += ({ov: adActOverview, people: adActPeople, sec: adActSecurity, log: adActLog}[tab] || adActOverview)(d, used);
  return h;
}

function adActOverview(d) {
  const today = d.days[d.days.length - 1] || {}, ev = d.events || [];
  const hours = Array.from({length: 24}, () => 0); ev.forEach(e => { const m = /(\d{2}):\d{2}/.exec(String(e.time || '').slice(11)); if (m) hours[+m[1]]++; });
  const hmax = Math.max(1, ...hours);
  const st = {}; (d.today || []).forEach(r => { const k = r.station || '—'; st[k] = (st[k] || 0) + 1; });
  const kinds = {in: 0, bad: 0, dev: 0}; ev.forEach(e => { kinds[wEvKind(e.event)]++; });
  const av = d.app_versions || [], vk = r => (r.app === 'gujarat' ? 'Gujarat Power' : r.app === 'web' ? 'Web' : 'Connect') + ' ' + r.version, vc = {};
  av.forEach(r => { vc[vk(r)] = (vc[vk(r)] || 0) + 1; });
  const labels = d.days.map(x => conDate(x.date).replace(/ \d{4}$/, ''));
  return vzKpis([{k: 'Peak today', v: fmt(today.peak || 0), sub: today.peak_at ? 'together at ' + today.peak_at : 'together'}, {k: 'Sign-ins today', v: fmt(today.signins || 0)},
      {k: 'Refused / wrong', v: fmt(today.refused || 0), sub: 'today', tone: today.refused ? 'bad' : 'ok'}, {k: 'Blocked devices', v: fmt((d.blocked_devices || []).length), tone: (d.blocked_devices || []).length ? 'warn' : 'ok'}], 2)
    + `<div class="card"><h2>Last 14 days</h2>${tLine('actDays', labels, [{name: 'Used the app', slot: 1, vals: d.days.map(x => x.users)}, {name: 'Peak live together', slot: 0, vals: d.days.map(x => x.peak)}, {name: 'Sign-ins', slot: 2, vals: d.days.map(x => x.signins)}, {name: 'Refused / wrong', slot: 3, vals: d.days.map(x => x.refused)}], {h: 170, label: 'Use of the app, last 14 days'})}
      ${tLegend([[tCol(1), 'Used the app'], [tCol(0), 'Peak live together'], [tCol(2), 'Sign-ins'], [tCol(3), 'Refused / wrong']])}</div>
    <div class="card"><h2>When people sign in ${conMore('hour of day, recent log')}</h2><div class="ad-heat">${hours.map((n, i) => `<div style="--a:${(n / hmax).toFixed(2)}" title="${String(i).padStart(2, '0')}:00 · ${n}"><i></i><span>${i % 3 === 0 ? String(i).padStart(2, '0') : ''}</span></div>`).join('')}</div>
      <div class="note-src">Darker = more sign-ins and refusals in that hour.</div></div>
    ${Object.keys(st).length ? `<div class="card"><h2>Used today, by station</h2>${vzBars(Object.keys(st).map(k => ({k, v: st[k]})).sort((a, b) => b.v - a.v).slice(0, 12), {one: true, color: '#1d4ed8'})}</div>` : ''}
    <div class="card"><h2>What happened ${conMore(fmt(ev.length) + ' recent events')}</h2>${vzDonut([{k: 'Sign-ins', n: kinds.in, c: '#15803d'}, {k: 'Refused / wrong', n: kinds.bad, c: '#be123c'}, {k: 'Phone & password', n: kinds.dev, c: '#4f46e5'}], {label: 'events', size: 104, stroke: 15})}</div>
    ${av.length ? `<div class="card"><h2>App versions in use ${conMore(fmt(av.length) + ' devices')}</h2>${vzDonut(Object.keys(vc).map(k => ({k, n: vc[k]})).sort((a, b) => b.n - a.n), {label: 'devices', size: 104, stroke: 15})}</div>` : ''}`;
}

function adActPeople(d, used) {
  const f = W.sel.apf || 'today', q = (W.sel.apq || '').toLowerCase();
  const src = f === 'live' ? d.live || [] : f === '24h' ? d.last24 || [] : used;
  const list = src.filter(r => !q || `${r.emp_no} ${r.name} ${r.designation} ${r.station} ${r.device}`.toLowerCase().includes(q));
  const ring = r => (r.mins < d.live_minutes ? '#22c55e' : String(r.at).slice(0, 10) === new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10) ? '#60a5fa' : '#94a3b8');
  return `<div class="chips">${[['live', 'Live now', (d.live || []).length], ['today', 'Today', used.length], ['24h', 'Last 24 h', (d.last24 || []).length]].map(([k, l, n]) => `<button class="chip ${f === k ? 'on' : ''}" data-adtab="apf|${k}">${l} · ${n}</button>`).join('')}</div>
    <input class="search" id="adPeopleQ" type="search" placeholder="Search name, number, station or phone…" value="${esc(W.sel.apq || '')}" autocomplete="off">
    <div class="ad-people" id="adPeople">${adPeopleCards(list, ring)}</div>
    ${list.length ? csvBtn('actPeople', 'GSECL_Connect_users_' + f, ['Employee no', 'Name', 'Designation', 'Station', 'Phone', 'Last used'], list.map(r => [r.emp_no, r.name, r.designation, r.station, r.device, r.at])) : ''}`;
}
const adPeopleCards = (list, ring) => list.slice(0, 150).map((r, i) => `<div class="ad-pc" style="animation-delay:${Math.min(i, 12) * 30}ms">${adAv(r.name, 40, ring(r))}
  <div class="ad-pt"><b>${esc(conName(r.name) || r.emp_no)}</b><span>${esc([r.designation, r.station].filter(Boolean).join(' · '))}</span><span class="ad-dev">${esc(r.device || 'browser')}</span></div>
  <span class="ad-when">${esc(adRel(r.at))}</span></div>`).join('') || conEmpty('Nobody here.');

function adActSecurity(d) {
  const al = d.security_alerts || [], open = al.filter(a => !a.ack), blk = d.blocked_devices || [];
  const when = a => new Date(a.at).toLocaleString('en-IN', {day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false});
  return (open.length ? `<div class="card ad-alert"><h2>⚠ ${open.length} alert${open.length > 1 ? 's' : ''} to act on</h2>
      <div class="ad-tl">${open.slice(0, 10).map(a => `<div style="--c:#be123c"><b>${esc(a.text)}</b><small>${when(a)}${a.reminders ? ' · reminded ' + a.reminders + '×' : ''}</small></div>`).join('')}</div>
      <div class="note-src">The super administrators are e-mailed and notified every 10 minutes (up to an hour) until acknowledged.</div>
      ${d.can_unblock ? `<button class="btn" data-wact="secack" style="width:100%;margin:8px 0 0;background:#be123c;color:#fff;border-color:#be123c;padding:11px">Acknowledge (dealt with)</button>` : ''}</div>` : `<div class="ad-ok">${'✓'}<div><b>No open security alert</b><small>${al.length ? al.length + ' earlier alerts acknowledged' : 'Nothing has been flagged'}</small></div></div>`)
    + (typeof adSignIns === 'function' ? adSignIns(d) : '')
    + `<div class="card"><h2>Blocked devices ${conMore(blk.length ? blk.length + ' blocked' : 'none')}</h2>
      ${blk.map(b => `<div class="pj-li" style="align-items:center"><span class="pj-d" style="background:#475569">⛔</span><span class="pj-t"><b>${esc(b.name || 'device')}</b><span>${esc(conDate(b.at))} ${esc(String(b.at).slice(11, 16))} · ${esc(b.why || '')}</span></span>
        ${d.can_unblock ? `<button class="btn" data-wact="unblkdev" data-warg="${esc(b.id)}" style="margin:0;flex:none">Unblock</button>` : ''}</div>`).join('') || conEmpty('No device is blocked.')}
      <div class="note-src">A device refused 5 times within an hour that no employee uses is blocked at once; a super administrator can also block a device from a sign-in above.</div></div>
    ${al.length ? `<div class="card"><h2>Alert history</h2><div class="ad-tl">${al.slice(0, 25).map(a => `<div style="--c:${a.ack ? '#94a3b8' : '#be123c'}"><b>${esc(a.text)}</b><small>${when(a)}${a.ack ? ' · acknowledged by ' + esc(a.ack.by || '') : ''}</small></div>`).join('')}</div></div>` : ''}`;
}

function adActLog(d) {
  const f = W.sel.aev || '', q = (W.sel.alq || '').toLowerCase();
  const ev = (d.events || []).filter(e => (!f || wEvKind(e.event) === f) && (!q || `${e.emp_no} ${e.name} ${e.station} ${e.device} ${e.event}`.toLowerCase().includes(q)));
  return `<div class="chips">${[['', 'All'], ['in', 'Sign-ins'], ['bad', 'Refused / wrong'], ['dev', 'Phone & password']].map(([k, l]) => `<button class="chip ${f === k ? 'on' : ''}" data-wact="aev" data-warg="${k}">${l}</button>`).join('')}</div>
    <input class="search" id="adLogQ" type="search" placeholder="Search name, number, station, phone or event…" value="${esc(W.sel.alq || '')}" autocomplete="off">
    <div id="adLog">${adLogRows(ev)}</div>
    ${csvBtn('actLog', 'GSECL_Connect_sign_in_log', ['Time', 'Employee no', 'Name', 'Station', 'Event', 'Phone', 'Detail'], ev.map(e => [e.time, e.emp_no, e.name, e.station, e.event, e.device, e.detail]))}
    <div class="note-src">Kept in the LoginLog tab of the Google Sheet.</div>`;
}
function adLogRows(ev) {
  if (!ev.length) return `<div class="card">${conEmpty('No event matches.')}</div>`;
  let day = '', h = '';
  ev.slice(0, 150).forEach(e => {
    const dd = String(e.time || '').slice(0, 10);
    if (dd !== day) { if (day) h += '</div></div>'; h += `<div class="card ad-day"><h2>${esc(conDate(dd))}</h2><div class="ad-log">`; day = dd; }
    const [l, c, ic] = AD_KIND[wEvKind(e.event)];
    h += `<div class="ad-le"><span class="ad-lt">${esc(String(e.time || '').slice(11, 16))}</span><span class="ad-li" style="background:${c}" title="${l}">${ic}</span>
      <div><b>${esc(conName(e.name) || e.emp_no)} <span>· ${esc(e.event)}</span></b><small>${esc([e.emp_no, e.station, e.device, e.detail].filter(Boolean).join(' · '))}</small></div></div>`;
  });
  return h + '</div></div>';
}

// ---------------------------------------------------------------- Approval desk

function adApprovals() {
  const d = W.data.devreq;
  if (!d) return W.busy ? conSpin() : '';
  const p = d.pending || [], dec = d.decided || [], tab = W.sel.rtab || 'wait';
  const ages = p.map(r => adAge(r.requested_at)).filter(x => x !== null), old = ages.length ? Math.max(...ages) : null, ok = dec.filter(r => r.status === 'approved').length;
  let h = (typeof wMsg === 'function' ? wMsg() : '') + `<div class="ad-hero"><div class="ad-ht"><div><b>Approval desk</b><span>${p.length ? `${p.length} waiting · oldest ${adAgeTxt(old)}` : 'Nothing is waiting'}</span></div>
      <div class="ad-big">${fmt(p.length)}<small>waiting</small></div></div>
    <div class="vz-rings">${vzRing(dec.length ? ok / dec.length * 100 : 0, {label: 'Approved', sub: ok + ' of ' + dec.length + ' decided', color: '#4ade80', size: 80})}
      ${vzRing(p.length ? p.filter(r => r.kind === 'registration').length / p.length * 100 : 0, {text: fmt(p.filter(r => r.kind === 'registration').length), label: 'Registrations', sub: 'new employees', color: '#c084fc', size: 80})}
      ${vzRing(p.length ? p.filter(r => r.kind !== 'registration' && !/^access:/.test(r.kind)).length / p.length * 100 : 0, {text: fmt(p.filter(r => r.kind !== 'registration' && !/^access:/.test(r.kind)).length), label: 'Phones', sub: 'another phone', color: '#fbbf24', size: 80})}</div></div>`;
  h += adSeg(tab, [['wait', 'Waiting', p.length], ['done', 'Decided', dec.length, 1]], 'req');
  if (tab === 'wait') {
    h += p.length ? p.map((r, i) => adReqCard(r, i)).join('') : `<div class="ad-ok">✓<div><b>All caught up</b><small>No request is waiting for you.</small></div></div>`;
    h += `<div class="note-src">New registration: a new employee confirmed the e-mailed code and set a password. Another phone: the employee asks to use a new phone. Page access: a page given on approval (WTPS Unit 8). The employee is told of your decision.</div>`;
  } else {
    h += dec.length ? `<div class="card"><div class="ad-tl">${dec.map(r => `<div style="--c:${r.status === 'approved' ? '#15803d' : '#be123c'}"><b>${esc(conName(r.name) || r.emp_no)} · ${r.kind === 'registration' ? 'registration' : /^access:/.test(r.kind) ? 'page access' : 'phone'} · ${esc(r.status)}</b>
        <small>${esc([r.emp_no, r.station, 'asked ' + String(r.requested_at || '').slice(0, 16), r.decided_at && 'decided ' + String(r.decided_at).slice(0, 16) + (r.decided_by ? ' by ' + r.decided_by : ''), r.note].filter(Boolean).join(' · '))}</small></div>`).join('')}</div></div>` : `<div class="card">${conEmpty('Nothing decided yet.')}</div>`;
  }
  return h;
}
function adReqCard(r, i) {
  const age = adAge(r.requested_at), col = age > 48 ? '#be123c' : age > 12 ? '#d97706' : '#15803d';
  const [kind, kc, ic] = r.kind === 'registration' ? ['New registration', '#8e3291', '👤'] : /^access:/.test(r.kind) ? ['Page access', '#7c3aed', '🔓'] : ['Another phone', '#d97706', '📱'];
  const row = (k, v) => v ? `<div><span>${k}</span><b>${esc(v)}</b></div>` : '';
  return `<div class="ad-req" style="--k:${kc};animation-delay:${i * 60}ms"><div class="ad-rh">${adAv(r.name, 46, kc)}<div class="ad-rt"><b>${esc(conName(r.name) || r.emp_no)}</b><span>${esc([r.emp_no, r.station].filter(Boolean).join(' · '))}</span></div>
      <span class="ad-age2" style="background:${col}">${adAgeTxt(age)}</span></div>
    <div class="ad-kind"><span>${ic}</span>${kind}</div>
    <div class="ad-rd">${row(r.kind === 'registration' ? 'Registered' : 'Asked', conDate(r.requested_at, true))}${row(/^access:/.test(r.kind) ? 'For' : 'Device', r.device_name)}${row('Phones now', (r.phones || []).map(x => x.name + (x.main ? ' (registered)' : '')).join(', '))}</div>
    ${r.kind === 'registration' ? '<div class="ad-hint">Check that this is a GSECL employee before approving.</div>' : ''}
    <div class="ad-btns"><button class="ad-yes" data-wact="devok" data-warg="${r.id}">✓ Approve</button><button class="ad-no" data-wact="devno" data-warg="${r.id}">✕ Reject</button></div></div>`;
}

// ---- hooks: the two pages are drawn by these; tabs, searches and filters
if (typeof wActivity === 'function') { /* eslint-disable-next-line no-global-assign */ wActivity = adActivity; }
if (typeof wDevReq === 'function') { /* eslint-disable-next-line no-global-assign */ wDevReq = adApprovals; }
if (typeof document !== 'undefined') {
  document.addEventListener('click', e => {
    const t = e.target.closest('[data-adtab]'); if (!t) return;
    const [what, k] = t.dataset.adtab.split('|');
    if (what === 'act') W.sel.atab = k; else if (what === 'req') W.sel.rtab = k; else if (what === 'apf') W.sel.apf = k;
    if (typeof conRender === 'function') conRender();
  });
  document.addEventListener('input', e => {
    const d = W.data && W.data.activity;
    if (e.target.id === 'adPeopleQ' && d) {
      W.sel.apq = e.target.value;
      const f = W.sel.apf || 'today', todayIso = new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
      const used = d.today || (d.last24 || []).filter(r => String(r.at).slice(0, 10) === todayIso), src = f === 'live' ? d.live || [] : f === '24h' ? d.last24 || [] : used, q = e.target.value.toLowerCase();
      $('adPeople').innerHTML = adPeopleCards(src.filter(r => !q || `${r.emp_no} ${r.name} ${r.designation} ${r.station} ${r.device}`.toLowerCase().includes(q)),
        r => (r.mins < d.live_minutes ? '#22c55e' : String(r.at).slice(0, 10) === todayIso ? '#60a5fa' : '#94a3b8'));
    }
    if (e.target.id === 'adLogQ' && d) {
      W.sel.alq = e.target.value; const f = W.sel.aev || '', q = e.target.value.toLowerCase();
      $('adLog').innerHTML = adLogRows((d.events || []).filter(x => (!f || wEvKind(x.event) === f) && (!q || `${x.emp_no} ${x.name} ${x.station} ${x.device} ${x.event}`.toLowerCase().includes(q))));
    }
  });
}
