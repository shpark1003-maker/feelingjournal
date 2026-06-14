const { redis, scanRedisKeys } = require('../_routes/shared');

/**
 * Get push configurations and subscriptions for a user.
 * Supports fallback and automatic migration from the legacy `user:${userId}:push-config` key.
 */
async function getUserSubscriptions(userId) {
    const newKey = `user:${userId}:push-subscriptions`;
    const oldKey = `user:${userId}:push-config`;

    let rawData = await redis.get(newKey);
    if (rawData) {
        return JSON.parse(rawData);
    }

    // Fallback/Migration logic
    const oldRawData = await redis.get(oldKey);
    if (oldRawData) {
        try {
            const oldConfig = JSON.parse(oldRawData);
            // Convert old format to list of subscriptions
            const migrated = {
                settings: oldConfig.settings || {
                    alarm60: false,
                    alarm30: true,
                    alarm10: true,
                    briefingTime: '08:00',
                    weatherRegion: '서울',
                    newsCategories: ['business']
                },
                email: oldConfig.email || '',
                providerToken: oldConfig.providerToken || '',
                subscriptions: oldConfig.subscription ? [oldConfig.subscription] : []
            };
            
            // Save to new key
            await redis.set(newKey, JSON.stringify(migrated));
            // Cleanup old key
            await redis.del(oldKey);
            return migrated;
        } catch (e) {
            console.error(`[PushRepository] Migration failed for user ${userId}:`, e);
        }
    }

    // Default configuration if nothing exists
    return {
        settings: {
            alarm60: false,
            alarm30: true,
            alarm10: true,
            briefingTime: '08:00',
            weatherRegion: '서울',
            newsCategories: ['business']
        },
        email: '',
        providerToken: '',
        subscriptions: []
    };
}

/**
 * Save configurations and subscriptions for a user.
 */
async function saveUserSubscriptions(userId, config) {
    const key = `user:${userId}:push-subscriptions`;
    await redis.set(key, JSON.stringify(config));
}

/**
 * Upsert a subscription endpoint and update settings.
 * Ensures no duplicate subscription endpoints exist.
 */
async function upsertSubscription(userId, subscription, settings, email, providerToken) {
    const config = await getUserSubscriptions(userId);

    // Update settings and metadata
    if (settings) {
        config.settings = { ...config.settings, ...settings };
    }
    if (email) {
        config.email = email;
    }
    if (providerToken && providerToken !== 'mock' && providerToken !== 'null' && providerToken !== 'undefined') {
        config.providerToken = providerToken;
    }

    // Upsert subscription based on endpoint
    if (subscription && subscription.endpoint) {
        if (!config.subscriptions) {
            config.subscriptions = [];
        }
        const index = config.subscriptions.findIndex(sub => sub.endpoint === subscription.endpoint);
        if (index > -1) {
            // Update existing subscription metadata
            config.subscriptions[index] = subscription;
        } else {
            // Append new subscription
            config.subscriptions.push(subscription);
        }
    }

    await saveUserSubscriptions(userId, config);
    return config;
}

/**
 * Scan all keys and fetch all active push configs/subscriptions.
 * Seamlessly handles legacy keys for active briefings.
 */
async function getAllUsersSubscriptions() {
    const newKeys = await scanRedisKeys('user:*:push-subscriptions');
    const oldKeys = await scanRedisKeys('user:*:push-config');
    
    const results = [];
    const processedUserIds = new Set();

    // Process new key format
    for (const key of newKeys) {
        const userId = key.split(':')[1];
        if (processedUserIds.has(userId)) continue;
        
        try {
            const config = await getUserSubscriptions(userId);
            results.push({ userId, config });
            processedUserIds.add(userId);
        } catch (err) {
            console.error(`Error loading subscriptions for user ${userId}:`, err.message);
        }
    }

    // Process legacy key format for backward compatibility
    for (const key of oldKeys) {
        const userId = key.split(':')[1];
        if (processedUserIds.has(userId)) continue;

        try {
            const config = await getUserSubscriptions(userId);
            results.push({ userId, config });
            processedUserIds.add(userId);
        } catch (err) {
            console.error(`Error loading/migrating legacy config for user ${userId}:`, err.message);
        }
    }

    return results;
}

module.exports = {
    getUserSubscriptions,
    saveUserSubscriptions,
    upsertSubscription,
    getAllUsersSubscriptions
};
