const { 
    supabase, 
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

        const e2eKey = req.headers['x-e2e-key'] || null;

        const pattern = `user:${user.id}:diary-*`;
        const allKeys = await scanRedisKeys(pattern);

        if (allKeys.length === 0) return res.json({ success: true, history: [] });

        const sortedKeys = allKeys.sort().reverse().slice(0, 50);
        const values = await redis.mget(sortedKeys);

        const notebooksKey = `user:${user.id}:notebooks`;
        const notebooksData = await redis.get(notebooksKey);
        const notebooks = notebooksData ? JSON.parse(notebooksData) : [];
        const firstNotebookId = notebooks.length > 0 ? notebooks[0].id : null;

        const history = [];

        for (let i = 0; i < values.length; i++) {
            if (!values[i]) continue;

            try {
                const item = JSON.parse(values[i]);

                // 필기장 정보가 없거나 기본값('nb-1')인 경우 새 필기장으로 임시 배정
                if (firstNotebookId && (!item.notebookId || item.notebookId === 'nb-1')) {
                    item.notebookId = firstNotebookId;
                    await redis.set(sortedKeys[i], JSON.stringify(item), 'KEEPTTL');
                }

                history.push({
                    id: sortedKeys[i],
                    title: item.title || '제목 없는 메모',
                    originalContent: decrypt(item.content, e2eKey),
                    richContent: item.richContent ? decrypt(item.richContent, e2eKey) : null,
                    aiResponse: decrypt(item.response, e2eKey),
                    createdAt: item.createdAt,
                    emotion: item.emotion,
                    mediaId: item.mediaId || null,
                    notebookId: item.notebookId || 'nb-1'
                });
            } catch (e) {
                console.error('History Parse Error:', e.message);
            }
        }

        return res.json({ success: true, history });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
};
