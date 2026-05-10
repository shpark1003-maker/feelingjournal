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
        const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1); yesterday.setHours(0,0,0,0);
        const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1); tomorrow.setHours(23,59,59,999);

        let contextEvents = '일정 정보 없음';
        if (providerToken) {
            try {
                const calendarUrl = `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(yesterday.toISOString())}&timeMax=${encodeURIComponent(tomorrow.toISOString())}&singleEvents=true&orderBy=startTime`;
                const calRes = await fetchWithTimeout(calendarUrl, { headers: { Authorization: `Bearer ${providerToken}` } });
                const calData = await calRes.json();
                if (calData.items) contextEvents = calData.items.map(e => `- ${e.summary} (${e.start.dateTime || e.start.date})`).join('\n');
            } catch (e) {}
        }

        const keys = await scanRedisKeys(`user:${user.id}:diary-*`);
        let recentDiaries = '일기 기록 없음';
        if (keys.length > 0) {
            const latestKeys = keys.sort().reverse().slice(0, 3);
            const values = await redis.mget(latestKeys);
            recentDiaries = values.filter(Boolean).map(v => JSON.parse(v).content).join('\n---\n');
        }

        const currentTimeStr = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
        const prompt = `너는 수석 비서다. 아래 정보를 바탕으로 핵심적인 데일리 브리핑을 작성하라.
현시간: ${currentTimeStr}
일정: ${contextEvents}
생각: ${recentDiaries}
지시: 어제 요약 1문장, 오늘 핵심 1문장으로 간결하게 작성하라. 중요한 포인트는 **텍스트**로 강조하라.`;

        const geminiRes = await fetchWithTimeout(getGeminiUrl(), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        }, 20000);

        const data = await geminiRes.json();
        const briefing = data.candidates?.[0]?.content?.parts?.[0]?.text || '비서가 브리핑을 준비하지 못했습니다.';
        return res.json({ success: true, briefing });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
};
