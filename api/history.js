const { createClient } = require('@supabase/supabase-js');
const Redis = require('ioredis');
const ws = require('ws');

// Supabase 클라이언트 초기화 (Service Role 사용)
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false },
    realtime: { transport: ws }
});

// Redis 초기화
const redis = new Redis(process.env.REDIS_URL);

module.exports = async (req, res) => {
    if (req.method !== 'GET') {
        res.setHeader('Allow', ['GET']);
        return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
    }

    // 1. 인증 토큰 확인
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: '인증 정보가 필요합니다.' });
    }

    const token = authHeader.split(' ')[1];

    try {
        // 2. 사용자 인증 확인 (Supabase Service Role Client 사용)
        const { data: { user }, error: authError } = await supabase.auth.getUser(token);
        if (authError || !user) {
            console.error('Auth Error:', authError);
            return res.status(401).json({ error: '유효하지 않은 토큰입니다.' });
        }

        // 3. 해당 사용자의 Redis 키만 조회 (user:[ID]:diary-*)
        const pattern = `user:${user.id}:diary-*`;
        const keys = await redis.keys(pattern);
        console.log(`Found ${keys.length} keys for user ${user.id}`);
        
        if (keys.length === 0) {
            return res.status(200).json({ history: [] });
        }

        // 키가 너무 많을 경우를 대비해 최신 50개만 가져오기 (키 정렬 후)
        const sortedKeys = keys.sort().reverse().slice(0, 50);
        const values = await redis.mget(sortedKeys);
        
        // 데이터 파싱 및 정렬
        const history = [];
        for (let i = 0; i < values.length; i++) {
            const val = values[i];
            if (!val) continue;

            try {
                const item = JSON.parse(val);
                history.push({
                    id: sortedKeys[i],
                    originalContent: item.content || '',
                    aiResponse: item.response || '',
                    createdAt: item.createdAt || new Date().toISOString(),
                    emotion: item.emotion || '평온'
                });
            } catch (parseError) {
                console.error(`JSON Parse Error for key ${sortedKeys[i]}:`, parseError);
                // 손상된 데이터는 건너뜁니다.
            }
        }

        // 생성일자 기준 정렬
        history.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        return res.status(200).json({ history });
    } catch (error) {
        console.error('Supabase/Redis History Global Error:', error);
        return res.status(500).json({ error: '히스토리를 불러오는 중 서버 오류가 발생했습니다.' });
    }
};



