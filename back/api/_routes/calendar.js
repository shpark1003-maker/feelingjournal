const { 
    supabase, 
    redis, 
    fetchWithTimeout, 
    callGemini, 
    safeParseJsonArray, 
    scanRedisKeys,
    getGoogleAccessToken
} = require('./shared');

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
            console.warn('--- [CALENDAR] Redis connection offline/error, falling back to header:', redisErr.message);
        }

        if (!providerToken) {
            providerToken = req.headers['x-provider-token'];
        }


        // Handle POST (Create Event)
        if (req.method === 'POST') {
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

        const currentTimeStr = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
        
        let googleEvents = [];
        if (providerToken && providerToken !== 'mock' && providerToken !== 'null' && providerToken !== 'undefined') {
            try {
                // Fetch events from 30 days ago to 90 days in the future to keep a complete view
                const timeMin = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
                const calendarUrl = `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(timeMin)}&maxResults=100&singleEvents=true&orderBy=startTime`;
                const calRes = await fetchWithTimeout(calendarUrl, { headers: { Authorization: `Bearer ${providerToken}` }, failFast: true });
                const calData = await calRes.json();
                
                if (calRes.ok) {
                    googleEvents = (calData.items || []).map(item => {
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
                } else {
                    console.warn('--- [CALENDAR] Google API returned non-OK status. Falling back to empty Google events. Error:', calData.error?.message);
                }
            } catch (err) {
                console.warn('--- [CALENDAR] Google Contacts API Failed, falling back to mock contacts. Error:', err.message);
            }
        } else {
            console.log('--- [CALENDAR] Google OAuth token missing or mock. Bypassing Google Calendar fetch. ---');
        }

        let events = [...googleEvents];

        const currentFingerprint = events.map(e => `${e.id}-${e.title}-${e.start}-${e.end}`).join('|');
        const cacheKey = `user:${user.id}:calendar-advice-cache`;
        const { refresh } = req.query;
        if (refresh !== 'true') {
            const cached = await redis.get(cacheKey);
            if (cached) {
                const { fingerprint, analyzedEvents } = JSON.parse(cached);
                if (fingerprint === currentFingerprint) return res.json({ success: true, events: analyzedEvents, cached: true });
            }
        }

        const keys = await scanRedisKeys(`user:${user.id}:diary-*`);
        if (keys.length > 0) {
            const latestKeys = keys.sort().reverse().slice(0, 30);
            const diaryValues = await redis.mget(latestKeys);
            const diaryContent = diaryValues.filter(Boolean).map(v => {
                const item = JSON.parse(v);
                const dateStr = new Date(item.createdAt || new Date()).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' });
                return `[일기 작성일: ${dateStr}]\n내용: ${item.content}`;
            }).join('\n---\n');
            
            if (diaryContent) {
                const prompt = `각 일기의 [일기 작성일]을 기준으로 일기 본문에 언급된 약속, 계획, 일정 등 미래에 해야 할 일들을 감지하여 JSON 배열로 추출하라.
만약 일기 본문에서 '오늘', '내일', '이번 주 목요일' 등 상대적인 시간 표현이 사용되었다면, 반드시 해당 일기의 [일기 작성일]을 기준으로 정확한 날짜를 환산해야 한다.

예를 들어, [일기 작성일: 2026-05-18]인 일기에 '내일 마트 가야지'라고 써있다면, 마트 가는 날짜는 2026-05-19(ISO 포맷 YYYY-MM-DD 형식)로 정확히 계산해야 한다. 절대 현재(조회 시점) 시간인 ${currentTimeStr} 기준의 내일(2026-05-20)로 대입하지 마라.

오늘(현재): ${currentTimeStr}
형식: [{"title": "내용", "start": "ISO", "end": "ISO", "type": "task", "advice": "조언"}]
데이터:
${diaryContent}`;
                try {
                    const data = await callGemini(prompt, { response_mime_type: 'application/json' }, 0, null, true, 15000);
                    const rawJson = data.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
                    const diaryTasks = safeParseJsonArray(rawJson);
                    events = [...events, ...diaryTasks.map(t => ({ 
                        ...t, 
                        type: 'task',
                        backgroundColor: 'rgba(129, 140, 248, 0.12)',
                        borderColor: '#818cf8',
                        textColor: '#4f46e5'
                    }))];
                } catch (geminiErr) {
                    console.error('--- [CALENDAR] Failed to extract tasks from diaries via Gemini:', geminiErr.message);
                }
            }
        }

        let analyzedEvents = [...events];

        if (events.length > 0) {
            const eventsSummary = events.map((e, i) => `${i + 1}. 제목: ${e.title}, 시간: ${e.start}`).join('\n');
            const batchPrompt = `너는 수석 비서다. 각 일정별로 전문적인 조언을 JSON 배열로 작성하라.
[{"id": 1, "advice": "AI 조언..."}]
일정 리스트: ${eventsSummary}`;

            let adviceList = [];
            try {
                const batchData = await callGemini(batchPrompt, { response_mime_type: 'application/json' }, 0, null, true, 15000);
                const rawAdvice = batchData.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
                adviceList = safeParseJsonArray(rawAdvice);
            } catch (geminiErr) {
                console.error('--- [CALENDAR] Failed to fetch calendar advice via Gemini:', geminiErr.message);
            }

            analyzedEvents = events.map((e, i) => {
                const found = adviceList.find(a => Number(a.id) === i + 1);
                return { ...e, advice: found?.advice || e.advice || '일정을 확인했습니다. (AI 분석 생략됨)' };
            });
        }

        const isFallback = analyzedEvents.some(e => e.advice?.includes('AI 분석 생략됨'));
        const cacheTTL = isFallback ? 15 : 3600;
        await redis.set(cacheKey, JSON.stringify({ fingerprint: currentFingerprint, analyzedEvents }), 'EX', cacheTTL);
        
        const isUnlinked = !providerToken || providerToken === 'mock' || providerToken === 'null' || providerToken === 'undefined';
        return res.json({ success: true, events: analyzedEvents, unlinked: isUnlinked });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
};
