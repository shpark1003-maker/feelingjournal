const axios = require('axios');
const { redis } = require('./clients/redis');
const defaultTheme = require('./config/defaultTheme');

// Redis keys
const CACHE_KEY = 'stitch:design-tokens';
const STALE_KEY = 'stitch:design-tokens:stale';
const CACHE_TTL = 1200; // 20 minutes in seconds

module.exports = async (req, res) => {
    const apiKey = process.env.STITCH_API_KEY;
    const projectId = process.env.STITCH_PROJECT_ID;

    // 1. 환경변수 누락 체크 -> 누락 시 즉시 fallback 반환 (경고 로그 기록)
    if (!apiKey || !projectId) {
        console.warn('Stitch API config missing. Serving default theme fallback.');
        return res.status(200).json(defaultTheme);
    }

    try {
        // 2. Redis Cache HIT 확인 (TTL 20분)
        const cachedData = await redis.get(CACHE_KEY);
        if (cachedData) {
            try {
                const parsed = JSON.parse(cachedData);
                if (parsed && parsed.version && parsed.tokens) {
                    res.setHeader('X-Cache', 'HIT');
                    return res.status(200).json(parsed);
                }
            } catch (parseErr) {
                console.error('Failed to parse cached Redis tokens:', parseErr);
            }
        }

        // 3. Redis Cache MISS -> Stitch API 호출 (Timeout 3초 제한)
        let response;
        try {
            response = await axios.get(`https://api.stitch-design.com/v1/projects/${projectId}/design-system`, {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Accept': 'application/json'
                },
                timeout: 3000 // 3 seconds timeout
            });
        } catch (apiErr) {
            // Stitch API 장애 발생 (Timeout, 429 Rate Limit, 500, 401/403 등)
            console.error('Stitch API call failed. Processing fallback flow:', apiErr.message);

            const httpStatus = apiErr.response ? apiErr.response.status : null;

            // 429(Rate Limit) 또는 기타 서버 에러 시 
            // Redis Stale Cache(무기한 백업본)에서 조회
            const staleData = await redis.get(STALE_KEY);
            if (staleData) {
                try {
                    const parsedStale = JSON.parse(staleData);
                    if (parsedStale && parsedStale.version && parsedStale.tokens) {
                        res.setHeader('X-Cache', 'STALE_FALLBACK');
                        res.setHeader('X-API-Error-Status', httpStatus || 'TIMEOUT');
                        return res.status(200).json(parsedStale);
                    }
                } catch (staleParseErr) {
                    console.error('Failed to parse stale cached tokens:', staleParseErr);
                }
            }

            // Stale 캐시마저 없거나 손상된 경우 최후 보루 defaultTheme 반환
            res.setHeader('X-Cache', 'DEFAULT_FALLBACK');
            res.setHeader('X-API-Error-Status', httpStatus || 'TIMEOUT');
            return res.status(200).json(defaultTheme);
        }

        // 4. API 호출 성공 시 캐싱 및 반환
        const responseData = response.data;
        if (responseData && responseData.version && responseData.tokens) {
            // ioredis를 통해 20분 TTL 캐시와 무기한 Stale 캐시 동시 저장
            await redis.set(CACHE_KEY, JSON.stringify(responseData), 'EX', CACHE_TTL);
            await redis.set(STALE_KEY, JSON.stringify(responseData));

            res.setHeader('X-Cache', 'MISS_POPULATED');
            return res.status(200).json(responseData);
        } else {
            // Stitch API 응답 스키마가 비정상적인 경우의 폴백 처리
            console.error('Stitch API returned invalid shape:', responseData);
            const staleData = await redis.get(STALE_KEY);
            if (staleData) {
                return res.status(200).json(JSON.parse(staleData));
            }
            return res.status(200).json(defaultTheme);
        }

    } catch (globalErr) {
        console.error('Global error in /api/stitch:', globalErr);
        // 최종 예외 발생 시 안전하게 defaultTheme 반환
        return res.status(200).json(defaultTheme);
    }
};
