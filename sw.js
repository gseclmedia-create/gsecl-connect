// GSECL Connect for the web: keeps the app's own files on the device, so it opens quickly and without a network.
// Calls to the GSECL Connect service and data sources always go to the network (nothing of them is stored here).
const VERSION = '3.13.8-web-ccb21cc5ba';
const FILES = ["./", "apple-touch-icon.png", "chat.js", "coal.js", "coalmap.js", "coalstock.js", "config.js", "connect.js", "dsm.js", "gsecl_logo.png", "icon-192.png", "icon-512.png", "icon-maskable.png", "index.html", "leaflet.css", "leaflet.js", "logic.js", "manifest.webmanifest", "paf.js", "plan.js", "safety.js", "trend.js", "web-bridge.js", "web-dsm.js", "web-start.js", "web.css", "work.js"];

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
