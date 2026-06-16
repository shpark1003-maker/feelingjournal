const { redis, supabase, supabaseAdmin } = require('../_routes/shared');

/**
 * Get user nickname from Redis
 */
async function getUserNickname(userId, defaultEmail) {
    if (!userId) return defaultEmail?.split('@')[0] || '사용자';
    
    try {
        const storedNickname = await redis.get(`user:${userId}:nickname`);
        if (storedNickname) return storedNickname;
    } catch (e) {
        console.error('--- [userRepository] Failed to read nickname from cache:', e.message);
    }
    
    return defaultEmail?.split('@')[0] || '사용자';
}

/**
 * Update user's current emotion in PostgreSQL (profiles table)
 */
async function updateUserEmotion(userId, emotion) {
    if (!userId) return false;
    
    try {
        const client = supabaseAdmin || supabase;
        const { error } = await client
            .from('profiles')
            .upsert({ 
                id: userId, 
                current_emotion: emotion, 
                emotion_updated_at: new Date().toISOString() 
            }, { onConflict: 'id' });

        if (error) throw error;
        return true;
    } catch (e) {
        console.error('--- [userRepository] Failed to update user emotion in DB:', e.message);
        return false;
    }
}

module.exports = {
    getUserNickname,
    updateUserEmotion
};
