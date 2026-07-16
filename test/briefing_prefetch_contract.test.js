const assert = require('assert');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SHARED_PATH = path.resolve(ROOT, 'api/_routes/shared.js');
const BRIEFING_ROUTE_PATH = path.resolve(ROOT, 'api/_routes/briefing.js');
const PREFETCH_ROUTE_PATH = path.resolve(ROOT, 'api/_routes/briefing_prefetch.js');
const BRIEFING_SERVICE_PATH = path.resolve(ROOT, 'api/_services/briefingService.js');
const API_SETTINGS_SERVICE_PATH = path.resolve(ROOT, 'api/_services/apiSettingsService.js');
const DATE_UTIL_PATH = path.resolve(ROOT, 'api/_routes/utils/dateUtils.js');

function clearModule(modulePath) {
    delete require.cache[modulePath];
}

function createMockRedis() {
    const store = new Map();

    const redis = {
        async get(key) {
            return store.has(key) ? store.get(key) : null;
        },
        async set(key, value, ...args) {
            let nx = false;
            for (let i = 0; i < args.length; i++) {
                if (args[i] === 'NX') nx = true;
            }
            if (nx && store.has(key)) return null;
            store.set(key, value);
            return 'OK';
        },
        async del(...keys) {
            let count = 0;
            keys.flat().forEach((key) => {
                if (store.delete(key)) count += 1;
            });
            return count;
        },
        async exists(key) {
            return store.has(key) ? 1 : 0;
        },
        async mget(keys) {
            return keys.map((k) => (store.has(k) ? store.get(k) : null));
        },
        async eval(script, numKeys, ...args) {
            const keys = args.slice(0, numKeys);
            const argv = args.slice(numKeys);

            // unlock script path
            if (numKeys === 1 && script.includes('redis.call("get", KEYS[1]) == ARGV[1]')) {
                const [lockKey] = keys;
                const [ownerToken] = argv;
                if ((store.get(lockKey) || null) === ownerToken) {
                    store.delete(lockKey);
                    return 1;
                }
                return 0;
            }

            // commitBriefingData lua path
            if (numKeys === 3 && script.includes('lock owner mismatch') && script.includes('revision changed')) {
                const [lockKey, revisionKey, cacheKey] = keys;
                const [ownerToken, revisionAtStart, readyData] = argv;

                if ((store.get(lockKey) || null) !== ownerToken) return -1;
                const currentRevision = store.get(revisionKey) || null;
                if ((currentRevision || '__NONE__') !== revisionAtStart) return -2;

                store.set(cacheKey, readyData);
                if (currentRevision) store.delete(revisionKey);
                store.delete(lockKey);
                return 1;
            }

            throw new Error('Unhandled eval script in test double');
        },
        _store: store
    };

    return redis;
}

function mockShared(redis, userId = '33333333-3333-4333-8333-333333333333') {
    const { getKstDateKey } = require(DATE_UTIL_PATH);

    const sharedMock = {
        redis,
        supabase: {
            auth: {
                async getUser() {
                    return { data: { user: { id: userId, email: 'test@example.com' } }, error: null };
                }
            }
        },
        supabaseAdmin: {
            from() {
                return {
                    select() {
                        return {
                            eq() {
                                return {
                                    maybeSingle: async () => ({ data: null })
                                };
                            }
                        };
                    }
                };
            }
        },
        getLiveWeather: async () => null,
        getGoogleAccessToken: async () => null,
        getKstDateKey,
        callGemini: async () => ({
            candidates: [{ content: { parts: [{ text: '테스트 브리핑' }] } }]
        }),
        scanRedisKeys: async () => []
    };

    require.cache[SHARED_PATH] = {
        id: SHARED_PATH,
        filename: SHARED_PATH,
        loaded: true,
        exports: sharedMock
    };

    return sharedMock;
}

function mockVercelFunctions(waitUntilFn) {
    const vercelFunctionsPath = require.resolve('@vercel/functions');
    require.cache[vercelFunctionsPath] = {
        id: vercelFunctionsPath,
        filename: vercelFunctionsPath,
        loaded: true,
        exports: { waitUntil: waitUntilFn }
    };
}

function createMockRes() {
    return {
        statusCode: 200,
        headers: {},
        body: null,
        setHeader(key, value) {
            this.headers[key] = value;
        },
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(payload) {
            this.body = payload;
            return this;
        },
        send(payload) {
            this.body = payload;
            return this;
        },
        end() {
            return this;
        }
    };
}

async function testWaitUntilRegistrationFailureRollsBackLock() {
    const redis = createMockRedis();
    const userId = 'aaaaaaa1-1111-4111-8111-aaaaaaaaaaaa';

    mockShared(redis, userId);

    // Keep task pending so registration-failure rollback path can be observed deterministically.
    require.cache[BRIEFING_SERVICE_PATH] = {
        id: BRIEFING_SERVICE_PATH,
        filename: BRIEFING_SERVICE_PATH,
        loaded: true,
        exports: {
            generateBriefing: async () => new Promise(() => {}),
            commitBriefingData: async () => 1,
            isBriefingDisabled: async () => false
        }
    };

    clearModule(API_SETTINGS_SERVICE_PATH);
    mockVercelFunctions(() => {
        throw new Error('waitUntil registration failed');
    });

    clearModule(PREFETCH_ROUTE_PATH);
    const prefetchHandler = require(PREFETCH_ROUTE_PATH);
    const { getKstDateKey } = require(DATE_UTIL_PATH);

    const req = {
        method: 'POST',
        user: { id: userId, email: 'test@example.com' },
        providerToken: null,
        headers: {}
    };
    const res = createMockRes();

    await prefetchHandler(req, res);

    const dateStr = getKstDateKey();
    const lockKey = `user:${userId}:briefing-build-lock:${dateStr}`;
    const startedKey = `user:${userId}:briefing-refresh-status:${dateStr}`;

    assert.strictEqual(res.statusCode, 500, 'Must return 5xx when background registration fails');
    assert.strictEqual(await redis.get(lockKey), null, 'Owner lock must be released immediately');
    assert.strictEqual(await redis.get(startedKey), null, 'Started marker must be released immediately');
}

async function testCommitLuaReturnCodes() {
    const redis = createMockRedis();
    const userId = 'bbbbbbb2-2222-4222-8222-bbbbbbbbbbbb';

    mockShared(redis, userId);
    mockVercelFunctions(() => {});

    clearModule(BRIEFING_SERVICE_PATH);
    const briefingService = require(BRIEFING_SERVICE_PATH);
    const { getKstDateKey } = require(DATE_UTIL_PATH);

    const dateStr = getKstDateKey();
    const lockKey = `user:${userId}:briefing-build-lock:${dateStr}`;
    const revisionKey = `user:${userId}:briefing-revision:${dateStr}`;

    // success path => 1
    await redis.set(lockKey, 'owner-a');
    await redis.set(revisionKey, 'rev-a');
    const ok = await briefingService.commitBriefingData(userId, dateStr, { briefing: 'ok' }, 'owner-a', 'rev-a');
    assert.strictEqual(ok, 1, 'Commit should return 1 on success');

    // owner mismatch => -1
    await redis.set(lockKey, 'owner-b');
    await redis.set(revisionKey, 'rev-b');
    const ownerMismatch = await briefingService.commitBriefingData(userId, dateStr, { briefing: 'x' }, 'wrong-owner', 'rev-b');
    assert.strictEqual(ownerMismatch, -1, 'Commit should return -1 on lock owner mismatch');

    // revision mismatch => -2
    await redis.set(lockKey, 'owner-c');
    await redis.set(revisionKey, 'rev-c-current');
    const revisionMismatch = await briefingService.commitBriefingData(userId, dateStr, { briefing: 'y' }, 'owner-c', 'rev-c-start');
    assert.strictEqual(revisionMismatch, -2, 'Commit should return -2 on revision mismatch');
}

async function testStaleRefreshStatusContract() {
    const redis = createMockRedis();
    const userId = 'ccccccc3-3333-4333-8333-cccccccccccc';
    mockShared(redis, userId);
    mockVercelFunctions(() => {});

    clearModule(BRIEFING_SERVICE_PATH);
    clearModule(BRIEFING_ROUTE_PATH);

    const briefingHandler = require(BRIEFING_ROUTE_PATH);
    const { getKstDateKey } = require(DATE_UTIL_PATH);

    const dateStr = getKstDateKey();
    const cacheKey = `user:${userId}:briefing:${dateStr}`;
    const revisionKey = `user:${userId}:briefing-revision:${dateStr}`;
    const lockKey = `user:${userId}:briefing-build-lock:${dateStr}`;
    const startedKey = `user:${userId}:briefing-refresh-status:${dateStr}`;

    await redis.set(cacheKey, JSON.stringify({ briefing: 'cached briefing', weather: null }));
    await redis.set(revisionKey, 'rev-1');

    const baseReq = {
        method: 'GET',
        headers: { authorization: 'Bearer mock' },
        query: {}
    };

    // started
    await redis.set(lockKey, 'owner-z');
    await redis.set(startedKey, 'started');
    let res = createMockRes();
    await briefingHandler(baseReq, res);
    assert.strictEqual(res.body.refreshStatus, 'started');

    // in_progress
    await redis.del(startedKey);
    res = createMockRes();
    await briefingHandler(baseReq, res);
    assert.strictEqual(res.body.refreshStatus, 'in_progress');

    // not_started
    await redis.del(lockKey);
    res = createMockRes();
    await briefingHandler(baseReq, res);
    assert.strictEqual(res.body.refreshStatus, 'not_started');
}

async function testDisableModeRecoveryFlag() {
    const redis = createMockRedis();
    const userId = 'ddddddd4-4444-4444-8444-dddddddddddd';

    mockShared(redis, userId);
    mockVercelFunctions(() => {});

    clearModule(BRIEFING_SERVICE_PATH);
    const briefingService = require(BRIEFING_SERVICE_PATH);

    await briefingService.invalidateTodayBriefing(userId, { reason: 'consent_off', mode: 'disable' });
    assert.strictEqual(await briefingService.isBriefingDisabled(userId), true, 'Disable mode should set disable flag');

    await briefingService.invalidateTodayBriefing(userId, { reason: 'consent_on', mode: 'purge' });
    assert.strictEqual(await briefingService.isBriefingDisabled(userId), false, 'Purge mode should clear disable flag');
}

async function run() {
    console.log('=== STARTING BRIEFING PREFETCH CONTRACT TESTS ===');

    await testWaitUntilRegistrationFailureRollsBackLock();
    console.log('PASS 1: waitUntil registration failure rollback');

    await testCommitLuaReturnCodes();
    console.log('PASS 2: commit lua return code contract');

    await testStaleRefreshStatusContract();
    console.log('PASS 3: stale refreshStatus contract (started/in_progress/not_started)');

    await testDisableModeRecoveryFlag();
    console.log('PASS 4: disable mode recovery flag contract');

    console.log('=== ALL BRIEFING PREFETCH CONTRACT TESTS PASSED ===');
}

run().catch((err) => {
    console.error('Contract test failed:', err);
    process.exitCode = 1;
});
