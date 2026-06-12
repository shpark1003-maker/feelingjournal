const { 
    supabase, 
    redis, 
    fetchWithTimeout, 
    callGemini, 
    safeParseJsonArray, 
    scanRedisKeys,
    getGoogleAccessToken,
    fetchGoogleCalendarEvents
} = require('./shared');

// [COMBINED] Helper function to extract tasks from diaries and generate advice for all events in a single Gemini call
async function analyzeCalendarEventsAndDiaries(googleEvents, diaryContent, currentTimeStr) {
    if (googleEvents.length === 0 && !diaryContent) {
        return [];
    }

    const googleSummary = googleEvents.map(e => `ID: ${e.id}, 제목: ${e.title}, 시간: ${e.start}~${e.end}`).join('\n');

    const schema = {
        type: "OBJECT",
        properties: {
            extractedTasks: {
                type: "ARRAY",
                items: {
                    type: "OBJECT",
                    properties: {
                        title: { type: "STRING" },
                        start: { type: "STRING" },
                        end: { type: "STRING" },
                        advice: { type: "STRING" }
                    },
                    required: ["title", "start", "end", "advice"]
                }
            },
            googleEventsWithAdvice: {
                type: "ARRAY",
                items: {
                    type: "OBJECT",
                    properties: {
                        id: { type: "STRING" },
                        advice: { type: "STRING" }
                    },
                    required: ["id", "advice"]
                }
            }
        },
        required: ["extractedTasks", "googleEventsWithAdvice"]
    };

    const prompt = `너는 사용자의 일정을 관리하는 품격 있는 감성 수석 비서다. 다음 데이터를 바탕으로 할 일을 추출하고 비서의 조언을 담은 JSON 객체를 반환하라.

현재 시각(KST): ${currentTimeStr}

[사용자의 일기 리스트]
${diaryContent || '작성된 일기 없음'}

[구글 캘린더 일정 리스트]
${googleSummary || '등록된 구글 일정 없음'}

[수행 지시]
1. **일기에서 미래 할 일(Task) 추출**: [사용자의 일기 리스트]의 본문에 언급된 약속, 계획, 일정 등 미래에 해야 할 일들을 모두 감지하여 'extractedTasks' 배열에 넣으십시오.
   - 일기 본문에서 '오늘', '내일', '이번 주 목요일' 등 상대적인 시간 표현이 사용되었다면, 반드시 해당 일기의 [일기 작성일]을 기준으로 정확한 날짜를 환산해야 합니다. 절대 현재(조회 시점) 시간인 ${currentTimeStr} 기준의 내일로 대입하지 마십시오.
   - 각 추출된 할 일에 대해 따뜻하고 품격 있는 비서의 어조로 조언('advice')을 1~2문장 내외로 상세히 작성하십시오.
2. **구글 캘린더 일정에 대한 조언 생성**: [구글 캘린더 일정 리스트]에 제공된 각 일정에 대해 준비 사항이나 격려 등 유용한 비서의 조언을 작성하여 'googleEventsWithAdvice' 배열에 일정의 ID 매칭과 함께 채우십시오.
3. 반드시 JSON 형식으로만 응답해야 하며, 지정된 스펙 필드를 완벽하게 지키십시오.`;

    try {
        const generationConfig = {
            response_mime_type: "application/json",
            response_schema: schema
        };
        const data = await callGemini(prompt, generationConfig, 1, null, true, 20000);
        const rawJson = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
        
        let result;
        try {
            result = JSON.parse(rawJson);
        } catch (parseErr) {
            result = safeParseJsonArray(rawJson)[0] || { extractedTasks: [], googleEventsWithAdvice: [] };
        }

        const googleAdvices = result.googleEventsWithAdvice || [];
        const extracted = result.extractedTasks || [];

        // 1. Google events with advice mapped
        const googleAnalyzed = googleEvents.map(ge => {
            const match = googleAdvices.find(a => a.id === ge.id);
            return {
                ...ge,
                advice: match?.advice || '일정을 확인했습니다. 편안한 하루 보내세요.'
            };
        });

        // 2. Extracted tasks mapped
        const taskAnalyzed = extracted.map((t, idx) => ({
            id: `extracted-task-${Date.now()}-${idx}`,
            title: t.title,
            start: t.start,
            end: t.end,
            advice: t.advice,
            type: 'task',
            backgroundColor: 'rgba(129, 140, 248, 0.12)',
            borderColor: '#818cf8',
            textColor: '#4f46e5'
        }));

        return [...googleAnalyzed, ...taskAnalyzed];
    } catch (err) {
        console.error('--- [CALENDAR GEMINI COMBINED ERROR] Fallback logic triggered:', err?.message || err);
        return googleEvents.map(ge => ({
            ...ge,
            advice: '일정을 확인했습니다. (AI 분석 생략됨)'
        }));
    }
}

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
            console.warn('--- [CALENDAR] Redis connection offline/error, falling back to header:', redisErr?.message || redisErr);
        }

        if (!providerToken) {
            providerToken = req.headers['x-provider-token'];
        }

        const consent = req.body?.aiContextConsent === true;
        const clientDiaries = req.body?.decryptedDiaries || [];
        const isAnalyzeRequest = consent || clientDiaries.length > 0;
        const currentTimeStr = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });

        // Handle POST (Create Event or E2E Zero-Knowledge Diary Analysis)
        if (req.method === 'POST') {
            if (isAnalyzeRequest) {
                // E2E 분석 요청 처리 및 유효성 검사
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

                // 1. Google Calendar 일정 조회
                let googleEvents = [];
                let isUnlinked = false;
                let partialFailure = false;
                let failedCalendars = [];
                let calResult = {};
                try {
                    const timeMin = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
                    const timeMax = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
                    calResult = await fetchGoogleCalendarEvents(user.id, timeMin, timeMax, user.email);
                    isUnlinked = calResult.unlinked;
                    partialFailure = calResult.partialFailure;
                    failedCalendars = calResult.failedCalendars;
                    if (calResult.events && calResult.events.length > 0) {
                        googleEvents = calResult.events.map(item => {
                            const isShared = (item.organizer && item.organizer.email && item.organizer.email !== user.email) || (item.attendees && item.attendees.length > 1);
                            return {
                                id: item.id,
                                title: item.summary || '제목 없음',
                                start: item.start?.dateTime || item.start?.date,
                                end: item.end?.dateTime || item.end?.date,
                                allDay: !item.start?.dateTime,
                                type: isShared ? 'shared' : 'event',
                                advice: isShared ? '공유된 일정입니다.' : '구글 캘린더 일정입니다.',
                                backgroundColor: isShared ? 'rgba(251, 113, 133, 0.12)' : 'rgba(56, 189, 248, 0.12)',
                                borderColor: isShared ? '#fb7185' : '#38bdf8',
                                textColor: isShared ? '#e11d48' : '#0284c7'
                            };
                        });
                    }
                } catch (err) {
                    console.warn('--- [CALENDAR POST] Google Calendar Fetch Failed:', err?.message || err);
                }

                // 2. 다이어리 내용 가공
                let diaryContent = '';
                if (clientDiaries.length > 0 && consent) {
                    diaryContent = clientDiaries.map(d => {
                        const dateStr = new Date(d.date || new Date()).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' });
                        return `[일기 작성일(명시적 전송): ${dateStr}]\n내용: ${d.content}`;
                    }).join('\n---\n');
                }

                // 3. 통합 분석 기법 적용 (Gemini 단일 호출)
                const analyzedEvents = await analyzeCalendarEventsAndDiaries(googleEvents, diaryContent, currentTimeStr);

                return res.json({ success: true, events: analyzedEvents, calendars: calResult.calendars || [], unlinked: isUnlinked, partialFailure, failedCalendars });
            }

            const { summary, startTime, endTime, description } = req.body;
            if (!summary || !startTime || !endTime) {
                return res.status(400).json({ error: 'Missing summary, startTime, or endTime' });
            }

            if (!providerToken || providerToken === 'mock' || providerToken === 'null' || providerToken === 'undefined') {
                return res.status(400).json({ error: 'Google Calendar 연동이 활성화되어 있지 않습니다.' });
            }

            const calendarUrl = `https://www.googleapis.com/calendar/v3/calendars/primary/events`;
            const insertRes = await fetchWithTimeout(calendarUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${providerToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    summary,
                    description: description || '',
                    start: { dateTime: new Date(startTime).toISOString() },
                    end: { dateTime: new Date(endTime).toISOString() }
                }),
                failFast: true
            });

            const insertData = await insertRes.json();
            if (insertData.error) {
                return res.status(400).json({ error: insertData.error.message || 'Failed to insert event' });
            }

            // Clear cache
            const cacheKey = `user:${user.id}:calendar-advice-cache`;
            await redis.del(cacheKey);

            return res.json({ success: true, event: insertData });
        }

        // Handle DELETE (Delete Event)
        if (req.method === 'DELETE') {
            const { id } = req.query;
            if (!id) return res.status(400).json({ error: 'Missing event id' });

            if (!providerToken || providerToken === 'mock' || providerToken === 'null' || providerToken === 'undefined') {
                return res.status(400).json({ error: 'Google Calendar 연동이 활성화되어 있지 않습니다.' });
            }

            const calendarUrl = `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(id)}`;
            const deleteRes = await fetchWithTimeout(calendarUrl, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${providerToken}`
                },
                failFast: true
            });

            if (deleteRes.status !== 204 && deleteRes.status !== 200) {
                const deleteData = await deleteRes.json().catch(() => ({}));
                return res.status(400).json({ error: deleteData.error?.message || 'Failed to delete event' });
            }

            // Clear cache
            const cacheKey = `user:${user.id}:calendar-advice-cache`;
            await redis.del(cacheKey);

            return res.json({ success: true });
        }

        // Handle GET (Load Calendar)
        let googleEvents = [];
        let isUnlinked = false;
        let partialFailure = false;
        let failedCalendars = [];
        let calResult = {};
        try {
            // Fetch events from 30 days ago to 90 days in the future to keep a complete view
            const timeMin = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
            const timeMax = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
            calResult = await fetchGoogleCalendarEvents(user.id, timeMin, timeMax, user.email);
            isUnlinked = calResult.unlinked;
            partialFailure = calResult.partialFailure;
            failedCalendars = calResult.failedCalendars;
            if (calResult.events && calResult.events.length > 0) {
                googleEvents = calResult.events.map(item => {
                    const isShared = (item.organizer && item.organizer.email && item.organizer.email !== user.email) || (item.attendees && item.attendees.length > 1);
                    return {
                        id: item.id,
                        title: item.summary || '제목 없음',
                        start: item.start?.dateTime || item.start?.date,
                        end: item.end?.dateTime || item.end?.date,
                        allDay: !item.start?.dateTime,
                        type: isShared ? 'shared' : 'event',
                        advice: isShared ? '공유된 일정입니다.' : '구글 캘린더 일정입니다.',
                        backgroundColor: isShared ? 'rgba(251, 113, 133, 0.12)' : 'rgba(56, 189, 248, 0.12)',
                        borderColor: isShared ? '#fb7185' : '#38bdf8',
                        textColor: isShared ? '#e11d48' : '#0284c7'
                    };
                });
            }
        } catch (err) {
            console.warn('--- [CALENDAR] Google Calendar API Failed. Error:', err?.message || err);
        }

        // Scan user's diary keys to generate a cache invalidation fingerprint based on diary count/timestamps
        const keys = await scanRedisKeys(`user:${user.id}:diary-*`);
        const latestDiaryFingerprint = keys.sort().reverse().slice(0, 10).join(',');

        const currentFingerprint = googleEvents.map(e => `${e.id}-${e.title}-${e.start}-${e.end}`).join('|') + '||diaries:' + latestDiaryFingerprint;
        const cacheKey = `user:${user.id}:calendar-advice-cache`;
        
        const { refresh } = req.query;
        if (refresh !== 'true') {
            const cached = await redis.get(cacheKey);
            if (cached) {
                const { fingerprint, analyzedEvents } = JSON.parse(cached);
                if (fingerprint === currentFingerprint) {
                    return res.json({ success: true, events: analyzedEvents, calendars: calResult.calendars || [], cached: true, unlinked: isUnlinked, partialFailure, failedCalendars });
                }
            }
        }

        // Process diaries to extract content
        let diaryContent = '';
        if (keys.length > 0) {
            const latestKeys = keys.sort().reverse().slice(0, 30);
            const diaryValues = await redis.mget(latestKeys);
            diaryContent = diaryValues.filter(Boolean).map(v => {
                const item = JSON.parse(v);
                if (item.content && item.content.startsWith('e2e:')) {
                    return null;
                }
                const dateStr = new Date(item.createdAt || new Date()).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' });
                return `[일기 작성일: ${dateStr}]\n내용: ${item.content}`;
            }).filter(Boolean).join('\n---\n');
        }

        if (clientDiaries.length > 0 && consent) {
            const clientContent = clientDiaries.map(d => {
                const dateStr = new Date(d.date || new Date()).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' });
                return `[일기 작성일(명시적 전송): ${dateStr}]\n내용: ${d.content}`;
            }).join('\n---\n');
            diaryContent = [diaryContent, clientContent].filter(Boolean).join('\n---\n');
        }

        // Run unified combined analysis call (extract tasks + advice)
        const analyzedEvents = await analyzeCalendarEventsAndDiaries(googleEvents, diaryContent, currentTimeStr);

        const isFallback = analyzedEvents.some(e => e.advice?.includes('AI 분석 생략됨'));
        const cacheTTL = isFallback ? 15 : 3600;
        await redis.set(cacheKey, JSON.stringify({ fingerprint: currentFingerprint, analyzedEvents }), 'EX', cacheTTL);
        
        return res.json({ success: true, events: analyzedEvents, calendars: calResult.calendars || [], unlinked: isUnlinked, partialFailure, failedCalendars });
    } catch (error) {
        return res.status(500).json({ error: error?.message || error });
    }
};
