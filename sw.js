/* Garde l'appli sur le téléphone pour qu'elle s'ouvre sans réseau. Les données passent par backend.js. */
const VERSION = "b9be9a335f13";
const CACHE = "budget-" + VERSION, FONTS = "budget-fonts";
const FILES = ["./", "index.html", "backend.js", "config.js", "manifest.webmanifest", "icon-192.png", "icon-512.png", "apple-touch-icon.png"];

self.addEventListener("install", ev => {
  ev.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES.map(f => new Request(f, { cache: "reload" })))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", ev => {
  ev.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== FONTS).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", ev => {
  if (ev.request.method !== "GET") return;
  const url = new URL(ev.request.url);
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    ev.respondWith(caches.open(FONTS).then(c => c.match(ev.request).then(hit => hit || fetch(ev.request).then(res => { c.put(ev.request, res.clone()); return res; }))));
    return;
  }
  if (url.origin !== location.origin) return;
  ev.respondWith(caches.open(CACHE).then(c => c.match(ev.request, { ignoreSearch: true }).then(hit => hit || (ev.request.mode === "navigate" ? c.match("index.html") : null)).then(hit => hit || fetch(ev.request))));
});
