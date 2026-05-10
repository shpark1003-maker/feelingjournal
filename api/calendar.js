const { createClient } = require('@supabase/supabase-js');
const Redis = require('ioredis');

const GEMINI_MODEL = 'gemini-2.0-flash';
const redis = new Redis(process.env.REDIS_URL);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const fetchWithTimeout = async (url, options = {}, timeoutMs = 10000) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } finally {
        clearTimeout(timeout);
    }
};

const getGeminiUrl = () => {
    const apiKey = (process.env.GEMINI_API_KEY || '').replace(/["']/g, '').trim();
    return `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
};

const safeParseJsonArray = (raw, label = 'JSON') => {
    try {
        const clean = String(raw || '[]').replace(/```json/gi, '').replace(/```/g, '').trim();
        const parsed = JSON.parse(clean);
        return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
        return [];
    }
};

const scanRedisKeys = async (pattern) => {
    let cursor = '0';
    const keys = [];
    do {
        const result = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
        cursor = result[0];
        keys.push(...result[1]);
    } while (cursor !== '0');
    return keys;
};

module.exports = async (req, res) => {
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
        const { data: { user } } = await supabase.auth.getUser(authHeader.split(' ')[1]);
        if (!user) return res.status(401).json({ error: 'Invalid user' });

        const providerToken = req.headers['x-provider-token'];
        if (!providerToken) return res.status(400).json({ error: 'Provider token required' });

        const currentTimeStr = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
        const calendarUrl = `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(new Date().toISOString())}&maxResults=20&singleEvents=true&orderBy=startTime`;
        const calRes = await fetchWithTimeout(calendarUrl, { headers: { Authorization: `Bearer ${providerToken}` } });
        const calData = await calRes.json();

        let events = (calData.items || []).map(item => ({
            id: item.id,
            title: item.summary || '제목 없음',
            start: item.start?.dateTime || item.start?.date,
            end: item.end?.dateTime || item.end?.date,
            allDay: !item.start?.dateTime,
            type: 'event',
            advice: '구글 캘린더 일정입니다.'
        }));

        const currentFingerprint = events.map(e => `${e.id}-${e.title}-${e.start}-${e.end}`).join('|');
        const cacheKey = `user:${user.id}:calendar-advice-cache`;
        const cached = await redis.get(cacheKey);
        if (cached) {
            const { fingerprint, analyzedEvents } = JSON.parse(cached);
            if (fingerprint === currentFingerprint) return res.json({ success: true, events: analyzedEvents, cached: true });
        }

        const keys = await scanRedisKeys(`user:${user.id}:diary-*`);
        if (keys.length > 0) {
            const latestKeys = keys.sort().reverse().slice(0, 30);
            const diaryValues = await redis.mget(latestKeys);
            const diaryContent = diaryValues.filter(Boolean).map(v => JSON.parse(v).content).join('\n---\n');
            
            if (diaryContent) {
                const prompt = `최근 일기를 분석하여 사용자가 언급한 미래에 해야 할 일을 JSON 배열로 추출하라.
오늘: ${currentTimeStr}
형식: [{"title": "내용", "start": "ISO", "end": "ISO", "type": "task", "advice": "조언"}]
데이터: ${diaryContent}`;
                const geminiRes = await fetchWithTimeout(getGeminiUrl(), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { response_mime_type: 'application/json' } })
                }, 25000);
                const data = await geminiRes.json();
                const rawJson = data.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
                const diaryTasks = safeParseJsonArray(rawJson);
                events = [...events, ...diaryTasks.map(t => ({ ...t, type: 'task' }))];
            }
        }

        const eventsSummary = events.map((e, i) => `${i + 1}. 제목: ${e.title}, 시간: ${e.start}`).join('\n');
        const batchPrompt = `너는 수석 비서다. 각 일정별로 전문적인 조언을 JSON 배열로 작성하라.
[{"id": 1, "advice": "AI 조언..."}]
일정 리스트: ${eventsSummary}`;

        const batchRes = await fetchWithTimeout(getGeminiUrl(), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: batchPrompt }] }], generationConfig: { response_mime_type: 'application/json' } })
        }, 25000);

        const batchData = await batchRes.json();
        const rawAdvice = batchData.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
        const adviceList = safeParseJsonArray(rawAdvice);

        const analyzedEvents = events.map((e, i) => {
            const found = adviceList.find(a => Number(a.id) === i + 1);
            return { ...e, advice: found?.advice || e.advice || '일정을 확인했습니다.' };
        });

        await redis.set(cacheKey, JSON.stringify({ fingerprint: currentFingerprint, analyzedEvents }), 'EX', 3600);
        return res.json({ success: true, events: analyzedEvents });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
};
