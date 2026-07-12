'use strict';

async function closeRedisClient(redisClient) {
    try {
        if (redisClient?.status === 'ready') {
            await redisClient.quit();
        } else if (typeof redisClient?.disconnect === 'function') {
            redisClient.disconnect();
        }
    } catch (error) {
        // Non-blocking test cleanup
    }
}

module.exports = {
    closeRedisClient
};