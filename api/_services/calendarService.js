const { 
    redis, 
    fetchWithTimeout, 
    callGemini, 
    safeParseJsonArray, 
    scanRedisKeys,
    fetchGoogleCalendarEvents
} = require('../_routes/shared');

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
            allDay: !t.start?.includes('T'),
            type: 'task',
            advice: t.advice,
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

async function addGoogleCalendarEvent(providerToken, { summary, startTime, endTime, description }) {
    if (!providerToken || providerToken === 'mock' || providerToken === 'null' || providerToken === 'undefined') {
        throw new Error('Google Calendar 연동이 활성화되어 있지 않습니다.');
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
        throw new Error(insertData.error.message || 'Failed to insert event');
    }
    return insertData;
}

async function deleteGoogleCalendarEvent(providerToken, id) {
    if (!providerToken || providerToken === 'mock' || providerToken === 'null' || providerToken === 'undefined') {
        throw new Error('Google Calendar 연동이 활성화되어 있지 않습니다.');
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
        throw new Error(deleteData.error?.message || 'Failed to delete event');
    }
    return true;
}

async function patchGoogleCalendarEvent(providerToken, id, { summary, start, end, description }) {
    if (!providerToken || providerToken === 'mock' || providerToken === 'null' || providerToken === 'undefined') {
        throw new Error('Google Calendar 연동이 활성화되어 있지 않습니다.');
    }

    const calendarUrl = `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(id)}`;
    const updateRes = await fetchWithTimeout(calendarUrl, {
        method: 'PATCH',
        headers: {
            'Authorization': `Bearer ${providerToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            summary,
            description: description || '',
            start: { dateTime: new Date(start).toISOString() },
            end: { dateTime: new Date(end).toISOString() }
        }),
        failFast: true
    });

    const updateData = await updateRes.json();
    if (updateData.error) {
        throw new Error(updateData.error.message || 'Failed to update event');
    }
    return updateData;
}

async function getCalendarEvents({ userId, userEmail, providerToken, consent, clientDiaries, forceRefresh }) {
    let googleEvents = [];
    let isUnlinked = false;
    let partialFailure = false;
    let failedCalendars = [];
    let calResult = {};

    try {
        const timeMin = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        const timeMax = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
        calResult = await fetchGoogleCalendarEvents(userId, timeMin, timeMax, userEmail);
        isUnlinked = calResult.unlinked;
        partialFailure = calResult.partialFailure;
        failedCalendars = calResult.failedCalendars;
        if (calResult.events && calResult.events.length > 0) {
            googleEvents = calResult.events.map(item => {
                const isShared = (item.organizer && item.organizer.email && item.organizer.email !== userEmail) || (item.attendees && item.attendees.length > 1);
                const isTask = item.description?.includes('[Task]');
                return {
                    id: item.id,
                    title: item.summary || '제목 없음',
                    start: item.start?.dateTime || item.start?.date,
                    end: item.end?.dateTime || item.end?.date,
                    allDay: !item.start?.dateTime,
                    type: isShared ? 'shared' : (isTask ? 'task' : 'event'),
                    advice: isShared ? '공유된 일정입니다.' : (isTask ? '과제(할 일) 일정입니다.' : '구글 캘린더 일정입니다.'),
                    description: item.description || '',
                    backgroundColor: isShared 
                        ? 'rgba(251, 113, 133, 0.12)' 
                        : (isTask ? 'rgba(129, 140, 248, 0.12)' : 'rgba(56, 189, 248, 0.12)'),
                    borderColor: isShared 
                        ? '#fb7185' 
                        : (isTask ? '#818cf8' : '#38bdf8'),
                    textColor: isShared 
                        ? '#e11d48' 
                        : (isTask ? '#4f46e5' : '#0284c7')
                };
            });
        }
    } catch (err) {
        console.warn('--- [CALENDAR] Google Calendar API Failed. Error:', err?.message || err);
    }

    const keys = await scanRedisKeys(`user:${userId}:diary-*`);
    const latestDiaryFingerprint = keys.sort().reverse().slice(0, 10).join(',');
    const currentFingerprint = googleEvents.map(e => `${e.id}-${e.title}-${e.start}-${e.end}`).join('|') + '||diaries:' + latestDiaryFingerprint;
    const cacheKey = `user:${userId}:calendar-advice-cache`;

    if (!forceRefresh) {
        const cached = await redis.get(cacheKey);
        if (cached) {
            const { fingerprint, analyzedEvents } = JSON.parse(cached);
            if (fingerprint === currentFingerprint) {
                return { events: analyzedEvents, calendars: calResult.calendars || [], cached: true, unlinked: isUnlinked, partialFailure, failedCalendars };
            }
        }
    }

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

    const currentTimeStr = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
    const analyzedEvents = await analyzeCalendarEventsAndDiaries(googleEvents, diaryContent, currentTimeStr);

    const isFallback = analyzedEvents.some(e => e.advice?.includes('AI 분석 생략됨'));
    const cacheTTL = isFallback ? 15 : 3600;
    await redis.set(cacheKey, JSON.stringify({ fingerprint: currentFingerprint, analyzedEvents }), 'EX', cacheTTL);

    return {
        events: analyzedEvents,
        calendars: calResult.calendars || [],
        cached: false,
        unlinked: isUnlinked,
        partialFailure,
        failedCalendars
    };
}

module.exports = {
    analyzeCalendarEventsAndDiaries,
    addGoogleCalendarEvent,
    deleteGoogleCalendarEvent,
    patchGoogleCalendarEvent,
    getCalendarEvents
};
