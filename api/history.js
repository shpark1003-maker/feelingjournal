const { createClient } = require('@supabase/supabase-js');
const Redis = require('ioredis');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const redis = new Redis(process.env.REDIS_URL);

module.exports = async (req, res) => {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' });

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: '인증 필요' });
    const token = authHeader.split(' ')[1];

    try {
        const { data: { user }, error: authError } = await supabase.auth.getUser(token);
        if (authError || !user) return res.status(401).json({ error: '인증 실패' });

        const pattern = `user:${user.id}:diary-*`;
        let allKeys = [];
        let cursor = '0';

        // scan() 사용하여 효율적으로 조회
        do {
            const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
            cursor = nextCursor;
            allKeys = allKeys.concat(keys);
        } while (cursor !== '0');

        if (allKeys.length === 0) return res.json({ success: true, history: [] });

        const sortedKeys = allKeys.sort().reverse().slice(0, 50);
        const values = await redis.mget(sortedKeys);

        const history = values.map((val, i) => {
            if (!val) return null;
            try {
                const item = JSON.parse(val);
                return {
                    id: sortedKeys[i],
                    originalContent: item.content,
                    aiResponse: item.response,
                    createdAt: item.createdAt,
                    emotion: item.emotion
                };
            } catch (e) { return null; }
        }).filter(h => h !== null);

        return res.json({ success: true, history });
    } catch (error) {
        return res.status(500).json({ error: '히스토리 로딩 실패' });
    }
};
