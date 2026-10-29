// Generation › Hydro (dam levels and hydro generation) and Generation › Solar (GSECL solar sites, daily entry), and the
// solar-only screen of an outside solar-entry sign-in (role "solar": the service allows it nothing but solar entry).
// Dam levels: the phones read the daily report of the Water Resources Department (wrd-dam.gujarat.gov.in, one PDF
// a day) with the bundled pdf.js and send the levels to the service once for everybody (dam_put).
// Uses $, esc, fmt, csvBtn, niceTicks, show() (app-main-2.js), conCall / conSaved / hasConnect (connect.js),
// appCan (coalstock.js), httpGetBytes / loadPdfJs (logic.js).

const HS = {
  hy: null, hyBusy: false, hyErr: '', hyAt: 0, hyDate: '', hyDam: 'UKAI', hyEdit: null, wrdMsg: '', wrdBusy: false,
  so: null, soBusy: false, soErr: '', soAt: 0, soDate: '', soEdit: null, siteEdit: null, msg: '', msgErr: false, saving: false,
};
const hsIso = (offset = 0) => { const d = new Date(); d.setDate(d.getDate() + offset); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const HS_MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const hsDay = iso => iso ? `${iso.slice(8, 10)} ${HS_MON[+iso.slice(5, 7) - 1]}` : '—';
const hsBtn = (label, act, arg = '', primary = false) => `<button class="btn" data-hact="${act}" data-harg="${esc(arg)}" style="${primary ? 'background:var(--accent);color:#fff;border-color:var(--accent)' : 'color:var(--accent)'}">${esc(label)}</button>`;
const hsMsg = () => HS.msg ? `<div class="alert ${HS.msgErr ? 'err' : ''}" style="margin:0 0 10px"><span>${HS.msgErr ? '⚠' : '✓'}</span><span>${esc(HS.msg)}</span></div>` : '';
const hsLabel = (label, input, hint = '') => `<label style="display:block;font-size:12px;color:var(--muted);margin-top:10px">${label}${input}${hint ? `<span style="display:block;margin-top:2px">${hint}</span>` : ''}</label>`;
const hsNum = (id, value, step = '0.001', extra = '') => `<input class="search" id="${id}" type="number" inputmode="decimal" step="${step}" min="0" value="${value === null || value === undefined ? '' : esc(value)}" style="margin:4px 0 0" ${extra}>`;
const hsVal = id => { const el = $(id); if (!el) return undefined; const s = String(el.value).trim(); return s === '' ? '' : Number(s); };

/** Bars of one value a day (last N days), touch for the value. */
function hsBars(days, key, colour, unit, label) {
  const list = days.filter(d => d[key] !== null && d[key] !== undefined);
  if (list.length < 2) return '<div class="empty">The chart appears once a few days are entered.</div>';
  const W = 340, H = 150, L = 36, R = 6, T = 10, B = 22, n = days.length, bw = (W - L - R) / n, hi = Math.max(...list.map(d => d[key])) * 1.12 || 1;
  const y = v => T + (1 - v / hi) * (H - T - B), every = Math.max(1, Math.ceil(n / 7));
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="${esc(label)}">
    ${niceTicks(0, hi, 3).map(v => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${L - 4}" y="${y(v) + 3.5}" text-anchor="end">${fmt(v, hi < 1 ? 2 : hi < 10 ? 1 : 0)}</text>`).join('')}
    ${days.map((d, i) => d[key] === null || d[key] === undefined ? '' : `<rect x="${(L + i * bw + bw * 0.15).toFixed(1)}" y="${y(d[key]).toFixed(1)}" width="${(bw * 0.7).toFixed(1)}" height="${(H - B - y(d[key])).toFixed(1)}" rx="2" style="fill:${colour}" data-tip="${esc(hsDay(d.date) + '\n' + fmt(d[key], 3) + ' ' + unit)}"/>`).join('')}
    ${days.map((d, i) => i % every && i !== n - 1 ? '' : `<text class="ax" x="${(L + i * bw + bw / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle">${hsDay(d.date)}</text>`).join('')}
  </svg></div>`;
}

// ================================================================ Hydro

async function hyLoad(force = false) {
  if (HS.hyBusy || typeof conCall !== 'function') return;
  const saved = conSaved && conSaved('hydro_data');
  if (saved && !HS.hy) HS.hy = saved.data;
  if (!force && HS.hyAt && Date.now() - HS.hyAt < 120e3) return hyRender();
  HS.hyBusy = true; hyRender();
  const r = await conCall('hydro_data', {days: 31});
  HS.hyBusy = false;
  if (r.ok) { HS.hy = r.data; HS.hyAt = Date.now(); HS.hyErr = ''; try { Connect.cacheSet('hydro_data', JSON.stringify(r.data)); } catch (e) { /* web */ } }
  else HS.hyErr = /unknown action/i.test(r.error) ? 'The GSECL Connect script has not been updated yet: paste the new Code.gs and deploy a new version.' : r.error;
  hyRender();
  hyWrdAuto();
}

// ---- the WRD daily report (Android: the phone reads it)

/** Text lines of the first pages of a PDF (pdf.js), items on the same baseline joined left to right. */
async function hsPdfLines(bytes, pages) {
  const pdfjs = await loadPdfJs(), doc = await pdfjs.getDocument({data: bytes, isEvalSupported: false, disableFontFace: true}).promise, lines = [];
  for (let p = 1; p <= Math.min(pages, doc.numPages); p++) {
    const tc = await (await doc.getPage(p)).getTextContent(), rows = [];
    for (const it of tc.items) {
      if (!it.str || !it.str.trim()) continue;
      const x = it.transform[4], y = it.transform[5];
      let r = rows.find(q => Math.abs(q.y - y) < 3);
      if (!r) rows.push(r = {y, parts: []});
      r.parts.push({x, s: it.str.trim()});
    }
    rows.sort((a, b) => b.y - a.y).forEach(r => lines.push(r.parts.sort((a, b) => a.x - b.x).map(q => q.s).join(' ').replace(/\s+/g, ' ').trim()));
  }
  return lines;
}
/** Levels of Ukai, Kadana, Panam (ft, "Gross Storage of major schemes") and Sardar Sarovar (m) from the report's lines. */
function hyParseWrd(lines) {
  const out = {date: null, dams: {}}, num = s => (s === undefined || /^UG$/i.test(s) ? null : Number(s));
  for (const l of lines) {
    const d = /Date\s*:-?\s*(\d{2})-(\d{2})-(\d{4})/.exec(l);
    if (d && !out.date) out.date = `${d[3]}-${d[2]}-${d[1]}`;
    // e.g. "36 Tapi Ukai 345 345.00 315.96 333.82 7414.29 5542.76 74.76% WARNING 0 5468 1000"
    const m = /^\d+\s+.+?\s+(Ukai|Kadana|Panam)\s+([\d.]+)\s+(UG|[\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)%\s+(.+?)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)$/i.exec(l);
    if (m) {
      const k = m[1].toUpperCase();
      if (!out.dams[k]) out.dams[k] = {frl: num(m[2]), rule: num(m[3]), level: num(m[5]), mcm: num(m[7]), pct: num(m[8]), warning: m[9].trim(), inflow: num(m[10]), out_river: num(m[11]), out_canal: num(m[12])};
    }
  }
  // Sardar Sarovar: "FRL :138.68 ... Percentage Storage : 99.56%", then "138.55 15076.00 9418.13 ..." (level m, inflow, storage, releases)
  const i = lines.findIndex(l => /Sardar Sarovar\s*\(Narmada/i.test(l));
  if (i >= 0) {
    const frl = lines.slice(i, i + 4).map(l => /FRL\s*:\s*([\d.]+).*?Percentage Storage\s*:\s*([\d.]+)%/i.exec(l)).find(Boolean);
    const v = lines.slice(i, i + 12).map(l => /^(\d{2,3}\.\d+)((?:\s+[\d.]+){6,})$/.exec(l)).find(Boolean);
    if (v) { const n = v[0].split(/\s+/).map(Number); out.dams.SSP = {level: n[0], inflow: n[1], mcm: n[2], frl: frl ? Number(frl[1]) : null, pct: frl ? Number(frl[2]) : null}; }
  }
  return out;
}
/** Reads the WRD report of a day on this phone and sends the levels to the service. */
async function hyWrdRead(iso) {
  const r = await httpGetBytes('https://wrd-dam.gujarat.gov.in/downloads/home_pdf.php?dt=' + btoa(iso), 60);
  if (!r.ok) throw new Error(r.error || 'The WRD site could not be reached');
  const bin = atob(r.body), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  if (bytes.length < 1000 || bytes[0] !== 0x25 || bytes[1] !== 0x50) throw new Error('No report for ' + hsDay(iso) + ' yet');
  const p = hyParseWrd(await hsPdfLines(bytes, 3));
  if (!Object.keys(p.dams).length) throw new Error('The report of ' + hsDay(iso) + ' could not be read');
  const s = await conCall('dam_put', {date: p.date || iso, dams: p.dams});
  if (!s.ok) throw new Error(s.error);
  return p;
}
/** Once in 3 hours on an Android phone: today's report (or yesterday's) if the service does not have it yet. */
async function hyWrdAuto(force = false) {
  if (HS.wrdBusy || window.GSECL_WEB || typeof Native === 'undefined' || !Native.fetchBytes || typeof hasConnect !== 'function' || !hasConnect()) return;   // Android only: a browser cannot read the WRD site
  let last = 0; try { last = Number(Connect.cacheGet('wrd_try') ? JSON.parse(JSON.parse(Connect.cacheGet('wrd_try')).body) : 0) || 0; } catch (e) { last = 0; }
  if (!force && Date.now() - last < 3 * 3600e3) return;
  const have = d => HS.hy && HS.hy.levels.some(l => l.date === d && l.dam === 'UKAI' && l.source !== 'manual' && l.frl);
  const want = [hsIso(0), hsIso(-1)].filter(d => !have(d));
  if (!want.length && !force) return;
  HS.wrdBusy = true; HS.wrdMsg = 'Reading the WRD dam report…'; hyRender();
  try { Connect.cacheSet('wrd_try', JSON.stringify(Date.now())); } catch (e) { /* none */ }
  let got = null, err = '';
  for (const d of (force && !want.length ? [hsIso(0)] : want)) { try { got = await hyWrdRead(d); break; } catch (e) { err = e.message || String(e); } }
  HS.wrdBusy = false;
  HS.wrdMsg = got ? 'Dam levels of ' + hsDay(got.date) + ' read from the WRD report' : 'WRD report: ' + err;
  if (got) { HS.hyAt = 0; return hyLoad(true); }
  hyRender();
}

function hyRender() {
  const box = $('hyBody');
  if (!box || !$('v-hydro').classList.contains('on')) return;
  if (!HS.hy) { box.innerHTML = HS.hyErr ? `<div class="card"><div class="empty">${esc(HS.hyErr)}</div></div>` : '<div class="sk" style="height:220px"></div>'; return; }
  const d = HS.hy, today = d.today, yday = hsIso(-1);
  const lv = (date, dam) => d.levels.find(l => l.date === date && l.dam === dam);
  const latest = dam => d.levels.filter(l => l.dam === dam).sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  const mu = (date, plant) => { const x = d.daily.find(r => r.date === date && r.plant === plant); return x ? x.mu : null; };
  let h = hsMsg() + (HS.hyErr ? `<div class="alert err" style="margin:0 0 10px"><span>⚠</span><span>${esc(HS.hyErr)}</span></div>` : '');

  // dam levels
  h += `<div class="card"><h2>Dam levels <span class="more muted" style="font-weight:500;font-size:11.5px">WRD Gujarat daily report</span></h2>
    <div style="overflow-x:auto"><table class="dt num"><tr><th>Dam</th><th>Level</th><th>FRL</th><th>Below FRL</th><th>Storage</th><th>Inflow / outflow cusecs</th><th>As on</th></tr>
    ${d.dams.map(m => { const x = latest(m.key), prev = x ? lv(new Date(new Date(x.date).getTime() - 864e5).toISOString().slice(0, 10), m.key) : null, ch = x && prev ? x.level - prev.level : null;
      return `<tr data-hact="dam" data-harg="${m.key}" style="cursor:pointer${HS.hyDam === m.key ? ';background:var(--soft)' : ''}"><td style="text-align:left"><b>${esc(m.name)}</b>${x && x.warning && !/^nil$/i.test(x.warning) ? ` <span class="badge ${/high/i.test(x.warning) ? 'b-Forced' : 'b-Planned'}">${esc(x.warning)}</span>` : ''}</td>
        <td><b>${x ? fmt(x.level, 2) : '—'}</b> ${esc(m.unit)}${ch !== null && Math.abs(ch) >= 0.005 ? `<small class="${ch >= 0 ? 'pos' : 'neg'}" style="display:block">${ch >= 0 ? '▲' : '▼'} ${fmt(Math.abs(ch), 2)}</small>` : ''}</td>
        <td>${x && x.frl ? fmt(x.frl, 2) : '—'}</td><td>${x && x.frl ? fmt(x.frl - x.level, 2) : '—'}</td><td>${x && x.pct !== undefined ? fmt(x.pct, 1) + '%' : '—'}${x && x.mcm ? `<small style="display:block">${fmt(x.mcm, 0)} MCM</small>` : ''}</td>
        <td>${x && (x.inflow !== undefined || x.out_river !== undefined) ? `${fmt(x.inflow ?? null)} / ${fmt((x.out_river || 0) + (x.out_canal || 0))}` : '—'}</td><td>${x ? hsDay(x.date) + (x.source === 'manual' ? ' ✎' : '') : '—'}</td></tr>`; }).join('')}
    </table></div>
    ${hyLevelChart(d, HS.hyDam)}
    <div class="note-src">${HS.wrdMsg ? esc(HS.wrdMsg) + ' · ' : ''}Levels in feet (Sardar Sarovar in metres) from the daily report of the Narmada, Water Resources, Water Supply and Kalpsar Department; ✎ entered by hand. Tap a dam for its trend.
      ${typeof Native !== 'undefined' && Native.fetchBytes && !window.GSECL_WEB ? ` <a data-hact="wrd" style="color:var(--accent)">${HS.wrdBusy ? 'Reading…' : 'Read the report now'}</a>` : ''}</div></div>`;

  // hydro generation
  const date = HS.hyDate || yday, groups = [['GSECL', d.plants.filter(p => p.owner === 'GSECL')], ['SSHEP', d.plants.filter(p => p.owner === 'SSHEP')]];
  const tot = l => { const v = l.map(p => mu(date, p.key)).filter(x => x !== null); return v.length ? v.reduce((t, x) => t + x, 0) : null; };
  h += `<div class="card"><h2>Hydro generation <span class="more"><input type="date" id="hy_date" value="${esc(date)}" max="${esc(today)}" style="font:inherit;font-size:12px;border:1px solid var(--line);border-radius:8px;padding:3px 6px;background:var(--card);color:var(--ink)"></span></h2>
    <div style="overflow-x:auto"><table class="dt num"><tr><th style="text-align:left">Plant</th><th>MW</th><th>Dam level</th><th>Gen ${hsDay(date)} MU</th><th>Today so far MU</th></tr>
    ${groups.map(([own, l]) => l.map(p => { const a = d.auto[p.key], x = lv(date, p.dam);
      return `<tr><td style="text-align:left">${esc(p.name)}</td><td>${fmt(p.mw)}</td><td>${x ? fmt(x.level, 2) : '—'}</td><td><b>${fmt(mu(date, p.key), 2)}</b></td><td>${a ? `${fmt(a.mu, 2)}<small style="display:block">${fmt(a.mw)} MW at ${esc(a.at)}</small>` : '—'}</td></tr>`; }).join('') +
      `<tr style="background:var(--soft)"><td style="text-align:left"><b>${own} total</b></td><td>${fmt(l.reduce((t, p) => t + p.mw, 0))}</td><td></td><td><b>${fmt(tot(l), 2)}</b></td><td>${(() => { const v = l.map(p => d.auto[p.key]).filter(Boolean); return v.length ? fmt(v.reduce((t, a) => t + a.mu, 0), 2) : '—'; })()}</td></tr>`).join('')}
    </table></div>
    <div class="note-src">Daily MU as entered (official figures); today so far from the SLDC readings kept by GSECL Connect (Ukai and Kadana HPS).</div></div>`;

  // last 31 days of GSECL hydro
  const days = Array.from({length: 31}, (_, i) => hsIso(i - 31)).map(dt => { const v = d.plants.filter(p => p.owner === 'GSECL').map(p => mu(dt, p.key)).filter(x => x !== null); return {date: dt, mu: v.length ? v.reduce((t, x) => t + x, 0) : null}; });
  const mtd = days.filter(x => x.date.slice(0, 7) === yday.slice(0, 7) && x.mu !== null).reduce((t, x) => t + x.mu, 0);
  h += `<div class="card"><h2>GSECL hydro · last 31 days <span class="more muted" style="font-weight:500;font-size:11.5px">MTD ${fmt(mtd, 2)} MU</span></h2>
    ${hsBars(days, 'mu', 'var(--hydro, #0ea5e9)', 'MU', 'GSECL hydro generation, last 31 days')}
    ${csvBtn('hyDays', 'GSECL_hydro_generation', ['Date'].concat(d.plants.map(p => p.name + ' MU'), d.dams.map(m => m.name + ' level ' + m.unit)),
      days.map(x => [x.date].concat(d.plants.map(p => mu(x.date, p.key)), d.dams.map(m => (lv(x.date, m.key) || {}).level ?? null))))}</div>`;

  // entry
  if (d.can_edit) {
    const e = HS.hyEdit || (HS.hyEdit = {date: yday});
    h += `<div class="card"><h2>Enter hydro generation</h2>
      ${hsLabel('Date', `<input class="search" id="hy_edate" type="date" value="${esc(e.date)}" max="${esc(today)}" style="margin:4px 0 0">`)}
      ${d.plants.map(p => hsLabel(`${esc(p.name)} (${p.owner}, ${fmt(p.mw)} MW) · MU`, hsNum('hy_mu_' + p.key.replace(/\W/g, '_'), mu(e.date, p.key)))).join('')}
      <details style="margin-top:10px"><summary style="font-size:13px">Dam levels by hand (when the WRD report could not be read)</summary>
        ${d.dams.map(m => hsLabel(`${esc(m.name)} level (${m.unit})`, hsNum('hy_lv_' + m.key, (lv(e.date, m.key) || {}).source === 'manual' ? lv(e.date, m.key).level : '', '0.01'))).join('')}</details>
      <div style="margin-top:12px">${hsBtn(HS.saving ? 'Saving…' : 'Save', 'hysave', '', true)}</div>
      <div class="note-src">An empty box leaves that plant unchanged; to clear a figure, save it as empty after deleting the number.</div></div>`;
  }
  box.innerHTML = h;
}

/** Level of one dam over the days kept, with its FRL. */
function hyLevelChart(d, dam) {
  const pts = d.levels.filter(l => l.dam === dam).sort((a, b) => (a.date < b.date ? -1 : 1));
  if (pts.length < 2) return '';
  const m = d.dams.find(x => x.key === dam), frl = pts.map(p => p.frl).filter(Boolean).pop();
  const W = 340, H = 140, L = 40, R = 8, T = 10, B = 22, vals = pts.map(p => p.level).concat(frl ? [frl] : []), hi = Math.max(...vals) + 0.5, lo = Math.min(...vals) - 0.5;
  const t0 = new Date(pts[0].date).getTime(), t1 = new Date(pts[pts.length - 1].date).getTime() || t0 + 1;
  const x = iso => L + (new Date(iso).getTime() - t0) / ((t1 - t0) || 1) * (W - L - R), y = v => T + (hi - v) / (hi - lo) * (H - T - B);
  return `<div class="chart" style="margin-top:8px"><svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="${esc(m.name)} level">
    ${niceTicks(lo, hi, 3).map(v => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${L - 4}" y="${y(v) + 3.5}" text-anchor="end">${fmt(v, 1)}</text>`).join('')}
    ${frl ? `<line x1="${L}" x2="${W - R}" y1="${y(frl)}" y2="${y(frl)}" style="stroke:var(--neg)" stroke-width="1" stroke-dasharray="4 3"/><text class="ax" x="${W - R}" y="${y(frl) - 3}" text-anchor="end" style="fill:var(--neg)">FRL ${fmt(frl, 2)}</text>` : ''}
    <path d="${pts.map((p, i) => (i ? 'L' : 'M') + x(p.date).toFixed(1) + ',' + y(p.level).toFixed(1)).join('')}" fill="none" style="stroke:var(--accent)" stroke-width="2.2"/>
    ${[pts[0], pts[Math.floor(pts.length / 2)], pts[pts.length - 1]].map((p, i) => `<text class="ax" x="${x(p.date).toFixed(1)}" y="${H - 6}" text-anchor="${['start', 'middle', 'end'][i]}">${hsDay(p.date)}</text>`).join('')}
  </svg></div><div class="keyline"><span><i style="width:16px;height:3px;background:var(--accent)"></i>${esc(m.name)} level ${esc(m.unit)}</span></div>`;
}

async function hySave() {
  if (HS.saving) return;
  const d = HS.hy, date = $('hy_edate').value, rows = [], levels = {};
  d.plants.forEach(p => { const v = hsVal('hy_mu_' + p.key.replace(/\W/g, '_')); const had = d.daily.some(r => r.date === date && r.plant === p.key); if (v !== '' || had) rows.push({plant: p.key, mu: v}); });
  d.dams.forEach(m => { const v = hsVal('hy_lv_' + m.key); if (v !== '' && v !== undefined) levels[m.key] = v; });
  HS.saving = true; hyRender();
  const r = await conCall('hydro_put', {date, rows, levels});
  HS.saving = false; HS.msg = r.ok ? r.data.message : r.error; HS.msgErr = !r.ok;
  if (r.ok) { HS.hyDate = date; return hyLoad(true); }
  hyRender();
}

// ================================================================ Solar

async function soLoad(force = false) {
  if (HS.soBusy || typeof conCall !== 'function') return;
  const saved = conSaved && conSaved('solar_data');
  if (saved && !HS.so) HS.so = saved.data;
  if (!force && HS.soAt && Date.now() - HS.soAt < 120e3) return soRender();
  HS.soBusy = true; soRender();
  const r = await conCall('solar_data', {days: 62});
  HS.soBusy = false;
  if (r.ok) { HS.so = r.data; HS.soAt = Date.now(); HS.soErr = ''; try { Connect.cacheSet('solar_data', JSON.stringify(r.data)); } catch (e) { /* web */ } }
  else HS.soErr = /unknown action/i.test(r.error) ? 'The GSECL Connect script has not been updated yet: paste the new Code.gs and deploy a new version.' : r.error;
  soRender();
}

function soRender() {
  const box = $('soBody');
  if (!box || !$('v-solar').classList.contains('on')) return;
  if (!HS.so) { box.innerHTML = HS.soErr ? `<div class="card"><div class="empty">${esc(HS.soErr)}</div></div>` : '<div class="sk" style="height:220px"></div>'; return; }
  const d = HS.so, yday = hsIso(-1), sites = d.sites, edit = new Set(d.edit_sites || []);
  const muOf = (date, site) => { const x = d.entries.find(e => e.date === date && e.site === site); return x ? x.mu : null; };
  const dayTot = date => { const v = d.entries.filter(e => e.date === date); return v.length ? v.reduce((t, e) => t + e.mu, 0) : null; };
  const cap = sites.filter(s => s.active).reduce((t, s) => t + s.capacity_mw, 0);
  let h = (window.SOLAR_ONLY ? soOnlyHead() : '') + hsMsg() + (HS.soErr ? `<div class="alert err" style="margin:0 0 10px"><span>⚠</span><span>${esc(HS.soErr)}</span></div>` : '');

  if (!d.outside) {
    const yT = dayTot(yday), mStart = yday.slice(0, 8) + '01', mtd = d.entries.filter(e => e.date >= mStart && e.date <= yday).reduce((t, e) => t + e.mu, 0);
    const g = d.gsecl_mu || {}, gY = g[yday] ?? null, cuf = yT !== null && cap ? yT * 1000 / (cap * 24) * 100 : null;
    h += `<div class="card"><h2>GSECL solar <span class="more muted" style="font-weight:500;font-size:11.5px">${sites.filter(s => s.active).length} sites · ${fmt(cap, 2)} MW</span></h2>
      <div class="tstats" style="grid-template-columns:repeat(2,1fr)">
        <div><span>Solar ${hsDay(yday)}</span><b class="num">${fmt(yT, 3)}</b><small>MU${cuf !== null ? ' · CUF ' + fmt(cuf, 1) + '%' : ''}</small></div>
        <div><span>Solar this month</span><b class="num">${fmt(mtd, 3)}</b><small>MU till ${hsDay(yday)}</small></div>
        <div><span>GSECL ${hsDay(yday)} (SLDC)</span><b class="num">${fmt(gY, 2)}</b><small>MU thermal, gas, hydro</small></div>
        <div><span>GSECL incl. solar</span><b class="num">${gY !== null ? fmt(gY + (yT || 0), 2) : '—'}</b><small>MU ${hsDay(yday)}</small></div>
      </div></div>`;
    const days = Array.from({length: 31}, (_, i) => hsIso(i - 31)).map(dt => ({date: dt, mu: dayTot(dt), gsecl: g[dt] ?? null}));
    h += `<div class="card"><h2>Solar generation · last 31 days</h2>${hsBars(days, 'mu', '#f59e0b', 'MU', 'GSECL solar generation, last 31 days')}
      <div style="overflow-x:auto;margin-top:8px"><table class="dt num"><tr><th>Date</th><th>Solar MU</th><th>GSECL (SLDC) MU</th><th>GSECL incl. solar MU</th></tr>
      ${[...days].reverse().slice(0, 10).map(x => `<tr><td>${hsDay(x.date)}</td><td>${fmt(x.mu, 3)}</td><td>${fmt(x.gsecl, 2)}</td><td><b>${x.gsecl !== null ? fmt(x.gsecl + (x.mu || 0), 2) : '—'}</b></td></tr>`).join('')}</table></div>
      ${csvBtn('soDays', 'GSECL_solar_generation', ['Date', 'Solar MU', 'GSECL (SLDC) MU', 'GSECL incl. solar MU'].concat(sites.map(s => s.name + ' MU')), days.map(x => [x.date, x.mu, x.gsecl, x.gsecl !== null ? +(x.gsecl + (x.mu || 0)).toFixed(3) : null].concat(sites.map(s => muOf(x.date, s.site)))))}</div>`;
  }

  // the daily generation dashboard (PDF): solar, hydro and coal figures of the day (dashimp.js)
  if (!d.outside && (edit.size || d.admin) && typeof diCard === 'function') h += diCard();
  // sites
  h += `<div class="card"><h2>${d.outside ? 'Your solar sites' : 'Solar sites'}</h2>${sites.length ? `<div style="overflow-x:auto"><table class="dt num"><tr><th style="text-align:left">Site</th><th>MW</th><th>${hsDay(yday)} MU</th><th>CUF</th><th>Month MU</th>${d.admin ? '<th></th>' : ''}</tr>
    ${sites.map(s => { const y = muOf(yday, s.site), mt = d.entries.filter(e => e.site === s.site && e.date.slice(0, 7) === yday.slice(0, 7)).reduce((t, e) => t + e.mu, 0), pk = (d.entries.find(e => e.site === s.site && e.date === yday) || {}).peak_mw;
      return `<tr style="${s.active ? '' : 'opacity:.55'}"><td style="text-align:left"><b>${esc(s.name)}</b><small style="display:block">${esc(s.site)}${s.location ? ' · ' + esc(s.location) : ''}${s.active ? '' : ' · inactive'}</small></td><td>${fmt(s.capacity_mw, 2)}</td>
        <td>${fmt(y, 3)}${pk ? `<small style="display:block">peak ${fmt(pk, 2)} MW</small>` : ''}</td><td>${y !== null && s.capacity_mw ? fmt(y * 1000 / (s.capacity_mw * 24) * 100, 1) + '%' : '—'}</td><td>${fmt(mt, 3)}</td>
        ${d.admin ? `<td>${hsBtn('Edit', 'siteedit', s.site)}</td>` : ''}</tr>`; }).join('')}</table></div>`
    : `<div class="empty">${d.outside ? 'No site has been given to this sign-in yet. Ask GSECL to add you as the entry person of your site.' : 'No solar sites yet.' + (d.admin ? ' Add the GSECL solar sites below.' : ' An administrator adds them.')}</div>`}
    <div class="note-src">CUF = MU ÷ (MW × 24 h).${d.admin ? ' Entry persons: employee numbers (GSECL staff or an outside sign-in with role “Solar entry”) who may enter that site.' : ''}</div>
    ${d.admin ? `<div style="margin-top:8px">${hsBtn('Add a site', 'siteedit', '')}</div>` : ''}</div>`;
  if (d.admin && HS.siteEdit) h += soSiteForm();

  // entry
  if (edit.size) {
    const e = HS.soEdit || (HS.soEdit = {date: d.outside ? hsIso(-1) : yday}), mine = sites.filter(s => edit.has(s.site));
    const ent = site => d.entries.find(x => x.date === e.date && x.site === site) || {};
    h += `<div class="card"><h2>Enter solar generation</h2>
      ${hsLabel('Date', `<input class="search" id="so_date" type="date" value="${esc(e.date)}" min="${esc(d.edit_from)}" max="${esc(d.today)}" style="margin:4px 0 0">`, d.outside ? `The last ${Math.round((new Date(d.today) - new Date(d.edit_from)) / 864e5)} day(s) can be entered or corrected; ask GSECL for older days.` : '')}
      ${mine.map(s => { const x = ent(s.site), k = s.site.replace(/\W/g, '_');
        return `<div style="border-top:1px solid var(--line);margin-top:12px;padding-top:4px"><b style="font-size:13px">${esc(s.name)}</b> <span class="muted" style="font-size:12px">${fmt(s.capacity_mw, 2)} MW</span>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">${hsLabel('Generation MU', hsNum('so_mu_' + k, x.mu ?? ''), `max ${fmt(s.capacity_mw * 24 / 1000, 3)}`)}${hsLabel('Peak MW (optional)', hsNum('so_pk_' + k, x.peak_mw ?? '', '0.01'))}</div>
          ${hsLabel('Remarks (optional)', `<input class="search" id="so_rm_${k}" maxlength="200" value="${esc(x.remarks || '')}" style="margin:4px 0 0">`)}</div>`; }).join('')}
      <div style="margin-top:12px">${hsBtn(HS.saving ? 'Saving…' : 'Save', 'sosave', '', true)}</div>
      <div class="note-src">1 MU = 1,000 MWh = 10 lakh units (kWh). Every entry and change is recorded with your name and time.</div></div>`;
    const past = d.entries.filter(x => edit.has(x.site)).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.site.localeCompare(b.site))).slice(0, 30);
    h += `<div class="card"><h2>Entries <span class="more muted" style="font-weight:500;font-size:11.5px">tap a day to correct</span></h2>${past.length ? `<div style="overflow-x:auto"><table class="dt num"><tr><th>Date</th><th style="text-align:left">Site</th><th>MU</th><th>Peak MW</th>${d.outside ? '' : '<th>By</th>'}</tr>
      ${past.map(x => `<tr data-hact="soday" data-harg="${x.date}" style="cursor:pointer"><td>${hsDay(x.date)}</td><td style="text-align:left">${esc((sites.find(s => s.site === x.site) || {}).name || x.site)}</td><td>${fmt(x.mu, 3)}</td><td>${fmt(x.peak_mw, 2)}</td>${d.outside ? '' : `<td>${esc(x.by || '')}</td>`}</tr>`).join('')}</table></div>` : '<div class="empty">Nothing entered yet.</div>'}</div>`;
  }
  box.innerHTML = h;
}

function soSiteForm() {
  const s = HS.siteEdit, isNew = !s.site;
  return `<div class="card" id="soSiteForm"><h2>${isNew ? 'Add a solar site' : 'Change ' + esc(s.name)}</h2>
    ${hsLabel('Site code (short, e.g. CHARANKA)', `<input class="search" id="ss_site" maxlength="20" value="${esc(s.site || '')}" ${isNew ? '' : 'readonly'} style="margin:4px 0 0;text-transform:uppercase">`)}
    ${hsLabel('Name', `<input class="search" id="ss_name" maxlength="80" value="${esc(s.name || '')}" style="margin:4px 0 0">`)}
    ${hsLabel('Location', `<input class="search" id="ss_location" maxlength="80" value="${esc(s.location || '')}" style="margin:4px 0 0">`)}
    ${hsLabel('Capacity MW (AC)', hsNum('ss_cap', s.capacity_mw ?? '', '0.01'))}
    ${hsLabel('Commissioned', `<input class="search" id="ss_comm" type="date" value="${esc(s.commissioned || '')}" style="margin:4px 0 0">`)}
    ${hsLabel('Entry persons', `<input class="search" id="ss_users" maxlength="200" value="${esc(s.entry_users || '')}" placeholder="e.g. 12345, SOL01" style="margin:4px 0 0">`, 'Employee numbers, separated by commas. For an outside agency: add them in More › Employees with role “Solar entry (outside)”, then put their number here.')}
    ${hsLabel('Order in lists', hsNum('ss_sort', s.sort ?? '', '1'))}
    <label style="display:flex;gap:8px;align-items:center;margin-top:10px;font-size:13px"><input type="checkbox" id="ss_active" ${s.active === false ? '' : 'checked'}> Active</label>
    <div style="margin-top:12px">${hsBtn(HS.saving ? 'Saving…' : 'Save site', 'sitesave', '', true)} ${hsBtn('Cancel', 'sitecancel')}</div></div>`;
}

async function soSave() {
  if (HS.saving) return;
  const d = HS.so, date = $('so_date').value, rows = [];
  d.sites.filter(s => (d.edit_sites || []).includes(s.site)).forEach(s => {
    const k = s.site.replace(/\W/g, '_'), mu = hsVal('so_mu_' + k), had = d.entries.some(x => x.date === date && x.site === s.site);
    if (mu === '' && !had) return;
    rows.push({site: s.site, mu, peak_mw: hsVal('so_pk_' + k), remarks: ($('so_rm_' + k) || {}).value || ''});
  });
  if (!rows.length) { HS.msg = 'Type the MU of at least one site.'; HS.msgErr = true; return soRender(); }
  HS.saving = true; soRender();
  const r = await conCall('solar_put', {date, rows});
  HS.saving = false; HS.msg = r.ok ? r.data.message : r.error; HS.msgErr = !r.ok;
  if (r.ok) return soLoad(true);
  soRender();
}
async function soSiteSave() {
  if (HS.saving) return;
  const fields = {site: $('ss_site').value.trim().toUpperCase(), name: $('ss_name').value.trim(), location: $('ss_location').value.trim(), capacity_mw: hsVal('ss_cap'),
    commissioned: $('ss_comm').value, entry_users: $('ss_users').value, sort: hsVal('ss_sort'), active: $('ss_active').checked};
  HS.saving = true; soRender();
  const r = await conCall('solar_site_put', {fields});
  HS.saving = false; HS.msg = r.ok ? r.data.message : r.error; HS.msgErr = !r.ok;
  if (r.ok) { HS.siteEdit = null; return soLoad(true); }
  soRender();
}

// ================================================================ outside solar-entry sign-in

/** Signed in with role "solar": only the solar entry page, no generation pages, no background reading. */
function soOnly() {
  try { return typeof Native !== 'undefined' && Native.account && JSON.parse(Native.account() || '{}').role === 'solar'; } catch (e) { return false; }
}
function soOnlyHead() {
  let name = ''; try { name = JSON.parse(Native.account() || '{}').full_name || ''; } catch (e) { name = ''; }
  return `<div class="card" style="display:flex;justify-content:space-between;align-items:center;gap:8px"><div><b>GSECL solar generation entry</b><div class="muted" style="font-size:12px">${esc(name)} · entry of your solar sites only</div></div>
    <button class="btn" data-hact="logout" style="color:var(--neg)">Sign out</button></div>`;
}
function soOnlyStart() {
  window.SOLAR_ONLY = true;
  document.body.classList.add('solaronly');
  const st = document.createElement('style');
  st.textContent = 'body.solaronly #nav,body.solaronly #genTabs,body.solaronly #alerts,body.solaronly #meBtn,body.solaronly #refreshBtn,body.solaronly .credit,body.solaronly header .grid3,body.solaronly header .stamp,body.solaronly #liveDot,body.solaronly #liveTxt{display:none!important}body.solaronly main{padding-bottom:24px}';
  document.head.appendChild(st);
  show('solar');
}

// ================================================================ wiring

document.addEventListener('click', e => {
  const el = e.target.closest('[data-hact]');
  if (!el) return;
  const a = el.dataset.hact, arg = el.dataset.harg || '';
  HS.msg = '';
  if (a === 'dam') { HS.hyDam = arg; return hyRender(); }
  if (a === 'wrd') return hyWrdAuto(true);
  if (a === 'hysave') return hySave();
  if (a === 'sosave') return soSave();
  if (a === 'soday') { HS.soEdit = {date: arg}; soRender(); setTimeout(() => $('so_date') && $('so_date').scrollIntoView({behavior: 'smooth', block: 'center'}), 60); return; }
  if (a === 'siteedit') { HS.siteEdit = arg ? Object.assign({}, HS.so.sites.find(s => s.site === arg)) : {}; soRender(); setTimeout(() => $('soSiteForm') && $('soSiteForm').scrollIntoView({behavior: 'smooth', block: 'start'}), 60); return; }
  if (a === 'sitecancel') { HS.siteEdit = null; return soRender(); }
  if (a === 'sitesave') return soSiteSave();
  if (a === 'logout') { if (typeof Native !== 'undefined' && Native.logout && confirm('Sign out on this phone?')) Native.logout(); }
});
document.addEventListener('change', e => {
  if (e.target.id === 'hy_date') { HS.hyDate = e.target.value; return hyRender(); }
  if (e.target.id === 'hy_edate') { HS.hyEdit = {date: e.target.value}; return hyRender(); }
  if (e.target.id === 'so_date') { HS.soEdit = {date: e.target.value}; return soRender(); }
});
function hyShow() { hyRender(); hyLoad(); }
function soShow() { soRender(); soLoad(); }

if (soOnly()) soOnlyStart();
else setTimeout(() => { if (typeof appCan === 'function' && appCan('generation')) conCall && hasConnect && hasConnect() && conCall('hydro_data', {days: 31}).then(r => { if (r.ok) { HS.hy = r.data; HS.hyAt = Date.now(); hyWrdAuto(); } }); }, 25000);
