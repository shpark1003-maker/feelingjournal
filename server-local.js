const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const ws = require('ws');
const Redis = require('ioredis');
const webpush = require('web-push');

dotenv.config({
    path: path.join(__dirname, '.env'),
    override: true
});

// [알람 시스템] VAPID 설정
webpush.setVapidDetails(
    process.env.VAPID_EMAIL || 'mailto:shpark1003@gmail.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
);

const app = express();
const port = process.env.PORT || 3000;

const supabaseUrl =
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL;

const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('Supabase 환경변수가 설정되지 않았습니다.');
    process.exit(1);
}

if (!process.env.REDIS_URL) {
    console.error('REDIS_URL이 설정되지 않았습니다.');
    process.exit(1);
}

const rawApiKey = process.env.GEMINI_API_KEY || '';
const cleanApiKey = rawApiKey.replace(/["']/g, '').trim();

if (!cleanApiKey) {
    console.error('GEMINI_API_KEY가 설정되지 않았습니다.');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false },
    realtime: { transport: ws }
});

const redis = new Redis(process.env.REDIS_URL);

redis.on('error', (err) => {
    console.error('Redis Client Error:', err);
});

const genAI = new GoogleGenerativeAI(cleanApiKey);

console.log('--- Environment Check ---');
console.log(`GEMINI_API_KEY verified: YES (Length: ${cleanApiKey.length})`);
console.log('SUPABASE connected: YES');
console.log('REDIS_URL found: YES');
console.log('-------------------------');

app.use(cors({
    origin: process.env.CORS_ORIGIN
        ? process.env.CORS_ORIGIN.split(',')
        : true,
    credentials: true
}));

app.use(express.json({ limit: '1mb' }));
app.use(express.static(__dirname));

const sendError = (res, status, message) => {
    return res.status(status).json({
        success: false,
        error: message
    });
};

const fetchWithTimeout = async (url, options = {}, timeoutMs = 10000) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
        return await fetch(url, {
            ...options,
            signal: controller.signal
        });
    } finally {
        clearTimeout(timeout);
    }
};

const sanitizeContent = (content) => {
    return String(content || '')
        .replace(/```/g, '')
        .slice(0, 5000)
        .trim();
};

const extractEventJson = (text) => {
    try {
        if (!text.includes('EVENT_JSON_START') || !text.includes('EVENT_JSON_END')) {
            return null;
        }

        const startIndex = text.indexOf('EVENT_JSON_START') + 'EVENT_JSON_START'.length;
        const endIndex = text.indexOf('EVENT_JSON_END');

        if (endIndex <= startIndex) return null;

        const jsonStr = text.slice(startIndex, endIndex).trim();
        const event = JSON.parse(jsonStr);

        // [개선] 필수 값 검증 및 자동 보정 (할 일의 경우 종료 시간이 없을 수 있음)
        if (!event.summary || !event.start) return null;
        
        if (!event.end) {
            const start = new Date(event.start);
            start.setHours(start.getHours() + 1);
            event.end = start.toISOString();
        }

        return event;
    } catch (error) {
        console.error('Event JSON Extraction Error:', error.message);
        return null;
    }
};

const scanRedisKeys = async (pattern) => {
    let cursor = '0';
    const keys = [];

    do {
        const result = await redis.scan(
            cursor,
            'MATCH',
            pattern,
            'COUNT',
            100
        );

        cursor = result[0];
        keys.push(...result[1]);
    } while (cursor !== '0');

    return keys;
};

const verifyUser = async (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return sendError(res, 401, '인증 정보가 필요합니다.');
    }

    const token = authHeader.split(' ')[1];

    try {
        const {
            data: { user },
            error
        } = await supabase.auth.getUser(token);

        if (error || !user) {
            throw error || new Error('Invalid user');
        }

        req.user = user;
        next();
    } catch (error) {
        return sendError(res, 401, '유효하지 않은 토큰입니다.');
    }
};

// --- [추가] 메모 삭제 라우트 ---
app.delete('/api/history/:id', verifyUser, async (req, res) => {
    try {
        const user = req.user;
        // 프론트에서 encodeURIComponent 된 ID를 받으므로 디코딩 필수
        const key = decodeURIComponent(req.params.id);

        if (!key || !key.startsWith(`user:${user.id}:diary-`)) {
            return res.status(403).json({
                success: false,
                error: '삭제 권한이 없습니다.'
            });
        }

        await redis.del(key);
        console.log(`--- [DEBUG] Memo Deleted: ${key}`);
        return res.json({ success: true });
    } catch (error) {
        console.error('History Delete Error:', error);
        return res.status(500).json({
            success: false,
            error: '메모 삭제 실패'
        });
    }
});

app.post('/api/analyze', verifyUser, async (req, res) => {
    try {
        const user = req.user;
        const content = sanitizeContent(req.body.content);

        if (!content) {
            return sendError(res, 400, '메모 내용이 없습니다.');
        }

        const now = new Date();
        const providerToken = req.headers['x-provider-token'];

        // --- [일기 분석 캐싱 로직] ---
        const contentHash = Buffer.from(content).toString('base64').slice(0, 50); // 간단한 지문 생성
        const analyzeCacheKey = `user:${user.id}:last-analyze-cache`;

        try {
            const cachedAnalyze = await redis.get(analyzeCacheKey);
            if (cachedAnalyze) {
                const { hash, result } = JSON.parse(cachedAnalyze);
                if (hash === contentHash) {
                    console.log('--- [CACHE] Returning cached analysis for identical content.');
                    return res.json(result);
                }
            }
        } catch (e) {
            console.error('Analyze Cache Error:', e);
        }
        // ---------------------------

        let existingEventsStr = "현재 등록된 일정이 없습니다.";

        // 구글 토큰이 있다면 최신 일정을 가져와서 프롬프트에 활용
        if (providerToken) {
            try {
                // [개선] 조회 범위를 15개로 늘려 내일/모레 일정도 충분히 포함
                const calendarUrl = 'https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=' + new Date().toISOString() + '&maxResults=15&singleEvents=true&orderBy=startTime';
                const calendarResponse = await fetchWithTimeout(calendarUrl, {
                    headers: { Authorization: `Bearer ${providerToken}` }
                }, 10000);
                const calendarData = await calendarResponse.json();
                if (calendarData.items && calendarData.items.length > 0) {
                    // [개선] AI가 읽기 편하도록 날짜 형식을 한글/요일 포함으로 변환
                    existingEventsStr = calendarData.items.map(e => {
                        const start = e.start.dateTime || e.start.date;
                        const dateObj = new Date(start);
                        const formattedDate = dateObj.toLocaleString('ko-KR', {
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric',
                            weekday: 'short',
                            hour: '2-digit',
                            minute: '2-digit',
                            timeZone: 'Asia/Seoul'
                        });
                        return `- 제목: ${e.summary || '제목 없음'}, 시간: ${formattedDate}`;
                    }).join('\n');
                    
                    console.log('--- [DEBUG] Events formatted for AI ---\n', existingEventsStr);
                }
            } catch (e) {
                console.error('Calendar Fetch Error for Analyze:', e.message);
            }
        }

        const currentTimeStr = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });

        if (!cleanApiKey) {
            throw new Error('서버의 GEMINI_API_KEY가 설정되지 않았습니다.');
        }

        const prompt = `
너는 사용자의 감정을 분석하고 일정을 조율하며, 생활 전반을 챙겨주는 품격 있는 **'수석 비서'**다.

[사용자의 현재 일정 리스트]
${existingEventsStr}

[현재 시간]
${currentTimeStr}

[수행 지시 - 슈퍼 비서 프로토콜]
1. **일정 대조**: 사용자의 메모를 일정 리스트와 대조하여 충돌 여부를 가장 먼저 확인하라.
2. **할 일 감지 (강화)**: "해야 한다", "할 것이다", "잊지 말자", "**~하자**", "**~해보자**" 등의 표현이 담긴 모든 할 일(To-Do)을 캘린더 일정으로 제안하라. 
    - **상대적 시간 추론**: "주말", "내일 모레", "다음 주" 등은 현재 시간(${currentTimeStr})을 기준으로 **정확한 날짜**를 계산하여 반영하라. (예: 오늘이 월요일인데 '주말'이라고 하면 다가오는 토요일/일요일 날짜로 지정)
    - 시간이 명시되지 않았다면 '오전 9시' 시작 또는 '종일 일정'으로 처리하라.
3. **비서 기능**: 식사/업무/개인 성격에 맞는 맞춤형 조언(맛집 추천, 준비물 챙기기 등)을 제공하라.
4. **감정 분석**: 첫 줄에 감정:[단어] 형식 작성.
5. **일정 추출**: EVENT_JSON_START/END 형식 사용.
    - summary, start, end, type("task" 또는 "event") 필수.

사용자 메모:
"""
${content}
"""
`;

        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${cleanApiKey}`;

        const geminiResponse = await fetchWithTimeout(geminiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }]
            })
        }, 20000); // 20초 타임아웃 추가

        const result = await geminiResponse.json();
        if (result.error) {
            console.error('Google API Full Error:', JSON.stringify(result.error, null, 2));
            return sendError(res, 500, `[Google API Error] ${result.error.message}`);
        }

        const text = result.candidates?.[0]?.content?.parts?.[0]?.text || '';
        if (!text) {
            throw new Error('Gemini 응답이 비어 있습니다.');
        }

        const emotionMatch = text.match(/감정:\[(.*?)\]/);
        const emotion = emotionMatch ? emotionMatch[1].trim() : '평온';

        const detectedEvent = extractEventJson(text);

        const timestamp = new Date()
            .toISOString()
            .replace(/[-:T.]/g, '')
            .slice(0, 14);

        const redisKey = `user:${user.id}:diary-${timestamp}`;

        const diaryData = {
            content,
            response: text,
            emotion,
            createdAt: new Date().toISOString(),
            userId: user.id
        };

        await redis.set(
            redisKey,
            JSON.stringify(diaryData),
            'EX',
            60 * 60 * 24 * 30
        );

        const finalResult = {
            success: true,
            answer: text,
            event: detectedEvent
        };

        // --- [캐싱 저장] ---
        await redis.set(analyzeCacheKey, JSON.stringify({
            hash: contentHash,
            result: finalResult
        }), 'EX', 3600); // 1시간 캐시
        // ------------------

        return res.json(finalResult);
    } catch (error) {
        console.error('Critical Analyze Error:', error);
        return sendError(
            res,
            500,
            'AI 분석 중 오류가 발생했습니다: ' + error.message
        );
    }
});

app.get('/api/history', verifyUser, async (req, res) => {
    try {
        const user = req.user;
        const pattern = `user:${user.id}:diary-*`;

        let allKeys = [];
        let cursor = '0';

        // keys() 대신 scan() 사용으로 성능 및 안정성 확보
        do {
            const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
            cursor = nextCursor;
            allKeys = allKeys.concat(keys);
        } while (cursor !== '0');

        if (allKeys.length === 0) {
            return res.json({
                success: true,
                history: []
            });
        }

        const sortedKeys = allKeys.sort().reverse().slice(0, 50);
        const values = await redis.mget(sortedKeys);

        const history = [];

        for (let i = 0; i < values.length; i++) {
            if (!values[i]) continue;

            try {
                const item = JSON.parse(values[i]);

                history.push({
                    id: sortedKeys[i],
                    originalContent: item.content,
                    aiResponse: item.response,
                    createdAt: item.createdAt,
                    emotion: item.emotion
                });
            } catch (error) {
                console.error('History Parse Error:', error.message);
            }
        }

        return res.json({
            success: true,
            history
        });
    } catch (error) {
        console.error('Redis History Error:', error);
        return sendError(res, 500, '히스토리 로딩 실패');
    }
});

app.get('/api/calendar', verifyUser, async (req, res) => {
    try {
        const user = req.user;
        const providerToken = req.headers['x-provider-token'];
        if (!providerToken) return sendError(res, 400, 'Google Provider Token이 필요합니다.');

        const currentTimeStr = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
        
        // 1. 구글 캘린더 일정 가져오기
        const calendarUrl = `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${new Date().toISOString()}&maxResults=20&singleEvents=true&orderBy=startTime`;
        const calRes = await fetchWithTimeout(calendarUrl, { headers: { Authorization: `Bearer ${providerToken}` } });
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

        // --- [캐싱 로직 추가] ---
        // 현재 일정들의 고유 지문(Fingerprint) 생성 (ID와 제목 조합)
        const currentFingerprint = events.map(e => `${e.id}-${e.summary}`).join('|');
        const cacheKey = `user:${user.id}:calendar-advice-cache`;

        try {
            const cachedData = await redis.get(cacheKey);
            if (cachedData) {
                const { fingerprint, analyzedEvents } = JSON.parse(cachedData);
                // 일정이 변하지 않았다면 캐시된 AI 분석 결과 즉시 반환
                if (fingerprint === currentFingerprint) {
                    console.log('--- [CACHE] Returning cached calendar advice.');
                    return res.json({ success: true, events: analyzedEvents, cached: true });
                }
            }
        } catch (cacheError) {
            console.error('Cache Retrieval Error:', cacheError);
        }
        // -----------------------

        // 2. 과거 일기에서 '할 일' 발굴하기
        const pattern = `user:${user.id}:diary-*`;
        const allKeys = await scanRedisKeys(pattern);
        if (allKeys.length > 0) {
            const latestKeys = allKeys.sort().reverse().slice(0, 30);
            const diaryValues = await redis.mget(latestKeys);
            const diaryContent = diaryValues.filter(v => v).map(v => JSON.parse(v).content).join('\n---\n');

            const extractionPrompt = `
다음은 사용자의 최근 일기들이다. 분석하여 사용자가 언급한 **'미래에 해야 할 일'이나 '계획'**을 모두 찾아내어 JSON 배열로 추출하라.
- 오늘 날짜/시간: ${currentTimeStr}
- 출력 형식: [{"title": "내용", "start": "ISO", "end": "ISO", "type": "task", "advice": "조언"}]
- 다른 말은 하지 말고 오직 JSON 배열만 출력하라.
[일기 데이터]
${diaryContent}
`;

            const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${cleanApiKey}`;
            const geminiRes = await fetchWithTimeout(geminiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contents: [{ parts: [{ text: extractionPrompt }] }] })
            }, 25000);

            const geminiData = await geminiRes.json();
            const rawJson = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
            
            try {
                const cleanJson = rawJson.replace(/```json|```/g, '').trim();
                const diaryTasks = JSON.parse(cleanJson);
                events = [...events, ...diaryTasks]; 
            } catch (e) {
                console.error('Diary Task Parse Error:', e.message);
            }
        }

        // 데이터 가공 전 안전장치 추가
        const eventsSummary = events.map((e, i) => {
            const summary = e.title || e.summary || '제목 없음';
            const start = e.start?.dateTime || e.start?.date || '시간 미지정';
            return `${i + 1}. 제목: ${summary}, 시간: ${start}`;
        }).join('\n');

        const batchPrompt = `
너는 사용자의 일정을 관리하는 품격 있는 수석 비서다. 아래 일정 리스트를 보고 **각 일정별로** 전문적인 조언을 작성하라.

현재 시간: ${currentTimeStr}

일정 리스트:
${eventsSummary}

[수행 지시]
1. 각 일정의 성격을 식사(점심/저녁), 업무(회의/프로젝트/미팅), 개인 중 하나로 분류하라.
2. 식사 약속 시: 내일 식사라면 반드시 예약 확인 가이드를 포함하라.
3. 업무 일정 시: 아젠다 확인, 자료 준비 등 업무 효율을 높이는 조언을 하라.
4. 모든 조언은 반드시 'AI 조언: '으로 시작하라.
5. 응답은 반드시 아래 JSON 배열 형식으로만 출력하라 (다른 텍스트 절대 금지):
[
  {"id": 1, "advice": "AI 조언 내용..."},
  {"id": 2, "advice": "AI 조언 내용..."}
]
`;

        try {
            const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${cleanApiKey}`;
            const geminiResponse = await fetchWithTimeout(geminiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: batchPrompt }] }],
                    generationConfig: { response_mime_type: "application/json" }
                })
            }, 25000); // 배치 분석은 넉넉하게 25초 타임아웃

            const result = await geminiResponse.json();
            const rawAdvice = result.candidates?.[0]?.content?.parts?.[0]?.text || "[]";
            const adviceList = JSON.parse(rawAdvice);

            const analyzedEvents = events.map((event, index) => {
                const foundAdvice = adviceList.find(a => a.id == (index + 1));
                return {
                    ...event, // 기존의 type, id, title, start, end 등 모든 속성 유지
                    advice: foundAdvice?.advice || event.advice || '일정을 확인했습니다.'
                };
            });

            // --- [캐싱 로직 추가] 분석 결과 저장 (TTL: 1시간) ---
            await redis.set(cacheKey, JSON.stringify({
                fingerprint: currentFingerprint,
                analyzedEvents
            }), 'EX', 3600);
            // ---------------------------------------------

            return res.json({ success: true, events: analyzedEvents });

        } catch (error) {
            console.error('Batch Calendar Advice Error:', error);
            return res.json({ success: true, events }); // 실패 시 가공 전 데이터라도 반환
        }
    } catch (error) {
        console.error('--- [CRITICAL] Calendar API Error:', error);
        return sendError(res, 500, `캘린더 시스템 오류: ${error.message}`);
    }
});

app.post('/api/calendar/add', verifyUser, async (req, res) => {
    try {
        const providerToken = req.headers['x-provider-token'];
        const { summary, start, end } = req.body;

        if (!providerToken) {
            return sendError(res, 400, 'Google Provider Token이 필요합니다.');
        }

        if (!summary || !start || !end) {
            return sendError(res, 400, 'summary, start, end 값이 필요합니다.');
        }

        const startDate = new Date(start);
        const endDate = new Date(end);

        if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
            return sendError(res, 400, 'start 또는 end 시간이 올바르지 않습니다.');
        }

        if (endDate <= startDate) {
            return sendError(res, 400, 'end는 start보다 이후 시간이어야 합니다.');
        }

        const calendarResponse = await fetchWithTimeout(
            'https://www.googleapis.com/calendar/v3/calendars/primary/events',
            {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${providerToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    summary,
                    start: {
                        dateTime: start
                    },
                    end: {
                        dateTime: end
                    }
                })
            }
        );

        const data = await calendarResponse.json();

        if (!calendarResponse.ok || data.error) {
            throw new Error(
                'Google Calendar API Error: ' +
                (data?.error?.message || calendarResponse.statusText)
            );
        }

        return res.json({
            success: true,
            eventId: data.id
        });
    } catch (error) {
        console.error('Calendar Add Error:', error);
        return sendError(res, 500, '일정 등록 중 오류가 발생했습니다.');
    }
});

app.get('/api/briefing', verifyUser, async (req, res) => {
    try {
        const user = req.user;
        const providerToken = req.headers['x-provider-token'];
        
        // 1. 어제와 오늘 일정 가져오기
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        yesterday.setHours(0, 0, 0, 0);
        
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(23, 59, 59, 999);

        let contextEvents = "일정 정보 없음";
        if (providerToken) {
            const calendarUrl = `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${yesterday.toISOString()}&timeMax=${tomorrow.toISOString()}&singleEvents=true&orderBy=startTime`;
            const calRes = await fetchWithTimeout(calendarUrl, { headers: { Authorization: `Bearer ${providerToken}` } });
            const calData = await calRes.json();
            if (calData.items) {
                contextEvents = calData.items.map(e => `- ${e.summary} (${e.start.dateTime || e.start.date})`).join('\n');
            }
        }

        // 2. 최근 일기 히스토리 가져오기 (문맥 파악용)
        const pattern = `user:${user.id}:diary-*`;
        const keys = await scanRedisKeys(pattern);
        let recentDiaries = "일기 기록 없음";
        if (keys.length > 0) {
            const latestKeys = keys.sort().reverse().slice(0, 3);
            const values = await redis.mget(latestKeys);
            recentDiaries = values.map(v => JSON.parse(v).content).join('\n---\n');
        }

        const currentTimeStr = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });

        const briefingPrompt = `
너는 사용자의 하루를 관리하는 완벽한 '수석 비서'다. 아래 정보를 바탕으로 사용자에게 정성스러운 **'데일리 브리핑'**을 작성하라.

[분석 데이터]
- 현재 시간: ${currentTimeStr}
- 어제~오늘 일정:
${contextEvents}
- 최근 사용자의 생각(일기):
${recentDiaries}

[수행 지시]
1. 불필요한 인사말은 생략하거나 아주 짧게 하라.
2. 어제 요약 1문장, 오늘 핵심 1문장으로 최대한 간결하게(최대 2~3문장) 작성하라.
3. 가장 중요한 포인트는 강조(**텍스트**)를 사용하라.
4. 마치 바쁜 상사에게 핵심만 보고하는 유능한 비서처럼 행동하라.
`;

        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${cleanApiKey}`;
        const geminiRes = await fetchWithTimeout(geminiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: briefingPrompt }] }] })
        }, 20000);

        const result = await geminiRes.json();
        const briefing = result.candidates?.[0]?.content?.parts?.[0]?.text || "비서가 브리핑을 준비하지 못했습니다.";

        return res.json({ success: true, briefing });
    } catch (error) {
        console.error('Briefing Error:', error);
        return sendError(res, 500, '브리핑 생성 실패');
    }
});

// [알람 시스템] 구독 및 설정 저장
app.post('/api/subscribe', verifyUser, async (req, res) => {
    try {
        const { subscription, settings } = req.body;
        const user = req.user;
        const providerToken = req.headers['x-provider-token'] || '';

        // 유저별 구독 정보 및 설정 저장 (Redis)
        const subKey = `user:${user.id}:push-config`;
        await redis.set(subKey, JSON.stringify({
            subscription,
            settings,
            providerToken, // 백그라운드 체크를 위해 토큰 보관
            email: user.email
        }));

        res.json({ success: true });
    } catch (error) {
        console.error('Subscription Error:', error);
        res.status(500).json({ error: '구독 저장 실패' });
    }
});

// [알람 시스템] 백그라운드 알람 디스패처 (1분마다 실행)
setInterval(async () => {
    try {
        const keys = await scanRedisKeys('user:*:push-config');
        if (keys.length === 0) return;

        const now = new Date();

        for (const key of keys) {
            const data = await redis.get(key);
            if (!data) continue;
            const { subscription, settings, providerToken, email } = JSON.parse(data);

            if (!providerToken || !subscription || !settings) continue;

            // 다음 1시간 내 일정 가져오기
            const timeMin = new Date(now.getTime()).toISOString();
            const timeMax = new Date(now.getTime() + 65 * 60 * 1000).toISOString();
            const calUrl = `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${timeMin}&timeMax=${timeMax}&singleEvents=true`;
            
            const calRes = await fetch(calUrl, { headers: { Authorization: `Bearer ${providerToken}` } });
            const calData = await calRes.json();

            if (calData && calData.items) {
                for (const event of calData.items) {
                    const startTime = new Date(event.start.dateTime || event.start.date);
                    const diffMin = Math.round((startTime - now) / 60000);

                    // 설정된 시간(10, 30, 60분)에 해당하면 푸시 발송
                    const shouldNotify = 
                        (settings.alarm10 && diffMin === 10) ||
                        (settings.alarm30 && diffMin === 30) ||
                        (settings.alarm60 && diffMin === 60);

                    if (shouldNotify) {
                        const payload = JSON.stringify({
                            title: `🔔 일정 알람 (${diffMin}분 전)`,
                            body: `[${event.summary}] 일정이 곧 시작됩니다. 준비되셨나요?`
                        });
                        webpush.sendNotification(subscription, payload).catch(e => console.error('Push Send Error:', e));
                        console.log(`[Push Sent] To: ${email}, Event: ${event.summary}, Time: ${diffMin}m before`);
                    }
                }
            }
        }
    } catch (e) {
        console.error('Dispatcher Error:', e.message);
    }
}, 60000);

app.listen(port, () => {
    console.log(`Server is running at http://localhost:${port}`);
});