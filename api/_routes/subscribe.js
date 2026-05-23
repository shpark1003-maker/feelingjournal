const { supabase, redis } = require('./shared');

module.exports = async (req, res) => {
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
        const { data: { user } } = await supabase.auth.getUser(authHeader.split(' ')[1]);
        if (!user) return res.status(401).json({ error: 'Invalid user' });

        const { subscription, settings } = req.body;
        if (!settings) return res.status(400).json({ error: 'Missing alert settings' });

        const providerToken = req.headers['x-provider-token'] || '';
        if (providerToken && providerToken !== 'mock' && providerToken !== 'null' && providerToken !== 'undefined') {
            await redis.set(`user:${user.id}:google_provider_token`, providerToken);
        }

        const subKey = `user:${user.id}:push-config`;
        await redis.set(subKey, JSON.stringify({
            subscription,
            settings,
            providerToken,
            email: user.email
        }));

        const pushEnabled = !!process.env.VAPID_PUBLIC_KEY && !!process.env.VAPID_PRIVATE_KEY;
        return res.json({ success: true, pushEnabled });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
};
