// GSECL Connect for the web: keeps the app's own files on the device, so it opens quickly and without a network.
// Calls to the GSECL Connect service and data sources always go to the network (nothing of them is stored here).
const VERSION = '3.27.1-web-7f5a89ee0c';
const FILES = ["./", "admin2.js", "admin3.js", "app-main-1.js", "app-main-2.js", "apple-touch-icon.png", "ask.js", "chartint.js", "chat.js", "coal.js", "coalmap.js", "coalstock.js", "config.js", "connect.js", "dash2.js", "dashimp.js", "daypick.js", "dsm.js", "dsmlive.js", "genpages.js", "gsecl_logo.png", "gujarat.js", "gujtrend.js", "hysol.js", "icon-192.png", "icon-512.png", "icon-maskable.png", "index.html", "leaflet.css", "leaflet.js", "loadfc.js", "logic.js", "manifest.webmanifest", "mode.js", "paf.js", "plan.js", "profile.js", "projects.js", "sa.js", "safety.js", "srcmix.js", "stage3.js", "topbar.js", "trend.js", "viz.js", "web-bridge.js", "web-dsm.js", "web-start.js", "web.css", "work.js", "wtps8.js"];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== self.location.origin) return;     // the service and other sites: network only
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(hit => hit || fetch(e.request)));
});
