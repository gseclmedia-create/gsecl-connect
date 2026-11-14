// Coal and Chat, graphics first (4.3): charts above the existing tables and lists (coal.js, coalstock.js, chat.js
// unchanged underneath). Coal stock: days of coal per plant as gauges, receipt against consumption. Rake summary:
// inside / in transit, coal category, today's received and released per station. Forecast: arrivals per day and
// station. Chat: a header with chats, unread and groups. Uses viz.js, esc, fmt.

const S3_DAY_COL = ['#1d4ed8', '#2563eb', '#3b82f6', '#60a5fa', '#93c5fd', '#bfdbfe'];
const s3Insert = (h, marker, add) => { const i = h.indexOf(marker); return i >= 0 ? h.slice(0, i) + add + h.slice(i) : h + add; };

// ---- coal stock: days of coal and the day's receipt against consumption
if (typeof sTabStock === 'function') {
  const sTabStock0 = sTabStock;
  // eslint-disable-next-line no-global-assign
  sTabStock = function () {
    const h = sTabStock0();
    try {
      if (!SP.data || typeof vzRing !== 'function') return h;
      const dates = [...new Set(spStock().map(r => r.date))].sort().reverse(), date = dates.includes(SP.date) ? SP.date : spLatest();
      if (!date) return h;
      const rows = SP.data.plants.map(p => spOn(spStock(), date).find(r => r.plant === p)).filter(Boolean);
      if (!rows.length) return h;
      const tone = d => (d < 5 ? 'bad' : d < 10 ? 'warn' : 'ok');
      const card = `<div class="card"><h2>Days of coal at each station <span class="more muted" style="font-weight:500;font-size:11.5px">${spDate(date)}</span></h2>
        <div class="vz-rings">${rows.map(r => { const d = +r.availability_days || 0, cap = +r.max_capacity_days || 30;
          return vzRing(Math.min(100, d / cap * 100), {text: fmt(d, 1), label: r.plant, sub: 'days of ' + (r.max_capacity_days ? fmt(cap) : '30'), tone: tone(d), size: 80, stroke: 9}); }).join('')}</div>
        <div class="keyline" style="justify-content:center"><span><i style="width:10px;height:10px;border-radius:50%;background:#be123c"></i>under 5 days</span><span><i style="width:10px;height:10px;border-radius:50%;background:#d97706"></i>5–10</span><span><i style="width:10px;height:10px;border-radius:50%;background:#15803d"></i>10 and more</span></div></div>
        <div class="card"><h2>Received against burnt <span class="more muted" style="font-weight:500;font-size:11.5px">MT that day · ▮ consumption</span></h2>
        ${vzBars(rows.map(r => ({k: r.plant, v: +r.receipt || 0, mark: +r.consumption || 0, label: '+' + spMt(r.receipt, 0) + ' / −' + spMt(r.consumption, 0), c: (+r.receipt || 0) >= (+r.consumption || 0) ? '#15803d' : '#be123c'})),
          {max: Math.max(...rows.map(r => Math.max(+r.receipt || 0, +r.consumption || 0)), 1)})}
        <div class="note-src">Green: more coal came in than was burnt that day; red: the stock went down.</div></div>`;
      return s3Insert(h, '<div class="card"><h2>GSECL coal stock position', card);
    } catch (e) { return h; }
  };
}

// ---- rake summary: inside / in transit, categories, today's movements
if (typeof kTabSum === 'function') {
  const kTabSum0 = kTabSum;
  // eslint-disable-next-line no-global-assign
  kTabSum = function () {
    const h = kTabSum0();
    try {
      const rakes = kRakes();
      if (!rakes.length || typeof vzDonut !== 'function') return h;
      const inside = rakes.filter(kInside).length, st = kStations(), cat = {};
      rakes.forEach(r => { const k = r.consignor_category || 'Other'; cat[k] = (cat[k] || 0) + 1; });
      const today = kEvents(kToday(), kToday());
      const card = `<div class="card"><h2>Rakes now</h2><div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center">
          <div style="flex:1;min-width:160px">${vzDonut([{k: 'Inside station', n: inside, c: '#15803d'}, {k: 'In transit', n: rakes.length - inside, c: '#4f46e5'}], {label: 'rakes', size: 100, stroke: 15})}</div>
          <div style="flex:1;min-width:160px">${vzDonut(Object.keys(cat).map(k => ({k, n: cat[k], c: (K_CAT_COLOR[k] || '').startsWith('var') ? undefined : K_CAT_COLOR[k]})), {label: 'by coal', size: 100, stroke: 15})}</div></div></div>
        <div class="card"><h2>Rakes by station</h2>${vzStack(st.map(s => { const all = rakes.filter(r => r.station_to === s), ins = all.filter(kInside).length; return {k: s, parts: [ins, all.length - ins], act: `data-kact="station" data-karg="${esc(s)}"`}; }),
          [{k: 'Inside', c: '#15803d'}, {k: 'In transit', c: '#4f46e5'}])}</div>
        ${today.length ? `<div class="card"><h2>Today's movements</h2>${vzStack(st.map(s => ({k: s, parts: [today.filter(e => e.station === s && e.type === 'RECEIVED').length, today.filter(e => e.station === s && e.type === 'RELEASED').length]})).filter(r => r.parts[0] + r.parts[1]),
          [{k: 'Received', c: '#0f766e'}, {k: 'Released', c: '#d97706'}])}</div>` : ''}`;
      // the text bars of "Rakes by station" give way to the chart
      const a = h.indexOf('<div class="card"><h2>Rakes by station'), b = a >= 0 ? h.indexOf('<div class="card"><h2>By washery', a) : -1;
      const rest = a >= 0 && b > a ? h.slice(0, a) + h.slice(b) : h;
      return s3Insert(rest, '<div class="card"><h2>By washery', card);
    } catch (e) { return h; }
  };
}

// ---- arrivals forecast: stacked by day per station, then the table
if (typeof kTabForecast === 'function') {
  const kTabForecast0 = kTabForecast;
  // eslint-disable-next-line no-global-assign
  kTabForecast = function () {
    const h = kTabForecast0();
    try {
      const rakes = kRakes(), st = kStations();
      if (!rakes.length || typeof vzStack !== 'function') return h;
      const days = [0, 1, 2, 3, 4, 5].map(kToday), cell = (s, d) => rakes.filter(r => r.station_to === s && !kInside(r) && kIso(r.expected_arrival) === d).length;
      const tot = days.map(d => st.reduce((t, s) => t + cell(s, d), 0));
      return `<div class="card"><h2>Rakes expected per day</h2>${vzCols(days.map((d, i) => ({k: i ? 'D+' + i : 'Today', v: tot[i], c: S3_DAY_COL[i]})), {h: 100})}</div>
        <div class="card"><h2>By station, next 6 days</h2>${vzStack(st.map(s => ({k: s, parts: days.map(d => cell(s, d))})).filter(r => r.parts.some(Boolean)), days.map((d, i) => ({k: i ? 'D+' + i : 'Today', c: S3_DAY_COL[i]})), {empty: 'No rake expected in the next 6 days.'})}</div>` + h;
    } catch (e) { return h; }
  };
}

// ---- chat: a header with the counts
if (typeof chListHtml === 'function') {
  const chListHtml0 = chListHtml;
  // eslint-disable-next-line no-global-assign
  chListHtml = function () {
    const h = chListHtml0();
    try {
      const unread = H.convs.reduce((t, c) => t + (chUnread(c) || 0), 0), groups = H.convs.filter(c => c.kind === 'group').length;
      const a = h.indexOf('<div class="chhead">'), b = h.indexOf('</div>\n', h.indexOf('data-hact="group"', a));
      if (a < 0 || b < 0) return h;
      return h.slice(0, a) + `<div class="ch-hero"><div class="ch-ht"><b>Chat</b><span>🔒 End-to-end encrypted · only the people in a chat can read it</span></div>
          <div class="ch-hs"><div><b class="num">${fmt(H.convs.length)}</b><span>chats</span></div><div><b class="num">${fmt(unread)}</b><span>unread</span></div><div><b class="num">${fmt(groups)}</b><span>groups</span></div></div>
          <div class="ch-ha"><button data-hact="new">＋ New chat</button><button data-hact="group">👥 New group</button></div></div>` + h.slice(b + 7);
    } catch (e) { return h; }
  };
}
