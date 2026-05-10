const { createClient } = require('@supabase/supabase-js');
const Redis = require('ioredis');

const redis = new Redis(process.env.REDIS_URL);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

module.exports = async (req, res) => {
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
        const { data: { user } } = await supabase.auth.getUser(authHeader.split(' ')[1]);
        if (!user) return res.status(401).json({ error: 'Invalid user' });

        const { subscription, settings } = req.body;
        if (!subscription || !settings) return res.status(400).json({ error: 'Missing subscription data' });

        const subKey = `user:${user.id}:push-config`;
        await redis.set(subKey, JSON.stringify({
            subscription,
            settings,
            providerToken: req.headers['x-provider-token'] || '',
            email: user.email
        }));

        const pushEnabled = !!process.env.VAPID_PUBLIC_KEY && !!process.env.VAPID_PRIVATE_KEY;
        return res.json({ success: true, pushEnabled });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
};
