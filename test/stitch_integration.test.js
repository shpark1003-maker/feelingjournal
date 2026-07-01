require('dotenv').config();
const assert = require('assert');
const axios = require('axios');
const { redis } = require('../api/_routes/clients/redis');
const defaultTheme = require('../api/_routes/config/defaultTheme');
const stitchHandler = require('../api/_routes/stitch');

// Axios Mocking Helper
const originalGet = axios.get;
let mockResponse = null;
let mockError = null;
let apiCallCount = 0;

axios.get = async function (url, config) {
    apiCallCount++;
    if (mockError) {
        throw mockError;
    }
    return mockResponse;
};

// Mock Express req/res
function createMockReqRes() {
    const resHeaders = {};
    let statusValue = 200;
    let jsonBody = null;

    const req = {
        url: '/api/stitch',
        method: 'GET'
    };

    const res = {
        status: function (code) {
            statusValue = code;
            return this;
        },
        setHeader: function (name, value) {
            resHeaders[name] = value;
            return this;
        },
        json: function (body) {
            jsonBody = body;
            return this;
        },
        // Helper to get results in tests
        _getResult: function () {
            return {
                status: statusValue,
                headers: resHeaders,
                body: jsonBody
            };
        }
    };

    return { req, res };
}

async function runTests() {
    console.log('🧪 Starting Stitch API Integration Tests...');

    // Redis Key Cleanup
    const CACHE_KEY = 'stitch:design-tokens';
    const STALE_KEY = 'stitch:design-tokens:stale';
    await redis.del(CACHE_KEY);
    await redis.del(STALE_KEY);

    // 임시 환경변수 강제 주입
    process.env.STITCH_API_KEY = 'test_api_key_placeholder';
    process.env.STITCH_PROJECT_ID = 'test_project_id_placeholder';

    try {
        // --- 1. 환경변수 누락 시 Fallback 동작 테스트 ---
        console.log('1. Testing missing environment variables...');
        const originalKey = process.env.STITCH_API_KEY;
        delete process.env.STITCH_API_KEY;

        const { req: req1, res: res1 } = createMockReqRes();
        await stitchHandler(req1, res1);
        const result1 = res1._getResult();

        assert.strictEqual(result1.status, 200);
        assert.strictEqual(result1.body.version, defaultTheme.version);
        assert.strictEqual(result1.body.tokens['primary-color'], defaultTheme.tokens['primary-color']);
        console.log('✅ Environment variable fallback works.');

        // 복구
        process.env.STITCH_API_KEY = originalKey;

        // --- 2. 정상 응답 및 Redis 캐시 저장 테스트 ---
        console.log('2. Testing successful Stitch API response & Redis storage...');
        apiCallCount = 0;
        mockError = null;
        mockResponse = {
            status: 200,
            data: {
                version: 'v2.1.0-test',
                tokens: {
                    'primary-color': '#00ff00',
                    'secondary-color': '#0000ff',
                    'accent-color': '#ff0000',
                    'background-color': '#ffffff'
                }
            }
        };

        const { req: req2, res: res2 } = createMockReqRes();
        await stitchHandler(req2, res2);
        const result2 = res2._getResult();

        assert.strictEqual(result2.status, 200);
        assert.strictEqual(result2.headers['X-Cache'], 'MISS_POPULATED');
        assert.strictEqual(result2.body.version, 'v2.1.0-test');

        // Redis 캐시 저장 확인
        const cached = await redis.get(CACHE_KEY);
        const stale = await redis.get(STALE_KEY);
        assert.ok(cached);
        assert.ok(stale);
        assert.strictEqual(JSON.parse(cached).version, 'v2.1.0-test');
        assert.strictEqual(JSON.parse(stale).version, 'v2.1.0-test');
        console.log('✅ Successful flow and Redis caching works.');

        // --- 3. Redis Cache HIT 테스트 ---
        console.log('3. Testing Redis Cache HIT...');
        apiCallCount = 0; // API 호출이 발생하지 않아야 함
        const { req: req3, res: res3 } = createMockReqRes();
        await stitchHandler(req3, res3);
        const result3 = res3._getResult();

        assert.strictEqual(result3.status, 200);
        assert.strictEqual(result3.headers['X-Cache'], 'HIT');
        assert.strictEqual(result3.body.version, 'v2.1.0-test');
        assert.strictEqual(apiCallCount, 0);
        console.log('✅ Redis Cache HIT works without calling outer API.');

        // --- 4. Stitch API 장애 발생 시 Stale 캐시 Fallback 테스트 ---
        console.log('4. Testing API Timeout / 500 error Stale Cache Fallback...');
        // 캐시 만료 시뮬레이션: TTL 캐시 지움 (stale은 유지)
        await redis.del(CACHE_KEY);

        // API 에러 모킹
        apiCallCount = 0;
        mockError = new Error('Connection Timeout');
        mockError.response = { status: 504 };

        const { req: req4, res: res4 } = createMockReqRes();
        await stitchHandler(req4, res4);
        const result4 = res4._getResult();

        assert.strictEqual(result4.status, 200);
        assert.strictEqual(result4.headers['X-Cache'], 'STALE_FALLBACK');
        assert.strictEqual(result4.headers['X-API-Error-Status'], 504);
        assert.strictEqual(result4.body.version, 'v2.1.0-test'); // stale 캐시 본 리턴
        console.log('✅ Stale Cache Fallback works on API failure.');

        // --- 5. 캐시 및 API 완전 장애 시 최후 defaultTheme Fallback 테스트 ---
        console.log('5. Testing absolute failure fallback to defaultTheme...');
        await redis.del(CACHE_KEY);
        await redis.del(STALE_KEY); // Stale 캐시마저 지움

        const { req: req5, res: res5 } = createMockReqRes();
        await stitchHandler(req5, res5);
        const result5 = res5._getResult();

        assert.strictEqual(result5.status, 200);
        assert.strictEqual(result5.headers['X-Cache'], 'DEFAULT_FALLBACK');
        assert.strictEqual(result5.body.version, defaultTheme.version);
        console.log('✅ defaultTheme Fallback works under absolute failure.');

        console.log('\n🎉 ALL STITCH API INTEGRATION TESTS PASSED!');
    } catch (testError) {
        console.error('❌ Test failed with error:', testError);
        process.exit(1);
    } finally {
        // Restore Axios & Clean up
        axios.get = originalGet;
        await redis.del(CACHE_KEY);
        await redis.del(STALE_KEY);
        // ioredis 커넥션 종료하여 프로세스가 중단 없이 종료되게 함
        redis.disconnect();
    }
}

runTests();
