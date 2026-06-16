const { redis } = require('./redis');
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
                calendars = listData.items.filter(cal => 
                    cal.selected === true && 
                    cal.hidden !== true && 
                    ['owner', 'writer', 'reader'].includes(cal.accessRole)
                );
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

        const failedCalendars = [];
        const allFetchedEvents = [];

        // 2. Fetch events from all calendars in chunks of 3
        const concurrencyLimit = 3;
        for (let i = 0; i < calendars.length; i += concurrencyLimit) {
            const chunk = calendars.slice(i, i + concurrencyLimit);
            const chunkPromises = chunk.map(async (cal) => {
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

            const results = await Promise.allSettled(chunkPromises);
            for (const result of results) {
                if (result.status === 'fulfilled' && result.value) {
                    allFetchedEvents.push(...result.value);
                }
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
            }
        }

        deduplicatedEvents.sort((a, b) => {
            const aStart = a.start?.dateTime || a.start?.date || '';
            const bStart = b.start?.dateTime || b.start?.date || '';
            return aStart.localeCompare(bStart);
        });

        const partialFailure = failedCalendars.length > 0;

        return {
            events: deduplicatedEvents,
            calendars: calendars.map(c => ({ id: c.id, summary: c.summary })),
            unlinked: isTokenEvicted,
            partialFailure,
            failedCalendars
        };

    } catch (err) {
        console.error('--- [fetchGoogleCalendarEvents] Error:', err.message);
        return { events: [], unlinked: false, partialFailure: true, failedCalendars: [{ id: 'all', summary: '전체 조회 오류', error: err.message }] };
    }
}

module.exports = {
    refreshGoogleAccessToken,
    getGoogleAccessToken,
    fetchGoogleCalendarEvents
};
