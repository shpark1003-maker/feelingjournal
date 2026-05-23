const { supabase, redis } = require('./shared');

module.exports = async (req, res) => {
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
        const { data: { user } } = await supabase.auth.getUser(authHeader.split(' ')[1]);
        if (!user) return res.status(401).json({ error: 'Invalid user' });

        const key = `user:${user.id}:nickname`;

        if (req.method === 'GET') {
            const nickname = await redis.get(key);
            return res.json({ success: true, nickname: nickname || null });
        }

        if (req.method === 'POST') {
            const { nickname } = req.body;
            if (!nickname || nickname.trim().length < 1) {
                return res.status(400).json({ error: '호칭은 1자 이상 입력해 주세요.' });
            }
            const cleaned = nickname.trim().slice(0, 20);
            await redis.set(key, cleaned);
            return res.json({ success: true, nickname: cleaned });
        }

        return res.status(404).json({ error: 'Method Not Found' });
    } catch (error) {
        console.error('Nickname API Error:', error);
        return res.status(500).json({ error: error.message });
    }
};
