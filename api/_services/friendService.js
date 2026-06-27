const { supabase, supabaseAdmin } = require('../_routes/shared');

/**
 * Validates that all friend IDs in the list are valid, confirmed, and active (non-blocked) 1촌 friends of the given user.
 * Supports mock friends (mock-1, mock-2, mock-3) for demo purposes.
 * 
 * @param {string} userId - The current user's ID
 * @param {string[]} friendIds - Array of friend IDs to validate
 * @returns {Promise<{isValid: boolean, validIds: string[], error?: string}>}
 */
async function validateFriends(userId, friendIds) {
    if (!Array.isArray(friendIds)) {
        return { isValid: false, validIds: [], error: '친구 ID 목록은 배열이어야 합니다.' };
    }

    // 1. Remove duplicates
    const uniqueIds = [...new Set(friendIds)];

    // 2. Limit maximum number of sharing targets (e.g. 100)
    if (uniqueIds.length > 100) {
        return { isValid: false, validIds: [], error: '공유 대상자는 최대 100명까지 지정할 수 있습니다.' };
    }

    if (uniqueIds.length === 0) {
        return { isValid: true, validIds: [] };
    }

    // 3. Separate mock and real IDs
    const mockIds = uniqueIds.filter(id => id.startsWith('mock-'));
    const realIds = uniqueIds.filter(id => !id.startsWith('mock-'));

    // Validate mock IDs
    const allowedMockIds = ['mock-1', 'mock-2', 'mock-3'];
    for (const mockId of mockIds) {
        if (!allowedMockIds.includes(mockId)) {
            return { isValid: false, validIds: [], error: `유효하지 않은 데모 친구 ID입니다: ${mockId}` };
        }
    }

    // 4. Validate real IDs against DB
    if (realIds.length > 0) {
        const client = supabaseAdmin || supabase;
        const { data: friendships, error: dbError } = await client
            .from('friendships')
            .select('*')
            .or(`user_id.eq.${userId},friend_id.eq.${userId}`)
            .eq('status', 'confirmed');

        if (dbError) {
            console.error('--- [friendService] Database error checking friendships:', dbError);
            return { isValid: false, validIds: [], error: '친구 관계를 검증하는 중 데이터베이스 오류가 발생했습니다.' };
        }

        // Active friend filter (not blocked by either user)
        const activeFriendIds = (friendships || [])
            .filter(f => {
                const isUserSide = f.user_id === userId;
                const blockedByMe = isUserSide ? f.user_blocked : f.friend_blocked;
                const blockedByFriend = isUserSide ? f.friend_blocked : f.user_blocked;
                return !blockedByMe && !blockedByFriend;
            })
            .map(f => f.user_id === userId ? f.friend_id : f.user_id);

        // Check if all requested real IDs exist in activeFriendIds
        for (const realId of realIds) {
            if (!activeFriendIds.includes(realId)) {
                return { isValid: false, validIds: [], error: `1촌 관계가 아니거나 차단된 사용자입니다: ${realId}` };
            }
        }
    }

    return { isValid: true, validIds: uniqueIds };
}

module.exports = {
    validateFriends
};
