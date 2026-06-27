const assert = require('assert');
const shared = require('../api/_routes/shared');

// Mock friendships database calls
const mockFriendships = [
    { user_id: '91fdf57d-a069-4eab-820b-68180886d487', friend_id: 'real-friend-1', status: 'confirmed', user_blocked: false, friend_blocked: false },
    { user_id: 'real-friend-2', friend_id: '91fdf57d-a069-4eab-820b-68180886d487', status: 'confirmed', user_blocked: false, friend_blocked: false },
    { user_id: '91fdf57d-a069-4eab-820b-68180886d487', friend_id: 'blocked-friend', status: 'confirmed', user_blocked: true, friend_blocked: false }
];

const originalSupabase = shared.supabaseAdmin || shared.supabase;
const mockDbClient = {
    from: (table) => {
        if (table === 'friendships') {
            return {
                select: () => ({
                    or: () => ({
                        eq: () => Promise.resolve({ data: mockFriendships, error: null })
                    })
                })
            };
        }
        return originalSupabase.from(table);
    }
};

shared.supabase = mockDbClient;
shared.supabaseAdmin = mockDbClient;

const { validateFriends } = require('../api/_services/friendService');

// Mock request/response helpers
function mockRequest(method, body = {}, query = {}, headers = {}) {
    return {
        method,
        body,
        query,
        headers: {
            authorization: 'Bearer mock-session-token',
            ...headers
        },
        url: method === 'PATCH' ? '/api/history' : '/api/analyze'
    };
}

function mockResponse() {
    const res = {
        statusCode: 200,
        headers: {},
        body: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(data) {
            this.body = data;
            return this;
        },
        end() {
            return this;
        }
    };
    return res;
}

async function runTests() {
    console.log('=== STARTING SHARE PERMISSION AND VALIDATION TESTS ===');

    const testUserId = '91fdf57d-a069-4eab-820b-68180886d487'; // Match mock-session-token userId

    try {
        // --- 1. Test validateFriends with Mock Friends ---
        console.log('[TEST 1] Testing validateFriends with valid demo mock friends...');
        const resMock1 = await validateFriends(testUserId, ['mock-1', 'mock-2']);
        assert.strictEqual(resMock1.isValid, true);
        assert.deepStrictEqual(resMock1.validIds, ['mock-1', 'mock-2']);
        console.log('=> Valid mock friends check PASSED!');

        console.log('[TEST 2] Testing validateFriends with invalid demo mock friend...');
        const resMock2 = await validateFriends(testUserId, ['mock-invalid']);
        assert.strictEqual(resMock2.isValid, false);
        assert.ok(resMock2.error.includes('유효하지 않은 데모 친구 ID'));
        console.log('=> Invalid mock friend check PASSED!');

        console.log('[TEST 3] Testing validateFriends with duplicate entries...');
        const resMock3 = await validateFriends(testUserId, ['mock-1', 'mock-1', 'mock-2']);
        assert.strictEqual(resMock3.isValid, true);
        assert.deepStrictEqual(resMock3.validIds, ['mock-1', 'mock-2']);
        console.log('=> Duplicate entry cleanup check PASSED!');

        console.log('[TEST 4] Testing validateFriends with array limit constraint...');
        const longList = Array.from({ length: 101 }, (_, i) => `mock-${i}`);
        const resMock4 = await validateFriends(testUserId, longList);
        assert.strictEqual(resMock4.isValid, false);
        assert.ok(resMock4.error.includes('최대 100명'));
        console.log('=> Maximum limit validation check PASSED!');

        // --- 2. Test validateFriends with Real Friends (Mocking Supabase) ---
        console.log('[TEST 5] Testing validateFriends with active real friends (Mock Database)...');

        const resReal1 = await validateFriends(testUserId, ['real-friend-1', 'real-friend-2']);
        assert.strictEqual(resReal1.isValid, true);

        const resReal2 = await validateFriends(testUserId, ['blocked-friend']);
        assert.strictEqual(resReal2.isValid, false);
        assert.ok(resReal2.error.includes('1촌 관계가 아니거나 차단된 사용자'));

        const resReal3 = await validateFriends(testUserId, ['non-existent-friend']);
        assert.strictEqual(resReal3.isValid, false);
        assert.ok(resReal3.error.includes('1촌 관계가 아니거나 차단된 사용자'));

        console.log('=> Real database friendship mock check PASSED!');

        console.log('=== ALL SHARE PERMISSION AND VALIDATION TESTS PASSED! ===');
    } catch (err) {
        console.error('❌ Share permission tests failed:', err);
        process.exit(1);
    }
}

runTests();
