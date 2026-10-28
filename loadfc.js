// Gujarat page: management summary (hero) and the next-day load forecast of Gujarat catered demand.
//
// Forecast, block by block (96 blocks of 15 minutes), from the daily load profiles the service keeps (LoadProfile tab,
// the same for every device) and the Open-Meteo temperature forecast for Ahmedabad, Surat, Vadodara and Rajkot:
//   1. similar days: the same weekday of the last weeks (Sundays and holidays together; Saturdays apart), median per block;
//   2. weather: + (temperature of the day − temperature of those similar days) × the MW-per-°C learnt from the history;
//   3. level: the last 3 days against their own similar days (half of the difference, at most ±8 %);
//   4. band: the errors of the same method on the last 14 days (back-test) give an 80 % range per block;
//   5. fine-tuning: every day's forecast as it stood when the day began is kept by the service (ForecastLog); against what
//      happened, the last 21 such days give an hourly correction (median actual / forecast, from 5 days, full weight
//      from 10, at most ±6 %), applied to the next forecasts. "Forecast vs actual" shows how close each day came.
// Scenario chips recompute it as a working day, a holiday, or 2 °C hotter / cooler.
// Uses $, esc, fmt, niceTicks, conCall, hasConnect, csvBtn, S, gdRows, parseRows, Native from the page.

const LF = {data: null, at: 0, busy: false, err: '', temp: null, tempAt: 0, scen: 'auto', fc: null, acc: null, accDay: '', sent: {}};
const LF_CITIES = [[23.03, 72.58, .35], [21.17, 72.83, .30], [22.31, 73.18, .20], [22.30, 70.80, .15]];   // Ahmedabad, Surat, Vadodara, Rajkot (weights)

// ---------------------------------------------------------------- calculation (no page access: tested on its own)

const lfIso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const lfAdd = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return lfIso(d); };
const lfDow = iso => new Date(iso + 'T12:00:00').getDay();
const lfMed = a => { const v = a.filter(x => x !== null && x !== undefined && isFinite(x)).sort((x, y) => x - y); if (!v.length) return null; const m = v.length >> 1; return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; };
const lfMean = a => { const v = a.filter(x => x !== null && x !== undefined && isFinite(x)); return v.length ? v.reduce((t, x) => t + x, 0) / v.length : null; };

/** 'H' Sunday or holiday, 'S' Saturday, 'W' other working days. */
function lfType(iso, hol) { return hol.has(iso) || lfDow(iso) === 0 ? 'H' : lfDow(iso) === 6 ? 'S' : 'W'; }
/** A day with most blocks read. */
const lfFull = d => d && d.c && d.c.filter(v => v !== null).length >= 80;

/**
 * Forecast of one day from the days before it. days: {iso: {c: [96]}}, hol: Set, temp: {iso: °C mean} (may be empty),
 * opt: {type (override), dT (°C added)}. Returns {fc: [96], type, sim: [iso], tT, tSim, slope, level} or null.
 */
function lfForecast(target, days, hol, temp, opt = {}) {
  const type = opt.type || lfType(target, hol), past = Object.keys(days).filter(d => d < target && lfFull(days[d])).sort().reverse();
  let sim = past.filter(d => lfType(d, hol) === type && (type !== 'W' || lfDow(d) === lfDow(target))).slice(0, 4);
  if (sim.length < 2) sim = past.filter(d => lfType(d, hol) === type).slice(0, 4);
  if (sim.length < 2 && type !== 'W') sim = past.filter(d => lfType(d, hol) !== 'W').slice(0, 4);
  if (sim.length < 2) sim = past.slice(0, 4);
  if (!sim.length) return null;
  const base = Array.from({length: 96}, (_, b) => lfMed(sim.map(d => days[d].c[b])));
  const fill = base.map((v, b) => v !== null ? v : lfMean([base[b - 1], base[b + 1]]));
  const mb = lfMean(fill);
  // MW per °C: daily mean load against daily mean temperature, working days of the history (least squares)
  let slope = 0;
  const pts = past.filter(d => lfType(d, hol) === 'W' && temp[d] !== undefined).slice(0, 60).map(d => [temp[d], lfMean(days[d].c)]);
  if (pts.length >= 8) {
    const mx = lfMean(pts.map(p => p[0])), my = lfMean(pts.map(p => p[1]));
    const sxx = pts.reduce((t, p) => t + (p[0] - mx) ** 2, 0), sxy = pts.reduce((t, p) => t + (p[0] - mx) * (p[1] - my), 0);
    if (sxx > 2) slope = Math.max(0, Math.min(800, sxy / sxx));
  }
  const tSim = lfMean(sim.map(d => temp[d])), tT = temp[target] !== undefined ? temp[target] + (opt.dT || 0) : null;
  const scale = slope && tT !== null && tSim !== null && mb ? 1 + slope * (tT - tSim) / mb : 1;
  // level of the last 3 days against their own similar days
  const ratios = past.slice(0, 3).map(d => {
    const t = lfType(d, hol), s = past.filter(x => x < d && lfType(x, hol) === t).slice(0, 4);
    const a = lfMean(days[d].c), b = s.length ? lfMean(s.map(x => lfMean(days[x].c))) : null;
    return a && b ? a / b : null;
  }).filter(Boolean);
  const r = ratios.length ? lfMean(ratios) : 1, level = Math.max(0.92, Math.min(1.08, 1 + (r - 1) / 2));
  return {fc: fill.map(v => (v === null ? null : v * scale * level)), type, sim, tT, tSim, slope, level, scale};
}

/** Back-test on the last `n` full days before `target`: {mape (%), sd: [96] (relative), n}. */
function lfBacktest(target, days, hol, temp, n = 14) {
  const tests = Object.keys(days).filter(d => d < target && lfFull(days[d])).sort().reverse().slice(0, n);
  const errs = Array.from({length: 96}, () => []), all = [];
  for (const d of tests) {
    const f = lfForecast(d, days, hol, temp);
    if (!f) continue;
    f.fc.forEach((v, b) => { const a = days[d].c[b]; if (v && a) { const e = (a - v) / v; errs[b].push(e); all.push(Math.abs(e)); } });
  }
  if (!all.length) return null;
  const pooled = Math.sqrt(lfMean(errs.flat().map(e => e * e)));
  const sd = errs.map(l => (l.length >= 4 ? Math.sqrt((lfMean(l.map(e => e * e)) * l.length + pooled * pooled * 4) / (l.length + 4)) : pooled));
  return {mape: lfMean(all) * 100, sd, n: tests.length};
}

/** Peak, low (MW and block) and energy (MU) of a 96-block profile. */
function lfStats(a) {
  let pk = null, lo = null, mwh = 0, n = 0;
  a.forEach((v, b) => { if (v === null || v === undefined) return; if (!pk || v > pk.v) pk = {v, b}; if (!lo || v < lo.v) lo = {v, b}; mwh += v / 4; n++; });
  return {pk, lo, mu: n ? mwh / 1000 * 96 / n : null};
}
const lfHm = b => `${String(Math.floor(b / 4)).padStart(2, '0')}:${String((b % 4) * 15).padStart(2, '0')}`;

// ---------------------------------------------------------------- data

async function lfLoad(force) {
  if (LF.busy || typeof conCall !== 'function' || typeof hasConnect !== 'function' || !hasConnect()) return;
  if (!force && LF.data && Date.now() - LF.at < 20 * 60e3) return;
  LF.busy = true; lfRender();
  const [r, a] = await Promise.all([conCall('load_profile', {days: 70}), conCall('forecast_get', {days: 45}), lfTemps()]);
  LF.busy = false;
  if (a && a.ok && a.data && Array.isArray(a.data.days)) LF.acc = a.data.days;
  if (r.ok) { LF.data = r.data; LF.at = Date.now(); LF.err = ''; }
  else LF.err = /unknown action/i.test(r.error) ? 'The load forecast needs the updated service script (new Code.gs).' : r.error;
  LF.fc = null; lfRender(); lfHeroRender(); lfDaysRender(); lfAccRender(); if (typeof gtRender === 'function') gtRender();
}
/** Daily mean temperature (°C, population-weighted over four cities) for the last 92 days and the next two. */
async function lfTemps() {
  if (LF.temp && Date.now() - LF.tempAt < 3 * 3600e3) return;
  const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + LF_CITIES.map(c => c[0]).join(',') + '&longitude=' + LF_CITIES.map(c => c[1]).join(',') +
    '&daily=temperature_2m_mean,temperature_2m_max&past_days=92&forecast_days=3&timezone=Asia%2FKolkata';
  try {
    const res = await httpGet(url, 40);
    if (!res.ok) return;
    const list = [].concat(JSON.parse(res.body)), t = {}, tmax = {};
    list[0].daily.time.forEach((iso, i) => {
      let s = 0, w = 0, sm = 0;
      list.forEach((l, k) => { const v = l.daily.temperature_2m_mean[i], m = l.daily.temperature_2m_max[i]; if (v !== null && v !== undefined) { s += v * LF_CITIES[k][2]; sm += (m ?? v) * LF_CITIES[k][2]; w += LF_CITIES[k][2]; } });
      if (w) { t[iso] = s / w; tmax[iso] = sm / w; }
    });
    LF.temp = t; LF.tmax = tmax; LF.tempAt = Date.now();
  } catch (e) { /* forecast without weather */ }
}

/** The forecast for tomorrow under the chosen scenario (kept until the data or scenario changes). */
function lfCompute() {
  if (!LF.data) return null;
  if (LF.fc && LF.fc.scen === LF.scen) return LF.fc;
  const days = {}, hol = new Set(LF.data.holidays || []), temp = LF.temp || {};
  LF.data.days.forEach(d => { days[d.date] = d; });
  const today = LF.data.today, tomorrow = lfAdd(today, 1);
  const opt = {auto: {}, work: {type: lfDow(tomorrow) === 6 ? 'S' : 'W'}, hol: {type: 'H'}, p2: {dT: 2}, m2: {dT: -2}}[LF.scen] || {};
  const f = lfForecast(tomorrow, days, hol, temp, opt), bt = lfBacktest(tomorrow, days, hol, temp);
  if (!f) return (LF.fc = {scen: LF.scen, none: true});
  const tune = lfTuneFactors();
  f.raw = f.fc.slice();
  if (tune) { f.fc = f.fc.map((v, b) => (v === null ? null : v * tune.f[Math.floor(b / 4)])); f.tune = tune; }
  const z = 1.28, band = f.fc.map((v, b) => (v === null || !bt ? null : [v * (1 - z * bt.sd[b]), v * (1 + z * bt.sd[b])]));
  LF.fc = {scen: LF.scen, tomorrow, today, f, bt, band, days, hol, autoType: lfType(tomorrow, hol)};
  if (LF.scen === 'auto') lfIssue(LF.fc);
  return LF.fc;
}

/** Tomorrow's forecast (Auto) sent to the service, which keeps the last one sent before the day begins. */
function lfIssue(fc) {
  if (typeof conCall !== 'function' || typeof hasConnect !== 'function' || !hasConnect()) return;
  const sig = fc.tomorrow + '|' + fc.f.fc.map(v => (v === null ? '' : Math.round(v))).join(',');
  if (LF.sent[fc.tomorrow] === sig) return;
  LF.sent[fc.tomorrow] = sig;
  const r = a => a.map(v => (v === null || v === undefined || !isFinite(v) ? null : Math.round(v)));
  conCall('forecast_put', {date: fc.tomorrow, fc: r(fc.f.fc), raw: r(fc.f.raw), lo: r(fc.band.map(b => (b ? b[0] : null))), hi: r(fc.band.map(b => (b ? b[1] : null))),
    type: fc.f.type, temp: fc.f.tT, tune: fc.f.tune ? fc.f.tune.f : null}).catch(() => {});
}

// ---------------------------------------------------------------- forecast against what happened, and the fine-tuning it gives

/** Issued forecasts with the actual day: [{date, fc, lo, hi, raw, a (actual 96), full, n (blocks), mape, bias, pkF, pkA, muF, muA, inBand}] */
function lfAccRows() {
  if (!LF.acc || !LF.data) return [];
  const act = {}; LF.data.days.forEach(d => { act[d.date] = d; });
  return LF.acc.map(x => {
    const a = act[x.date] && act[x.date].c; if (!a || !x.fc) return null;
    const blocks = x.fc.map((p, b) => [p, a[b], b]).filter(([p, v]) => p && v);
    if (blocks.length < 8) return null;
    const mape = lfMean(blocks.map(([p, v]) => Math.abs(v - p) / v)) * 100, bias = lfMean(blocks.map(([p, v]) => (p - v) / v)) * 100;
    const sF = lfStats(x.fc), sA = lfStats(a), full = lfFull(act[x.date]);
    const inBand = x.lo && x.hi ? blocks.filter(([, v, b]) => x.lo[b] !== null && x.hi[b] !== null && v >= x.lo[b] && v <= x.hi[b]).length / blocks.length * 100 : null;
    const mx = blocks.reduce((m, [p, v, b]) => (!m || Math.abs(v - p) > m.e ? {e: Math.abs(v - p), b, p, v} : m), null);
    return Object.assign({}, x, {a, full, n: blocks.length, mape, bias, pkF: sF.pk, pkA: sA.pk, muF: sF.mu, muA: full ? sA.mu : null, inBand, mx});
  }).filter(Boolean);
}
/** Hourly correction from the last 21 full days: median actual / untuned forecast per hour, weighted in from 5 days, ±6 % at most. */
function lfTuneFactors() {
  const rows = lfAccRows().filter(r => r.full).slice(-21);
  if (rows.length < 5) return null;
  const w = Math.min(1, rows.length / 10);
  const f = Array.from({length: 24}, (_, h) => {
    const r = []; rows.forEach(x => { const base = x.raw || x.fc; for (let b = h * 4; b < h * 4 + 4; b++) if (base[b] && x.a[b]) r.push(x.a[b] / base[b]); });
    const m = lfMed(r); return m ? Math.max(0.94, Math.min(1.06, 1 + (m - 1) * w)) : 1;
  });
  const sm = f.map((v, h) => lfMean([f[(h + 23) % 24], v, v, f[(h + 1) % 24]]));
  return {f: sm, n: rows.length, avg: (lfMean(sm) - 1) * 100};
}
const lfDm = iso => new Date(iso + 'T12:00:00').toLocaleDateString('en-IN', {day: '2-digit', month: 'short'});
/** The "Forecast vs actual" card (markup shared by both apps). */
function lfAccHtml() {
  const rows = lfAccRows();
  const head = `<h2>Forecast vs actual · Gujarat catered</h2>`;
  if (!LF.acc) return head + `<div class="empty">${LF.busy ? 'Reading…' : 'The issued forecasts are kept from now on (they need the updated service script); the comparison appears after the first forecast day has passed.'}</div>`;
  if (!rows.length) return head + `<div class="empty">The first issued forecast is compared once its day has begun (${LF.acc.length ? 'next: ' + lfDm(LF.acc[LF.acc.length - 1].date) : 'none kept yet'}).</div>`;
  const full = rows.filter(r => r.full), last = full.slice(-30);
  const day = rows.find(r => r.date === LF.accDay) || rows[rows.length - 1];
  const avg = k => lfMean(last.map(r => r[k]).filter(v => v !== null && v !== undefined && isFinite(v)));
  const pkE = lfMean(last.filter(r => r.pkF && r.pkA).map(r => Math.abs(r.pkF.v - r.pkA.v) / r.pkA.v * 100));
  const enE = lfMean(last.filter(r => r.muA).map(r => Math.abs(r.muF - r.muA) / r.muA * 100));
  const tune = lfTuneFactors(), hm = lfHm, f1 = v => (v === null || v === undefined || !isFinite(v) ? '—' : fmt(v, 1));
  // the chosen day: forecast, band and actual
  const W = 340, H = 190, L = 40, R = 8, T = 10, B = 20;
  const vals = day.fc.concat(day.a, day.lo || [], day.hi || []).filter(v => v !== null && v !== undefined && isFinite(v));
  const hi = Math.max(...vals) * 1.03, lo = Math.min(...vals) * 0.97, x = b => L + b / 95 * (W - L - R), y = v => T + (hi - v) / ((hi - lo) || 1) * (H - T - B);
  const path = a => { let d = '', pen = false; (a || []).forEach((v, b) => { if (v === null || v === undefined) { pen = false; return; } d += (pen ? 'L' : 'M') + x(b).toFixed(1) + ',' + y(v).toFixed(1); pen = true; }); return d; };
  const band = day.lo && day.hi ? 'M' + day.hi.map((v, b) => (v === null ? null : x(b).toFixed(1) + ',' + y(v).toFixed(1))).filter(Boolean).join('L') + 'L' + day.lo.map((v, b) => (v === null ? null : x(b).toFixed(1) + ',' + y(v).toFixed(1))).filter(Boolean).reverse().join('L') + 'Z' : '';
  const tips = day.fc.map((p, b) => (b % 2 ? '' : `<rect x="${(x(b) - 1.8).toFixed(1)}" y="${T}" width="3.6" height="${H - T - B}" fill="transparent" data-tip="${esc(`${lfDm(day.date)} ${hm(b)}
Forecast ${p ? fmt(p) : '—'} MW · actual ${day.a[b] ? fmt(day.a[b]) : '—'} MW${p && day.a[b] ? `
Error ${(p - day.a[b] >= 0 ? '+' : '−') + fmt(Math.abs(p - day.a[b]))} MW (${fmt(Math.abs(p - day.a[b]) / day.a[b] * 100, 1)}%)` : ''}`)}"><title>${hm(b)}</title></rect>`)).join('');
  const chart = `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Forecast and actual">
    ${niceTicks(lo, hi, 4).map(v => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${L - 4}" y="${y(v) + 3.5}" text-anchor="end">${fmt(v / 1000, 1)}k</text>`).join('')}
    ${[0, 24, 48, 72, 95].map((b, i) => `<text class="ax" x="${x(b)}" y="${H - 5}" text-anchor="${i === 0 ? 'start' : i === 4 ? 'end' : 'middle'}">${b === 95 ? '24:00' : hm(b)}</text>`).join('')}
    ${band ? `<path d="${band}" style="fill:var(--accent,var(--teal));opacity:.15"/>` : ''}
    <path d="${path(day.fc)}" fill="none" style="stroke:var(--accent,var(--teal))" stroke-width="2.4" stroke-dasharray="6 3"/>
    <path d="${path(day.a)}" fill="none" style="stroke:var(--brand2,var(--navy2))" stroke-width="2.4"/>${tips}</svg></div>`;
  // error per day (bars)
  const bw = (W - L - R) / Math.max(last.length, 1), mx = Math.max(6, ...last.map(r => r.mape)) * 1.1, yb = v => T + (mx - v) / mx * (120 - T - B);
  const bars = last.length ? `<div class="chart"><svg viewBox="0 0 ${W} 120">${[0, mx / 2, mx].map(v => `<line class="grid" x1="${L}" x2="${W - R}" y1="${yb(v)}" y2="${yb(v)}"/><text class="ax" x="${L - 4}" y="${yb(v) + 3.5}" text-anchor="end">${fmt(v, 0)}%</text>`).join('')}
    ${last.map((r, i) => `<rect x="${(L + bw * i + bw * .15).toFixed(1)}" y="${yb(r.mape).toFixed(1)}" width="${(bw * .7).toFixed(1)}" height="${(120 - B - yb(r.mape)).toFixed(1)}" rx="2" style="fill:${r.mape < 3 ? '#059669' : r.mape < 5 ? '#f59e0b' : '#e11d48'};cursor:pointer" data-lfacc="${r.date}" data-tip="${esc(`${lfDm(r.date)}: average error ${fmt(r.mape, 1)}%
Peak ${r.pkF ? fmt(r.pkF.v) : '—'} forecast · ${r.pkA ? fmt(r.pkA.v) : '—'} actual MW`)}"><title>${lfDm(r.date)} ${fmt(r.mape, 1)}%</title></rect>`).join('')}
    <text class="ax" x="${L}" y="${120 - 5}">${lfDm(last[0].date)}</text><text class="ax" x="${W - R}" y="${120 - 5}" text-anchor="end">${lfDm(last[last.length - 1].date)}</text></svg></div>` : '';
  const k = (l, v, sub) => `<div class="kpi"><span>${l}</span><b class="num">${v}</b><small style="white-space:normal;overflow-wrap:anywhere">${sub}</small></div>`;
  const pe = day.pkF && day.pkA ? day.pkF.v - day.pkA.v : null, te = day.pkF && day.pkA ? (day.pkF.b - day.pkA.b) * 15 : null;
  return head + `<div class="tstats kpis four" style="grid-template-columns:repeat(4,1fr)">
      ${k('Average error', last.length ? f1(avg('mape')) + '%' : '—', `per block · ${last.length} day${last.length === 1 ? '' : 's'}`)}
      ${k('Bias', last.length ? (avg('bias') >= 0 ? '+' : '−') + f1(Math.abs(avg('bias'))) + '%' : '—', avg('bias') >= 0 ? 'forecast above actual' : 'forecast below actual')}
      ${k('Peak error', pkE ? f1(pkE) + '%' : '—', 'average, MW')}
      ${k('Within 80 % range', avg('inBand') !== null ? fmt(avg('inBand'), 0) + '%' : '—', `of blocks · energy error ${enE ? f1(enE) + '%' : '—'}`)}</div>
    ${bars ? `<div class="note-src note" style="margin:6px 0 0">Average error each day (tap a bar): green under 3 %, amber 3–5 %, red above 5 %.</div>${bars}` : ''}
    <div class="chips" style="margin-top:8px">${rows.slice(-10).map(r => `<button class="chip ${r.date === day.date ? 'on' : ''}" data-lfacc="${r.date}">${lfDm(r.date)}${r.full ? '' : ' (today)'}</button>`).join('')}</div>
    <div class="vals" style="margin:4px 0"><b>${esc(new Date(day.date + 'T12:00:00').toLocaleDateString('en-IN', {weekday: 'long', day: '2-digit', month: 'short'}))}</b>${day.full ? '' : ' · actual so far'} · forecast issued ${esc(String(day.made_at || '').slice(0, 16))}</div>
    ${chart}
    <div class="keyline key"><span><i style="width:16px;height:0;border-top:2px dashed var(--accent,var(--teal))"></i>Forecast (day-ahead)</span><span><i style="width:16px;height:3px;background:var(--brand2,var(--navy2))"></i>Actual</span><span><i style="width:16px;height:8px;background:var(--accent,var(--teal));opacity:.3"></i>80 % range</span></div>
    <div class="tstats kpis four" style="grid-template-columns:repeat(4,1fr)">
      ${k('Average error', f1(day.mape) + '%', `bias ${(day.bias >= 0 ? '+' : '−') + f1(Math.abs(day.bias))}%`)}
      ${k('Peak', day.pkA ? fmt(day.pkA.v) : '—', `actual at ${day.pkA ? hm(day.pkA.b) : '—'} · forecast ${day.pkF ? fmt(day.pkF.v) : '—'}${pe !== null ? ` (${pe >= 0 ? '+' : '−'}${fmt(Math.abs(pe))})` : ''}`)}
      ${k('Peak time', te === null ? '—' : (te === 0 ? 'on time' : (te > 0 ? '+' : '−') + fmt(Math.abs(te)) + ' min'), `forecast ${day.pkF ? hm(day.pkF.b) : '—'}`)}
      ${k('Energy', day.muA ? fmt(day.muA, 1) + ' MU' : '—', `forecast ${fmt(day.muF, 1)} MU${day.muA ? ` (${(day.muF - day.muA >= 0 ? '+' : '−') + f1(Math.abs(day.muF - day.muA) / day.muA * 100)}%)` : ''}`)}</div>
    <div class="note-src note">Largest miss ${day.mx ? `${fmt(day.mx.e)} MW at ${hm(day.mx.b)}` : '—'}${day.inBand !== null ? ` · ${fmt(day.inBand, 0)}% of blocks inside the 80 % range` : ''}.
      ${tune ? `Fine-tuning now in use: hourly correction from the last ${tune.n} days, on average ${tune.avg >= 0 ? '+' : '−'}${f1(Math.abs(tune.avg))}% (largest ${(Math.max(...tune.f.map(v => Math.abs(v - 1))) * 100).toFixed(1)}%).` : `Fine-tuning starts after 5 complete forecast days (${full.length} so far).`}
      The forecast compared is the one kept when the day began (sent by the phones the day before).</div>
    ${typeof csvBtn === 'function' ? csvBtn('lfAcc', 'Gujarat_forecast_vs_actual', ['Date', 'Average error %', 'Bias %', 'Peak forecast MW', 'Peak actual MW', 'Peak forecast time', 'Peak actual time', 'Energy forecast MU', 'Energy actual MU', 'Within 80% range %'],
      rows.map(r => [r.date, r.mape.toFixed(2), r.bias.toFixed(2), r.pkF ? Math.round(r.pkF.v) : '', r.pkA ? Math.round(r.pkA.v) : '', r.pkF ? hm(r.pkF.b) : '', r.pkA ? hm(r.pkA.b) : '', r.muF ? r.muF.toFixed(2) : '', r.muA ? r.muA.toFixed(2) : '', r.inBand === null ? '' : r.inBand.toFixed(0)])) : ''}`;
}
/** The card under the forecast (Gujarat tab). */
function lfAccRender() { const box = $('loadAcc'); if (box) box.innerHTML = lfAccHtml(); }

// ---------------------------------------------------------------- Gujarat summary (management view)

function lfTodayRows() {
  const now = new Date(), t0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const local = typeof hasNative === 'function' && hasNative('historyRead') ? parseRows(Native.historyRead(String(t0 - 864e5))) : [];
  const src = typeof gdRows === 'function' ? gdRows(local, t0) : {rows: local};
  const day = (k, off) => src.rows.filter(r => r[0] >= t0 - off && r[0] < t0 - off + 864e5 && r[k] !== null && r[k] !== undefined).map(r => ({m: (r[0] - t0 + off) / 60e3, v: r[k], t: r[0]}));
  return {t0, cat: day(2, 0), catY: day(2, 864e5), sol: day(6, 0), win: day(7, 0), gse: day(3, 0)};
}
const lfEnergy = pts => { let mwh = 0; for (let i = 1; i < pts.length; i++) { const dt = pts[i].m - pts[i - 1].m; if (dt > 0 && dt <= 30) mwh += (pts[i].v + pts[i - 1].v) / 2 * dt / 60; } return mwh / 1000; };

function lfHeroRender() {
  const box = $('gujHero');
  if (!box) return;
  const h = S.home, m = h?.ok ? h.mix || {} : {}, cat = h?.ok ? h.catered?.value ?? null : null, f = h?.ok ? h.freq?.value ?? null : null;
  const total = m.total ?? null, imp = cat !== null && total !== null ? cat - total : null, re = (m.solar || 0) + (m.wind || 0);
  const T = lfTodayRows(), nowM = (Date.now() - T.t0) / 60e3;
  const {pk, lo} = blockStat(T.cat);   // 15-minute block averages
  const eT = lfEnergy(T.cat), eY = lfEnergy(T.catY.filter(p => p.m <= nowM)), ch = eY ? (eT - eY) / eY * 100 : null;
  const hm = mm => `${String(Math.floor(mm / 60)).padStart(2, '0')}:${String(Math.floor(mm % 60)).padStart(2, '0')}`;
  const fc = lfCompute(), fs = fc && !fc.none ? lfStats(fc.f.fc) : null;
  const k = (l, v, s, cls = '') => `<div class="dkpi"><span>${l}</span><b class="num ${cls}">${v}</b><small>${s}</small></div>`;
  box.className = 'dhero';
  box.innerHTML = `<div class="t" style="display:flex;justify-content:space-between;gap:8px"><span>Gujarat power position · live</span><span style="opacity:.75;font-weight:600;letter-spacing:.02em;text-transform:none">${esc(h?.time || '')}</span></div>
    <div class="v num" style="margin-top:8px">${cat === null ? '—' : fmt(cat)}<small style="font-size:14px;font-weight:600;opacity:.8">MW catered</small>${f !== null ? `<span class="dpill ${f < 49.9 || f > 50.05 ? 'r' : 'p'}">${fmt(f, 2)} Hz</span>` : ''}</div>
    <div class="dkpis" style="grid-template-columns:repeat(3,1fr)">
      ${k('Gujarat generation', total === null ? '—' : fmt(total), 'MW incl. RE')}
      ${k(imp !== null && imp < 0 ? 'Net export' : 'Net import', imp === null ? '—' : fmt(Math.abs(imp)), 'MW (catered − generation)')}
      ${k('RE share now', cat ? fmt(re / cat * 100, 1) + '%' : '—', `solar ${fmt(m.solar || 0)} · wind ${fmt(m.wind || 0)} MW`)}
      ${k('GSECL share now', cat && m.gsecl ? fmt(m.gsecl / cat * 100, 1) + '%' : '—', `${fmt(m.gsecl || 0)} MW of catered`)}
      ${k('Peak today (15-min block)', pk ? fmt(pk.v) : '—', pk ? 'MW in ' + pk.lbl + (lo ? ` · low ${fmt(lo.v)} in ${lo.lbl}` : '') : 'no readings yet')}
      ${k('Energy today', T.cat.length > 1 ? fmt(eT, 1) + ' MU' : '—', ch === null ? 'catered so far' : `${ch >= 0 ? '+' : '−'}${fmt(Math.abs(ch), 1)}% vs yesterday same time`, ch === null ? '' : ch >= 0 ? 'pos' : 'neg')}
      ${k('Tomorrow peak (forecast)', fs && fs.pk ? fmt(fs.pk.v) : '—', fs && fs.pk ? `MW at ${lfHm(fs.pk.b)} · ${fmt(fs.mu, 0)} MU` : 'see the forecast below')}
      ${k('Solar today', T.sol.length > 1 ? fmt(lfEnergy(T.sol), 1) + ' MU' : '—', 'Gujarat, so far')}
      ${k('Wind today', T.win.length > 1 ? fmt(lfEnergy(T.win), 1) + ' MU' : '—', 'Gujarat, so far')}
    </div>
    <div class="lfg">${lfTodayChart(T, pk)}${lfDonut(m, cat)}</div>`;
}

/** Today's catered (with solar and wind shaded under it) against yesterday, 00:00–24:00, white on the hero. */
function lfTodayChart(T, pk) {
  if (T.cat.length < 2 && T.catY.length < 2) return '';
  const W = 330, H = 150, L = 34, R = 6, Tp = 8, B = 18, all = T.cat.concat(T.catY).map(p => p.v);
  const hi = Math.max(...all) * 1.05, lo = 0;
  const x = m => L + m / 1440 * (W - L - R), y = v => Tp + (hi - v) / (hi - lo) * (H - Tp - B);
  const line = l => { let d = '', prev = null; l.forEach(p => { d += (prev !== null && p.m - prev <= 30 ? 'L' : 'M') + x(p.m).toFixed(1) + ',' + y(p.v).toFixed(1); prev = p.m; }); return d; };
  // solar + wind stacked as an area (readings at the same moments as catered)
  const re = T.sol.map(p => { const w = T.win.find(q => Math.abs(q.m - p.m) < 3); return {m: p.m, v: p.v + (w ? w.v : 0)}; });
  const area = re.length > 1 ? 'M' + x(re[0].m) + ',' + y(0) + re.map(p => 'L' + x(p.m).toFixed(1) + ',' + y(p.v).toFixed(1)).join('') + 'L' + x(re[re.length - 1].m) + ',' + y(0) + 'Z' : '';
  const nowM = (Date.now() - T.t0) / 60e3;
  return `<div class="lfg-c"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Gujarat catered today and yesterday">
    ${[0, hi / 2, hi].map(v => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="#fff" stroke-opacity=".15"/><text x="${L - 4}" y="${y(v) + 3.5}" text-anchor="end" fill="#fff" fill-opacity=".7" font-size="9">${fmt(v / 1000, 0)}k</text>`).join('')}
    ${[0, 6, 12, 18, 24].map((h, i) => `<text x="${x(h * 60)}" y="${H - 4}" text-anchor="${i === 0 ? 'start' : i === 4 ? 'end' : 'middle'}" fill="#fff" fill-opacity=".7" font-size="9">${String(h).padStart(2, '0')}:00</text>`).join('')}
    ${area ? `<path d="${area}" fill="#f59e0b" fill-opacity=".35"/>` : ''}
    <path d="${line(T.catY)}" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="1.4" stroke-dasharray="4 3"/>
    <path d="${line(T.cat)}" fill="none" stroke="#fde68a" stroke-width="2.4" stroke-linejoin="round"/>
    ${pk ? `<circle cx="${x(pk.m)}" cy="${y(pk.v)}" r="3.5" fill="#fde68a"/><text x="${Math.min(x(pk.m) + 5, W - 60)}" y="${y(pk.v) - 5}" fill="#fde68a" font-size="9.5" font-weight="700">peak ${fmt(pk.v)}</text>` : ''}
    <line x1="${x(nowM)}" x2="${x(nowM)}" y1="${Tp}" y2="${H - B}" stroke="#fff" stroke-opacity=".4" stroke-dasharray="2 2"/>
  </svg><div class="lfg-k"><span><i style="background:#fde68a"></i>Catered today</span><span><i style="background:#fff;opacity:.6"></i>Yesterday</span><span><i style="background:#f59e0b"></i>Solar + wind</span></div></div>`;
}

/** Generation mix now as a donut, with the share of each source. */
function lfDonut(m, cat) {
  const parts = (typeof GUJ_PARTS !== 'undefined' ? GUJ_PARTS : []).map(([k, l, c]) => [l, Math.max(0, k === 'other' ? (m.total || 0) - GUJ_PARTS.slice(0, 6).reduce((t, [q]) => t + Math.max(m[q] || 0, 0), 0) : m[k] || 0), c]).filter(p => p[1] > 0);
  const tot = parts.reduce((t, p) => t + p[1], 0);
  if (!tot) return '';
  const R = 46, C = 2 * Math.PI * R; let off = 0;
  const arcs = parts.map(([l, v, c]) => { const len = v / tot * C, a = `<circle cx="60" cy="60" r="${R}" fill="none" stroke="${c}" stroke-width="18" stroke-dasharray="${len.toFixed(1)} ${(C - len).toFixed(1)}" stroke-dashoffset="${(-off).toFixed(1)}" transform="rotate(-90 60 60)"/>`; off += len; return a; }).join('');
  return `<div class="lfg-d"><svg viewBox="0 0 120 120" role="img" aria-label="Gujarat generation mix">${arcs}
      <text x="60" y="57" text-anchor="middle" fill="#fff" font-size="15" font-weight="800">${fmt(tot / 1000, 1)}k</text><text x="60" y="72" text-anchor="middle" fill="#fff" fill-opacity=".75" font-size="8.5">MW generated</text></svg>
    <div class="lfg-l">${parts.map(([l, v, c]) => `<span><i style="background:${c}"></i>${esc(l)} <b>${fmt(v / tot * 100, 0)}%</b></span>`).join('')}</div></div>`;
}

// ---------------------------------------------------------------- last 14 days: daily peak, energy and RE share

function lfDaysRender() {
  const box = $('gujDays');
  if (!box) return;
  const head = '<h2>Gujarat demand · last 14 days <span class="more muted" style="font-weight:500;font-size:11.5px">peak, energy, RE share</span></h2>';
  if (!LF.data) { box.innerHTML = head + (LF.busy ? '<div class="sk" style="height:200px"></div>' : `<div class="empty">${esc(LF.err || 'Loading the daily profiles…')}</div>`); return; }
  const hol = new Set(LF.data.holidays || []), today = LF.data.today;
  const list = LF.data.days.filter(d => d.date < today && d.date >= lfAdd(today, -14) && d.c.filter(v => v !== null).length >= 80).map(d => {
    const st = lfStats(d.c), sol = lfStats(d.s || []).mu || 0, win = lfStats(d.w || []).mu || 0;
    return {date: d.date, type: lfType(d.date, hol), pk: st.pk, mu: st.mu, re: st.mu ? (sol + win) / st.mu * 100 : null, sol, win};
  });
  if (!list.length) { box.innerHTML = head + '<div class="empty">No complete days yet.</div>'; return; }
  const W = Math.max(box.clientWidth || 320, 260), H = 210, L = 40, R = 40, T = 12, B = 30, n = list.length, bw = (W - L - R) / n;
  const pmax = Math.max(...list.map(d => d.pk.v)) * 1.05, pmin = Math.min(...list.map(d => d.pk.v)) * 0.9;
  const emax = Math.max(...list.map(d => d.mu)) * 1.05, emin = Math.min(...list.map(d => d.mu)) * 0.9;
  const y = v => T + (pmax - v) / (pmax - pmin) * (H - T - B), ye = v => T + (emax - v) / (emax - emin) * (H - T - B), xc = i => L + bw * (i + 0.5);
  const best = list.reduce((b, d) => (d.pk.v > b.pk.v ? d : b));
  const dl = iso => iso.slice(8) + '/' + iso.slice(5, 7), wd = iso => ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'][lfDow(iso)];
  box.innerHTML = head + `<div class="tstats" style="grid-template-columns:repeat(3,1fr)">
      <div><span>Highest peak</span><b class="num">${fmt(best.pk.v)}</b><small>MW on ${dl(best.date)} at ${lfHm(best.pk.b)}</small></div>
      <div><span>Average energy</span><b class="num">${fmt(list.reduce((t, d) => t + d.mu, 0) / n, 1)}</b><small>MU a day</small></div>
      <div><span>RE share</span><b class="num">${fmt(list.reduce((t, d) => t + (d.re || 0), 0) / n, 1)}%</b><small>of energy, average</small></div></div>
    <div class="chart"><svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="Gujarat daily peak and energy, last 14 days">
      ${niceTicks(pmin, pmax, 4).map(v => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${L - 4}" y="${y(v) + 3.5}" text-anchor="end">${fmt(v / 1000, 1)}k</text>`).join('')}
      ${niceTicks(emin, emax, 4).map(v => `<text class="ax" x="${W - R + 4}" y="${ye(v) + 3.5}">${fmt(v, 0)}</text>`).join('')}
      ${list.map((d, i) => `<rect x="${(xc(i) - bw * 0.32).toFixed(1)}" y="${y(d.pk.v).toFixed(1)}" width="${(bw * 0.64).toFixed(1)}" height="${(H - B - y(d.pk.v)).toFixed(1)}" rx="3" style="fill:${d.type === 'W' ? 'var(--accent)' : d.type === 'S' ? 'var(--s2)' : 'var(--s1)'};opacity:${d === best ? 1 : .8}"><title>${dl(d.date)} peak ${fmt(d.pk.v)} MW at ${lfHm(d.pk.b)} · ${fmt(d.mu, 1)} MU · RE ${fmt(d.re, 1)}%</title></rect>
        <text class="ax" x="${xc(i)}" y="${H - 16}" text-anchor="middle">${dl(d.date).slice(0, 2)}</text><text class="ax" x="${xc(i)}" y="${H - 5}" text-anchor="middle" style="font-size:8.5px">${wd(d.date)}</text>`).join('')}
      <path d="${list.map((d, i) => (i ? 'L' : 'M') + xc(i).toFixed(1) + ',' + ye(d.mu).toFixed(1)).join('')}" fill="none" style="stroke:var(--brand2)" stroke-width="2.2" data-axis="r"/>
      ${list.map((d, i) => `<circle cx="${xc(i)}" cy="${ye(d.mu)}" r="2.8" style="fill:var(--brand2)"/>`).join('')}
    </svg></div>
    <div class="keyline"><span><i style="width:12px;height:10px;background:var(--accent)"></i>Peak MW, working day</span><span><i style="width:12px;height:10px;background:var(--s2)"></i>Saturday</span><span><i style="width:12px;height:10px;background:var(--s1)"></i>Sunday / holiday</span><span><i style="width:14px;height:3px;background:var(--brand2)"></i>Energy MU (right)</span></div>
    <div style="overflow-x:auto;margin-top:8px"><table class="gt num"><tr><th>Date</th><th>Peak MW</th><th>at</th><th>Energy MU</th><th>Solar MU</th><th>Wind MU</th><th>RE %</th></tr>
      ${[...list].reverse().map(d => `<tr><td>${wd(d.date)} ${dl(d.date)}</td><td><b>${fmt(d.pk.v)}</b></td><td>${lfHm(d.pk.b)}</td><td>${fmt(d.mu, 1)}</td><td>${fmt(d.sol, 1)}</td><td>${fmt(d.win, 1)}</td><td>${fmt(d.re, 1)}</td></tr>`).join('')}</table></div>
    ${csvBtn('gujDays', 'Gujarat_daily_demand', ['Date', 'Day type', 'Peak MW', 'Peak time', 'Energy MU', 'Solar MU', 'Wind MU', 'RE %'], list.map(d => [d.date, d.type, Math.round(d.pk.v), lfHm(d.pk.b), +d.mu.toFixed(2), +d.sol.toFixed(2), +d.win.toFixed(2), d.re === null ? null : +d.re.toFixed(1)]))}`;
}

// ---------------------------------------------------------------- tomorrow's forecast card

function lfRender() {
  const box = $('loadFc');
  if (!box) return;
  const head = `<h2>Tomorrow's load forecast · Gujarat catered <span class="more" data-lfref="1" style="cursor:pointer">Refresh</span></h2>`;
  if (!LF.data) { box.innerHTML = head + (LF.busy ? '<div class="sk" style="height:220px"></div>' : `<div class="empty">${esc(LF.err || 'Sign in for the load forecast.')}</div>`); return; }
  const fc = lfCompute();
  if (!fc || fc.none) { box.innerHTML = head + '<div class="empty">Not enough daily load profiles yet (they are built from the readings the app keeps; a few days are needed).</div>'; return; }
  const {f, bt, band, tomorrow, days} = fc, st = lfStats(f.fc), today = days[fc.today], yday = days[lfAdd(fc.today, -1)];
  const lastSame = f.sim[0] ? days[f.sim[0]] : null, sameSt = lastSame ? lfStats(lastSame.c) : null;
  const typeTxt = {W: 'working day', S: 'Saturday', H: 'Sunday / holiday'}, dname = new Date(tomorrow + 'T12:00:00').toLocaleDateString('en-IN', {weekday: 'long', day: '2-digit', month: 'short'});
  const W = Math.max(box.clientWidth || 320, 260), Ht = 230, L = 44, R = 8, T = 10, B = 22;
  const series = [f.fc, today?.c, yday?.c, lastSame?.c].filter(Boolean);
  const vals = series.flat().concat(band.flat().flat()).filter(v => v !== null && v !== undefined && isFinite(v));
  const hi = Math.max(...vals) * 1.03, lo = Math.min(...vals) * 0.97;
  const x = b => L + b / 95 * (W - L - R), y = v => T + (hi - v) / ((hi - lo) || 1) * (Ht - T - B);
  const path = a => { let d = '', pen = false; (a || []).forEach((v, b) => { if (v === null || v === undefined) { pen = false; return; } d += (pen ? 'L' : 'M') + x(b).toFixed(1) + ',' + y(v).toFixed(1); pen = true; }); return d; };
  const area = band.some(Boolean) ? 'M' + band.map((p, b) => p ? x(b).toFixed(1) + ',' + y(p[1]).toFixed(1) : null).filter(Boolean).join('L') + 'L' + band.map((p, b) => p ? x(b).toFixed(1) + ',' + y(p[0]).toFixed(1) : null).filter(Boolean).reverse().join('L') + 'Z' : '';
  const chip = (k, l) => `<button class="chip ${LF.scen === k ? 'on' : ''}" data-lfs="${k}">${l}</button>`;
  const tTxt = f.tT !== null ? `${fmt(f.tT, 1)} °C mean${LF.tmax && LF.tmax[tomorrow] !== undefined ? ' · max ' + fmt(LF.tmax[tomorrow] + (LF.scen === 'p2' ? 2 : LF.scen === 'm2' ? -2 : 0), 1) + ' °C' : ''}` : 'weather not available';
  const chg = sameSt && st.mu ? (st.mu - sameSt.mu) / sameSt.mu * 100 : null;
  box.innerHTML = head + `<div class="vals" style="margin:-4px 0 8px"><b>${esc(dname)}</b> · ${typeTxt[f.type]}${fc.autoType !== f.type ? ' (scenario)' : ''} · ${esc(tTxt)}</div>
    <div class="chips">${chip('auto', 'Auto')}${chip('work', 'As working day')}${chip('hol', 'As holiday')}${chip('p2', '+2 °C')}${chip('m2', '−2 °C')}</div>
    <div class="tstats" style="grid-template-columns:repeat(4,1fr)">
      <div><span>Peak</span><b class="num">${st.pk ? fmt(st.pk.v) : '—'}</b><small>MW at ${st.pk ? lfHm(st.pk.b) : '—'}${bt ? ' · ±' + fmt(st.pk.v * 1.28 * bt.sd[st.pk.b], 0) : ''}</small></div>
      <div><span>Minimum</span><b class="num">${st.lo ? fmt(st.lo.v) : '—'}</b><small>MW at ${st.lo ? lfHm(st.lo.b) : '—'}</small></div>
      <div><span>Energy</span><b class="num">${st.mu ? fmt(st.mu, 1) : '—'}</b><small>MU${chg === null ? '' : ` · ${chg >= 0 ? '+' : '−'}${fmt(Math.abs(chg), 1)}% vs ${esc(f.sim[0].slice(8))}/${esc(f.sim[0].slice(5, 7))}`}</small></div>
      <div><span>Accuracy</span><b class="num">${bt ? '±' + fmt(bt.mape, 1) + '%' : '—'}</b><small>${bt ? 'average error, last ' + bt.n + ' days' : 'not enough days'}</small></div></div>
    <div class="chart"><svg viewBox="0 0 ${W} ${Ht}" height="${Ht}" role="img" aria-label="Gujarat catered load forecast for tomorrow">
      ${niceTicks(lo, hi, 4).map(v => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${L - 5}" y="${y(v) + 3.5}" text-anchor="end">${fmt(v / 1000, 1)}k</text>`).join('')}
      ${[0, 24, 48, 72, 95].map((b, i) => `<text class="ax" x="${x(b)}" y="${Ht - 5}" text-anchor="${i === 0 ? 'start' : i === 4 ? 'end' : 'middle'}">${b === 95 ? '24:00' : lfHm(b)}</text>`).join('')}
      ${area ? `<path d="${area}" style="fill:var(--accent);opacity:.14"/>` : ''}
      ${lastSame && f.sim[0] !== lfAdd(fc.today, -1) ? `<path d="${path(lastSame.c)}" fill="none" style="stroke:var(--s1)" stroke-width="1.4" stroke-dasharray="2 3"/>` : ''}
      <path d="${path(yday?.c)}" fill="none" style="stroke:var(--muted)" stroke-width="1.4" stroke-dasharray="5 3"/>
      <path d="${path(today?.c)}" fill="none" style="stroke:var(--brand2)" stroke-width="1.8"/>
      <path d="${path(f.fc)}" fill="none" style="stroke:var(--accent)" stroke-width="2.8" stroke-linejoin="round"/>
      ${st.pk ? `<circle cx="${x(st.pk.b)}" cy="${y(st.pk.v)}" r="4" style="fill:var(--accent)"/>` : ''}
    </svg></div>
    <div class="keyline"><span><i style="width:16px;height:3px;background:var(--accent)"></i>Tomorrow (forecast)</span><span><i style="width:16px;height:8px;background:var(--accent);opacity:.25"></i>80 % range</span>
      <span><i style="width:16px;height:3px;background:var(--brand2)"></i>Today</span><span><i style="width:16px;height:0;border-top:2px dashed var(--muted)"></i>Yesterday</span>
      ${lastSame && f.sim[0] !== lfAdd(fc.today, -1) ? `<span><i style="width:16px;height:0;border-top:2px dotted var(--s1)"></i>Last ${esc(typeTxt[f.type])} (${esc(f.sim[0].slice(8))}/${esc(f.sim[0].slice(5, 7))})</span>` : ''}</div>
    <div class="note-src">How: median of similar days (${f.sim.map(d => d.slice(8) + '/' + d.slice(5, 7)).join(', ')}), weather ${f.slope ? `${fmt(f.slope, 0)} MW per °C (${f.tT !== null && f.tSim !== null ? (f.tT >= f.tSim ? '+' : '−') + fmt(Math.abs(f.tT - f.tSim), 1) + ' °C vs those days' : 'no temperature'})` : 'effect not significant yet'}, recent level ${f.level >= 1 ? '+' : '−'}${fmt(Math.abs(f.level - 1) * 100, 1)}%${f.tune ? `, fine-tuned from ${f.tune.n} days of forecast vs actual (${f.tune.avg >= 0 ? '+' : '−'}${fmt(Math.abs(f.tune.avg), 1)}% on average)` : ''}.
      Holidays: built-in fixed dates plus the AppSettings list HOLIDAYS (festivals such as Diwali). Profiles from the readings the app keeps; weather Open-Meteo. A planning guide, not SLDC's forecast.</div>
    ${csvBtn('loadFc', 'Gujarat_load_forecast_' + tomorrow, ['Block', 'Time', 'Forecast MW', 'Low (80%) MW', 'High (80%) MW', 'Today MW', 'Yesterday MW'],
      f.fc.map((v, b) => [b + 1, lfHm(b), v === null ? null : Math.round(v), band[b] ? Math.round(band[b][0]) : null, band[b] ? Math.round(band[b][1]) : null, today?.c?.[b] ?? null, yday?.c?.[b] ?? null]))}`;
  lfAccRender();
}

function lfShow() { lfHeroRender(); lfRender(); lfDaysRender(); lfAccRender(); lfLoad(false); }
if (typeof document !== 'undefined') document.addEventListener('click', e => {
  const s = e.target.closest('[data-lfs]'); if (s) { LF.scen = s.dataset.lfs; LF.fc = null; lfRender(); lfHeroRender(); return; }
  if (e.target.closest('[data-lfref]')) lfLoad(true);
  const d = e.target.closest('[data-lfacc]');
  if (d) { LF.accDay = d.dataset.lfacc; lfAccRender(); if (window.APP_MODE === 'gpower' && typeof render === 'function') render(); }
});
if (typeof module !== 'undefined') module.exports = {lfForecast, lfBacktest, lfStats, lfType, lfAdd, lfAccRows, lfTuneFactors, LF};
