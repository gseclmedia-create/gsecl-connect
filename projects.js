// Projects (4.1): mega-project status from the GSECL PNP portal (Ukai #7 1x800 MW …) through the Pnp_ tabs of the
// GSECL Connect Sheet, shown as charts first: overview gauges and S-curve, engineering (BHEL PEDM: MDL, documents with
// GSECL / with BHEL / due, RFC, compliance, comments), MDCC material despatch clearance, site (DPR, manpower, machinery,
// foundations), finance (payments, cash plan, packages, BBU), risks (matrix, issues, owner inputs, hindrances),
// milestones, and agency reports uploaded from the phone. Each tab loads its own summary (pnp_data part) when opened.
// Uses conCall, conSaved, conErr, conDate, conEmpty, conSpin, conMore from connect.js, appCan from coalstock.js, wAgo
// from work.js, the chart kit of viz.js, and $, esc, fmt from index.html / app-main-2.js.

const PJ = {tab: 'dash', data: null, stamp: 0, busy: false, error: '', note: '', pid: 0, saving: false, file: null, parts: {}, partBusy: {}, partErr: {}};
const PJ_IC = {
  dash: '<path d="M3 13h8V3H3zM13 21h8V11h-8zM3 21h8v-6H3zM13 3v6h8V3z"/>', engg: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
  mdcc: '<path d="M3 7l9-4 9 4-9 4z"/><path d="M3 7v10l9 4 9-4V7M12 11v10"/>', site: '<path d="M2 20h20M5 20V9l7-5 7 5v11"/><path d="M9 20v-5h6v5"/>',
  fin: '<path d="M12 2v20M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>', risk: '<path d="M12 3l9.5 16.5h-19z"/><path d="M12 10v4M12 17.5h.01"/>',
  ms: '<path d="M4 21V4M4 4h12l-2 4 2 4H4"/>', up: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 20h16"/>',
};
const PJ_TABS = [['dash', 'Overview'], ['engg', 'Engineering'], ['mdcc', 'MDCC'], ['site', 'Site'], ['fin', 'Finance'], ['risk', 'Risks'], ['ms', 'Milestones'], ['up', 'Upload']];
const PJ_FRESH_MIN = 10;
const PJ_MAX_MB = 20;

const pjMsg = () => (PJ.error ? conErr(PJ.error) : '') + (PJ.note ? `<div class="alert" style="background:#dcfce7;color:#166534;border-color:#bbf7d0"><span>✓</span><span>${esc(PJ.note)}</span></div>` : '');
const pjBtn = (label, act, arg = '', primary = false) => `<button class="btn" data-pjact="${act}" data-pjarg="${esc(arg)}" style="${primary ? 'background:var(--accent);color:#fff;border-color:var(--accent)' : 'color:var(--accent)'}">${esc(label)}</button>`;
const pjNum = (v, d = 1) => (v === '' || v === null || v === undefined || isNaN(+v) ? '—' : fmt(+v, d));
const pjN = v => (v === '' || v === null || v === undefined || isNaN(+v) ? 0 : +v);
const pjProject = () => (PJ.data?.projects || []).find(p => +p.project_id === +PJ.pid) || (PJ.data?.projects || [])[0];
const pjIc = k => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PJ_IC[k] || ''}</svg>`;
const pjCard = (title, body, more = '') => `<div class="card"><h2>${title}${more ? ' ' + more : ''}</h2>${body}</div>`;
const pjDays = d => Math.round((Date.now() - new Date(String(d).slice(0, 10) + 'T00:00:00').getTime()) / 864e5);
const pjAgeColor = d => (d > 180 ? '#be123c' : d > 90 ? '#d97706' : d > 30 ? '#ca8a04' : '#15803d');
const PJ_AGE_KEYS = [{k: '0–30 d', c: '#15803d'}, {k: '31–60 d', c: '#ca8a04'}, {k: '61–90 d', c: '#d97706'}, {k: '91–180 d', c: '#ea580c'}, {k: 'over 180 d', c: '#be123c'}];
const PJ_QUEUE = {pending_approval: 'With GSECL for approval', resub_pending: 'With BHEL for resubmission', due_not_submitted: 'Due, not submitted by BHEL', rfc: 'Released for construction', icat_submitted: 'I-category submitted'};

// ---------------------------------------------------------------- loading

async function pjLoad(force = false) {
  if (PJ.busy || typeof Connect === 'undefined') return;
  const key = 'pnp_data_' + (PJ.pid || 0);
  const saved = conSaved(key);
  if (saved && !PJ.data) { PJ.data = saved.data; PJ.stamp = Date.now() - saved.age * 60000; }
  if (saved && !force && saved.age < PJ_FRESH_MIN) { pjRender(); return pjNeedParts(); }
  PJ.busy = true; PJ.error = ''; pjRender();
  const r = await conCall('pnp_data', PJ.pid ? {project_id: PJ.pid} : {});
  PJ.busy = false;
  if (r.ok) {
    PJ.data = r.data; PJ.stamp = Date.now(); Connect.cacheSet(key, JSON.stringify(r.data));
    if (!PJ.pid && r.data.projects?.length) PJ.pid = +r.data.projects[0].project_id;
    if (force) PJ.parts = {};
  } else if (!PJ.data || !saved) {
    PJ.error = /unknown action/i.test(r.error) ? 'The GSECL Connect script in the Google Sheet has not been updated for the Projects page yet. Add Pnp.gs, update Code.gs and deploy a new version.' : r.error;
  }
  pjRender(); pjNeedParts(force);
}
/** One tab's summary from the service (kept on the phone for 10 minutes). */
async function pjPart(part, force = false) {
  if (PJ.partBusy[part] || typeof Connect === 'undefined' || !PJ.pid) return;
  const key = 'pnp_part_' + part + '_' + PJ.pid, saved = conSaved(key);
  if (saved && !PJ.parts[part]) PJ.parts[part] = saved.data;
  if (saved && !force && saved.age < PJ_FRESH_MIN) return pjRender();
  PJ.partBusy[part] = true; pjRender();
  const r = await conCall('pnp_data', {project_id: PJ.pid, part});
  PJ.partBusy[part] = false;
  if (r.ok && r.data && r.data.part === part) { PJ.parts[part] = r.data; PJ.partErr[part] = ''; Connect.cacheSet(key, JSON.stringify(r.data)); }
  else if (!PJ.parts[part]) PJ.partErr[part] = r.ok ? 'This view comes with the updated GSECL Connect script (Pnp.gs).' : r.error;
  pjRender();
}
/** The overview also shows engineering and MDCC figures; a tab loads its own part. */
function pjNeedParts(force) {
  if (!PJ.data || !PJ.pid) return;
  const want = PJ.tab === 'dash' ? ['engg', 'mdcc'] : ['engg', 'mdcc', 'site', 'fin', 'risk'].includes(PJ.tab) ? [PJ.tab] : [];
  want.forEach(p => { if (force || !PJ.parts[p]) pjPart(p, force); });
}
const pjWait = part => (PJ.partErr[part] ? pjCard('Not available', conEmpty(PJ.partErr[part])) : conSpin());

// ---------------------------------------------------------------- overview

/** The S-curve: planned overall (area), planned engineering / civil (dashed), measured overall and engineering (dots). */
function pjCurve(rows) {
  if (!rows || rows.length < 2) return conEmpty('S-curve not available yet.');
  const lab = rows.map(r => String(r.month_end).slice(2, 7).replace('-', '/'));
  const v = k => rows.map(r => (r[k] === '' || r[k] === null || r[k] === undefined ? null : +r[k]));
  const now = new Date().toISOString().slice(0, 7);
  return vzLine([{k: 'Planned overall', c: 'var(--accent)', pts: v('planned_overall'), w: 2.6}, {k: 'Planned engineering', c: '#6a4fc9', pts: v('planned_engineering'), dash: 1, w: 1.4},
    {k: 'Planned civil', c: '#c98a12', pts: v('planned_civil'), dash: 1, w: 1.4}, {k: 'Measured overall', c: '#be123c', pts: v('actual_overall'), dots: 1, w: 0}],
  lab, {max: 100, unit: '%', today: rows.findIndex(r => String(r.month_end).slice(0, 7) === now), aria: 'S-curve, cumulative progress'});
}

function pjTabDash() {
  const p = pjProject(), d = PJ.data;
  if (!p) return `<div class="card">${conEmpty('No project data in the Google Sheet yet. The PNP portal fills it on its next run.')}</div>`;
  const pid = +p.project_id, sc = (d.scurve || []).filter(r => +r.project_id === pid), ms = (d.milestones || []).filter(r => +r.project_id === pid);
  const hin = (d.hindrances || []).filter(r => +r.project_id === pid), paid = (d.payments || []).filter(r => +r.project_id === pid).reduce((s, r) => s + pjN(r.amount_cr), 0);
  const fin = p.sanctioned_cr ? pjN(p.financial_cr || paid) / pjN(p.sanctioned_cr) * 100 : null;
  const gap = pjN(p.physical_pct) - pjN(p.planned_pct_today);
  const today = new Date().toISOString().slice(0, 10), next = ms.filter(m => !m.actual && String(m.schedule) >= today).slice(0, 4), late = ms.filter(m => pjN(m.delay_days) > 0);
  let h = `<div class="pj-hero"><h3>${esc(p.project)}</h3><div class="pj-sub">${esc([p.station, p.type, p.stage || p.status].filter(Boolean).join(' · '))}</div>
    <div class="vz-rings">${vzRing(pjN(p.physical_pct), {label: 'Physical', sub: 'actual', color: '#a78bfa', size: 86})}
      ${vzRing(pjN(p.planned_pct_today), {label: 'Planned', sub: 'as of today', color: '#60a5fa', size: 86})}
      ${vzRing(pjN(p.time_elapsed_pct), {label: 'Time', sub: 'elapsed', color: '#fbbf24', size: 86, dec: 0})}
      ${fin !== null ? vzRing(fin, {label: 'Financial', sub: 'of sanction', color: '#34d399', size: 86}) : ''}</div></div>`;
  h += vzKpis([
    {k: 'Progress gap', v: (gap >= 0 ? '+' : '−') + fmt(Math.abs(gap), 1) + '%', sub: gap >= 0 ? 'ahead of plan' : 'behind plan', tone: gap >= 0 ? 'ok' : 'bad'},
    {k: 'Days to sync', v: p.days_to_sync === '' || p.days_to_sync === undefined ? '—' : fmt(pjN(p.days_to_sync)), sub: 'to synchronisation', tone: pjN(p.days_to_sync) < 365 ? 'warn' : ''},
    {k: 'Hindrances', v: fmt(pjN(p.open_hindrances)), sub: 'open', tone: pjN(p.open_hindrances) ? 'bad' : 'ok', act: 'data-pjgo="risk"'},
    {k: 'Risks', v: fmt(pjN(p.open_risks)), sub: 'open', tone: pjN(p.open_risks) ? 'warn' : 'ok', act: 'data-pjgo="risk"'}], 2);
  h += pjCard('S-curve', pjCurve(sc), conMore('cumulative %'));
  const e = PJ.parts.engg, m = PJ.parts.mdcc;
  if (e || m) {
    const q = k => (e ? (e.queues || []).find(x => x.key === k) : null);
    const appr = e ? (e.mdl_status || []).filter(x => /approved|information|rfc/i.test(x.k)).reduce((t, x) => t + x.n, 0) : 0;
    h += pjCard('Engineering & material at a glance', `<div class="vz-rings">
        ${e ? vzRing(e.mdl_total ? appr / e.mdl_total * 100 : 0, {label: 'MDL approved', sub: fmt(appr) + ' of ' + fmt(e.mdl_total), tone: 'ok'}) : ''}
        ${e ? vzRing(e.mdl_total ? (e.mdl_total - ((e.mdl_status || []).find(x => /not\s*submitted/i.test(x.k)) || {n: 0}).n) / e.mdl_total * 100 : 0, {label: 'MDL submitted', sub: 'by BHEL'}) : ''}
        ${m ? vzRing(m.cleared_pct || 0, {label: 'MDCC cleared', sub: fmt((m.states || {}).cleared || 0) + ' of ' + fmt(m.items) + ' items', color: '#0f766e'}) : ''}</div>
      ${e ? vzKpis([{k: 'With GSECL', v: fmt(q('pending_approval')?.n || 0), sub: 'for approval', tone: 'warn', act: 'data-pjgo="engg"'},
        {k: 'With BHEL', v: fmt(q('resub_pending')?.n || 0), sub: 'to resubmit', act: 'data-pjgo="engg"'},
        {k: 'Due, not sent', v: fmt(q('due_not_submitted')?.n || 0), sub: 'by BHEL', tone: 'bad', act: 'data-pjgo="engg"'},
        {k: 'MDCC requests', v: m ? fmt(m.requests) : '—', sub: 'to approve', tone: m && m.requests ? 'warn' : '', act: 'data-pjgo="mdcc"'}], 2) : ''}`, conMore('BHEL PEDM'));
  }
  const ph = (d.phases || []).filter(r => +r.project_id === pid);
  if (ph.length) h += pjCard('Phases', vzBars(ph.map(r => ({k: r.phase, v: pjN(r.progress_pct), note: [r.planned_start && 'plan ' + conDate(String(r.planned_start).slice(0, 10)) + ' – ' + conDate(String(r.planned_end).slice(0, 10)), r.status].filter(Boolean).join(' · ')})), {max: 100, unit: '%'}));
  if (next.length || late.length) h += pjCard('Milestones', `<div class="pj-tl">${late.slice(0, 3).map(mm => `<div style="--c:#be123c"><b>${esc(mm.milestone)}</b><small>Scheduled ${conDate(mm.schedule)} · <b style="color:#be123c">${fmt(pjN(mm.delay_days))} days late</b>${mm.expected ? ' · expected ' + conDate(mm.expected) : ''}</small></div>`).join('')}
      ${next.map(mm => `<div style="--c:#1d4ed8"><b>${esc(mm.milestone)}</b><small>Due ${conDate(mm.schedule)} · in ${fmt(-pjDays(mm.schedule))} days</small></div>`).join('')}</div>`, `<span class="more" data-pjact="tab" data-pjarg="ms">All ›</span>`);
  if (hin.length) h += pjCard('Open hindrances', vzBars(hin.slice(0, 6).map(x => ({k: x.hindrance, v: pjN(x.days), label: fmt(pjN(x.days)) + ' d', c: pjAgeColor(pjN(x.days)), note: esc(x.agency || '')}))), `<span class="more" data-pjact="tab" data-pjarg="risk">All ›</span>`);
  const up = d.updates || [];
  if (up.length) h += pjCard('Team updates', `<div class="pj-list">${up.slice(0, 5).map(u => `<div class="pj-li"><span class="pj-d" style="background:#1d4ed8">${esc(String(u.type || 'Note').slice(0, 6))}</span><span class="pj-t"><b>${esc(u.title || '')}</b><span>${esc(String(u.text || '').slice(0, 140))}</span><span> · ${esc(u.by || '')}${u.when ? ' · ' + conDate(String(u.when).slice(0, 10)) : ''}</span></span></div>`).join('')}</div>`);
  return h;
}

// ---------------------------------------------------------------- engineering (BHEL PEDM)

function pjTabEngg() {
  const e = PJ.parts.engg;
  if (!e) return pjWait('engg');
  const st = e.mdl_status || [], appr = st.filter(x => /approved|information|rfc/i.test(x.k)).reduce((t, x) => t + x.n, 0);
  const notSub = (st.find(x => /not\s*submitted/i.test(x.k)) || {n: 0}).n, q = k => (e.queues || []).find(x => x.key === k) || {n: 0, aging: null, by_area: []};
  const STC = {Approved: '#15803d', 'For Information': '#0f766e', Commented: '#d97706', Resubmitted: '#7c3aed', Submitted: '#1d4ed8', 'Not Submitted': '#94a3b8'};
  let h = vzKpis([{k: 'MDL documents', v: fmt(e.mdl_total), sub: 'master list'}, {k: 'Approved / info', v: fmt(appr), sub: fmt(e.mdl_total ? appr / e.mdl_total * 100 : 0, 1) + '% of MDL', tone: 'ok'},
    {k: 'Not submitted', v: fmt(notSub), sub: fmt(e.mdl_overdue || 0) + ' past schedule', tone: 'bad'}, {k: 'RFC drawings', v: fmt(q('rfc').n), sub: 'released for construction', tone: 'ok'}], 2);
  h += pjCard('Master document list (MDL) by status', vzDonut(st.map(x => ({k: x.k, n: x.n, c: STC[x.k]})), {label: 'documents'}));
  h += pjCard('Where the documents are', vzBars([
    {k: PJ_QUEUE.pending_approval, v: q('pending_approval').n, c: '#d97706', note: 'GSECL / consultant to approve'},
    {k: PJ_QUEUE.resub_pending, v: q('resub_pending').n, c: '#7c3aed', note: 'commented, BHEL to resubmit'},
    {k: PJ_QUEUE.due_not_submitted, v: q('due_not_submitted').n, c: '#be123c', note: 'scheduled date passed'},
    {k: PJ_QUEUE.icat_submitted, v: q('icat_submitted').n, c: '#0891b2'}, {k: PJ_QUEUE.rfc, v: q('rfc').n, c: '#15803d'}]));
  h += pjCard('How long they have waited', vzStack(['pending_approval', 'resub_pending', 'due_not_submitted'].map(k => ({k: PJ_QUEUE[k], parts: (q(k).aging || []).map(a => a.n)})), PJ_AGE_KEYS));
  const units = e.mdl_units || [];
  h += pjCard('MDL by BHEL unit', vzStack(units.map(u => ({k: u.unit, parts: [u.approved, u.submitted, u.not_submitted], label: fmt(u.total)})),
    [{k: 'Approved / info', c: '#15803d'}, {k: 'Submitted / in review', c: '#1d4ed8'}, {k: 'Not submitted', c: '#cbd5e1'}]));
  const ds = (e.doc_summary || []).filter(x => x.category === (PJ.docCat || 'Drawings'));
  const cats = [...new Set((e.doc_summary || []).map(x => x.category))];
  if (cats.length) h += pjCard('PEDM status summary', `<div class="chips" style="margin-bottom:8px">${cats.map(c => `<button class="chip ${c === (PJ.docCat || 'Drawings') ? 'on' : ''}" data-pjact="doccat" data-pjarg="${esc(c)}">${esc(c)}</button>`).join('')}</div>
    ${vzStack(ds.map(x => ({k: x.unit, parts: [pjN(x.approved), pjN(x.pending_gsecl), pjN(x.pending_bhel), Math.max(0, pjN(x.due) - pjN(x.submitted)), Math.max(0, pjN(x.total) - pjN(x.due))], label: fmt(pjN(x.total))})),
      [{k: 'Approved', c: '#15803d'}, {k: 'With GSECL', c: '#d97706'}, {k: 'With BHEL', c: '#7c3aed'}, {k: 'Due, not submitted', c: '#be123c'}, {k: 'Not yet due', c: '#cbd5e1'}])}`);
  if ((e.rfc_months || []).length) h += pjCard('Drawings released for construction, by month', vzCols(e.rfc_months.map(x => ({k: x.k.slice(2).replace('-', '/'), v: x.n}))));
  const list = (title, rows, key, color) => rows && rows.length ? `<details class="card pj-det"${key === 'with_gsecl' ? ' open' : ''}><summary><h2 style="margin:0">${title} <span class="more muted" style="font-weight:500;font-size:11.5px">oldest first</span></h2></summary>
    <div class="pj-list" style="margin-top:10px">${rows.slice(0, 15).map(r => { const d = pjN(r.pending_days); return `<div class="pj-li"><span class="pj-d" style="background:${pjAgeColor(d)}">${fmt(d)}<small>days</small></span>
      <span class="pj-t"><b>${esc(r.title || r.doc_no)}</b><span>${esc([r.doc_no, r.unit || r.area, r.purpose && 'Cat ' + r.purpose, r.rev !== '' && r.rev !== undefined && 'Rev ' + r.rev].filter(Boolean).join(' · '))}${pjN(r.delay_days) ? ` · <b style="color:#be123c">${fmt(pjN(r.delay_days))} d past schedule</b>` : ''}</span></span></div>`; }).join('')}</div></details>` : '';
  h += list('With GSECL for approval', e.with_gsecl, 'with_gsecl') + list('With BHEL for resubmission', e.with_bhel, 'with_bhel') + list('Due but not submitted by BHEL', e.not_submitted, 'not_submitted');
  const cp = e.compliance || [];
  if (cp.length) h += pjCard('Compliance reports by unit', vzStack(cp.sort((a, b) => pjN(b.documents) - pjN(a.documents)).slice(0, 12).map(x => ({k: x.unit, parts: [pjN(x.cr_reviewed), Math.max(0, pjN(x.cr_by_bhel) - pjN(x.cr_reviewed)), Math.max(0, pjN(x.documents) - pjN(x.cr_by_bhel))], label: fmt(pjN(x.documents))})),
    [{k: 'Reviewed', c: '#15803d'}, {k: 'CR from BHEL', c: '#1d4ed8'}, {k: 'No CR yet', c: '#cbd5e1'}]));
  if ((e.comments || []).length) h += `<details class="card pj-det"><summary><h2 style="margin:0">Latest comments to BHEL</h2></summary><div class="pj-list" style="margin-top:10px">${e.comments.slice(0, 12).map(c => `<div class="pj-li"><span class="pj-d" style="background:#1d4ed8">${esc(String(c.remarks_on || '').slice(8, 10) || '·')}<small>${esc(CON_MON[+String(c.remarks_on || '').slice(5, 7) - 1] || '')}</small></span>
    <span class="pj-t"><b>${esc(c.title || c.doc_no)}</b><span>${esc([c.doc_no, c.unit, c.rev !== '' && 'Rev ' + c.rev].filter(Boolean).join(' · '))} · ${esc(c.remarks || '')}</span></span></div>`).join('')}</div></details>`;
  const t = (e.tiles || [])[0];
  h += `<div class="note-src">From BHEL PEDM through the projects portal${t && t.fetched_at ? ' (read ' + esc(String(t.fetched_at).slice(0, 16)) + ')' : ''}${e.summary ? ' · monthly status report as of ' + esc(conDate(String(e.summary.as_of).slice(0, 10))) : ''}.</div>`;
  return h;
}

// ---------------------------------------------------------------- MDCC (material despatch clearance)

function pjTabMdcc() {
  const m = PJ.parts.mdcc;
  if (!m) return pjWait('mdcc');
  const s = m.states || {}, old = m.oldest_request ? pjDays(m.oldest_request) : null;
  let h = `<div class="card"><h2>Material despatch clearance</h2><div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap">
      ${vzRing(m.cleared_pct || 0, {label: 'Items fully cleared', sub: fmt(s.cleared || 0) + ' of ' + fmt(m.items), color: '#0f766e', size: 104})}
      <div style="flex:1;min-width:160px">${vzDonut([{k: 'Cleared', n: s.cleared || 0, c: '#15803d'}, {k: 'Partly cleared', n: s.partial || 0, c: '#1d4ed8'}, {k: 'Request pending', n: s.pending || 0, c: '#d97706'}, {k: 'Not requested', n: s.not_started || 0, c: '#cbd5e1'}], {size: 96, stroke: 14, label: 'BBU items'})}</div></div></div>`;
  h += vzKpis([{k: 'Requests to approve', v: fmt(m.requests), sub: 'despatch requests', tone: m.requests ? 'warn' : 'ok'},
    {k: 'Oldest request', v: old === null ? '—' : fmt(old) + ' d', sub: m.oldest_request ? 'since ' + conDate(m.oldest_request) : 'none waiting', tone: old > 15 ? 'bad' : ''}], 2);
  h += pjCard('By manufacturing unit', vzStack((m.by_mu || []).map(x => ({k: x.mu, parts: [x.cleared, x.partial, x.pending, x.not_started], label: fmt(x.items) + ' items'})),
    [{k: 'Cleared', c: '#15803d'}, {k: 'Partly', c: '#1d4ed8'}, {k: 'Pending', c: '#d97706'}, {k: 'Not requested', c: '#cbd5e1'}]));
  if ((m.requests_by_mu || []).length) h += pjCard('Requests waiting, by unit', vzBars(m.requests_by_mu.map(x => ({k: x.k, v: x.n, c: '#d97706'}))));
  if ((m.requests_list || []).length) h += `<details class="card pj-det" open><summary><h2 style="margin:0">Despatch requests to approve <span class="more muted" style="font-weight:500;font-size:11.5px">oldest first</span></h2></summary>
    <div class="pj-list" style="margin-top:10px">${m.requests_list.slice(0, 20).map(r => { const d = r.date_requested ? pjDays(r.date_requested) : 0; return `<div class="pj-li"><span class="pj-d" style="background:${pjAgeColor(d * 6)}">${fmt(d)}<small>days</small></span>
      <span class="pj-t"><b>${esc(r.description || r.bbu)}</b><span>${esc([r.mu, r.bbu, fmt(pjN(r.requested)) + ' of ' + fmt(pjN(r.total)) + ' ' + (r.uom || '')].filter(Boolean).join(' · '))}</span></span></div>`; }).join('')}</div></details>`;
  if ((m.balance || []).length) h += pjCard('Items with the most still to clear', vzBars(m.balance.slice(0, 12).map(r => ({k: r.description || r.bbu, v: r.pct, label: r.pct + '%', c: r.pct >= 75 ? '#15803d' : r.pct >= 40 ? '#1d4ed8' : '#d97706',
    note: esc([r.mu, r.bbu, 'balance ' + fmt(pjN(r.balance)) + ' ' + (r.uom || ''), pjN(r.pending) ? fmt(pjN(r.pending)) + ' pending approval' : ''].filter(Boolean).join(' · '))})), {max: 100}), conMore('% approved'));
  return h + '<div class="note-src">MDCC summary and requests from BHEL PEDM through the projects portal. Quantities are in each item\'s own unit, so items are counted, not added.</div>';
}

// ---------------------------------------------------------------- site

function pjTabSite() {
  const s = PJ.parts.site;
  if (!s) return pjWait('site');
  let h = '';
  const mp = s.manpower || [], plan = mp.reduce((t, x) => t + x.plan, 0), act = mp.reduce((t, x) => t + x.actual, 0);
  const mc = s.machinery || [], req = mc.reduce((t, x) => t + pjN(x.required), 0), av = mc.reduce((t, x) => t + Math.min(pjN(x.available), pjN(x.required) || pjN(x.available)), 0);
  h += `<div class="card"><h2>Site today ${conMore(s.dpr_date ? conDate(s.dpr_date) : '')}</h2><div class="vz-rings">
      ${vzRing(plan ? act / plan * 100 : 0, {label: 'Manpower', sub: fmt(act) + ' of ' + fmt(plan), tone: act >= plan * .9 ? 'ok' : 'warn'})}
      ${vzRing(req ? av / req * 100 : 0, {label: 'Machinery', sub: fmt(av) + ' of ' + fmt(req), tone: av >= req * .9 ? 'ok' : 'warn'})}
      ${(s.sections || []).length ? vzRing(s.sections.reduce((t, x) => t + x.pct * x.items, 0) / s.sections.reduce((t, x) => t + x.items, 0), {label: 'DPR items', sub: 'average done'}) : ''}</div></div>`;
  if ((s.sections || []).length) h += pjCard('Progress by section (daily report)', vzBars(s.sections.map(x => ({k: x.section, v: x.pct, note: fmt(x.items) + ' items' + (x.worked_today ? ' · ' + x.worked_today + ' worked today' : '')})), {max: 100, unit: '%'}));
  if (mp.length) h += pjCard('Manpower by agency', vzBars(mp.map(x => ({k: x.agency, v: x.actual, mark: x.plan, label: fmt(x.actual) + ' / ' + fmt(x.plan), c: x.actual >= x.plan * .9 ? '#15803d' : '#d97706'})), {max: Math.max(...mp.map(x => Math.max(x.plan, x.actual)), 1)}), conMore('actual / plan ▮'));
  if ((s.manpower_trend || []).length > 1) h += pjCard('Manpower, recent days', vzLine([{k: 'Actual', c: '#1d4ed8', pts: s.manpower_trend.map(x => x.actual)}, {k: 'Plan', c: '#94a3b8', pts: s.manpower_trend.map(x => x.plan), dash: 1, w: 1.4}], s.manpower_trend.map(x => x.d.slice(8) + '/' + x.d.slice(5, 7))));
  if (mc.length) h += pjCard('Machinery', vzBars(mc.slice(0, 16).map(x => ({k: x.equipment, v: pjN(x.available), mark: pjN(x.required), label: fmt(pjN(x.available)) + ' / ' + fmt(pjN(x.required)), c: pjN(x.available) >= pjN(x.required) ? '#15803d' : '#be123c'})), {max: Math.max(...mc.map(x => Math.max(pjN(x.required), pjN(x.available))), 1)}), conMore('available / required ▮'));
  if ((s.foundations || []).length) h += pjCard('Foundations', vzBars(s.foundations.map(x => ({k: x.area, v: pjN(x.total_fdn) ? pjN(x.fdn_cast) / pjN(x.total_fdn) * 100 : 0, label: fmt(pjN(x.fdn_cast)) + ' / ' + fmt(pjN(x.total_fdn)), note: pjN(x.total_pcc) ? 'PCC ' + fmt(pjN(x.pcc_done)) + ' / ' + fmt(pjN(x.total_pcc)) : ''})), {max: 100}), conMore(s.foundations_date ? conDate(s.foundations_date) : ''));
  if ((s.dpr_today || []).length) h += `<details class="card pj-det"><summary><h2 style="margin:0">Worked on that day</h2></summary><div class="pj-list" style="margin-top:10px">${s.dpr_today.slice(0, 15).map(r => `<div class="pj-li"><span class="pj-d" style="background:#1d4ed8">${fmt(pjN(r.pct), 0)}<small>%</small></span>
    <span class="pj-t"><b>${esc(r.activity)}</b><span>${esc(r.section || '')} · plan ${fmt(pjN(r.today_plan))} · done ${fmt(pjN(r.today_actual))} ${esc(r.uom || '')}</span></span></div>`).join('')}</div></details>`;
  return h || pjCard('Site', conEmpty('No daily progress report imported yet.'));
}

// ---------------------------------------------------------------- finance

function pjTabFin() {
  const f = PJ.parts.fin, p = pjProject();
  if (!f) return pjWait('fin');
  const awarded = (f.packages || []).reduce((t, x) => t + pjN(x.awarded_cr), 0);
  let h = vzKpis([{k: 'Paid to EPC', v: '₹' + fmt(f.paid_cr, 1) + ' Cr', sub: p && p.sanctioned_cr ? fmt(f.paid_cr / pjN(p.sanctioned_cr) * 100, 1) + '% of sanction' : ''},
    {k: 'Sanctioned', v: p ? '₹' + pjNum(p.sanctioned_cr, 0) + ' Cr' : '—'}, {k: 'Packages', v: fmt((f.packages || []).length), sub: '₹' + fmt(awarded, 0) + ' Cr awarded'},
    {k: 'BBU (incl. GST)', v: '₹' + fmt(f.bbu_total, 0) + ' Cr', sub: 'bill of quantities'}], 2);
  if ((f.paid_curve || []).length > 1) h += pjCard('Payments, cumulative', vzLine([{k: 'Cumulative ₹ Cr', c: '#15803d', pts: f.paid_curve.map(x => x.cum)}], f.paid_curve.map(x => x.m.slice(2).replace('-', '/')), {legend: false, dec: 0}));
  else if ((f.paid_curve || []).length) h += pjCard('Payments by month', vzCols(f.paid_curve.map(x => ({k: x.m.slice(2).replace('-', '/'), v: x.cr})), {dec: 1}));
  if ((f.by_type || []).length) h += pjCard('Payments by type', vzDonut(f.by_type.map(x => ({k: x.k, n: Math.round(x.n * 100) / 100})), {label: '₹ Cr', center: fmt(f.paid_cr, 0)}));
  if ((f.cash_plan || []).length) h += pjCard('Cash plan by financial year', vzStack(f.cash_plan.map(x => ({k: x.financial_year, parts: [Math.min(pjN(x.actual_cr), pjN(x.indicative_cr)), Math.max(0, pjN(x.indicative_cr) - pjN(x.actual_cr))], label: '₹' + fmt(pjN(x.actual_cr), 0) + ' / ' + fmt(pjN(x.indicative_cr), 0)})),
    [{k: 'Spent', c: '#15803d'}, {k: 'Still to spend (plan)', c: '#cbd5e1'}]), conMore('₹ Cr'));
  if ((f.packages || []).length) h += pjCard('Packages', vzBars(f.packages.map(x => ({k: x.package || x.code, v: pjN(x.progress_pct), note: esc(['₹' + fmt(pjN(x.awarded_cr), 1) + ' Cr', x.status, x.planned_end && 'end ' + conDate(String(x.planned_end).slice(0, 10))].filter(Boolean).join(' · '))})), {max: 100, unit: '%'}));
  if ((f.bbu_units || []).length) h += pjCard('BBU value by BHEL unit', vzBars(f.bbu_units.map(x => ({k: x.k, v: x.cr, label: '₹' + fmt(x.cr, 0) + ' Cr'}))));
  if ((f.payments || []).length) h += `<details class="card pj-det"><summary><h2 style="margin:0">Recent payments</h2></summary><div class="pj-list" style="margin-top:10px">${f.payments.map(r => `<div class="pj-li"><span class="pj-d" style="background:#15803d">${fmt(pjN(r.amount_cr), 1)}<small>₹ Cr</small></span>
    <span class="pj-t"><b>${esc(r.type || '')}</b><span>${conDate(String(r.date).slice(0, 10))} · ${esc(String(r.remarks || '').split(' (')[0])}</span></span></div>`).join('')}</div></details>`;
  return h;
}

// ---------------------------------------------------------------- risks

function pjTabRisk() {
  const k = PJ.parts.risk, p = pjProject(), d = PJ.data;
  if (!k) return pjWait('risk');
  const openIss = Object.keys(k.issues_by_status || {}).filter(s => s !== 'Closed').reduce((t, s) => t + k.issues_by_status[s], 0);
  let h = vzKpis([{k: 'Open risks', v: fmt((k.risks || []).length), tone: (k.risks || []).length ? 'warn' : 'ok'}, {k: 'Open issues', v: fmt(openIss), tone: openIss ? 'warn' : 'ok'},
    {k: 'Hindrances', v: fmt(k.hindrances_open), sub: fmt(k.hindrances_closed) + ' closed', tone: k.hindrances_open ? 'bad' : 'ok'},
    {k: 'Owner inputs', v: fmt((k.owner_inputs || []).filter(x => !/received|done|complete/i.test(String(x.status))).length), sub: 'not yet received'}], 2);
  h += pjCard('Risk matrix', vzHeat(k.matrix || []), conMore('open risks'));
  if ((k.hindrance_days || []).length) h += pjCard('Open hindrances', vzBars(k.hindrance_days.map(x => ({k: x.k, v: x.n, label: fmt(x.n) + ' d', c: pjAgeColor(x.n), note: esc(x.agency || '')}))), conMore('days open'));
  if (Object.keys(k.issues_by_priority || {}).length) h += pjCard('Open issues by priority', vzDonut(Object.keys(k.issues_by_priority).map(x => ({k: x, n: k.issues_by_priority[x], c: /high|critical/i.test(x) ? '#be123c' : /medium/i.test(x) ? '#d97706' : '#1d4ed8'})), {label: 'issues', size: 100, stroke: 15}));
  if ((k.risks || []).length) h += pjCard('Top risks', `<div class="pj-list">${k.risks.slice(0, 10).map(r => { const s = pjN(r.score); return `<div class="pj-li"><span class="pj-d" style="background:${s >= 15 ? '#be123c' : s >= 8 ? '#d97706' : '#15803d'}">${fmt(s)}<small>score</small></span>
    <span class="pj-t"><b>${esc(r.risk)}</b><span>Probability ${esc(r.probability)} × impact ${esc(r.impact)}${r.mitigation ? ' · ' + esc(String(r.mitigation).slice(0, 140)) : ''}</span></span></div>`; }).join('')}</div>`);
  if ((k.owner_inputs || []).length) h += pjCard('Owner inputs and clearances', `<div class="pj-list">${k.owner_inputs.slice(0, 15).map(x => { const ok = /received|done|complete/i.test(String(x.status)); return `<div class="pj-li"><span class="pj-d" style="background:${ok ? '#15803d' : '#d97706'}">${ok ? '✓' : '…'}</span>
    <span class="pj-t"><b>${esc(x.input)}</b><span>${esc([x.authority, x.required_by && 'needed by ' + conDate(String(x.required_by).slice(0, 10)), x.received && 'received ' + conDate(String(x.received).slice(0, 10)), x.status].filter(Boolean).join(' · '))}</span></span></div>`; }).join('')}</div>`);
  if ((k.issues || []).length) h += `<details class="card pj-det"><summary><h2 style="margin:0">Open issues</h2></summary><div class="pj-list" style="margin-top:10px">${k.issues.map(x => `<div class="pj-li"><span class="pj-d" style="background:${/high|critical/i.test(x.priority) ? '#be123c' : '#d97706'}">${esc(String(x.priority || '').slice(0, 4))}</span>
    <span class="pj-t"><b>${esc(x.title)}</b><span>${esc([x.issue_no, x.category, x.status, x.target && 'target ' + conDate(String(x.target).slice(0, 10))].filter(Boolean).join(' · '))}</span></span></div>`).join('')}</div></details>`;
  return h;
}

// ---------------------------------------------------------------- milestones

function pjTabMs() {
  const p = pjProject(), ms = (PJ.data.milestones || []).filter(r => +r.project_id === +p?.project_id);
  if (!ms.length) return `<div class="card">${conEmpty('No milestone tracker yet (it comes with the monthly EPC status report).')}</div>`;
  const done = ms.filter(m => m.actual).length, late = ms.filter(m => !m.actual && pjN(m.delay_days) > 0).length;
  return `<div class="card"><h2>Key milestones</h2><div class="vz-rings">${vzRing(done / ms.length * 100, {label: 'Achieved', sub: done + ' of ' + ms.length, tone: 'ok'})}${vzRing(late / ms.length * 100, {label: 'Running late', sub: late + ' milestones', tone: late ? 'bad' : 'ok'})}</div></div>
    <div class="card"><h2>Timeline ${conMore('plan · actual / expected')}</h2><div class="pj-tl">${ms.map(m => {
      const c = m.actual ? '#15803d' : pjN(m.delay_days) > 0 ? '#be123c' : '#1d4ed8';
      return `<div style="--c:${c}"><b>${esc(m.milestone)}</b><small>Scheduled ${conDate(m.schedule)}${m.actual ? ' · done ' + conDate(m.actual) : m.expected ? ' · expected ' + conDate(m.expected) : ''}${pjN(m.delay_days) ? ` · <b style="color:#be123c">+${fmt(pjN(m.delay_days))} days</b>` : ''}</small>
        ${m.remarks ? `<small>${esc(m.remarks)}</small>` : ''}</div>`;
    }).join('')}</div></div>`;
}

// ---------------------------------------------------------------- upload

function pjTabUp() {
  const d = PJ.data, can = d.can_upload;
  const types = d.upload_types || [];
  const today = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  const lab = (t, box) => `<label style="display:block;font-size:12px;color:var(--muted);margin-top:10px">${esc(t)}${box}</label>`;
  const form = can ? `<div class="card"><h2>Upload a daily report</h2>${pjMsg()}
      ${lab('Project', `<select class="search" id="pjProj" style="margin:4px 0 0">${(d.projects || []).map(p => `<option value="${p.project_id}" ${+p.project_id === +PJ.pid ? 'selected' : ''}>${esc(p.project)}</option>`).join('')}</select>`)}
      ${lab('What is it?', `<select class="search" id="pjType" style="margin:4px 0 0">${types.map(t => `<option value="${esc(t.key)}">${esc(t.label)}</option>`).join('')}</select>`)}
      ${lab('Report date', `<input class="search" id="pjDate" type="date" value="${today}" max="${new Date().toISOString().slice(0, 10)}" style="margin:4px 0 0">`)}
      ${lab('Agency (e.g. BHEL, STEAG, LCC Projects)', `<input class="search" id="pjAgency" maxlength="120" style="margin:4px 0 0">`)}
      ${lab('Remarks', `<textarea class="search" id="pjRemarks" rows="2" maxlength="500" style="margin:4px 0 0"></textarea>`)}
      <div style="display:flex;gap:8px;margin-top:10px">${pjBtn('📷 Take photo', 'cam')}${pjBtn('Choose file', 'pick')}</div>
      <input type="file" id="pjCam" accept="image/*" capture="environment" hidden><input type="file" id="pjFile" accept=".xlsx,.pptx,.pdf,.csv,.doc,.docx,image/*" hidden>
      <div id="pjPicked" class="note-src" style="margin:6px 0 0">${PJ.file ? `📄 ${esc(PJ.file.name)} · ${fmt(PJ.file.size / 1048576, 1)} MB` : 'No file chosen. Excel for daily progress reports, PowerPoint for the monthly status report; up to ' + PJ_MAX_MB + ' MB.'}</div>
      <div style="margin-top:12px">${pjBtn(PJ.saving ? 'Uploading…' : 'Upload', 'send', '', true)}</div>
      <div class="note-src" style="margin-top:8px">The projects portal picks the file up on its next run (usually within 30 minutes), imports it into the dashboards and the Google Sheet, and you get a notification.</div></div>`
    : `<div class="card">${conEmpty('Uploading reports needs "projects" edit access, given by the administrator on the Employees screen.')}</div>`;
  const mine = d.my_uploads || [];
  const badge = s => `<span class="badge ${s === 'Imported' || s === 'Stored' ? 'b-Running' : s === 'Error' ? 'b-Forced' : 'b-Planned'}">${esc(s || 'Pending')}</span>`;
  return form + `<div class="card"><h2>My uploads</h2>${mine.length ? mine.map(u => `<div class="srow" style="cursor:default"><div class="top"><span class="nm">📄 ${esc(u.file_name)}</span><span class="vals">${badge(u.status)}</span></div>
      <div class="muted" style="font-size:12px">${esc((types.find(t => t.key === u.data_type) || {}).label || u.data_type)}${u.report_date ? ' · ' + conDate(String(u.report_date).slice(0, 10)) : ''}${u.portal_note ? ' · ' + esc(u.portal_note) : ''}</div></div>`).join('') : conEmpty('Nothing uploaded yet.')}</div>`;
}

// ---------------------------------------------------------------- page

function pjRender() {
  const box = $('pjBody');
  if (!box || !$('v-projects') || !$('v-projects').classList.contains('on')) return;
  let h;
  if (typeof Connect === 'undefined') h = `<div class="card">${conEmpty('The Projects page is available after signing in to GSECL Connect.')}</div>`;
  else if (!appCan('projects')) h = `<div class="card">${conEmpty('You have not been given access to the Projects page. Access is given by the administrator on the Employees screen.')}</div>`;
  else if (!PJ.data) h = PJ.error ? pjMsg() + `<div style="text-align:center">${pjBtn('Try again', 'reload')}</div>` : conSpin();
  else {
    const projects = PJ.data.projects || [], busy = PJ.busy || PJ.partBusy[PJ.tab];
    h = (projects.length > 1 ? `<select class="search" id="pjPick" style="margin:0 0 8px">${projects.map(p => `<option value="${p.project_id}" ${+p.project_id === +PJ.pid ? 'selected' : ''}>${esc(p.project)}</option>`).join('')}</select>` : '')
      + `<div class="pj-tabs" role="tablist">${PJ_TABS.map(([k, l]) => `<button class="${PJ.tab === k ? 'on' : ''}" data-pjact="tab" data-pjarg="${k}" role="tab">${pjIc(k)}${l}</button>`).join('')}</div>`
      + (busy ? '<div class="sync-bar" role="progressbar" aria-label="Updating"></div>' : '')
      + (PJ.tab === 'up' ? '' : pjMsg())
      + ({dash: pjTabDash, engg: pjTabEngg, mdcc: pjTabMdcc, site: pjTabSite, fin: pjTabFin, risk: pjTabRisk, ms: pjTabMs, up: pjTabUp}[PJ.tab] || pjTabDash)()
      + `<div class="note-src" style="text-align:center;margin:8px 0 0">From the projects portal via the Google Sheet${PJ.data.refreshed_at ? ' (portal run ' + conDate(String(PJ.data.refreshed_at).replace('T', ' '), true) + ')' : ''} · read ${typeof wAgo === 'function' ? wAgo(PJ.stamp) : ''} · <a data-pjact="reload">Refresh</a></div>`;
  }
  const y = window.scrollY;
  box.innerHTML = h + '<div class="credit">Developed by <b>A D Bhatt</b>, EE, GSECL</div>';
  if (PJ.keepScroll) window.scrollTo({top: y});
  PJ.keepScroll = false;
}

/** The chosen file -> {name, mime_type, data (base64)}. */
function pjRead(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error('Could not read the file'));
    r.onload = () => resolve({name: file.name, mime_type: file.type || 'application/octet-stream', data: String(r.result).split(',')[1] || ''});
    r.readAsDataURL(file);
  });
}

async function pjSend() {
  if (PJ.saving) return;
  if (!PJ.file) { PJ.error = 'Choose the file to upload.'; return pjRender(); }
  if (PJ.file.size > PJ_MAX_MB * 1048576) { PJ.error = 'The file is larger than ' + PJ_MAX_MB + ' MB.'; return pjRender(); }
  const type = $('pjType').value, date = $('pjDate').value;
  if ((type === 'dpr_bhel' || type === 'dpr_steag') && !/\.xlsx$/i.test(PJ.file.name)) { PJ.error = 'A daily progress report must be the Excel (.xlsx) file.'; return pjRender(); }
  if (type === 'status_report' && !/\.pptx$/i.test(PJ.file.name)) { PJ.error = 'The monthly status report must be the PowerPoint (.pptx) file.'; return pjRender(); }
  PJ.saving = true; PJ.error = ''; PJ.note = ''; pjRender();
  try {
    const file = await pjRead(PJ.file);
    const r = await conCall('pnp_upload', {project_id: +$('pjProj').value, data_type: type, report_date: date, agency: $('pjAgency').value.trim(), remarks: $('pjRemarks').value.trim(), file});
    PJ.saving = false;
    if (r.ok) { PJ.note = r.data.message || 'Uploaded.'; PJ.file = null; return pjLoad(true); }
    PJ.error = r.error;
  } catch (e) { PJ.saving = false; PJ.error = e.message || String(e); }
  pjRender();
}

function pjOpenTab(k) {
  PJ.tab = k; PJ.note = ''; PJ.error = ''; pjRender(); window.scrollTo({top: 0});
  if (typeof uiEnter === 'function') uiEnter($('v-projects'));
  pjNeedParts();
  const b = document.querySelector(`.pj-tabs [data-pjarg="${k}"]`); if (b) b.scrollIntoView({inline: 'center', block: 'nearest', behavior: 'smooth'});
}
document.addEventListener('click', e => {
  const go = e.target.closest('[data-pjgo]');
  if (go && typeof Connect !== 'undefined') return pjOpenTab(go.dataset.pjgo);
  const el = e.target.closest('[data-pjact]');
  if (!el || typeof Connect === 'undefined') return;
  const arg = el.dataset.pjarg || '';
  switch (el.dataset.pjact) {
    case 'tab': return pjOpenTab(arg);
    case 'reload': PJ.parts = {}; return pjLoad(true);
    case 'doccat': PJ.docCat = arg; PJ.keepScroll = true; return pjRender();
    case 'cam': return $('pjCam') && $('pjCam').click();
    case 'pick': return $('pjFile') && $('pjFile').click();
    case 'send': return pjSend();
  }
});
document.addEventListener('change', e => {
  if (e.target.id === 'pjPick') { PJ.pid = +e.target.value; PJ.data = null; PJ.parts = {}; return pjLoad(false); }
  if ((e.target.id === 'pjFile' || e.target.id === 'pjCam') && e.target.files.length) {
    PJ.file = e.target.files[0]; e.target.value = ''; PJ.error = '';
    if ($('pjPicked')) $('pjPicked').innerHTML = `📄 ${esc(PJ.file.name)} · ${fmt(PJ.file.size / 1048576, 1)} MB`;
  }
});

/** Called by show('projects'). */
function pjShow() { pjRender(); if (appCan('projects')) pjLoad(false); }

/** Android back button: back to the overview tab first. */
const pjPrevBack = window.appBack;
window.appBack = () => {
  if ($('v-projects') && $('v-projects').classList.contains('on') && PJ.tab !== 'dash') { pjOpenTab('dash'); return true; }
  return pjPrevBack ? pjPrevBack() : false;
};
