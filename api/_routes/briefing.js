const { 
    supabase, 
    supabaseAdmin,
    getGoogleAccessToken,
    getLiveWeather,
    redis
} = require('./shared');
const briefingService = require('../_services/briefingService');

const generateBriefing = briefingService.generateBriefing;

module.exports = async (req, res) => {
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
        const { data: { user } } = await supabase.auth.getUser(authHeader.split(' ')[1]);
        if (!user) return res.status(401).json({ error: 'Invalid user' });

        let providerToken = req.headers['x-provider-token'] || null;
        const regionOverride = req.query.region || null;
        
        let clientDiaries = [];
        let consent = false;
        let forceRefreshCalendar = req.query.forceRefreshCalendar === 'true';

        if (req.method === 'POST') {
            consent = req.body?.aiContextConsent === true;
            clientDiaries = req.body?.decryptedDiaries || [];
            if (req.body?.forceRefreshCalendar === true) forceRefreshCalendar = true;
            const isAnalyzeRequest = consent || clientDiaries.length > 0;

            if (isAnalyzeRequest) {
                if (!consent) {
                    return res.status(400).json({ error: 'AI 분석 제공 동의(aiContextConsent)가 누락되었습니다.' });
                }
                if (clientDiaries.length > 5) {
                    return res.status(400).json({ error: '최대 5개의 다이어리만 분석할 수 있습니다.' });
                }
                for (const d of clientDiaries) {
                    if (d.content && d.content.length > 2000) {
                        return res.status(400).json({ error: '다이어리 평문 내용은 최대 2,000자까지만 허용됩니다.' });
                    }
                }
            }
        }

        let briefingResult = null;
        let isSWRApplied = false;

        const cacheKey = `user:${user.id}:briefing-cache`;

        // SWR (Stale-While-Revalidate) Check
        if (Array.isArray(clientDiaries) && clientDiaries.length === 0) {
            try {
                let cached = null;
                
                if (redis) {
                    try {
                        cached = await redis.get(cacheKey);
                    } catch (redisErr) {
                        console.warn('--- [BRIEFING] Redis get error:', redisErr.message);
                    }
                }
                
                if (cached) {
                    if (cached === 'GENERATING') {
                        console.log(`--- [BRIEFING] Still generating in background for user ${user.id} ---`);
                        return res.json({ success: true, status: 'generating', retryAfterMs: 3000, briefing: "AI 비서가 브리핑을 준비하고 있습니다. 🎩" });
                    }

                    let parsed = null;
                    try {
                        parsed = JSON.parse(cached);
                    } catch (e) {
                        parsed = { briefing: cached, weather: null, updatedAt: Date.now() };
                    }

                    if (parsed && typeof parsed === 'object') {
                        if (parsed.briefing === 'GENERATING') {
                            return res.json({ success: true, status: 'generating', retryAfterMs: 3000, briefing: "AI 비서가 브리핑을 준비하고 있습니다. 🎩" });
                        }

                        briefingResult = parsed;
                        isSWRApplied = true;

                        // Return the response immediately
                        res.json({ success: true, status: 'ready', briefing: parsed.briefing, weather: parsed.weather, fromCache: true });

                        // Check if the cache is older than 5 minutes (300000 ms)
                        const cacheAge = Date.now() - (parsed.updatedAt || 0);
                        if (cacheAge > 5 * 60 * 1000) {
                            if (redis) {
                                const swrLockKey = `user:${user.id}:briefing-swr-lock`;
                                try {
                                    const hasLock = await redis.get(swrLockKey);
                                    
                                    if (!hasLock) {
                                        await redis.set(swrLockKey, '1', 'EX', 120); // 2분 락
                                        console.log(`--- [SWR LOCK] SWR lock acquired for user ${user.id} ---`);

                                        // Trigger refresh in background
                                        briefingService.generateBriefing(user.id, providerToken, regionOverride, clientDiaries, consent, user.email, true, false, forceRefreshCalendar)
                                            .then(() => {
                                                console.log(`--- [SWR REFRESH SUCCESS] Cache refreshed in background for user ${user.id} ---`);
                                            })
                                            .catch((err) => {
                                                console.error(`--- [SWR REFRESH ERROR] Failed to refresh cache in background:`, err.message);
                                            })
                                            .finally(async () => {
                                                try {
                                                    if (redis) {
                                                        await redis.del(swrLockKey);
                                                        console.log(`--- [SWR LOCK] SWR lock released for user ${user.id} ---`);
                                                    }
                                                } catch (lockErr) {
                                                    console.error('Failed to release SWR lock:', lockErr.message);
                                                }
                                            });
                                    } else {
                                        console.log(`--- [SWR BYPASS] Refresh already in progress for user ${user.id} ---`);
                                    }
                                } catch (redisErr) {
                                    console.warn('--- [SWR] Redis lock error:', redisErr.message);
                                }
                            }
                        }
                        return;
                    }
                } else {
                    // No cache found: set state to 'GENERATING' and trigger asynchronous fetch in background!
                    console.log(`--- [BRIEFING ASYNC TRIGGER] Initiating background briefing generation for user ${user.id} ---`);
                    
                    if (redis) {
                        try {
                            await redis.set(cacheKey, JSON.stringify({ briefing: 'GENERATING', updatedAt: Date.now() }), 'EX', 20); // 20초 동안 임시 저장
                        } catch (redisErr) {
                            console.warn('--- [BRIEFING] Redis set error:', redisErr.message);
                        }
                    }

                    briefingService.generateBriefing(user.id, providerToken, regionOverride, clientDiaries, consent, user.email, true, false, forceRefreshCalendar)
                        .then(() => {
                            console.log(`--- [ASYNC BRIEFING SUCCESS] Background generation finished for user ${user.id} ---`);
                        })
                        .catch((err) => {
                            console.error(`--- [ASYNC BRIEFING ERROR] Background generation failed for user ${user.id}:`, err.message);
                            // Clear generating status on failure to allow retry
                            if (redis) {
                                redis.del(cacheKey).catch(() => {});
                            }
                        });

                    return res.json({ success: true, status: 'generating', retryAfterMs: 3000, briefing: "AI 비서가 브리핑을 준비하고 있습니다. 🎩" });
                }
            } catch (cacheErr) {
                console.warn('--- [BRIEFING SWR ERROR] Redis read failed, falling back to synchronous fetch:', cacheErr.message);
            }
        }

        if (!isSWRApplied) {
            briefingResult = await briefingService.generateBriefing(user.id, providerToken, regionOverride, clientDiaries, consent, user.email, false, false, forceRefreshCalendar);
        }

        let briefing = '';
        let weather = null;

        if (briefingResult && typeof briefingResult === 'object') {
            briefing = briefingResult.briefing;
            weather = briefingResult.weather;
        } else {
            briefing = briefingResult;
        }

        console.log(`--- [DEBUG] Final Briefing String Length: ${briefing?.length || 0}`);
        console.log(`--- [DEBUG] Final Briefing String Snippet: ${briefing ? briefing.slice(-100) : ''}`);

        // Fetch weather to return to frontend if not already retrieved
        if (!weather && regionOverride !== 'off') {
            try {
                const client = supabaseAdmin || supabase;
                const { data: profile } = await client
                    .from('profiles')
                    .select('weather_region')
                    .eq('id', user.id)
                    .maybeSingle();
                const region = regionOverride || profile?.weather_region || '서울';
                if (region !== 'off') {
                    weather = await getLiveWeather(region);
                }
            } catch (e) {
                console.error('Failed to get weather for response:', e.message);
            }
        }

        return res.json({ success: true, status: 'ready', briefing, weather });
    } catch (error) {
        console.error('Briefing Error:', error?.message || error);
        return res.status(500).json({
            success: false,
            status: 'error',
            errorCode: 'BRIEFING_GENERATION_FAILED',
            message: '브리핑을 준비하지 못했습니다. 잠시 후 다시 시도해 주세요.'
        });
    }
};

module.exports.generateBriefing = generateBriefing;
