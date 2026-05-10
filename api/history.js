const { createClient } = require('@supabase/supabase-js');
const Redis = require('ioredis');

const redis = new Redis(process.env.REDIS_URL);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const scanRedisKeys = async (pattern) => {
    let cursor = '0';
    const keys = [];
    do {
        const result = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
        cursor = result[0];
        keys.push(...result[1]);
    } while (cursor !== '0');
    return keys;
};

module.exports = async (req, res) => {
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
        const { data: { user } } = await supabase.auth.getUser(authHeader.split(' ')[1]);
        if (!user) return res.status(401).json({ error: 'Invalid user' });

        const pattern = `user:${user.id}:diary-*`;
        const allKeys = await scanRedisKeys(pattern);

        if (allKeys.length === 0) return res.json({ success: true, history: [] });

        const sortedKeys = allKeys.sort().reverse().slice(0, 50);
        const values = await redis.mget(sortedKeys);

        const history = values.filter(Boolean).map((v, i) => {
            try {
                const item = JSON.parse(v);
                return {
                    id: sortedKeys[i],
                    originalContent: item.content,
                    aiResponse: item.response,
                    createdAt: item.createdAt,
                    emotion: item.emotion
                };
            } catch (e) { return null; }
        }).filter(Boolean);

        return res.json({ success: true, history });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
};
