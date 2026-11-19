// Offline cache for the app shell only. User data never goes through here.
const V = 'helper-v31';
const FILES = ['./', 'index.html', 'style.css', 'crypto.js', 'logic.js', 'app.js', 'github.js', 'chat.js', 'manifest.webmanifest', 'icon.svg'];
self.addEventListener('install', e => e.waitUntil(caches.open(V).then(c => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return; // never cache API data
  // cache:'no-cache' revalidates with the server, so every start gets the latest deployed files.
  e.respondWith(fetch(e.request, { cache: 'no-cache' }).then(r => { const c = r.clone(); caches.open(V).then(x => x.put(e.request, c)); return r; }).catch(() => caches.match(e.request)));
});
// Web Push from the Raspberry Pi (pi/notify.mjs). Payload is neutral text only.
self.addEventListener('push', e => { const d = (() => { try { return e.data.json(); } catch { return { body: e.data?.text() }; } })();
  e.waitUntil(self.registration.showNotification(d.title || 'Помічник', { body: d.body || '', icon: 'icon.svg', tag: d.tag || 'helper' })); });
self.addEventListener('notificationclick', e => { e.notification.close();
  e.waitUntil(clients.matchAll({ type: 'window' }).then(ws => ws.length ? ws[0].focus() : clients.openWindow('./'))); });
