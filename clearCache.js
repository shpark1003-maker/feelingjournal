require('dotenv').config();
const { redis, scanRedisKeys } = require('./api/_routes/clients/redis');

async function clearCache() {
    try {
        console.log('Clearing briefing caches...');
        const keys = await scanRedisKeys('*briefing*');
        if (keys.length > 0) {
            await redis.del(keys);
            console.log(`Deleted ${keys.length} briefing keys.`);
        } else {
            console.log('No briefing keys found.');
        }
    } catch (e) {
        console.error('Error:', e);
    } finally {
        process.exit(0);
    }
}
clearCache();
