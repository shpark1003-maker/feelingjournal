const webpush = require('web-push');

const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
const vapidSubject = process.env.VAPID_SUBJECT || process.env.VAPID_EMAIL;

const pushEnabled = !!vapidPublicKey && !!vapidPrivateKey && !!vapidSubject;

if (pushEnabled) {
    try {
        webpush.setVapidDetails(
            vapidSubject,
            vapidPublicKey,
            vapidPrivateKey
        );
        console.log('--- [PushService] Web Push VAPID settings initialized successfully. ---');
    } catch (e) {
        console.error('--- [PushService] VAPID initialization failed:', e.message);
    }
} else {
    console.warn('--- [PushService] Web Push VAPID keys or subject missing. Push is disabled. ---');
}

/**
 * Check if push is enabled.
 */
function isPushEnabled() {
    return pushEnabled;
}

/**
 * Get the VAPID public key.
 */
function getVapidPublicKey() {
    return vapidPublicKey || null;
}

/**
 * Send web push notification to a specific subscription.
 */
async function sendNotification(subscription, payload) {
    if (!pushEnabled) {
        console.warn('[PushService] Cannot send notification. Push is disabled.');
        return false;
    }
    try {
        await webpush.sendNotification(subscription, JSON.stringify(payload));
        return true;
    } catch (err) {
        console.error('[PushService] Push failed:', err.message);
        throw err;
    }
}

/**
 * Send web push notifications to all subscriptions of a user config.
 */
async function sendToUserSubscriptions(config, payload) {
    if (!pushEnabled) return 0;
    if (!config || !config.subscriptions || config.subscriptions.length === 0) {
        return 0;
    }

    let successCount = 0;
    const activeSubs = [];

    for (const sub of config.subscriptions) {
        try {
            await sendNotification(sub, payload);
            successCount++;
            activeSubs.push(sub);
        } catch (err) {
            // If subscription is expired/unregistered (404 or 410 Gone), remove it
            if (err.statusCode === 404 || err.statusCode === 410) {
                console.log(`[PushService] Removing expired subscription for ${config.email || 'user'}:`, sub.endpoint);
            } else {
                // Otherwise keep it
                activeSubs.push(sub);
            }
        }
    }

    // If some subscriptions were deleted due to expiration, we should save the cleaned list
    if (activeSubs.length !== config.subscriptions.length) {
        config.subscriptions = activeSubs;
    }

    return successCount;
}

module.exports = {
    isPushEnabled,
    getVapidPublicKey,
    sendNotification,
    sendToUserSubscriptions
};
