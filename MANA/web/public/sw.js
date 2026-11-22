// MANA service worker: offline shell + Web Push (works while the app is closed, when the device allows it)
const CACHE = 'mana-shell-v1';
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/', '/icons/icon.svg'])).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/')) return;   // never cache API (private data)
  if (e.request.mode === 'navigate') { e.respondWith(fetch(e.request).catch(() => caches.match('/'))); return; }
  e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((r) => { if (r.ok && u.pathname.startsWith('/assets/')) { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, cp)); } return r; })));
});
self.addEventListener('push', (e) => {
  let d = {}; try { d = e.data.json(); } catch { d = { title: 'MANA', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'MANA', { body: d.body, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', tag: d.id, lang: 'fa', dir: 'rtl', data: { id: d.id, url: d.url || '/' }, requireInteraction: true,
    actions: [{ action: 'done', title: 'انجام شد ✅' }, { action: 'snooze', title: '۱۰ دقیقه بعد ⏰' }] }));
});
self.addEventListener('notificationclick', (e) => {
  const { id, url } = e.notification.data || {}; e.notification.close();
  const post = (p, body) => fetch(`/api/notifications/${id}/${p}`, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-requested-with': 'mana' }, body: JSON.stringify(body || {}) }).catch(() => {});
  if (e.action === 'done') { e.waitUntil(post('done')); return; }
  if (e.action === 'snooze') { e.waitUntil(post('snooze', { minutes: 10 })); return; }
  e.waitUntil(post('seen').then(() => self.clients.matchAll({ type: 'window' })).then((cs) => { for (const c of cs) if ('focus' in c) return c.focus(); return self.clients.openWindow(url || '/'); }));
});
