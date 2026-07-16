const { redis } = require('../_routes/shared');

function parseJson(raw) {
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch (err) {
        return null;
    }
}

function pickConsentFromObject(obj) {
    if (!obj || typeof obj !== 'object') return null;

    // Current shape: push-subscriptions -> settings.aiConsent
    if (typeof obj?.settings?.aiConsent === 'boolean') {
        return obj.settings.aiConsent;
    }

    // Legacy/fallback shapes
    if (typeof obj?.aiConsent === 'boolean') {
        return obj.aiConsent;
    }

    return null;
}

async function getAiConsentStatus(userId) {
    if (!userId || !redis) return false;

    const keys = [
        `user:${userId}:push-subscriptions`,
        `user:${userId}:push-config`,
        `user:${userId}:api-settings`
    ];

    for (const key of keys) {
        const parsed = parseJson(await redis.get(key));
        const consent = pickConsentFromObject(parsed);
        if (typeof consent === 'boolean') {
            return consent;
        }
    }

    return false;
}

module.exports = {
    getAiConsentStatus
};
