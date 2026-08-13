const CACHE = 'afternoon-v2';

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE)
            .then((cache) => cache.addAll(['/', '/manifest.webmanifest']))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);
    if (event.request.method !== 'GET' || url.origin !== location.origin) return;

    // page and score: network first so a new deploy (or a rewritten composition)
    // is picked up right away, cache fallback when offline
    if (event.request.mode === 'navigate' || url.pathname.endsWith('.json')) {
        const key = event.request.mode === 'navigate' ? '/' : event.request;

        event.respondWith(
            fetch(event.request).then((response) => {
                const copy = response.clone();
                caches.open(CACHE).then((cache) => cache.put(key, copy));
                return response;
            }).catch(() => caches.match(key))
        );
        return;
    }

    // assets (audio, css, js, fonts): cache first; the audio gets cached while
    // you listen, so after one session the whole site works offline
    event.respondWith(
        caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
            if (response.ok) {
                const copy = response.clone();
                caches.open(CACHE).then((cache) => cache.put(event.request, copy));
            }
            return response;
        }))
    );
});
