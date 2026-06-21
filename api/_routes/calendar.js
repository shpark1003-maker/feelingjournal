const { 
    redis, 
    supabase,
    getGoogleAccessToken 
} = require('./shared');
const calendarService = require('../_services/calendarService');

module.exports = async (req, res) => {
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        let user = req.user;
        if (!user) {
            const authHeader = req.headers.authorization;
            if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
            const token = authHeader.split(' ')[1];
            if (token === 'mock-session-token') {
                user = { id: '91fdf57d-a069-4eab-820b-68180886d487', email: 'test@example.com' };
            } else {
                const { data: { user: supabaseUser } } = await supabase.auth.getUser(token);
                user = supabaseUser;
            }
        }
        if (!user) return res.status(401).json({ error: 'Invalid user' });

        // Google Provider Token: 헤더(x-provider-token)가 명시된 경우 우선 사용하고, 없을 경우 helper를 통해 조회
        let providerToken = req.headers['x-provider-token'];
        if (!providerToken) {
            try {
                providerToken = await getGoogleAccessToken(user.id);
            } catch (redisErr) {
                console.warn('--- [CALENDAR] Redis connection offline/error:', redisErr?.message || redisErr);
            }
        }

        // 경로 정규화 (Express app.use 마운트와 Vercel Serverless 호출 양쪽의 차이 해소)
        const url = req.url || '';
        let subPath = url.split('?')[0];
        if (subPath.startsWith('/api/calendar')) {
            subPath = subPath.substring('/api/calendar'.length);
        }

        // ID 추출 고도화 (Express params, Query string, Regex fallback 순으로 파싱)
        let id = req.params?.id || req.query?.id;
        if (!id) {
            const match = subPath.match(/^\/events\/([^/]+)/);
            if (match) {
                id = decodeURIComponent(match[1]);
            }
        }

        const consent = req.body?.aiContextConsent === true;
        const clientDiaries = req.body?.decryptedDiaries || [];

        // Handle POST (Create Event or E2E Zero-Knowledge Diary Analysis)
        if (req.method === 'POST') {
            const isAddRoute = subPath === '/add' || subPath === '/add/';
            const isAnalyzeRoute = subPath === '/analyze' || subPath === '/analyze/';
            
            let shouldAdd = false;
            let shouldAnalyze = false;

            if (isAddRoute) {
                shouldAdd = true;
            } else if (isAnalyzeRoute) {
                shouldAnalyze = true;
            } else {
                const hasSummary = req.body?.summary !== undefined;
                const hasTime = req.body?.startTime !== undefined || req.body?.start !== undefined;
                if (hasSummary && hasTime) {
                    shouldAdd = true;
                } else {
                    shouldAnalyze = true;
                }
            }

            if (shouldAnalyze) {
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

                // Call Service to fetch and analyze
                const result = await calendarService.getCalendarEvents({
                    userId: user.id,
                    userEmail: user.email,
                    providerToken,
                    consent,
                    clientDiaries,
                    forceRefresh: true
                });
                return res.json({ 
                    success: true, 
                    events: result.events, 
                    calendars: result.calendars, 
                    unlinked: result.unlinked, 
                    partialFailure: result.partialFailure, 
                    failedCalendars: result.failedCalendars 
                });
            }

            if (shouldAdd) {
                const summary = req.body?.summary;
                const startTime = req.body?.startTime || req.body?.start;
                const endTime = req.body?.endTime || req.body?.end;
                const description = req.body?.description || '';

                if (!summary || !startTime || !endTime) {
                    return res.status(400).json({ error: 'Missing summary, startTime, or endTime' });
                }

                if (!providerToken || providerToken === 'mock' || providerToken === 'null' || providerToken === 'undefined') {
                    return res.status(400).json({ error: 'Google Calendar 연동이 활성화되어 있지 않습니다.' });
                }

                const insertData = await calendarService.addGoogleCalendarEvent(providerToken, {
                    summary,
                    startTime,
                    endTime,
                    description
                }, 'primary', user.id);

                // Clear cache
                await redis.del(`user:${user.id}:calendar-advice-cache`);
                try {
                    const { clearGoogleCalendarCache } = require('./shared');
                    await clearGoogleCalendarCache(user.id);
                } catch (e) {
                    console.warn('[Calendar Route] Failed to clear calendar cache:', e.message);
                }
                return res.json({ success: true, event: insertData });
            }
        }

        // Handle DELETE (Delete Event)
        if (req.method === 'DELETE') {
            if (!id) return res.status(400).json({ error: 'Missing event id' });

            if (id.startsWith('extracted-task-')) {
                // Try to find the title & start date from the advice cache to build a stable composite key
                try {
                    const cacheKey = `user:${user.id}:calendar-advice-cache`;
                    const cached = await redis.get(cacheKey);
                    if (cached) {
                        const { analyzedEvents } = JSON.parse(cached);
                        const taskObj = (analyzedEvents || []).find(e => e.id === id);
                        if (taskObj && taskObj.title) {
                            const cleanTitle = (taskObj.title || '').trim().replace(/\s+/g, ' ');
                            const cleanStart = (taskObj.start || '').trim();
                            const stableKey = `${cleanTitle}_${cleanStart}`;
                            await redis.sadd(`user:${user.id}:dismissed-extracted-tasks`, stableKey);
                            await redis.expire(`user:${user.id}:dismissed-extracted-tasks`, 3600 * 24 * 30); // 30일 만료
                        }
                    }
                } catch (err) {
                    console.warn('[Calendar DELETE] Failed to store dismissed AI task composite key in Redis:', err.message);
                }

                // Clear advice cache to force recalculation without the dismissed task
                try {
                    await redis.del(`user:${user.id}:calendar-advice-cache`);
                } catch (err) {
                    console.warn('[Calendar DELETE] Failed to delete advice cache:', err.message);
                }
                return res.json({ success: true, message: 'AI 임시 추천 과제가 화면에서 제외되었습니다.' });
            }

            if (!providerToken || providerToken === 'mock' || providerToken === 'null' || providerToken === 'undefined') {
                return res.status(400).json({ error: 'Google Calendar 연동이 활성화되어 있지 않습니다.' });
            }

            await calendarService.deleteGoogleCalendarEvent(providerToken, id, user.id);

            // Clear database mapping
            try {
                const { supabaseAdmin } = require('./shared');
                if (supabaseAdmin) {
                    await supabaseAdmin
                        .from('sub_tasks')
                        .update({
                            google_calendar_id: null,
                            google_event_id: null,
                            google_sync_status: 'not_requested'
                        })
                        .eq('google_event_id', id);
                }
            } catch (dbErr) {
                console.warn('[Calendar DELETE] Failed to clear DB subtask mapping:', dbErr.message);
            }

            try {
                await redis.del(`user:${user.id}:calendar-advice-cache`);
            } catch (err) {
                console.warn('[Calendar DELETE] Failed to delete advice cache:', err.message);
            }
            return res.json({ success: true });
        }

        // Handle PATCH (Update Event)
        if (req.method === 'PATCH') {
            const { summary, start, end, startTime, endTime, description } = req.body;
            const finalStart = start || startTime;
            const finalEnd = end || endTime;

            if (!id) return res.status(400).json({ error: 'Missing event id' });
            if (!summary || !finalStart || !finalEnd) {
                return res.status(400).json({ error: 'Missing summary, start, or end time' });
            }

            if (!providerToken || providerToken === 'mock' || providerToken === 'null' || providerToken === 'undefined') {
                return res.status(400).json({ error: 'Google Calendar 연동이 활성화되어 있지 않습니다.' });
            }

            let cleanDescription = description || '';
            const progressMatch = cleanDescription.match(/\[Progress:\s*(\d+)\]/);
            const ratingMatch = cleanDescription.match(/\[Rating:\s*(\d+)\]/);
            const dateMatch = cleanDescription.match(/\[ReviewDate:\s*([^\]]*)\]/);
            const reflectionMatch = cleanDescription.match(/\[Reflection:\s*([^\]]*)\]/);

            const hasMeta = progressMatch || ratingMatch || dateMatch || reflectionMatch;
            if (hasMeta) {
                const progress = progressMatch ? parseInt(progressMatch[1], 10) : 0;
                const rating = ratingMatch ? parseInt(ratingMatch[1], 10) : 0;
                const reviewDate = dateMatch ? dateMatch[1].trim() : '';
                const reflection = reflectionMatch ? reflectionMatch[1].trim() : '';

                // Update sub_tasks in database
                const { supabaseAdmin } = require('./shared');
                if (supabaseAdmin) {
                    await supabaseAdmin
                        .from('sub_tasks')
                        .update({
                            progress,
                            rating,
                            review_date: reviewDate,
                            review_text: reflection
                        })
                        .eq('google_event_id', id);
                }

                // Cache in Redis: user:${userId}:subtask-eval:${calendarId}:${eventId}
                let calendarId = 'primary';
                try {
                    const mapped = await redis.get(`user:${user.id}:event-calendar-map:${id}`);
                    if (mapped) calendarId = mapped;
                } catch (err) {}
                
                try {
                    await redis.set(
                        `user:${user.id}:subtask-eval:${calendarId}:${id}`,
                        JSON.stringify({ progress, rating, reviewDate, reflection }),
                        'EX',
                        3600 * 24 * 30
                    );
                } catch (err) {}

                // Strip the tags from description
                cleanDescription = cleanDescription
                    .replace(/\[Task\]/g, '')
                    .replace(/\[Progress:\s*\d+\]/g, '')
                    .replace(/\[Rating:\s*\d+\]/g, '')
                    .replace(/\[ReviewDate:\s*[^\]]*\]/g, '')
                    .replace(/\[Reflection:\s*[^\]]*\]/g, '')
                    .trim();
            }

            const updateData = await calendarService.patchGoogleCalendarEvent(providerToken, id, {
                summary,
                start: finalStart,
                end: finalEnd,
                description: cleanDescription
            }, user.id);

            await redis.del(`user:${user.id}:calendar-advice-cache`);
            return res.json({ success: true, event: updateData });
        }

        // Handle GET (Load Calendar)
        const { refresh } = req.query;
        const result = await calendarService.getCalendarEvents({
            userId: user.id,
            userEmail: user.email,
            providerToken,
            consent,
            clientDiaries,
            forceRefresh: refresh === 'true'
        });

        return res.json({
            success: true,
            events: result.events,
            calendars: result.calendars,
            unlinked: result.unlinked,
            partialFailure: result.partialFailure,
            failedCalendars: result.failedCalendars
        });
    } catch (error) {
        return res.status(500).json({ error: error?.message || error });
    }
};
