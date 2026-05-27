const { supabase, redis } = require('./shared');

module.exports = async (req, res) => {
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
        const { data: { user } } = await supabase.auth.getUser(authHeader.split(' ')[1]);
        if (!user) return res.status(401).json({ error: 'Invalid user' });

        const subKey = `user:${user.id}:push-config`;

        // Support GET request to retrieve stored settings
        if (req.method === 'GET') {
            const dataRaw = await redis.get(subKey);
            const config = dataRaw ? JSON.parse(dataRaw) : { 
                subscription: null, 
                settings: { 
                    alarm60: false, 
                    alarm30: false, 
                    alarm10: false, 
                    briefingTime: '08:00', 
                    weatherRegion: '서울' 
                } 
            };
            const pushEnabled = !!process.env.VAPID_PUBLIC_KEY && !!process.env.VAPID_PRIVATE_KEY;
            return res.json({ success: true, config, pushEnabled });
        }

        if (req.method === 'POST') {
            const { subscription, settings } = req.body || {};
            if (!settings) return res.status(400).json({ error: 'Missing alert settings' });

            const providerToken = req.headers['x-provider-token'] || '';
            if (providerToken && providerToken !== 'mock' && providerToken !== 'null' && providerToken !== 'undefined') {
                await redis.set(`user:${user.id}:google_provider_token`, providerToken, 'EX', 3600);
            }

            const providerRefreshToken = req.headers['x-provider-refresh-token'] || '';
            if (providerRefreshToken && providerRefreshToken !== 'mock' && providerRefreshToken !== 'null' && providerRefreshToken !== 'undefined') {
                await redis.set(`user:${user.id}:google_provider_refresh_token`, providerRefreshToken);
            }


            if (settings.providerTokenOnly) {
                const dataRaw = await redis.get(subKey);
                const existing = dataRaw ? JSON.parse(dataRaw) : { 
                    subscription: null, 
                    settings: { 
                        alarm60: false, 
                        alarm30: false, 
                        alarm10: false, 
                        briefingTime: '08:00', 
                        weatherRegion: '서울' 
                    } 
                };
                
                if (providerToken && providerToken !== 'mock') {
                    existing.providerToken = providerToken;
                }
                existing.email = user.email;
                await redis.set(subKey, JSON.stringify(existing));
            } else {
                await redis.set(subKey, JSON.stringify({
                    subscription,
                    settings,
                    providerToken: (providerToken && providerToken !== 'mock') ? providerToken : undefined,
                    email: user.email
                }));
            }

            const pushEnabled = !!process.env.VAPID_PUBLIC_KEY && !!process.env.VAPID_PRIVATE_KEY;
            return res.json({ success: true, pushEnabled });
        }

        return res.status(405).json({ error: 'Method Not Allowed' });
    } catch (error) {
        console.error('Subscribe API Error:', error);
        return res.status(500).json({ error: error.message });
    }
};
