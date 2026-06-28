const { redis, scanRedisKeys } = require('./redis');
const { fetchWithTimeout } = require('../utils/fetchUtils');

async function refreshGoogleAccessToken(userId) {
    try {
        const refreshToken = await redis.get(`user:${userId}:google_provider_refresh_token`);
        if (!refreshToken) {
            console.warn(`--- [Google OAuth Refresh] No refresh token found in Redis for user ${userId} ---`);
            return null;
        }

        const clientId = (process.env.GOOGLE_CLIENT_ID || '').replace(/["']/g, '').trim();
        const clientSecret = (process.env.GOOGLE_CLIENT_SECRET || '').replace(/["']/g, '').trim();

        if (!clientId || !clientSecret) {
            console.warn('--- [Google OAuth Refresh] GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET is not configured in .env ---');
            return null;
        }

        console.log(`--- [Google OAuth Refresh] Attempting to refresh Google Access Token for user ${userId} ---`);
        
        const response = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: new URLSearchParams({
                client_id: clientId,
                client_secret: clientSecret,
                refresh_token: refreshToken,
                grant_type: 'refresh_token'
            })
        });

        const data = await response.json();
        if (!response.ok) {
            console.error('--- [Google OAuth Refresh] Google Token Refresh API returned error:', data);
            return null;
        }

        const newAccessToken = data.access_token;
        if (newAccessToken) {
            await redis.set(`user:${userId}:google_provider_token`, newAccessToken, 'EX', 3600);
            console.log(`--- [Google OAuth Refresh] Successfully refreshed Google Access Token for user ${userId} ---`);
            return newAccessToken;
        }
        return null;
    } catch (err) {
        console.error('--- [Google OAuth Refresh] Error refreshing token:', err.message);
        return null;
    }
}

async function getGoogleAccessToken(userId) {
    try {
        let token = await redis.get(`user:${userId}:google_provider_token`);
        if (!token) {
            token = await refreshGoogleAccessToken(userId);
        }
        return token;
    } catch (err) {
        console.error('--- [Google Access Token Helper] Error fetching token:', err.message);
        return null;
    }
}

async function fetchGoogleCalendarEvents(userId, timeMin, timeMax, userEmail = '') {
    const cacheKey = `user:${userId}:calendar-events-cache:${timeMin || 'all'}:${timeMax || 'all'}`;
    try {
        const cached = await redis.get(cacheKey);
        if (cached) {
            console.log(`--- [CACHE] Returning cached Google Calendar events for user ${userId} ---`);
            return JSON.parse(cached);
        }
    } catch (cacheErr) {
        console.warn(`--- [CACHE READ ERROR] Failed to load calendar cache for user ${userId}: ${cacheErr.message} ---`);
    }

    try {
        const providerToken = await getGoogleAccessToken(userId);
        if (!providerToken) {
            return { events: [], unlinked: true, partialFailure: false, failedCalendars: [] };
        }

        // 1. Get calendar list
        const listUrl = `https://www.googleapis.com/calendar/v3/users/me/calendarList`;
        const listRes = await fetchWithTimeout(listUrl, { headers: { Authorization: `Bearer ${providerToken}` }, failFast: true }, 4000);
        
        let calendars = [{ id: 'primary', summary: '기본 캘린더' }];
        let isTokenEvicted = false;
        
        if (listRes.ok) {
            const listData = await listRes.json();
            if (listData.items && listData.items.length > 0) {
                calendars = listData.items.filter(cal => {
                    const isSelected = cal.selected === true;
                    const isBirthdayCal = cal.id === 'addressbook#contacts@group.v.calendar.google.com' ||
                                        cal.id.includes('contacts@group.v.calendar.google.com') ||
                                        cal.id.includes('#contacts@') ||
                                        cal.summary === '생일' ||
                                        cal.summary === 'Birthdays' ||
                                        (cal.summary && (cal.summary.includes('생일') || cal.summary.includes('Birthday')));
                    
                    return (isSelected || isBirthdayCal) && 
                           cal.hidden !== true && 
                           ['owner', 'writer', 'reader'].includes(cal.accessRole);
                });
                if (calendars.length === 0) {
                    calendars = [{ id: 'primary', summary: '기본 캘린더' }];
                }
            }
        } else {
            if (listRes.status === 401 || listRes.status === 403) {
                await redis.del(`user:${userId}:google_provider_token`);
                await redis.del(`user:${userId}:google_provider_refresh_token`);
                console.warn(`--- [fetchGoogleCalendarEvents] Invalid token detected on calendarList (Status ${listRes.status}). Evicted Google tokens for user ${userId} ---`);
                return { events: [], unlinked: true, partialFailure: false, failedCalendars: [] };
            }
            console.warn('--- [fetchGoogleCalendarEvents] Failed to fetch Google calendarList, falling back to primary ---');
        }

        // Ensure AI Angel Calendar is included
        try {
            const aiCalId = await redis.get(`user:${userId}:ai-angel-calendar-id`);
            if (aiCalId && !calendars.some(c => c.id === aiCalId)) {
                calendars.push({ id: aiCalId, summary: '👼 AI 천사 과제' });
            }
        } catch (redisErr) {
            console.warn('--- [fetchGoogleCalendarEvents] Failed to fetch AI calendar ID from Redis:', redisErr.message);
        }

        const failedCalendars = [];
        const fetchPromises = calendars.map(async (cal) => {
            try {
                let url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.id)}/events?singleEvents=true&maxResults=250`;
                if (timeMin) url += `&timeMin=${encodeURIComponent(timeMin)}`;
                if (timeMax) url += `&timeMax=${encodeURIComponent(timeMax)}`;
                
                const res = await fetchWithTimeout(url, { headers: { Authorization: `Bearer ${providerToken}` }, failFast: true }, 4000);
                if (res.ok) {
                    const data = await res.json();
                    const items = data.items || [];
                    return items.map(item => ({ ...item, _calendarId: cal.id }));
                } else {
                    if (res.status === 401 || res.status === 403) {
                        isTokenEvicted = true;
                        await redis.del(`user:${userId}:google_provider_token`);
                        await redis.del(`user:${userId}:google_provider_refresh_token`);
                        console.warn(`--- [fetchGoogleCalendarEvents] Invalid token detected on event fetch (Status ${res.status}). Evicted Google tokens for user ${userId} ---`);
                    }
                    throw new Error(`Google API returned status ${res.status}`);
                }
            } catch (err) {
                console.warn(`--- [fetchGoogleCalendarEvents] Failed for calendar ${cal.id} (${cal.summary}):`, err.message);
                failedCalendars.push({ id: cal.id, summary: cal.summary || cal.id, error: err.message });
                return [];
            }
        });

        const results = await Promise.allSettled(fetchPromises);
        const allFetchedEvents = [];
        for (const result of results) {
            if (result.status === 'fulfilled' && result.value) {
                allFetchedEvents.push(...result.value);
            }
        }

        // 3. Deduplicate events
        const seenEvents = new Set();
        const deduplicatedEvents = [];

        for (const item of allFetchedEvents) {
            const start = item.start?.dateTime || item.start?.date || '';
            const end = item.end?.dateTime || item.end?.date || '';
            const summary = (item.summary || '').trim().toLowerCase().replace(/\s+/g, '');
            const iCalUID = item.iCalUID || '';
            const compoundKey = `${item._calendarId}:${item.id}`;
            const fuzzyKey = `${summary}_${start}_${end}`;

            let isDuplicate = false;
            
            if (iCalUID && seenEvents.has(`ical_${iCalUID}`)) {
                isDuplicate = true;
            } else if (seenEvents.has(`id_${compoundKey}`)) {
                isDuplicate = true;
            } else if (summary && start && seenEvents.has(`fuzzy_${fuzzyKey}`)) {
                isDuplicate = true;
            }

            if (!isDuplicate) {
                if (iCalUID) seenEvents.add(`ical_${iCalUID}`);
                seenEvents.add(`id_${compoundKey}`);
                if (summary && start) seenEvents.add(`fuzzy_${fuzzyKey}`);

                deduplicatedEvents.push(item);

                // Cache the calendar ID for this event ID to allow PATCH/DELETE
                try {
                    redis.set(`user:${userId}:event-calendar-map:${item.id}`, item._calendarId, 'EX', 3600 * 24 * 30);
                } catch (err) {
                    console.warn(`Failed to cache calendar ID mapping for event ${item.id}:`, err.message);
                }
            }
        }

        deduplicatedEvents.sort((a, b) => {
            const aStart = a.start?.dateTime || a.start?.date || '';
            const bStart = b.start?.dateTime || b.start?.date || '';
            return aStart.localeCompare(bStart);
        });

        const partialFailure = failedCalendars.length > 0;

        const result = {
            events: deduplicatedEvents,
            calendars: calendars.map(c => ({ id: c.id, summary: c.summary })),
            unlinked: isTokenEvicted,
            partialFailure,
            failedCalendars
        };

        try {
            await redis.set(cacheKey, JSON.stringify(result), 'EX', 600); // 10분 캐시
            console.log(`--- [CACHE SET] Cached calendar events for user ${userId} (TTL 10m) ---`);
        } catch (cacheSetErr) {
            console.warn(`--- [CACHE WRITE ERROR] Failed to cache calendar events for user ${userId}: ${cacheSetErr.message} ---`);
        }

        return result;

    } catch (err) {
        console.error('--- [fetchGoogleCalendarEvents] Error:', err.message);
        return { events: [], unlinked: false, partialFailure: true, failedCalendars: [{ id: 'all', summary: '전체 조회 오류', error: err.message }] };
    }
}

async function clearGoogleCalendarCache(userId) {
    try {
        const pattern = `user:${userId}:calendar-events-cache:*`;
        const keys = await scanRedisKeys(pattern);
        if (keys && keys.length > 0) {
            console.log(`--- [CACHE INVALIDATE] Deleting ${keys.length} calendar event caches for user ${userId} ---`);
            await redis.del(keys);
        }
    } catch (e) {
        console.error(`--- [CACHE INVALIDATE ERROR] Failed to clear calendar cache:`, e.message);
    }
}

async function getOrCreateAiAngelCalendar(userId, providerToken) {
    if (!providerToken || providerToken === 'mock' || providerToken === 'null' || providerToken === 'undefined') {
        throw new Error('Google Calendar 연동이 활성화되어 있지 않습니다.');
    }

    const cacheKey = `user:${userId}:ai-angel-calendar-id`;
    try {
        const cachedId = await redis.get(cacheKey);
        if (cachedId) {
            return cachedId;
        }
    } catch (err) {
        console.warn('[Google Client] Failed to read cached AI calendar ID from Redis:', err.message);
    }

    // 1. Get calendar list to check if it already exists
    const listUrl = `https://www.googleapis.com/calendar/v3/users/me/calendarList`;
    const listRes = await fetchWithTimeout(listUrl, {
        headers: { Authorization: `Bearer ${providerToken}` },
        failFast: true
    }, 4000);

    if (listRes.ok) {
        const listData = await listRes.json();
        const items = listData.items || [];
        const existing = items.find(cal => cal.summary === '👼 AI 천사 과제');
        if (existing) {
            try {
                await redis.set(cacheKey, existing.id, 'EX', 3600 * 24 * 30);
            } catch (err) {
                console.warn('[Google Client] Failed to cache AI calendar ID:', err.message);
            }
            return existing.id;
        }
    }

    // 2. Not found, let's create a new secondary calendar
    console.log(`[Google Client] Dedicated AI calendar not found. Creating for user: ${userId}`);
    const createUrl = `https://www.googleapis.com/calendar/v3/calendars`;
    const createRes = await fetchWithTimeout(createUrl, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${providerToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            summary: '👼 AI 천사 과제',
            description: 'AI 천사(Schedule Angel)가 생성한 세부 과제 및 일정 관리 캘린더'
        }),
        failFast: true
    }, 4000);

    if (!createRes.ok) {
        const errData = await createRes.json().catch(() => ({}));
        throw new Error(errData.error?.message || 'Failed to create secondary calendar');
    }

    const newCal = await createRes.json();
    try {
        await redis.set(cacheKey, newCal.id, 'EX', 3600 * 24 * 30);
    } catch (err) {
        console.warn('[Google Client] Failed to cache newly created AI calendar ID:', err.message);
    }
    return newCal.id;
}

module.exports = {
    refreshGoogleAccessToken,
    getGoogleAccessToken,
    fetchGoogleCalendarEvents,
    getOrCreateAiAngelCalendar,
    clearGoogleCalendarCache
};
