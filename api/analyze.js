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

const sanitizeContent = (content) => {
    return String(content || '').replace(/```/g, '').slice(0, 5000).trim();
};

const extractEventJson = (text) => {
    try {
        if (!text.includes('EVENT_JSON_START') || !text.includes('EVENT_JSON_END')) return null;
        const startIndex = text.indexOf('EVENT_JSON_START') + 'EVENT_JSON_START'.length;
        const endIndex = text.indexOf('EVENT_JSON_END');
        if (endIndex <= startIndex) return null;
        const jsonStr = text.slice(startIndex, endIndex).trim();
        const event = JSON.parse(jsonStr);
        if (!event.summary || !event.start) return null;
        if (!event.end) {
            const start = new Date(event.start);
            if (!isNaN(start.getTime())) {
                start.setHours(start.getHours() + 1);
                event.end = start.toISOString();
            }
        }
        return event;
    } catch (e) {
        return null;
    }
};

const verifyUser = async (token) => {
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) throw new Error('Invalid user');
    return user;
};

module.exports = async (req, res) => {
    if (req.method === 'OPTIONS') return res.status(200).end();
    
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
        const user = await verifyUser(authHeader.split(' ')[1]);

        const content = sanitizeContent(req.body.content);
        if (!content) return res.status(400).json({ error: 'Empty content' });

        const providerToken = req.headers['x-provider-token'];
        const contentHash = Buffer.from(content).toString('base64').slice(0, 50);
        const cacheKey = `user:${user.id}:last-analyze-cache`;

        const cached = await redis.get(cacheKey);
        if (cached) {
            const { hash, result } = JSON.parse(cached);
            if (hash === contentHash) return res.json(result);
        }

        let existingEventsStr = '현재 등록된 일정이 없습니다.';
        if (providerToken) {
            try {
                const calendarUrl = `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(new Date().toISOString())}&maxResults=15&singleEvents=true&orderBy=startTime`;
                const calRes = await fetchWithTimeout(calendarUrl, { headers: { Authorization: `Bearer ${providerToken}` } });
                const calData = await calRes.json();
                if (calData.items && calData.items.length > 0) {
                    existingEventsStr = calData.items.map(e => {
                        const start = e.start?.dateTime || e.start?.date;
                        const dateObj = new Date(start);
                        const formattedDate = isNaN(dateObj.getTime()) ? start : dateObj.toLocaleString('ko-KR', {
                            year: 'numeric', month: 'long', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Seoul'
                        });
                        return `- 제목: ${e.summary || '제목 없음'}, 시간: ${formattedDate}`;
                    }).join('\n');
                }
            } catch (e) {}
        }

        const currentTimeStr = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
        const prompt = `너는 사용자의 감정을 분석하고 일정을 조율하며, 생활 전반을 챙겨주는 품격 있는 수석 비서다.
[사용자의 현재 일정 리스트]
${existingEventsStr}
[현재 시간]
${currentTimeStr}
[수행 지시]
1. 사용자의 메모를 기존 일정과 대조하여 충돌 여부를 확인하라.
2. 할 일을 캘린더 일정 후보로 제안하라.
3. 상대적 시간은 현재 시간 기준 정확한 날짜로 계산하라.
4. 첫 줄에 감정:[단어] 형식으로 작성하라.
5. 일정이 있으면 EVENT_JSON_START/END 형식으로 JSON을 출력하라.
EVENT_JSON_START
{"summary":"일정 제목","start":"ISO8601 시작시간","end":"ISO8601 종료시간","type":"task 또는 event"}
EVENT_JSON_END
사용자 메모: """${content}"""`;

        const geminiRes = await fetchWithTimeout(getGeminiUrl(), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        }, 20000);

        const data = await geminiRes.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        const emotionMatch = text.match(/감정:\[(.*?)\]/);
        const emotion = emotionMatch ? emotionMatch[1].trim() : '평온';
        const detectedEvent = extractEventJson(text);

        const timestamp = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);
        const diaryKey = `user:${user.id}:diary-${timestamp}`;
        const diaryData = { content, response: text, emotion, createdAt: new Date().toISOString(), userId: user.id };
        await redis.set(diaryKey, JSON.stringify(diaryData), 'EX', 60 * 60 * 24 * 30);

        const finalResult = { success: true, answer: text, event: detectedEvent };
        await redis.set(cacheKey, JSON.stringify({ hash: contentHash, result: finalResult }), 'EX', 3600);

        return res.json(finalResult);
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
};
