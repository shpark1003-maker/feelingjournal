const express = require('express');
const cors = require('cors');
const path = require('path');
const multer = require('multer');

// 1. 공통 의존성 및 설정 싱글톤 로드
const {
    PORT,
    pushEnabled,
    emailConfigured,
    transporter,
    supabase,
    supabaseAdmin,
    redis,
    getBrowserInstance,
    isSafeUrl,
    sendError,
    fetchWithTimeout,
    getGeminiUrl,
    callGemini,
    sanitizeContent,
    safeParseJsonArray,
    extractEventJson,
    scanRedisKeys,
    verifyUser
} = require('./api/shared');

const app = express();
const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB 제한
});

// 2. 글로벌 미들웨어 등록
app.use(cors({
    origin: process.env.CORS_ORIGIN
        ? process.env.CORS_ORIGIN.split(',')
        : true,
    credentials: true
}));

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/favicon.ico', (req, res) => {
    res.status(204).end();
});

// 3. 모듈형 Express API 라우터 연동
const authRouter = require('./api/auth');
const scrapRouter = require('./api/scrap');
const { router: pushRouter, startPushDispatcher } = require('./api/push');

app.use('/api/auth', authRouter);
app.use('/api', scrapRouter);
app.use('/api', pushRouter);

// 4. 단일 Serverless 핸들러 모듈 바인딩 (Vercel 로컬 매핑 호환)
const calendarRoute = require('./api/calendar');
const analyzeRoute = require('./api/analyze');
const historyRoute = require('./api/history');
const briefingRoute = require('./api/briefing');
const contactsRoute = require('./api/contacts');
const chatRoute = require('./api/chat');
const personaRoute = require('./api/persona');
const notebooksRoute = require('./api/notebooks');
const nicknameRoute = require('./api/nickname');

app.get('/api/calendar', verifyUser, calendarRoute);
app.post('/api/calendar', verifyUser, calendarRoute);
app.delete('/api/calendar', verifyUser, calendarRoute);
app.post('/api/analyze', verifyUser, analyzeRoute);
app.get('/api/history', verifyUser, historyRoute);
app.get('/api/briefing', verifyUser, briefingRoute);
app.get('/api/contacts', verifyUser, contactsRoute);

/* ==========================================================================
   [REMAINING LIGHTWEIGHT ROUTES & CONTROLLERS]
   ========================================================================== */

// 1. 실시간 감성 채팅 메시지 조회 및 전송 & 백엔드 채팅방 생성 제어
app.get('/api/chat/messages', verifyUser, chatRoute);
app.post('/api/chat/messages', verifyUser, chatRoute);
app.post('/api/chat/room', verifyUser, chatRoute);

// 2. 역사(히스토리) 기록 삭제 및 수정
app.delete('/api/history/:id', verifyUser, historyRoute);
app.patch('/api/history/:id', verifyUser, historyRoute);

// 4. 구글 캘린더 일정 수정/삭제 및 추가
app.patch('/api/calendar/events/:id', verifyUser, async (req, res) => {
    try {
        const providerToken = req.headers['x-provider-token'];
        const { id } = req.params;
        const { start, end } = req.body;

        if (!providerToken) return sendError(res, 400, 'Provider Token이 필요합니다.');

        const updateRes = await fetchWithTimeout(
            `https://www.googleapis.com/calendar/v3/calendars/primary/events/${id}`,
            {
                method: 'PATCH',
                headers: {
                    Authorization: `Bearer ${providerToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    start: { dateTime: start },
                    end: { dateTime: end }
                })
            },
            10000
        );

        if (!updateRes.ok) throw new Error('구글 캘린더 업데이트 실패');
        
        const cacheKey = `user:${req.user.id}:calendar-advice-cache`;
        await redis.del(cacheKey);

        res.json({ success: true });
    } catch (error) {
        console.error('Calendar Update Error:', error.message);
        sendError(res, 500, error.message);
    }
});

app.delete('/api/calendar/events/:id', verifyUser, async (req, res) => {
    try {
        const providerToken = req.headers['x-provider-token'];
        const { id } = req.params;

        if (!providerToken) return sendError(res, 400, 'Provider Token이 필요합니다.');

        const deleteRes = await fetchWithTimeout(
            `https://www.googleapis.com/calendar/v3/calendars/primary/events/${id}`,
            {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${providerToken}` }
            },
            10000
        );

        if (!deleteRes.ok && deleteRes.status !== 204) throw new Error('구글 캘린더 일정 삭제 실패');

        const cacheKey = `user:${req.user.id}:calendar-advice-cache`;
        await redis.del(cacheKey);

        res.json({ success: true });
    } catch (error) {
        console.error('Calendar Delete Error:', error.message);
        sendError(res, 500, error.message);
    }
});

app.post('/api/calendar/add', verifyUser, async (req, res) => {
    try {
        const providerToken = req.headers['x-provider-token'];
        const { summary, start, end } = req.body;

        if (!providerToken) return sendError(res, 400, 'Google Provider Token이 필요합니다.');
        if (!summary || !start || !end) return sendError(res, 400, 'summary, start, end 값이 필요합니다.');

        const startDate = new Date(start);
        const endDate = new Date(end);
        if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
            return sendError(res, 400, 'start 또는 end 시간이 올바르지 않습니다.');
        }
        if (endDate <= startDate) {
            return sendError(res, 400, 'end는 start보다 이후 시간이어야 합니다.');
        }

        const calendarResponse = await fetchWithTimeout(
            'https://www.googleapis.com/calendar/v3/calendars/primary/events',
            {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${providerToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    summary,
                    start: { dateTime: start, timeZone: 'Asia/Seoul' },
                    end: { dateTime: end, timeZone: 'Asia/Seoul' }
                })
            },
            10000
        );

        const data = await calendarResponse.json();
        if (!calendarResponse.ok || data.error) {
            throw new Error('Google Calendar API Error: ' + (data?.error?.message || calendarResponse.statusText));
        }

        return res.json({ success: true, eventId: data.id });
    } catch (error) {
        console.error('Calendar Add Error:', error);
        return sendError(res, 500, '일정 등록 중 오류가 발생했습니다.');
    }
});

// 5. 노트북(전자 필기장) 목록 보관 및 조회
app.get('/api/notebooks', verifyUser, notebooksRoute);
app.post('/api/notebooks', verifyUser, notebooksRoute);

// 6. 사용자 호칭(닉네임) 관리
app.get('/api/nickname', verifyUser, nicknameRoute);
app.post('/api/nickname', verifyUser, nicknameRoute);

// 7. 비서 페르소나 및 아바타 제어
app.get('/api/persona', verifyUser, personaRoute);
app.post('/api/persona', verifyUser, personaRoute);
app.post('/api/persona/avatar', verifyUser, personaRoute);
app.post('/api/persona/generate-avatar', verifyUser, personaRoute);
app.post('/api/persona/learn-video', verifyUser, personaRoute);

// 8. AI 비서 감성 대화 (페르소나 연동형 및 Supabase 영구 저장)
app.post('/api/chat/ai-response', verifyUser, chatRoute);

// 9. 실시간 온라인 존재(Presence) 상태 하트비트
app.post('/api/presence/heartbeat', verifyUser, async (req, res) => {
    try {
        const userId = req.user.id;
        const key = `user:${userId}:presence`;
        await redis.set(key, 'online', 'EX', 30);
        return res.json({ success: true });
    } catch (error) {
        console.error('Presence Heartbeat Error:', error);
        return res.status(500).json({ success: false, error: '접속 상태 갱신 실패' });
    }
});

// 10. 1촌 설정 변경 API
app.post('/api/friends/settings', verifyUser, async (req, res) => {
    try {
        const { friendId, field, value } = req.body;
        const userId = req.user.id;

        if (friendId.startsWith('mock-')) {
            const key = `user:${userId}:mock-settings:${friendId}`;
            const existing = await redis.get(key);
            const settings = existing ? JSON.parse(existing) : { stealth_mode: false, share_emotion: true, is_blocked: false };
            settings[field] = value;
            await redis.set(key, JSON.stringify(settings));

            if (field === 'is_blocked' && value) {
                await redis.sadd(`user:${userId}:deleted-mocks`, friendId);
            }
            return res.json({ success: true });
        }

        const client = supabaseAdmin || supabase;

        // 1촌 관계 가져오기
        const { data: friendship, error } = await client
            .from('friendships')
            .select('*')
            .or(`and(user_id.eq.${userId},friend_id.eq.${friendId}),and(user_id.eq.${friendId},friend_id.eq.${userId})`)
            .maybeSingle();

        if (error || !friendship) {
            return sendError(res, 404, '1촌 관계를 찾을 수 없습니다.');
        }

        const isUserSide = friendship.user_id === userId;
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
    } catch (err) {
        console.error('Friend Settings Error:', err);
        return sendError(res, 500, '설정 변경 실패');
    }
});

// 11. 1촌 삭제 API
app.post('/api/friends/delete', verifyUser, async (req, res) => {
    try {
        const { friendId } = req.body;
        const userId = req.user.id;

        if (friendId.startsWith('mock-')) {
            await redis.sadd(`user:${userId}:deleted-mocks`, friendId);
            return res.json({ success: true });
        }

        const client = supabaseAdmin || supabase;

        const { error } = await client
            .from('friendships')
            .delete()
            .or(`and(user_id.eq.${userId},friend_id.eq.${friendId}),and(user_id.eq.${friendId},friend_id.eq.${userId})`);

        if (error) throw error;

        return res.json({ success: true });
    } catch (err) {
        console.error('Delete Friend Error:', err);
        return sendError(res, 500, '1촌 해제 실패');
    }
});

// 12. 1촌 감성 위기(SOS) 공유 및 상태 확인
app.get('/api/friends/sos', verifyUser, async (req, res) => {
    try {
        const user = req.user;
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
        const deletedMocks = await redis.smembers(`user:${user.id}:deleted-mocks`) || [];
        const now = new Date();

        let allFriends = [];

        if (friendIds.length > 0) {
            const { data: profiles, error: profileError } = await client
                .from('profiles')
                .select('id, nickname, current_emotion, emotion_updated_at')
                .in('id', friendIds);

            if (profileError) throw profileError;

            allFriends = await Promise.all((profiles || []).map(async (p) => {
                const rel = activeFriends.find(f => f.user_id === p.id || f.friend_id === p.id);
                const isFriendSide = rel.friend_id === p.id;
                
                // 상대방의 스텔스 설정 체크
                const isStealth = isFriendSide ? rel.friend_stealth : rel.user_stealth;
                const isOnline = isStealth ? false : !!(await redis.get(`user:${p.id}:presence`));

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
            }));
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

            for (const mock of demoFriends) {
                if (deletedMocks.includes(mock.id)) continue;

                const mockSettingsRaw = await redis.get(`user:${user.id}:mock-settings:${mock.id}`);
                const mockSettings = mockSettingsRaw ? JSON.parse(mockSettingsRaw) : { stealth_mode: false, share_emotion: true, is_blocked: false };

                if (mockSettings.is_blocked) continue;

                const isOnline = mockSettings.stealth_mode ? false : mock.is_online;
                const emotion = mockSettings.share_emotion ? mock.current_emotion : '비공개 감정';

                allFriends.push({
                    ...mock,
                    is_online: isOnline,
                    current_emotion: emotion,
                    my_stealth: !!mockSettings.stealth_mode,
                    my_share: !!mockSettings.share_emotion
                });
            }
        }

        const sosEmotions = ['우울', '슬픔', '절망', '무기력', '화남', '힘듦', '고통'];
        const sosList = allFriends.filter(p => {
            const isSos = sosEmotions.some(e => p.current_emotion?.includes(e));
            const isRecent = p.emotion_updated_at && (now - new Date(p.emotion_updated_at)) < 24 * 3600 * 1000;
            return isSos && isRecent;
        });

        return res.json({ success: true, sosList, allFriends });
    } catch (error) {
        console.error('SOS Check Error:', error);
        return res.status(500).json({ error: 'SOS 체크 실패' });
    }
});

// 11. 친구 초대 이메일 발송
app.post('/api/invite', verifyUser, async (req, res) => {
    if (!emailConfigured || !transporter) {
        return res.status(503).json({ error: '이메일 서버가 설정되지 않았습니다.' });
    }

    const { email } = req.body;
    if (!email) return res.status(400).json({ error: '수신자 이메일이 필요합니다.' });

    const inviterName = req.user.user_metadata?.full_name || req.user.email.split('@')[0];

    const mailOptions = {
        from: `"Feeling Journal" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: `✨ ${inviterName}님이 당신을 Feeling Journal 채팅방에 초대했습니다!`,
        html: `
            <div style="font-family: 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif; max-width: 500px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 15px; background: #fff; box-shadow: 0 4px 15px rgba(0,0,0,0.05);">
                <div style="text-align: center; margin-bottom: 20px;">
                    <span style="font-size: 40px;">💌</span>
                </div>
                <h2 style="color: #667eea; text-align: center; margin-top: 0;">감성 채팅 초대장</h2>
                <p style="font-size: 1.1rem; line-height: 1.6; color: #333; text-align: center;">
                    안녕하세요! <b>${inviterName}</b>님이 당신을<br>
                    <b>Feeling Journal</b> 실시간 감성 채팅방에 초대했습니다.
                </p>
                <div style="background: #f8f9fa; padding: 20px; border-radius: 12px; margin: 25px 0; text-align: center;">
                    <p style="margin: 0; color: #666; font-size: 0.95rem;">
                        "함께 하루를 기록하고 서로의 감성을 나누어 보아요."
                    </p>
                </div>
                <div style="text-align: center; margin: 30px 0;">
                    <a href="${process.env.APP_URL || 'http://localhost:3000'}" 
                       style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 15px 35px; text-decoration: none; border-radius: 30px; font-weight: bold; display: inline-block; box-shadow: 0 4px 15px rgba(102,126,234,0.3);">
                       지금 채팅방 입장하기
                    </a>
                </div>
                <p style="font-size: 0.85rem; color: #999; text-align: center; margin-top: 40px; border-top: 1px solid #eee; padding-top: 20px;">
                    본 메일은 사용자의 요청에 의해 발송된 자동 초대장입니다.
                </p>
            </div>
        `
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log(`--- [EMAIL] Invitation sent to: ${email} ---`);
        res.json({ success: true, message: '초대 이메일을 성공적으로 보냈습니다.' });
    } catch (error) {
        console.error('Email Send Error:', error);
        res.status(500).json({ error: '이메일 발송 중 오류가 발생했습니다.' });
    }
});

// 백그라운드 스케줄러(구글 캘린더 자동 푸시 등) 시작
startPushDispatcher();

app.listen(PORT, () => {
    console.log(`Server is running at http://localhost:${PORT}`);
});