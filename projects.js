// Projects (4.2): mega-project monitoring from the GSECL PNP portal (Ukai #7 1x800 MW …) through the GSECL Connect Sheet.
// Two views:
//   Management — an executive page built from the portal's own analytics (PccAnalytics: the same figures the Project
//     Control Centre shows): timeline to synchronisation / COD, BHEL-reported progress against plan, the portal's
//     planned S-curve, engineering measured, expenditure, milestones, hindrances, manpower, safety, key takeaways,
//     financial S-curve, price break-up, material receipt and site photographs.
//   Engineering — the working detail: engineering (BHEL PEDM: MDL, queues, divisions, review ageing, compliance,
//     comments), MDCC, site (DPR sections, foundations, manpower, machinery, 60-day look-ahead), schedule (every
//     milestone with its variance), finance (cash flow, payments, cash plan, non-EPC), risks and report upload.
// Each view loads its own summary (pnp_data part: dash, photos, engg, mdcc, site, fin, risk) when opened.
// Uses conCall, conSaved, conErr, conDate, conEmpty, conSpin, conMore from connect.js, appCan from coalstock.js, wAgo
// from work.js, the chart kit of viz.js, and $, esc, fmt from index.html / app-main-2.js.

const PJ = {view: 'mgmt', tab: 'engg', data: null, stamp: 0, busy: false, error: '', note: '', pid: 0, saving: false, file: null, parts: {}, partBusy: {}, partErr: {}, photos: {}, phBusy: 0};
try { PJ.view = localStorage.getItem('pjView') === 'engg' ? 'engg' : 'mgmt'; PJ.tab = localStorage.getItem('pjTab') || 'engg'; } catch (e) { /* defaults */ }
const PJ_IC = {
  dash: '<path d="M3 13h8V3H3zM13 21h8V11h-8zM3 21h8v-6H3zM13 3v6h8V3z"/>', engg: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
  mdcc: '<path d="M3 7l9-4 9 4-9 4z"/><path d="M3 7v10l9 4 9-4V7M12 11v10"/>', site: '<path d="M2 20h20M5 20V9l7-5 7 5v11"/><path d="M9 20v-5h6v5"/>',
  fin: '<path d="M12 2v20M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>', risk: '<path d="M12 3l9.5 16.5h-19z"/><path d="M12 10v4M12 17.5h.01"/>',
  ms: '<path d="M4 21V4M4 4h12l-2 4 2 4H4"/>', up: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 20h16"/>',
  mgmt: '<path d="M3 3v18h18"/><path d="M7 15l4-5 3 3 5-7"/>', team: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9z"/>',
};
const PJ_TABS = [['engg', 'Engineering'], ['mdcc', 'MDCC'], ['site', 'Site'], ['ms', 'Schedule'], ['fin', 'Finance'], ['risk', 'Risks'], ['up', 'Upload']];
const PJ_FRESH_MIN = 10;
const PJ_MAX_MB = 20;
const PJ_CAT = {engineering: ['Engineering', '#6a4fc9'], supply: ['Supply', '#0891b2'], civil: ['Civil works', '#c98a12'], erection: ['Erection & commissioning', '#0f766e']};

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
/** The portal's analytics of the chosen project (null until loaded / when the portal has not sent them). */
const pjD = () => (PJ.parts.dash && PJ.parts.dash.dash) || null;
const pjCr = (rupees, d = 0) => '₹' + fmt(pjN(rupees) / 1e7, d) + ' Cr';
const pjSigned = (v, d = 1) => (v > 0 ? '+' : v < 0 ? '−' : '') + fmt(Math.abs(v), d);

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
    if (!PJ.pid && r.data.projects?.length) PJ.pid = +((r.data.projects.find(p => pjN(p.planned_pct_today) || pjN(p.time_elapsed_pct)) || r.data.projects[0]).project_id);
    if (force) PJ.parts = {};
  } else if (!PJ.data || !saved) {
    PJ.error = /unknown action/i.test(r.error) ? 'The GSECL Connect script in the Google Sheet has not been updated for the Projects page yet. Add Pnp.gs, update Code.gs and deploy a new version.' : r.error;
  }
  pjRender(); pjNeedParts(force);
}
/** One part's summary from the service (kept on the phone for 10 minutes). */
async function pjPart(part, force = false) {
  if (PJ.partBusy[part] || typeof Connect === 'undefined' || !PJ.pid) return;
  const key = 'pnp_part_' + part + '_' + PJ.pid, saved = conSaved(key);
  if (saved && !PJ.parts[part]) PJ.parts[part] = saved.data;
  if (saved && !force && saved.age < PJ_FRESH_MIN) return pjRender();
  PJ.partBusy[part] = true; pjRender();
  const r = await conCall('pnp_data', {project_id: PJ.pid, part});
  PJ.partBusy[part] = false;
  if (r.ok && r.data && r.data.part === part) { PJ.parts[part] = r.data; PJ.partErr[part] = ''; try { Connect.cacheSet(key, JSON.stringify(r.data)); } catch (e) { /* large */ } }
  else if (!PJ.parts[part]) PJ.partErr[part] = r.ok ? 'This view comes with the updated GSECL Connect script (Pnp.gs).' : r.error;
  pjRender();
}
/** The parts the open view needs: the portal's analytics everywhere, the tab's own summary in the engineering view. */
function pjNeedParts(force) {
  if (!PJ.data || !PJ.pid) return;
  const want = PJ.view === 'mgmt' ? ['dash', 'photos'] : ['dash'].concat(['engg', 'mdcc', 'site', 'fin', 'risk'].includes(PJ.tab) ? [PJ.tab] : []);
  want.forEach(p => { if (force || !PJ.parts[p]) pjPart(p, force); });
}
const pjWait = part => (PJ.partErr[part] ? pjCard('Not available', conEmpty(PJ.partErr[part])) : conSpin());
/** Site photographs (thumbnails) are fetched one by one, three at a time, and kept on the phone. */
function pjPhotoLoad() {
  const list = (PJ.parts.photos && PJ.parts.photos.photos) || [];
  list.forEach(p => {
    const k = PJ.pid + '_' + p.n;
    if (PJ.photos[k] || PJ.phBusy >= 3) return;
    const saved = conSaved('pnp_ph_' + k);
    if (saved && saved.data && saved.data.data) { PJ.photos[k] = saved.data.data; return; }
    PJ.photos[k] = 'loading'; PJ.phBusy++;
    conCall('pnp_photo', {project_id: PJ.pid, n: p.n}).then(r => {
      PJ.phBusy--;
      if (r.ok && r.data && r.data.data) { PJ.photos[k] = r.data.data; try { Connect.cacheSet('pnp_ph_' + k, JSON.stringify(r.data)); } catch (e) { /* large */ } } else PJ.photos[k] = 'none';
      const img = document.querySelector(`[data-pjph="${k}"]`);
      if (img && PJ.photos[k].startsWith('data:')) { img.style.backgroundImage = `url("${PJ.photos[k]}")`; img.classList.add('in'); }
      pjPhotoLoad();
    });
  });
}

// ---------------------------------------------------------------- Management view (the portal's analytics)

const pjMs = iso => (iso ? new Date(String(iso).slice(0, 10) + 'T00:00:00').getTime() : null);
/** The project's time line: zero date → today → synchronisation → COD → completion, with the countdowns. */
function pjTimeline(P, K) {
  const z = pjMs(P.zero_date), end = pjMs(P.scheduled_completion) || pjMs(P.scheduled_cod);
  if (!z || !end || end <= z) return '';
  const pos = t => Math.max(0, Math.min(100, (t - z) / (end - z) * 100)), now = Date.now();
  const marks = [['Zero date', P.zero_date], ['Synchronisation', P.scheduled_sync], ['COD', P.scheduled_cod], ['Completion', P.scheduled_completion]].filter(m => m[1]);
  return `<div class="pj-time"><div class="pj-tbar"><i style="width:${pos(now)}%"></i>${marks.map(m => `<u style="left:${pos(pjMs(m[1]))}%"></u>`).join('')}
      <em style="left:${pos(now)}%"><span>Today · ${fmt(K.elapsed_pct, 1)}%</span></em></div>
    <div class="pj-tlab">${marks.map(m => `<div><b>${esc(m[0])}</b><span>${conDate(m[1])}</span></div>`).join('')}</div>
    <div class="pj-cd"><div><b class="num">${fmt(K.elapsed_months, 1)}</b><span>of ${fmt(K.total_months)} months</span></div>
      <div><b class="num">${fmt(K.days_to_sync)}</b><span>days to synchronisation</span></div><div><b class="num">${fmt(K.days_to_cod)}</b><span>days to COD</span></div></div></div>`;
}
/** Cumulative S-curve: the portal's planned curve (overall and by category) with the BHEL-reported plan / actual points. */
function pjSCurve(D) {
  const c = D.curve || [];
  if (c.length < 2) return conEmpty('S-curve not available yet.');
  const lab = c.map(r => r.label), mon = iso => String(iso).slice(0, 7), idx = iso => c.findIndex(r => mon(r.date) === mon(iso));
  const rep = (D.reported || []).filter(r => idx(r.date) >= 0);
  const at = k => { const a = c.map(() => null); rep.forEach(r => { a[idx(r.date)] = +r[k]; }); return a; };
  const act = c.map(() => null); (D.actuals || []).forEach(r => { const i = idx(r.period_date); if (i >= 0 && r.overall !== null) act[i] = +r.overall; });
  const eng = c.map(() => null); if (D.eng_measured) { const i = idx(new Date().toISOString()); if (i >= 0) eng[i] = +D.eng_measured.pct; }
  const series = [{k: 'Planned overall (portal)', c: '#1d4ed8', pts: c.map(r => +r.overall), w: 2.6},
    {k: 'Planned engineering', c: '#6a4fc9', pts: c.map(r => +r.engineering), dash: 1, w: 1.3}, {k: 'Planned civil', c: '#c98a12', pts: c.map(r => +r.civil), dash: 1, w: 1.3},
    {k: 'BHEL report: plan', c: '#64748b', pts: at('plan'), dots: 1, w: 0}, {k: 'BHEL report: actual', c: '#be123c', pts: at('actual'), dots: 1, w: 0}];
  if (act.some(v => v !== null)) series.push({k: 'Measured overall', c: '#15803d', pts: act, dots: 1, w: 0});
  if (eng.some(v => v !== null)) series.push({k: 'Engineering measured', c: '#a855f7', pts: eng, dots: 1, w: 0});
  return vzLine(series, lab, {max: 100, unit: '%', today: idx(new Date().toISOString()), aria: 'S-curve, cumulative progress', h: 170});
}
function pjMgmt() {
  const D = pjD();
  if (!D) {
    if (PJ.partErr.dash) return pjCard('Not available', conEmpty(PJ.partErr.dash));
    if (!PJ.parts.dash) return conSpin();
    return pjCard('Project analytics', conEmpty('The projects portal has not sent its analytics for this project yet. They come on the portal\'s next run after its update.'));
  }
  const P = D.profile || {}, K = D.kpis || {}, R = D.report || null, pl = K.planned || {};
  const rp = R && R.overall_plan_pct !== null ? +R.overall_plan_pct : null, ra = R && R.overall_actual_pct !== null ? +R.overall_actual_pct : null;
  const gap = rp !== null && ra !== null ? ra - rp : null, spi = rp ? ra / rp : null;
  const tone = gap === null ? '' : gap >= 0 ? 'ok' : gap > -2 ? 'warn' : 'bad';
  const status = gap === null ? ['Status not reported', '#64748b'] : gap >= 0 ? ['On schedule', '#15803d'] : gap > -2 ? ['Slightly behind plan', '#d97706'] : ['Behind plan', '#be123c'];
  const contract = pjN(P.contract_value), exp = R && R.expenditure_cr !== null ? +R.expenditure_cr : null;
  const mdl = K.mdl || {}, em = D.eng_measured, mp = K.manpower || {}, hse = K.hse || {}, hin = K.hindrance || {};
  // hero
  let h = `<div class="pj-exec"><div class="pj-eh"><div><span class="pj-tag">${esc(P.short_name || 'Project')}</span><h3>${esc(P.full_title || pjProject()?.project || '')}</h3>
      <div class="pj-sub">${esc([P.location, P.technology].filter(Boolean).join(' · '))}</div></div>
      <span class="pj-st" style="--c:${status[1]}"><i></i>${status[0]}</span></div>
    <div class="pj-meta"><div><span>EPC</span><b>${esc(String(P.epc_contractor || '—').replace(/\s*[–—-]\s*EPC$/, ''))}</b></div><div><span>Owner's engineer</span><b>${esc(String(P.owner_engineer || '—').replace(/\s*(Pvt\.?\s*)?Ltd\.?$/i, ''))}</b></div>
      <div><span>Contract value</span><b class="num">${contract ? pjCr(contract) : '—'}</b></div><div><span>With taxes</span><b class="num">${P.cost_incl_tax ? pjCr(P.cost_incl_tax) : '—'}</b></div></div>
    ${pjTimeline(P, K)}</div>`;
  // headline figures
  h += vzKpis([
    {k: 'Overall progress', v: ra !== null ? fmt(ra, 2) + '%' : '—', sub: rp !== null ? 'plan ' + fmt(rp, 2) + '% · BHEL report' : 'no status report yet', tone},
    {k: 'Progress gap', v: gap !== null ? pjSigned(gap, 2) + ' pts' : '—', sub: spi ? 'SPI ' + fmt(spi, 2) + ' (actual ÷ plan)' : '', tone},
    {k: 'Planned today', v: fmt(pl.overall, 1) + '%', sub: 'portal S-curve (L2 schedule)'},
    {k: 'Time elapsed', v: fmt(K.elapsed_pct, 1) + '%', sub: fmt(K.elapsed_months, 1) + ' of ' + fmt(K.total_months) + ' months'},
    {k: 'Engineering', v: em ? fmt(em.pct, 1) + '%' : '—', sub: em ? fmt(em.submitted) + ' submitted · ' + fmt(em.approved) + ' approved of ' + fmt(em.total) : 'measured from documents', act: 'data-pjgo="engg"'},
    {k: 'Expenditure', v: exp !== null ? '₹' + fmt(exp, 2) + ' Cr' : '—', sub: exp !== null && contract ? fmt(exp * 1e7 / contract * 100, 1) + '% of contract' : '', act: 'data-pjgo="fin"'},
    {k: 'Milestones', v: fmt(K.ms_achieved) + ' / ' + fmt(K.ms_total), sub: pjN(K.ms_due) ? fmt(K.ms_due) + ' overdue' : 'achieved', tone: pjN(K.ms_due) ? 'warn' : 'ok', act: 'data-pjgo="ms"'},
    {k: 'Hindrances', v: fmt(pjN(hin.open_n)), sub: pjN(hin.open_n) ? 'open' + (pjN(hin.oldest) ? ' · oldest ' + fmt(pjN(hin.oldest)) + ' d' : '') : 'none open', tone: pjN(hin.open_n) ? 'bad' : 'ok', act: 'data-pjgo="risk"'},
  ], 2);
  if (K.next_milestone) h += `<div class="pj-next"><span>Next milestone</span><b>${esc(K.next_milestone.name)}</b><small>${conDate(K.next_milestone.planned)} · in ${fmt(K.next_milestone.days)} days</small></div>`;
  // progress
  h += pjCard('Physical progress — S-curve', pjSCurve(D), conMore('cumulative %'));
  const w = D.weights || {}, ka = K.actual || {};
  h += pjCard('Progress by work category', vzBars(Object.keys(PJ_CAT).map(k => ({k: PJ_CAT[k][0], v: +pl[k] || 0, c: PJ_CAT[k][1], mark: ka[k] !== undefined && ka[k] !== null ? +ka[k] : undefined,
      label: fmt(+pl[k] || 0, 1) + '%' + (ka[k] !== undefined && ka[k] !== null ? ' · actual ' + fmt(+ka[k], 1) + '%' : ''),
      note: 'weight ' + fmt(+w[k] || 0, 0) + '% of the project' + (k === 'engineering' && em ? ' · measured ' + fmt(em.pct, 1) + '% from documents' : '')})), {max: 100}), conMore('planned today'));
  // milestones (contract tracker of the status report)
  const tr = D.tracker || [];
  if (tr.length) {
    const done = tr.filter(m => m.actual_date).length, late = tr.filter(m => !m.actual_date && pjN(m.delay_days) > 0).length;
    h += pjCard('Contract milestones', `<div class="vz-rings">${vzRing(done / tr.length * 100, {label: 'Achieved', sub: done + ' of ' + tr.length, tone: 'ok', size: 82})}${vzRing(late / tr.length * 100, {label: 'Expected late', sub: late + ' milestones', tone: late ? 'bad' : 'ok', size: 82})}</div>
      <div class="pj-tl" style="margin-top:12px">${tr.map(m => { const d = pjN(m.delay_days), c = m.actual_date ? '#15803d' : d > 0 ? '#be123c' : '#1d4ed8';
        return `<div style="--c:${c}"><b>${esc(m.name)}</b><small>Scheduled ${conDate(m.schedule_date)}${m.actual_date ? ' · done ' + conDate(m.actual_date) : m.expected_date ? ' · expected ' + conDate(m.expected_date) : ''}${d > 0 ? ` · <b style="color:#be123c">+${fmt(d)} days</b>` : ''}</small>${m.remarks ? `<small>${esc(m.remarks)}</small>` : ''}</div>`; }).join('')}</div>`, conMore(R ? 'status report ' + conDate(R.as_of) : ''));
  }
  // key messages of the status report
  if (R && ((R.takeaways || []).length || (R.way_forward || []).length)) h += pjCard('Key takeaways', `<ul class="pj-ul">${(R.takeaways || []).map(t => `<li>${esc(t)}</li>`).join('')}</ul>
    ${(R.way_forward || []).length ? `<h4 class="pj-h4">Way forward</h4><ul class="pj-ul fwd">${R.way_forward.map(t => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}`, conMore(R.period_text || ''));
  // money
  const cf = D.cashflow || {}, ct = cf.totals || {}, rows = cf.rows || [];
  if (rows.length > 1) {
    const ti = rows.findIndex(r => String(r.date).slice(0, 7) === new Date().toISOString().slice(0, 7)), paidPts = rows.map((r, i) => (ti < 0 || i <= ti ? +r.paid : null));
    h += pjCard('Financial progress', vzKpis([{k: 'Awarded', v: '₹' + fmt(ct.awarded, 0) + ' Cr', sub: 'packages'}, {k: 'Planned to date', v: '₹' + fmt(ct.planned_now, 0) + ' Cr', sub: 'cash-flow plan'},
      {k: 'Paid to date', v: '₹' + fmt(ct.paid, 0) + ' Cr', sub: ct.planned_now ? fmt(ct.paid / ct.planned_now * 100, 0) + '% of planned' : '', tone: ct.planned_now && ct.paid < ct.planned_now * .9 ? 'warn' : 'ok'}], 3)
      + vzLine([{k: 'Planned (cumulative)', c: '#1d4ed8', pts: rows.map(r => +r.planned)}, {k: 'Paid (cumulative)', c: '#15803d', pts: paidPts, w: 2.6}], rows.map(r => r.label), {unit: '', dec: 0, today: ti, aria: 'Financial S-curve, ₹ crore'}), conMore('₹ Cr'));
  }
  const pb = R ? (R.price_breakup || []).filter(x => !/total/i.test(x[0])) : [];
  if (pb.length) h += pjCard('Contract price break-up', vzDonut(pb.map((x, i) => ({k: x[0], n: Math.round(+x[1]), c: ['#1d4ed8', '#0891b2', '#0f766e', '#c98a12', '#94a3b8', '#7c3aed'][i]})), {label: '₹ Cr', size: 116}));
  if (R && R.non_epc_budget_cr) h += pjCard('Non-EPC works', `<div class="vz-rings">${vzRing(pjN(R.non_epc_spent_cr) / pjN(R.non_epc_budget_cr) * 100, {label: 'Spent', sub: '₹' + fmt(pjN(R.non_epc_spent_cr), 1) + ' of ₹' + fmt(pjN(R.non_epc_budget_cr), 0) + ' Cr', color: '#0f766e', dec: 1})}</div>`);
  // supply
  const mt = R ? R.materials || [] : [];
  if (mt.length) h += pjCard('Material received at site', vzBars(mt.map(x => ({k: x.item, v: pjN(x.total_mt) ? pjN(x.received_mt) / pjN(x.total_mt) * 100 : 0, label: fmt(pjN(x.received_mt)) + ' / ' + fmt(pjN(x.total_mt)) + ' MT',
    c: pjN(x.received_mt) >= pjN(x.total_mt) ? '#15803d' : '#0891b2', note: esc(x.unit || '')})), {max: 100}), conMore('received / total'));
  // site and safety
  const mpa = D.manpower || [];
  h += pjCard('Site and safety', vzKpis([
    {k: 'Manpower', v: fmt(pjN(mp.act)), sub: 'of ' + fmt(pjN(mp.plan)) + ' planned' + (K.dpr_date ? ' · ' + conDate(K.dpr_date) : ''), tone: pjN(mp.act) >= pjN(mp.plan) * .9 ? 'ok' : 'warn', act: 'data-pjgo="site"'},
    {k: 'Safe man-hours', v: fmt(pjN(hse['Safe man-hours (cumulative)'])), sub: 'cumulative', tone: 'ok'},
    {k: 'Near misses', v: fmt(pjN(hse['Other Near miss'])), sub: 'reported', tone: pjN(hse['Other Near miss']) ? 'warn' : 'ok'},
    {k: 'Unsafe acts / conditions', v: fmt(pjN(hse['Unsafe Act'])) + ' / ' + fmt(pjN(hse['Unsafe Condition'])), sub: 'on the day', tone: pjN(hse['Unsafe Act']) + pjN(hse['Unsafe Condition']) ? 'bad' : 'ok'}], 2)
    + (mpa.length ? vzBars(mpa.map(x => ({k: x.agency, v: pjN(x.act), mark: pjN(x.plan), label: fmt(pjN(x.act)) + ' / ' + fmt(pjN(x.plan)), c: pjN(x.act) >= pjN(x.plan) * .9 ? '#15803d' : '#d97706'})), {max: Math.max(...mpa.map(x => Math.max(pjN(x.plan), pjN(x.act))), 1)}) : ''), conMore('daily progress report'));
  const cv = (D.civil || []).filter(x => x.latest && pjN(x.latest.total_fdn));
  if (cv.length) h += pjCard('Foundations by area', vzBars(cv.sort((a, b) => pjN(b.latest.total_fdn) - pjN(a.latest.total_fdn)).slice(0, 10).map(x => ({k: x.area, v: pjN(x.latest.done_fdn) / pjN(x.latest.total_fdn) * 100,
    label: fmt(pjN(x.latest.done_fdn)) + ' / ' + fmt(pjN(x.latest.total_fdn)), c: pjN(x.latest.done_fdn) >= pjN(x.latest.total_fdn) ? '#15803d' : '#c98a12'})), {max: 100}), `<span class="more" data-pjgo="site">Site ›</span>`);
  const ho = (D.hindrances || []).filter(x => x.status === 'Open');
  if (ho.length) h += pjCard('Open hindrances', `<div class="pj-list">${ho.slice(0, 5).map(x => `<div class="pj-li"><span class="pj-d" style="background:${pjAgeColor(pjN(x.days))}">${x.days !== null ? fmt(pjN(x.days)) : '…'}<small>${x.days !== null ? 'days' : 'open'}</small></span>
    <span class="pj-t"><b>${esc(x.description)}</b><span>${esc([x.agency, x.to_date && 'target ' + conDate(x.to_date)].filter(Boolean).join(' · '))}</span></span></div>`).join('')}</div>`, `<span class="more" data-pjgo="risk">All ›</span>`);
  h += pjPhotoStrip();
  h += `<div class="note-src">Figures as computed by the projects portal (Project Control Centre) on ${esc(conDate(D.generated_at, true))}${R ? '; BHEL status report of ' + conDate(R.as_of) : ''}${K.dpr_date ? '; daily progress report of ' + conDate(K.dpr_date) : ''}.</div>`;
  return h;
}
/** Site photographs from the status reports and the portal: a strip of thumbnails, tap to enlarge. */
function pjPhotoStrip() {
  const list = (PJ.parts.photos && PJ.parts.photos.photos) || [];
  if (!list.length) return '';
  setTimeout(pjPhotoLoad, 0);
  return pjCard('Site photographs', `<div class="pj-photos">${list.map(p => { const k = PJ.pid + '_' + p.n, src = PJ.photos[k];
      return `<button class="pj-ph ${src && src.startsWith('data:') ? 'in' : ''}" data-pjph="${k}" data-pjact="photo" data-pjarg="${p.n}" style="${src && src.startsWith('data:') ? `background-image:url('${src}')` : ''}" aria-label="${esc(p.title)}">
        <span>${esc(p.title)}</span></button>`; }).join('')}</div>`, conMore(list.length + ' photos'));
}
function pjPhotoOpen(n) {
  const p = ((PJ.parts.photos && PJ.parts.photos.photos) || []).find(x => x.n === +n), src = PJ.photos[PJ.pid + '_' + n];
  if (!p || !src || !src.startsWith('data:')) return;
  const box = document.createElement('div');
  box.className = 'pj-light';
  box.innerHTML = `<div><img src="${src}" alt=""><b>${esc(p.title)}</b><span>${esc([p.section !== p.title ? p.section : '', p.taken_on && conDate(p.taken_on)].filter(Boolean).join(' · '))}</span></div>`;
  box.addEventListener('click', () => box.remove());
  document.body.appendChild(box);
}

// ---------------------------------------------------------------- engineering view: the portal's analytics per tab

/** BHEL PEDM summary as the portal computes it (status buckets, submission against schedule, divisions, review ageing). */
function pjPedm(D) {
  const pm = D && D.pedm;
  if (!pm) return '';
  const B = pm.buckets || {}, C = {'Approved': '#15803d', 'With GSECL': '#d97706', 'Resubmission due (BHEL)': '#7c3aed', 'Overdue, not submitted': '#be123c', 'Not yet due': '#cbd5e1'}, A = pm.action || {};
  let h = `<div class="card"><h2>BHEL PEDM — document position ${conMore(pm.fetched ? 'read ' + conDate(pm.fetched, true) : '')}</h2><div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap">
      ${vzRing(pm.sub_pct_due || 0, {label: 'Submitted on time', sub: fmt(pm.due_sub) + ' of ' + fmt(pm.due) + ' due', tone: pjN(pm.sub_pct_due) >= 80 ? 'ok' : pjN(pm.sub_pct_due) >= 60 ? 'warn' : 'bad', size: 100, dec: 1})}
      <div style="flex:1;min-width:170px">${vzDonut(Object.keys(B).map(k => ({k, n: B[k], c: C[k]})), {label: 'documents', size: 100, stroke: 14})}</div></div></div>`;
  h += vzKpis([{k: 'With GSECL', v: fmt(B['With GSECL'] || 0), sub: fmt(pjN(A.pending_a)) + ' approval · ' + fmt(pjN(A.pending_i)) + ' info', tone: 'warn'},
    {k: 'BHEL to resubmit', v: fmt(B['Resubmission due (BHEL)'] || 0), sub: 'commented'}, {k: 'Overdue', v: fmt(B['Overdue, not submitted'] || 0), sub: 'not submitted by BHEL', tone: 'bad'},
    {k: 'RFC / MDCC', v: fmt(pjN(A.rfc)) + ' / ' + fmt(pjN(A.mdcc)), sub: 'released · despatch to clear'}], 2);
  const ga = pm.gs_age || {};
  if (Object.keys(ga).length) h += pjCard('Documents with GSECL — how long', vzCols(Object.keys(ga).map((k, i) => ({k: k + ' d', v: ga[k], c: ['#15803d', '#ca8a04', '#d97706', '#be123c'][i]}))), conMore('days pending'));
  const dv = pm.divisions || [];
  if (dv.length) h += pjCard('By BHEL division', vzStack(dv.slice(0, 14).map(x => ({k: x.name, parts: [x.appr, x.gs, x.bh, x.over, Math.max(0, x.total - x.appr - x.gs - x.bh - x.over)], label: fmt(x.total)})),
    [{k: 'Approved', c: '#15803d'}, {k: 'With GSECL', c: '#d97706'}, {k: 'With BHEL', c: '#7c3aed'}, {k: 'Overdue', c: '#be123c'}, {k: 'Not yet due', c: '#cbd5e1'}]));
  const mo = Object.keys(pm.months || {}).filter(m => m <= new Date().toISOString().slice(0, 7)).slice(-12);
  if (mo.length) h += pjCard('Scheduled submissions by month', vzStack(mo.map(m => { const o = pm.months[m] || {}; return {k: m.slice(2).replace('-', '/'), parts: [o['Approved'] || 0, o['With GSECL'] || 0, o['Resubmission due (BHEL)'] || 0, o['Overdue, not submitted'] || 0]}; }),
    [{k: 'Approved', c: '#15803d'}, {k: 'With GSECL', c: '#d97706'}, {k: 'With BHEL', c: '#7c3aed'}, {k: 'Overdue', c: '#be123c'}]), conMore('last 12 months'));
  return h;
}
/** DPR sections, foundations and the 60-day look-ahead from the portal. */
function pjSiteDash(D) {
  if (!D) return '';
  let h = '';
  const ds = D.dpr_sections || [];
  if (ds.length) h += pjCard('Progress by section (daily progress report)', vzBars(ds.map(x => ({k: x.section, v: pjN(x.pct), c: x.state === 'done' ? '#15803d' : pjN(x.pct) ? '#1d4ed8' : '#cbd5e1',
    note: esc([fmt(x.n) + ' activities', fmt(x.done) + ' done', x.not_started ? fmt(x.not_started) + ' not started' : '', x.stage].filter(Boolean).join(' · '))})), {max: 100, unit: '%'}), conMore(D.kpis && D.kpis.dpr_date ? conDate(D.kpis.dpr_date) : ''));
  const cv = (D.civil || []).filter(x => x.latest && pjN(x.latest.total_fdn));
  if (cv.length) h += pjCard('Foundations and PCC by area', vzStack(cv.sort((a, b) => pjN(b.latest.total_fdn) - pjN(a.latest.total_fdn)).map(x => ({k: x.area, parts: [pjN(x.latest.done_fdn), Math.max(0, pjN(x.latest.done_pcc) - pjN(x.latest.done_fdn)), Math.max(0, pjN(x.latest.total_fdn) - Math.max(pjN(x.latest.done_fdn), pjN(x.latest.done_pcc)))],
    label: fmt(pjN(x.latest.done_fdn)) + ' / ' + fmt(pjN(x.latest.total_fdn))})), [{k: 'Foundation cast', c: '#15803d'}, {k: 'PCC only', c: '#c98a12'}, {k: 'Not started', c: '#cbd5e1'}]), conMore(cv[0].latest.report_date ? conDate(cv[0].latest.report_date) : ''));
  const la = D.lookahead || [];
  if (la.length) h += `<details class="card pj-det" open><summary><h2 style="margin:0">Next 60 days (L2 schedule)</h2></summary><div class="pj-list" style="margin-top:10px">${la.map(x => { const c = (PJ_CAT[x.category] || ['', '#475569'])[1];
    return `<div class="pj-li"><span class="pj-d" style="background:${c}">${fmt(pjN(x.pct_complete), 0)}<small>%</small></span><span class="pj-t"><b>${esc(x.name)}</b><span>${esc((PJ_CAT[x.category] || [x.category])[0])} · ${conDate(x.start_date)} – ${conDate(x.finish_date)}</span></span></div>`; }).join('')}</div></details>`;
  return h;
}
/** Every L2 milestone with its state and variance (portal), and the contract tracker of the status report. */
function pjTabSched() {
  const D = pjD();
  if (!D) return PJ.partErr.dash ? pjCard('Not available', conEmpty(PJ.partErr.dash)) : conSpin();
  const ms = D.milestones || [], n = s => ms.filter(m => m.state === s).length, C = {achieved: '#15803d', due: '#be123c', upcoming: '#1d4ed8'};
  let h = `<div class="card"><h2>Schedule milestones (L2)</h2><div class="vz-rings">${vzRing(ms.length ? n('achieved') / ms.length * 100 : 0, {label: 'Achieved', sub: n('achieved') + ' of ' + ms.length, tone: 'ok'})}
    ${vzRing(ms.length ? n('due') / ms.length * 100 : 0, {label: 'Overdue', sub: n('due') + ' past the plan', tone: n('due') ? 'bad' : 'ok'})}${vzRing(ms.length ? n('upcoming') / ms.length * 100 : 0, {label: 'Upcoming', sub: n('upcoming') + ' ahead'})}</div></div>`;
  h += `<div class="card"><h2>Timeline ${conMore('plan · actual / variance')}</h2><div class="pj-tl">${ms.map(m => `<div style="--c:${C[m.state] || '#94a3b8'}"><b>${esc(m.name)}</b>
    <small>Plan ${conDate(m.planned)}${m.actual ? ' · done ' + conDate(m.actual) + (pjN(m.variance_days) ? ' (' + pjSigned(pjN(m.variance_days), 0) + ' d)' : '') : m.state === 'due' ? ` · <b style="color:#be123c">${fmt(pjN(m.variance_days))} days overdue</b>` : ' · in ' + fmt(pjN(m.variance_days)) + ' days'}${m.forecast ? ' · forecast ' + conDate(m.forecast) : ''}</small></div>`).join('')}</div></div>`;
  return h + pjTabMs();
}
/** Cash flow, payments, cash plan and non-EPC works from the status report (portal). */
function pjFinDash(D) {
  if (!D) return '';
  let h = '';
  const fp = D.fin_payments || [];
  if (fp.length) h += pjCard('Payments to BHEL (status report)', vzBars(fp.map(x => ({k: x.term || x.remark, v: pjN(x.amount_cr), label: '₹' + fmt(pjN(x.amount_cr), 1) + ' Cr', c: '#15803d', note: esc([x.remark, x.fy].filter(Boolean).join(' · '))}))), conMore('₹ Cr'));
  const cp = D.cash_plan || [];
  if (cp.length) h += pjCard('Cash plan and drawdown by year', vzStack(cp.map(x => ({k: x.fy, parts: [Math.min(pjN(x.actual_cr), pjN(x.planned_cr)), Math.max(0, pjN(x.planned_cr) - pjN(x.actual_cr)), Math.max(0, pjN(x.actual_cr) - pjN(x.planned_cr))], label: '₹' + fmt(pjN(x.actual_cr), 0) + ' / ' + fmt(pjN(x.planned_cr), 0)})),
    [{k: 'Drawn', c: '#15803d'}, {k: 'Planned, not drawn', c: '#cbd5e1'}, {k: 'Above plan', c: '#0891b2'}]), conMore('₹ Cr'));
  const ne = D.non_epc || [];
  if (ne.length) h += pjCard('Non-EPC works', `<div class="pj-list">${ne.map(x => `<div class="pj-li"><span class="pj-d" style="background:#0f766e">${fmt(pjN(x.budget_total_cr), 0)}<small>₹ Cr</small></span><span class="pj-t"><b>${esc(x.item)}</b><span>${esc(x.agency || '')}</span></span></div>`).join('')}</div>`);
  const sv = D.subvendors || [];
  if (sv.length) h += `<details class="card pj-det"><summary><h2 style="margin:0">Sub-vendors (${sv.length})</h2></summary><div class="pj-list" style="margin-top:10px">${sv.map(x => `<div class="pj-li"><span class="pj-d" style="background:${/order/i.test(x.order_status || '') ? '#15803d' : '#d97706'}">${/order/i.test(x.order_status || '') ? '✓' : '…'}</span>
    <span class="pj-t"><b>${esc(x.package_name)}</b><span>${esc([x.vendor, x.order_status].filter(Boolean).join(' · '))}</span></span></div>`).join('')}</div></details>`;
  return h;
}
/** Every hindrance (portal), open first. */
function pjHinDash(D) {
  const hs = (D && D.hindrances) || [];
  if (!hs.length) return '';
  return `<details class="card pj-det" open><summary><h2 style="margin:0">Hindrances (${hs.filter(x => x.status === 'Open').length} open of ${hs.length})</h2></summary><div class="pj-list" style="margin-top:10px">${hs.map(x => { const o = x.status === 'Open';
    return `<div class="pj-li"><span class="pj-d" style="background:${o ? pjAgeColor(pjN(x.days)) : '#15803d'}">${o ? (x.days !== null ? fmt(pjN(x.days)) : '…') : '✓'}<small>${o ? (x.days !== null ? 'days' : 'open') : 'closed'}</small></span>
      <span class="pj-t"><b>${esc(x.description)}</b><span>${esc([x.agency, x.from_date && 'from ' + conDate(x.from_date), x.to_date && (o ? 'target ' : 'till ') + conDate(x.to_date)].filter(Boolean).join(' · '))}${x.remarks ? ' · ' + esc(String(x.remarks).slice(0, 220)) : ''}</span></span></div>`; }).join('')}</div></details>`;
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

/** Engineering view: each tab its own summary plus the portal's analytics for it. */
function pjEngView() {
  const D = pjD();
  switch (PJ.tab) {
    case 'engg': return pjPedm(D) + (PJ.parts.engg ? pjTabEngg() : pjWait('engg'));
    case 'mdcc': return pjTabMdcc();
    case 'site': return pjSiteDash(D) + (PJ.parts.site ? pjTabSite() : pjWait('site'));
    case 'ms': return pjTabSched();
    case 'fin': return pjFinDash(D) + (PJ.parts.fin ? pjTabFin() : pjWait('fin'));
    case 'risk': return pjHinDash(D) + (PJ.parts.risk ? pjTabRisk() : pjWait('risk'));
    case 'up': return pjTabUp();
  }
  return pjTabEngg();
}
function pjRender() {
  const box = $('pjBody');
  if (!box || !$('v-projects') || !$('v-projects').classList.contains('on')) return;
  let h;
  if (typeof Connect === 'undefined') h = `<div class="card">${conEmpty('The Projects page is available after signing in to GSECL Connect.')}</div>`;
  else if (!appCan('projects')) h = `<div class="card">${conEmpty('You have not been given access to the Projects page. Access is given by the administrator on the Employees screen.')}</div>`;
  else if (!PJ.data) h = PJ.error ? pjMsg() + `<div style="text-align:center">${pjBtn('Try again', 'reload')}</div>` : conSpin();
  else {
    const projects = PJ.data.projects || [], busy = PJ.busy || PJ.partBusy.dash || (PJ.view === 'engg' && PJ.partBusy[PJ.tab]);
    h = (projects.length > 1 ? `<select class="search" id="pjPick" style="margin:0 0 8px">${projects.map(p => `<option value="${p.project_id}" ${+p.project_id === +PJ.pid ? 'selected' : ''}>${esc(p.project)}</option>`).join('')}</select>` : '')
      + `<div class="pj-mode" role="tablist"><button class="${PJ.view === 'mgmt' ? 'on' : ''}" data-pjact="view" data-pjarg="mgmt" role="tab">${pjIc('mgmt')}<span>Management<small>overview</small></span></button>
          <button class="${PJ.view === 'engg' ? 'on' : ''}" data-pjact="view" data-pjarg="engg" role="tab">${pjIc('team')}<span>Engineering<small>detailed</small></span></button></div>`
      + (PJ.view === 'engg' ? `<div class="pj-tabs" role="tablist">${PJ_TABS.map(([k, l]) => `<button class="${PJ.tab === k ? 'on' : ''}" data-pjact="tab" data-pjarg="${k}" role="tab">${pjIc(k)}${l}</button>`).join('')}</div>` : '')
      + (busy ? '<div class="sync-bar" role="progressbar" aria-label="Updating"></div>' : '')
      + (PJ.view === 'engg' && PJ.tab === 'up' ? '' : pjMsg())
      + (PJ.view === 'mgmt' ? pjMgmt() : pjEngView())
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

function pjSetView(v) {
  PJ.view = v; PJ.note = ''; PJ.error = '';
  try { localStorage.setItem('pjView', v); } catch (e) { /* not kept */ }
  pjRender(); window.scrollTo({top: 0});
  if (typeof uiEnter === 'function') uiEnter($('v-projects'));
  pjNeedParts();
}
function pjOpenTab(k) {
  if (k === 'dash' || k === 'mgmt') return pjSetView('mgmt');
  PJ.view = 'engg'; PJ.tab = k; PJ.note = ''; PJ.error = '';
  try { localStorage.setItem('pjView', 'engg'); localStorage.setItem('pjTab', k); } catch (e) { /* not kept */ }
  pjRender(); window.scrollTo({top: 0});
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
    case 'view': return pjSetView(arg);
    case 'tab': return pjOpenTab(arg);
    case 'reload': PJ.parts = {}; return pjLoad(true);
    case 'doccat': PJ.docCat = arg; PJ.keepScroll = true; return pjRender();
    case 'photo': return pjPhotoOpen(arg);
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

/** Android back button: a photo first, then back to the management overview. */
const pjPrevBack = window.appBack;
window.appBack = () => {
  const lb = document.querySelector('.pj-light'); if (lb) { lb.remove(); return true; }
  if ($('v-projects') && $('v-projects').classList.contains('on') && PJ.view !== 'mgmt') { pjSetView('mgmt'); return true; }
  return pjPrevBack ? pjPrevBack() : false;
};
