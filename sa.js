// Super administrator console (Connect › Super admin): everything of the Google Sheet menu that can be done away
// from the Sheet, each task on its own page with its own form, plus the service health, the AppSettings values and
// the recent runs. The forms are described by the service (sa_tasks), so a new task needs only the service script.
// Long tasks run in the background on the service; this page asks for the result every few seconds.
// Uses conCall / conBatch / conRender / conIc / conPageHead / conEmpty / conErr / conSpin from connect.js and
// W_PAGES / wCan / wToolRow from work.js; $, esc, fmt from index.html.

const SA = {view: 'home', cur: '', tasks: null, groups: [], status: null, settings: null, log: [], job: null,
  args: {}, busy: false, loading: false, error: '', result: null, resultOk: true, poll: null, at: 0};
const SA_GROUP_IC = {people: ['idcard', '#2563eb'], checks: ['shield', '#16a34a'], release: ['send', '#d97706'], ai: ['spark', '#7c3aed'], data: ['report', '#0891b2']};
const SA_ADMIN_PAGES = ['admin', 'devreq', 'activity', 'pubcirc', 'pubnews', 'pubnote', 'mgmtrep'];

const saIsSuper = () => { try { return JSON.parse(Native.account() || '{}').role === 'superadmin'; } catch (e) { return false; } };
/** A console page other than its home (Connect then leaves the heading to it). */
const saInner = () => SA.view !== 'home';
const saTask = id => (SA.tasks || []).find(t => t.id === id);
const saWhen = ms => { if (!ms) return ''; const d = new Date(ms); return d.toLocaleDateString('en-IN', {day: '2-digit', month: 'short'}) + ' ' + d.toLocaleTimeString('en-IN', {hour: '2-digit', minute: '2-digit'}); };
const saBtn = (label, act, arg = '', primary = false, disabled = false) => `<button class="btn" data-sact="${act}" data-sarg="${esc(arg)}" ${disabled ? 'disabled' : ''} style="${primary ? 'background:var(--accent);color:#fff;border-color:var(--accent)' : 'color:var(--accent)'}">${esc(label)}</button>`;
const saHead = (title, sub) => `<div class="pg-h"><button class="pg-back" data-sact="home" aria-label="Back">‹</button><div class="pg-t">${esc(title)}${sub ? `<small>${esc(sub)}</small>` : ''}</div></div>`;

// ---------------------------------------------------------------- loading

/** Opening the console: the task list, the health and the background job, in one request (kept 2 minutes). */
async function saOpen(force = false) {
  SA.view = 'home'; SA.error = '';
  if (!saIsSuper() || SA.loading || (!force && SA.tasks && Date.now() - SA.at < 120000)) return;
  SA.loading = true; conRender();
  const [t, st] = await conBatch([['sa_tasks', {}], ['sa_status', {}]]);
  SA.loading = false;
  if (t.ok) { SA.tasks = t.data.tasks || []; SA.groups = t.data.groups || []; SA.log = t.data.log || []; SA.job = t.data.job; SA.at = Date.now(); }
  else SA.error = /unknown action/i.test(t.error || '') ? 'The console needs the updated service script (deploy the new Code.gs).' : t.error;
  if (st.ok) { SA.status = st.data.items || []; SA.job = st.data.job || SA.job; }
  saPollIfRunning();
  conRender();
}
async function saLoadSettings() {
  SA.busy = true; SA.error = ''; conRender();
  const r = await conCall('sa_settings', {});
  SA.busy = false;
  if (r.ok) SA.settings = r.data.settings || []; else SA.error = r.error;
  conRender();
}
const saRunning = () => SA.job && (SA.job.state === 'queued' || SA.job.state === 'running');
/** While a background task runs, its state is asked for every 4 seconds (only while Connect is on screen). */
function saPollIfRunning() {
  if (!saRunning() || SA.poll) return;
  SA.poll = setInterval(async () => {
    if (!$('v-connect') || !$('v-connect').classList.contains('on')) return;
    const r = await conCall('sa_job', {});
    if (!r.ok) return;
    SA.job = r.data.job;
    if (!saRunning()) { clearInterval(SA.poll); SA.poll = null; SA.at = 0; if (C.tab === 'sa') saOpen(true); }
    if (C.tab === 'sa') conRender();
  }, 4000);
}

// ---------------------------------------------------------------- pages

function saRender() {
  if (!saIsSuper()) return `<div class="card">${conEmpty('The console is for super administrators.')}</div>`;
  if (SA.view === 'task') return saTaskPage();
  if (SA.view === 'settings') return saSettingsPage();
  if (SA.view === 'setting') return saSettingPage();
  if (SA.view === 'log') return saLogPage();
  return saHome();
}

function saJobCard() {
  const j = SA.job;
  if (!j) return '';
  const pill = j.state === 'done' ? '<span class="sa-pill ok">Done</span>' : j.state === 'failed' ? '<span class="sa-pill bad">Failed</span>' : `<span class="sa-pill run">${j.state === 'queued' ? 'Starting…' : 'Running…'}</span>`;
  return `<div class="card"><h2>Background task ${pill}</h2><div style="font-weight:650">${esc(j.label)}</div>
    <div class="muted" style="font-size:12px">Started ${esc(saWhen(j.at))}${j.done_at ? ' · finished ' + esc(saWhen(j.done_at)) : ''}</div>
    ${saRunning() ? '<div class="sync-bar" style="margin:10px 0 0"></div>' : ''}
    ${j.text ? `<div class="sa-res">${esc(j.text)}</div><div style="margin-top:8px">${saBtn('Copy', 'copy', 'job')}</div>` : saRunning() ? '<div class="note-src" style="margin-top:6px">You can leave this page; the task goes on and the result waits here.</div>' : ''}</div>`;
}

function saHome() {
  if (!SA.tasks && !SA.loading && !SA.error) { setTimeout(() => saOpen(true), 0); return conSpin(); }
  if (!SA.tasks) return conErr(SA.error) + (SA.loading ? conSpin() : `<div class="card">${conEmpty('Could not load the console.')}${saBtn('Try again', 'reload', '', true)}</div>`);
  const st = SA.status || [], bad = st.filter(x => x.level === 'bad').length, warn = st.filter(x => x.level === 'warn').length;
  let s = conErr(SA.error);
  s += `<div class="card"><h2>Service health <span class="more" data-sact="reload">${SA.loading ? 'Checking…' : 'Check again'}</span></h2>
    <div style="margin:-4px 0 6px"><span class="sa-pill ${bad ? 'bad' : warn ? 'run' : 'ok'}">${bad ? bad + ' need attention' : warn ? warn + ' to look at' : 'All good'}</span></div>
    ${st.map(x => `<div class="sa-st"><i class="${esc(x.level)}"></i><div><b>${esc(x.label)}</b><span>${esc(x.value)}</span></div></div>`).join('') || conEmpty('No status yet.')}</div>`;
  s += saJobCard();
  const admin = typeof W_PAGES !== 'undefined' ? W_PAGES.filter(p => SA_ADMIN_PAGES.includes(p[0]) && wCan(p[3], p[4])) : [];
  if (admin.length) s += `<div class="card"><h2>Day-to-day administration</h2>${admin.map(p => wToolRow(p, 'tool')).join('')}</div>`;
  SA.groups.forEach(g => {
    const list = SA.tasks.filter(t => t.group === g.id);
    if (!list.length) return;
    const [ic, col] = SA_GROUP_IC[g.id] || ['list', 'var(--accent)'];
    s += `<div class="card"><h2>${esc(g.label)}</h2>${list.map(t => `<div class="tl-row" data-sact="task" data-sarg="${esc(t.id)}" style="--qc:${col}">
      <span class="qi">${conIc(ic, 18)}</span><span class="tx"><b>${esc(t.label)}</b>${t.hint ? `<small>${esc(t.hint)}</small>` : ''}</span>${t.bg ? '<span class="tag">Background</span>' : '<span class="go">›</span>'}</div>`).join('')}</div>`;
  });
  s += `<div class="card"><h2>Settings and history</h2>
    <div class="tl-row" data-sact="settings" style="--qc:#475569"><span class="qi">${conIc('gear', 18)}</span><span class="tx"><b>App settings</b><small>FOIS, SLDC, relay phones, report e-mails, holidays, DSM factors and more (AppSettings tab)</small></span><span class="go">›</span></div>
    <div class="tl-row" data-sact="log" style="--qc:#475569"><span class="qi">${conIc('list', 18)}</span><span class="tx"><b>Recent runs</b><small>Who ran which task, when, and the result</small></span><span class="go">›</span></div></div>
    <div class="note-src">Made in the Google Sheet menu only: a new SIMS / PNP shared key (shown once there), editing tabs by hand, and imports that need a tab pasted first. Every run here is recorded in Login activity.</div>`;
  return s;
}

function saField(f) {
  const id = 'saF_' + f.k, v = SA.args[f.k] ?? '', lab = `<label for="${id}">${esc(f.label)}${f.req ? ' *' : ''}</label>`;
  if (f.type === 'select') return lab + `<select class="search" id="${id}" data-sin="${esc(f.k)}"><option value="">Choose…</option>${(f.options || []).map(([val, l]) => `<option value="${esc(val)}" ${val === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  if (f.type === 'secret') return lab + `<input class="search" id="${id}" data-sin="${esc(f.k)}" type="password" autocomplete="new-password" autocapitalize="off" spellcheck="false" value="${esc(v)}" placeholder="Paste here (never shown again)">`;
  if (f.type === 'emp') {
    const e = (C.dir?.employees || []).find(x => x.emp_no === String(v).trim());
    return lab + `<input class="search" id="${id}" data-sin="${esc(f.k)}" inputmode="numeric" autocomplete="off" value="${esc(v)}" placeholder="e.g. 12345" style="margin-bottom:4px">
      <div class="muted" id="${id}_who" style="font-size:12px;margin:0 0 12px">${e ? esc(conName(e.full_name) + ' · ' + [e.designation, e.station_short || e.station].filter(Boolean).join(' · ')) : v ? 'Not in the directory on this phone' : ''}</div>`;
  }
  return lab + `<input class="search" id="${id}" data-sin="${esc(f.k)}" type="${f.type === 'tel' ? 'tel' : 'text'}" autocomplete="off" value="${esc(v)}">`;
}

function saTaskPage() {
  const t = saTask(SA.cur);
  if (!t) { SA.view = 'home'; return saHome(); }
  const g = (SA.groups.find(x => x.id === t.group) || {}).label || '';
  const blocked = t.bg && saRunning();
  return saHead(t.label, g) + conErr(SA.error) + `<div class="card sa-f">
      ${t.hint ? `<div class="muted" style="font-size:13px;margin-bottom:12px">${esc(t.hint)}</div>` : ''}
      ${(t.fields || []).map(saField).join('')}
      <div class="sa-run">${saBtn(SA.busy ? 'Working…' : t.bg ? 'Start in the background' : 'Run now', 'run', t.id, true, SA.busy || blocked)}
        ${t.bg ? '<span class="sa-pill">Runs on the service, up to a few minutes</span>' : ''}</div>
      ${blocked ? `<div class="note-src" style="margin-top:8px">"${esc(SA.job.label)}" is still running; this can start when it is done.</div>` : ''}
      ${SA.result !== null ? `<div class="sa-res" style="${SA.resultOk ? '' : 'border-color:var(--forced)'}">${esc(SA.result)}</div><div style="margin-top:8px">${saBtn('Copy', 'copy', 'result')}</div>` : ''}
    </div>` + (t.bg && SA.job && SA.job.id === t.id ? saJobCard() : '');
}

function saSettingsPage() {
  const head = saHead('App settings', 'AppSettings tab of the Google Sheet');
  if (!SA.settings) return head + conErr(SA.error) + (SA.busy ? conSpin() : '');
  return head + conErr(SA.error) + `<div class="card">${SA.settings.map(x => `<div class="tl-row" data-sact="setting" data-sarg="${esc(x.key)}" style="--qc:${x.secret ? '#b45309' : '#475569'}">
      <span class="qi">${conIc(x.secret ? 'key' : 'gear', 18)}</span><span class="tx"><b>${esc(x.key)}</b><small>${esc(x.secret ? (x.set ? 'Set (hidden)' : 'Not set') : x.value || 'Not set')}</small></span><span class="go">›</span></div>`).join('')}</div>
    <div class="note-src">Passwords are written here but never shown again. Values take effect at once.</div>`;
}

function saSettingPage() {
  const x = (SA.settings || []).find(y => y.key === SA.cur);
  if (!x) { SA.view = 'settings'; return saSettingsPage(); }
  const v = SA.args.value ?? (x.secret ? '' : x.value);
  return `<div class="pg-h"><button class="pg-back" data-sact="settings" aria-label="Back">‹</button><div class="pg-t">${esc(x.key)}<small>App setting</small></div></div>` + conErr(SA.error) + `<div class="card sa-f">
    <div class="muted" style="font-size:13px;margin-bottom:12px">${esc(x.note || '')}</div>
    <label for="saF_value">${x.secret ? 'New value' + (x.set ? ' (one is set now)' : '') : 'Value'}</label>
    ${x.secret ? `<input class="search" id="saF_value" data-sin="value" type="password" autocomplete="new-password" autocapitalize="off" spellcheck="false" value="${esc(v)}">`
      : `<textarea class="search" id="saF_value" data-sin="value" rows="3" autocapitalize="off" spellcheck="false" style="resize:vertical">${esc(v)}</textarea>`}
    <div class="sa-run">${saBtn(SA.busy ? 'Saving…' : 'Save', 'setsave', x.key, true, SA.busy)}${x.set ? saBtn('Clear', 'setclear', x.key) : ''}</div>
    ${SA.result !== null ? `<div class="sa-res">${esc(SA.result)}</div>` : ''}</div>`;
}

function saLogPage() {
  return saHead('Recent runs', 'The last 15 console tasks') + `<div class="card">${SA.log.length ? SA.log.map(l => `<div class="sa-st"><i class="${l.ok ? '' : 'bad'}"></i><div><b>${esc(l.label)}</b>
    <span>${esc(saWhen(l.at))} · ${esc(l.name || l.by)}${l.text ? ' · ' + esc(l.text.slice(0, 160)) : ''}</span></div></div>`).join('') : conEmpty('Nothing run from the app yet.')}</div>`;
}

// ---------------------------------------------------------------- actions

async function saRun(id) {
  const t = saTask(id);
  if (!t || SA.busy) return;
  const miss = (t.fields || []).find(f => f.req && !String(SA.args[f.k] || '').trim());
  if (miss) { SA.error = 'Fill in: ' + miss.label; return conRender(); }
  if (t.confirm && !confirm(t.confirm)) return;
  SA.busy = true; SA.error = ''; SA.result = null; conRender();
  const r = await conCall('sa_run', {id, args: SA.args});
  SA.busy = false;
  (t.fields || []).filter(f => f.type === 'secret').forEach(f => { SA.args[f.k] = ''; });      // a key is not kept on the page
  if (r.ok) { SA.result = r.data.text || 'Done.'; SA.resultOk = true; if (r.data.job) { SA.job = r.data.job; saPollIfRunning(); } SA.at = 0; }
  else { SA.result = r.error; SA.resultOk = false; }
  conRender();
}
async function saSettingSave(key, value) {
  SA.busy = true; SA.error = ''; SA.result = null; conRender();
  const r = await conCall('sa_setting_put', {key, value});
  SA.busy = false;
  if (r.ok) { SA.result = r.data.message; SA.args = {}; await saLoadSettings(); SA.view = 'setting'; } else SA.error = r.error;
  conRender();
}
function saCopy(text) {
  try { if (typeof Connect !== 'undefined' && Connect.copyText) return Connect.copyText(text); } catch (e) { /* the browser below */ }
  try { navigator.clipboard.writeText(text); } catch (e) { /* not available */ }
}

document.addEventListener('click', e => {
  const el = e.target.closest('[data-sact]');
  if (!el) return;
  const arg = el.dataset.sarg || '', go = (view, cur = '') => { SA.view = view; SA.cur = cur; SA.args = {}; SA.result = null; SA.error = ''; conRender(); window.scrollTo({top: 0}); };
  switch (el.dataset.sact) {
    case 'home': return go('home');
    case 'reload': SA.at = 0; return saOpen(true);
    case 'task': return go('task', arg);
    case 'run': return saRun(arg);
    case 'settings': go('settings'); return SA.settings ? null : saLoadSettings();
    case 'setting': return go('setting', arg);
    case 'setsave': return saSettingSave(arg, SA.args.value ?? ((SA.settings || []).find(x => x.key === arg) || {}).value ?? '');
    case 'setclear': if (confirm('Clear ' + arg + '?')) return saSettingSave(arg, '');
      return;
    case 'log': return go('log');
    case 'copy': return saCopy(arg === 'job' ? (SA.job && SA.job.text) || '' : SA.result || '');
  }
});
// Typing keeps the value without redrawing (the keyboard stays up); the employee's name shows under the number.
document.addEventListener('input', e => {
  const k = e.target.dataset?.sin;
  if (!k) return;
  SA.args[k] = e.target.value;
  const who = $(e.target.id + '_who');
  if (who) { const p = (C.dir?.employees || []).find(x => x.emp_no === e.target.value.trim()); who.textContent = p ? conName(p.full_name) + ' · ' + [p.designation, p.station_short || p.station].filter(Boolean).join(' · ') : e.target.value ? 'Not in the directory on this phone' : ''; }
});
document.addEventListener('change', e => { const k = e.target.dataset?.sin; if (k) SA.args[k] = e.target.value; });

if (typeof module !== 'undefined') module.exports = {SA, saRender, saHome, saTaskPage};
