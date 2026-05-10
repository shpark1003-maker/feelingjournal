const Redis = require('ioredis');
const { createClient } = require('@supabase/supabase-js');

const redis = new Redis(process.env.REDIS_URL);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

module.exports = async (req, res) => {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: '인증 필요' });
    const token = authHeader.split(' ')[1];

    try {
        const { data: { user }, error: authError } = await supabase.auth.getUser(token);
        if (authError || !user) return res.status(401).json({ error: '인증 실패' });

        const { subscription, settings } = req.body;
        const providerToken = req.headers['x-provider-token'] || '';

        const subKey = `user:${user.id}:push-config`;
        await redis.set(subKey, JSON.stringify({
            subscription,
            settings,
            providerToken,
            email: user.email
        }));

        return res.json({ success: true });
    } catch (error) {
        return res.status(500).json({ error: '구독 저장 실패' });
    }
};
