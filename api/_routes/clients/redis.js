const Redis = require('ioredis');

let redis;

if (process.env.VERCEL) {
    if (!global.redisInstance) {
        global.redisInstance = new Redis(process.env.REDIS_URL, {
            connectTimeout: 5000,
            maxRetriesPerRequest: 1
        });
        global.redisInstance.on('error', (err) => {
            console.error('Redis Client Error:', err);
        });
    }
    redis = global.redisInstance;
} else {
    redis = new Redis(process.env.REDIS_URL, {
        connectTimeout: 5000,
        maxRetriesPerRequest: 1
    });
    redis.on('error', (err) => {
        console.error('Redis Client Error:', err);
    });
}

const scanRedisKeys = async (pattern) => {
    let cursor = '0';
    const keys = [];

    do {
        const result = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
        cursor = result[0];
        keys.push(...result[1]);
    } while (String(cursor) !== '0');

    return keys;
};

module.exports = {
    redis,
    scanRedisKeys
};
