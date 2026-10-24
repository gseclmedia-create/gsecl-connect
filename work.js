// Connect "More": the permission-controlled sections of GSECL Connect - stations and units,
// boilers, efficiency, outage register, merit order, installed capacity - and the publishing and
// employee administration screens. Shown inside the Connect view as its last tab.
// Uses conCall/conCached/conAsk and helpers from connect.js, and $, esc, fmt from index.html.

const W = {page: '', busy: false, error: '', note: '', form: null, data: {}, sel: {}, open: new Set()};
const W_PAGES = [
  ['stations', 'Stations & units', 'Installed capacity, units, make and status', 'stations', 'view'],
  ['boilers', 'Boiler certificates', 'Expiry dates and extensions', 'boilers', 'view'],
  ['pafafc', 'PAF & fixed cost (AFC) recovery', 'Daily, MTD and YTD PAF and PLF by PPA group (CERC formulas), AFC loss, asking rate', 'outages', 'view'],
  ['aohplan', 'AOH / COH planning', 'Planned shutdowns by financial year, with the boiler certificate check', 'stations', 'view'],
  ['efficiency', 'Efficiency', 'Year-wise performance figures by station and unit', 'efficiency', 'view'],
  ['outreg', 'Outage register', 'Trips, planned and reserve shutdowns, with hours', 'outages', 'view'],
  ['meritreg', 'Merit order (variable cost)', 'Fortnightly variable cost of each station', 'merit', 'view'],
  ['capacity', 'Installed capacity comparison', 'GSECL, Gujarat and India by source', 'stations', 'view'],
  ['pubcirc', 'Publish a circular', 'Upload the document and notify employees', 'circulars', 'edit'],
  ['pubnews', 'Post news', 'Headline, text and an optional photo', 'news', 'edit'],
  ['pubnote', 'Send a notice', 'To everyone, a station, a department or one employee', 'notifications', 'edit'],
  ['admin', 'Employees', 'Add or update employees, access, password reset and registered phone', 'employees', 'edit'],
  ['activity', 'Login activity', 'Who is live now, sign-ins, refused phones, day-wise peak', 'employees', 'edit'],
  ['devreq', 'Phone approvals', 'Requests to use another phone (super administrator)', 'superadmin', 'edit'],
  ['mgmtrep', 'Daily management report', 'Generation, outages, DSM, coal and safety of a day as a PDF', 'adminonly', 'edit'],
];
const W_UNIT_STATUS = ['In service', 'Under shutdown', 'Decommissioned'];

const wMe = () => { try { return JSON.parse(Native.account() || '{}'); } catch (e) { return {}; } };
const wCan = (module, how) => { if (module === 'superadmin') return wMe().role === 'superadmin'; if (module === 'adminonly') return ['admin', 'superadmin'].includes(wMe().role); const p = wMe().permissions || {}; return ((how === 'edit' ? p.edit : p.view) || []).includes(module); };
const wRoleBadge = r => r === 'superadmin' ? '<span class="badge b-Forced">Super admin</span>' : r === 'admin' ? '<span class="badge b-RSD">Admin</span>' : '';
const wBtn = (label, act, arg = '', primary = false) => `<button class="btn" data-wact="${act}" data-warg="${esc(arg)}" style="${primary ? 'background:var(--accent);color:#fff;border-color:var(--accent)' : 'color:var(--accent)'}">${esc(label)}</button>`;
const wBack = (label = 'More') => `<div class="chips"><button class="chip" data-wact="back">‹ ${esc(label)}</button></div>`;
const wMsg = () => (W.error ? conErr(W.error) : '') + (W.note ? `<div class="alert" style="background:#dcfce7;color:#166534;border-color:#bbf7d0"><span>✓</span><span>${esc(W.note)}</span></div>` : '');
const wSel = (name, cur, all, values, labels = values) => `<select class="search" data-wsel="${name}" style="margin:0 0 8px">${all === null ? '' : `<option value="">${esc(all)}</option>`}${values.map((v, i) => `<option value="${esc(v)}" ${String(v) === String(cur) ? 'selected' : ''}>${esc(labels[i])}</option>`).join('')}</select>`;
const wNum = (v, d = 2) => v === null || v === undefined || v === '' ? '—' : fmt(v, d);
/** "at 12:40" today, otherwise "on 6 Oct, 12:40". */
const wAgo = t => { const d = new Date(t), time = d.toLocaleTimeString('en-IN', {hour: '2-digit', minute: '2-digit'}); return d.toDateString() === new Date().toDateString() ? 'at ' + time : `on ${d.getDate()} ${CON_MON[d.getMonth()]}, ${time}`; };
const wIso = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// ---------------------------------------------------------------- forms

/** fields: [{k, label, type: text|number|date|datetime|select|area|check|file|checks, options, value, hint}] */
function wFormHtml(title, fields, saveLabel = 'Save') {
  const inp = f => {
    const id = 'wf_' + f.k, v = f.value === null || f.value === undefined ? '' : f.value;
    if (f.type === 'check') return `<div class="tg" style="border-top:0;padding:8px 0 0"><div><b>${esc(f.label)}</b>${f.hint ? `<span>${esc(f.hint)}</span>` : ''}</div><button class="sw-t ${v ? 'on' : ''}" id="${id}" data-wact="toggle" aria-label="${esc(f.label)}"></button></div>`;
    let box;
    if (f.type === 'select') box = `<select class="search" id="${id}" style="margin:4px 0 0">${f.options.map(o => { const [val, lab] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(val)}" ${String(val) === String(v) ? 'selected' : ''}>${esc(lab)}</option>`; }).join('')}</select>`;
    else if (f.type === 'area') box = `<textarea class="search" id="${id}" rows="${f.rows || 4}" style="margin:4px 0 0">${esc(v)}</textarea>`;
    else if (f.type === 'file') box = `<input class="search" id="${id}" type="file" ${f.accept ? `accept="${f.accept}"` : ''} style="margin:4px 0 0">`;
    else if (f.type === 'checks') box = `<div id="${id}" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px">${f.options.map(o => `<button class="chip ${(v || []).includes(o) ? 'on' : ''}" data-wact="pick" data-warg="${esc(o)}" style="padding:4px 10px;font-size:12px">${esc(o)}</button>`).join('')}</div>`;
    else box = `<input class="search" id="${id}" type="${f.type === 'datetime' ? 'datetime-local' : f.type || 'text'}" ${f.type === 'number' ? 'step="any" inputmode="decimal"' : ''} value="${esc(v)}" ${f.readonly ? 'readonly' : ''} style="margin:4px 0 0">`;
    return `<label style="display:block;font-size:12px;color:var(--muted);margin-top:10px">${esc(f.label)}${box}${f.hint ? `<span style="display:block;margin-top:2px">${esc(f.hint)}</span>` : ''}</label>`;
  };
  return `<div class="card"><h2>${esc(title)}</h2>${wMsg()}${fields.map(inp).join('')}
    <div>${wBtn(W.busy ? 'Saving…' : saveLabel, 'save', '', true)} ${wBtn('Cancel', 'cancel')}</div></div>`;
}

/** Reads the open form's values; files become {name, mime_type, data(base64)}. */
async function wFormRead(fields) {
  const out = {};
  for (const f of fields) {
    const el = $('wf_' + f.k);
    if (!el) continue;
    if (f.type === 'check') out[f.k] = el.classList.contains('on');
    else if (f.type === 'checks') out[f.k] = [...el.querySelectorAll('.chip.on')].map(b => b.dataset.warg);
    else if (f.type === 'datetime') out[f.k] = el.value ? el.value.replace('T', ' ').slice(0, 16) : '';
    else if (f.type === 'file') out[f.k] = el.files[0] ? await wFile(el.files[0]) : null;
    else out[f.k] = el.value.trim();
  }
  return out;
}
const wFile = file => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve({name: file.name, mime_type: file.type || 'application/octet-stream', data: String(r.result).split(',')[1] || ''});
  r.onerror = () => reject(new Error('Could not read the file'));
  r.readAsDataURL(file);
});
/** A photo scaled down to at most 800 px JPEG, so uploads stay small. */
const wPhoto = file => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => {
    const k = Math.min(1, 800 / Math.max(img.width, img.height)), c = document.createElement('canvas');
    c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    resolve({name: 'photo.jpg', mime_type: 'image/jpeg', data: c.toDataURL('image/jpeg', 0.85).split(',')[1]});
  };
  img.onerror = () => reject(new Error('This file is not a picture'));
  img.src = URL.createObjectURL(file);
});

// ---------------------------------------------------------------- loading

const wKey = (key, params) => 'w_' + key + Object.values(params).map(v => '_' + v).join('');

/**
 * Shows the copy saved on the phone at once (if any). The service is asked only when that copy is
 * older than maxAge minutes or a refresh is forced - these figures change rarely, and every request
 * to the sheet costs several seconds.
 */
async function wLoad(key, action, params = {}, maxAge = 0, force = false) {
  const saved = conSaved(wKey(key, params));
  W.stamp = W.stamp || {};
  if (saved) { W.data[key] = saved.data; W.stamp[key] = Date.now() - saved.age * 60000; }
  if (saved && !force && saved.age < maxAge) { conRender(); return true; }
  W.busy = true; W.error = ''; conRender();
  const r = await conCall(action, params);
  W.busy = false;
  if (r.ok) { W.data[key] = r.data; W.stamp[key] = Date.now(); Connect.cacheSet(wKey(key, params), JSON.stringify(r.data)); }
  else if (!saved) W.error = r.error;
  conRender();
  return r.ok || !!saved;
}

function wPeriod() {
  const now = new Date(), fy = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1, p = W.sel.period || 'month';
  if (p === 'fy') return {from: `${fy}-04-01`, to: wIso()};
  if (p === 'lastfy') return {from: `${fy - 1}-04-01`, to: `${fy}-03-31`};
  if (p === '30') { const d = new Date(); d.setDate(d.getDate() - 29); return {from: wIso(d), to: wIso()}; }
  if (p === 'custom' && W.sel.pfrom && W.sel.pto) return {from: W.sel.pfrom, to: W.sel.pto};
  return {from: wIso(new Date(now.getFullYear(), now.getMonth(), 1)), to: wIso()};
}

// page -> [key of W.data, service action, minutes the saved copy is used without asking again]
const W_LOADS = {stations: ['stations', 'stations', 60], boilers: ['boilers', 'boilers', 60], efficiency: ['efficiency', 'efficiency', 360],
  capacity: ['capacity', 'capacity', 360], aohplan: ['plan', 'unit_plan', 30], meritreg: ['merit', 'merit', 60], activity: ['activity', 'login_activity', 0], devreq: ['devreq', 'device_requests', 0]};

async function wOpen(page, force = false) {
  W.page = page; W.form = null; W.error = ''; W.note = ''; W.open.clear();
  conRender(); window.scrollTo({top: 0});
  if (page === 'admin') return wAdminLoad();
  if (page === 'pafafc' && typeof pafLoad === 'function') { PF.group = ''; return pafLoad(force); }
  if (W_LOADS[page]) return wLoad(W_LOADS[page][0], W_LOADS[page][1], {}, W_LOADS[page][2], force);
  if (page === 'outreg') return W.data.opackOff ? wOutages(false, true) : oLoad(force);
  if (page === 'pubcirc' || page === 'pubnews' || page === 'pubnote') { if (!C.dir) await conLoadDirectory(false); return wStartForm(page); }
}

/** Outage register: unit list (first time), overview and first page of the list in one request. */
async function wOutages(more = false, withMeta = false) {
  if (!W.data.opackOff) return oLoad(true);          // after a save or delete: read the register again
  const q = {...wPeriod(), station: W.sel.ostation || '', cls: W.sel.ocls || ''};
  if (more) {
    const page = (W.data.olist?.page || 1) + 1;
    W.busy = true; conRender();
    const r = await conCall('outages', {...q, page});
    W.busy = false;
    if (r.ok) W.data.olist = {items: W.data.olist.items.concat(r.data.items || []), page, more: !!r.data.has_more, total: r.data.total};
    else W.error = r.error;
    return conRender();
  }
  const calls = [['outage_overview', q], ['outages', {...q, page: 1}]];
  if (withMeta || !W.data.ometa) calls.push(['outage_meta', {}]);
  const key = wKey('outreg', q), saved = conSaved(key);
  if (saved) Object.assign(W.data, saved.data); else W.data.olist = null;
  W.busy = true; W.error = ''; conRender();
  const [ov, li, me] = await conBatch(calls);
  W.busy = false;
  if (me && me.ok) W.data.ometa = me.data;
  if (ov.ok) W.data.oview = ov.data;
  if (li.ok) W.data.olist = {items: li.data.items || [], page: 1, more: !!li.data.has_more, total: li.data.total};
  if (ov.ok && li.ok && W.data.ometa) Connect.cacheSet(key, JSON.stringify({ometa: W.data.ometa, oview: W.data.oview, olist: W.data.olist}));
  else if (!saved) W.error = ov.error || li.error || (me && me.error) || '';
  conRender();
}

// ---------------------------------------------------------------- pages

function wMenu() {
  const rows = W_PAGES.filter(p => wCan(p[3], p[4]));
  if (!rows.length) return `<div class="card">${conEmpty('No additional sections are enabled for your account. Access is given by the administrator.')}</div>`;
  const group = (title, list) => list.length ? `<div class="card"><h2>${title}</h2>${list.map(p => `<div class="srow" data-wact="open" data-warg="${p[0]}"><div class="top"><span class="nm">${esc(p[1])}</span><span class="vals">›</span></div><div class="vals">${esc(p[2])}</div></div>`).join('')}</div>` : '';
  return group('Plant information', rows.filter(p => p[4] === 'view')) + group('Publish and administer', rows.filter(p => p[4] === 'edit'));
}

const wUnitLine = u => [u.capacity_mw && fmt(u.capacity_mw) + ' MW', u.fuel, u.make, u.commissioned && 'since ' + conDate(u.commissioned)].filter(Boolean).join(' · ');
const wBoilerBadge = u => ({valid: 'b-Running', upcoming: 'b-Planned', due: 'b-Planned', expired: 'b-Forced'}[u.boiler_status] ? `<span class="badge ${{valid: 'b-Running', upcoming: 'b-Planned', due: 'b-Planned', expired: 'b-Forced'}[u.boiler_status]}">${esc(u.boiler_status)}</span>` : '');

function wStations() {
  const d = W.data.stations;
  if (!d) return W.busy ? conSpin() : '';
  const edit = d.can_edit || wCan('boilers', 'edit');
  const total = d.stations.reduce((t, s) => t + (s.installed_mw || 0), 0);
  return (typeof wStationsChart === 'function' ? wStationsChart(d) : '') + `<div class="card"><h2>GSECL installed capacity</h2><div class="gen"><div><div class="big num">${fmt(total)} <small>MW</small></div><div class="lbl">${d.stations.reduce((t, s) => t + (s.unit_count || 0), 0)} units in service at ${d.stations.length} stations</div></div></div></div>`
    + d.stations.map(s => `<div class="st ${W.open.has(s.short_name) ? 'open' : ''}"><div class="st-h" data-wact="fold" data-warg="${esc(s.short_name)}"><div><div class="nm">${esc(s.name)}</div><div class="fu">${esc([s.short_name, s.type, s.location].filter(Boolean).join(' · '))}</div></div>
        <div class="rt num"><b>${fmt(s.installed_mw)} MW</b><span>${s.unit_count} unit${s.unit_count === 1 ? '' : 's'}</span></div>
        <svg class="chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="m6 9 6 6 6-6"/></svg></div>
      <div class="st-b">${s.units.map(u => `<div class="unit"><span class="sd" style="background:${/decommission|retired|scrapped/i.test(u.status || '') ? 'var(--off)' : /shutdown/i.test(u.status || '') ? 'var(--planned)' : 'var(--run)'}"></span>
          <div class="ub"><div class="un">Unit ${esc(u.unit)} <small>${esc(u.status || '')}</small></div><div class="od">${esc(wUnitLine(u))}</div>${u.remarks ? `<div class="od">${esc(u.remarks)}</div>` : ''}
          ${u.boiler_no || u.effective_expiry ? `<div class="od">Boiler ${esc(u.boiler_no || '—')} · valid to ${conDate(u.effective_expiry)} ${wBoilerBadge(u)}</div>` : ''}</div>
          ${edit ? `<div class="um"><a data-wact="editunit" data-warg="${esc(s.short_name + '|' + u.unit)}" style="color:var(--accent)">Edit</a></div>` : ''}</div>`).join('') || conEmpty('No units entered.')}
        ${d.can_edit ? wBtn('Add a unit', 'editunit', s.short_name + '|') : ''}</div></div>`).join('');
}

function wBoilers() {
  const d = W.data.boilers;
  if (!d) return W.busy ? conSpin() : '';
  const units = [...d.units].filter(u => u.boiler_no || u.boiler_expiry).sort((a, b) => (a.days_left ?? 1e9) - (b.days_left ?? 1e9));
  const count = s => units.filter(u => u.boiler_status === s).length;
  return `<div class="card"><h2>Boiler certificates</h2><div class="tstats" style="grid-template-columns:repeat(4,1fr)">
      <div><span>Expired</span><b class="num neg">${count('expired')}</b></div><div><span>Due</span><b class="num">${count('due')}</b></div>
      <div><span>Upcoming</span><b class="num">${count('upcoming')}</b></div><div><span>Valid</span><b class="num pos">${count('valid')}</b></div></div></div>`
    + (units.map(u => `<div class="oq" style="--oc:${{expired: 'var(--forced)', due: 'var(--planned)', upcoming: 'var(--planned)', valid: 'var(--run)'}[u.boiler_status] || 'var(--line)'}">
      <div class="oq-h"><span class="nm">${esc(u.station)} Unit ${esc(u.unit)}</span>${wBoilerBadge(u)}<span class="cap num">${u.days_left ?? '—'}<small> days</small></span></div>
      <div class="meta num"><div><span>Boiler no.</span>${esc(u.boiler_no || '—')}</div><div><span>Valid to</span>${conDate(u.effective_expiry)}</div>
        <div><span>Certificate expiry</span>${conDate(u.boiler_expiry)}</div><div><span>Extensions used</span>${u.extensions_used ?? 0} of 5</div></div>
      ${wCan('boilers', 'edit') ? `<div class="live"><a data-wact="editunit" data-warg="${esc(u.station + '|' + u.unit)}" style="color:var(--accent)">Edit certificate dates</a></div>` : ''}</div>`).join('') || `<div class="card">${conEmpty('No boiler certificates entered.')}</div>`);
}

// wEfficiency (trend charts) and the graphical outage register are in trend.js.

/** The earlier outage screen; used only while the service has not been redeployed with outage_pack. */
function wOutReg() {
  const meta = W.data.ometa, o = W.data.oview, list = W.data.olist;
  if (!meta) return W.busy ? conSpin() : '';
  const stations = [...new Set(meta.all_units.map(u => u.station))].sort(), p = wPeriod();
  let h = `<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">${wSel('period', W.sel.period || 'month', null, ['month', '30', 'fy', 'lastfy'], ['This month', 'Last 30 days', 'This financial year', 'Last financial year'])}${wSel('ostation', W.sel.ostation || '', 'All stations', stations)}</div>
    <div class="chips">${[['', 'All'], ['forced', 'Forced'], ['planned', 'Planned'], ['reserve', 'Reserve']].map(([v, l]) => `<button class="chip ${(W.sel.ocls || '') === v ? 'on' : ''}" data-wact="ocls" data-warg="${v}">${l}</button>`).join('')}</div>`;
  if (meta.can_edit) h += `<div style="margin-bottom:10px">${wBtn('Record an outage', 'editout', '', true)}</div>`;
  if (o) {
    const t = o.totals;
    h += `<div class="card"><h2>${conDate(p.from)} – ${conDate(p.to)}</h2><div class="tstats" style="grid-template-columns:repeat(3,1fr)">
        <div><span>Outages</span><b class="num">${t.count}</b><small>${wNum(t.hours, 1)} h</small></div>
        <div><span>Forced</span><b class="num neg">${t.forced_count}</b><small>${wNum(t.forced_hours, 1)} h · ${wNum(t.forced_pct)}%</small></div>
        <div><span>Planned</span><b class="num">${t.planned_count}</b><small>${wNum(t.planned_hours, 1)} h · ${wNum(t.planned_pct)}%</small></div></div>
      <table class="dt num"><tr><th>Type</th><th>Count</th><th>Hours</th></tr>${(o.by_type || []).filter(x => x.count).map(x => `<tr><td>${esc(x.label)}</td><td>${x.count}</td><td>${wNum(x.hours, 1)}</td></tr>`).join('')}</table></div>`;
    if ((o.by_station || []).length > 1) h += `<div class="card"><h2>By station</h2><div style="overflow-x:auto"><table class="dt num"><tr><th>Station</th><th>Outages</th><th>Forced h</th><th>Planned h</th><th>Reserve h</th><th>Forced %</th></tr>
      ${o.by_station.map(s => `<tr><td>${esc(s.station)}</td><td>${s.count}</td><td>${wNum(s.forced_hours, 1)}</td><td>${wNum(s.planned_hours, 1)}</td><td>${wNum(s.reserve_hours, 1)}</td><td>${wNum(s.forced_pct)}</td></tr>`).join('')}</table></div></div>`;
  }
  const colour = {forced: 'var(--forced)', planned: 'var(--planned)', reserve: 'var(--rsd)'};
  if (list) h += `<div class="card"><h2>${list.total ?? list.items.length} outage${list.total === 1 ? '' : 's'}</h2></div>` + (list.items.map(x => `<div class="oq" style="--oc:${colour[x.cls] || 'var(--outage)'}">
      <div class="oq-h"><span class="nm">${esc((x.station || '') + ' ' + (x.unit || x.code))}</span><span class="badge ${x.cls === 'forced' ? 'b-Forced' : x.cls === 'planned' ? 'b-Planned' : 'b-RSD'}">${esc(x.type_label || x.type)}</span>
        <span class="cap num">${x.ongoing ? 'Ongoing' : wNum(x.hours, 1) + '<small> h</small>'}</span></div>
      <div class="meta num"><div><span>Tripped</span>${conDate(x.trip_at, true)}</div><div><span>Synchronised</span>${x.sync_at ? conDate(x.sync_at, true) : '—'}</div></div>
      <div class="rs">${esc(x.reason)}</div>${x.remarks ? `<div class="live">${esc(x.remarks)}</div>` : ''}
      <div class="live">${esc(x.entered_by ? 'Entered by ' + x.entered_by : '')}${meta.can_edit ? ` <a data-wact="editout" data-warg="${x.id}" style="color:var(--accent)">Edit</a> · <a data-wact="delout" data-warg="${x.id}" style="color:var(--neg)">Delete</a>` : ''}</div></div>`).join('') || `<div class="card">${conEmpty('No outage in this period.')}</div>`)
    + (list.more ? `<div style="text-align:center">${wBtn(W.busy ? 'Loading…' : 'Load more', 'omore')}</div>` : '');
  return h + (W.busy && !list ? conSpin() : '');
}

function wMerit() {
  const d = W.data.merit, sldc = typeof wMeritSldc === 'function' ? wMeritSldc() : '';
  if (!d) return sldc + (W.busy ? conSpin() : '');
  if (!d.periods.length) return sldc + `<div class="card"><h2>Entered in GSECL Connect</h2>${conEmpty('No fortnightly variable cost entered in the sheet yet.')}${d.can_edit ? wBtn('Enter a fortnight', 'editmerit', '', true) : ''}</div>`;
  const i = Math.min(+(W.sel.mperiod || 0), d.periods.length - 1), p = d.periods[i], rows = [...p.rows].sort((a, b) => a.cost - b.cost), max = Math.max(...rows.map(r => r.cost), 1);
  return sldc + `<div class="note-src" style="margin:4px 4px 8px">Fortnightly variable cost entered in the GSECL Connect sheet:</div>` + wSel('mperiod', i, null, d.periods.map((_, k) => k), d.periods.map(x => `${conDate(x.from)} – ${conDate(x.to)}`))
    + `<div class="card"><h2>Variable cost · cheapest first ${conMore('₹/kWh')}</h2>${rows.map((r, k) => `<div class="mo"><span class="rk">${k + 1}</span><span class="nm">${esc(r.name)}</span><span class="vc num">₹${fmt(r.cost, 3)}</span>
      <div class="bar"><div class="f" style="width:${r.cost / max * 100}%;background:var(--accent)"></div></div><div class="st2">${esc([r.category, r.group].filter(Boolean).join(' · '))}</div></div>`).join('')}
      ${d.can_edit ? wBtn('Enter a new fortnight', 'editmerit', '', true) : ''}</div>`;
}

// wCapacity (with charts) is in trend.js.

/**
 * Employees (admin): the short list is kept on the phone and shown at once; the service is asked with the version
 * held, and answers "unchanged" (a few bytes) unless the Employees tab changed. The full record of one employee is
 * read when it is opened.
 */
const W_ROLES = ['employee', 'admin', 'superadmin'];
function wAdminExpand(d) {
  return {...d, employees: (d.rows || []).map(([emp_no, full_name, designation, station, role, active, phones, last_login]) =>
    ({emp_no, full_name, designation, station, role: W_ROLES[role] || 'employee', active: !!active, phones, last_login}))};
}
async function wAdminLoad() {
  const saved = conSaved('w_admin2');
  if (saved && !W.data.admin) { W.data.admin = wAdminExpand(saved.data); (W.stamp = W.stamp || {}).admin = Date.now() - saved.age * 60000; }
  W.busy = true; W.error = ''; conRender();
  const have = W.data.admin && W.data.admin.version;
  const r = await conCall('admin_employees', {version: have || null});
  W.busy = false;
  if (r.ok) {
    const keep = r.data.unchanged && W.data.admin ? W.data.admin.rows : r.data.rows;
    const d = {...r.data, rows: keep || []};
    delete d.unchanged;
    W.data.admin = wAdminExpand(d); (W.stamp = W.stamp || {}).admin = Date.now();
    Connect.cacheSet('w_admin2', JSON.stringify(d));
  } else if (!W.data.admin) W.error = r.error;
  conRender();
}

function wAdmin() {
  const d = W.data.admin;
  if (!d) return W.busy ? conSpin() : wMsg();
  const q = (W.sel.aq || '').toLowerCase(), nBlocked = d.employees.filter(e => !e.active).length;
  const list = d.employees.filter(e => (!W.sel.ablk || !e.active) && (!q || `${e.emp_no} ${e.full_name} ${e.station} ${e.designation}`.toLowerCase().includes(q)));
  return `<div class="note-src" style="text-align:center;margin:0 0 8px">${W.busy ? 'Checking the Google Sheet for changes…' : W.stamp && W.stamp.admin ? 'Up to date with the Google Sheet ' + wAgo(W.stamp.admin) : ''} · <a data-wact="admreload" style="color:var(--accent)">Refresh</a></div>
    <input class="search" id="wAdminQ" type="search" placeholder="Search employee number or name…" value="${esc(W.sel.aq || '')}" autocomplete="off">
    <div style="margin-bottom:10px">${wBtn('Add an employee', 'editemp', '', true)} ${nBlocked ? wBtn(W.sel.ablk ? 'Show all' : `Blocked only (${nBlocked})`, 'ablk') : ''}</div>${wMsg()}
    <div class="card" id="wAdminList"><h2>${fmt(list.length)} employees ${list.length > 60 ? conMore('showing first 60') : ''}</h2>${list.slice(0, 60).map(e => `<div class="srow" data-wact="editemp" data-warg="${esc(e.emp_no)}">
      <div class="top"><span class="nm">${esc(conName(e.full_name || ''))}</span><span class="vals">${e.active ? '' : '<span class="badge b-Forced">Blocked</span> '}${wRoleBadge(e.role)}</span></div>
      <div class="vals">${esc([e.emp_no, e.designation, e.station].filter(Boolean).join(' · '))}${e.last_login ? ' · last sign-in ' + conDate(e.last_login) : ''}${e.phones ? ' · 📱 ' + e.phones : ''}</div></div>`).join('') || conEmpty('No employee matches.')}</div>`;
}

// ---------------------------------------------------------------- phone approvals (super administrator)

function wDevReq() {
  const d = W.data.devreq;
  if (!d) return W.busy ? conSpin() : '';
  const req = r => `<div class="oq" style="--oc:var(--planned)"><div class="oq-h"><span class="nm">${esc(conName(r.name) || r.emp_no)}</span><span class="badge b-Planned">Waiting</span></div>
      <div class="meta num"><div><span>Employee</span>${esc(r.emp_no)} · ${esc(r.station)}</div><div><span>Asked</span>${conDate(r.requested_at, true)}</div>
        <div><span>New phone</span>📱 ${esc(r.device_name)}</div><div><span>Phones now</span>${esc(r.phones.map(x => x.name + (x.main ? ' (registered)' : '')).join(', ') || '—')}</div></div>
      <div style="display:flex;gap:8px;margin-top:8px">${wBtn('Approve', 'devok', r.id, true)} ${wBtn('Reject', 'devno', r.id)}</div></div>`;
  const done = r => `<div class="nrow" style="cursor:default"><span class="sd" style="background:${r.status === 'approved' ? 'var(--run)' : 'var(--forced)'}"></span><div class="nb"><b>${esc(conName(r.name) || r.emp_no)} · ${esc(r.device_name)} · ${esc(r.status)}</b>
      <div class="nt">${esc([r.emp_no, r.station, 'asked ' + (r.requested_at || '').slice(0, 16), r.decided_at && 'decided ' + r.decided_at.slice(0, 16) + ' by ' + r.decided_by, r.note].filter(Boolean).join(' · '))}</div></div></div>`;
  return wMsg() + `<div class="card"><h2>Waiting for approval (${d.pending.length})</h2>${d.pending.length ? '' : conEmpty('No request is waiting.')}
      <div class="note-src">An employee asks from the new phone after signing in there with the password. After approval they sign in on it with the password and the e-mailed code; the registered phone keeps working.</div></div>`
    + d.pending.map(req).join('')
    + (d.decided.length ? `<div class="card"><h2>Decided</h2>${d.decided.map(done).join('')}</div>` : '');
}

// ---------------------------------------------------------------- login activity

const W_EV = [['', 'All'], ['in', 'Sign-ins'], ['bad', 'Refused / wrong'], ['dev', 'Phone & password']];
const wEvKind = ev => /^(Signed in|Registered|Forgot|Password accepted)/.test(ev) ? 'in' : /^(Refused|Wrong|Locked)/.test(ev) ? 'bad' : 'dev';
const wEvCol = {in: 'var(--run)', bad: 'var(--forced)', dev: 'var(--rsd)'};

/** Live now, today and the last 14 days, the people seen in the last 24 hours, and the sign-in log. */
/** Daily management report: pick a day, the service makes the PDF (mailed every morning to the AppSettings list). */
function wMgmtReport() {
  const y = new Date(Date.now() - 864e5), iso = wIso(y);
  return wMsg() + `<div class="card"><h2>Daily management report</h2>
    <div class="vals" style="margin-bottom:10px">One PDF with the day's GSECL generation (energy, peak, PLF by station), unit outages, the latest DSM week and FY to date, coal stock and safety. It is e-mailed every morning to the addresses in the AppSettings tab of the Google Sheet (REPORT_TO).</div>
    <label style="display:block;font-size:12px;color:var(--muted)">Day<input class="search" id="wRepDay" type="date" value="${W.sel.repday || iso}" max="${wIso()}" style="margin:4px 0 10px"></label>
    ${wBtn(W.busy ? 'Preparing…' : 'Open report (PDF)', 'openrep', '', true)}
    <div class="note-src">Generation figures come from the SLDC readings the service records every 15 minutes from the day it was set up; DSM from the weeks the app has read on phones with DSM access.</div></div>`;
}

function wActivity() {
  const d = W.data.activity;
  if (!d) return W.busy ? conSpin() : '';
  const today = d.days[d.days.length - 1] || {}, f = W.sel.aev || '', q = (W.sel.aq2 || '').toLowerCase();
  const ev = d.events.filter(e => (!f || wEvKind(e.event) === f) && (!q || `${e.emp_no} ${e.name} ${e.station} ${e.device}`.toLowerCase().includes(q)));
  const person = r => `<div class="srow" style="cursor:default"><div class="top"><span class="nm"><span class="sd" style="display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:6px;background:${r.mins < d.live_minutes ? 'var(--run)' : 'var(--off)'}"></span>${esc(conName(r.name) || r.emp_no)}</span>
      <span class="vals num">${r.mins < 1 ? 'now' : r.mins < 60 ? r.mins + ' min ago' : esc(r.at.slice(11))}</span></div>
    <div class="vals">${esc([r.emp_no, r.designation, r.station, r.device && '📱 ' + r.device].filter(Boolean).join(' · '))}</div></div>`;
  const labels = d.days.map(x => conDate(x.date).replace(/ \d{4}$/, ''));
  return `<div class="card"><h2>Right now ${conMore('live = used the app in the last ' + d.live_minutes + ' min')}</h2>
      <div class="tstats" style="grid-template-columns:repeat(2,1fr)">
        <div><span>Live now</span><b class="num pos">${fmt(d.live_count)}</b><small>employees</small></div>
        <div><span>Used today</span><b class="num">${fmt(d.today_count)}</b><small>different employees</small></div>
        <div><span>Peak today</span><b class="num">${fmt(today.peak || 0)}</b><small>${today.peak_at ? 'at the same time, ' + esc(today.peak_at) : 'at the same time'}</small></div>
        <div><span>Sign-ins today</span><b class="num">${fmt(today.signins || 0)}</b><small>${today.refused ? `<span class="neg">${today.refused} refused / wrong</span>` : 'none refused'}</small></div>
      </div>
      <div class="note-src">Registered phones: <b>${fmt(d.registered_phones)}</b> · one-phone rule: <b>${esc(d.device_policy === 'lock' ? 'on (another phone is refused until released)' : d.device_policy === 'replace' ? 'new phone replaces the old one' : 'off')}</b>; administrators may use several phones.</div></div>
    <div class="card"><h2>Last 14 days</h2>${tLine('actDays', labels, [{name: 'Peak live together', slot: 0, vals: d.days.map(x => x.peak)}, {name: 'Employees who used the app', slot: 1, vals: d.days.map(x => x.users)}, {name: 'Sign-ins', slot: 2, vals: d.days.map(x => x.signins)}, {name: 'Refused / wrong password', slot: 3, vals: d.days.map(x => x.refused)}], {h: 190, label: 'Login activity', xName: 'Date'})}
      ${tLegend([[tCol(0), 'Peak live together'], [tCol(1), 'Used the app'], [tCol(2), 'Sign-ins'], [tCol(3), 'Refused / wrong']])}</div>
    <div class="card"><h2>Live now (${fmt(d.live.length)})</h2>${d.live.map(person).join('') || conEmpty('Nobody has used the app in the last ' + d.live_minutes + ' minutes.')}</div>
    ${d.last24.length > d.live.length ? `<div class="card"><h2>Used in the last 24 hours (${fmt(d.last24.length)})</h2>${d.last24.filter(r => r.mins >= d.live_minutes).slice(0, 80).map(person).join('')}
      ${csvBtn('act24', 'GSECL_Connect_used_last_24h', ['Employee no', 'Name', 'Designation', 'Station', 'Phone', 'Last used'], d.last24.map(r => [r.emp_no, r.name, r.designation, r.station, r.device, r.at]))}</div>` : ''}
    <div class="card"><h2>Sign-in log ${conMore(fmt(ev.length) + ' events')}</h2>
      <div class="chips" style="padding-bottom:4px">${W_EV.map(([k, l]) => `<button class="chip ${f === k ? 'on' : ''}" data-wact="aev" data-warg="${k}">${l}</button>`).join('')}</div>
      <input class="search" id="wActQ" type="search" placeholder="Filter by number, name, station or phone…" value="${esc(W.sel.aq2 || '')}" autocomplete="off" style="margin:4px 0 6px">
      <div id="wActList">${wActRows(ev)}</div>
      ${csvBtn('actLog', 'GSECL_Connect_sign_in_log', ['Time', 'Employee no', 'Name', 'Station', 'Event', 'Phone', 'Detail'], ev.map(e => [e.time, e.emp_no, e.name, e.station, e.event, e.device, e.detail]))}
      <div class="note-src">Kept in the LoginLog tab of the Google Sheet. “older app” = signed in from app 3.6.0 or earlier, which sends no phone id.</div></div>`;
}
const wActRows = ev => ev.slice(0, 120).map(e => `<div class="nrow" style="cursor:default"><span class="sd" style="background:${wEvCol[wEvKind(e.event)]}"></span><div class="nb"><b>${esc(conName(e.name) || e.emp_no)} · ${esc(e.event)}</b>
    <div class="nt">${esc([e.time.slice(0, 16), e.emp_no, e.station, e.device && '📱 ' + e.device, e.detail].filter(Boolean).join(' · '))}</div></div></div>`).join('') || conEmpty('No event matches.');

// ---------------------------------------------------------------- forms: definitions and saving

function wStartForm(kind, arg = '') {
  const stationOpts = [['', 'All GSECL']].concat((C.dir?.stations || []).map(s => [s.short_name, s.short_name + ' – ' + s.name]));
  let f;
  if (kind === 'editunit') {
    const [st, un] = arg.split('|'), u = ((W.data.stations?.stations || []).find(s => s.short_name === st)?.units || []).concat(W.data.boilers?.units || []).find(x => x.station === st && x.unit === un) || {};
    const fields = [{k: 'unit', label: 'Unit', value: un, readonly: !!un}];
    if (wCan('stations', 'edit')) fields.push({k: 'capacity_mw', label: 'Capacity (MW)', type: 'number', value: u.capacity_mw}, {k: 'fuel', label: 'Fuel', value: u.fuel}, {k: 'make', label: 'Make', value: u.make},
      {k: 'commissioned', label: 'Commissioned on', type: 'date', value: (u.commissioned || '').slice(0, 10)}, {k: 'status', label: 'Status', type: 'select', options: W_UNIT_STATUS.includes(u.status) || !u.status ? W_UNIT_STATUS : [u.status].concat(W_UNIT_STATUS), value: u.status || 'In service'}, {k: 'remarks', label: 'Remarks', type: 'area', rows: 2, value: u.remarks});
    if (wCan('boilers', 'edit')) fields.push({k: 'boiler_no', label: 'Boiler registration no.', value: u.boiler_no}, {k: 'boiler_expiry', label: 'Certificate expiry', type: 'date', value: u.boiler_expiry},
      ...[1, 2, 3, 4, 5].map(i => ({k: 'extension_' + i, label: 'Extension ' + i + ' valid to', type: 'date', value: u['extension_' + i]})));
    f = {kind, title: `${st} · ${un ? 'Unit ' + un : 'new unit'}`, fields, ctx: {station: st}};
  } else if (kind === 'editeff') {
    const [st, unit] = arg.split('|'), d = W.data.efficiency, now = new Date(), y = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    const year = W.sel.eyear || `${y - 1}-${String(y % 100).padStart(2, '0')}`, row = d.rows.find(r => r.station === st && r.unit === unit && r.year === year);
    f = {kind, title: `Efficiency · ${st} · ${unit}`, ctx: {station: st, unit}, fields: [{k: 'year', label: 'Financial year', value: year, hint: 'Like 2025-26. Figures already entered for that year are replaced.'}]
      .concat(d.metrics.map(m => ({k: 'm_' + m, label: m, type: 'number', value: row?.values[m]})))};
  } else if (kind === 'editout') {
    const meta = W.data.ometa, x = arg ? (W.data.olist?.items || []).find(o => String(o.id) === arg) || {} : {};
    const dt = s => (s || '').replace(' ', 'T').slice(0, 16);
    f = {kind, title: arg ? 'Edit outage' : 'Record an outage', ctx: {id: arg ? +arg : 0}, fields: [
      {k: 'code', label: 'Unit', type: 'select', options: meta.units.map(u => [u.code, `${u.station}-${u.unit} · ${fmt(u.capacity_mw)} MW`]), value: x.code},
      {k: 'trip_at', label: 'Tripped / taken out at', type: 'datetime', value: dt(x.trip_at)},
      {k: 'sync_at', label: 'Synchronised at', type: 'datetime', value: dt(x.sync_at), hint: 'Leave empty while the unit is still out.'},
      {k: 'type', label: 'Type of outage', type: 'select', options: [['', 'Choose…']].concat(meta.types.map(t => [t.type, t.label])), value: x.type},
      {k: 'reason', label: 'Reason', type: 'area', rows: 3, value: x.reason},
      {k: 'count_as_trip', label: 'Count as a trip', type: 'check', value: x.count_as_trip !== false},
      {k: 'remarks', label: 'Remarks', type: 'area', rows: 2, value: x.remarks}]};
  } else if (kind === 'editmerit') {
    const last = W.data.merit.periods[0], names = last ? [...last.rows].sort((a, b) => a.name.localeCompare(b.name)) : [];
    f = {kind, title: 'Merit order · new fortnight', ctx: {rows: names}, fields: [{k: 'period_from', label: 'Fortnight from', type: 'date'}, {k: 'period_to', label: 'Fortnight to', type: 'date'}]
      .concat(names.map((r, i) => ({k: 'c_' + i, label: `${r.name} (₹/kWh)`, type: 'number', value: r.cost})))};
  } else if (kind === 'pubcirc') {
    f = {kind, title: 'Publish a circular', saveLabel: 'Publish', fields: [{k: 'title', label: 'Title'}, {k: 'circular_no', label: 'Circular number'},
      {k: 'category', label: 'Category', type: 'select', options: CON_CATEGORIES, value: 'Circular'}, {k: 'issued_by', label: 'Issued by'}, {k: 'issue_date', label: 'Issue date', type: 'date', value: wIso()},
      {k: 'station', label: 'Applies to', type: 'select', options: stationOpts, value: ''}, {k: 'summary', label: 'Summary', type: 'area', rows: 3},
      {k: 'file', label: 'Document (PDF)', type: 'file', accept: 'application/pdf,image/*,.doc,.docx,.xls,.xlsx'},
      {k: 'important', label: 'Mark as important', type: 'check', value: false}, {k: 'notify', label: 'Notify employees', type: 'check', value: true}]};
  } else if (kind === 'pubnews') {
    f = {kind, title: 'Post news', saveLabel: 'Post', fields: [{k: 'title', label: 'Headline'}, {k: 'body', label: 'Text', type: 'area', rows: 8},
      {k: 'station', label: 'For', type: 'select', options: stationOpts, value: ''}, {k: 'image', label: 'Photo (optional)', type: 'file', accept: 'image/*'}, {k: 'notify', label: 'Notify employees', type: 'check', value: true}]};
  } else if (kind === 'pubnote') {
    f = {kind, title: 'Send a notice', saveLabel: 'Send', fields: [{k: 'title', label: 'Title'}, {k: 'message', label: 'Message', type: 'area', rows: 4},
      {k: 'type', label: 'Priority', type: 'select', options: [['general', 'Normal'], ['urgent', 'Urgent']], value: 'general'}, {k: 'station', label: 'Station', type: 'select', options: stationOpts, value: ''},
      {k: 'department', label: 'Department', type: 'select', options: [['', 'All departments']].concat((C.dir?.departments || []).map(d => [d.name, d.name])), value: ''},
      {k: 'emp_no', label: 'Only this employee number', hint: 'Leave empty to send to everyone in the station / department chosen above.'}]};
  } else if (kind === 'editemp') {
    const d = W.data.admin, e = (arg && W.empFull && W.empFull.emp_no === arg ? W.empFull : null) || {active: true, show_mobile: true, can_view: d.default_view, can_edit: []}, admin = wMe().role === 'admin' || wMe().role === 'superadmin', sup = wMe().role === 'superadmin';
    const fields = [{k: 'emp_no', label: 'Employee number', value: e.emp_no, readonly: !!arg}, {k: 'full_name', label: 'Full name', value: e.full_name}, {k: 'designation', label: 'Designation', value: e.designation},
      {k: 'class', label: 'Class', value: e.class}, {k: 'station', label: 'Station', type: 'select', options: [['', '—']].concat((C.dir?.stations || []).map(s => [s.short_name, s.short_name])).concat(e.station && !(C.dir?.stations || []).some(s => s.short_name === e.station) ? [[e.station, e.station]] : []), value: e.station || ''},
      {k: 'department', label: 'Department', value: e.department}, {k: 'mobile', label: 'Mobile', type: 'tel', value: e.mobile}, {k: 'office_phone', label: 'Office phone', value: e.office_phone},
      {k: 'extension', label: 'Extension', value: e.extension}, {k: 'email', label: 'E-mail', type: 'email', value: e.email}, {k: 'blood_group', label: 'Blood group', type: 'select', options: [''].concat(CON_BLOOD), value: e.blood_group || ''},
      {k: 'date_of_birth', label: 'Date of birth', type: 'date', value: (e.date_of_birth || '').slice(0, 10), hint: arg ? '' : 'The first password is made from the name initials and this date.'},
      {k: 'show_mobile', label: 'Mobile visible in the directory', type: 'check', value: e.show_mobile}].concat(arg ? [] : [{k: 'active', label: 'Active (can sign in)', type: 'check', value: e.active}]);
    if (admin) fields.push({k: 'role', label: 'Role', type: 'select', options: [['', 'Employee'], ['admin', 'Administrator']].concat(sup || d.can_grant_super || e.role === 'superadmin' ? [['superadmin', 'Super administrator (approves extra phones)']] : []), value: e.role === 'employee' ? '' : e.role || '',
        hint: !d.superadmin_exists ? 'No super administrator is set yet: choose “Super administrator” here for the first one (after that only a super administrator can give this role). They approve requests for extra phones in More › Phone approvals.' : ''},
      {k: 'can_view', label: 'May see', type: 'checks', options: d.modules, value: e.can_view, hint: 'Pages of the app: generation, dsm, rakes (railway rake tracking), coal (coal stock position), and the Safety tabs safety_obs (observations), safety_inc (incidents) and safety_ptw (permit to work). The first five and generation are open to everyone. See: own station; report or request.'},
      {k: 'can_edit', label: 'May change', type: 'checks', options: d.modules, value: e.can_edit, hint: 'coal = may enter the daily coal stock and rake unloading figures (an employee posted at WTPS, GTPS, STPS or UTPS only that station). safety_obs / safety_inc = safety officer: assign, investigate, close, all stations. ptw_de = Operation DE and ptw_sce = Shift Charge Engineer for permit approvals at their station.'});
    const phones = e.devices || [];
    const phone = arg ? `<div class="vals" style="margin:0 0 10px">${phones.length ? `Phones: ${phones.map(x => `<b>${esc(x.name)}</b>${x.at ? ' (' + conDate(x.at) + ')' : ''}${x.main ? ' · registered' : ` · approved extra${sup ? ` <a data-wact="revdev" data-warg="${esc(arg + '|' + x.id)}" style="color:var(--neg)">Remove</a>` : ''}`}`).join('; ')}. “Release phone” clears them all; the next phone that confirms a code is registered.` : 'No phone registered yet: the first phone that confirms an e-mailed code is registered.'}${e.role === 'admin' || e.role === 'superadmin' ? ' Administrators may use several phones.' : ''}</div>` : '';
    const b = e.blocked, blockLine = !arg || !sup || String(arg) === String(wMe().emp_no) ? '' : e.active
      ? `<div style="margin:12px 0 0">${wBtn('Block access', 'blockemp', arg)} <span class="muted" style="font-size:12px">signs them out on every phone; they cannot sign in until unblocked</span></div>`
      : `<div class="alert err" style="margin:10px 0"><span>⛔</span><span><b>Access blocked</b>${b ? ` on ${esc(conDate(b.at))} by ${esc(b.by_name || b.by)}${b.reason ? ': ' + esc(b.reason) : ''}` : ''}.</span></div>${wBtn('Unblock', 'unblockemp', arg, true)}`;
    f = {kind, title: arg ? `Employee ${arg}` : 'Add an employee', ctx: {emp_no: arg, isNew: !arg}, fields, extra: arg ? phone + wBtn('Reset password', 'resetpw', arg) + (phones.length ? ' ' + wBtn('Release phone', 'reldev', arg) : '') + blockLine : ''};
  }
  W.form = f; W.error = ''; W.note = '';
  conRender(); window.scrollTo({top: 0});
}

async function wSave() {
  const f = W.form;
  if (!f || W.busy) return;
  let v;
  try { v = await wFormRead(f.fields); } catch (e) { W.error = e.message; return conRender(); }
  let action, params, after;
  if (f.kind === 'editunit') { const {unit, ...fields} = v; action = 'save_unit'; params = {station: f.ctx.station, unit, fields}; after = () => wOpen(W.page, true); }
  else if (f.kind === 'editeff') { const values = {}; for (const k in v) if (k.startsWith('m_')) values[k.slice(2)] = v[k]; W.sel.eyear = v.year; action = 'save_efficiency'; params = {station: f.ctx.station, unit: f.ctx.unit, year: v.year, values}; after = () => wOpen('efficiency', true); }
  else if (f.kind === 'editout') { action = 'save_outage'; params = {id: f.ctx.id, fields: v}; after = () => { W.form = null; return wOutages(); }; }
  else if (f.kind === 'editmerit') { action = 'save_merit'; params = {period_from: v.period_from, period_to: v.period_to, rows: f.ctx.rows.map((r, i) => ({category: r.category, group: r.group, name: r.name, cost: v['c_' + i]})).filter(r => r.cost !== '')}; after = () => wOpen('meritreg', true); }
  else if (f.kind === 'editshut') { const [station, unit] = (v.unitkey || '').split('|'); action = 'save_shutdown'; params = {station, unit, fy: v.fy, type: v.type, from: v.from, to: v.to, remarks: v.remarks}; W.sel.pfy = v.fy; after = () => { W.form = null; return wOpen('aohplan', true); }; }
  else if (f.kind === 'pubcirc') { const {file, ...fields} = v; action = 'publish_circular'; params = {fields, file}; }
  else if (f.kind === 'pubnews') {
    const el = $('wf_image'); let image = null;
    if (el.files[0]) { try { image = await wPhoto(el.files[0]); } catch (e) { W.error = e.message; return conRender(); } }
    const {image: _drop, ...fields} = v; action = 'post_news'; params = {fields, image};
  }
  else if (f.kind === 'pubnote') { action = 'send_notification'; params = {fields: v}; }
  else if (f.kind === 'editemp') { const {emp_no, ...fields} = v; action = 'save_employee'; params = {emp_no: f.ctx.emp_no || emp_no, is_new: f.ctx.isNew, fields}; after = () => wOpen('admin', true); }
  // Keep what was typed if the save fails.
  f.fields.forEach(x => { if (x.type !== 'file') x.value = v[x.k]; });
  W.busy = true; W.error = ''; conRender();
  const r = await conCall(action, params);
  W.busy = false;
  if (!r.ok) { W.error = r.error; return conRender(); }
  const note = r.data.message || 'Saved';
  if (f.kind.startsWith('pub')) { C.home = null; C.circ.items = null; C.news.items = null; W.page = ''; W.form = null; }
  if (after) await after();
  W.note = note; conRender(); window.scrollTo({top: 0});
}

// ---------------------------------------------------------------- render & interaction

/** The "More" tab of the Connect view. */
function wTab() {
  if (W.form) return wBack('Back') + wFormHtml(W.form.title, W.form.fields, W.form.saveLabel) + (W.form.extra ? `<div class="card">${W.form.extra}</div>` : '');
  if (!W.page) return wMsg() + wMenu();
  const body = {stations: wStations, boilers: wBoilers, efficiency: wEfficiency, outreg: W.data.opackOff ? wOutReg : oReg, meritreg: wMerit, capacity: wCapacity, admin: wAdmin, activity: wActivity, devreq: wDevReq, mgmtrep: wMgmtReport, aohplan: typeof wPlan === 'function' ? wPlan : null, pafafc: typeof wPafAfc === 'function' ? wPafAfc : null}[W.page];
  const stamp = W_LOADS[W.page] && W.stamp && W.stamp[W_LOADS[W.page][0]];
  return wBack() + (W.page === 'admin' ? '' : wMsg())
    + (stamp ? `<div class="note-src" style="text-align:center;margin:0 0 8px">${W.busy ? 'Reading the Google Sheet…' : 'Read from the Google Sheet ' + wAgo(stamp)} · <a data-tact="reload">Refresh</a></div>` : '')
    + (body ? body() : '');
}

document.addEventListener('click', async e => {
  const el = e.target.closest('[data-wact]');
  if (!el || !hasConnect()) return;
  const arg = el.dataset.warg || '';
  switch (el.dataset.wact) {
    case 'open': return wOpen(arg);
    case 'back': if (W.form) { W.form = null; W.error = ''; if (W.page.startsWith('pub')) W.page = ''; } else W.page = ''; conRender(); return window.scrollTo({top: 0});
    case 'cancel': W.form = null; W.error = ''; if (W.page.startsWith('pub')) W.page = ''; return conRender();
    case 'fold': W.open.has(arg) ? W.open.delete(arg) : W.open.add(arg); return el.parentElement.classList.toggle('open');
    case 'foldgo': { W.open.add(arg); conRender(); const t = [...document.querySelectorAll('[data-wact="fold"]')].find(x => x.dataset.warg === arg); return t && t.scrollIntoView({behavior: 'smooth', block: 'start'}); }
    case 'toggle': return el.classList.toggle('on');
    case 'pick': e.preventDefault(); return el.classList.toggle('on');
    case 'save': return wSave();
    case 'editemp': {
      W.empFull = null;
      if (arg) {                                        // the full record of this one employee
        W.busy = true; W.error = ''; conRender();
        const r = await conCall('admin_employee', {emp_no: arg});
        W.busy = false;
        if (!r.ok) { W.error = r.error; return conRender(); }
        W.empFull = r.data.employee;
      }
      return wStartForm('editemp', arg);
    }
    case 'admreload': return wAdminLoad();
    case 'editunit': case 'editeff': case 'editout': case 'editmerit': return wStartForm(el.dataset.wact, arg);
    case 'ocls': W.sel.ocls = arg; return wOutages();
    case 'omore': return wOutages(true);
    case 'delout': {
      if (!confirm('Delete this outage entry?')) return;
      const r = await conCall('delete_outage', {id: +arg});
      if (!r.ok) { W.error = r.error; return conRender(); }
      await wOutages(); W.note = r.data.message || 'Deleted'; return conRender();
    }
    case 'resetpw': {
      if (!confirm(`Reset the password of employee ${arg}? They will be signed out everywhere.`)) return;
      const r = await conCall('reset_password', {emp_no: arg});
      if (r.ok) alert(r.data.message); else alert(r.error);
      return;
    }
    case 'ablk': W.sel.ablk = !W.sel.ablk; return conRender();
    case 'blockemp': case 'unblockemp': {
      const block = el.dataset.wact === 'blockemp';
      let reason = '';
      if (block) {
        if (!confirm(`Block employee ${arg}? They are signed out on every phone and cannot use the app until unblocked.`)) return;
        reason = prompt('Reason (optional, kept with the record):', '');
        if (reason === null) reason = '';
      } else if (!confirm(`Unblock employee ${arg}? They can sign in again.`)) return;
      const r = await conCall('block_employee', {emp_no: arg, block, reason: reason.trim()});
      if (!r.ok) return alert(/unknown action/i.test(r.error) ? 'Update the GSECL Connect script in the Google Sheet (paste the new Code.gs and deploy a new version) to use blocking.' : r.error);
      alert(r.data.message); W.form = null; return wOpen('admin', true);
    }
    case 'reldev': {
      if (!confirm(`Release the registered phone of employee ${arg}? They are signed out there and can sign in on a new phone.`)) return;
      const r = await conCall('release_device', {emp_no: arg});
      if (!r.ok) return alert(r.error);
      alert(r.data.message); W.form = null; return wOpen('admin', true);
    }
    case 'aev': W.sel.aev = arg; return conRender();
    case 'openrep': {
      if (W.busy) return;
      W.sel.repday = $('wRepDay').value || '';
      W.busy = true; W.error = ''; conRender();
      const r = await conAsk(id => Connect.openReport(id, W.sel.repday));
      W.busy = false;
      if (!r.ok) W.error = r.error || 'Could not make the report';
      return conRender();
    }
    case 'devok': case 'devno': {
      const approve = el.dataset.wact === 'devok';
      const note = approve ? '' : prompt('Reason for not approving (sent to the employee, optional):', '');
      if (note === null) return;
      if (approve && !confirm('Approve this phone? The employee can then sign in on it as well.')) return;
      const r = await conCall('device_decide', {id: +arg, approve, note});
      if (!r.ok) { W.error = r.error; return conRender(); }
      await wOpen('devreq', true); W.note = r.data.message; return conRender();
    }
    case 'revdev': {
      const [no, key] = arg.split('|');
      if (!confirm('Remove this approved phone? It is signed out at its next request.')) return;
      const r = await conCall('device_revoke', {emp_no: no, key});
      if (!r.ok) return alert(r.error);
      alert(r.data.message); W.form = null; return wOpen('admin', true);
    }
    case 'photo': return $('mePhotoFile').click();
  }
});

document.addEventListener('change', async e => {
  const sel = e.target.dataset?.wsel;
  if (sel) {
    W.sel[sel] = e.target.value;
    if (sel === 'ostation') W.sel.ounit = '';
    if (!W.data.opackOff && (sel === 'period' || sel === 'ostation' || sel === 'ounit')) return sel === 'period' ? oLoad() : conRender();
    if (sel === 'period' || sel === 'ostation') return wOutages();
    return conRender();
  }
  // Profile photo chosen (Profile view).
  if (e.target.id === 'mePhotoFile' && e.target.files[0]) {
    try {
      const p = await wPhoto(e.target.files[0]);
      C.meError = ''; C.saving = true; meRender();
      const r = await conCall('upload_photo', {data: p.data, mime_type: p.mime_type});
      C.saving = false;
      if (!r.ok) alert(r.error);
    } catch (err) { C.saving = false; alert(err.message); }
    meRender();
  }
});
document.addEventListener('input', e => {
  if (e.target.id === 'wActQ') {
    W.sel.aq2 = e.target.value;
    const d = W.data.activity, f = W.sel.aev || '', q = e.target.value.toLowerCase();
    if (d) $('wActList').innerHTML = wActRows(d.events.filter(x => (!f || wEvKind(x.event) === f) && (!q || `${x.emp_no} ${x.name} ${x.station} ${x.device}`.toLowerCase().includes(q))));
    return;
  }
  if (e.target.id === 'wAdminQ') { W.sel.aq = e.target.value; const keep = e.target.selectionStart; conRender(); $('wAdminQ').focus(); $('wAdminQ').setSelectionRange(keep, keep); }
});

/** Android back button: close a form, then a section, then leave "More" (handled by connect.js). */
const wPrevBack = window.appBack;
window.appBack = () => {
  if ($('v-connect').classList.contains('on') && C.tab === 'more' && !C.detail) {
    if (W.form) { W.form = null; if (W.page.startsWith('pub')) W.page = ''; conRender(); return true; }
    if (W.page) { W.page = ''; conRender(); return true; }
  }
  return wPrevBack ? wPrevBack() : false;
};

// ---------------------------------------------------------------- two-step sign-in (Profile): Google Authenticator

const TS = {step: '', secret: '', uri: '', msg: '', err: '', busy: false};

/** Profile card: set up or remove Google Authenticator; shows which ways of getting the sign-in code this account has. */
function tsRender() {
  const box = $('twoStep');
  if (!box || !hasConnect()) return;
  box.dataset.done = '1';
  const two = wMe().two_step || {}, on = !!two.totp;
  const line = (ok, label, sub) => `<div class="tg" style="border-top:1px solid var(--line)"><div><b>${ok ? '✓ ' : ''}${esc(label)}</b><span>${sub}</span></div></div>`;
  let h = `<h2>Two-step sign-in</h2>
    <div class="vals" style="font-size:12.5px;color:var(--muted)">At every sign-in, and once a week on each phone, a 6-digit code confirms it is you. Ways you can get it:</div>
    ${line(true, 'E-mail', two.email ? 'to ' + esc(two.email) : 'no e-mail recorded: ask the administrator')}
    ${line(!!two.sms, 'SMS', two.sms ? 'to your registered mobile' : 'not available (needs the SMS gateway and your mobile number in the record)')}
    ${line(on, 'Google Authenticator', on ? 'set up: open the app and type the code shown for GSECL Connect — works without network or waiting for mail' : 'not set up')}`;
  if (TS.step === 'setup') {
    h += `<div class="oq" style="--oc:var(--accent);margin-top:12px">
      <b>1. Add GSECL Connect to Google Authenticator</b>
      <div class="vals" style="margin:4px 0 8px">Install <b>Google Authenticator</b> from the Play Store if needed, then touch the button. Or in the app choose <i>+ › Enter a setup key</i> and type the key below (time based).</div>
      <button class="btn" data-tsact="open" style="background:var(--accent);color:#fff;border-color:var(--accent)">Open in Google Authenticator</button>
      <div style="display:flex;align-items:center;gap:8px;margin-top:10px"><code class="num" style="font-size:14px;letter-spacing:.06em;background:var(--soft);padding:6px 8px;border-radius:8px;flex:1;word-break:break-all">${esc(TS.secret)}</code><button class="btn" data-tsact="copy" style="color:var(--accent)">Copy key</button></div>
      <b style="display:block;margin-top:12px">2. Type the 6-digit code it shows</b>
      <input class="search" id="tsCode" inputmode="numeric" maxlength="6" placeholder="6-digit code" autocomplete="one-time-code" style="margin:6px 0">
      <div style="display:flex;gap:8px"><button class="btn" data-tsact="confirm" style="background:var(--accent);color:#fff;border-color:var(--accent)">Confirm</button><button class="btn" data-tsact="cancel">Cancel</button></div>
      <div class="note-src">Keep the key private. This set-up is valid for 15 minutes.</div></div>`;
  } else if (TS.step === 'remove') {
    h += `<div class="oq" style="--oc:var(--neg);margin-top:12px"><b>Remove Google Authenticator</b><div class="vals" style="margin:4px 0 6px">Type the current code from Google Authenticator to confirm.</div>
      <input class="search" id="tsCode" inputmode="numeric" maxlength="6" placeholder="6-digit code" style="margin:0 0 6px">
      <div style="display:flex;gap:8px"><button class="btn" data-tsact="disable" style="color:var(--neg)">Remove</button><button class="btn" data-tsact="cancel">Cancel</button></div></div>`;
  } else {
    h += `<div style="margin-top:10px">${on ? `<button class="btn" data-tsact="askremove" style="color:var(--neg)">Remove Google Authenticator</button>` : `<button class="btn" data-tsact="setup" style="background:var(--accent);color:#fff;border-color:var(--accent)">Set up Google Authenticator</button>`}</div>`;
  }
  if (TS.busy) h += '<div class="note-src">Please wait…</div>';
  if (TS.err) h += `<div class="alert err" style="margin:10px 0 0"><span>⚠</span><span>${esc(TS.err)}</span></div>`;
  if (TS.msg) h += `<div class="alert" style="margin:10px 0 0;background:#dcfce7;color:#166534;border-color:#bbf7d0"><span>✓</span><span>${esc(TS.msg)}</span></div>`;
  box.innerHTML = h;
}

document.addEventListener('click', async e => {
  const b = e.target.closest('[data-tsact]');
  if (!b || TS.busy) return;
  const act = b.dataset.tsact;
  TS.err = ''; TS.msg = '';
  const run = async (action, params) => { TS.busy = true; tsRender(); const r = await conCall(action, params); TS.busy = false; return r; };
  if (act === 'setup') {
    const r = await run('totp_setup', {});
    if (r.ok) Object.assign(TS, {step: 'setup', secret: r.data.secret, uri: r.data.uri}); else TS.err = r.error;
  } else if (act === 'open') { if (typeof Connect !== 'undefined' && Connect.openAuthenticator) Connect.openAuthenticator(TS.uri); return; }
  else if (act === 'copy') { if (typeof Connect !== 'undefined' && Connect.copyText) Connect.copyText(TS.secret.replace(/ /g, '')); return; }
  else if (act === 'cancel') { TS.step = ''; }
  else if (act === 'askremove') { TS.step = 'remove'; }
  else if (act === 'confirm' || act === 'disable') {
    const code = ($('tsCode').value || '').replace(/\D/g, '');
    if (code.length !== 6) { TS.err = 'Type the 6-digit code from Google Authenticator.'; return tsRender(); }
    const r = await run(act === 'confirm' ? 'totp_confirm' : 'totp_disable', {otp: code});
    if (r.ok) { TS.step = ''; TS.secret = ''; TS.uri = ''; TS.msg = r.data.message; } else TS.err = r.error;
  }
  tsRender();
});
