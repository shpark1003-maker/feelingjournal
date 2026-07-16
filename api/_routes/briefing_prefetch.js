const { redis } = require('./shared');
const { waitUntil } = require('@vercel/functions');
const crypto = require('crypto');
const { getKstDateKey } = require('./utils/dateUtils');
const { generateBriefing, commitBriefingData, isBriefingDisabled } = require('../_services/briefingService');
const { getAiConsentStatus } = require('../_services/apiSettingsService');

// runBackground: 어댑터 로직 (Vercel 환경과 로컬 환경 호환)
function runBackground(taskFn) {
    if (typeof waitUntil === 'function') {
        try {
            waitUntil(taskFn());
            return true;
        } catch (e) {
            console.error('waitUntil failed:', e);
            return false; // 등록 실패
        }
    } else {
        // 로컬 환경이나 비-Vercel 환경
        setTimeout(() => taskFn().catch(e => console.error('Background task failed:', e)), 0);
        return true;
    }
}

module.exports = async function(req, res) {
    // 1. 프리패치 메서드는 명확히 POST로 고정
    if (req.method === 'GET') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const { user, providerToken } = req;
    if (!user || !user.id) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    
    const userId = user.id;

    // Rate Limiting (Short TTL)
    const rateKey = `user:${userId}:briefing-prefetch-rate`;
    const rateAllowed = await redis.set(rateKey, '1', 'NX', 'EX', 15);
    if (!rateAllowed) {
        res.setHeader('Retry-After', '15');
        return res.status(429).json({ error: 'Too Many Requests', retryAfterMs: 15000 });
    }

    const dateStr = getKstDateKey();
    const cacheKey = `user:${userId}:briefing:${dateStr}`;
    const lockKey = `user:${userId}:briefing-build-lock:${dateStr}`;
    const revisionKey = `user:${userId}:briefing-revision:${dateStr}`;
    const startedKey = `user:${userId}:briefing-refresh-status:${dateStr}`;

    try {
        if (await isBriefingDisabled(userId)) {
            await redis.del(cacheKey);
            return res.status(200).json({ status: 'disabled' });
        }

        // AI 동의 여부 확인
        // 동의가 false여도 브리핑 자체(일정/날씨/과제)는 생성 가능하므로 prefetch는 계속 수행한다.
        // consent 값은 generateBriefing 내부에서 일기/회상 컨텍스트 포함 여부를 제어한다.
        const consent = await getAiConsentStatus(userId);

        // 캐시 확인
        const cachedStr = await redis.get(cacheKey);
        const isDirty = await redis.exists(revisionKey);
        
        if (cachedStr && !isDirty) {
            return res.status(200).json({ status: 'ready' });
        }

        // 락 획득 시도
        const ownerToken = crypto.randomUUID();
        const ttl = Math.max(Number(process.env.VERCEL_FUNCTION_MAX_DURATION_SECONDS || 60) + 30, 90);
        
        const isLocked = await redis.set(lockKey, ownerToken, 'NX', 'EX', ttl);
        if (!isLocked) {
            // 다른 탭이나 요청이 이미 생성 중임
            return res.status(202).json({ status: 'generating' });
        }
        await redis.set(startedKey, 'started', 'EX', 45);

        // 락을 획득했으므로 현재 Revision을 읽어 Sentinel __NONE__ 적용
        const revisionAtStart = (await redis.get(revisionKey)) || '__NONE__';

        // 백그라운드 작업 정의
        const backgroundTask = async () => {
            try {
                // generateBriefing의 skipCacheSave=true로 호출
                const resultObj = await generateBriefing(
                    userId, 
                    providerToken, 
                    null, 
                    [], 
                    consent, 
                    user.email || '', 
                    true, // forceRefresh
                    false, // skipIfUnchanged
                    false, // forceRefreshCalendar
                    { skipCacheSave: true }
                );

                if (!resultObj || resultObj.briefing === 'GENERATING' || resultObj.briefing.includes('할당량 초과')) {
                    // Gemini 호출 실패나 임시 응답 -> 캐시 커밋 안 함 (락은 TTL 만료로 해제하거나 직접 해제)
                    // 직접 해제 (Lua를 쓰지 않고 소유자 검증 후 해제만 수행해도 되나 원자성을 위해 Lua 사용)
                    const unlockScript = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`;
                    await redis.eval(unlockScript, 1, lockKey, ownerToken);
                    await redis.del(startedKey);
                    return;
                }

                // Lua 다중 조건 커밋
                const commitResult = await commitBriefingData(userId, dateStr, resultObj, ownerToken, revisionAtStart);
                await redis.del(startedKey);
                console.log(`--- [PREFETCH COMMIT] User: ${userId}, Result: ${commitResult} ---`);
            } catch (err) {
                console.error(`--- [PREFETCH TASK ERROR] ${err.message} ---`);
                // 에러 시 락 즉시 반환
                const unlockScript = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`;
                await redis.eval(unlockScript, 1, lockKey, ownerToken);
                await redis.del(startedKey);
            }
        };

        // 작업 등록
        const isRegistered = runBackground(backgroundTask);
        if (!isRegistered) {
            // waitUntil 등록 실패 복구 (즉시 락 해제 및 5xx)
            const unlockScript = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`;
            await redis.eval(unlockScript, 1, lockKey, ownerToken);
            await redis.del(startedKey);
            return res.status(500).json({ error: 'Failed to start background task' });
        }

        return res.status(202).json({ status: 'accepted', refreshStatus: 'started' });

    } catch (err) {
        console.error('Prefetch error:', err);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};
