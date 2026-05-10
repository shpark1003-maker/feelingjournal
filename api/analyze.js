const { GoogleGenerativeAI } = require('@google/generative-ai');
const { createClient } = require('@supabase/supabase-js');
const Redis = require('ioredis');

// Supabase 클라이언트 초기화
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Redis 초기화
const redis = new Redis(process.env.REDIS_URL);

// [유틸] 이벤트 JSON 추출
const extractEventJson = (text) => {
    try {
        if (!text.includes('EVENT_JSON_START') || !text.includes('EVENT_JSON_END')) return null;
        const startIndex = text.indexOf('EVENT_JSON_START') + 'EVENT_JSON_START'.length;
        const endIndex = text.indexOf('EVENT_JSON_END');
        const jsonStr = text.slice(startIndex, endIndex).trim();
        const event = JSON.parse(jsonStr);
        if (!event.summary || !event.start) return null;
        if (!event.end) {
            const start = new Date(event.start);
            start.setHours(start.getHours() + 1);
            event.end = start.toISOString();
        }
        return event;
    } catch (e) {
        return null;
    }
};

module.exports = async (req, res) => {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: '인증 필요' });
    const token = authHeader.split(' ')[1];

    try {
        const { content } = req.body;
        if (!content) return res.status(400).json({ error: '내용 없음' });

        const { data: { user }, error: authError } = await supabase.auth.getUser(token);
        if (authError || !user) return res.status(401).json({ error: '인증 실패' });

        const apiKey = process.env.GEMINI_API_KEY;
        const providerToken = req.headers['x-provider-token'];

        // --- 캐싱 로직 ---
        const contentHash = Buffer.from(content).toString('base64').slice(0, 50);
        const cacheKey = `user:${user.id}:last-analyze-cache`;
        const cached = await redis.get(cacheKey);
        if (cached) {
            const { hash, result } = JSON.parse(cached);
            if (hash === contentHash) return res.json(result);
        }

        // --- 일정 컨텍스트 ---
        let existingEventsStr = "현재 등록된 일정이 없습니다.";
        if (providerToken) {
            try {
                const calUrl = `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${new Date().toISOString()}&maxResults=10&singleEvents=true&orderBy=startTime`;
                const calRes = await fetch(calUrl, { headers: { Authorization: `Bearer ${providerToken}` } });
                const calData = await calRes.json();
                if (calData.items?.length > 0) {
                    existingEventsStr = calData.items.map(e => `- ${e.summary} (${e.start.dateTime || e.start.date})`).join('\n');
                }
            } catch (e) { console.error('Cal Error:', e); }
        }

        const currentTimeStr = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        const prompt = `
너는 사용자의 감정을 분석하고 일정을 조율하며, 생활 전반을 챙겨주는 품격 있는 **'수석 비서'**다.

[사용자의 현재 일정 리스트]
${existingEventsStr}

[현재 시간]
${currentTimeStr}

[수행 지시]
1. **일정 대조**: 메모를 일정과 대조하여 충돌 여부 확인.
2. **할 일 감지**: "하자", "해보자", "잊지 말자" 등 표현 시 캘린더 일정 제안.
3. **상대적 시간 추론**: "주말", "내일" 등은 ${currentTimeStr} 기준으로 정확한 날짜 계산.
4. **감정 분석**: 첫 줄에 감정:[단어] 형식 작성.
5. **일정 추출**: EVENT_JSON_START/END 형식 사용 (summary, start, end, type 필수).

사용자 메모: "${content}"
`;

        const result = await model.generateContent(prompt);
        const text = result.response.text();

        const emotionMatch = text.match(/감정:\[(.*?)\]/);
        const emotion = emotionMatch ? emotionMatch[1].trim() : '평온';
        const detectedEvent = extractEventJson(text);

        const timestamp = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);
        const redisKey = `user:${user.id}:diary-${timestamp}`;
        const diaryData = { content, response: text, emotion, createdAt: new Date().toISOString(), userId: user.id };

        await redis.set(redisKey, JSON.stringify(diaryData), 'EX', 60 * 60 * 24 * 30);
        
        const finalResult = { success: true, answer: text, event: detectedEvent };
        await redis.set(cacheKey, JSON.stringify({ hash: contentHash, result: finalResult }), 'EX', 3600);

        return res.json(finalResult);
    } catch (error) {
        console.error('Analyze Error:', error);
        return res.status(500).json({ error: '분석 실패: ' + error.message });
    }
};
