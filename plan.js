// Connect › More › AOH / COH planning: planned shutdowns of every unit by financial year (Sheet tab UnitShutdowns),
// shown as a year timeline with the boiler certificate expiry of each unit, and the certificate check against the
// next planned shutdown. Uses W, wBtn, wBack, wOpen, conRender, conDate, esc, fmt, csvBtn from work.js / connect.js / index.html.

const P_TYPE_COLOR = t => /coh|capital/i.test(t) ? 'var(--forced)' : /aoh|annual/i.test(t) ? 'var(--planned)' : /r&m|renovation|retrofit/i.test(t) ? 'var(--brand2, #8e3291)' : /cert/i.test(t) ? 'var(--rsd)' : 'var(--gas, #0ea5e9)';
const pDay = s => s ? new Date(s + 'T00:00:00').getTime() : null;
const pFyNow = () => { const d = new Date(), y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1; return y + '-' + String((y + 1) % 100).padStart(2, '0'); };
const pFyRange = fy => { const y = +fy.slice(0, 4); return [new Date(y, 3, 1).getTime(), new Date(y + 1, 3, 1).getTime()]; };
const pKey = (st, u) => st + '|' + u;
const pFmt = s => s ? conDate(s) : '—';

/** Certificate check: each unit's effective boiler expiry against its next planned shutdown (from today). */
function pBoilerCheck(d) {
  const today = pDay(new Date().toISOString().slice(0, 10));
  return d.units.filter(u => u.effective_expiry && !/decommission|retired|scrapped/i.test(u.status || '')).map(u => {
    const exp = pDay(u.effective_expiry);
    const next = d.shutdowns.filter(s => s.station === u.station && s.unit === u.unit && s.planned && pDay(s.to) >= today).sort((a, b) => pDay(a.from) - pDay(b.from))[0];
    const cur = d.shutdowns.find(s => s.station === u.station && s.unit === u.unit && s.planned && pDay(s.from) <= today && pDay(s.to) >= today);
    let level, text;
    if (exp < today && cur && pDay(cur.from) <= exp + 2 * 864e5) { level = 'warn'; text = `Certificate ran out ${pFmt(u.effective_expiry)}; unit under ${cur.type} till ${pFmt(cur.to)}: renew before it returns to service`; }
    else if (exp < today) { level = 'bad'; text = `Certificate expired on ${pFmt(u.effective_expiry)}`; }
    else if (next && pDay(next.from) <= exp + 864e5) { level = 'ok'; text = `${next.type} ${pFmt(next.from)} – ${pFmt(next.to)} starts before expiry`; }
    else if (next) { level = 'warn'; text = `Expires ${pFmt(u.effective_expiry)}, ${Math.round((pDay(next.from) - exp) / 864e5)} days before the next shutdown (${next.type} from ${pFmt(next.from)}): extension needed`; }
    else { level = exp - today < 365 * 864e5 ? 'warn' : 'ok'; text = `Expires ${pFmt(u.effective_expiry)}; no shutdown planned${level === 'warn' ? ': extension or shutdown needed' : ''}`; }
    return {u, exp, level, text, days: Math.round((exp - today) / 864e5)};
  }).sort((a, b) => ({bad: 0, warn: 1, ok: 2}[a.level] - {bad: 0, warn: 1, ok: 2}[b.level]) || a.exp - b.exp);
}

function wPlan() {
  const d = W.data.plan;
  if (!d) return W.busy ? conSpin() : '';
  const fy = W.sel.pfy && d.fys.includes(W.sel.pfy) ? W.sel.pfy : d.fys.includes(pFyNow()) ? pFyNow() : d.fys[0];
  const [t0, t1] = pFyRange(fy), span = t1 - t0, today = Date.now();
  const cap = {}; d.units.forEach(u => { cap[pKey(u.station, u.unit)] = u; });
  const rows = d.shutdowns.filter(s => s.fy === fy);
  const planned = rows.filter(s => s.planned).sort((a, b) => pDay(a.from) - pDay(b.from));
  const mw = s => (cap[pKey(s.station, s.unit)] || {}).capacity_mw || 0;
  const mu = planned.reduce((t, s) => t + mw(s) * s.days * 24 / 1000, 0);
  const now = planned.filter(s => pDay(s.from) <= today && pDay(s.to) + 864e5 > today);
  const soon = planned.filter(s => pDay(s.from) > today && pDay(s.from) - today < 90 * 864e5);
  const checks = pBoilerCheck(d), warn = checks.filter(c => c.level !== 'ok');

  // timeline: one row per unit with a planned shutdown, plus boiler expiry markers in the year
  const x = t => Math.max(0, Math.min(100, (t - t0) / span * 100));
  const months = Array.from({length: 12}, (_, i) => new Date(+fy.slice(0, 4), 3 + i, 1).toLocaleDateString('en-IN', {month: 'short'}));
  const units = [...new Set(planned.map(s => pKey(s.station, s.unit)))];
  const expIn = d.units.filter(u => u.effective_expiry && pDay(u.effective_expiry) >= t0 && pDay(u.effective_expiry) < t1 && !units.includes(pKey(u.station, u.unit)) && !/decommission/i.test(u.status || ''));
  const line = (k, bars) => { const u = cap[k] || {}, e = u.effective_expiry && pDay(u.effective_expiry);
    return `<div class="pl-r"><div class="pl-n">${esc(k.replace('|', ' '))}<small>${u.capacity_mw ? fmt(u.capacity_mw) + ' MW' : ''}</small></div><div class="pl-t">
      ${bars.map(s => `<i class="pl-b" style="left:${x(pDay(s.from))}%;width:${Math.max(0.8, x(pDay(s.to) + 864e5) - x(pDay(s.from)))}%;background:${P_TYPE_COLOR(s.type)}" title="${esc(s.type)} ${pFmt(s.from)} – ${pFmt(s.to)}"></i>`).join('')}
      ${e && e >= t0 && e < t1 ? `<b class="pl-e" style="left:${x(e)}%" title="Boiler certificate valid to ${pFmt(u.effective_expiry)}">◆</b>` : ''}</div></div>`; };
  const chart = `<div class="pl"><div class="pl-r pl-h"><div class="pl-n"></div><div class="pl-t">${months.map((m, i) => `<span style="left:${i / 12 * 100}%">${m}</span>`).join('')}</div></div>
    ${units.map(k => line(k, planned.filter(s => pKey(s.station, s.unit) === k))).join('')}
    ${expIn.map(u => line(pKey(u.station, u.unit), [])).join('')}
    ${today >= t0 && today < t1 ? `<div class="pl-now" style="left:calc(var(--pln) + (100% - var(--pln)) * ${x(today) / 100})"></div>` : ''}</div>
    <div class="keyline">${[['AOH', 'AOH'], ['COH', 'COH'], ['R&M', 'R&M / retrofit'], ['cert', 'Boiler certification'], ['x', 'Other']].map(([t, l]) => `<span><i style="width:12px;height:8px;border-radius:2px;background:${P_TYPE_COLOR(t)}"></i>${l}</span>`).join('')}<span><b style="color:var(--forced)">◆</b> boiler certificate expiry</span></div>`;

  const status = s => !s.planned ? `<span class="muted">${esc(s.type || '—')}</span>` : pDay(s.to) + 864e5 <= today ? '<span class="badge b-Running">done</span>' : pDay(s.from) <= today ? '<span class="badge b-Forced">under shutdown</span>' : '<span class="badge b-Planned">planned</span>';
  const table = `<div style="overflow-x:auto"><table class="gt"><tr><th>Unit</th><th>MW</th><th>Type</th><th>From</th><th>To</th><th>Days</th><th>Status</th>${d.can_edit ? '<th></th>' : ''}</tr>
    ${rows.sort((a, b) => (a.planned ? pDay(a.from) : 9e15) - (b.planned ? pDay(b.from) : 9e15) || a.station.localeCompare(b.station)).map(s => `<tr><td>${esc(s.station + ' ' + s.unit)}${s.remarks ? `<div class="muted" style="font-size:11px;font-weight:400">${esc(s.remarks)}</div>` : ''}</td><td class="num">${fmt(mw(s))}</td>
      <td style="white-space:normal;max-width:150px">${s.planned ? `<i style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${P_TYPE_COLOR(s.type)};margin-right:4px"></i>` : ''}${esc(s.planned ? s.type : '')}</td>
      <td class="num">${s.from ? pFmt(s.from) : ''}</td><td class="num">${s.to ? pFmt(s.to) : ''}</td><td class="num">${s.days || ''}</td><td>${status(s)}</td>
      ${d.can_edit ? `<td><a data-pact="edit" data-parg="${esc(s.station + '|' + s.unit + '|' + s.fy)}" style="color:var(--accent);cursor:pointer">Edit</a></td>` : ''}</tr>`).join('')}</table></div>`;

  return `<div class="chips">${d.fys.map(f => `<button class="chip ${f === fy ? 'on' : ''}" data-pact="fy" data-parg="${f}">FY ${f}</button>`).join('')}${d.can_edit ? `<button class="chip" data-pact="add" data-parg="${fy}">+ Add plan</button>` : ''}</div>
    <div class="card"><h2>AOH / COH plan · FY ${fy}</h2>
      <div class="tstats" style="grid-template-columns:repeat(4,1fr)">
        <div><span>Shutdowns</span><b class="num">${planned.length}</b><small>${fmt(planned.reduce((t, s) => t + mw(s), 0))} MW</small></div>
        <div><span>Unit-days</span><b class="num">${fmt(planned.reduce((t, s) => t + s.days, 0))}</b><small>${fmt(mu, 0)} MU of capacity</small></div>
        <div><span>Under shutdown now</span><b class="num ${now.length ? 'neg' : ''}">${now.length}</b><small>${now.map(s => s.station + ' ' + s.unit).join(', ') || 'none'}</small></div>
        <div><span>Next 90 days</span><b class="num">${soon.length}</b><small>${soon.slice(0, 3).map(s => s.station + ' ' + s.unit).join(', ') || 'none'}</small></div></div>
      ${units.length || expIn.length ? chart : '<div class="empty">No shutdown planned in this year.</div>'}</div>
    <div class="card"><h2>Boiler certificate check <span class="more muted" style="font-weight:500;font-size:11.5px">${warn.length} need attention</span></h2>
      ${checks.map(c => `<div class="unit"><span class="sd" style="background:${c.level === 'bad' ? 'var(--forced)' : c.level === 'warn' ? 'var(--planned)' : 'var(--run)'}"></span>
        <div class="ub"><div class="un">${esc(c.u.station + ' ' + c.u.unit)} <small>${esc(c.u.boiler_no || '')}</small></div><div class="od">${esc(c.text)}</div></div>
        <div class="um num">${c.days}<small> days</small></div></div>`).join('') || conEmpty('No boiler certificates entered.')}
      <div class="note-src">Valid to = the latest of the certificate expiry and its extensions (Boiler certificates page). A certificate that runs out before the unit's next planned shutdown needs an extension.</div></div>
    <div class="card"><h2>All units · FY ${fy}</h2>${rows.length ? table : conEmpty('No plan entered for this year yet.')}
      ${csvBtn('plan' + fy, 'GSECL_AOH_COH_plan_' + fy, ['Station', 'Unit', 'MW', 'FY', 'Type', 'From', 'To', 'Days', 'Remarks', 'Boiler no.', 'Boiler valid to'],
        rows.map(s => { const u = cap[pKey(s.station, s.unit)] || {}; return [s.station, s.unit, u.capacity_mw ?? null, s.fy, s.type, s.from || '', s.to || '', s.days ?? null, s.remarks, u.boiler_no || '', u.effective_expiry || '']; }))}</div>`;
}

function pForm(arg) {
  const d = W.data.plan, [st, un, fy] = arg.split('|');
  const s = (d.shutdowns || []).find(x => x.station === st && x.unit === un && x.fy === fy) || {};
  const opts = d.units.filter(u => !/decommission/i.test(u.status || '')).map(u => [u.station + '|' + u.unit, `${u.station} ${u.unit} · ${fmt(u.capacity_mw || 0)} MW`]);
  W.form = {kind: 'editshut', title: st ? `Plan · ${st} ${un} · FY ${fy}` : `Add a plan · FY ${fy}`, ctx: {existing: !!st},
    fields: [{k: 'unitkey', label: 'Unit', type: 'select', options: opts, value: st ? st + '|' + un : opts[0]?.[0]},
      {k: 'fy', label: 'Financial year', value: fy, hint: 'Like 2028-29; the plan of that year replaces any earlier entry for the unit.'},
      {k: 'type', label: 'Type of shutdown', value: s.type || 'AOH', hint: 'AOH, COH, R&M … or “Skipped” when no shutdown is planned that year.'},
      {k: 'from', label: 'From', type: 'date', value: s.from || ''}, {k: 'to', label: 'To', type: 'date', value: s.to || ''},
      {k: 'remarks', label: 'Remarks', type: 'area', rows: 2, value: s.remarks || ''}],
    extra: st ? `<button class="btn" data-pact="del" data-parg="${esc(arg)}" style="color:var(--forced)">Delete this year's plan</button>` : ''};
  W.error = ''; W.note = ''; conRender(); window.scrollTo({top: 0});
}

document.addEventListener('click', async e => {
  const el = e.target.closest('[data-pact]');
  if (!el || !hasConnect()) return;
  const arg = el.dataset.parg || '';
  switch (el.dataset.pact) {
    case 'fy': W.sel.pfy = arg; return conRender();
    case 'add': return pForm('||' + arg);
    case 'edit': return pForm(arg);
    case 'del': {
      const [station, unit, fy] = arg.split('|');
      if (!confirm(`Delete the FY ${fy} plan of ${station} ${unit}?`)) return;
      const r = await conCall('save_shutdown', {station, unit, fy, delete: true});
      if (!r.ok) { W.error = r.error; return conRender(); }
      W.form = null; await wOpen('aohplan', true); W.note = 'Deleted'; return conRender();
    }
  }
});

(function pStyle() {
  const s = document.createElement('style');
  s.textContent = `
  .pl { --pln: 92px; position: relative; margin: 10px 0 4px; font-size: 11.5px; }
  .pl-r { display: flex; align-items: center; min-height: 24px; border-top: 1px solid var(--line); }
  .pl-h { border-top: 0; min-height: 18px; color: var(--muted); }
  .pl-n { width: var(--pln); flex: none; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding-right: 4px; }
  .pl-n small { display: block; font-weight: 400; color: var(--muted); font-size: 10px; line-height: 1; }
  .pl-t { position: relative; flex: 1; height: 22px; background: repeating-linear-gradient(90deg, transparent 0, transparent calc(100% / 12 - 1px), var(--line) calc(100% / 12 - 1px), var(--line) calc(100% / 12)); }
  .pl-h .pl-t { background: none; height: 16px; } .pl-h .pl-t span { position: absolute; top: 0; font-size: 10px; }
  .pl-b { position: absolute; top: 5px; height: 12px; border-radius: 4px; opacity: .9; }
  .pl-e { position: absolute; top: 2px; transform: translateX(-50%); color: var(--forced); font-size: 13px; line-height: 1; }
  .pl-now { position: absolute; top: 0; bottom: 0; width: 0; border-left: 1.5px dashed var(--accent); }
  @media (min-width: 760px) { .pl { --pln: 120px; } }`;
  document.head.appendChild(s);
})();
