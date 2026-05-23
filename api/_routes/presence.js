const { supabase, redis, sendError } = require('./shared');

module.exports = async (req, res) => {
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return sendError(res, 401, '인증 정보가 필요합니다.');
        }

        const token = authHeader.split(' ')[1];
        const { data: { user }, error: authError } = await supabase.auth.getUser(token);
        if (authError || !user) {
            return sendError(res, 401, '유효하지 않은 토큰입니다.');
        }

        req.user = user;

        if (req.method !== 'POST') {
            return res.status(405).json({ error: 'Method Not Allowed' });
        }

        const userId = req.user.id;
        const key = `user:${userId}:presence`;
        await redis.set(key, 'online', 'EX', 30);

        return res.json({ success: true });
    } catch (error) {
        console.error('Presence Heartbeat Error:', error);
        return res.status(500).json({ success: false, error: '접속 상태 갱신 실패: ' + error.message });
    }
};
