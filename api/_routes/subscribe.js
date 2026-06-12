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

                // 동기화: Supabase profiles 테이블에도 기상/뉴스 설정 저장 (briefing.js 등에서 사용)
                try {
                    const updateData = {};
                    if (settings.weatherRegion) updateData.weather_region = settings.weatherRegion;
                    if (settings.newsCategories) updateData.news_categories = settings.newsCategories;
                    
                    if (Object.keys(updateData).length > 0) {
                        const client = require('./shared').supabaseAdmin || supabase;
                        await client.from('profiles').update(updateData).eq('id', user.id);
                    }
                } catch (e) {
                    console.error('Failed to sync settings to profile:', e.message);
                }
            }

            // 설정 변경 시 데일리 브리핑 캐시 초기화
            try {
                await redis.del(`user:${user.id}:briefing-cache`);
            } catch (cacheErr) {
                console.error('Failed to clear briefing cache on settings change:', cacheErr);
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
