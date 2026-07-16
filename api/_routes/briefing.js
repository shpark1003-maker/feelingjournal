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


        const { getKstDateKey } = require('./utils/dateUtils');
        const dateStr = getKstDateKey();
        const cacheKey = `user:${user.id}:briefing:${dateStr}`;
        const lockKey = `user:${user.id}:briefing-build-lock:${dateStr}`;
        const revisionKey = `user:${user.id}:briefing-revision:${dateStr}`;
        const startedKey = `user:${user.id}:briefing-refresh-status:${dateStr}`;

        if (await briefingService.isBriefingDisabled(user.id)) {
            return res.json({
                success: true,
                status: 'ready',
                disabled: true,
                briefing: 'AI 감정 분석 제공이 비활성화되어 요약 브리핑 생성을 건너뜁니다. 설정에서 동의를 다시 켜면 자동으로 최신 브리핑을 준비합니다.'
            });
        }

        // SWR Check
        if (Array.isArray(clientDiaries) && clientDiaries.length === 0) {
            try {
                const cachedStr = await redis.get(cacheKey);
                if (cachedStr) {
                    const parsed = JSON.parse(cachedStr);
                    const isDirty = await redis.exists(revisionKey);
                    if (isDirty) {
                        parsed.fromCache = true;
                        parsed.isStale = true;
                        const hasLock = await redis.exists(lockKey);
                        if (hasLock) {
                            const started = await redis.get(startedKey);
                            parsed.refreshStatus = started ? 'started' : 'in_progress';
                        } else {
                            parsed.refreshStatus = 'not_started';
                        }
                    }
                    parsed.status = 'ready';
                    parsed.success = true;
                    return res.json(parsed);
                } else {
                    // Check legacy cache
                    const legacyStr = await redis.get(`user:${user.id}:briefing-cache`);
                    if (legacyStr && legacyStr !== 'GENERATING') {
                        try {
                            const parsed = JSON.parse(legacyStr);
                            if (parsed && parsed.briefing && parsed.briefing !== 'GENERATING') {
                                // Just call generateBriefing to let it handle migration
                                briefingResult = await briefingService.generateBriefing(user.id, providerToken, regionOverride, clientDiaries, consent, user.email, false, false, forceRefreshCalendar);
                                isSWRApplied = true;
                                briefingResult.success = true;
                                briefingResult.status = 'ready';
                                return res.json(briefingResult);
                            }
                        } catch(e){}
                    }

                    // Not in cache, check if generating
                    const hasLock = await redis.exists(lockKey);
                    if (hasLock) {
                        const started = await redis.get(startedKey);
                        return res.json({
                            success: true,
                            status: 'generating',
                            refreshStatus: started ? 'started' : 'in_progress',
                            retryAfterMs: 3000,
                            briefing: "AI 비서가 브리핑을 준비하고 있습니다. 🎩"
                        });
                    } else {
                        return res.json({
                            success: true,
                            status: 'generating',
                            refreshStatus: 'not_started',
                            retryAfterMs: 3000,
                            briefing: "AI 비서가 브리핑을 준비하고 있습니다. 🎩"
                        });
                    }
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
