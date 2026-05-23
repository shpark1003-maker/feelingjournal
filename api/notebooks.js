const { supabase, redis } = require('./shared');

module.exports = async (req, res) => {
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
        const { data: { user } } = await supabase.auth.getUser(authHeader.split(' ')[1]);
        if (!user) return res.status(401).json({ error: 'Invalid user' });

        const key = `user:${user.id}:notebooks`;

        if (req.method === 'GET') {
            const data = await redis.get(key);
            let notebooks = data ? JSON.parse(data) : [];
            if (notebooks.length === 0) {
                notebooks = [{ id: 'nb-1', name: '내 일기장', color: '#6366f1' }];
                await redis.set(key, JSON.stringify(notebooks), 'EX', 3600 * 24 * 365);
            }
            return res.json({
                success: true,
                notebooks
            });
        }

        if (req.method === 'POST') {
            const { notebooks } = req.body;
            await redis.set(key, JSON.stringify(notebooks), 'EX', 3600 * 24 * 365); // 1 year TTL
            return res.json({ success: true });
        }

        return res.status(404).json({ error: 'Method Not Found' });
    } catch (error) {
        console.error('Notebooks API Error:', error);
        return res.status(500).json({ error: error.message });
    }
};
