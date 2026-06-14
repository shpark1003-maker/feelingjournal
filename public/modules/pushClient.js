import { API_URL } from './state.js?v=5.5.2';

/**
 * Convert VAPID public key base64 string to Uint8Array.
 */
function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding)
        .replace(/-/g, '+')
        .replace(/_/g, '/');

    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);

    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}

/**
 * Check if the browser supports Service Workers and Push notifications.
 */
function isPushSupported() {
    return 'serviceWorker' in navigator && 'PushManager' in window;
}

/**
 * Registers the Service Worker and requests push subscription.
 * Handles permission denials gracefully by returning null instead of throwing error.
 */
export async function registerDailyBriefingPush(vapidPublicKey) {
    if (!isPushSupported()) {
        console.warn('[PushClient] Browser does not support service workers or push notifications.');
        return null;
    }

    if (!vapidPublicKey) {
        console.warn('[PushClient] VAPID public key is missing from server.');
        return null;
    }

    try {
        // 1. 서비스 워커 등록
        console.log('[PushClient] Registering Service Worker...');
        const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
        console.log('[PushClient] Service Worker registered. Scope:', registration.scope);

        // 2. 알림 권한 확인 및 요청
        let permission = Notification.permission;
        if (permission === 'default') {
            console.log('[PushClient] Requesting Notification permission...');
            permission = await Notification.requestPermission();
        }

        if (permission !== 'granted') {
            console.warn('[PushClient] Notification permission was denied by user:', permission);
            return null;
        }

        // 3. 브라우저 푸시 구독 정보 생성
        console.log('[PushClient] Subscribing user to push manager...');
        const convertedKey = urlBase64ToUint8Array(vapidPublicKey);
        
        const subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: convertedKey
        });

        console.log('[PushClient] Successfully generated push subscription:', subscription.endpoint);
        return subscription;
    } catch (error) {
        console.error('[PushClient] Failed to register push subscription:', error);
        // Gracefully return null so that settings can still be saved
        return null;
    }
}
