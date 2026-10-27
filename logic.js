/*
 * GSECL Generation Monitor — data logic (JavaScript port of the web app's lib.php/config.php).
 *
 * GSECL feed sections:
 *   "s/unit,value"        -> Generation of individual units, MW (+ s/TIME, s/freq)
 *   "NAME,value"          -> Schedule Generation (SG), combined as per PPA, MW
 *   "NAME_DC/<tab>value"  -> Declared Capacity (DC), combined as per PPA, MW
 * SLDC shutdown planning page -> unit-wise outage details.
 * Nothing is stored: every call reads the live websites.
 */

const FEED_URL = 'https://dcsg.gsecl.in/final_gsecl_digen.txt';
const SLDC_URL = 'https://www.sldcguj.com/shutdownplanning.php';
// Same JSON endpoints the official SLDC app uses.
const SLDC_RT_URL = 'https://www.sldcguj.com/RealTimeData/PHP_SLDC/ReadRealTimeData.php';    // station-wise schedule/generation
const SLDC_RT2_URL = 'https://www.sldcguj.com/RealTimeData/PHP_SLDC/ReadRealTimeData2.php';  // frequency, catered, generation mix
const SLDC_RT1_URL = 'https://www.sldcguj.com/RealTimeData/PHP_SLDC/ReadRealTimeData1.php';  // DISCOM drawal vs schedule
const FETCH_TIMEOUT = 20;   // seconds
const SLDC_TIMEOUT = 60;    // seconds (SLDC page can take ~25 s)
const STALE_AFTER = 900;    // seconds; the source updates every few minutes

// Each PPA block: SG/DC feed keys (exact, or RegExp for fuel-contract lines that are summed),
// units as feedKey: [label, unit name on the SLDC outage page], and rt: [SLDC real-time row, part index | 'all'].
// SG comes from SLDC (rt); the feed's SG is only a fallback. DC and unit generation come from the GSECL feed.
const STATIONS = [
  {station: 'Wanakbori TPS', fuel: 'Coal', sldc: /^WTPS/, blocks: [
    {key: 'WTPS_12456', rt: ['WTPS(1,2,4,5,6)+(3)+(7)+(8)', 0], label: 'WTPS U-1,2,4,5,6', sg: ['WTPS_12456'], dc: ['WTPS_12456'], units: {
      wtp1: ['Unit 1', 'WTPS-1'], wtp2: ['Unit 2', 'WTPS-2'], wtp4: ['Unit 4', 'WTPS-4'], wtp5: ['Unit 5', 'WTPS-5'], wtp6: ['Unit 6', 'WTPS-6']}},
    {key: 'WTPS_3', rt: ['WTPS(1,2,4,5,6)+(3)+(7)+(8)', 1], label: 'WTPS U-3', sg: ['WTPS_3'], dc: ['WTPS_3'], units: {wtp3: ['Unit 3', 'WTPS-3']}},
    {key: 'WTPS_7', rt: ['WTPS(1,2,4,5,6)+(3)+(7)+(8)', 2], label: 'WTPS U-7', sg: ['WTPS_7'], dc: ['WTPS_7'], units: {wtp7: ['Unit 7', 'WTPS-7']}},
    {key: 'WTPS8', rt: ['WTPS(1,2,4,5,6)+(3)+(7)+(8)', 3], label: 'WTPS U-8', sg: ['WTPS8'], dc: ['WTPS8'], units: {wt8: ['Unit 8', 'WTPS-8']}},
  ]},
  {station: 'Ukai TPS', fuel: 'Coal', sldc: /^UTPS/, blocks: [
    {key: 'UTPS_35', rt: ['UTPS(3-5)+(4)+(6)', 0], label: 'UTPS U-3,5', sg: ['UTPS_35'], dc: ['UTPS_35'], units: {ukth3: ['Unit 3', 'UTPS-3'], ukth5: ['Unit 5', 'UTPS-5']}},
    {key: 'UTPS_4', rt: ['UTPS(3-5)+(4)+(6)', 1], label: 'UTPS U-4', sg: ['UTPS_4'], dc: ['UTPS_4'], units: {ukth4: ['Unit 4', 'UTPS-4']}},
    {key: 'UTPS6', rt: ['UTPS(3-5)+(4)+(6)', 2], label: 'UTPS U-6', sg: ['UTPS6'], dc: ['UTPS6'], units: {ukth6: ['Unit 6', 'UTPS-6']}},
  ]},
  {station: 'Gandhinagar TPS', fuel: 'Coal', sldc: /^GTPS/, blocks: [
    {key: 'GTPS34', rt: ['GTPS(3-4)+(5)', 0], label: 'GTPS U-3,4', sg: ['GTPS34'], dc: ['GTPS34'], units: {gtp3: ['Unit 3', 'GTPS-3'], gtp4: ['Unit 4', 'GTPS-4']}},
    {key: 'GTPS5', rt: ['GTPS(3-4)+(5)', 1], label: 'GTPS U-5', sg: ['GTPS5'], dc: ['GTPS5'], units: {gtp5: ['Unit 5', 'GTPS-5']}},
  ]},
  {station: 'Sikka TPS', fuel: 'Coal', sldc: /^STPS/, blocks: [
    {key: 'STPS_3_4', rt: ['Sikka(3-4)', 0], label: 'STPS U-3,4', sg: ['STPS_3_4'], dc: ['STPS_3_4'], units: {sik1: ['Unit 3', 'STPS-3'], sik2: ['Unit 4', 'STPS-4']}},
  ]},
  {station: 'Kutch Lignite TPS', fuel: 'Lignite', sldc: /^KLTPS/, blocks: [
    {key: 'KLTPS1-3', rt: ['KLTPS(3)+(4)', 0], label: 'KLTPS U-1,2,3', sg: ['KLTPS1-3'], dc: ['KLTPS1-3'], units: {
      klt1: ['Unit 1', 'KLTPS-1'], klt2: ['Unit 2', 'KLTPS-2'], klt3: ['Unit 3', 'KLTPS-3']}},
    {key: 'KLTPS4', rt: ['KLTPS(3)+(4)', 1], label: 'KLTPS U-4', sg: ['KLTPS4'], dc: ['KLTPS4'], units: {klt4: ['Unit 4', 'KLTPS-4']}},
  ]},
  {station: 'Bhavnagar Lignite TPS', fuel: 'Lignite', sldc: /^BLTPS/, blocks: [
    {key: 'BLTPS', rt: ['BLTPS', 0], label: 'BLTPS U-1,2', sg: ['BLTPS'], dc: ['BLTPS'], units: {bec1: ['Unit 1', 'BLTPS-1'], bec2: ['Unit 2', 'BLTPS-2']}},
  ]},
  // Dhuvaran is run as three combined-cycle stages; each feed point belongs to one stage (GT + STG together):
  // Stage-I = dgb1 + dgb2, Stage-II = dgb3 + dgb4, Stage-III = dg21. SLDC lists the GT and STG of each stage
  // separately (sldcNames), so its outages are shown against the stage block.
  {station: 'Dhuvaran GBPS', fuel: 'Gas', sldc: /^DGB/, blocks: [
    {key: 'DGBPS_1', rt: ['Dhuvaran (Gas)(I+II)+(III)', 0], label: 'DGBPS Stage-I (GT1+STG1)', sg: [/^DGBPS_1_/], dc: [/^DGBPS_1_/],
     sldcNames: ['DGB-GT1', 'DGB-STG1'], noDc: 'No DC declared in the GSECL feed (SLDC: GUVNL PPA expired)', units: {dgb1: ['GT1+STG1 · dgb1', null], dgb2: ['GT1+STG1 · dgb2', null]}},
    {key: 'DGBPS_2', rt: ['Dhuvaran (Gas)(I+II)+(III)', 1], label: 'DGBPS Stage-II (GT2+STG2)', sg: [/^DGBPS_2_/], dc: [/^DGBPS_2_/],
     sldcNames: ['DGB-GT2', 'DGB-STG2'], units: {dgb3: ['GT2+STG2 · dgb3', null], dgb4: ['GT2+STG2 · dgb4', null]}},
    {key: 'DGBPS_3', rt: ['Dhuvaran (Gas)(I+II)+(III)', 2], label: 'DGBPS Stage-III (GT3+STG3)', sg: [/^DGBPS_3_/], dc: [/^DGBPS_3_/],
     sldcNames: ['DGB-GT3', 'DGB-STG3'], units: {dg21: ['GT3+STG3 · dg21', null]}},
  ]},
  {station: 'Utran GBPS', fuel: 'Gas', sldc: /^(UCCGP|UGBPS)/, blocks: [
    {key: 'UGBPS_2', rt: ['Utran(Gas)(II)', 0], label: 'UGBPS Stage-II', sg: [/^UGBPS_2_/], dc: [/^UGBPS_2_/], units: {
      ut2g1: ['GT-1', 'UCCGP STAGE-II-GT1'], ut2g2: ['STG-1', 'UCCGP STAGE-II-STG1']}},
  ]},
  {station: 'Ukai Hydro', fuel: 'Hydro', sldc: /^UHPS/, blocks: [
    {key: 'UHPS', rt: ['Ukai (Hydro)', 0], label: 'UHPS U-1–4', sg: ['UHPS'], dc: ['UHPS'], units: {
      uk1: ['Unit 1', 'UHPS-1'], uk2: ['Unit 2', 'UHPS-2'], uk3: ['Unit 3', 'UHPS-3'], uk4: ['Unit 4', 'UHPS-4']}},
  ]},
  {station: 'Kadana Hydro', fuel: 'Hydro', sldc: /^KHPS/, blocks: [
    {key: 'KHPS', rt: ['Kadana (Hydro)', 0], label: 'KHPS U-1–4', sg: ['KHPS'], dc: ['KHPS'], units: {
      kh1: ['Unit 1', 'KHPS-1'], kh2: ['Unit 2', 'KHPS-2'], kh3: ['Unit 3', 'KHPS-3'], kh4: ['Unit 4', 'KHPS-4']}},
  ]},
];

// ---------------------------------------------------------------- reference data from SLDC PDFs
// These are PDFs, so the values are built into the app. sldcMeritCheck() reports when SLDC publishes a newer
// merit-order file so the values here can be updated.

/** Unit-wise technical minimum, MW without auxiliary — SLDC https://www.sldcguj.com/Report/TECHNICAL_MINIMUM.pdf
 *  (units not listed in that file — Sikka U-4, WTPS U-8, hydro — have no value). */
const TECH_MIN = {
  klt1: 39.488, klt2: 39.488, klt3: 43.875, klt4: 43.88,
  gtp3: 141, gtp4: 141, gtp5: 154,
  ukth3: 135, ukth4: 135, ukth5: 150.5, ukth6: 336.6,
  wtp1: 144.8, wtp2: 144.8, wtp3: 144.8, wtp4: 144.8, wtp5: 144.8, wtp6: 144.8, wtp7: 144.8,
  sik1: 165,
};
/** Gas stations are listed per combined-cycle module in the same file. */
const TECH_MIN_BLOCK_NOTE = {
  DGBPS_1: 'Tech-min: 69 MW (GT1 + STG1)',
  DGBPS_2: 'Tech-min: 73 MW (GT2 + STG2)',
  DGBPS_3: 'Tech-min: Stage-III not in SLDC list',
  UGBPS_2: 'Tech-min: 188 MW (GT + STG)',
};

/** Merit order on variable cost (Rs/kWh) — SLDC "Merit order on the basis of agreement for variable cost", 25.09.2026.
 *  Built-in first entry of the merit-order history; later revisions are read from SLDC's PDF (see sldcMeritCheck). */
const MERIT_BUILTIN = {
  asOf: '25.09.2026', fileDate: '25092026', total: 71,
  url: 'https://www.sldcguj.com/Realtimedata/MeritOrder2509202620260925125212.pdf',
  blocks: {
    BLTPS: [[4.33, 32]], WTPS8: [[4.55, 33]], UTPS6: [[4.70, 34]], 'KLTPS1-3': [[4.80, 35, 'KLTPS 3']], KLTPS4: [[4.82, 36]],
    UTPS_4: [[4.95, 37]], UTPS_35: [[5.63, 41]], WTPS_3: [[5.66, 42]], GTPS5: [[5.70, 43]], GTPS34: [[5.90, 46]],
    WTPS_7: [[6.20, 48]], WTPS_12456: [[6.20, 49]], STPS_3_4: [[9.30, 56]],
    UGBPS_2: [[12.00, 58, 'High-seas gas'], [25.27, 68, 'GSPC spot gas']],
    DGBPS_2: [[14.20, 60, 'High-seas gas'], [29.21, 70, 'GSPC spot gas']],
    DGBPS_3: [[12.82, 59, 'High-seas gas'], [25.27, 67, 'GSPC spot gas']],
  },
};

/** Revision of 19.10.2026 (SLDC file MOSLDC20261020160246.pdf), read with parseMeritLines. */
const MERIT_BUILTIN_2 = {
  // every generator of SLDC's list, [rank, name, Rs/kWh (null = NA), remark] (Gujarat Power shows them all)
  all: [[1, "SARDAR SAROVAR PROJECT", 2.05, "Share Compulsory,at GETCO peri."], [2, "KAKRAPAR APS", 2.29, "Share Compulsory,at GETCO peri."], [3, "TARAPUR APS - 1 & 2", 2.416, "Share Compulsory,at GETCO peri."], [4, "TARAPUR APS- 3 & 4", 3.646, "Share Compulsory,at GETCO peri."], [5, "KAKRAPAR EXT.", 4.4, "Share Compulsory,at GETCO peri."], [6, "ACB India Ltd", 0.849, "At GETCO peri."], [7, "KORBA- III", 1.357, "At GETCO peri."], [8, "KORBA -I & II", 1.384, "At GETCO peri."], [9, "SIPAT-1", 1.425, "At GETCO peri."], [10, "SIPAT-2", 1.43, "At GETCO peri."], [11, "Lara STPS", 1.623, "At GETCO peri."], [12, "D B Power Limited", 1.65, "At GETCO peri."], [13, "VINDHYACHAL - STAGE 4", 2.167, "At GETCO peri."], [14, "VINDHYACHAL - STAGE 3", 2.182, "At GETCO peri."], [15, "VINDHYACHAL - STAGE 5", 2.195, "At GETCO peri."], [16, "VINDHYACHAL - STAGE 2", 2.207, "At GETCO peri."], [17, "VINDHYACHAL - STAGE 1", 2.285, "At GETCO peri."], [18, "AKRIMOTA", 2.83, ""], [19, "Mauda STPS II", 2.931, "At GETCO peri."], [20, "Mauda STPS I", 2.938, "At GETCO peri."], [21, "Nabinagar", 3.054, "At GETCO peri."], [22, "KAHALGAON 2", 3.1, "At GETCO peri."], [23, "Barh-I", 3.169, "At GETCO peri."], [24, "KHARGAON STPS", 3.248, "At GETCO peri."], [25, "GADARWARA STPS", 3.348, "At GETCO peri."], [26, "GIPCL -MANGROL LIGNITE SLPP", 3.63, ""], [27, "GIPCL -MANGROL LIGNITE SLPP Expansion", 3.63, ""], [28, "Farakka-3", 3.656, "At GETCO peri."], [29, "Farakka-1", 3.749, "At GETCO peri."], [30, "FG UnchaHAR -I", 3.977, "At GETCO peri."], [31, "BLTPS 1 & 2", 4.33, ""], [32, "WANAKBORI TPS- 8", 4.58, ""], [33, "UKAI - TPS- 6", 4.72, ""], [34, "Dadri-I", 4.754, "At GETCO peri."], [35, "KLTPS 3", 4.8, ""], [36, "KLTPS 4", 4.82, ""], [37, "Solapur TPS", 4.843, "At GETCO peri."], [38, "WANAKBORI TPS- 3", 5.16, ""], [39, "UKAI - TPS- 4", 5.2, ""], [40, "CGPL Mundra UMPP", 5.476, "At GETCO peri."], [41, "GANDHINAGAR TPS ( UNIT NO 5)", 5.6, ""], [42, "WANAKBORI TPS ( UNIT NO 7)", 5.68, ""], [43, "WANAKBORI TPS ( UNIT NO 1,2,4 ,5 & 6 )", 5.68, ""], [44, "GANDHINAGAR TPS ( UNIT NO 3,4 )", 5.8, ""], [45, "APL- II (Adani Power Limited(Mundra) Unit-5-6)", 5.9, ""], [46, "APL- II (Adani Power Limited(Mundra) Unit-5-6 (200MW))", 5.91, ""], [47, "EPGL (Essar Power Gujarat LTD.)", 5.953, ""], [48, "UKAI - TPS 3 & 5", 5.97, ""], [49, "APL-I (Adani Power Limited(Mundra) Unit-1-4 )", 6.28, ""], [50, "APL-I (Adani Power Limited(Mundra) Unit-1-4 (200 MW)", 6.29, ""], [51, "JAHNOR-JGPS APM", 7.246, "At GETCO peri."], [52, "KAWAS GAS APM", 7.277, "At GETCO peri."], [53, "JAHNOR-JGPS NON APM", 7.391, "At GETCO peri."], [54, "KAWAS GAS NON APM", 7.422, "At GETCO peri."], [55, "SIKKA 3-4", 9.45, ""], [56, "GPPC (HIGH SEAS)", 10.69, ""], [57, "Utran-II on (HIGH SEAS)", 12.05, ""], [58, "Dhuvaran CCPP-III (HIGH SEAS)", 12.52, ""], [59, "Dhuvaran CCPP- II (HIGH SEAS)", 14.0, ""], [60, "Jhanor RLNG (GAS)", 21.401, "At GETCO peri."], [61, "KAWAS RLNG (GAS)", 21.507, "At GETCO peri."], [62, "JAHNOR-JGPS Comm", 25.887, "At GETCO peri."], [63, "Dhuvaran CCPP-III (GSPC Spot Gas)", 26.61, ""], [64, "Utran-II on (GSPC Spot Gas)", 26.61, ""], [65, "GSEG, Expansion (GSPC Spot Gas)", 26.35, ""], [66, "GPPC (GSPC Spot Gas)", 26.35, ""], [67, "KAWAS GAS Comm", 26.78, "At GETCO peri."], [68, "KAWAS-KGPS (ON Liquid.)", 29.333, "At GETCO peri."], [69, "Dhuvaran CCPP- II (GSPC Spot Gas)", 30.68, ""], [70, "GSEG Expansion on High Sea Gas", null, "No High sea Gas Available"]],
  asOf: '19.10.2026', fileDate: '19102026', stamp: '20261020160246', file: 'MOSLDC20261020160246.pdf', total: 70,
  url: 'https://www.sldcguj.com/Realtimedata/MOSLDC20261020160246.pdf',
  blocks: {"BLTPS":[[4.33,31]],"WTPS8":[[4.58,32]],"UTPS6":[[4.72,33]],"KLTPS1-3":[[4.8,35,"KLTPS 3"]],"KLTPS4":[[4.82,36]],"WTPS_3":[[5.16,38]],"UTPS_4":[[5.2,39]],"GTPS5":[[5.6,41]],"WTPS_7":[[5.68,42]],"WTPS_12456":[[5.68,43]],"GTPS34":[[5.8,44]],"UTPS_35":[[5.97,48]],"STPS_3_4":[[9.45,55]],"UGBPS_2":[[12.05,57,"High-seas gas"],[26.61,64,"GSPC spot gas"]],"DGBPS_3":[[12.52,58,"High-seas gas"],[26.61,63,"GSPC spot gas"]],"DGBPS_2":[[14,59,"High-seas gas"],[30.68,69,"GSPC spot gas"]]},
};

const fileDateKey = d => +(d.slice(4) + d.slice(2, 4) + d.slice(0, 2));   // ddmmyyyy -> yyyymmdd

/** Merit-order revisions kept on the phone, oldest first (the built-in list is always included). */
function meritHistory() {
  let h = [];
  try { const s = typeof Native !== 'undefined' && Native.storeGet ? Native.storeGet('merit_history') : ''; if (s) h = JSON.parse(s); } catch (e) { h = []; }
  for (const e of h) {
    const old = e.blocks && e.blocks.DGBPS;
    if (!old) continue;
    for (const [cost, rank, note] of old) {
      const k = /III/.test(note || '') ? 'DGBPS_3' : 'DGBPS_2';
      (e.blocks[k] = e.blocks[k] || []).push([cost, rank, /spot/i.test(note || '') ? 'GSPC spot gas' : 'High-seas gas']);
    }
    delete e.blocks.DGBPS;
  }
  for (const B of [MERIT_BUILTIN, MERIT_BUILTIN_2])
    if (!h.some(e => e.fileDate === B.fileDate || (e.file && e.file === B.file))) h.push({...B, source: 'built-in'});
  return h.sort((a, b) => fileDateKey(a.fileDate) - fileDateKey(b.fileDate) || String(a.stamp || '').localeCompare(String(b.stamp || '')));
}

/** Latest revision: the rates the app uses. */
let MERIT = null;
function refreshMerit() { const h = meritHistory(); MERIT = h[h.length - 1]; return h; }
refreshMerit();

// ---------------------------------------------------------------- native fetch bridge

const pending = {};
let seq = 0;
window.__nativeDone = (id, ok, body, error) => {
  const p = pending[id];
  delete pending[id];
  if (p) p({ok, body, error});
};
function httpGet(url, timeoutSec) {
  return new Promise(resolve => {
    const id = 'r' + (++seq);
    pending[id] = resolve;
    window.Native.fetch(id, url + (url.includes('?') ? '&' : '?') + '_=' + Date.now(), timeoutSec);
  });
}
/** Like httpGet, but body is base64 (for PDFs). */
function httpGetBytes(url, timeoutSec) {
  return new Promise(resolve => {
    const id = 'b' + (++seq);
    pending[id] = resolve;
    window.Native.fetchBytes(id, url, timeoutSec);
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
/**
 * Peak and minimum by 15-minute time block (as in the grid's accounts): readings [{m: minute of the day, v: MW}] are
 * averaged per block and the highest / lowest block average is taken (the running block counts with its average
 * so far). {pk, lo}: {v, m: block middle minute, b: block index 0-95, lbl: "19:00–19:15", n: readings}.
 */
function blockStat(pts) {
  const acc = {};
  (pts || []).forEach(p => { if (p.v === null || p.v === undefined || !isFinite(p.v)) return; const b = Math.floor(p.m / 15); if (b < 0 || b > 95) return; const a = acc[b] || (acc[b] = [0, 0]); a[0] += p.v; a[1]++; });
  const hhmm = m => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const list = Object.keys(acc).map(b => ({v: acc[b][0] / acc[b][1], m: +b * 15 + 7.5, b: +b, lbl: hhmm(+b * 15) + '–' + hhmm(+b * 15 + 15), n: acc[b][1]}));
  return {pk: list.reduce((x, p) => (!x || p.v > x.v ? p : x), null), lo: list.reduce((x, p) => (!x || p.v < x.v ? p : x), null)};
}
/** A unit counts as generating only above this. Gas units (Dhuvaran, Utran) read a few MW negative when
 *  stopped (auxiliary drawal), which would otherwise show as false generation: anything up to 2 MW is 0. */
const RUN_MW = 2;
const runMw = v => v === null || v === undefined || !isFinite(v) ? v : v > RUN_MW ? v : 0;
const nowText = () => new Date().toLocaleString('en-GB', {hour12: false}).replace(',', '');

// ---------------------------------------------------------------- GSECL feed

/** Duplicate keys keep the last value (never summed) and are reported. */
function parseFeed(text) {
  const out = {time: null, freq: null, units: {}, sg: {}, dc: {}, duplicates: [], unparsed: []};
  const add = (sec, k, v) => {
    if (k in out[sec]) out.duplicates.push(`${sec}:${k}`);
    out[sec][k] = v;
  };
  for (let line of text.split(/\r?\n|\r/)) {
    line = line.trim();
    if (!line) continue;
    let m;
    if ((m = line.match(/^s\/TIME\/(.+?)\/;?$/))) out.time = m[1].trim();
    else if ((m = line.match(/^s\/([^,]+),\s*(-?\d+(?:\.\d+)?)$/))) {
      if (m[1].toLowerCase() === 'freq') out.freq = +m[2];
      else add('units', m[1], +m[2]);
    } else if ((m = line.match(/^(.+?)_DC\/\s*(-?\d+(?:\.\d+)?)$/))) add('dc', m[1], +m[2]);
    else if ((m = line.match(/^([^,/]+),\s*(-?\d+(?:\.\d+)?)$/))) add('sg', m[1], +m[2]);
    else out.unparsed.push(line);
  }
  return out;
}

function sumSelected(values, selectors, used) {
  let sum = null;
  for (const [k, v] of Object.entries(values)) {
    if (selectors.some(s => s instanceof RegExp ? s.test(k) : s === k)) {
      sum = (sum ?? 0) + v;
      used.add(k);
    }
  }
  return sum;
}

/** SG/DC keys named exactly in STATIONS that the feed did not carry this time. */
function missingKeys(p) {
  const missing = [];
  for (const st of STATIONS) for (const b of st.blocks) for (const sec of ['sg', 'dc'])
    for (const s of b[sec]) if (!(s instanceof RegExp) && !(s in p[sec])) missing.push(`${sec.toUpperCase()}: ${s}`);
  const units = STATIONS.flatMap(st => st.blocks.flatMap(b => Object.keys(b.units)));
  const absent = units.filter(k => !(k in p.units));
  if (absent.length === units.length) missing.push('all unit generation lines (s/…)');
  else if (absent.length) missing.push(`Generation: ${absent.join(', ')}`);
  if (p.time === null) missing.push('TIME');
  return missing;
}

function feedTimestamp(t) {
  const m = t && t.match(/^(\d{1,2})-(\d{1,2})-(\d{4}) (\d{1,2}):(\d{2}):(\d{2})$/);   // hour can be single-digit ("9:32:00")
  // Feed time is IST (UTC+05:30).
  return m ? Date.UTC(+m[3], m[2] - 1, +m[1], m[4] - 5, m[5] - 30, +m[6]) : null;
}

/** PPA-block view: unit generation summed per block against the block's SG and DC. */
function buildSnapshot(p, rt = {}) {
  const usedSg = new Set(), usedDc = new Set(), usedUnits = new Set();
  // SG/DC totals and deviation stay null when no block carried a value, so "no data" never reads as 0 MW.
  const totals = {gen: 0, sg: null, dc: null}, byFuel = {};
  let deviation = null;
  const stations = STATIONS.map(st => {
    const stTot = {gen: 0, sg: null, dc: null};
    const blocks = st.blocks.map(b => {
      const sgFeed = sumSelected(p.sg, b.sg, usedSg), dc = sumSelected(p.dc, b.dc, usedDc);
      const r = rt[b.key];
      const sg = r?.sg ?? sgFeed;
      const sgSrc = r?.sg != null ? 'SLDC' : sgFeed !== null ? 'GSECL feed' : null;
      let gen = null;
      const units = Object.entries(b.units).map(([key, [label, sldc]]) => {
        const mw = key in p.units ? runMw(p.units[key]) : null;
        if (mw !== null) { usedUnits.add(key); gen = (gen ?? 0) + mw; }
        return {key, label, sldc, mw, techMin: TECH_MIN[key] ?? null};
      });
      // A block with any unit missing from the feed would under-count; use SLDC's block total instead.
      let genSrc = gen === null ? null : 'units';
      if (units.some(u => u.mw === null) && r?.gen != null) { gen = r.gen; genSrc = 'SLDC'; }
      // Deviation only where both exist, so a missing SG line is never read as zero schedule.
      if (sg !== null && gen !== null) deviation = (deviation ?? 0) + gen - sg;
      stTot.gen += gen ?? 0;
      if (sg !== null) stTot.sg = (stTot.sg ?? 0) + sg;
      if (dc !== null) stTot.dc = (stTot.dc ?? 0) + dc;
      // Tech-min of the units now generating; incomplete if a running unit has no listed value.
      const onBar = units.filter(u => (u.mw ?? 0) > RUN_MW);
      const listed = onBar.filter(u => u.techMin !== null);
      const techMinOnBar = listed.length ? listed.reduce((s, u) => s + u.techMin, 0) : null;
      const techMinComplete = onBar.every(u => u.techMin !== null);
      const merit = MERIT.blocks[b.key] || null;
      return {key: b.key, label: b.label, gen, sg, dc, cap: r?.cap ?? null, sgSrc, genSrc, noDc: b.noDc || null,
        techMinOnBar, techMinComplete, techMinNote: TECH_MIN_BLOCK_NOTE[b.key] || null,
        merit: merit && merit.map(([cost, rank, note]) => ({cost, rank, note: note || null})),
        deviation: gen !== null && sg !== null ? gen - sg : null, units};
    });
    for (const k of ['gen', 'sg', 'dc']) {
      if (stTot[k] !== null) totals[k] = (totals[k] ?? 0) + stTot[k];
      byFuel[st.fuel] = byFuel[st.fuel] || {gen: 0, sg: 0, dc: 0};
      byFuel[st.fuel][k] += stTot[k] ?? 0;
    }
    return {station: st.station, fuel: st.fuel, blocks, totals: stTot};
  });
  const ts = feedTimestamp(p.time);
  return {
    data_time: p.time,
    stale: ts === null || Date.now() - ts > STALE_AFTER * 1000,
    freq: p.freq,
    totals: {...totals, deviation},
    by_fuel: byFuel,
    stations,
    unmapped: {sg: Object.keys(p.sg).filter(k => !usedSg.has(k)), dc: Object.keys(p.dc).filter(k => !usedDc.has(k))},
    // What is still unavailable after combining both sources, and where a fallback source was used.
    missing: stations.flatMap(s => s.blocks.flatMap(b => [
      ...(b.sg === null ? [`SG: ${b.label}`] : []), ...(b.dc === null && !b.noDc ? [`DC: ${b.label}`] : []),
      ...(b.gen === null ? [`Generation: ${b.label}`] : [])])),
    fallback: {
      sgFeed: stations.flatMap(s => s.blocks.filter(b => b.sgSrc === 'GSECL feed').map(b => b.label)),
      genSldc: stations.flatMap(s => s.blocks.filter(b => b.genSrc === 'SLDC').map(b => b.label)),
    },
    feedSg: p.sg, feedDc: p.dc,   // fuel-wise lines (e.g. UGBPS_2_SPOT) for gas merit entries
    duplicates: p.duplicates,
    unparsed: p.unparsed,
  };
}

/**
 * GSECL feed (unit generation, DC) + SLDC real-time data (SG, block generation) fetched together.
 * The feed file is rewritten in place, so a read can be partial: retry once. If the feed is down,
 * SLDC alone still gives SG and block generation.
 */
async function gseclLive() {
  let [res, rtRes] = await Promise.all([httpGet(FEED_URL, FETCH_TIMEOUT), httpGet(SLDC_RT_URL, 30)]);
  let rt = null, sldcError = null, rtRows = null;
  if (rtRes.ok) {
    try { rt = parseRealtime(rtRes.body); rtRows = JSON.parse(rtRes.body); } catch (e) { sldcError = 'SLDC real-time data came in an unexpected format.'; }
  } else sldcError = rtRes.error;
  if (!res.ok && !rt) return {ok: false, error: res.error};
  let parsed = parseFeed(res.ok ? res.body : '');
  if (res.ok && missingKeys(parsed).length) {
    await sleep(1000);
    const retry = await httpGet(FEED_URL, FETCH_TIMEOUT);
    if (retry.ok) {
      const p2 = parseFeed(retry.body);
      if (missingKeys(p2).length < missingKeys(parsed).length) parsed = p2;
    }
  }
  const snap = buildSnapshot(parsed, rt || {});
  if (!res.ok) snap.stale = false;   // nothing from the feed to be stale; the feed error is reported instead
  // GSECL thermal (coal, lignite, gas) and hydro generation by SLDC, for the trend readings.
  let rt_fuel = null;
  if (rt) {
    let thermal = 0, hydro = 0, seen = false;
    for (const st of STATIONS) for (const b of st.blocks) {
      const g = rt[b.key] && rt[b.key].gen;
      if (g === null || g === undefined || !isFinite(g)) continue;
      seen = true;
      if (st.fuel === 'Hydro') hydro += g; else thermal += g;
    }
    if (seen) rt_fuel = {thermal, hydro, at: Date.now()};
  }
  return {ok: true, fetched_at: nowText(), feed_error: res.ok ? null : res.error, sldc_error: sldcError, rt_fuel, rt_rows: rtRows, ...snap};
}

// ---------------------------------------------------------------- SLDC real-time data (source of the official SLDC app)

const partNums = s => String(s ?? '').replace(/\s/g, '').split('+').map(x => parseFloat(x));
const sumParts = a => a && a.some(isFinite) ? a.filter(isFinite).reduce((x, y) => x + y, 0) : null;

/** ReadRealTimeData rows -> {blockKey: {sg, gen, cap}} using each block's rt mapping. */
function parseRealtime(body) {
  const byName = {};
  for (const r of JSON.parse(body)) byName[normName(r.StationName)] = r;
  const out = {};
  for (const st of STATIONS) for (const b of st.blocks) {
    const r = b.rt && byName[normName(b.rt[0])];
    if (!r) continue;
    const pick = (s, f = x => x) => { const a = partNums(s).map(x => isFinite(x) ? f(x) : x); const v = b.rt[1] === 'all' ? sumParts(a) : a[b.rt[1]]; return isFinite(v) ? v : null; };
    out[b.key] = {sg: pick(r.Schedule), gen: pick(r.Generation, runMw), cap: pick(r.InstalledCapacity)};
  }
  return out;
}

// ---------------------------------------------------------------- SLDC unit outages

const normName = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const cellText = el => el.textContent.replace(/ /g, ' ').replace(/\s+/g, ' ').trim();

function outageField(h) {
  h = h.toUpperCase();
  if (h.includes('REASON')) return 'reason';
  if (h.includes('REVISED') || h.includes('EXPECT')) return 'revised';
  if (h.includes('SCHEDULE')) return 'schedule';
  if (h.includes('AVAI')) return 'available';
  if (h.includes('FORCE')) return 'force';
  if (h.includes('PLAN')) return 'plan';
  if (h.includes('CAP')) return 'cap';
  if (h.includes('TIME') && !h.includes('DT')) return 'time';
  if (h.includes('OUTAGE') || h.includes('DT')) return 'date';
  if (h.includes('UNIT')) return 'unit';
  if (h.includes('SR')) return 'sr';
  return null;
}

/** FORCE / PLAN MW columns are authoritative; reason text decides only when both are empty. */
function outageType(r) {
  const reason = (r.reason || '').toUpperCase();
  if (parseFloat(r.force) > 0) return 'Forced';
  if (parseFloat(r.plan) > 0) return 'Planned';
  if (/\bFSD\b|\bTRIP/.test(reason)) return 'Forced';
  if (/\bRSD\b|RESERVE SHUT/.test(reason)) return 'RSD';
  if (/\bAOH\b|\bCOH\b|R\s*&\s*M|OVERHAUL/.test(reason)) return 'Planned';
  return 'Outage';
}

/**
 * Parses "UNIT OUTAGE DETAIL" rows: SR NO | UNIT | CAP | OUTAGE DTD | OUTAGE TIME | FORCE | PLAN |
 * AVAILABLE | SCHEDULE DT. | REVISED EXPECTED DATE | Reason — GSECL first, then PRIVATE and CENTRAL SECTOR.
 */
function parseOutages(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const m = doc.body.textContent.match(/OUTAGE DETAIL FOR DATE\s*([\d/.-]+)\s*AT\s*([\d:]+)/i);
  const asOf = m ? `${m[1]} ${m[2]}` : null;
  const defaultOrder = ['sr', 'unit', 'cap', 'date', 'time', 'force', 'plan', 'available', 'schedule', 'revised', 'reason'];
  let sector = 'GSECL', order = null;
  const rows = [];

  for (const tr of doc.querySelectorAll('tr')) {
    // Skip layout rows that wrap the whole outage table (their text includes every sector heading).
    if (tr.querySelector('table')) continue;
    const cells = [];
    for (const td of tr.children) {
      if (td.tagName !== 'TD' && td.tagName !== 'TH') continue;
      const span = Math.max(1, parseInt(td.getAttribute('colspan') || '1', 10));
      cells.push(cellText(td));
      for (let i = 1; i < span; i++) cells.push('');
    }
    const line = cells.join(' ').toUpperCase().trim();
    if (!line) continue;
    if (line.includes('PRIVATE SECTOR')) { sector = 'Private'; continue; }
    if (line.includes('CENTRAL SECTOR')) { sector = 'Central'; continue; }
    if (line.includes('STATE SECTOR')) { sector = 'GSECL'; continue; }
    if (line.includes('UNIT') && line.includes('REASON')) { order = cells.map(outageField); continue; }
    if (cells.length < 3 || !/^\d+\.?$/.test(cells[0]) || !/[A-Z]/i.test(cells[1])) continue;

    const map = order && order.filter(Boolean).length >= 5 ? order : defaultOrder;
    const r = {sector};
    cells.forEach((v, i) => {
      const f = map[i];
      if (f && f !== 'sr' && v) r[f] = r[f] ? `${r[f]} ${v}` : v;
    });
    r.since = `${r.date || ''} ${r.time || ''}`.trim();
    delete r.date; delete r.time;
    r.type = outageType(r);
    rows.push(r);
  }
  return {as_of: asOf, rows};
}

/** "15/10/2026 16:45" -> sortable number (0 when there is no date). */
function outDateKey(s) {
  const m = String(s || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\s*(\d{1,2})?:?(\d{2})?/);
  return m ? Date.UTC(+m[3], m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0)) : 0;
}

/**
 * SLDC can list one unit several times (an old RSD row left over and a newer forced-outage row). Only each
 * unit's latest row (by outage start; the lower row if equal) is its present state; the others are counted in
 * r.older so the screen can say so.
 */
function latestOutages(rows) {
  const best = new Map();
  rows.forEach((r, i) => {
    const k = normName(r.unit), b = best.get(k);
    if (!b || outDateKey(r.since) >= outDateKey(b.r.since)) best.set(k, {r, i, older: b ? b.older + 1 : 0});
    else b.older++;
  });
  return [...best.values()].sort((a, b) => a.i - b.i).map(({r, older}) => older ? {...r, older} : r);
}

/**
 * Outage rows of units the GSECL feed shows generating now (above RUN_MW) are left out: the unit is already
 * synchronised and SLDC has not yet cleared the row. Returns the rows to show and the ones dropped.
 */
function withoutSynced(rows, snap) {
  if (!snap || !snap.ok) return {rows, synced: []};
  const mw = {};
  for (const s of snap.stations) for (const b of s.blocks) for (const u of b.units) if (u.sldc) mw[normName(u.sldc)] = u.mw;
  const keep = [], synced = [];
  for (const r of rows) {
    const v = mw[normName(r.unit)];
    if (v !== null && v !== undefined && v > RUN_MW) synced.push({...r, mw: v}); else keep.push(r);
  }
  return {rows: keep, synced};
}

/** Links GSECL outage rows to feed units (by SLDC name), else to a station's first block. */
function matchOutages(rows) {
  const unitIndex = {};
  for (const st of STATIONS) for (const b of st.blocks)
    for (const [key, [, sldc]] of Object.entries(b.units)) if (sldc) unitIndex[normName(sldc)] = key;
  const units = {}, blocks = {}, unmatched = [];
  rows.forEach((r, i) => {
    if (r.sector !== 'GSECL') return;
    const n = normName(r.unit);
    if (unitIndex[n]) { (units[unitIndex[n]] = units[unitIndex[n]] || []).push(i); return; }
    const blk = STATIONS.flatMap(s => s.blocks).find(b => (b.sldcNames || []).some(x => normName(x) === n));
    if (blk) { (blocks[blk.key] = blocks[blk.key] || []).push(i); return; }
    const st = STATIONS.find(s => s.sldc.test(n));
    if (st) (blocks[st.blocks[0].key] = blocks[st.blocks[0].key] || []).push(i);
    else unmatched.push(i);
  });
  return {units, blocks, unmatched};
}

// ---------------------------------------------------------------- SLDC grid summary (ReadRealTimeData2)

/** Frequency, Gujarat catered and the state generation mix, as shown in the official SLDC app. */
async function sldcHome() {
  const [res, d1] = await Promise.all([httpGet(SLDC_RT2_URL, 30), httpGet(SLDC_RT1_URL, 30)]);
  if (!res.ok) return {ok: false, error: res.error};
  // DISCOM drawal / schedule / DSM (optional; the summary still works without it).
  let discoms = null, raw1 = null;
  try {
    if (d1.ok) raw1 = JSON.parse(d1.body);
    if (d1.ok) discoms = JSON.parse(d1.body).map(r => ({name: r.StationName, drawal: sumParts(partNums(r.Drawal)),
      schedule: sumParts(partNums(r.Schedule)), dsm: sumParts(partNums(r.DSM))}));
  } catch (e) { discoms = null; }
  let j;
  try { j = JSON.parse(res.body); } catch (e) { return {ok: false, error: 'SLDC grid summary came in an unexpected format.'}; }
  const other = j.OtherData || [];
  const find = re => { const o = other.find(x => re.test(x.StationName)); return o ? partNums(o.Drawal) : null; };
  const ws = find(/wind\s*\+\s*solar/i);
  const mix = {
    gsecl: sumParts(find(/GSECL/i)), publicIpp: sumParts(find(/Public/i)), privateIpp: sumParts(find(/Private/i)),
    torrent: sumParts(find(/Torrent/i)), wind: ws && isFinite(ws[0]) ? ws[0] : null, solar: ws && isFinite(ws[1]) ? ws[1] : null,
    total: sumParts(find(/Gujarat Total Generation/i)),
  };
  const freq = parseFloat(j.FREQ), catered = sumParts(find(/Catered/i));
  if (!isFinite(freq) && catered === null) return {ok: false, error: 'SLDC grid summary had no frequency or catered value.'};
  return {ok: true, fetched_at: nowText(), time: j.Time || null, raw2: {FREQ: j.FREQ, OtherData: j.OtherData || []}, raw1: Array.isArray(raw1) ? raw1.slice(0, 20) : null,
    freq: isFinite(freq) ? {value: freq, unit: 'Hz'} : null, catered: catered !== null ? {value: catered, unit: 'MW'} : null, mix, discoms};
}

async function sldcOutages() {
  const res = await httpGet(SLDC_URL, SLDC_TIMEOUT);
  if (!res.ok) return {ok: false, error: res.error, source: SLDC_URL};
  const parsed = parseOutages(res.body);
  // Only GSECL units are shown; Private and Central sector rows are dropped.
  const all = parsed.rows.filter(r => r.sector === 'GSECL');
  if (!all.length)
    return {ok: false, source: SLDC_URL, error: 'SLDC page loaded but no GSECL unit outage rows were found (page layout may have changed).'};
  const latest = latestOutages(all);
  // allRows: one row per unit; rows/match/synced are worked out again whenever the feed changes (applyOutageSync).
  return {ok: true, source: SLDC_URL, fetched_at: nowText(), as_of: parsed.as_of, allRows: latest, rows: latest, match: matchOutages(latest), synced: [],
    duplicates: all.length - latest.length, all_rows: latestOutages(parsed.rows)};   // all_rows: every sector (Gujarat Power)
}

// ---------------------------------------------------------------- IEX prices (RTM / DAM, 15-min blocks)

const IEX_API = 'https://www.iexindia.com/api/v1/';

/** Minutes since midnight IST and the IST date as dd-mm-yyyy. */
function istNow() {
  const d = new Date(Date.now() + 5.5 * 3600e3);
  const p = n => String(n).padStart(2, '0');
  return {min: d.getUTCHours() * 60 + d.getUTCMinutes(), date: `${p(d.getUTCDate())}-${p(d.getUTCMonth() + 1)}-${d.getUTCFullYear()}`};
}

/** IEX market snapshot rows -> 96-slot array of MCP in Rs/MWh (null where not yet cleared). */
function iexBlocks(body) {
  const out = new Array(96).fill(null);
  const rows = JSON.parse(body).data || [];
  for (const r of rows) {
    const m = String(r.period || '').match(/^(\d{1,2}):(\d{2})/);
    const v = parseFloat(r.mcp);
    if (m && isFinite(v)) {
      const i = (+m[1] * 60 + +m[2]) / 15;
      if (i >= 0 && i < 96) out[i] = v;
    }
  }
  return out;
}

async function iexPrices() {
  const {min, date} = istNow();
  const q = `?interval=ONE_FOURTH_HOUR&fromDate=${date}&toDate=${date}`;
  const [r, d] = await Promise.all([httpGet(IEX_API + 'rtm/market-snapshot' + q, 30), httpGet(IEX_API + 'dam/market-snapshot' + q, 30)]);
  if (!r.ok && !d.ok) return {ok: false, error: r.error};
  let rtm = null, dam = null;
  try { if (r.ok) rtm = iexBlocks(r.body); } catch (e) { /* malformed RTM response */ }
  try { if (d.ok) dam = iexBlocks(d.body); } catch (e) { /* malformed DAM response */ }
  if (!rtm && !dam) return {ok: false, error: 'IEX returned data in an unexpected format.'};
  const cur = Math.floor(min / 15);
  // RTM clears ahead of delivery; if the current block is not cleared yet, use the latest cleared one before it.
  let rtmIdx = null;
  if (rtm) for (let i = cur; i >= 0; i--) if (rtm[i] !== null) { rtmIdx = i; break; }
  return {ok: true, fetched_at: nowText(), date, cur, rtm, dam, rtmIdx};
}

/** "13:00–13:15" for a 15-min block index. */
function blockLabel(i) {
  const p = n => String(n).padStart(2, '0');
  const a = i * 15, b = a + 15;
  return `${p(Math.floor(a / 60))}:${p(a % 60)}–${p(Math.floor(b / 60) % 24)}:${p(b % 60)}`;
}

/**
 * Finds SLDC's current merit-order PDF (linked in every page's menu). A revision not yet in the history is
 * downloaded, read on the phone with pdf.js and added to the history, so rate changes build up over time.
 */
async function sldcMeritCheck() {
  const res = await httpGet(SLDC_URL.replace('shutdownplanning.php', 'PreakHour.php'), 60);
  if (!res.ok) return {ok: false, error: res.error};
  const link = meritLink(res.body);
  if (!link) return {ok: false, error: 'Merit-order link not found on the SLDC page.'};
  const {url, file, stamp} = link;
  let date = stamp ? `${stamp.slice(6, 8)}.${stamp.slice(4, 6)}.${stamp.slice(0, 4)}` : '';
  const hist = refreshMerit();
  const seen = e => e.file === file || String(e.url || '').split('/').pop().toLowerCase() === file.toLowerCase();
  if (stamp && hist.some(seen)) return {ok: true, url, date, added: false, count: hist.length};
  try {
    const pdf = await httpGetBytes(url, 90);
    if (!pdf.ok) return {ok: false, url, date, error: `New merit order (${date || file}) could not be downloaded: ${pdf.error}`};
    const bytes = Uint8Array.from(atob(pdf.body), c => c.charCodeAt(0));
    const parsed = parseMeritLines(await pdfLines(await loadPdfJs(), bytes));
    date = parsed.asOf || date;
    if (Object.keys(parsed.blocks).length < 10)
      return {ok: false, url, date, error: `New merit order (${date}) could not be read — its layout may have changed.`};
    // A file name without a time stamp (Meritorder.pdf) is the same for every revision: compare the contents.
    const same = e => e.asOf === date && JSON.stringify(e.blocks) === JSON.stringify(parsed.blocks);
    if (!stamp && hist.some(same)) return {ok: true, url, date, added: false, count: hist.length};
    const d = date.replace(/\D/g, '');
    hist.push({fileDate: d.length === 8 ? d : stamp.slice(6, 8) + stamp.slice(4, 6) + stamp.slice(0, 4), stamp: stamp || '', file,
      asOf: date, total: parsed.total, url, blocks: parsed.blocks, all: parsed.all, fetchedAt: nowText(), source: 'SLDC PDF'});
    Native.storeSet('merit_history', JSON.stringify(hist));
    refreshMerit();
    return {ok: true, url, date, added: true, count: hist.length};
  } catch (e) {
    return {ok: false, url, date, error: `New merit order (${date}) could not be read: ${e.message}`};
  }
}

/**
 * The "Current Merit Order" link of SLDC's menu. Its file name changes with every revision and has changed form
 * over time: MeritOrder<ddmmyyyy><yyyymmddhhmmss>.pdf, now MOSLDC<yyyymmddhhmmss>.pdf. The link is found by its
 * caption, so any new name works; a time-stamped name is preferred to the fixed Meritorder.pdf of the footer.
 * stamp = the yyyymmddhhmmss in the name ('' if none), used to order revisions of the same day.
 */
function meritLink(html) {
  const links = [];
  const re = /<a[^>]+href\s*=\s*["']([^"']+\.pdf)["'][^>]*>([\s\S]{0,80}?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const href = m[1].trim(), text = m[2].replace(/<[^>]+>/g, ' ');
    if (/merit\s*order/i.test(text) || /realtimedata\/(mosldc|merit)/i.test(href)) links.push(href);
  }
  if (!links.length) return null;
  const info = href => {
    const file = href.split('/').pop();
    const t = file.match(/(20\d{12})\.pdf$/i);
    return {url: /^https?:/i.test(href) ? href : 'https://www.sldcguj.com/' + href.replace(/^\.?\//, ''), file, stamp: t ? t[1] : ''};
  };
  const all = links.map(info);
  return all.filter(l => l.stamp).sort((a, b) => b.stamp.localeCompare(a.stamp))[0] || all[0];
}

let pdfJsPromise = null;
/** pdf.js is bundled in assets/pdfjs and loaded only when a new merit order has to be read. The worker script is
 *  loaded on the page itself, which makes pdf.js run without a separate Web Worker. */
function loadPdfJs() {
  const load = src => new Promise((ok, bad) => {
    const s = document.createElement('script');
    s.src = src; s.onload = ok; s.onerror = () => bad(new Error('could not load ' + src));
    document.head.appendChild(s);
  });
  return pdfJsPromise ||= load('pdfjs/pdf.worker.min.js').then(() => load('pdfjs/pdf.min.js')).then(() => window.pdfjsLib);
}

// ---------------------------------------------------------------- merit-order PDF reader (pdf.js, loaded on demand)

/** GSECL rows of SLDC's merit-order list -> block key (+ fuel note for gas stations). Order matters: first match wins. */
const MERIT_PATTERNS = [
  [/^BLTPS\b/, 'BLTPS'],
  [/^WANAKBORI TPS-\s*8\b/, 'WTPS8'],
  [/^WANAKBORI TPS-\s*3\b/, 'WTPS_3'],
  [/^WANAKBORI TPS.*UNIT NO\s*7\b/, 'WTPS_7'],
  [/^WANAKBORI TPS.*UNIT NO\s*1\s*,\s*2/, 'WTPS_12456'],
  [/^UKAI\s*-\s*TPS\s*3\s*&\s*5\b/, 'UTPS_35'],
  [/^UKAI\s*-\s*TPS-?\s*6\b/, 'UTPS6'],
  [/^UKAI\s*-\s*TPS-?\s*4\b/, 'UTPS_4'],
  [/^GANDHINAGAR TPS.*UNIT NO\s*5\b/, 'GTPS5'],
  [/^GANDHINAGAR TPS.*UNIT NO\s*3\s*,\s*4\b/, 'GTPS34'],
  [/^KLTPS\s*3\b/, 'KLTPS1-3', 'KLTPS 3'],
  [/^KLTPS\s*4\b/, 'KLTPS4'],
  [/^SIKKA\b/, 'STPS_3_4'],
  [/^UTRAN-II.*HIGH SEAS/, 'UGBPS_2', 'High-seas gas'],
  [/^UTRAN-II.*SPOT/, 'UGBPS_2', 'GSPC spot gas'],
  [/^DHUVARAN CCPP-\s*III.*HIGH SEAS/, 'DGBPS_3', 'High-seas gas'],
  [/^DHUVARAN CCPP-\s*II\b.*HIGH SEAS/, 'DGBPS_2', 'High-seas gas'],
  [/^DHUVARAN CCPP-\s*III.*SPOT/, 'DGBPS_3', 'GSPC spot gas'],
  [/^DHUVARAN CCPP-\s*II\b.*SPOT/, 'DGBPS_2', 'GSPC spot gas'],
];

/** Rows "rank  NAME ...  cost  remarks" -> {blocks: {key: [[cost, rank, note?]]}, total, asOf}. */
function parseMeritLines(lines) {
  const blocks = {}, all = [];
  let total = 0, asOf = null;
  const joined = [];
  for (const raw of lines) {
    const t = raw.replace(/\s+/g, ' ').trim(), prev = joined[joined.length - 1];
    if (prev && /^(\d{1,3}\.\d{1,3}|NA)(\s|$)/i.test(t) && /^\d{1,3}\s+[A-Z]/i.test(prev) && !/\s(\d{1,3}\.\d{1,3}|NA)(\s|$)/i.test(prev))
      joined[joined.length - 1] = prev + ' ' + t;
    else joined.push(t);
  }
  for (const raw of joined) {
    const line = raw.replace(/\s+/g, ' ').trim();
    const d = line.match(/^(\d{2})[.\/-](\d{2})[.\/-](\d{4})$/);
    if (d && !asOf) asOf = `${d[1]}.${d[2]}.${d[3]}`;
    const m = line.match(/^(\d{1,3})\s+(.+?)\s+(\d{1,3}\.\d{1,3}|NA)(?:\s|$)/i);
    if (!m) continue;
    const rank = +m[1], name = m[2].toUpperCase(), cost = m[3].toUpperCase() === 'NA' ? null : +m[3];
    total = Math.max(total, rank);
    all.push([rank, m[2].trim(), cost, line.slice(m[0].length).trim()]);
    const p = MERIT_PATTERNS.find(([re]) => re.test(name));
    if (!p || cost === null) continue;
    const [, key, note] = p;
    (blocks[key] = blocks[key] || []).push(note ? [cost, rank, note] : [cost, rank]);
  }
  for (const k of Object.keys(blocks)) blocks[k].sort((a, b) => a[0] - b[0]);
  return {blocks, total, asOf, all};
}

/** pdf.js text items -> lines, grouping items on the same baseline (within 5 pt; rows are ~12.7 pt apart and some values sit ~3.4 pt low) left to right. */
async function pdfLines(pdfjs, bytes) {
  const doc = await pdfjs.getDocument({data: bytes, isEvalSupported: false, disableFontFace: true}).promise;
  const lines = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const tc = await (await doc.getPage(p)).getTextContent();
    const rows = [];
    for (const it of tc.items) {
      if (!it.str || !it.str.trim()) continue;
      const x = it.transform[4], y = it.transform[5];
      let r = rows.find(r => Math.abs(r.y - y) < 5);
      if (!r) rows.push(r = {y, parts: []});
      r.parts.push({x, s: it.str});
    }
    rows.sort((a, b) => b.y - a.y);
    for (const r of rows) lines.push(r.parts.sort((a, b) => a.x - b.x).map(q => q.s).join(' '));
  }
  return lines;
}

/** SG / DC of one gas fuel ("High-seas gas" / "GSPC spot gas") of a block, from the feed's fuel-wise lines. */
function fuelSgDc(snap, blockKey, note) {
  const fuelRe = /spot/i.test(note || '') ? /SPOT/ : /HIGH_SEA/;
  const pick = vals => {
    let sum = null;
    for (const [k, v] of Object.entries(vals || {})) if (k.startsWith(blockKey + '_') && fuelRe.test(k)) sum = (sum ?? 0) + v;
    return sum;
  };
  return {sg: pick(snap.feedSg), dc: pick(snap.feedDc)};
}
