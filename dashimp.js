// Generation › Solar: import the GSECL daily generation dashboard (the PDF prepared every morning). The phone reads it
// (pdf.js, hsPdfLines of hysol.js) and sends the day's figures to the service (dashboard_import), which fills in what
// is missing: solar MU and peak MW of each site (sites not yet listed are added for administrators), hydro MU of each
// plant, and coal / lignite receipt, consumption and stock of each station. A preview is shown before anything is saved.
// Uses $, esc, fmt (app-main-2.js), conCall (connect.js), hsPdfLines, HS, soLoad, soRender, hyLoad (hysol.js).

const DI = {busy: false, data: null, err: '', over: false, file: ''};
// Solar projects in the order of the dashboard's "C5) SOLAR PROJECTS PERFORMANCE" tables (capacity and peak rows).
const DI_C5 = [['DGPS 1', 'DGPS 2', 'CHANDARVA', "R'NESDA I", "R'NESDA II", 'KHANDIA', 'HARIPAR', 'PALITANA', 'PACHHAM', 'SANES', 'CHHATTAR', 'ANIDA', 'VITTHALPUR', 'KLTPS BSS', 'PARAVADI', 'VASUNDHARA'],
  ['VASUNDHARA', 'MORA', 'BADELI', 'JAMBUDIYA VIDI', 'BABARZAR', 'LAKADIYA', 'MANJAL', 'MINI SOLAR (G+S+K)', 'CHHADVADA', 'LUNSAR', 'HASANPAR', 'KHANPAR', 'SUKHPAR', 'JUNACHAY', 'TOTAL']];
const DI_MON = {JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12};
const diKey = x => String(x || '').toUpperCase().replace(/\(WL\)|\bSOLAR\b/g, '').replace(/[^A-Z0-9]/g, '');

/** The dashboard's text lines → {date, solar: [{name, mu, peak_mw, ic}], hydro: {UKAI: MU, …}, coal: [{plant, receipt, consumption, stock}]}. */
function diParse(lines) {
  const out = {date: null, solar: [], hydro: {}, coal: []}, nums = l => (l.match(/-?\d+(?:\.\d+)?%?/g) || []);
  let sec = '', c5 = 0;
  const c5v = {};
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const d = /DAILY GENERATION \(MUS\) ON (\d{1,2})-([A-Za-z]{3})-(\d{2,4})/i.exec(l);
    if (d && !out.date) { const y = d[3].length === 2 ? '20' + d[3] : d[3], m = DI_MON[d[2].toUpperCase()]; if (m) out.date = `${y}-${String(m).padStart(2, '0')}-${d[1].padStart(2, '0')}`; }
    // C1) the day's MU of each solar site: between "TOTAL CONV." and "TOTAL SOLAR"
    if (/^TOTAL CONV/i.test(l)) { sec = 'solar'; continue; }
    if (/^TOTAL SOLAR/i.test(l)) { sec = ''; continue; }
    if (sec === 'solar') {
      if (/^MINI SOLAR$/i.test(l) && /^\d+\.\d+$/.test(lines[i + 1] || '')) { out.solar.push({name: 'MINI SOLAR (G+S+K)', mu: +lines[i + 1]}); i++; continue; }
      const m = /^([A-Za-z][\w' ().+&-]*?)\s+(\d+\.\d+)(?:\s|$)/.exec(l);
      if (m && !/^(TOTAL|CAT|MAX|DAILY|MONTHLY|YEARLY|TYPE|COAL|LIGNITE|GAS|HY|AVG)\b/i.test(m[1])) out.solar.push({name: m[1].trim(), mu: +m[2]});
      continue;
    }
    // C5) capacity and peak of each project (two tables, in the dashboard's order)
    if (/^IC \(MW\)/i.test(l)) { c5v['ic' + c5] = nums(l).map(Number); continue; }
    if (/^PEAK LOAD \(MW\)/i.test(l)) { c5v['pk' + c5] = nums(l).map(Number); c5++; continue; }
    // D) hydro: UKAI, UKAI LBC, KADANA, PANAM, (total), RBPH, CHPH, (total)
    if (/^GEN \(MUS\)/i.test(l)) { const v = nums(l).map(Number); if (v.length >= 7) out.hydro = {UKAI: v[0], 'UKAI LBC': v[1], KADANA: v[2], PANAM: v[3], RBPH: v[5], CHPH: v[6]}; continue; }
    // F) coal: receipt (ord, washed, imp, total), consumption (… total), [% blending], stock (…, total), days
    if (/^F\) COAL RECEIPT/i.test(l)) { sec = 'coal'; continue; }
    if (/^G\) LIGNITE/i.test(l)) { sec = 'lig'; continue; }
    if (/^H\)/.test(l)) sec = '';
    if (sec === 'coal') {
      const m = /^(UTPS|GTPS|WTPS|STPS)\b(?:\s*\(IMPORT\))?\s+(.*)$/i.exec(l); if (!m) continue;
      const t = nums(m[2]); if (t.length < 9) continue;
      const rest = t.slice(8).filter(x => !/%$/.test(x)), stock = [...rest].reverse().find(x => !/\./.test(x));
      out.coal.push({plant: m[1].toUpperCase(), receipt: +t[3], consumption: +t[7], stock: stock === undefined ? null : +stock});
    }
    if (sec === 'lig') {
      const m = /^(KLTPS|BLTPS)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)/i.exec(l);
      if (m) out.coal.push({plant: m[1].toUpperCase(), receipt: +m[3], consumption: +m[4], stock: +m[5]});
    }
  }
  // the capacity and peak of each site, by the dashboard's order of projects
  [0, 1].forEach(t => { const ic = c5v['ic' + t] || [], pk = c5v['pk' + t] || [];
    DI_C5[t].forEach((nm, j) => { const s = out.solar.find(x => diKey(x.name) === diKey(nm)); if (!s) return; if (isFinite(ic[j]) && !s.ic) s.ic = ic[j]; if (isFinite(pk[j]) && s.peak_mw === undefined) s.peak_mw = pk[j]; }); });
  out.coal = out.coal.filter(x => x.stock !== null);
  return out;
}

async function diRead(file) {
  DI.busy = true; DI.err = ''; DI.data = null; DI.file = file.name; soRender();
  try {
    const lines = await hsPdfLines(new Uint8Array(await file.arrayBuffer()), 12), d = diParse(lines);
    if (!d.date) throw new Error('This does not look like the GSECL daily generation dashboard (no “DAILY GENERATION (MUS) ON …” line).');
    if (!d.solar.length && !d.coal.length && !Object.keys(d.hydro).length) throw new Error('No solar, hydro or coal figures were found in the PDF.');
    DI.data = d;
  } catch (e) { DI.err = e.message || String(e); }
  DI.busy = false; soRender();
}
async function diSave() {
  if (!DI.data || DI.busy) return;
  DI.busy = true; soRender();
  const r = await conCall('dashboard_import', Object.assign({}, DI.data, {overwrite: DI.over}));
  DI.busy = false;
  if (!r.ok) { DI.err = /unknown action/i.test(r.error) ? 'The GSECL Connect script has not been updated yet: paste the new Code.gs and deploy a new version.' : r.error; return soRender(); }
  DI.data = null; DI.err = '';
  HS.msg = r.data.message; HS.msgErr = false;
  soLoad(true); if (typeof hyLoad === 'function') hyLoad(true);
}

/** The card on the Solar page (administrators and solar editors). */
function diCard() {
  const d = DI.data, tot = d ? d.solar.reduce((t, x) => t + x.mu, 0) : 0;
  let h = `<div class="card"><h2>Import the daily generation dashboard <span class="more muted" style="font-weight:500;font-size:11.5px">PDF</span></h2>
    <div class="vals" style="font-size:12.5px;margin-bottom:8px">Choose the GSECL daily generation dashboard (PDF). The solar MU and peak of every site, the hydro generation and the coal / lignite receipt, consumption and stock of the day are read and shown here before saving. Figures already entered are kept unless you choose to replace them.</div>
    <label class="btn" style="display:inline-block;margin:0;cursor:pointer;color:var(--accent)">📄 Choose dashboard PDF<input type="file" id="diFile" accept="application/pdf,.pdf" style="display:none"></label>
    ${DI.busy ? '<div class="note-src">Reading…</div>' : ''}${DI.err ? `<div class="alert err" style="margin:8px 0 0"><span>⚠</span><span>${esc(DI.err)}</span></div>` : ''}`;
  if (d) {
    h += `<div style="margin-top:10px;font-weight:700">${esc(DI.file)} · figures of ${esc(d.date.split('-').reverse().join('.'))}</div>
      ${d.solar.length ? `<div style="overflow-x:auto;margin-top:6px"><table class="dt num"><tr><th style="text-align:left">Solar site</th><th>MU</th><th>Peak MW</th><th>MW</th></tr>
        ${d.solar.map(x => `<tr><td style="text-align:left">${esc(x.name)}</td><td>${fmt(x.mu, 3)}</td><td>${fmt(x.peak_mw, 2)}</td><td>${fmt(x.ic, 2)}</td></tr>`).join('')}
        <tr style="font-weight:700"><td style="text-align:left">${d.solar.length} sites</td><td>${fmt(tot, 3)}</td><td></td><td></td></tr></table></div>` : ''}
      ${Object.keys(d.hydro).length ? `<div class="vals" style="margin-top:8px"><b>Hydro MU:</b> ${Object.entries(d.hydro).map(([k, v]) => esc(k) + ' ' + fmt(v, 2)).join(' · ')}</div>` : ''}
      ${d.coal.length ? `<div style="overflow-x:auto;margin-top:6px"><table class="dt num"><tr><th style="text-align:left">Station</th><th>Receipt MT</th><th>Consumption MT</th><th>Stock MT</th></tr>
        ${d.coal.map(x => `<tr><td style="text-align:left">${esc(x.plant)}</td><td>${fmt(x.receipt)}</td><td>${fmt(x.consumption)}</td><td>${fmt(x.stock)}</td></tr>`).join('')}</table></div>` : ''}
      <label style="display:flex;gap:8px;align-items:center;margin:10px 0 0;font-size:13px"><input type="checkbox" id="diOver" ${DI.over ? 'checked' : ''}> Replace figures already entered for this day</label>
      <div style="display:flex;gap:8px;margin-top:10px"><button class="btn" data-diact="save" style="margin:0;background:var(--accent);color:#fff;border-color:var(--accent)">${DI.busy ? 'Saving…' : 'Save these figures'}</button><button class="btn" data-diact="cancel" style="margin:0">Cancel</button></div>`;
  }
  return h + '</div>';
}
document.addEventListener('change', e => {
  if (e.target.id === 'diFile' && e.target.files && e.target.files[0]) diRead(e.target.files[0]);
  if (e.target.id === 'diOver') DI.over = e.target.checked;
});
document.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('[data-diact]'); if (!b) return;
  if (b.dataset.diact === 'save') diSave();
  else { DI.data = null; DI.err = ''; soRender(); }
});
