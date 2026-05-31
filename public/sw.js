// Feeling Journal Service Worker - Self-Unregister Kill Switch (sw.js)
// 강력한 로컬 브라우저 캐시 감옥을 분쇄하고 강제 최신 릴리스 v5.0.9 새로고침을 실행합니다.

self.addEventListener('install', (event) => {
    console.log('[SW] Kill Switch Activated. Installing...');
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    console.log('[SW] Kill Switch Activated. Unregistering and clearing caches...');
    event.waitUntil(
        self.registration.unregister()
            .then(() => {
                return caches.keys().then((cacheNames) => {
                    return Promise.all(
                        cacheNames.map((cacheName) => {
                            console.log('[SW] Deleting cache:', cacheName);
                            return caches.delete(cacheName);
                        })
                    );
                });
            })
            .then(() => self.clients.matchAll())
            .then((clients) => {
                clients.forEach((client) => {
                    if (client.url && 'navigate' in client) {
                        console.log('[SW] Force reloading client to grab V1.0 v5.0.8 assets...');
                        client.navigate(client.url);
                    }
                });
            })
    );
});
