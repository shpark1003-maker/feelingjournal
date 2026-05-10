const { GoogleGenerativeAI } = require('@google/generative-ai');
const Redis = require('ioredis');
const { createClient } = require('@supabase/supabase-js');

const redis = new Redis(process.env.REDIS_URL);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

module.exports = async (req, res) => {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' });

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: '인증 필요' });
    const token = authHeader.split(' ')[1];

    try {
        const { data: { user }, error: authError } = await supabase.auth.getUser(token);
        if (authError || !user) return res.status(401).json({ error: '인증 실패' });

        const providerToken = req.headers['x-provider-token'];
        if (!providerToken) return res.status(400).json({ error: 'Google Access Token 필요' });

        const currentTimeStr = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
        
        // 1. 구글 캘린더 일정 가져오기
        const calUrl = `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${new Date().toISOString()}&maxResults=20&singleEvents=true&orderBy=startTime`;
        const calRes = await fetch(calUrl, { headers: { Authorization: `Bearer ${providerToken}` } });
        const calData = await calRes.json();
        
        let events = (calData.items || []).map(item => ({
            id: item.id,
            title: item.summary || '제목 없음',
            start: item.start.dateTime || item.start.date,
            end: item.end.dateTime || item.end.date,
            allDay: !item.start.dateTime,
            type: 'event',
            advice: '구글 캘린더 일정입니다.'
        }));

        // 2. 캐싱 확인
        const currentFingerprint = events.map(e => `${e.id}-${e.summary}`).join('|');
        const cacheKey = `user:${user.id}:calendar-advice-cache`;
        const cachedData = await redis.get(cacheKey);
        if (cachedData) {
            const { fingerprint, analyzedEvents } = JSON.parse(cachedData);
            if (fingerprint === currentFingerprint) return res.json({ success: true, events: analyzedEvents, cached: true });
        }

        // 3. 일기에서 할 일 추출 (최근 30개)
        const pattern = `user:${user.id}:diary-*`;
        let allKeys = [];
        let cursor = '0';
        do {
            const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
            cursor = nextCursor;
            allKeys = allKeys.concat(keys);
        } while (cursor !== '0');

        if (allKeys.length > 0) {
            const latestKeys = allKeys.sort().reverse().slice(0, 30);
            const diaryValues = await redis.mget(latestKeys);
            const diaryContent = diaryValues.filter(v => v).map(v => JSON.parse(v).content).join('\n---\n');

            const extractionPrompt = `
내용을 분석하여 사용자가 언급한 **'미래에 해야 할 일'**을 JSON 배열로 추출하라.
- 오늘: ${currentTimeStr}
- 형식: [{"title": "내용", "start": "ISO", "end": "ISO", "type": "task", "advice": "조언"}]
[데이터]
${diaryContent}
`;
            const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
            const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
            const result = await model.generateContent(extractionPrompt);
            const rawJson = result.response.text().replace(/```json|```/g, '').trim();
            try {
                const diaryTasks = JSON.parse(rawJson);
                events = [...events, ...diaryTasks];
            } catch (e) {}
        }

        // 4. 배치 조언 생성
        const eventsSummary = events.map((e, i) => `${i + 1}. 제목: ${e.title || e.summary}, 시간: ${e.start}`).join('\n');
        const batchPrompt = `
각 일정별로 전문적인 조언을 JSON 배열 형식으로 작성하라.
[
  {"id": 1, "advice": "AI 조언 내용..."}
]
일정 리스트:
${eventsSummary}
`;
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const adviceResult = await model.generateContent(batchPrompt);
        const rawAdvice = adviceResult.response.text().replace(/```json|```/g, '').trim();
        try {
            const adviceList = JSON.parse(rawAdvice);
            const analyzedEvents = events.map((event, index) => {
                const found = adviceList.find(a => a.id == (index + 1));
                return { ...event, advice: found?.advice || event.advice || '일정을 확인했습니다.' };
            });
            await redis.set(cacheKey, JSON.stringify({ fingerprint: currentFingerprint, analyzedEvents }), 'EX', 3600);
            return res.json({ success: true, events: analyzedEvents });
        } catch (e) {
            return res.json({ success: true, events });
        }
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
};
