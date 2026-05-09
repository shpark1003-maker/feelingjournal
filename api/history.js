const Redis = require('ioredis');

// Redis 클라이언트 초기화
const redis = process.env.REDIS_URL ? new Redis(process.env.REDIS_URL) : null;

module.exports = async (req, res) => {
    // 1. GET 요청만 허용
    if (req.method !== 'GET') {
        res.setHeader('Allow', ['GET']);
        return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
    }

    if (!redis) {
        return res.status(500).json({ error: 'Redis 연결 설정이 되어 있지 않습니다.' });
    }

    try {
        let cursor = '0';
        let allKeys = [];

        // diary-* 패턴에 맞는 모든 키를 SCAN으로 가져오기
        do {
            const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', 'diary-*', 'COUNT', 100);
            cursor = nextCursor;
            allKeys = allKeys.concat(keys);
        } while (cursor !== '0');

        if (allKeys.length === 0) {
            return res.status(200).json({ history: [] });
        }

        // 모든 키에 대한 데이터 가져오기
        const values = await redis.mget(allKeys);
        
        const history = allKeys.map((key, index) => {
            const data = JSON.parse(values[index]);
            return {
                id: key,
                ...data
            };
        });

        // 결과 반환
        return res.status(200).json({ history });
    } catch (error) {
        console.error('Redis History Error:', error);
        return res.status(500).json({ error: '히스토리를 불러오는 중 오류가 발생했습니다.' });
    }
};
