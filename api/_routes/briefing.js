const { 
    supabase, 
    supabaseAdmin,
    getGoogleAccessToken,
    getLiveWeather
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

        // Google Provider Token을 helper를 통해 조회하고 헤더에서 폴백
        let providerToken = null;
        try {
            providerToken = await getGoogleAccessToken(user.id);
        } catch (redisErr) {
            console.warn('--- [BRIEFING] Redis connection offline/error, falling back to header:', redisErr.message);
        }

        if (!providerToken) {
            providerToken = req.headers['x-provider-token'];
        }

        const regionOverride = req.query.region || null;
        
        let clientDiaries = [];
        let consent = false;

        if (req.method === 'POST') {
            consent = req.body?.aiContextConsent === true;
            clientDiaries = req.body?.decryptedDiaries || [];
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

        const briefing = await briefingService.generateBriefing(user.id, providerToken, regionOverride, clientDiaries, consent, user.email);

        // Fetch weather to return to frontend
        let weather = null;
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

        return res.json({ success: true, briefing, weather });
    } catch (error) {
        console.error('Briefing Error:', error?.message || error);
        return res.json({
            success: true,
            briefing: `비서가 지금 조금 바쁘네요. (원인: ${error?.message || error}) 잠시 후 다시 브리핑을 준비해 드릴게요! 🎩`
        });
    }
};

module.exports.generateBriefing = generateBriefing;
