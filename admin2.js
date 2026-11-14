// Administration pages, graphics first (4.2): Login activity and Approvals get an overview of charts above their
// existing lists and actions (work.js wActivity / wDevReq, unchanged underneath): gauges, figures, sign-ins by hour,
// users by station, event mix, app versions, request types and waiting times. Uses viz.js, conName, conDate, esc, fmt.

const adHour = t => { const m = /(\d{2}):\d{2}/.exec(String(t || '').slice(11)); return m ? +m[1] : null; };
const adAge = t => { const d = new Date(String(t).replace(' ', 'T')); return isNaN(d) ? null : (Date.now() - d.getTime()) / 36e5; };
const adAgeTxt = h => (h === null ? '' : h < 1 ? Math.max(1, Math.round(h * 60)) + ' min' : h < 48 ? Math.round(h) + ' h' : Math.round(h / 24) + ' days');

/** Login activity: the overview drawn from the same answer (activity) the page already loads. */
function adActivityOverview(d) {
  const today = d.days[d.days.length - 1] || {}, ev = d.events || [];
  const todayIso = new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
  const usedToday = d.today || (d.last24 || []).filter(r => String(r.at).slice(0, 10) === todayIso);
  const reg = d.registered_phones || 0, blk = (d.blocked_devices || []).length;
  // sign-ins and refusals by hour of the day (the log's last events)
  const hours = Array.from({length: 24}, () => ({in: 0, bad: 0}));
  ev.forEach(e => { const h = adHour(e.time); if (h === null) return; const k = typeof wEvKind === 'function' ? wEvKind(e.event) : 'in'; if (k === 'in') hours[h].in++; else if (k === 'bad') hours[h].bad++; });
  const st = {}; usedToday.forEach(r => { const k = r.station || '—'; st[k] = (st[k] || 0) + 1; });
  const kinds = {in: 0, bad: 0, dev: 0}; ev.forEach(e => { kinds[typeof wEvKind === 'function' ? wEvKind(e.event) : 'in']++; });
  const av = d.app_versions || [], vk = r => (r.app === 'gujarat' ? 'Gujarat Power' : r.app === 'web' ? 'Web' : 'Connect') + ' ' + r.version, vc = {};
  av.forEach(r => { vc[vk(r)] = (vc[vk(r)] || 0) + 1; });
  return `<div class="pj-hero"><h3>Who is using GSECL Connect</h3><div class="pj-sub">Live = app on screen in the last ${d.live_minutes} min · one-phone rule ${d.device_policy === 'lock' ? 'on' : d.device_policy || 'off'}</div>
      <div class="vz-rings">${vzRing(d.today_count ? d.live_count / d.today_count * 100 : 0, {text: fmt(d.live_count), label: 'Live now', sub: 'of ' + fmt(d.today_count) + ' today', color: '#4ade80', size: 92})}
        ${vzRing(reg ? d.today_count / reg * 100 : 0, {text: fmt(d.today_count), label: 'Used today', sub: 'of ' + fmt(reg) + ' phones', color: '#60a5fa', size: 92})}
        ${vzRing(today.signins ? (today.signins - (today.refused || 0)) / today.signins * 100 : 100, {label: 'Sign-ins OK', sub: fmt(today.signins || 0) + ' today', color: '#a78bfa', size: 92})}</div></div>
    ${vzKpis([{k: 'Peak today', v: fmt(today.peak || 0), sub: today.peak_at ? 'together at ' + today.peak_at : 'together'}, {k: 'Sign-ins today', v: fmt(today.signins || 0)},
      {k: 'Refused / wrong', v: fmt(today.refused || 0), sub: 'today', tone: today.refused ? 'bad' : 'ok'}, {k: 'Blocked devices', v: fmt(blk), tone: blk ? 'warn' : 'ok'}], 2)}
    <div class="card"><h2>Sign-ins by hour <span class="more muted" style="font-weight:500;font-size:11.5px">recent log</span></h2>
      ${vzCols(hours.map((x, i) => ({k: i % 3 === 0 ? String(i).padStart(2, '0') : '', v: x.in + x.bad, c: x.bad > x.in ? '#be123c' : undefined})), {h: 90})}</div>
    ${Object.keys(st).length ? `<div class="card"><h2>Used today, by station</h2>${vzBars(Object.keys(st).map(k => ({k, v: st[k]})).sort((a, b) => b.v - a.v).slice(0, 12), {one: true, color: '#1d4ed8'})}</div>` : ''}
    <div class="card"><h2>What happened <span class="more muted" style="font-weight:500;font-size:11.5px">${fmt(ev.length)} recent events</span></h2>
      ${vzDonut([{k: 'Sign-ins', n: kinds.in, c: '#15803d'}, {k: 'Refused / wrong', n: kinds.bad, c: '#be123c'}, {k: 'Phone & password', n: kinds.dev, c: '#4f46e5'}], {label: 'events', size: 104, stroke: 15})}</div>
    ${adSignIns(d)}
    ${av.length ? `<div class="card"><h2>App versions in use <span class="more muted" style="font-weight:500;font-size:11.5px">${fmt(av.length)} phones / browsers</span></h2>
      ${vzDonut(Object.keys(vc).map(k => ({k, n: vc[k]})).sort((a, b) => b.n - a.n), {label: 'devices', size: 104, stroke: 15})}
      <details style="margin-top:8px"><summary class="vals" style="cursor:pointer">Every phone</summary>${av.slice(0, 200).map(r => `<div class="srow" style="cursor:default"><div class="top"><span class="nm">${esc(r.name || r.emp_no)}</span><span class="vals">${esc(vk(r))}</span></div>
        <div class="vals">${esc(r.device || 'browser')} · last used ${esc(r.last_seen ? new Date(r.last_seen).toLocaleString('en-IN', {day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false}) : '—')}</div></div>`).join('')}</details></div>` : ''}`;
}

/** Sign-ins on a new device while the account was in use elsewhere (super administrators): with a Block button. */
function adSignIns(d) {
  const l = d.device_signins || [];
  if (!l.length) return '';
  const when = t => new Date(t).toLocaleString('en-IN', {day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false});
  return `<div class="card"><h2>Sign-ins on another device <span class="more muted" style="font-weight:500;font-size:11.5px">the person and you were told</span></h2>
    ${l.slice(0, 12).map(x => `<div class="pj-li" style="align-items:center"><span class="pj-d" style="background:${x.blocked ? '#475569' : x.web ? '#1d4ed8' : '#8e3291'}">${x.web ? 'Web' : 'Phone'}</span>
      <span class="pj-t"><b>${esc(conName(x.name) || x.emp_no)} · ${esc(x.device)}</b><span>${esc([x.emp_no, x.station, when(x.at), x.others.length ? 'also in use: ' + x.others.join(', ') : ''].filter(Boolean).join(' · '))}</span></span>
      ${x.blocked ? '<span class="tag">Blocked</span>' : `<button class="btn" data-adact="blockdev" data-adarg="${esc(x.ref)}" style="margin:0;color:var(--neg);flex:none">Block</button>`}</div>`).join('')}
    <div class="note-src">Block stops that device at once and signs it out; the employee is told. Unblock it later under Security.</div></div>`;
}

/** Approvals: what is waiting and how long, above the request cards. */
function adApprovalsOverview(d) {
  const p = d.pending || [], dec = d.decided || [];
  const type = r => (/^access:/.test(r.kind) ? 'Page access' : r.kind === 'registration' ? 'New registration' : 'Another phone');
  const t = {}; p.forEach(r => { t[type(r)] = (t[type(r)] || 0) + 1; });
  const ages = p.map(r => adAge(r.requested_at)).filter(x => x !== null), old = ages.length ? Math.max(...ages) : null;
  const ok = dec.filter(r => r.status === 'approved').length;
  return vzKpis([{k: 'Waiting', v: fmt(p.length), sub: p.length ? 'to decide' : 'nothing waiting', tone: p.length ? 'warn' : 'ok'}, {k: 'Oldest', v: old === null ? '—' : adAgeTxt(old), sub: 'waiting', tone: old > 24 ? 'bad' : ''}], 2)
    + `<div class="card"><h2>Requests</h2><div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap">
        <div style="flex:1;min-width:170px">${vzDonut([{k: 'New registration', n: t['New registration'] || 0, c: '#8e3291'}, {k: 'Another phone', n: t['Another phone'] || 0, c: '#d97706'}, {k: 'Page access', n: t['Page access'] || 0, c: '#7c3aed'}], {label: 'waiting', size: 96, stroke: 14, empty: 'No request is waiting.'})}</div>
        ${dec.length ? vzRing(ok / dec.length * 100, {label: 'Approved', sub: ok + ' of ' + dec.length + ' decided', tone: 'ok', size: 86}) : ''}</div></div>`;
}

// ---- hooks into work.js (the lists, buttons and their actions stay as they are)
if (typeof wActivity === 'function') {
  const wActivity0 = wActivity;
  // eslint-disable-next-line no-global-assign
  wActivity = function () {
    const h = wActivity0(), d = W.data.activity;
    if (!d || typeof vzRing !== 'function') return h;
    // the text-only "App versions" and "Right now" cards are replaced by the overview (their figures are in it)
    let rest = h;
    const cut = (from, to) => { const x = rest.indexOf(from); if (x < 0) return; const y = rest.indexOf(to, x + 1); if (y > x) rest = rest.slice(0, x) + rest.slice(y); };
    cut('<div class="card"><h2>App versions in use', '<div class="card"><h2>Right now');
    cut('<div class="card"><h2>Right now', '<div class="card"><h2>Last 14 days');
    const at = rest.indexOf('<div class="card"><h2>Security');
    return at >= 0 ? rest.slice(0, at) + adActivityOverview(d) + rest.slice(at) : adActivityOverview(d) + rest;
  };
}
if (typeof wDevReq === 'function') {
  const wDevReq0 = wDevReq;
  // eslint-disable-next-line no-global-assign
  wDevReq = function () {
    const h = wDevReq0(), d = W.data.devreq;
    if (!d || typeof vzRing !== 'function') return h;
    // each waiting request shows how long it has waited
    let i = 0;
    const out = h.replace(/<div class="oq" style="--oc:([^"]+)"><div class="oq-h">/g, (m, c) => {
      const r = d.pending[i++]; const age = r ? adAge(r.requested_at) : null;
      return `<div class="oq ad-req" style="--oc:${c}"><div class="oq-h">` + (age !== null ? `<span class="ad-age" style="background:${age > 48 ? '#be123c' : age > 12 ? '#d97706' : '#15803d'}">${adAgeTxt(age)}</span>` : '');
    });
    const at = out.indexOf('<div class="card"><h2>Waiting for approval');
    return at >= 0 ? out.slice(0, at) + adApprovalsOverview(d) + out.slice(at) : adApprovalsOverview(d) + out;
  };
}

// Block a device from the "Sign-ins on another device" list
if (typeof document !== 'undefined') document.addEventListener('click', async e => {
  const b = e.target.closest('[data-adact="blockdev"]');
  if (!b || typeof conCall !== 'function') return;
  const reason = prompt('Block this device? It is signed out at once and cannot use GSECL Connect until unblocked. Reason (optional):', 'Suspicious sign-in');
  if (reason === null) return;
  b.disabled = true; b.textContent = 'Blocking…';
  const r = await conCall('block_device', {ref: b.dataset.adarg, reason});
  if (!r.ok) { alert(r.error); b.disabled = false; b.textContent = 'Block'; return; }
  if (typeof wOpen === 'function') wOpen('activity', true);
});
