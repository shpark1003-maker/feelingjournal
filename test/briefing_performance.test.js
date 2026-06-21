const assert = require('assert');
const shared = require('../api/_routes/shared');

// Create a proxy mock for callGemini since it's destructured on module load
const originalCallGemini = shared.callGemini;
let callGeminiMock = null;
shared.callGemini = async (...args) => {
    if (callGeminiMock) return callGeminiMock(...args);
    return originalCallGemini(...args);
};

const { redis } = shared;
const briefingService = require('../api/_services/briefingService');
const googleClient = require('../api/_routes/clients/google');

async function runPerformanceTests() {
    console.log('=== STARTING DAILY BRIEFING PERFORMANCE & CACHE TESTS ===\n');

    const testUserId = 'test-perf-user-uuid';
    const testRegion = '서울';
    const cacheKey = `user:${testUserId}:briefing-cache`;

    // Clean up before test
    await redis.del(cacheKey);
    await redis.del(`user:${testUserId}:briefing-swr-lock`);
    await redis.del(`user:${testUserId}:briefing-build-lock`);

    // ------------------------------------------------------------------------
    console.log('[TEST 1] Testing Google Calendar Event Cache range...');
    const timeMin = '2026-06-20T00:00:00Z';
    const timeMax = '2026-06-22T00:00:00Z';
    const calendarCacheKey = `user:${testUserId}:calendar-events-cache:${timeMin}:${timeMax}`;

    // Clear calendar cache
    await redis.del(calendarCacheKey);
    await redis.set(`user:${testUserId}:google_provider_token`, 'mock-token', 'EX', 3600);

    // Mock global fetch to count calendar API calls
    const originalGlobalFetch = global.fetch;
    let calendarApiFetchCount = 0;

    global.fetch = async (url, options) => {
        const urlStr = typeof url === 'string' ? url : url.toString();
        
        if (urlStr.includes('oauth2.googleapis.com/token')) {
            return {
                ok: true,
                status: 200,
                json: async () => ({ access_token: 'mock-access-token' })
            };
        }
        if (urlStr.includes('calendarList')) {
            calendarApiFetchCount++;
            return {
                ok: true,
                status: 200,
                json: async () => ({ items: [{ id: 'primary', selected: true, accessRole: 'owner' }] })
            };
        }
        if (urlStr.includes('calendars/primary/events')) {
            calendarApiFetchCount++;
            return {
                ok: true,
                status: 200,
                json: async () => ({ items: [{ id: 'evt-1', summary: '테스트 미팅', start: { dateTime: '2026-06-21T10:00:00Z' }, end: { dateTime: '2026-06-21T11:00:00Z' } }] })
            };
        }
        
        return {
            ok: false,
            status: 404,
            json: async () => ({})
        };
    };

    // First call (cache miss)
    const res1 = await googleClient.fetchGoogleCalendarEvents(testUserId, timeMin, timeMax);
    assert.ok(calendarApiFetchCount > 0, 'Google API should be hit on first run');
    const firstFetchCount = calendarApiFetchCount;

    // Second call (cache hit)
    const res2 = await googleClient.fetchGoogleCalendarEvents(testUserId, timeMin, timeMax);
    assert.strictEqual(calendarApiFetchCount, firstFetchCount, 'Should return cached result without hitting Google API');
    assert.deepStrictEqual(res2.events, res1.events, 'Cached events should match first run');

    // Invalidate Cache
    await googleClient.clearGoogleCalendarCache(testUserId);
    const cachedValAfterClear = await redis.get(calendarCacheKey);
    assert.strictEqual(cachedValAfterClear, null, 'Cache key should be deleted upon invalidation');

    // Restore global fetch
    global.fetch = originalGlobalFetch;

    console.log('✅ Google Calendar Event Cache tests PASSED!\n');


    // ------------------------------------------------------------------------
    console.log('[TEST 2] Testing Briefing Cache Fallback & Backward Compatibility...');
    
    // Set legacy cache (plain string)
    const legacyBriefingText = 'Legacy plain text daily briefing.';
    await redis.set(cacheKey, legacyBriefingText);

    // Load briefing from core generateBriefing (should fallback and return wrapper object safely)
    const result = await briefingService.generateBriefing(testUserId, 'mock-token', testRegion, [], false, 'test@example.com');
    assert.ok(result && typeof result === 'object');
    assert.strictEqual(result.briefing, legacyBriefingText, 'Should fallback and parse old string format cleanly');
    assert.strictEqual(result.weather, null);

    console.log('✅ Briefing Cache Fallback tests PASSED!\n');


    // ------------------------------------------------------------------------
    console.log('[TEST 3] Testing Briefing JSON Cache format...');
    await redis.del(cacheKey);

    // Setup mock for Gemini
    callGeminiMock = async () => ({
        candidates: [{ content: { parts: [{ text: '이것은 모의 생성된 브리핑입니다.' }] } }]
    });

    const newResult = await briefingService.generateBriefing(testUserId, 'mock-token', testRegion, [], false, 'test@example.com');
    assert.strictEqual(newResult.briefing, '이것은 모의 생성된 브리핑입니다.');

    // Check Redis raw value
    const rawRedis = await redis.get(cacheKey);
    assert.ok(rawRedis);
    const parsedRedis = JSON.parse(rawRedis);
    assert.strictEqual(parsedRedis.briefing, '이것은 모의 생성된 브리핑입니다.');
    assert.ok(parsedRedis.updatedAt);

    // Restore original functions
    callGeminiMock = null;

    // Clean up
    await redis.del(cacheKey);
    await redis.del(calendarCacheKey);

    console.log('=== ALL DAILY BRIEFING PERFORMANCE & CACHE TESTS PASSED! ===');
}

runPerformanceTests().catch(err => {
    console.error('Test suite failed:', err);
    process.exit(1);
});
