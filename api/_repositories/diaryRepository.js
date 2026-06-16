const { redis, supabase, supabaseAdmin } = require('../_routes/shared');

/**
 * Get diary detail from Redis with PostgreSQL fallback
 */
async function getDiary(diaryKey) {
    if (!diaryKey) return null;

    try {
        const cached = await redis.get(diaryKey);
        if (cached) {
            return JSON.parse(cached);
        }
    } catch (e) {
        console.error(`--- [Repository Error] Redis read failed for ${diaryKey}:`, e.message);
    }

    // Fallback to PostgreSQL
    try {
        const dbClient = supabaseAdmin || supabase;
        const { data: dbDiary, error } = await dbClient
            .from('diaries')
            .select('*')
            .eq('id', diaryKey)
            .maybeSingle();

        if (error) throw error;

        if (dbDiary) {
            const diaryData = {
                title: dbDiary.title,
                content: dbDiary.content,
                richContent: dbDiary.rich_content,
                response: dbDiary.response,
                createdAt: dbDiary.created_at || new Date().toISOString(),
                emotion: dbDiary.emotion,
                mediaId: dbDiary.media_id,
                notebookId: dbDiary.notebook_id,
                shared: dbDiary.shared ?? false,
                sharedWith: dbDiary.shared_with || []
            };

            // Restore in Redis cache (EX: 30 days)
            try {
                await redis.set(diaryKey, JSON.stringify(diaryData), 'EX', 3600 * 24 * 30);
            } catch (cacheErr) {
                console.error(`--- [Repository Error] Failed to write cache back for ${diaryKey}:`, cacheErr.message);
            }

            return diaryData;
        }
    } catch (dbErr) {
        console.error(`--- [Repository Error] PostgreSQL fallback failed for ${diaryKey}:`, dbErr.message);
    }

    return null;
}

/**
 * Save new diary or fully overwrite existing diary in Redis and PostgreSQL
 */
async function saveDiary(diaryKey, userId, diaryData) {
    const timestamp = new Date().toISOString();
    
    // Normalize data object to guarantee consistent JSON shape
    const normalizedData = {
        title: diaryData.title || '제목 없는 메모',
        content: diaryData.content || '',
        richContent: diaryData.richContent || null,
        response: diaryData.response || '',
        createdAt: diaryData.createdAt || timestamp,
        emotion: diaryData.emotion || '평온',
        mediaId: diaryData.mediaId || null,
        notebookId: diaryData.notebookId || 'nb-1',
        shared: diaryData.shared ?? false,
        sharedWith: diaryData.sharedWith || []
    };

    // 1. Redis save
    await redis.set(diaryKey, JSON.stringify(normalizedData), 'EX', 3600 * 24 * 30);

    // 2. PostgreSQL upsert
    const dbClient = supabaseAdmin || supabase;
    const { error } = await dbClient
        .from('diaries')
        .upsert({
            id: diaryKey,
            user_id: userId,
            title: normalizedData.title,
            content: normalizedData.content,
            rich_content: normalizedData.richContent,
            response: normalizedData.response,
            emotion: normalizedData.emotion,
            media_id: normalizedData.mediaId,
            notebook_id: normalizedData.notebookId,
            shared: normalizedData.shared,
            shared_with: normalizedData.sharedWith
        }, { onConflict: 'id' });

    if (error) {
        throw new Error(`Postgres Upsert Failed: ${error.message}`);
    }

    return normalizedData;
}

module.exports = {
    getDiary,
    saveDiary
};
