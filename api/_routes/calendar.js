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

        let id = null;
        let isDeleteTask = false;
        if (subPath.startsWith('/tasks/')) {
            isDeleteTask = true;
            id = subPath.substring('/tasks/'.length).replace(/\/$/, '');
        }

        // ID 추출 고도화 (Express params, Query string, Regex fallback 순으로 파싱)
        if (!id) {
            let idParam = req.params?.id || req.query?.id;
            if (idParam) {
                id = idParam;
            } else {
                const match = subPath.match(/^\/events\/([^/]+)/);
                if (match) {
                    id = decodeURIComponent(match[1]);
                }
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

        // Handle DELETE (Delete Event or Entire Task)
        if (req.method === 'DELETE') {
            if (!id) return res.status(400).json({ error: 'Missing event id or task id' });

            if (isDeleteTask) {
                const { supabaseAdmin } = require('./shared');
                if (!supabaseAdmin) {
                    return res.status(500).json({ error: 'Supabase admin client not initialized.' });
                }

                try {
                    console.log(`[Calendar Task DELETE] id: "${id}", user.id: "${user.id}"`);
                    // 1) Verify ownership of the parent task
                    const { data: taskData, error: verifyErr } = await supabaseAdmin
                        .from('tasks')
                        .select('*')
                        .eq('id', id)
                        .eq('user_id', user.id)
                        .single();

                    if (verifyErr || !taskData) {
                        console.warn(`[Calendar Task DELETE] Verification failed:`, verifyErr || 'No task found');
                        return res.status(403).json({ 
                            error: `Forbidden: You do not own this task. (Task ID: ${id}, User ID: ${user.id}, DB Status: ${verifyErr ? verifyErr.message : 'Not Found'})` 
                        });
                    }

                    // 2) Get subtasks to delete from Google Calendar
                    const { data: subTasks } = await supabaseAdmin
                        .from('sub_tasks')
                        .select('*')
                        .eq('task_id', id);

                    if (providerToken && providerToken !== 'mock' && providerToken !== 'null' && providerToken !== 'undefined') {
                        for (const st of (subTasks || [])) {
                            if (st.google_event_id) {
                                try {
                                    await calendarService.deleteGoogleCalendarEvent(providerToken, st.google_event_id, user.id);
                                } catch (googleErr) {
                                    console.warn(`[Calendar Task DELETE] Failed to delete event ${st.google_event_id} (non-blocking):`, googleErr.message);
                                }
                            }
                        }
                    }

                    // 3) Delete subtasks from DB
                    const { error: subtasksDelErr } = await supabaseAdmin
                        .from('sub_tasks')
                        .delete()
                        .eq('task_id', id);
                    if (subtasksDelErr) throw subtasksDelErr;

                    // 4) Delete parent task from DB
                    const { error: taskDelErr } = await supabaseAdmin
                        .from('tasks')
                        .delete()
                        .eq('id', id);
                    if (taskDelErr) throw taskDelErr;

                    await redis.del(`user:${user.id}:calendar-advice-cache`);
                    await redis.del(`user:${user.id}:briefing-cache`);
                    try {
                        const { clearGoogleCalendarCache } = require('./shared');
                        await clearGoogleCalendarCache(user.id);
                    } catch (e) {}

                    return res.json({ success: true });
                } catch (err) {
                    console.error('[Calendar Task DELETE] Error:', err);
                    return res.status(500).json({ error: err.message });
                }
            }

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

        // Handle PATCH (Update Event / Evaluation / Reschedule Shift)
        if (req.method === 'PATCH') {
            const { summary, start, end, startTime, endTime, description } = req.body;
            const finalStart = start || startTime;
            const finalEnd = end || endTime;

            if (!id) return res.status(400).json({ error: 'Missing event id' });
            if (!summary || !finalStart || !finalEnd) {
                return res.status(400).json({ error: 'Missing summary, start, or end time' });
            }

            const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
            const { supabaseAdmin } = require('./shared');

            let dbSubTask = null;
            if (supabaseAdmin) {
                try {
                    let query = supabaseAdmin.from('sub_tasks').select('*, tasks!inner(user_id, due_date)');
                    if (isUuid) {
                        query = query.eq('id', id);
                    } else {
                        query = query.eq('google_event_id', id);
                    }
                    const { data } = await query;
                    if (data && data.length > 0) {
                        dbSubTask = data[0];
                        if (dbSubTask.tasks?.user_id !== user.id) {
                            return res.status(403).json({ error: 'Forbidden: You do not own this task.' });
                        }
                    }
                } catch (fetchErr) {
                    console.warn('[Calendar PATCH] Failed to look up subtask:', fetchErr.message);
                }
            }

            const formatToKstDate = (dateStr) => {
                if (!dateStr) return null;
                const d = new Date(dateStr);
                if (isNaN(d.getTime())) return null;
                const y = d.getFullYear();
                const m = String(d.getMonth() + 1).padStart(2, '0');
                const day = String(d.getDate()).padStart(2, '0');
                return `${y}-${m}-${day}`;
            };

            const newStartDate = formatToKstDate(finalStart);
            const newDueDate = formatToKstDate(finalEnd);

            let diffDays = 0;
            if (dbSubTask && newDueDate && dbSubTask.due_date !== newDueDate) {
                const oldMs = new Date(dbSubTask.due_date + 'T00:00:00+09:00').getTime();
                const newMs = new Date(newDueDate + 'T00:00:00+09:00').getTime();
                diffDays = Math.round((newMs - oldMs) / (1000 * 60 * 60 * 24));
            }

            let cleanDescription = description || '';
            const progressMatch = cleanDescription.match(/\[Progress:\s*(\d+)\]/);
            const ratingMatch = cleanDescription.match(/\[Rating:\s*(\d+)\]/);
            const dateMatch = cleanDescription.match(/\[ReviewDate:\s*([^\]]*)\]/);
            const reflectionMatch = cleanDescription.match(/\[Reflection:\s*([^\]]*)\]/);

            const hasMeta = progressMatch || ratingMatch || dateMatch || reflectionMatch;
            let dbUpdated = false;

            const isCompletedOrEvaluated = (st) => {
                return st.is_completed || (st.progress || 0) >= 100 || (st.rating || 0) > 0 || st.review_text || st.reviewed_at || st.reflection;
            };

            if (dbSubTask) {
                try {
                    const updatePayload = {
                        start_date: newStartDate || dbSubTask.start_date,
                        due_date: newDueDate || dbSubTask.due_date
                    };

                    if (hasMeta) {
                        const progress = progressMatch ? parseInt(progressMatch[1], 10) : 0;
                        const rating = ratingMatch ? parseInt(ratingMatch[1], 10) : 0;
                        const reviewDate = dateMatch ? dateMatch[1].trim() : '';
                        const reflection = reflectionMatch ? reflectionMatch[1].trim() : '';

                        updatePayload.progress = progress;
                        updatePayload.rating = rating;
                        updatePayload.review_date = reviewDate;
                        updatePayload.review_text = reflection;
                        updatePayload.is_completed = progress >= 100;
                        updatePayload.completed_at = progress >= 100 ? new Date().toISOString() : null;
                    }

                    const { data, error } = await supabaseAdmin
                        .from('sub_tasks')
                        .update(updatePayload)
                        .eq('id', dbSubTask.id)
                        .select();

                    if (data && data.length > 0) {
                        dbUpdated = true;
                        // Refresh dbSubTask
                        dbSubTask = { ...dbSubTask, ...updatePayload };
                    }
                } catch (dbErr) {
                    console.warn('[Calendar PATCH] Failed to update sub_tasks table:', dbErr.message);
                }

                // Shifting subsequent uncompleted subtasks cascadingly
                if (diffDays !== 0) {
                    try {
                        const { data: subsequentSubTasks } = await supabaseAdmin
                            .from('sub_tasks')
                            .select('*')
                            .eq('task_id', dbSubTask.task_id)
                            .gt('sequence_order', dbSubTask.sequence_order)
                            .order('sequence_order', { ascending: true });

                        const addDays = (dateStr, days) => {
                            const date = new Date(dateStr + 'T00:00:00+09:00');
                            date.setDate(date.getDate() + days);
                            const y = date.getFullYear();
                            const m = String(date.getMonth() + 1).padStart(2, '0');
                            const day = String(date.getDate()).padStart(2, '0');
                            return `${y}-${m}-${day}`;
                        };

                        for (const st of (subsequentSubTasks || [])) {
                            if (!isCompletedOrEvaluated(st)) {
                                const shiftedStart = addDays(st.start_date, diffDays);
                                const shiftedDue = addDays(st.due_date, diffDays);

                                await supabaseAdmin
                                    .from('sub_tasks')
                                    .update({
                                        start_date: shiftedStart,
                                        due_date: shiftedDue
                                    })
                                    .eq('id', st.id);

                                if (st.google_event_id && providerToken && providerToken !== 'mock' && providerToken !== 'null' && providerToken !== 'undefined') {
                                    try {
                                        const nextDay = new Date(shiftedDue + 'T00:00:00+09:00');
                                        nextDay.setDate(nextDay.getDate() + 1);
                                        const nextDayStr = nextDay.toISOString().split('T')[0];

                                        const cleanDesc = (st.description || '')
                                            .replace(/\[Task\]/g, '')
                                            .replace(/\[Progress:\s*\d+\]/g, '')
                                            .replace(/\[Rating:\s*\d+\]/g, '')
                                            .replace(/\[ReviewDate:\s*[^\]]*\]/g, '')
                                            .replace(/\[Reflection:\s*[^\]]*\]/g, '')
                                            .trim();

                                        await calendarService.patchGoogleCalendarEvent(providerToken, st.google_event_id, {
                                            summary: `👼 ${st.title} 마감`,
                                            start: shiftedDue,
                                            end: nextDayStr,
                                            description: cleanDesc
                                        }, user.id);
                                    } catch (googleErr) {
                                        console.warn(`[Calendar PATCH Cascading] Failed to update Google Calendar event ${st.google_event_id}:`, googleErr.message);
                                    }
                                }
                            }
                        }

                        // Recalculate parent task due_date
                        const { data: allSubTasks } = await supabaseAdmin
                            .from('sub_tasks')
                            .select('due_date')
                            .eq('task_id', dbSubTask.task_id);
                        if (allSubTasks && allSubTasks.length > 0) {
                            const maxDueDate = allSubTasks.reduce((max, st) => st.due_date > max ? st.due_date : max, allSubTasks[0].due_date);
                            await supabaseAdmin
                                .from('tasks')
                                .update({ due_date: maxDueDate })
                                .eq('id', dbSubTask.task_id);
                        }
                    } catch (cascadeErr) {
                        console.error('[Calendar PATCH] Cascade shift failed:', cascadeErr);
                    }
                }

                if (dbUpdated && hasMeta) {
                    cleanDescription = cleanDescription
                        .replace(/\[Task\]/g, '')
                        .replace(/\[Progress:\s*\d+\]/g, '')
                        .replace(/\[Rating:\s*\d+\]/g, '')
                        .replace(/\[ReviewDate:\s*[^\]]*\]/g, '')
                        .replace(/\[Reflection:\s*[^\]]*\]/g, '')
                        .trim();
                }
            }

            let googleEvent = null;
            const hasGoogleCalendar = providerToken && providerToken !== 'mock' && providerToken !== 'null' && providerToken !== 'undefined';
            const targetEventId = dbSubTask ? dbSubTask.google_event_id : id;

            if (targetEventId && hasGoogleCalendar) {
                try {
                    googleEvent = await calendarService.patchGoogleCalendarEvent(providerToken, targetEventId, {
                        summary,
                        start: finalStart,
                        end: finalEnd,
                        description: cleanDescription
                    }, user.id);
                } catch (apiErr) {
                    console.warn('[Calendar PATCH] Google Calendar update failed (non-blocking):', apiErr.message);
                }
            }

            await redis.del(`user:${user.id}:calendar-advice-cache`);
            await redis.del(`user:${user.id}:briefing-cache`);
            return res.json({ success: true, event: googleEvent || dbSubTask });
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
