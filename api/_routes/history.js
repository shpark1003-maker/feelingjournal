const { 
    supabase, 
    supabaseAdmin,
    redis, 
    scanRedisKeys,
    decrypt
} = require('./shared');

module.exports = async (req, res) => {
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
        const { data: { user } } = await supabase.auth.getUser(authHeader.split(' ')[1]);
        if (!user) return res.status(401).json({ error: 'Invalid user' });

        const url = req.url;
        const path = url.split('?')[0];

        // 1. Handle DELETE (Delete history entry)
        if (req.method === 'DELETE') {
            let id = req.query?.id || new URL(url, 'http://localhost').searchParams.get('id');
            if (!id && path !== '/api/history') {
                id = path.split('/').pop();
            }
            const key = decodeURIComponent(id || '');

            if (!key || !key.startsWith(`user:${user.id}:diary-`)) {
                return res.status(403).json({ error: '삭제 권한이 없습니다.' });
            }

            const deletedCount = await redis.del(key);
            let postgresDeleted = false;

            try {
                const dbClient = supabaseAdmin || supabase;
                const { error: delError } = await dbClient
                    .from('diaries')
                    .delete()
                    .eq('id', key);
                postgresDeleted = !delError;
            } catch (dbErr) {
                console.error('--- [DELETE DB ERROR] Failed to delete diary from Postgres:', dbErr?.message || dbErr);
            }

            if (deletedCount === 0 && !postgresDeleted) {
                return res.status(404).json({ error: '삭제할 메모를 찾을 수 없습니다.' });
            }
            return res.json({ success: true });
        }

        // 2. Handle PATCH (Update history entry)
        if (req.method === 'PATCH') {
            let id = req.query?.id || new URL(url, 'http://localhost').searchParams.get('id');
            if (!id && path !== '/api/history') {
                id = path.split('/').pop();
            }
            const key = decodeURIComponent(id || '');

            if (!key || !key.startsWith(`user:${user.id}:diary-`)) {
                return res.status(403).json({ error: '수정 권한이 없습니다. (소유자 불일치)' });
            }

            const { title, content, richContent, shared, sharedWith } = req.body;

            let item = null;
            const existingData = await redis.get(key);
            if (existingData) {
                item = JSON.parse(existingData);
            } else {
                // Fallback to PostgreSQL
                const dbClient = supabaseAdmin || supabase;
                const { data: dbDiary } = await dbClient
                    .from('diaries')
                    .select('*')
                    .eq('id', key)
                    .maybeSingle();
                if (dbDiary) {
                    item = {
                        title: dbDiary.title,
                        content: dbDiary.content,
                        richContent: dbDiary.rich_content,
                        response: dbDiary.response,
                        createdAt: dbDiary.created_at,
                        emotion: dbDiary.emotion,
                        mediaId: dbDiary.media_id,
                        notebookId: dbDiary.notebook_id,
                        shared: dbDiary.shared,
                        sharedWith: dbDiary.shared_with || []
                    };
                }
            }

            if (!item) {
                return res.status(404).json({ error: '메모를 찾을 수 없습니다.' });
            }

            if (title !== undefined) item.title = title;
            if (content !== undefined) item.content = content;
            if (richContent !== undefined) item.richContent = richContent;

            // Handle sharing updates
            if (shared !== undefined || sharedWith !== undefined) {
                const prevSharedWith = item.sharedWith || [];
                const newSharedWith = sharedWith !== undefined ? sharedWith : (shared ? prevSharedWith : []);
                const isShared = shared !== undefined ? !!shared : newSharedWith.length > 0;

                item.shared = isShared;
                item.sharedWith = newSharedWith;

                const prevIds = prevSharedWith.map(r => r.id);
                const newIds = newSharedWith.map(r => r.id);

                const addedIds = newIds.filter(id => !prevIds.includes(id));
                const removedIds = prevIds.filter(id => !newIds.includes(id));

                const dbClient = supabaseAdmin || supabase;

                // Process sharing removals
                if (removedIds.length > 0) {
                    await dbClient
                        .from('shared_diaries')
                        .delete()
                        .eq('diary_key', key)
                        .in('recipient_id', removedIds);

                    for (const rid of removedIds) {
                        await redis.srem(`user:${rid}:shared-diaries`, key);
                    }
                }

                // Process sharing additions
                if (addedIds.length > 0) {
                    const { data: validProfiles, error: profileErr } = await dbClient
                        .from('profiles')
                        .select('id')
                        .in('id', addedIds);

                    if (profileErr) {
                        console.error('--- [PATCH DB ERROR] select profiles failed:', profileErr);
                        return res.status(500).json({ error: profileErr.message });
                    }
                    if (validProfiles) {
                        const validIds = validProfiles.map(p => p.id);
                        const recordsToInsert = newSharedWith
                            .filter(r => validIds.includes(r.id))
                            .map(r => ({
                                diary_key: key,
                                owner_id: user.id,
                                recipient_id: r.id
                            }));

                        if (recordsToInsert.length > 0) {
                            const { error: insErr } = await dbClient.from('shared_diaries').insert(recordsToInsert);
                            if (insErr) {
                                console.error('--- [PATCH DB ERROR] insert shared_diaries failed:', insErr);
                                return res.status(500).json({ error: insErr.message });
                            }

                            for (const rec of recordsToInsert) {
                                await redis.sadd(`user:${rec.recipient_id}:shared-diaries`, key);
                            }
                        }
                    }
                }
            }

            // Save back to Redis with 30-day expiration
            await redis.set(key, JSON.stringify(item), 'EX', 3600 * 24 * 30);

            // Sync update to Postgres
            try {
                const dbClient = supabaseAdmin || supabase;
                await dbClient
                    .from('diaries')
                    .upsert({
                        id: key,
                        user_id: user.id,
                        title: item.title,
                        content: item.content,
                        rich_content: item.richContent,
                        response: item.response,
                        emotion: item.emotion,
                        media_id: item.mediaId,
                        notebook_id: item.notebookId,
                        shared: !!item.shared,
                        shared_with: item.sharedWith || []
                    }, { onConflict: 'id' });
            } catch (dbErr) {
                console.error('--- [PATCH DB ERROR] Failed to sync updated diary to Postgres:', dbErr?.message || dbErr);
            }

            return res.json({ success: true, title: item.title, shared: item.shared, sharedWith: item.sharedWith });
        }

        // 3. Handle GET (List history entries)
        if (req.method === 'GET') {
            const e2eKey = req.headers['x-e2e-key'] || null;

            // Load own diaries from Redis cache
            const pattern = `user:${user.id}:diary-*`;
            const ownRedisKeys = await scanRedisKeys(pattern);

            // Load own diaries from PostgreSQL (to handle individual Redis cache evictions)
            const dbClient = supabaseAdmin || supabase;
            let ownDbKeys = [];
            try {
                const { data: dbDiaries } = await dbClient
                    .from('diaries')
                    .select('id')
                    .eq('user_id', user.id);
                if (dbDiaries) {
                    ownDbKeys = dbDiaries.map(d => d.id);
                }
            } catch (err) {
                console.error('Failed to load own diaries from Postgres:', err);
            }

            // Load shared diaries from PostgreSQL
            let sharedDiaries = [];
            try {
                const { data: sharedMappings } = await dbClient
                    .from('shared_diaries')
                    .select('diary_key, owner_id')
                    .eq('recipient_id', user.id);
                sharedDiaries = sharedMappings || [];
            } catch (err) {
                console.error('Failed to load shared mappings from Postgres:', err);
            }

            const sharedKeys = sharedDiaries.map(m => m.diary_key);
            const allKeysToFetch = [...new Set([...ownRedisKeys, ...ownDbKeys, ...sharedKeys])];

            // De-duplicate, sort by timestamp descending, and slice to top 50
            const uniqueKeys = [...new Set(allKeysToFetch)].sort().reverse().slice(0, 50);

            if (uniqueKeys.length === 0) {
                return res.json({ success: true, history: [] });
            }

            // MGET from Redis
            const redisValues = await redis.mget(uniqueKeys);

            // Fallback for cache misses
            const missingKeys = [];
            for (let i = 0; i < uniqueKeys.length; i++) {
                if (!redisValues[i]) {
                    missingKeys.push(uniqueKeys[i]);
                }
            }

            let dbFallbacks = [];
            if (missingKeys.length > 0) {
                try {
                    const { data } = await dbClient
                        .from('diaries')
                        .select('*')
                        .in('id', missingKeys);
                    dbFallbacks = data || [];
                } catch (dbErr) {
                    console.error('Failed to fetch fallback diaries from Postgres:', dbErr);
                }
            }

            // Get notebooks info to assign first notebook if default 'nb-1' or missing
            const notebooksKey = `user:${user.id}:notebooks`;
            const notebooksData = await redis.get(notebooksKey);
            const notebooks = notebooksData ? JSON.parse(notebooksData) : [];
            const firstNotebookId = notebooks.length > 0 ? notebooks[0].id : null;

            const history = [];

            // Load profiles of owners of shared diaries
            const ownerIds = [...new Set(sharedDiaries.map(m => m.owner_id))];
            let ownerProfiles = [];
            if (ownerIds.length > 0) {
                try {
                    const { data } = await dbClient
                        .from('profiles')
                        .select('id, nickname')
                        .in('id', ownerIds);
                    ownerProfiles = data || [];
                } catch (err) {
                    console.error('Failed to load owner profiles:', err);
                }
            }

            for (let i = 0; i < uniqueKeys.length; i++) {
                const key = uniqueKeys[i];
                let item = null;

                if (redisValues[i]) {
                    try {
                        item = JSON.parse(redisValues[i]);
                    } catch (e) {
                        console.error('History Parse Error:', e.message);
                    }
                }

                if (!item) {
                    const dbMatch = dbFallbacks.find(d => d.id === key);
                    if (dbMatch) {
                        item = {
                            title: dbMatch.title,
                            content: dbMatch.content,
                            richContent: dbMatch.rich_content,
                            response: dbMatch.response,
                            createdAt: dbMatch.created_at,
                            emotion: dbMatch.emotion,
                            mediaId: dbMatch.media_id,
                            notebookId: dbMatch.notebook_id,
                            shared: dbMatch.shared,
                            sharedWith: dbMatch.shared_with || []
                        };
                        // Cache it asynchronously
                        redis.set(key, JSON.stringify(item), 'EX', 3600 * 24 * 30).catch(() => {});
                    }
                }

                if (!item) continue;

                const isSharedIncoming = !key.startsWith(`user:${user.id}:diary-`);
                let sharedBy = null;

                if (isSharedIncoming) {
                    const mapping = sharedDiaries.find(m => m.diary_key === key);
                    if (mapping) {
                        const profile = ownerProfiles.find(p => p.id === mapping.owner_id);
                        sharedBy = {
                            id: mapping.owner_id,
                            nickname: profile ? profile.nickname : '알 수 없는 사용자'
                        };
                    }
                }

                if (firstNotebookId && (!item.notebookId || item.notebookId === 'nb-1')) {
                    item.notebookId = firstNotebookId;
                    if (!isSharedIncoming) {
                        redis.set(key, JSON.stringify(item), 'KEEPTTL').catch(() => {});
                    }
                }

                history.push({
                    id: key,
                    title: item.title || '제목 없는 메모',
                    originalContent: decrypt(item.content, e2eKey),
                    richContent: item.richContent ? decrypt(item.richContent, e2eKey) : null,
                    aiResponse: decrypt(item.response, e2eKey),
                    createdAt: item.createdAt,
                    emotion: item.emotion,
                    mediaId: item.mediaId || null,
                    notebookId: item.notebookId || 'nb-1',
                    shared: !!item.shared,
                    sharedWith: item.sharedWith || [],
                    isSharedIncoming,
                    sharedBy,
                    isE2e: !!(item.content && item.content.startsWith('e2e:'))
                });
            }

            return res.json({ success: true, history });
        }

        return res.status(404).json({ error: 'Endpoint Not Found' });
    } catch (error) {
        console.error('History API Error:', error);
        return res.status(500).json({ error: error.message });
    }
};
