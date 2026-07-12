const { fetchGoogleCalendarEvents } = require('../_routes/clients/google');
const { supabaseAdmin } = require('../_routes/clients/supabase');

async function syncGoogleCalendarToLocal(userId, syncOptions = {}) {
    console.log(`--- [SYNC] Starting Google Calendar Sync for user: ${userId} ---`);

    // 1. 가져올 기간 설정 (기본: 오늘 기준 -7일 ~ +60일)
    const now = new Date();
    const timeMin = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const timeMax = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000).toISOString();

    // 0. Phase 6: Write-back 로직 (Local -> Google)
    const currentSyncTime = new Date().toISOString();
    let writebackCount = 0;
    const { getGoogleAccessToken, redis } = require('../_routes/shared');
    const providerToken = await getGoogleAccessToken(userId);
    let calendarRoles = {};
    
    if (providerToken) {
        const cacheKey = `user:${userId}:calendar_list_cache`;
        const cachedCals = await redis.get(cacheKey);
        if (cachedCals) {
            JSON.parse(cachedCals).forEach(c => calendarRoles[c.id] = c.accessRole);
        }

        const { data: pendingChanges } = await supabaseAdmin
            .from('calendar_events')
            .select('*')
            .eq('user_id', userId)
            .eq('source', 'external')
            .eq('external_provider', 'google')
            .not('last_local_modified_at', 'is', null);

        if (pendingChanges && pendingChanges.length > 0) {
            const changesToPush = pendingChanges.filter(ev => {
                if (!ev.last_synced_at) return true;
                return new Date(ev.last_local_modified_at) > new Date(ev.last_synced_at);
            });

            const { fetchWithTimeout } = require('../_routes/utils/fetchUtils');
            
            for (const ev of changesToPush) {
                if (ev.sync_status === 'conflict') continue;
                
                const role = calendarRoles[ev.external_calendar_id] || 'reader';
                if (role !== 'owner' && role !== 'writer') continue;

                const patchUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(ev.external_calendar_id)}/events/${encodeURIComponent(ev.external_event_id)}`;
                
                const patchBody = {
                    summary: ev.title,
                    description: ev.description,
                    location: ev.location
                };
                if (ev.is_all_day) {
                    patchBody.start = { date: ev.start_time.split('T')[0] };
                    patchBody.end = { date: ev.end_time ? ev.end_time.split('T')[0] : ev.start_time.split('T')[0] };
                } else {
                    patchBody.start = { dateTime: ev.start_time };
                    patchBody.end = { dateTime: ev.end_time };
                }

                const headers = {
                    'Authorization': `Bearer ${providerToken}`,
                    'Content-Type': 'application/json'
                };
                if (ev.external_etag) {
                    headers['If-Match'] = ev.external_etag; // 🚀 ETag 검증 (충돌 방지)
                }

                try {
                    const patchRes = await fetchWithTimeout(patchUrl, { method: 'PATCH', headers, body: JSON.stringify(patchBody) });
                    if (patchRes.status === 412) {
                        // 412 Precondition Failed -> ETag 불일치 (Google에서 수정됨)
                        await supabaseAdmin.from('calendar_events').update({ sync_status: 'conflict' }).eq('id', ev.id);
                    } else if (patchRes.ok) {
                        const updatedData = await patchRes.json();
                        await supabaseAdmin.from('calendar_events').update({
                            external_etag: updatedData.etag,
                            external_updated_at: updatedData.updated,
                            last_synced_at: currentSyncTime,
                            sync_status: 'synced'
                        }).eq('id', ev.id);
                        writebackCount++;
                    }
                } catch (err) {
                    console.error('Write-back error:', err.message);
                }
            }
        }
    }

    // 2. 구글 캘린더 이벤트 Fetch (Phase 2: primaryOnly fallback)
    const options = { primaryOnly: syncOptions.primaryOnly !== false, selectedCalendars: syncOptions.selectedCalendars }; 
    const result = await fetchGoogleCalendarEvents(userId, timeMin, timeMax, '', options);

    if (result.unlinked || result.events.length === 0) {
        console.log(`--- [SYNC] No events fetched or unlinked for user: ${userId} ---`);
        return { success: true, count: 0 };
    }

    const fetchedEvents = result.events;
    let upsertCount = 0;

    // 3. Upsert 로직
    for (const ev of fetchedEvents) {
        // Fallback for updated_at
        const externalUpdatedAt = ev.updated || ev.created || null;
        const externalEtag = ev.etag || null;

        const eventData = {
            user_id: userId,
            title: ev.summary || '제목 없음',
            description: ev.description || '',
            start_time: ev.start?.dateTime || ev.start?.date || null,
            end_time: ev.end?.dateTime || ev.end?.date || null,
            is_all_day: !!ev.start?.date,
            location: ev.location || '',
            source: 'external',
            external_provider: 'google',
            external_calendar_id: ev._calendarId || 'primary',
            external_event_id: ev.id,
            external_etag: externalEtag,
            external_updated_at: externalUpdatedAt,
            last_synced_at: currentSyncTime,
            sync_status: 'synced',
            is_deleted: false,
            deleted_at: null,
            raw_payload: ev
        };

        if (!eventData.start_time) continue; // 유효하지 않은 이벤트 스킵

        // 기존 데이터 조회하여 업데이트 비교
        const { data: existing } = await supabaseAdmin
            .from('calendar_events')
            .select('id, external_updated_at, external_etag, last_local_modified_at, last_synced_at, sync_status')
            .eq('user_id', userId)
            .eq('external_provider', 'google')
            .eq('external_calendar_id', eventData.external_calendar_id)
            .eq('external_event_id', eventData.external_event_id)
            .maybeSingle();

        let shouldUpsert = true;
        if (existing) {
            if (existing.sync_status === 'conflict') {
                shouldUpsert = false;
            } else if (existing.last_local_modified_at && existing.last_synced_at && new Date(existing.last_local_modified_at) > new Date(existing.last_synced_at)) {
                // Local has pending changes
                if (externalUpdatedAt && existing.external_updated_at && new Date(externalUpdatedAt) > new Date(existing.external_updated_at)) {
                    // Google also changed -> CONFLICT
                    await supabaseAdmin.from('calendar_events').update({ sync_status: 'conflict' }).eq('external_event_id', eventData.external_event_id);
                    shouldUpsert = false;
                } else if (externalEtag && existing.external_etag && externalEtag !== existing.external_etag) {
                    await supabaseAdmin.from('calendar_events').update({ sync_status: 'conflict' }).eq('external_event_id', eventData.external_event_id);
                    shouldUpsert = false;
                } else {
                    // Only local changed, do not overwrite from google
                    shouldUpsert = false;
                }
            } else {
                if (externalUpdatedAt && existing.external_updated_at) {
                    if (new Date(externalUpdatedAt) <= new Date(existing.external_updated_at)) {
                        shouldUpsert = false;
                    }
                } else if (externalEtag && existing.external_etag) {
                    if (externalEtag === existing.external_etag) {
                        shouldUpsert = false;
                    }
                }
            }
        }

        if (shouldUpsert) {
            let error = null;
            if (existing && existing.id) {
                const { error: updateErr } = await supabaseAdmin
                    .from('calendar_events')
                    .update(eventData)
                    .eq('id', existing.id);
                error = updateErr;
            } else {
                const { error: insertErr } = await supabaseAdmin
                    .from('calendar_events')
                    .insert([eventData]);
                error = insertErr;
            }
            if (error) {
                console.error(`--- [SYNC ERROR] Failed to upsert event ${ev.id}:`, error.message);
            } else {
                upsertCount++;
            }
        }
    }

    // 4. Soft-delete 로직 (범위 내에서 구글 응답에 없는 이벤트 삭제 처리)
    const fetchedEventIds = fetchedEvents.map(e => e.id);
    
    // DB에서 동기화 범위 내의 구글 이벤트 목록 가져오기
    const { data: localEvents, error: fetchErr } = await supabaseAdmin
        .from('calendar_events')
        .select('id, external_event_id')
        .eq('user_id', userId)
        .eq('source', 'external')
        .eq('external_provider', 'google')
        .eq('is_deleted', false)
        .gte('start_time', timeMin)
        .lte('start_time', timeMax);
        
    let deleteCount = 0;
    if (!fetchErr && localEvents) {
        for (const localEv of localEvents) {
            if (!fetchedEventIds.includes(localEv.external_event_id)) {
                // 구글에서 지워진 일정
                await supabaseAdmin
                    .from('calendar_events')
                    .update({ 
                        is_deleted: true, 
                        deleted_at: currentSyncTime,
                        last_synced_at: currentSyncTime
                    })
                    .eq('id', localEv.id);
                deleteCount++;
            }
        }
    }

    console.log(`--- [SYNC] Completed. Upserted: ${upsertCount}, Soft-deleted: ${deleteCount}, Write-backed: ${writebackCount} ---`);
    return { success: true, upsertCount, deleteCount, writebackCount };
}

module.exports = {
    syncGoogleCalendarToLocal
};
