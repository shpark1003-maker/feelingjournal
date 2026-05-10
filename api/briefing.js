const { GoogleGenerativeAI } = require('@google/generative-ai');
const { createClient } = require('@supabase/supabase-js');
const Redis = require('ioredis');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const redis = new Redis(process.env.REDIS_URL);

module.exports = async (req, res) => {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' });

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: '인증 필요' });
    const token = authHeader.split(' ')[1];

    try {
        const { data: { user }, error: authError } = await supabase.auth.getUser(token);
        if (authError || !user) return res.status(401).json({ error: '인증 실패' });

        const providerToken = req.headers['x-provider-token'];
        
        // 1. 일정 정보 수집 (어제~내일)
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        yesterday.setHours(0,0,0,0);
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(23,59,59,999);

        let contextEvents = "일정 정보 없음";
        if (providerToken) {
            try {
                const calUrl = `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${yesterday.toISOString()}&timeMax=${tomorrow.toISOString()}&singleEvents=true&orderBy=startTime`;
                const calRes = await fetch(calUrl, { headers: { Authorization: `Bearer ${providerToken}` } });
                const calData = await calRes.json();
                if (calData.items) contextEvents = calData.items.map(e => `- ${e.summary} (${e.start.dateTime || e.start.date})`).join('\n');
            } catch (e) {}
        }

        // 2. 최근 일기 수집
        const pattern = `user:${user.id}:diary-*`;
        let allKeys = [];
        let cursor = '0';
        do {
            const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 10);
            cursor = nextCursor;
            allKeys = allKeys.concat(keys);
        } while (cursor !== '0');

        let recentDiaries = "기록 없음";
        if (allKeys.length > 0) {
            const latestKeys = allKeys.sort().reverse().slice(0, 3);
            const diaryValues = await redis.mget(latestKeys);
            recentDiaries = diaryValues.filter(v => v).map(v => JSON.parse(v).content).join('\n---\n');
        }

        const currentTimeStr = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        const briefingPrompt = `
너는 완벽한 '수석 비서'다. 아래 정보를 바탕으로 2~3문장의 짧고 핵심적인 **'데일리 브리핑'**을 작성하라.
[데이터]
- 현재 시간: ${currentTimeStr}
- 일정: ${contextEvents}
- 최근 일기: ${recentDiaries}
`;

        const result = await model.generateContent(briefingPrompt);
        const briefing = result.response.text();

        return res.json({ success: true, briefing });
    } catch (error) {
        return res.status(500).json({ error: '브리핑 생성 실패' });
    }
};
