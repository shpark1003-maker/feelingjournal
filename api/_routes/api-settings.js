const { verifyUser, redis, supabase } = require('./shared');

module.exports = async (req, res) => {
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
        const { data: { user } } = await supabase.auth.getUser(authHeader.split(' ')[1]);
        if (!user) return res.status(401).json({ error: 'Invalid user' });

        const settingsKey = `user:${user.id}:api-settings`;

        // 1. GET: Load API settings
        if (req.method === 'GET') {
            let settings = {
                weatherEnabled: true,
                newsEnabled: true,
                nsightEnabled: false,
                nsightKey: '',
                elevenEnabled: false,
                elevenKey: '',
                geminiProEnabled: false,
                geminiProKey: ''
            };
            
            if (redis) {
                try {
                    const raw = await redis.get(settingsKey);
                    if (raw) {
                        settings = JSON.parse(raw);
                    }
                } catch (redisErr) {
                    console.warn('--- [API SETTINGS] Redis get error:', redisErr.message);
                }
            }
            
            return res.json({ success: true, settings });
        }

        // 2. POST: Save API settings
        if (req.method === 'POST') {
            const { settings } = req.body;
            if (!settings) {
                return res.status(400).json({ error: 'Missing settings payload' });
            }

            if (redis) {
                try {
                    await redis.set(settingsKey, JSON.stringify(settings));
                    // settings 변경 시 브리핑 캐시도 즉각 초기화
                    await redis.del(`user:${user.id}:briefing-cache`);
                } catch (redisErr) {
                    console.warn('--- [API SETTINGS] Redis set/del error:', redisErr.message);
                }
            }

            return res.json({ success: true });
        }

        return res.status(405).json({ error: 'Method Not Allowed' });
    } catch (error) {
        console.error('API Settings Error:', error);
        return res.status(500).json({ error: error.message });
    }
};
