const { supabase, supabaseAdmin, redis, sendError, scanRedisKeys } = require('./shared');

module.exports = async (req, res) => {
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return sendError(res, 401, '인증 정보가 필요합니다.');
        }

        const token = authHeader.split(' ')[1];
        const { data: { user }, error: authError } = await supabase.auth.getUser(token);
        if (authError || !user) {
            return sendError(res, 401, '유효하지 않은 토큰입니다.');
        }

        req.user = user;
        const url = req.url;
        const path = url.split('?')[0];

        // 1. GET /api/friends/sos - 1촌 감성 위기 및 상태 전체 조회
        if (req.method === 'GET' && path.includes('/sos')) {
            const client = supabaseAdmin || supabase;

            const { data: friends, error: friendsError } = await client
                .from('friendships')
                .select('*')
                .or(`user_id.eq.${user.id},friend_id.eq.${user.id}`)
                .eq('status', 'confirmed');

            if (friendsError) throw friendsError;

            // 차단 관계 필터링 (내가 상대방을 차단했거나 상대방이 나를 차단했으면 제외)
            const activeFriends = (friends || []).filter(f => {
                const isUserSide = f.user_id === user.id;
                const blockedByMe = isUserSide ? f.user_blocked : f.friend_blocked;
                const blockedByFriend = isUserSide ? f.friend_blocked : f.user_blocked;
                return !blockedByMe && !blockedByFriend;
            });

            const friendIds = activeFriends.map(f => f.user_id === user.id ? f.friend_id : f.user_id);
            const now = new Date();

            let deletedMocks = [];
            let isRedisPartial = false;
            let redisSource = "redis_active";

            try {
                const mocksResult = await redis.smembers(`user:${user.id}:deleted-mocks`);
                deletedMocks = mocksResult || [];
            } catch (err) {
                console.warn('[Redis Warning] Failed to get deleted-mocks:', err.message);
                isRedisPartial = true;
                redisSource = "redis_fallback";
                deletedMocks = [];
            }

            let allFriends = [];

            if (friendIds.length > 0) {
                const { data: profiles, error: profileError } = await client
                    .from('profiles')
                    .select('id, nickname, current_emotion, emotion_updated_at')
                    .in('id', friendIds);

                if (profileError) throw profileError;

                let presenceMap = {};
                const presenceKeys = friendIds.map(id => `user:${id}:presence`);
                try {
                    const presenceValues = await redis.mget(presenceKeys);
                    presenceKeys.forEach((key, index) => {
                        const friendId = friendIds[index];
                        presenceMap[friendId] = !!presenceValues[index];
                    });
                } catch (err) {
                    console.warn('[Redis Warning] Failed to mget presence values:', err.message);
                    isRedisPartial = true;
                    redisSource = "redis_fallback";
                    friendIds.forEach(id => {
                        presenceMap[id] = false; // Default offline fallback
                    });
                }

                allFriends = (profiles || []).map((p) => {
                    const rel = activeFriends.find(f => f.user_id === p.id || f.friend_id === p.id);
                    const isFriendSide = rel.friend_id === p.id;
                    
                    // 상대방의 스텔스 설정 체크
                    const isStealth = isFriendSide ? rel.friend_stealth : rel.user_stealth;
                    const isOnline = isStealth ? false : !!presenceMap[p.id];

                    // 상대방의 감정 공유 설정 체크
                    const canShare = isFriendSide ? rel.friend_share_emotion : rel.user_share_emotion;
                    const emotion = canShare ? (p.current_emotion || '평온') : '비공개 감정';

                    // 내가 그들에 대해 설정한 내 로컬 상태 (stealth_mode, share_emotion)
                    const myStealth = isFriendSide ? rel.user_stealth : rel.friend_stealth;
                    const myShare = isFriendSide ? rel.user_share_emotion : rel.friend_share_emotion;

                    return { 
                        id: p.id,
                        nickname: p.nickname,
                        current_emotion: emotion,
                        emotion_updated_at: p.emotion_updated_at,
                        is_online: isOnline,
                        my_stealth: !!myStealth,
                        my_share: !!myShare
                    };
                });
            }

            // 데모 데이터 결합 (3명 미만일 때)
            if (allFriends.length < 3) {
                const demoFriends = [
                    { 
                        id: 'mock-1', 
                        nickname: '다정한 영희 (데모)', 
                        current_emotion: '조금 슬픔... 위로가 필요해 😔', 
                        emotion_updated_at: new Date(now.getTime() - 1000 * 60 * 30).toISOString(),
                        is_online: true
                    },
                    { 
                        id: 'mock-2', 
                        nickname: '든든한 철수 (데모)', 
                        current_emotion: '오늘 하루도 힘내세요! 😊', 
                        emotion_updated_at: new Date(now.getTime() - 1000 * 60 * 60).toISOString(),
                        is_online: false
                    },
                    { 
                        id: 'mock-3', 
                        nickname: '행복한 민수 (데모)', 
                        current_emotion: '보람찬 하루를 보냈네요! 🥰', 
                        emotion_updated_at: new Date(now.getTime() - 1000 * 60 * 120).toISOString(),
                        is_online: true
                    }
                ];

                const mockKeys = demoFriends.map(mock => `user:${user.id}:mock-settings:${mock.id}`);
                let mockSettingsValues = [];
                try {
                    mockSettingsValues = await redis.mget(mockKeys);
                } catch (err) {
                    console.warn('[Redis Warning] Failed to mget mock settings:', err.message);
                    isRedisPartial = true;
                    redisSource = "redis_fallback";
                    mockSettingsValues = Array(demoFriends.length).fill(null);
                }

                demoFriends.forEach((mock, index) => {
                    if (deletedMocks.includes(mock.id)) return;

                    const rawVal = mockSettingsValues[index];
                    let mockSettings = { stealth_mode: false, share_emotion: true, is_blocked: false };
                    if (rawVal) {
                        try {
                            mockSettings = JSON.parse(rawVal);
                        } catch (parseErr) {
                            console.warn('[Redis JSON Parse Error] Using default settings for mock friend:', mock.id);
                        }
                    }

                    if (mockSettings.is_blocked) return;

                    const isOnline = mockSettings.stealth_mode ? false : mock.is_online;
                    const emotion = mockSettings.share_emotion ? mock.current_emotion : '비공개 감정';

                    allFriends.push({
                        ...mock,
                        is_online: isOnline,
                        current_emotion: emotion,
                        my_stealth: !!mockSettings.stealth_mode,
                        my_share: !!mockSettings.share_emotion
                    });
                });
            }

            const sosEmotions = ['우울', '슬픔', '절망', '무기력', '화남', '힘듦', '고통'];
            const sosList = allFriends.filter(p => {
                const isSos = p.current_emotion && sosEmotions.some(e => p.current_emotion.includes(e));
                const isRecent = p.emotion_updated_at && (now - new Date(p.emotion_updated_at)) < 24 * 3600 * 1000;
                return isSos && isRecent;
            });

            const responsePayload = {
                success: true,
                sosList,
                allFriends
            };

            if (isRedisPartial) {
                responsePayload.partial = true;
                responsePayload.source = redisSource;
            }

            return res.json(responsePayload);
        }

        // 2. POST /api/friends/settings - 1촌 설정 변경
        if (req.method === 'POST' && path.includes('/settings')) {
            const { friendId, field, value } = req.body;

            if (!friendId || !field) {
                return sendError(res, 400, 'friendId와 field 값이 필요합니다.');
            }

            if (friendId.startsWith('mock-')) {
                const key = `user:${user.id}:mock-settings:${friendId}`;
                const existing = await redis.get(key);
                const settings = existing ? JSON.parse(existing) : { stealth_mode: false, share_emotion: true, is_blocked: false };
                settings[field] = value;
                await redis.set(key, JSON.stringify(settings));

                if (field === 'is_blocked' && value) {
                    await redis.sadd(`user:${user.id}:deleted-mocks`, friendId);
                }
                return res.json({ success: true });
            }

            const client = supabaseAdmin || supabase;

            // 1촌 관계 가져오기
            const { data: friendship, error } = await client
                .from('friendships')
                .select('*')
                .or(`and(user_id.eq.${user.id},friend_id.eq.${friendId}),and(user_id.eq.${friendId},friend_id.eq.${user.id})`)
                .maybeSingle();

            if (error || !friendship) {
                return sendError(res, 404, '1촌 관계를 찾을 수 없습니다.');
            }

            const isUserSide = friendship.user_id === user.id;
            const updateData = {};

            if (field === 'stealth_mode') {
                updateData[isUserSide ? 'user_stealth' : 'friend_stealth'] = value;
            } else if (field === 'share_emotion') {
                updateData[isUserSide ? 'user_share_emotion' : 'friend_share_emotion'] = value;
            } else if (field === 'is_blocked') {
                updateData[isUserSide ? 'user_blocked' : 'friend_blocked'] = value;
            } else {
                return sendError(res, 400, '잘못된 필드 지정입니다.');
            }

            const { error: updateError } = await client
                .from('friendships')
                .update(updateData)
                .eq('id', friendship.id);

            if (updateError) throw updateError;

            return res.json({ success: true });
        }

        // 3. POST /api/friends/delete - 1촌 끊기
        if (req.method === 'POST' && path.includes('/delete')) {
            const { friendId } = req.body;

            if (!friendId) {
                return sendError(res, 400, 'friendId 값이 필요합니다.');
            }

            if (friendId.startsWith('mock-')) {
                await redis.sadd(`user:${user.id}:deleted-mocks`, friendId);
                return res.json({ success: true });
            }

            const client = supabaseAdmin || supabase;

            const { error } = await client
                .from('friendships')
                .delete()
                .or(`and(user_id.eq.${user.id},friend_id.eq.${friendId}),and(user_id.eq.${friendId},friend_id.eq.${user.id})`);

            if (error) throw error;

            return res.json({ success: true });
        }

        // 4. POST /api/friends/accept-invite - 초대 링크 수락
        if (req.method === 'POST' && path.includes('/accept-invite')) {
            const { inviterId } = req.body;
            if (!inviterId) {
                return sendError(res, 400, 'inviterId가 필요합니다.');
            }
            if (inviterId === user.id) {
                return res.json({ success: true, message: '본인의 초대 링크입니다.' });
            }

            const client = supabaseAdmin || supabase;

            // 이미 관계가 있는지 확인
            const { data: existing, error: checkError } = await client
                .from('friendships')
                .select('*')
                .or(`and(user_id.eq.${user.id},friend_id.eq.${inviterId}),and(user_id.eq.${inviterId},friend_id.eq.${user.id})`)
                .maybeSingle();

            if (checkError) throw checkError;

            if (existing) {
                if (existing.status !== 'confirmed') {
                    const { error: updateError } = await client
                        .from('friendships')
                        .update({ status: 'confirmed' })
                        .eq('id', existing.id);
                    if (updateError) throw updateError;
                }
                return res.json({ success: true, message: '이미 1촌 관계로 등록되어 있습니다.' });
            }

            // 신규 1촌 관계 생성
            const { error: insertError } = await client
                .from('friendships')
                .insert([{
                    user_id: inviterId,
                    friend_id: user.id,
                    status: 'confirmed',
                    user_share_emotion: true,
                    friend_share_emotion: true
                }]);

            if (insertError) throw insertError;

            return res.json({ success: true, message: '1촌 관계가 즉시 성립되었습니다!' });
        }

        return res.status(404).json({ error: 'Endpoint Not Found' });
    } catch (error) {
        console.error('Friends API Error:', error);
        return res.status(500).json({ error: error.message });
    }
};
