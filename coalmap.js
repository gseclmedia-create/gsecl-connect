// Coal "Map": the rakes in transit on a map, each at the station where the railway last confirmed
// it, with the rail routes to the plants drawn from the railway's own station coordinates.
// Uses K, kRakes, kInside, kRoute, kRouteOf, kProgress, kStations, kDay from coal.js and the bundled Leaflet (L).

const KM = {map: null, layer: null, view: null, station: '', busy: false};
// Leaflet draws with real colour values, so the plant colours are repeated here as hex.
const KM_COLOR = {UKAI: '#f97316', WTPS: '#3b82f6', GTPS: '#06b6d4', SIKKA: '#4f46e5'};
const KM_OTHER = '#475569', KM_STABLED = '#e11d48';
const kmColor = station => KM_COLOR[station] || KM_OTHER;
const kmOk = s => s && s.lat !== null && s.lng !== null && s.lat > 5 && s.lat < 38 && s.lng > 66 && s.lng < 99;   // inside India

/** Every station of the routes read so far, by code - a rake reported off its own route can still be placed. */
function kmStations() {
  const by = {};
  Object.values(K.routes).forEach(list => { if (Array.isArray(list)) list.forEach(s => { if (kmOk(s)) by[s.code.toUpperCase()] = s; }); });
  return by;
}

/** Where each in-transit rake is: {placed: [{station, rakes}], unplaced: [rakes]}. */
function kmPlaces() {
  const all = kmStations(), groups = {}, unplaced = [];
  kRakes().filter(r => !kInside(r) && (!KM.station || r.station_to === KM.station)).forEach(r => {
    const p = kProgress(r), code = (/[a-zA-Z]+/.exec(r.current_location || '') || [''])[0].toUpperCase();
    const at = p && kmOk(p.station) ? p.station : all[code];
    if (!at) return unplaced.push(r);
    (groups[at.code] = groups[at.code] || {station: at, rakes: []}).rakes.push(r);
  });
  return {placed: Object.values(groups), unplaced};
}

function kTabMap() {
  const transit = kRakes().filter(r => !kInside(r));
  if (!kRakes().length) return `<div class="card">${kEmpty('No rakes saved yet. Open Summary and tap “Refresh now”.')}</div>`;
  if (typeof L === 'undefined') return `<div class="card">${kEmpty('The map could not be started on this phone.')}</div>`;
  const st = kStations();
  return `<div class="chips">${[['', 'All plants']].concat(st.map(s => [s, s])).map(([v, l]) => `<button class="chip ${KM.station === v ? 'on' : ''}" data-kact="mapst" data-karg="${esc(v)}">${v ? `<i style="width:9px;height:9px;border-radius:50%;background:${kmColor(v)}"></i>` : ''}${esc(l)}</button>`).join('')}</div>
    <div class="card" style="padding:0;overflow:hidden"><div id="kMap" style="height:62vh;min-height:320px;max-height:560px;background:var(--soft)"></div></div>
    <div id="kMapInfo">${kmInfo(transit)}</div>`;
}

function kmInfo() {
  const {placed, unplaced} = kmPlaces(), n = placed.reduce((t, g) => t + g.rakes.length, 0);
  const pairs = [...new Set(kRakes().filter(r => !kInside(r) && r.station_from).map(r => r.station_from + '|' + r.station_to))];
  const waiting = pairs.filter(p => K.routes[p] === undefined || K.routes[p] === 'wait').length;
  return `<div class="card"><h2>${n} rake${n === 1 ? '' : 's'} on the map ${kMore(K.data.last_sync ? 'synced ' + K.data.last_sync : '')}</h2>
      <div class="keyline" style="margin-top:0">${Object.entries(KM_COLOR).map(([k, c]) => `<span><i style="width:10px;height:10px;border-radius:50%;background:${c}"></i>to ${k}</span>`).join('')}
        <span><i style="width:10px;height:10px;border-radius:50%;background:#fff;border:3px solid ${KM_STABLED};box-sizing:border-box"></i>stabled</span><span><i style="width:10px;height:10px;border-radius:2px;background:var(--ink)"></i>plant</span></div>
      <div class="note-src">${waiting ? `Reading ${waiting} route${waiting > 1 ? 's' : ''} from the railway… ` : ''}A rake is shown at the station where the railway last confirmed it, not at its exact position between stations. A number means several rakes at one station; touch a marker for the rakes.</div></div>
    ${unplaced.length ? `<div class="card"><h2>Not on the map (${unplaced.length})</h2><div class="note-src" style="margin:0 0 6px">The railway's reported location for these is not a station on a route read so far.</div>${unplaced.map(r => `<div class="srow" data-kact="rake" data-karg="${r.id}"><div class="top"><span class="nm">${esc(r.rake_name || r.load_name)}</span><span class="vals">${esc(r.station_to)} ›</span></div><div class="vals">${esc([r.station_from && 'from ' + r.station_from, r.current_location && 'reported at ' + r.current_location, r.expected_arrival && 'expected ' + r.expected_arrival].filter(Boolean).join(' · '))}</div></div>`).join('')}</div>` : ''}`;
}

/** Creates the map in the freshly drawn tab (the tab's HTML is rebuilt on every redraw of the Coal view). */
function kmAfterRender() {
  const box = $('kMap');
  if (!box) { if (KM.map) { KM.map.remove(); KM.map = null; } return; }
  if (KM.map && KM.map.getContainer() === box) return kmLayers();
  if (KM.map) KM.map.remove();
  const map = KM.map = L.map(box, {zoomControl: true, attributionControl: true, minZoom: 4, maxZoom: 14, maxBounds: [[4, 60], [40, 102]]});
  map.attributionControl.setPrefix(false);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {maxZoom: 19, attribution: '© OpenStreetMap contributors', referrerPolicy: 'strict-origin-when-cross-origin'}).addTo(map);   // OpenStreetMap's tile policy asks for the site's address
  KM.layer = L.layerGroup().addTo(map);
  if (KM.view) map.setView(KM.view.c, KM.view.z); else map.setView([22.2, 78.5], 5);
  map.on('moveend', () => { KM.view = {c: map.getCenter(), z: map.getZoom(), touched: KM.view ? KM.view.touched : false}; });
  map.on('dragstart zoomstart', () => { if (KM.view) KM.view.touched = true; else KM.view = {c: map.getCenter(), z: map.getZoom(), touched: true}; });
  map.on('popupopen', e => e.popup.getElement().querySelectorAll('[data-kmrake]').forEach(a => a.addEventListener('click', () => { map.closePopup(); document.querySelector(`[data-kmgo="${a.dataset.kmrake}"]`)?.click(); })));
  kmLayers(true);
  kmWarm();
}

/** Routes, plants and rake markers; called again as routes arrive, without rebuilding the map. */
function kmLayers(fit = false) {
  if (!KM.map) return;
  KM.layer.clearLayers();
  const bounds = [], shownRoutes = new Set();
  kRakes().filter(r => !kInside(r) && r.station_from && (!KM.station || r.station_to === KM.station)).forEach(r => {
    const key = r.station_from + '|' + r.station_to, route = kRouteOf(r);
    if (!route || shownRoutes.has(key)) return;
    shownRoutes.add(key);
    const pts = route.filter(kmOk).map(s => [s.lat, s.lng]);
    if (pts.length < 2) return;
    L.polyline(pts, {color: kmColor(r.station_to), weight: 3, opacity: 0.55, interactive: false}).addTo(KM.layer);
    pts.forEach(p => bounds.push(p));
    // The plant is the end of the route; the siding where loading was done is its start.
    const inside = kRakes().filter(x => kInside(x) && x.station_to === r.station_to).length;
    L.marker(pts[pts.length - 1], {interactive: false, icon: L.divIcon({className: '', iconSize: [0, 0], html: `<div class="km-plant">${esc(r.station_to)}${inside ? ` · ${inside} inside` : ''}</div>`})}).addTo(KM.layer);
    L.circleMarker(pts[0], {radius: 4, color: kmColor(r.station_to), weight: 2, fillColor: '#fff', fillOpacity: 1, interactive: false}).addTo(KM.layer);
  });
  kmPlaces().placed.forEach(g => {
    const dests = [...new Set(g.rakes.map(r => r.station_to))], stabled = g.rakes.some(r => (r.status_code || '').toUpperCase() === 'ST');
    const html = `<div class="km-dot" style="background:${dests.length === 1 ? kmColor(dests[0]) : KM_OTHER};${stabled ? `border-color:${KM_STABLED}` : ''}">${g.rakes.length > 1 ? g.rakes.length : ''}</div>`;
    L.marker([g.station.lat, g.station.lng], {icon: L.divIcon({className: '', iconSize: [26, 26], iconAnchor: [13, 13], html})}).addTo(KM.layer)
      .bindPopup(`<b>${esc(g.station.name || g.station.code)}</b> (${esc(g.station.code)})` + g.rakes.map(r => `<div class="km-row" data-kmrake="${r.id}"><b>${esc(r.rake_name || r.load_name)}</b> → ${esc(r.station_to)}<br>${esc([r.mapped_consignor, [r.status_code, r.status_time].filter(Boolean).join(' '), r.expected_arrival && 'expected ' + r.expected_arrival].filter(Boolean).join(' · '))}</div>`).join(''), {maxWidth: 260, maxHeight: 240});
    bounds.push([g.station.lat, g.station.lng]);
  });
  // Until the map has been moved by hand it keeps everything in view as routes arrive.
  if (bounds.length && (fit || !KM.view || !KM.view.touched)) KM.map.fitBounds(bounds, {padding: [28, 28], maxZoom: 9, animate: false});
  // Hidden links that the popups use to open a rake's page through the normal Coal click handling.
  const info = $('kMapInfo');
  if (info) info.innerHTML = kmInfo() + kRakes().filter(r => !kInside(r)).map(r => `<span hidden data-kmgo="${r.id}" data-kact="rake" data-karg="${r.id}"></span>`).join('');
}

/** Reads the route of every in-transit rake (one request per source and plant), drawing each as it arrives. */
async function kmWarm() {
  if (KM.busy) return;
  KM.busy = true;
  const pairs = [...new Set(kRakes().filter(r => !kInside(r) && r.station_from).map(r => r.station_from + '|' + r.station_to))].filter(p => K.routes[p] === undefined);
  for (const p of pairs) {
    const [from, to] = p.split('|');
    await kRoute(from, to);
    if (K.tab === 'map' && !K.detail) kmLayers();
  }
  KM.busy = false;
  if (K.tab === 'map' && !K.detail) kmLayers();
}
