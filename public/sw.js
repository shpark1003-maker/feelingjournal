// Feeling Journal Service Worker - Push & Cache Purge Enabled (sw.js)

self.addEventListener('install', (event) => {
    console.log('[SW] Installing Service Worker...');
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    console.log('[SW] Activating Service Worker & Purging Caches...');
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    console.log('[SW] Deleting cache:', cacheName);
                    return caches.delete(cacheName);
                })
            );
        }).then(() => {
            console.log('[SW] Cache purge complete. Claiming clients...');
            return self.clients.claim();
        })
    );
});

// 백그라운드 웹 푸시 알림 수신 리스너
self.addEventListener('push', (event) => {
    console.log('[SW] Push notification received.');
    let data = { title: '🎩 오늘의 수석 비서관 브리핑', body: '새로운 브리핑이 도착했습니다.' };
    
    if (event.data) {
        try {
            data = event.data.json();
        } catch (e) {
            data = { title: '🎩 오늘의 수석 비서관 브리핑', body: event.data.text() };
        }
    }

    const options = {
        body: data.body || '',
        icon: '/icon-512.png',
        badge: '/icon-512.png',
        vibrate: [100, 50, 100],
        data: {
            url: data.url || '/'
        }
    };

    event.waitUntil(
        self.registration.showNotification(data.title, options)
    );
});

// 알림 클릭 핸들러 - 브리핑 화면으로 이동
self.addEventListener('notificationclick', (event) => {
    console.log('[SW] Notification clicked.');
    event.notification.close();

    const targetUrl = event.notification.data.url || '/';

    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
            // 이미 켜진 창이 있으면 포커스
            for (const client of clientList) {
                if (client.url && 'focus' in client) {
                    return client.focus();
                }
            }
            // 없으면 새 창 열기
            if (self.clients.openWindow) {
                return self.clients.openWindow(targetUrl);
            }
        })
    );
});
