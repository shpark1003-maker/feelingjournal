// Feeling Journal Service Worker (sw.js)

self.addEventListener('install', (event) => {
    console.log('[SW] Service Worker installed');
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    console.log('[SW] Service Worker activated');
});

// 서버에서 보낸 푸시 알림 처리
self.addEventListener('push', (event) => {
    let data = { title: 'Feeling Journal', body: '기록할 시간입니다!' };
    try {
        if (event.data) {
            data = event.data.json();
        }
    } catch (e) {
        data.body = event.data.text();
    }

    const options = {
        body: data.body,
        icon: '/icon-192.png', // 아이콘 경로가 있다면
        badge: '/icon-192.png',
        vibrate: [200, 100, 200],
        data: {
            url: self.location.origin
        }
    };

    event.waitUntil(
        self.registration.showNotification(data.title, options)
    );
});

// 알림 클릭 시 앱으로 이동
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    event.waitUntil(
        clients.openWindow(event.notification.data.url)
    );
});
