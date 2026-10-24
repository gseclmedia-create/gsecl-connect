// Safety: observations, incident reporting and permit to work (PTW), stored in the GSECL Connect
// Google Sheet. The structure follows the SIMS portal: the same option lists, incident reporting
// deadlines by type, and the PTW chain Operation DE (receipt) -> SCE -> Operation DE (issue).
// Which tabs an employee sees, and what they may do, is set per employee on the Employees screen
// (safety_obs, safety_inc, safety_ptw, ptw_de, ptw_sce). The service checks every action again.
// Uses conCall, conSaved, conAsk, conDate, conName, conEmpty, conErr, conSpin, conLoadDirectory, C from connect.js,
// wPhoto from work.js, appCan from coalstock.js, and $, esc, fmt from index.html.

const Y = {tab: '', data: null, stamp: 0, busy: false, error: '', note: '', detail: null, form: null, act: '', saving: false,
  f: {obs: 'open', inc: 'open', ptw: 'open', station: ''}};
const Y_TABS = [['dash', 'Overview', ''], ['obs', 'Observations', 'safety_obs'], ['inc', 'Incidents', 'safety_inc'], ['ptw', 'Permit to work', 'safety_ptw']];
const Y_STATUS = {reported: ['Reported', 'b-Planned'], assigned: ['Assigned', 'b-RSD'], completed: ['Closed', 'b-Running'], investigation: ['Investigation', 'b-RSD'],
  closed: ['Closed', 'b-Running'], requested: ['Awaiting approval', 'b-Planned'], approved: ['Issued', 'b-RSD'], active: ['Work in progress', 'b-Forced'],
  rejected: ['Rejected', 'b-Off'], cancelled: ['Withdrawn', 'b-Off']};
const Y_PRIORITY = {low: 'var(--run)', medium: 'var(--planned)', high: 'var(--coal)', critical: 'var(--forced)'};
const Y_FRESH_MIN = 2;                                   // the sheet is read again when the copy is older than this

const yCanTab = t => appCan(Y_TABS.find(x => x[0] === t)[2]);
/** The overview is there for anyone with at least one safety tab. */
const yTabs = () => { const t = Y_TABS.filter(x => x[2] && appCan(x[2])); return t.length ? [Y_TABS[0]].concat(t) : []; };
const yMsg = () => (Y.error ? conErr(Y.error) : '') + (Y.note ? `<div class="alert" style="background:#dcfce7;color:#166534;border-color:#bbf7d0"><span>✓</span><span>${esc(Y.note)}</span></div>` : '');
const yBtn = (label, act, arg = '', primary = false, colour = '') => `<button class="btn" data-yact="${act}" data-yarg="${esc(arg)}" style="${primary ? `background:${colour || 'var(--accent)'};color:#fff;border-color:${colour || 'var(--accent)'}` : 'color:var(--accent)'}">${esc(label)}</button>`;
const yBadge = s => { const [l, c] = Y_STATUS[s] || [s || '—', 'b-Off']; return `<span class="badge ${c}">${esc(l)}</span>`; };
const yWhen = s => (s ? conDate(s, true) : '—');
const yNow = () => { const d = new Date(), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
const yMs = s => (s ? new Date(String(s).replace(' ', 'T') + ':00+05:30').getTime() : 0);
const yLate = (due, done) => due && !done && yMs(due) < Date.now();
const yRow = (label, value) => (value === null || value === undefined || value === '' ? '' : `<div><span>${esc(label)}</span>${value}</div>`);
/** A longer text (description, root cause, JSA) under its label, outside the two-column grid. */
const yLong = (label, text) => (text ? `<div style="margin-top:10px"><div class="muted" style="font-size:10.5px;text-transform:uppercase;letter-spacing:.04em">${esc(label)}</div><div style="white-space:pre-wrap;font-size:13.5px;margin-top:2px">${esc(text)}</div></div>` : '');
const yStationName = st => ((Y.data?.stations || []).find(s => s.short_name.toUpperCase() === String(st || '').toUpperCase()) || {}).name || st || '—';

// ---------------------------------------------------------------- loading

async function yLoad(force = false) {
  if (Y.busy || typeof Connect === 'undefined') return;
  const saved = conSaved('safety_data');
  if (saved && !Y.data) { Y.data = saved.data; Y.stamp = Date.now() - saved.age * 60000; }
  if (saved && !force && saved.age < Y_FRESH_MIN) return yRender();
  Y.busy = true; Y.error = ''; yRender();
  const r = await conCall('safety_data', {days: 550});
  Y.busy = false;
  if (r.ok) { Y.data = r.data; Y.stamp = Date.now(); Connect.cacheSet('safety_data', JSON.stringify(r.data)); }
  else if (!Y.data || !saved) Y.error = /unknown action/i.test(r.error) ? 'The GSECL Connect script in the Google Sheet has not been updated for the Safety pages yet. Paste the new Code.gs and deploy a new version.' : r.error;
  yRender();
}

/** Photos are fetched once through the service and kept for the session (shared with Connect). */
async function yPhoto(id) {
  if (!id || C.photos[id] !== undefined) return;
  C.photos[id] = '';
  const r = await conAsk(k => Connect.image(k, id));
  C.photos[id] = r.ok ? r.body : false;            // false: could not be shown here; listed by name instead
  yRender();
}
const Y_ACCEPT = 'image/*,application/pdf,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt';
const Y_MAX_FILES = 10;
/** Attachments of a record: pictures as thumbnails, documents as rows; touching either opens it in the phone's viewer. */
function yFiles(list, kind, id, canAdd) {
  list = list || [];
  const isPic = f => /^image\//.test(f.mime_type || '') && C.photos[f.id] !== false;
  const pics = list.filter(isPic), docs = list.filter(f => !isPic(f));
  const h = (pics.length ? `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">${pics.map(f => { yPhoto(f.id);
      return C.photos[f.id] ? `<img src="${C.photos[f.id]}" alt="${esc(f.name || 'Photo')}" data-yact="file" data-yarg="${esc(f.id)}" style="width:96px;height:96px;object-fit:cover;border-radius:10px">` : '<div class="sk" style="width:96px;height:96px;border-radius:10px"></div>'; }).join('')}</div>` : '')
    + docs.map(f => `<div class="srow" data-yact="file" data-yarg="${esc(f.id)}"><div class="top"><span class="nm">📄 ${esc(f.name || 'Document')}</span><span class="vals">${f.size ? fmt(f.size / 1048576, 1) + ' MB' : ''} ›</span></div></div>`).join('');
  const add = canAdd && list.length < Y_MAX_FILES ? `<div style="display:flex;gap:16px;margin-top:10px;font-size:13px;font-weight:600"><a data-yact="addcam" style="color:var(--accent)">📷 Take photo</a><a data-yact="addfiles" style="color:var(--accent)">＋ Add photos or documents</a></div>
    <input type="file" id="yAddCam" accept="image/*" capture="environment" hidden><input type="file" id="yAdd" accept="${Y_ACCEPT}" multiple hidden>` : '';
  return h + add;
}
/** Camera and file buttons of a form; what is taken or chosen is collected in Y.picked until the form is sent. */
function yPickerHtml() {
  return `<div style="display:flex;gap:8px;margin-top:6px">${yBtn('📷 Take photo', 'pick_cam')}${yBtn('Choose photos or documents', 'pick_files')}</div>
    <input type="file" id="yCam" accept="image/*" capture="environment" hidden><input type="file" id="yPick" accept="${Y_ACCEPT}" multiple hidden>
    <div id="yPicked">${yPickedList()}</div>`;
}
const yPickedList = () => (Y.picked || []).map((f, i) => `<div class="srow" style="cursor:default"><div class="top"><span class="nm">${/^image\//.test(f.type) ? '🖼' : '📄'} ${esc(f.name)}</span><span class="vals"><a data-yact="unpick" data-yarg="${i}" style="color:var(--neg)">Remove</a></span></div></div>`).join('')
  + `<div class="note-src" style="margin:4px 0 0">${(Y.picked || []).length} of ${Y_MAX_FILES} files. Photos are made smaller before sending; documents up to 10 MB each.</div>`;

/** Files chosen on the phone -> [{name, mime_type, data}]: photos made small, documents as they are (up to 10 MB each). */
async function yReadFiles(files) {
  const out = [];
  for (const f of [...files]) {
    if (/^image\//.test(f.type)) { const ph = await wPhoto(f); out.push({...ph, name: f.name.replace(/\.[^.]+$/, '') + '.jpg'}); }
    else { if (f.size > 10 * 1048576) throw new Error(f.name + ' is larger than 10 MB'); out.push(await wFile(f)); }
  }
  return out;
}

// ---------------------------------------------------------------- who may do what (the service checks again)

const yMe = () => Y.data?.me || {};
const yCan = (kind, how) => !!(Y.data?.can?.[kind] || {})[how];
const yAll = kind => !!(yMe().all || {})[kind];
/** May act at the permit's current approval stage. */
function yStageOk(p, stage) {
  const s = (Y.data?.stages || [])[stage - 1];
  if (!s) return false;
  if (yMe().admin) return true;
  if (!yCan('ptw', s.module === 'ptw_de' ? 'de' : 'sce')) return false;
  const mine = yMe().station || '';
  return !mine || mine === 'CO' || mine === String(p.station || '').toUpperCase();
}
const yMine = (r, key) => String(r[key] || '') === String(yMe().emp_no || '');

// ---------------------------------------------------------------- lists

function yStationFilter(kind) {
  if (!yAll(kind)) return '';
  const used = [...new Set((kind === 'obs' ? Y.data.observations : kind === 'inc' ? Y.data.incidents : Y.data.permits).map(r => r.station).filter(Boolean))].sort();
  return used.length > 1 ? `<select class="search" data-ysel="station" style="margin:0 0 8px"><option value="">All stations</option>${used.map(s => `<option ${Y.f.station === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>` : '';
}
const yChips = (kind, list) => `<div class="chips">${list.map(([v, l, n]) => `<button class="chip ${Y.f[kind] === v ? 'on' : ''}" data-yact="filter" data-yarg="${kind}|${v}">${l}${n ? ` <span class="cnt" style="position:static;margin-left:2px">${n}</span>` : ''}</button>`).join('')}</div>`;
const yStat = (label, value, cls = '', small = '') => `<div><span>${label}</span><b class="num ${cls}">${value}</b>${small ? `<small>${small}</small>` : ''}</div>`;

function yTabObs() {
  const all = Y.data.observations.filter(r => !Y.f.station || r.station === Y.f.station), open = all.filter(r => r.status !== 'completed');
  const today = new Date().toISOString().slice(0, 10), overdue = open.filter(r => r.target_date && r.target_date < today);
  const mineToDo = open.filter(r => yMine(r, 'assigned_to'));
  const f = Y.f.obs, list = all.filter(r => f === 'all' || (f === 'open' ? r.status !== 'completed' : f === 'mine' ? yMine(r, 'assigned_to') || yMine(r, 'reported_by') : r.status === 'completed'));
  return `<div class="card"><h2>Safety observations ${conMore(yAll('obs') ? 'all stations' : yStationName(yMe().station))}</h2><div class="tstats" style="grid-template-columns:repeat(3,1fr)">
      ${yStat('Open', open.length)}${yStat('High / critical', open.filter(r => r.priority === 'high' || r.priority === 'critical').length, 'neg')}${yStat('Past target', overdue.length, overdue.length ? 'neg' : '')}</div>
      <div style="margin-top:10px">${yBtn('Report an observation', 'new', 'obs', true)}</div></div>
    ${yStationFilter('obs')}${yChips('obs', [['open', 'Open'], ['mine', 'Mine', mineToDo.length], ['closed', 'Closed'], ['all', 'All']])}
    ${list.map(r => `<div class="oq" style="--oc:${Y_PRIORITY[r.priority] || 'var(--line)'}" data-yact="open" data-yarg="obs|${r.id}">
      <div class="oq-h"><span class="nm">${esc(r.obs_type || 'Observation')} · ${esc(r.category || '')}</span>${yBadge(r.status)}</div>
      <div class="rs">${esc(String(r.description || '').slice(0, 160))}</div>
      <div class="meta num"><div><span>Where</span>${esc(r.station)} · ${esc(r.location || '')}</div><div><span>Priority</span>${esc(r.priority || '—')}${r.target_date ? ` · target ${conDate(r.target_date)}` : ''}</div></div>
      <div class="live">${esc(r.obs_no)} · ${esc(r.reported_by_name || '')} · ${yWhen(r.reported_at)}${r.assigned_name ? ` · with ${esc(r.assigned_name)}` : ''}</div></div>`).join('') || `<div class="card">${conEmpty('No observation here.')}</div>`}`;
}

function yTabInc() {
  const all = Y.data.incidents.filter(r => !Y.f.station || r.station === Y.f.station), open = all.filter(r => r.status !== 'closed');
  const late = all.filter(r => yLate(r.flash_due_at, r.flash_sent_at) || yLate(r.detailed_due_at, r.detailed_sent_at));
  const fyStart = (() => { const d = new Date(), y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1; return `${y}-04-01`; })();
  const thisFy = all.filter(r => String(r.incident_time || '') >= fyStart);
  const f = Y.f.inc, list = all.filter(r => f === 'all' || (f === 'open' ? r.status !== 'closed' : f === 'late' ? late.includes(r) : r.status === 'closed'));
  return `<div class="card"><h2>Incidents ${conMore(yAll('inc') ? 'all stations' : yStationName(yMe().station))}</h2><div class="tstats" style="grid-template-columns:repeat(3,1fr)">
      ${yStat('Open', open.length)}${yStat('Reports overdue', late.length, late.length ? 'neg' : '')}${yStat('This year', thisFy.length, '', fmt(thisFy.reduce((t, r) => t + (r.days_lost || 0), 0)) + ' days lost')}</div>
      <div style="margin-top:10px">${yBtn('Report an incident', 'new', 'inc', true, 'var(--forced)')}</div></div>
    ${yStationFilter('inc')}${yChips('inc', [['open', 'Open'], ['late', 'Report overdue', late.length], ['closed', 'Closed'], ['all', 'All']])}
    ${list.map(r => `<div class="oq" style="--oc:${/Fatality|Lost Time|Dangerous|Electrical/.test(r.type) ? 'var(--forced)' : r.type === 'Near Miss' ? 'var(--planned)' : 'var(--rsd)'}" data-yact="open" data-yarg="inc|${r.id}">
      <div class="oq-h"><span class="nm">${esc(r.type)}</span>${yBadge(r.status)}<span class="cap num">${esc(r.station)}</span></div>
      <div class="rs">${esc(String(r.description || '').slice(0, 160))}</div>
      <div class="meta num"><div><span>When</span>${yWhen(r.incident_time)}</div><div><span>Where</span>${esc(r.location || '—')}</div></div>
      ${yLate(r.flash_due_at, r.flash_sent_at) || yLate(r.detailed_due_at, r.detailed_sent_at) ? `<div class="live" style="color:var(--neg);font-weight:600">⚠ ${yLate(r.flash_due_at, r.flash_sent_at) ? 'Flash' : 'Detailed'} report overdue</div>` : ''}
      <div class="live">${esc(r.incident_no)} · ${esc(r.severity || 'severity not set')} · ${esc(r.reported_by_name || '')}</div></div>`).join('') || `<div class="card">${conEmpty('No incident here.')}</div>`}`;
}

const yStageLabel = p => (p.status === 'requested' ? ((Y.data.stages || [])[(p.stage || 1) - 1] || {}).label : '');
function yTabPtw() {
  const all = Y.data.permits.filter(r => !Y.f.station || r.station === Y.f.station);
  const waiting = all.filter(p => p.status === 'requested' && yStageOk(p, p.stage || 1));
  const active = all.filter(p => p.status === 'active'), issued = all.filter(p => p.status === 'approved');
  const f = Y.f.ptw, done = ['closed', 'cancelled', 'rejected'];
  const list = all.filter(p => f === 'all' || (f === 'open' ? !done.includes(p.status) : f === 'todo' ? waiting.includes(p) : f === 'mine' ? yMine(p, 'requested_by') : done.includes(p.status)));
  return `<div class="card"><h2>Permit to work ${conMore(yAll('ptw') ? 'all stations' : yStationName(yMe().station))}</h2><div class="tstats" style="grid-template-columns:repeat(3,1fr)">
      ${yStat('Awaiting you', waiting.length, waiting.length ? 'neg' : '')}${yStat('Work in progress', active.length)}${yStat('Issued, not started', issued.length)}</div>
      <div style="margin-top:10px">${yBtn('Request a permit', 'new', 'ptw', true)}</div></div>
    ${yStationFilter('ptw')}${yChips('ptw', [['open', 'Open'], ['todo', 'To approve', waiting.length], ['mine', 'Mine'], ['closed', 'Closed'], ['all', 'All']])}
    ${list.map(p => `<div class="oq" style="--oc:${p.status === 'active' ? 'var(--forced)' : p.status === 'approved' ? 'var(--rsd)' : p.status === 'requested' ? 'var(--planned)' : 'var(--line)'}" data-yact="open" data-yarg="ptw|${p.id}">
      <div class="oq-h"><span class="nm">${esc(p.permit_type)}</span>${yBadge(p.status)}<span class="cap num">${esc(p.station)}</span></div>
      <div class="rs">${esc(String(p.description || '').slice(0, 140))}</div>
      <div class="meta num"><div><span>Location</span>${esc(p.work_location || '—')}</div><div><span>Valid</span>${yWhen(p.start_time)} → ${yWhen(p.end_time)}</div></div>
      <div class="live">${esc(p.permit_no)} · ${esc(p.requested_by_name || '')}${yStageLabel(p) ? ` · <b>with ${esc(yStageLabel(p))}</b>` : ''}${waiting.includes(p) ? ' · <b style="color:var(--neg)">your approval</b>' : ''}</div></div>`).join('') || `<div class="card">${conEmpty('No permit here.')}</div>`}`;
}

// ---------------------------------------------------------------- overview (as the SIMS portal dashboard)

const Y_PERIODS = [['30', '30 days'], ['180', '6 months'], ['365', '12 months'], ['fy', 'This FY'], ['custom', 'Custom']];
const yFyStart = () => { const d = new Date(), y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1; return `${y}-04-01`; };
const yUntil = () => (Y.f.period === 'custom' && Y.f.to ? Y.f.to : '9999-12-31');
const ySince = () => (Y.f.period === 'custom' && Y.f.from ? Y.f.from : Y.f.period === 'fy' ? yFyStart() : (() => { const d = new Date(Date.now() - (+Y.f.period || 365) * 864e5); return d.toISOString().slice(0, 10); })());
const yMon = iso => `${CON_MON[+iso.slice(5, 7) - 1]} ${iso.slice(2, 4)}`;
/** Horizontal bars with the count written beside each. rows: [[label, n, colour]] */
const yCountBars = (rows, colour) => { const max = Math.max(1, ...rows.map(r => r[1]));
  return rows.map(([l, n, c]) => `<div class="srow" style="cursor:default"><div class="top"><span class="nm">${esc(l)}</span><span class="vals num"><b style="color:var(--ink)">${n}</b></span></div>
    <div style="height:9px;margin-top:5px;border-radius:3px;width:${Math.max(n ? 2 : 0, n / max * 100)}%;background:${c || colour}"></div></div>`).join('') || conEmpty('Nothing in this period.'); };

function yTabDash() {
  const since = ySince(), st = Y.f.station, inSt = r => !st || r.station === st;
  const can = k => yCanTab(k);
  const inc = can('inc') ? Y.data.incidents.filter(inSt) : [], obs = can('obs') ? Y.data.observations.filter(inSt) : [], ptw = can('ptw') ? Y.data.permits.filter(inSt) : [];
  const until = yUntil(), inP = (r, k) => { const d = String(r[k] || '').slice(0, 10); return d >= since && d <= until; };
  const incP = inc.filter(r => inP(r, 'incident_time')), obsP = obs.filter(r => inP(r, 'reported_at')), ptwP = ptw.filter(r => inP(r, 'requested_at'));
  const today = new Date().toISOString().slice(0, 10);
  // Days without a lost-time injury or fatality (over the records on the phone, up to the last year and a half).
  const lti = inc.filter(r => /Lost Time|Fatality/i.test(r.type) || (r.days_lost || 0) > 0).map(r => String(r.incident_time || '')).sort().pop();
  const ltiDays = lti ? Math.floor((Date.now() - yMs(lti)) / 864e5) : null;
  const late = inc.filter(r => yLate(r.flash_due_at, r.flash_sent_at) || yLate(r.detailed_due_at, r.detailed_sent_at));
  const obsLate = obs.filter(r => r.status !== 'completed' && r.target_date && r.target_date < today);
  const waiting = ptw.filter(p => p.status === 'requested' && yStageOk(p, p.stage || 1));
  const stations = [...new Set([...inc, ...obs, ...ptw].map(r => r.station).filter(Boolean))].sort();
  let h = `<div class="chips">${Y_PERIODS.map(([k, l]) => `<button class="chip ${(Y.f.period || '365') === k ? 'on' : ''}" data-yact="period" data-yarg="${k}">${l}</button>`).join('')}</div>`
    + (Y.f.period === 'custom' ? `<div style="display:grid;grid-template-columns:1fr 1fr auto;gap:6px;align-items:end;margin-bottom:8px">
      <label style="font-size:11px;color:var(--muted)">From<input class="search" id="yFrom" type="date" value="${esc(Y.f.from || ySince())}" style="margin:2px 0 0;padding:8px"></label>
      <label style="font-size:11px;color:var(--muted)">To<input class="search" id="yTo" type="date" value="${esc(Y.f.to || new Date().toISOString().slice(0, 10))}" style="margin:2px 0 0;padding:8px"></label>
      <button class="btn" data-yact="papply" style="background:var(--accent);color:#fff;border-color:var(--accent);margin:0">Show</button></div>` : '')
    + (stations.length > 1 && (yAll('obs') || yAll('inc') || yAll('ptw')) ? `<select class="search" data-ysel="station" style="margin:0 0 8px"><option value="">All stations</option>${stations.map(s => `<option ${st === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>` : '');
  h += `<div class="card"><h2>Safety at a glance ${conMore(st ? yStationName(st) : yAll('inc') || yAll('obs') ? 'all stations' : yStationName(yMe().station))}</h2>
    <div class="tstats" style="grid-template-columns:repeat(3,1fr)">
      ${can('inc') ? yStat('Days without LTI', ltiDays === null ? '—' : fmt(ltiDays), ltiDays !== null && ltiDays < 30 ? 'neg' : 'pos', lti ? 'since ' + conDate(lti) : 'none on record') : ''}
      ${can('inc') ? yStat('Incidents', incP.length, '', `${inc.filter(r => r.status !== 'closed').length} open`) : ''}
      ${can('inc') ? yStat('Reports overdue', late.length, late.length ? 'neg' : '') : ''}
      ${can('obs') ? yStat('Observations', obsP.length, '', `${obs.filter(r => r.status !== 'completed').length} open`) : ''}
      ${can('obs') ? yStat('Past target', obsLate.length, obsLate.length ? 'neg' : '') : ''}
      ${can('ptw') ? yStat('Permits', ptwP.length, '', `${ptw.filter(p => p.status === 'active').length} work in progress`) : ''}
    </div>${waiting.length ? `<div class="alert" style="margin:10px 0 0" data-yact="tab" data-yarg="ptw"><span>⏳</span><span><b>${waiting.length}</b> permit${waiting.length > 1 ? 's wait' : ' waits'} for your approval. Open Permit to work.</span></div>` : ''}</div>`;
  // Monthly trend (count of records), last 12 months or the chosen period.
  const months = []; { const d = new Date(); d.setDate(1); const n = Y.f.period === '30' ? 3 : Y.f.period === '180' ? 6 : 12; for (let i = n - 1; i >= 0; i--) { const x = new Date(d.getFullYear(), d.getMonth() - i, 1); months.push(`${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`); } }
  const per = (list, key) => months.map(m => list.filter(r => String(r[key] || '').slice(0, 7) === m).length);
  const series = [can('inc') && {name: 'Incidents', slot: 1, vals: per(inc, 'incident_time')}, can('obs') && {name: 'Observations', slot: 0, vals: per(obs, 'reported_at')}, can('ptw') && {name: 'Permits', slot: 2, vals: per(ptw, 'requested_at')}].filter(Boolean);
  h += `<div class="card"><h2>Month by month ${conMore('records')}</h2>${tLine('yDashT', months.map(yMon), series, {h: 170, label: 'Safety records per month'})}${tLegend(series.map(s => [tCol(s.slot), s.name, s.vals.reduce((t, v) => t + v, 0)]))}
    <div class="note-src">Records per month by the date of the incident, observation or permit request. Touch the chart for a month.</div></div>`;
  if (can('inc')) {
    const types = {}; incP.forEach(r => { types[r.type] = (types[r.type] || 0) + 1; });
    const sev = {}; incP.forEach(r => { sev[r.severity || 'Not set'] = (sev[r.severity || 'Not set'] || 0) + 1; });
    const sevCol = {Critical: 'var(--forced)', Major: 'var(--coal)', Moderate: 'var(--planned)', Minor: 'var(--run)', 'Not set': 'var(--off)'};
    h += `<div class="card"><h2>Incidents by type</h2>${yCountBars(Object.entries(types).sort((a, b) => b[1] - a[1]).map(([k, n]) => [k, n]), 'var(--forced)')}</div>
      <div class="card"><h2>Incidents by severity</h2>${yCountBars(['Critical', 'Major', 'Moderate', 'Minor', 'Not set'].filter(k => sev[k]).map(k => [k, sev[k], sevCol[k]]))}
      <div class="note-src">Days lost in the period: <b>${fmt(incP.reduce((t, r) => t + (r.days_lost || 0), 0))}</b>.</div></div>`;
  }
  if (can('obs')) {
    const cat = {}; obsP.forEach(r => { cat[r.category || '—'] = (cat[r.category || '—'] || 0) + 1; });
    const kind = {}; obsP.forEach(r => { kind[r.obs_type || '—'] = (kind[r.obs_type || '—'] || 0) + 1; });
    h += `<div class="card"><h2>Observations by category</h2>${yCountBars(Object.entries(cat).sort((a, b) => b[1] - a[1]), 'var(--s1)')}
      <div class="note-src">${Object.entries(kind).map(([k, n]) => `${esc(k)}: <b>${n}</b>`).join(' · ')} · closed ${obsP.filter(r => r.status === 'completed').length} of ${obsP.length}</div></div>`;
  }
  if (can('ptw')) {
    const pt = {}; ptwP.forEach(r => { pt[r.permit_type] = (pt[r.permit_type] || 0) + 1; });
    h += `<div class="card"><h2>Permits by type</h2>${yCountBars(Object.entries(pt).sort((a, b) => b[1] - a[1]), 'var(--s3)')}</div>`;
  }
  // Station-wise, as the portal's plant table.
  if (!st && stations.length > 1) {
    h += `<div class="card"><h2>Station-wise ${conMore('touch a station')}</h2><div style="overflow-x:auto"><table class="dt num"><tr><th>Station</th>${can('inc') ? '<th>Incidents</th>' : ''}${can('obs') ? '<th>Obs.</th><th>Open</th>' : ''}${can('ptw') ? '<th>Permits</th>' : ''}</tr>
      ${stations.map(s => `<tr data-yact="dstation" data-yarg="${esc(s)}"><td>${esc(s)}</td>${can('inc') ? `<td>${incP.filter(r => r.station === s).length}</td>` : ''}${can('obs') ? `<td>${obsP.filter(r => r.station === s).length}</td><td>${obs.filter(r => r.station === s && r.status !== 'completed').length}</td>` : ''}${can('ptw') ? `<td>${ptwP.filter(r => r.station === s).length}</td>` : ''}</tr>`).join('')}</table></div></div>`;
  }
  // Needs attention: overdue reports, observations past target, recent incidents.
  const att = [...late.map(r => ({k: 'inc', r, t: `${r.type} at ${r.station}`, s: `${yLate(r.flash_due_at, r.flash_sent_at) ? 'Flash' : 'Detailed'} report overdue · ${yWhen(r.incident_time)}`, c: 'var(--forced)'})),
    ...obsLate.map(r => ({k: 'obs', r, t: `${r.obs_type} · ${r.category} at ${r.station}`, s: `Target ${conDate(r.target_date)} passed${r.assigned_name ? ' · with ' + r.assigned_name : ''}`, c: 'var(--planned)'}))];
  if (att.length) h += `<div class="card"><h2>Needs attention (${att.length})</h2>${att.slice(0, 10).map(a => `<div class="nrow" data-yact="open" data-yarg="${a.k}|${a.r.id}" style="cursor:pointer"><span class="sd" style="background:${a.c}"></span><div class="nb"><b>${esc(a.t)}</b><div class="nt">${esc(a.s)}</div></div></div>`).join('')}</div>`;
  if (can('inc') && inc.length) h += `<div class="card"><h2>Recent incidents</h2>${[...inc].sort((a, b) => String(b.incident_time).localeCompare(String(a.incident_time))).slice(0, 5).map(r => `<div class="nrow" data-yact="open" data-yarg="inc|${r.id}" style="cursor:pointer"><span class="sd" style="background:${/Fatality|Lost Time|Dangerous|Electrical/.test(r.type) ? 'var(--forced)' : 'var(--planned)'}"></span><div class="nb"><b>${esc(r.type)} · ${esc(r.station)}</b><div class="nt">${esc(String(r.description || '').slice(0, 90))}</div></div><span class="tm2">${conDate(String(r.incident_time).slice(0, 10))}</span></div>`).join('')}</div>`;
  return h;
}

// ---------------------------------------------------------------- detail pages

const yFind = (kind, id) => (kind === 'obs' ? Y.data.observations : kind === 'inc' ? Y.data.incidents : Y.data.permits).find(r => String(r.id) === String(id));
const yBack = label => `<div class="chips"><button class="chip" data-yact="back">‹ ${esc(label)}</button></div>`;
/** An inline form for one action: fields [{k, label, type, value, options}] and a confirm button. */
function yActForm(title, fields, act, colour) {
  return `<div class="card" style="border:2px solid ${colour || 'var(--accent)'}"><h2>${esc(title)}</h2>${fields.map(f => `<label style="display:block;font-size:12px;color:var(--muted);margin-top:8px">${esc(f.label)}${
    f.type === 'area' ? `<textarea class="search" id="ya_${f.k}" rows="3" style="margin:4px 0 0">${esc(f.value || '')}</textarea>`
    : f.type === 'emp' ? yEmpInput('ya_' + f.k, f.station)
    : `<input class="search" id="ya_${f.k}" type="${f.type || 'text'}" value="${esc(f.value || '')}" style="margin:4px 0 0">`}</label>`).join('')}
    <div style="margin-top:10px">${yBtn(Y.saving ? 'Saving…' : title, 'do', act, true, colour)} ${yBtn('Cancel', 'actcancel')}</div></div>`;
}
/** Employee number box with the station's people offered as suggestions (from the directory on the phone). */
function yEmpInput(id, station) {
  const people = (C.dir?.employees || []).filter(e => !station || String(e.station_short || '').toUpperCase() === String(station).toUpperCase());
  return `<input class="search" id="${id}" list="${id}_l" placeholder="Employee number or name" autocomplete="off" style="margin:4px 0 0">
    <datalist id="${id}_l">${people.slice(0, 400).map(e => `<option value="${esc(e.emp_no)} — ${esc(conName(e.full_name))}${e.designation ? ', ' + esc(e.designation) : ''}"></option>`).join('')}</datalist>`;
}

function yDetailObs(r) {
  const editor = yCan('obs', 'edit'), assignee = yMine(r, 'assigned_to'), open = r.status !== 'completed';
  let h = `<div class="card"><div style="display:flex;align-items:center;gap:8px"><div style="font-size:17px;font-weight:700;flex:1">${esc(r.obs_type)} · ${esc(r.category)}</div>${yBadge(r.status)}</div>
    <div class="muted" style="font-size:12.5px">${esc(r.obs_no)} · reported by ${esc(r.reported_by_name || '—')} on ${yWhen(r.reported_at)}</div>
    <p style="white-space:pre-wrap;margin:12px 0 0">${esc(r.description)}</p>${yFiles(r.attachments, 'obs', r.id, r.status !== 'completed' && (yCan('obs', 'edit') || yMine(r, 'reported_by') || yMine(r, 'assigned_to')))}
    <div class="oq" style="box-shadow:none;padding:0;margin:12px 0 0;border:0"><div class="meta num">
      ${yRow('Station', esc(yStationName(r.station)))}${yRow('Location', esc(r.location))}${yRow('Priority', `<b style="color:${Y_PRIORITY[r.priority] || 'inherit'}">${esc(r.priority)}</b>`)}
      ${yRow('Target date', r.target_date ? conDate(r.target_date) : '')}${yRow('Assigned to', esc(r.assigned_name || ''))}${yRow('Assigned on', r.assigned_at ? yWhen(r.assigned_at) : '')}
      ${yRow('Closed by', r.closed_by ? esc(r.closed_by) + ' · ' + yWhen(r.closed_at) : '')}</div></div>${yLong('Action taken', r.action_taken)}</div>`;
  if (Y.act === 'assign') h += yActForm('Assign', [{k: 'assigned_to', label: 'Assign to (employee number)', type: 'emp', station: r.station}, {k: 'target_date', label: 'Target date', type: 'date', value: r.target_date || ''}], 'obs_assign');
  else if (Y.act === 'complete') h += yActForm('Close the observation', [{k: 'action_taken', label: 'Action taken', type: 'area'}], 'obs_complete', 'var(--run)');
  else h += `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">${[
    open && editor ? yBtn(r.assigned_to ? 'Re-assign' : 'Assign', 'act', 'assign', true) : '',
    open && (editor || assignee) ? yBtn('Close with action taken', 'act', 'complete', true, 'var(--run)') : '',
    !open && editor ? yBtn('Reopen', 'do', 'obs_reopen') : '',
    open && (editor || yMine(r, 'reported_by')) ? yBtn('Edit', 'edit', 'obs|' + r.id) : ''].join('')}</div>`;
  return h;
}

function yDetailInc(r) {
  const editor = yCan('inc', 'edit'), open = r.status !== 'closed', sla = (Y.data.sla || {})[r.sla_category];
  const due = (label, at, sent, act) => !at ? '' : `<div class="srow" style="cursor:default"><div class="top"><span class="nm">${label}</span><span class="vals num">${sent ? `<span class="badge b-Running">Sent ${yWhen(sent)}</span>` : yLate(at, sent) ? '<span class="badge b-Forced">Overdue</span>' : '<span class="badge b-Planned">Due</span>'}</span></div>
    <div class="vals">Due by ${yWhen(at)}${!sent && editor ? ` · <a data-yact="do" data-yarg="${act}" style="color:var(--accent)">Mark as sent</a>` : ''}</div></div>`;
  let h = `<div class="card"><div style="display:flex;align-items:center;gap:8px"><div style="font-size:17px;font-weight:700;flex:1">${esc(r.type)}</div>${yBadge(r.status)}</div>
    <div class="muted" style="font-size:12.5px">${esc(r.incident_no)} · reported by ${esc(r.reported_by_name || '—')} on ${yWhen(r.reported_at)}</div>
    <p style="white-space:pre-wrap;margin:12px 0 0">${esc(r.description)}</p>${yFiles(r.attachments, 'inc', r.id, r.status !== 'closed' && (yCan('inc', 'edit') || yMine(r, 'reported_by') || yMine(r, 'investigator')))}
    <div class="oq" style="box-shadow:none;padding:0;margin:12px 0 0;border:0"><div class="meta num">
      ${yRow('When', yWhen(r.incident_time))}${yRow('Station', esc(yStationName(r.station)))}${yRow('Location', esc(r.location))}${yRow('Severity', esc(r.severity || ''))}
      ${yRow('Injured person', esc([r.injured_person_name, r.injured_person_dept].filter(Boolean).join(', ')))}${yRow('Days lost', r.days_lost ? fmt(r.days_lost) : '')}
      ${yRow('Investigator', esc(r.investigator_name || ''))}${yRow('Closed on', r.closed_at ? yWhen(r.closed_at) : '')}</div></div>
      ${yLong('Immediate action', r.immediate_action)}${yLong('Root cause', r.root_cause)}${yLong('Corrective and preventive actions', r.corrective_actions)}</div>`;
  if (sla) h += `<div class="card"><h2>Reporting deadlines</h2><div class="note-src" style="margin:0 0 6px">${esc(sla.label)} — to ${esc(sla.officers)}</div>
    ${due('Flash report', r.flash_due_at, r.flash_sent_at, 'inc_flash')}${due('Detailed report', r.detailed_due_at, r.detailed_sent_at, 'inc_detailed')}</div>`;
  if (Y.act === 'investigate') h += yActForm('Assign investigator', [{k: 'investigator', label: 'Investigator (employee number)', type: 'emp', station: ''}], 'inc_investigate');
  else if (Y.act === 'close') h += yActForm('Close the incident', [{k: 'root_cause', label: 'Root cause', type: 'area', value: r.root_cause}, {k: 'corrective_actions', label: 'Corrective and preventive actions', type: 'area', value: r.corrective_actions}], 'inc_close', 'var(--run)');
  else h += `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">${[
    open && editor ? yBtn(r.investigator ? 'Change investigator' : 'Assign investigator', 'act', 'investigate', true) : '',
    open && editor ? yBtn('Close with root cause', 'act', 'close', true, 'var(--run)') : '',
    !open && editor ? yBtn('Reopen', 'do', 'inc_reopen') : '',
    open && (editor || yMine(r, 'reported_by')) ? yBtn('Edit', 'edit', 'inc|' + r.id) : ''].join('')}</div>`;
  return h;
}

function yDetailPtw(p) {
  const stages = Y.data.stages || [], stage = p.stage || 1, me = yMine(p, 'requested_by'), de = yStageOk(p, 1);
  const hist = p.history || [], done = n => p.status !== 'rejected' && (stage > n || ['approved', 'active', 'closed'].includes(p.status));
  const stepper = `<div class="card"><h2>Approval chain</h2>${stages.map(s => {
    const ok = done(s.stage), cur = p.status === 'requested' && stage === s.stage, rej = p.status === 'rejected' && stage === s.stage;
    const e = [...hist].reverse().find(x => x.stage === s.label);
    return `<div class="nrow"><span class="sd" style="background:${ok ? 'var(--run)' : rej ? 'var(--forced)' : cur ? 'var(--planned)' : 'var(--line)'}"></span><div class="nb"><b>${s.stage}. ${esc(s.label)}</b>
      <div class="nt">${ok && e ? `Approved by ${esc(e.by)} · ${conDate(e.at, true)}${e.remarks ? ' — ' + esc(e.remarks) : ''}` : rej && e ? `Rejected by ${esc(e.by)} — ${esc(e.remarks || '')}` : cur ? 'Waiting' : 'Pending'}</div></div></div>`;
  }).join('')}<div class="note-src">${hist.map(x => `${conDate(x.at, true)} · ${esc(x.action)} · ${esc(x.by || '')}${x.remarks ? ' — ' + esc(x.remarks) : ''}`).join('<br>')}</div></div>`;
  let h = `<div class="card"><div style="display:flex;align-items:center;gap:8px"><div style="font-size:17px;font-weight:700;flex:1">${esc(p.permit_type)} permit</div>${yBadge(p.status)}</div>
    <div class="muted" style="font-size:12.5px">${esc(p.permit_no)} · requested by ${esc(p.requested_by_name || '—')} on ${yWhen(p.requested_at)}</div>
    <p style="white-space:pre-wrap;margin:12px 0 0">${esc(p.description)}</p>${yFiles(p.attachments, 'ptw', p.id, !['closed', 'cancelled'].includes(p.status) && (me || de))}
    <div class="oq" style="box-shadow:none;padding:0;margin:12px 0 0;border:0"><div class="meta num">
      ${yRow('Station', esc(yStationName(p.station)))}${yRow('Work location', esc(p.work_location))}${yRow('From', yWhen(p.start_time))}${yRow('To', yWhen(p.end_time))}
      ${yRow('Workers', p.workers_involved ? fmt(p.workers_involved) : '')}${yRow('Isolation', p.isolation_required ? 'Required · LOTO ' + esc(p.loto_number || '—') : 'Not required')}
      ${yRow('Toolbox talk', p.toolbox_talk_done ? 'Done' : 'Not yet')}${yRow('PPE', esc([...(p.ppe_required || []), p.ppe_other].filter(Boolean).join(', ')))}
      ${yRow('Closed by', p.closed_by ? esc(p.closed_by) + ' · ' + yWhen(p.closed_at) : '')}</div></div>
      ${yLong('Job safety analysis', p.jsa_details)}${yLong('Checklist verified', p.risk_checklist)}${yLong('Extensions', p.extension_reason)}</div>` + stepper;
  const label = (stages[stage - 1] || {}).label;
  if (Y.act === 'approve') h += yActForm('Approve as ' + label, [{k: 'remarks', label: 'Remarks (optional)', type: 'area'}], 'ptw_approve', 'var(--run)');
  else if (Y.act === 'reject') h += yActForm('Reject', [{k: 'remarks', label: 'Reason for rejecting', type: 'area'}], 'ptw_reject', 'var(--forced)');
  else if (Y.act === 'extend') h += yActForm('Extend the permit', [{k: 'end_time', label: 'New end', type: 'datetime-local', value: String(p.end_time || '').replace(' ', 'T')}, {k: 'remarks', label: 'Reason', type: 'area'}], 'ptw_extend');
  else if (Y.act === 'closep') h += yActForm('Close the permit', [{k: 'remarks', label: 'Work completed, area cleared (remarks)', type: 'area'}], 'ptw_close', 'var(--run)');
  else h += `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">${[
    p.status === 'requested' && yStageOk(p, stage) ? yBtn('Approve', 'act', 'approve', true, 'var(--run)') + yBtn('Reject', 'act', 'reject') : '',
    p.status === 'approved' && (me || de) ? yBtn('Start work', 'do', 'ptw_activate', true) : '',
    ['approved', 'active'].includes(p.status) && (me || de) ? yBtn('Close permit', 'act', 'closep', true, 'var(--run)') : '',
    ['approved', 'active'].includes(p.status) && (de || yStageOk(p, 2)) ? yBtn('Extend', 'act', 'extend') : '',
    me && (p.status === 'rejected' || (p.status === 'requested' && stage === 1)) ? yBtn(p.status === 'rejected' ? 'Correct and resubmit' : 'Edit', 'edit', 'ptw|' + p.id) : '',
    me && ['requested', 'rejected'].includes(p.status) ? yBtn('Withdraw', 'do', 'ptw_cancel') : ''].join('')}</div>`;
  return h;
}

// ---------------------------------------------------------------- forms

function yFields(kind, r) {
  const m = Y.data.masters, st = yAll(kind) ? [{k: 'station', label: 'Station', type: 'select', options: [['', 'Choose…']].concat(Y.data.stations.map(s => [s.short_name, s.short_name + ' – ' + s.name])), value: r.station || (yMe().station !== 'CO' ? yMe().station : '')}] : [];
  if (kind === 'obs') return [{k: 'obs_type', label: 'Type', type: 'select', options: m.obs_type, value: r.obs_type || 'Unsafe Condition'},
    {k: 'category', label: 'Category', type: 'select', options: [''].concat(m.obs_category), value: r.category || ''}, ...st,
    {k: 'location', label: 'Location (area, unit, equipment)', value: r.location}, {k: 'description', label: 'What did you observe?', type: 'area', rows: 5, value: r.description},
    {k: 'priority', label: 'Priority', type: 'select', options: m.priority, value: r.priority || 'medium'}, {k: 'target_date', label: 'Target date for correction (optional)', type: 'date', value: r.target_date || ''},
    {k: 'files', label: 'Photos and documents (up to 10)', type: 'files'}];
  if (kind === 'inc') return [{k: 'type', label: 'Type of incident', type: 'select', options: [''].concat(m.incident_type), value: r.type || ''},
    {k: 'severity', label: 'Severity', type: 'select', options: [''].concat(m.severity), value: r.severity || ''}, ...st,
    {k: 'incident_time', label: 'Date and time of the incident', type: 'datetime-local', value: r.incident_time ? r.incident_time.replace(' ', 'T') : yNow()},
    {k: 'location', label: 'Location', value: r.location}, {k: 'description', label: 'What happened?', type: 'area', rows: 5, value: r.description},
    {k: 'injured_person_name', label: 'Injured person (if any)', value: r.injured_person_name}, {k: 'injured_person_dept', label: 'Department / contractor of the injured person', value: r.injured_person_dept},
    {k: 'days_lost', label: 'Days lost', type: 'number', value: r.days_lost ?? 0}, {k: 'immediate_action', label: 'Immediate action taken', type: 'area', rows: 3, value: r.immediate_action},
    {k: 'files', label: 'Photos and documents (up to 10)', type: 'files'}];
  const plus = (h, n) => { const d = new Date(Date.now() + h * 36e5), p = x => String(x).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:00`; };
  return [{k: 'permit_type', label: 'Type of permit', type: 'select', options: [''].concat(m.permit_type), value: r.permit_type || ''}, ...st,
    {k: 'work_location', label: 'Work location (area, unit, equipment)', value: r.work_location}, {k: 'description', label: 'Work to be done', type: 'area', rows: 4, value: r.description},
    {k: 'start_time', label: 'From', type: 'datetime-local', value: r.start_time ? r.start_time.replace(' ', 'T') : plus(1)}, {k: 'end_time', label: 'To', type: 'datetime-local', value: r.end_time ? r.end_time.replace(' ', 'T') : plus(9)},
    {k: 'workers_involved', label: 'Number of workers', type: 'number', value: r.workers_involved || 1},
    {k: 'isolation_required', label: 'Electrical / mechanical isolation required', type: 'check', value: !!r.isolation_required}, {k: 'loto_number', label: 'LOTO number (if isolated)', value: r.loto_number},
    {k: 'jsa_details', label: 'Job safety analysis: hazards, risks and controls', type: 'area', rows: 4, value: r.jsa_details},
    {k: 'risk_checklist', label: 'Checklist verified before work', type: 'area', rows: 3, value: r.risk_checklist},
    {k: 'toolbox_talk_done', label: 'Toolbox talk done', type: 'check', value: !!r.toolbox_talk_done},
    {k: 'ppe_required', label: 'PPE required', type: 'chips', options: m.ppe, value: r.ppe_required || []}, {k: 'ppe_other', label: 'Other PPE', value: r.ppe_other},
    {k: 'files', label: 'Documents: signed toolbox talk sheet, JSA, photos (up to 10)', type: 'files'}];
}

function yFormHtml() {
  const f = Y.form, title = {obs: 'Report a safety observation', inc: 'Report an incident', ptw: 'Request a permit to work'}[f.kind];
  const inp = x => {
    const id = 'yf_' + x.k, v = x.value === null || x.value === undefined ? '' : x.value;
    if (x.type === 'check') return `<div class="tg" style="border-top:0;padding:8px 0 0"><div><b>${esc(x.label)}</b></div><button class="sw-t ${v ? 'on' : ''}" id="${id}" data-yact="toggle" aria-label="${esc(x.label)}"></button></div>`;
    let box;
    if (x.type === 'select') box = `<select class="search" id="${id}" style="margin:4px 0 0">${x.options.map(o => { const [val, lab] = Array.isArray(o) ? o : [o, o || 'Choose…']; return `<option value="${esc(val)}" ${String(val) === String(v) ? 'selected' : ''}>${esc(lab)}</option>`; }).join('')}</select>`;
    else if (x.type === 'area') box = `<textarea class="search" id="${id}" rows="${x.rows || 3}" style="margin:4px 0 0">${esc(v)}</textarea>`;
    else if (x.type === 'files') box = yPickerHtml();
    else if (x.type === 'chips') box = `<div id="${id}" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px">${x.options.map(o => `<button class="chip ${v.includes(o) ? 'on' : ''}" data-yact="pick" data-yarg="${esc(o)}" style="padding:4px 10px;font-size:12px">${esc(o)}</button>`).join('')}</div>`;
    else box = `<input class="search" id="${id}" type="${x.type || 'text'}" ${x.type === 'number' ? 'inputmode="numeric" min="0"' : ''} value="${esc(v)}" style="margin:4px 0 0">`;
    return `<label style="display:block;font-size:12px;color:var(--muted);margin-top:10px">${esc(x.label)}${box}</label>`;
  };
  const sla = f.kind === 'inc' ? '<div class="note-src" id="ySla" style="margin-top:8px"></div>' : '';
  return yBack('Back') + `<div class="card"><h2>${esc(f.id ? title.replace(/^(Report|Request) an?/, 'Edit the') : title)}</h2>${yMsg()}${f.fields.map(inp).join('')}${sla}
    <div style="margin-top:12px">${yBtn(Y.saving ? 'Sending…' : f.kind === 'ptw' ? (f.id ? 'Send again for approval' : 'Send for approval') : f.id ? 'Save' : 'Submit', 'save', '', true, f.kind === 'inc' ? 'var(--forced)' : '')} ${yBtn('Cancel', 'back')}</div></div>`;
}

/** Reporting deadlines shown while an incident type is chosen. */
function ySlaHint() {
  const el = $('ySla'), t = $('yf_type');
  if (!el || !t) return;
  const map = {Fatality: 'major_accident', 'Electrical Accident': 'major_accident', 'Dangerous Occurrence': 'dangerous_occurrence', 'Fire Incident': 'major_incident', 'Near Miss': 'near_miss'};
  const s = (Y.data.sla || {})[map[t.value]];
  el.innerHTML = s ? `<b>${esc(s.label)}</b>: ${s.flash_hours ? `flash report within ${s.flash_hours} h, ` : ''}detailed report within ${s.detailed_hours} h, to ${esc(s.officers)}.` : '';
}

async function yFormRead() {
  const out = {};
  let files = [];
  for (const x of Y.form.fields) {
    const el = $('yf_' + x.k);
    if (x.type === 'files') { files = await yReadFiles(Y.picked || []); continue; }
    if (!el) continue;
    if (x.type === 'check') out[x.k] = el.classList.contains('on');
    else if (x.type === 'chips') out[x.k] = [...el.querySelectorAll('.chip.on')].map(b => b.dataset.yarg);
    else if (x.type === 'datetime-local') out[x.k] = el.value ? el.value.replace('T', ' ').slice(0, 16) : '';
    else out[x.k] = el.value.trim();
  }
  return {fields: out, files};
}

async function ySave() {
  if (Y.saving) return;
  let v;
  try { v = await yFormRead(); } catch (e) { Y.error = e.message; return yRender(); }
  const f = Y.form;
  f.fields.forEach(x => { if (x.type !== 'files' && v.fields[x.k] !== undefined) x.value = x.type === 'datetime-local' ? v.fields[x.k].replace(' ', 'T') : v.fields[x.k]; });   // kept if the save fails
  Y.saving = true; Y.error = ''; yRender();
  const r = await conCall({obs: 'safety_save_obs', inc: 'safety_save_inc', ptw: 'safety_save_ptw'}[f.kind], {id: f.id || 0, fields: v.fields, files: v.files});
  Y.saving = false;
  if (!r.ok) { Y.error = r.error; yRender(); return window.scrollTo({top: 0}); }
  Y.form = null; Y.picked = []; Y.detail = f.id ? {kind: f.kind, id: f.id} : null; Y.note = r.data.message || 'Saved';
  await yLoad(true);
  window.scrollTo({top: 0});
}

/** More photos or documents for the open record. */
async function yAddFiles(fileList) {
  let files;
  try { files = await yReadFiles(fileList); } catch (e) { Y.error = e.message; return yRender(); }
  Y.saving = true; Y.error = ''; Y.note = 'Sending ' + files.length + ' file' + (files.length > 1 ? 's' : '') + '…'; yRender();
  const r = await conCall('safety_add_files', {kind: Y.detail.kind, id: +Y.detail.id, files});
  Y.saving = false;
  if (!r.ok) { Y.note = ''; Y.error = r.error; return yRender(); }
  Y.note = r.data.message || 'Attached';
  await yLoad(true);
}

async function yDo(act) {
  const d = Y.detail, val = k => ($('ya_' + k) ? $('ya_' + k).value.trim() : '');
  const empNo = k => (val(k).match(/^[A-Za-z0-9\-\/]+/) || [''])[0];
  const [kind, what] = act.split('_');
  const params = {id: +d.id, act: what};
  if (act === 'obs_assign') { params.assigned_to = empNo('assigned_to'); params.target_date = val('target_date'); if (!params.assigned_to) return alert('Enter the employee number.'); }
  if (act === 'obs_complete') params.action_taken = val('action_taken');
  if (act === 'inc_investigate') { params.investigator = empNo('investigator'); if (!params.investigator) return alert('Enter the employee number.'); }
  if (act === 'inc_close') { params.root_cause = val('root_cause'); params.corrective_actions = val('corrective_actions'); }
  if (act === 'inc_flash') params.act = 'flash_sent';
  if (act === 'inc_detailed') params.act = 'detailed_sent';
  if (kind === 'ptw') { params.remarks = val('remarks'); if (act === 'ptw_extend') params.end_time = val('end_time').replace('T', ' '); }
  if (act === 'ptw_cancel' && !confirm('Withdraw this permit request?')) return;
  Y.saving = true; Y.error = ''; yRender();
  const r = await conCall({obs: 'safety_obs_action', inc: 'safety_inc_action', ptw: 'safety_ptw_action'}[kind], params);
  Y.saving = false;
  if (!r.ok) { Y.error = r.error; return yRender(); }
  Y.act = ''; Y.note = r.data.message || 'Done';
  await yLoad(true);
  window.scrollTo({top: 0});
}

// ---------------------------------------------------------------- render & interaction

function yRender() {
  const box = $('safetyBody');
  if (!box || !$('v-safety').classList.contains('on')) return;
  const tabs = yTabs();
  let h;
  if (typeof Connect === 'undefined') h = `<div class="card">${conEmpty('The Safety pages are available in the Android app.')}</div>`;
  else if (!tabs.length) h = `<div class="card">${conEmpty('You have not been given access to the safety pages. Access is given by the administrator on the Employees screen.')}</div>`;
  else if (!Y.data) h = Y.error ? yMsg() + `<div style="text-align:center">${yBtn('Try again', 'reload')}</div>` : conSpin();
  else if (Y.form) h = yFormHtml();
  else if (Y.detail) {
    const r = yFind(Y.detail.kind, Y.detail.id);
    h = yBack({obs: 'Observations', inc: 'Incidents', ptw: 'Permits'}[Y.detail.kind]) + yMsg()
      + (!r ? `<div class="card">${conEmpty('This record is no longer available.')}</div>` : Y.detail.kind === 'obs' ? yDetailObs(r) : Y.detail.kind === 'inc' ? yDetailInc(r) : yDetailPtw(r));
  } else {
    if (!tabs.some(t => t[0] === Y.tab)) Y.tab = tabs[0][0];
    h = `<div class="chips">${tabs.map(([k, l]) => `<button class="chip ${Y.tab === k ? 'on' : ''}" data-yact="tab" data-yarg="${k}">${l}</button>`).join('')}</div>`
      + `<div class="note-src" style="text-align:center;margin:0 0 8px">${Y.busy ? 'Reading the Google Sheet…' : `Read from the Google Sheet ${typeof wAgo === 'function' ? wAgo(Y.stamp) : ''}`} · <a data-yact="reload">Refresh</a></div>`
      + yMsg() + (Y.tab === 'dash' ? yTabDash() : Y.tab === 'obs' ? yTabObs() : Y.tab === 'inc' ? yTabInc() : yTabPtw());
  }
  box.innerHTML = h + '<div class="credit">Developed by <b>A D Bhatt</b>, EE, GSECL</div>';
  ySlaHint();
}

function yGo(detail) { Y.detail = detail; Y.form = null; Y.act = ''; Y.error = ''; yRender(); window.scrollTo({top: 0}); }

document.addEventListener('click', e => {
  const el = e.target.closest('[data-yact]');
  if (!el || typeof Connect === 'undefined') return;
  const arg = el.dataset.yarg || '';
  switch (el.dataset.yact) {
    case 'tab': Y.tab = arg; Y.note = ''; Y.error = ''; yRender(); return window.scrollTo({top: 0});
    case 'reload': return yLoad(true);
    case 'period': Y.f.period = arg; return yRender();
    case 'papply': {
      const a = $('yFrom').value, b = $('yTo').value;
      if (!a || !b || a > b) return alert('Choose a start date before the end date.');
      Y.f.from = a; Y.f.to = b; return yRender();
    }
    case 'dstation': Y.f.station = arg; yRender(); return window.scrollTo({top: 0});
    case 'filter': { const [k, v] = arg.split('|'); Y.f[k] = v; return yRender(); }
    case 'open': { const [kind, id] = arg.split('|'); Y.note = ''; return yGo({kind, id}); }
    case 'back': if (Y.form) { const was = Y.form; Y.form = null; Y.error = ''; Y.detail = was.id ? {kind: was.kind, id: was.id} : null; yRender(); return window.scrollTo({top: 0}); } return yGo(null);
    case 'new': if (!C.dir) conLoadDirectory(false); Y.picked = []; Y.form = {kind: arg, id: 0, fields: yFields(arg, {})}; Y.note = ''; Y.error = ''; yRender(); return window.scrollTo({top: 0});
    case 'edit': { const [kind, id] = arg.split('|'); Y.picked = []; Y.form = {kind, id: +id, fields: yFields(kind, yFind(kind, id))}; Y.note = ''; Y.error = ''; yRender(); return window.scrollTo({top: 0}); }
    case 'toggle': return el.classList.toggle('on');
    case 'pick': e.preventDefault(); return el.classList.toggle('on');
    case 'save': return ySave();
    case 'act': if (!C.dir && (arg === 'assign' || arg === 'investigate')) conLoadDirectory(false).then(yRender); Y.act = arg; Y.note = ''; Y.error = ''; return yRender();
    case 'actcancel': Y.act = ''; return yRender();
    case 'do': return yDo(arg);
    case 'addfiles': return $('yAdd') && $('yAdd').click();
    case 'addcam': return $('yAddCam') && $('yAddCam').click();
    case 'pick_cam': return $('yCam') && $('yCam').click();
    case 'pick_files': return $('yPick') && $('yPick').click();
    case 'unpick': Y.picked.splice(+arg, 1); if ($('yPicked')) $('yPicked').innerHTML = yPickedList(); return;
    case 'file': {
      const f = (yFind(Y.detail.kind, Y.detail.id)?.attachments || []).find(x => x.id === arg);
      Y.note = 'Opening ' + (f?.name || 'the file') + '…'; yRender();
      return conAsk(k => Connect.openFile(k, arg)).then(r => { Y.note = ''; if (!r.ok) Y.error = r.error || 'Could not open the file'; yRender(); });
    }
  }
});
document.addEventListener('change', e => {
  if (e.target.dataset?.ysel === 'station') { Y.f.station = e.target.value; return yRender(); }
  if (e.target.id === 'yf_type') ySlaHint();
  if ((e.target.id === 'yCam' || e.target.id === 'yPick') && e.target.files.length) {
    Y.picked = (Y.picked || []).concat([...e.target.files]);
    if (Y.picked.length > Y_MAX_FILES) { alert('At most ' + Y_MAX_FILES + ' files; the first ' + Y_MAX_FILES + ' are kept.'); Y.picked = Y.picked.slice(0, Y_MAX_FILES); }
    e.target.value = '';
    if ($('yPicked')) $('yPicked').innerHTML = yPickedList();
  }
  if ((e.target.id === 'yAdd' || e.target.id === 'yAddCam') && e.target.files.length) yAddFiles(e.target.files);
});

/** Called by show('safety'). */
function ySafetyShow() {
  yRender();
  if (yTabs().length) yLoad(false);
}

/** Android back button: an action form, then a form or record, then the first tab. */
const yPrevBack = window.appBack;
window.appBack = () => {
  if ($('v-safety') && $('v-safety').classList.contains('on')) {
    if (Y.act) { Y.act = ''; yRender(); return true; }
    if (Y.form || Y.detail) { document.querySelector('[data-yact="back"]')?.click(); return true; }
    const first = (yTabs()[0] || [''])[0];
    if (Y.tab && Y.tab !== first) { Y.tab = first; yRender(); return true; }
  }
  return yPrevBack ? yPrevBack() : false;
};
