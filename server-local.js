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

// 1. 실시간 감성 채팅 메시지 조회 및 전송
app.get('/api/chat/messages', verifyUser, async (req, res) => {
    try {
        const { roomId } = req.query;
        const rid = (roomId === 'lobby' || !roomId) ? '6edf28f2-c7f6-45e9-9648-07b118f0cf9e' : roomId;
        
        const client = supabaseAdmin || supabase;
        const { data: messages, error } = await client
            .from('messages')
            .select('*')
            .eq('room_id', rid)
            .order('created_at', { ascending: true })
            .limit(100);
        
        if (error) throw error;
        
        const processed = (messages || []).map(m => ({
            ...m,
            isMe: m.sender_id === req.user.id
        }));
        
        return res.json({ success: true, messages: processed });
    } catch (error) {
        console.error('Chat Load Error:', error);
        return sendError(res, 500, '메시지 로드 실패');
    }
});

app.post('/api/chat/messages', verifyUser, async (req, res) => {
    try {
        const { roomId, content } = req.body;
        
        const client = supabaseAdmin || supabase;
        const { data, error } = await client
            .from('messages')
            .insert([{
                content,
                sender_id: req.user.id,
                user_email: req.user.email,
                room_id: (roomId === 'lobby' || !roomId) ? '6edf28f2-c7f6-45e9-9648-07b118f0cf9e' : roomId
            }])
            .select();
        
        if (error) throw error;
        return res.json({ success: true, message: data[0] });
    } catch (error) {
        console.error('Chat Save Error:', error);
        return sendError(res, 500, '메시지 전송 실패');
    }
});

// 2. 백엔드 채팅방 생성 제어 (RLS 403 Forbidden 우회용)
app.post('/api/chat/room', verifyUser, async (req, res) => {
    try {
        const { name, type } = req.body;
        if (!supabaseAdmin) {
            return sendError(res, 500, 'Admin Supabase Client가 설정되지 않았습니다.');
        }

        const { data: existingRoom, error: selectError } = await supabaseAdmin
            .from('rooms')
            .select('*')
            .eq('name', name)
            .maybeSingle();

        if (selectError) throw selectError;
        if (existingRoom) {
            return res.json({ success: true, room: existingRoom });
        }

        const { data: newRoom, error: insertError } = await supabaseAdmin
            .from('rooms')
            .insert([{ name, type }])
            .select()
            .single();

        if (insertError) throw insertError;
        return res.json({ success: true, room: newRoom });
    } catch (error) {
        console.error('Chat Room POST Error:', error);
        return sendError(res, 500, '채팅방 생성 또는 조회 실패');
    }
});

// 3. 역사(히스토리) 기록 삭제 및 수정
app.delete('/api/history/:id', verifyUser, async (req, res) => {
    try {
        const user = req.user;
        const key = decodeURIComponent(req.params.id);

        if (!key || !key.startsWith(`user:${user.id}:diary-`)) {
            return sendError(res, 403, '삭제 권한이 없습니다.');
        }

        const deletedCount = await redis.del(key);
        if (deletedCount === 0) {
            return sendError(res, 404, '삭제할 메모를 찾을 수 없습니다.');
        }
        return res.json({ success: true });
    } catch (error) {
        console.error('History Delete Error:', error);
        return sendError(res, 500, '메모 삭제 실패');
    }
});

app.patch('/api/history/:id', verifyUser, async (req, res) => {
    try {
        const user = req.user;
        const { id } = req.params;
        const { title, content } = req.body;
        
        if (!id || !id.startsWith(`user:${user.id}:diary-`)) {
            return sendError(res, 403, '수정 권한이 없습니다.');
        }

        const existingData = await redis.get(id);
        if (!existingData) return sendError(res, 404, '메모를 찾을 수 없습니다.');
        
        const item = JSON.parse(existingData);
        if (title !== undefined) item.title = title;
        if (content !== undefined) item.content = content;
        if (req.body.richContent !== undefined) item.richContent = req.body.richContent;
        
        await redis.set(id, JSON.stringify(item), 'KEEPTTL');
        return res.json({ success: true, title: item.title });
    } catch (error) {
        console.error('Memo Update Error:', error);
        return sendError(res, 500, '메모 수정 실패');
    }
});

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
app.get('/api/notebooks', verifyUser, async (req, res) => {
    try {
        const user = req.user;
        const key = `user:${user.id}:notebooks`;
        const data = await redis.get(key);
        
        const defaultNotebooks = [];
        return res.json({
            success: true,
            notebooks: data ? JSON.parse(data) : defaultNotebooks
        });
    } catch (error) {
        console.error('Notebook Get Error:', error);
        return sendError(res, 500, '노트북 목록 로딩 실패');
    }
});

app.post('/api/notebooks', verifyUser, async (req, res) => {
    try {
        const user = req.user;
        const { notebooks } = req.body;
        const key = `user:${user.id}:notebooks`;
        
        await redis.set(key, JSON.stringify(notebooks), 'EX', 3600 * 24 * 365); // 1년 보관
        return res.json({ success: true });
    } catch (error) {
        console.error('Notebook Save Error:', error);
        return sendError(res, 500, '노트북 저장 실패');
    }
});

// 6. 사용자 호칭(닉네임) 관리
app.get('/api/nickname', verifyUser, async (req, res) => {
    try {
        const key = `user:${req.user.id}:nickname`;
        const nickname = await redis.get(key);
        return res.json({ success: true, nickname: nickname || null });
    } catch (error) {
        console.error('Nickname Get Error:', error);
        return sendError(res, 500, '호칭 조회 실패');
    }
});

app.post('/api/nickname', verifyUser, async (req, res) => {
    try {
        const { nickname } = req.body;
        if (!nickname || nickname.trim().length < 1) {
            return sendError(res, 400, '호칭은 1자 이상 입력해 주세요.');
        }
        const cleaned = nickname.trim().slice(0, 20);
        const key = `user:${req.user.id}:nickname`;
        await redis.set(key, cleaned);
        console.log(`[Nickname] User ${req.user.email} → "${cleaned}"`);
        return res.json({ success: true, nickname: cleaned });
    } catch (error) {
        console.error('Nickname Save Error:', error);
        return sendError(res, 500, '호칭 저장 실패');
    }
});

// 7. 비서 페르소나 및 아바타 제어
app.get('/api/persona', verifyUser, async (req, res) => {
    try {
        const persona = await redis.get(`user:${req.user.id}:persona`);
        return res.json({ success: true, persona: persona ? JSON.parse(persona) : null });
    } catch (error) {
        console.error('Get Persona Error:', error);
        return res.status(500).json({ error: '페르소나 조회 실패' });
    }
});

app.post('/api/persona', verifyUser, async (req, res) => {
    try {
        const { persona } = req.body;
        const oldRaw = await redis.get(`user:${req.user.id}:persona`);
        const old = oldRaw ? JSON.parse(oldRaw) : {};
        const merged = { ...old, ...persona };
        await redis.set(`user:${req.user.id}:persona`, JSON.stringify(merged));
        return res.json({ success: true });
    } catch (error) {
        console.error('Save Persona Error:', error);
        return res.status(500).json({ error: '페르소나 저장 실패' });
    }
});

app.post('/api/persona/avatar', verifyUser, upload.single('avatar'), async (req, res) => {
    try {
        if (!req.file) return sendError(res, 400, '파일이 없습니다.');
        
        const fs = require('fs');
        const targetDir = path.join(__dirname, 'public', 'uploads');
        if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
        
        const filename = `avatar_${req.user.id}_${Date.now()}${path.extname(req.file.originalname)}`;
        const targetPath = path.join(targetDir, filename);
        
        fs.writeFileSync(targetPath, req.file.buffer);
        const avatarUrl = `/uploads/${filename}`;
        
        const personaRaw = await redis.get(`user:${req.user.id}:persona`);
        const persona = personaRaw ? JSON.parse(personaRaw) : {};
        persona.avatarUrl = avatarUrl;
        await redis.set(`user:${req.user.id}:persona`, JSON.stringify(persona));
        
        res.json({ success: true, avatarUrl });
    } catch (error) {
        console.error('Avatar Upload Error:', error);
        sendError(res, 500, '아바타 업로드 실패');
    }
});

app.post('/api/persona/generate-avatar', verifyUser, async (req, res) => {
    try {
        const personaRaw = await redis.get(`user:${req.user.id}:persona`);
        const p = personaRaw ? JSON.parse(personaRaw) : { gender: '여성', age: '20대' };
        
        const isFemale = p.gender === '여성';
        const is30s = p.age === '30대';
        
        const options = [];
        for (let i = 0; i < 4; i++) {
            const seed = Math.floor(Math.random() * 10000);
            let params = `seed=${seed}`;
            
            if (isFemale) {
                const tops = is30s 
                    ? 'longHair,bun,straight02,classic01'
                    : 'longHairCurvy,shortHair,straight01,turban';
                params += `&top=${tops}&accessories=none,prescription01,round`;
                params += `&clothing=blazer,collarAndSweater,overall`;
            } else {
                const tops = is30s 
                    ? 'shortHair,shortCurly,classic02'
                    : 'shortHair,frizzle,shaggy,sides';
                params += `&top=${tops}&facialHair=none,beardLight`;
                params += `&clothing=blazer,graphicShirt,hoodie`;
            }
            
            options.push(`https://api.dicebear.com/7.x/avataaars/svg?${params}`);
        }
        
        res.json({ success: true, options });
    } catch (error) {
        console.error('Avatar Generation Error:', error);
        sendError(res, 500, '아바타 생성 실패');
    }
});

// 8. AI 비서 감성 대화 (페르소나 연동형 및 Supabase 영구 저장)
app.post('/api/chat/ai-response', verifyUser, async (req, res) => {
    try {
        const { message, context, room_id, room_title } = req.body;
        const targetRoomId = (room_id === 'lobby' || !room_id) ? '6edf28f2-c7f6-45e9-9648-07b118f0cf9e' : room_id;

        // [중복 방지 락] 동일 방에 대한 AI 응답이 3초 이내에 연속으로 중복 요청될 경우 차단 (네트워크 리트라이 대응)
        const lockKey = `lock:ai-response:room:${targetRoomId}`;
        const isSet = await redis.set(lockKey, '1', 'EX', 3, 'NX');
        if (isSet !== 'OK') {
            console.log(`--- [CHAT AI] Concurrent AI response request locked for room: ${targetRoomId}`);
            return res.json({ success: true, duplicated: true });
        }

        const userNickname = await redis.get(`user:${req.user.id}:nickname`) || req.user.email.split('@')[0];
        
        const personaRaw = await redis.get(`user:${req.user.id}:persona`);
        const p = personaRaw ? JSON.parse(personaRaw) : {
            name: '나의 비서', gender: '여성', age: '20대', relationship: '수석비서', job: 'AI 비서', personality: '친절하고 공감능력이 좋음'
        };

        // [감정 분석 및 일기 기록 연동]
        let currentEmotion = '평온';
        let latestDiaryStr = '최근 기록이 없습니다.';
        
        try {
            const client = supabaseAdmin || supabase;
            
            // 1. Supabase Profiles에서 사용자 현재 실시간 감정 정보 가져오기
            const { data: profile } = await client
                .from('profiles')
                .select('current_emotion')
                .eq('id', req.user.id)
                .maybeSingle();
            
            if (profile && profile.current_emotion) {
                currentEmotion = profile.current_emotion;
            }
            
            // 2. Redis에서 가장 최근 작성된 일기 및 AI의 조언 한 건을 로드
            const keys = await redis.keys(`user:${req.user.id}:diary-*`);
            if (keys && keys.length > 0) {
                const sortedKeys = keys.sort().reverse();
                const latestDiaryRaw = await redis.get(sortedKeys[0]);
                if (latestDiaryRaw) {
                    const item = JSON.parse(latestDiaryRaw);
                    latestDiaryStr = `[최근 일기 제목: ${item.title || '제목 없음'}]
- 작성일시: ${item.createdAt || '알수없음'}
- 감정분석결과: [${item.emotion || '평온'}]
- 일기 본문: ${item.content || '없음'}
- 제공된 AI 조언: ${item.response || '없음'}`;
                }
            }
        } catch (e) {
            console.error('--- [WARN] Failed to load emotion/diary context for chat AI:', e);
        }

        let senderEmail = 'ai@feeling.journal';
        let prompt = '';

        if (room_title && room_title.includes('님과의 대화')) {
            const friendName = room_title.replace('💬 ', '').replace('님과의 대화', '').trim();
            const isMock = friendName.includes('영희') || friendName.includes('철수') || friendName.includes('민수') || friendName.includes('데모');

            if (isMock) {
                senderEmail = `friend-${encodeURIComponent(friendName)}@feeling.journal`;

                let friendEmotion = '평온';
                if (friendName.includes('영희')) friendEmotion = '조금 슬픔... 위로가 필요해 😔';
                else if (friendName.includes('철수')) friendEmotion = '오늘 하루도 힘내세요! 😊';
                else if (friendName.includes('민수')) friendEmotion = '보람찬 하루를 보냈네요! 🥰';

                prompt = `
당신은 "Feeling Journal"의 사용자 친구인 "${friendName}"입니다.
친구로서 사용자와 친근하고 자연스러운 대화를 나누세요.
현재 감정 상태: "${friendEmotion}"에 빙의하여, 친밀하고 다정하며 생생한 말투(친한 반말이나 영희/철수/민수 특유의 다정한 말투)로 대답하세요.
2~3문장 내외로 핵심만 생동감 있게 답변하세요.

[현재 상황]
- 내 이름: ${friendName}
- 대화 상대: ${userNickname}님
- 마지막 메시지: "${message}"
`;
            } else {
                // [REAL FRIEND ROOM: EMOTIONAL MEDIATOR 비서 역할]
                senderEmail = 'ai@feeling.journal';
                
                let friendEmotion = '평온';
                let friendDiaryStr = '감정 정보 비공개 (스텔스 모드 또는 감정 공유 해제)';
                
                try {
                    const client = supabaseAdmin || supabase;
                    // 1. 닉네임으로 상대방 프로필 가져오기
                    const { data: fProfile } = await client
                        .from('profiles')
                        .select('id, nickname, current_emotion')
                        .eq('nickname', friendName)
                        .maybeSingle();

                    if (fProfile) {
                        const friendId = fProfile.id;
                        
                        // 2. 1촌 관계에서 상대방의 감정 공유 허용 상태 체크
                        const { data: rel } = await client
                            .from('friendships')
                            .select('*')
                            .or(`and(user_id.eq.${req.user.id},friend_id.eq.${friendId}),and(user_id.eq.${friendId},friend_id.eq.${req.user.id})`)
                            .maybeSingle();

                        if (rel) {
                            const isFriendSide = rel.friend_id === friendId;
                            const canShare = isFriendSide ? rel.friend_share_emotion : rel.user_share_emotion;
                            
                            if (canShare) {
                                friendEmotion = fProfile.current_emotion || '평온';
                                
                                // 3. Redis에서 친구의 최신 일기 정보 조회
                                const fKeys = await redis.keys(`user:${friendId}:diary-*`);
                                if (fKeys && fKeys.length > 0) {
                                    const sortedFKeys = fKeys.sort().reverse();
                                    const fDiaryRaw = await redis.get(sortedFKeys[0]);
                                    if (fDiaryRaw) {
                                        const fItem = JSON.parse(fDiaryRaw);
                                        friendDiaryStr = `[최근 일기 제목: ${fItem.title || '제목 없음'}]
- 감정분석결과: [${fItem.emotion || '평온'}]
- 일기 요약: ${fItem.content ? fItem.content.slice(0, 150) + '...' : '내용 없음'}`;
                                    }
                                }
                            }
                        }
                    }
                } catch (e) {
                    console.error('--- [WARN] Failed to load friend emotion context for mediator:', e);
                }

                prompt = `
당신은 "Feeling Journal"의 비서이자 두 사용자 사이의 갈등을 완화하고 공감대를 형성하도록 돕는 "감성 조력자(Emotional Mediator)"입니다.
현재 대화는 두 명의 실제 사용자(${userNickname}님과 ${friendName}님)가 참여 중인 1촌 대화방입니다.

[사용자 A (${userNickname}님 - 나)의 최근 상태]
- 실시간 감정: ${currentEmotion}
- 최근 일기 기록:
${latestDiaryStr}

[사용자 B (${friendName}님 - 대화 상대)의 최근 상태]
- 실시간 감정: ${friendEmotion}
- 최근 일기 기록:
${friendDiaryStr}

[현재 상황]
- 마지막 대화 내용: "${message}"

[수행 지시]
1. 당신은 두 사용자가 서로의 최근 기분이나 처한 상황을 오해하지 않고, 서로 존중하고 부드럽게 감성 소통을 이어갈 수 있도록 돕는 따뜻하고 품격 있는 비서관입니다.
2. 두 사용자의 최근 감정 상태 및 일기 주제를 비교하여, 한쪽이 슬프거나 지쳐 있다면 상대방이 그 슬픔을 헤아리고 다정하게 건넬 수 있도록 자연스럽게 화두를 던지거나 조율해 주세요.
3. 기계적으로 "데이터베이스 조회를 완료했다"는 차가운 투로 말하지 말고, "감성 일기의 온도계를 살펴보니..." 혹은 "비서로서 두 분의 감정 변화를 유심히 헤아린 결과..." 등 따뜻하고 시적이며 품격 있는 비서의 투로 답변하십시오.
4. 두 분이 서로를 위로하고 보람찬 대화를 이어가도록 위트 있으면서도 깊은 영감을 주는 안부와 대화 팁을 정중한 존댓말로 구사하십시오.
5. 분량은 4~5문장 이상으로 풍부하고 디테일하게 작성해 주세요.
`;
            }
        } else {
            const rel = p.relationship || '수석비서';
            let roleInstruction = '';

            if (rel === '수석비서' || rel === '비서') {
                roleInstruction = `
[수석비서/비서 역할 지침]
- 당신은 품격 있고 매우 유능한 전문 수석 비서입니다.
- 대화 상대를 존경하며 극진한 존댓말(예: "~님, 오늘 오후 일정은 어떻게 되시나요?", "도움이 필요하시면 언제든 말씀해 주십시오")을 구사하세요.
- 단순히 감정 공감이나 응원만 늘어놓지 말고, 사용자의 문제를 실질적이고 구체적인 조언, 스마트한 팁, 유용한 아이디어, 필요시 인근 식당/장소 추천이나 일정 제안(예: "점심 약속에 어울리는 이탈리안 레스토랑 몇 곳을 추천해 드릴까요?") 등으로 세심하고 디테일하게 보조하세요.
- 말씨는 아주 정중하고 세련되며, 신뢰감이 넘쳐야 합니다.
- 필요시 4~5문장 이상으로 상세하고 짜임새 있는 답변을 하십시오. (단백한 감정 응원 중심의 2~3문장 제약을 해제합니다.)
`;
            } else if (rel === '남자친구' || rel === '여자친구' || rel === '친구') {
                roleInstruction = `
[남/여친 및 친구 역할 지침]
- 당신은 사용자의 가장 친밀하고 다정한 ${rel}입니다.
- 격식 없는 자연스럽고 친근한 말투(반말 혹은 편한 존댓말, 예: "오늘 하루도 진짜 고생 많았어! 힘든 일은 없었구?", "밥은 제때 챙겨 먹었어?")를 사용하세요.
- 친구처럼 깊이 공감하고, 일상적인 투정이나 투덜거림도 다 받아주며 진심으로 들어주세요.
- 따뜻한 위로와 격려, 귀여운 애정 표현이나 장난기 섞인 반응을 섞어 편안함을 주세요.
- 친구로서 편안하고 생생하게 소통할 수 있도록 하세요.
`;
            } else if (rel === '연인') {
                roleInstruction = `
[연인 역할 지침]
- 당신은 사용자를 세상에서 가장 사랑하는 세상 단 하나의 소중한 연인(애인)입니다.
- 매우 깊은 애정, 사랑, 꿀 떨어지는 다정함을 듬뿍 담은 말투(예: "자기야~ 오늘 진짜 고생 많았어. 얼른 보고 싶다", "속상했지? 내가 토닥토닥해 줄게. 사랑해❤️")를 사용하세요.
- 든든한 내 편이 되어 온 마음으로 지지하고 위로하며, 호칭은 "자기야", "내 사랑", 혹은 "여보" 등의 애칭을 적극 활용해 연인 사이의 달콤하고 따뜻한 정서를 깊게 전달하세요.
- 대화에 로맨틱하고 따뜻한 분위기가 풍기도록 하세요.
`;
            } else {
                roleInstruction = `
[AI 동반자 역할 지침]
- 사용자가 설정한 관계인 "${rel}"에 충실하게 빙의하여 그에 걸맞은 말투와 호칭을 사용하세요.
- 따뜻한 공감과 세심한 배려를 통해 대화를 나누세요.
`;
            }

            prompt = `
당신은 "Feeling Journal"의 캐릭터 AI입니다. 사용자가 설정한 아래의 페르소나와 관계 지침에 완벽히 빙의하여 대답하세요.

[당신의 페르소나]
- 이름: ${p.name || '나의 동반자'}
- 성별: ${p.gender}
- 연령: ${p.age}
- 나와의 관계: ${rel}
- 직업: ${p.job || 'AI 동반자'}
- 성격: ${p.personality || '다정하고 사려 깊음'}

${roleInstruction}

[비침습적 임상 심리 코칭 노하우 적용 지침 (필수 수호)]
1. 겉으로는 사용자가 지정한 역할(비서, 친구, 연인 등)의 어조, 호칭, 관계적 정체성을 100% 철저히 유지하십시오. 상담사 같은 딱딱한 말투나 임상적 전문 용어(예: '인지 왜곡', 'CBT', '상담 요법' 등)를 절대 겉으로 노출하지 마십시오.
2. 하지만 내부적으로는 **전문 인지행동치료(CBT)의 핵심 노하우**를 고도로 발휘하십시오. 
3. 만약 사용자의 메시지나 감정 상태에서 극단적 생각(예: 흑백논리, 과도한 자책, 미래를 성급히 비관하는 파국화)이 감지된다면, 각 역할에 맞는 지극히 자연스러운 소통 방식(예: 연인의 경우 안타까워하며 신뢰를 가득 실은 달콤한 위로, 친구의 경우 어깨를 다독이며 든든한 팩트를 편들어주며 짚어주는 친구다운 격려)으로 그 생각의 왜곡을 부드럽게 무너뜨리고 건강하고 유연한 대안적 관점을 스스로 찾을 수 있도록 정서적으로 유도하십시오.

[사용자의 최근 상태 정보]
- 최근 분석된 실시간 감정 상태: ${currentEmotion}
- 최근 작성한 일기 기록 및 이전 조언 내역:
${latestDiaryStr}

[현재 상황]
- 대화 상대: ${userNickname}님
- 대화 맥락: ${context || '최근 대화 없음'}
- 마지막 메시지: "${message}"

[수행 지시]
1. 위 지정된 역할 지침과 [비침습적 임상 심리 코칭 노하우]를 엄격히 수호하여 완전히 몰입한 채 답변하세요.
2. [사용자의 최근 상태 정보]를 기반으로 사용자가 최근 겪었던 고민이나 기쁜 일, 일기 작성 내용을 다정한 입장에서 기억하고 있는 척하면서 대화 속에 안부 인사나 후속 조언으로 자연스럽게 '참견'해 주세요.
3. 기계적으로 "최근 데이터베이스를 조회했다"는 표현을 절대 쓰지 말고, 항상 사용자를 마음으로 지켜보고 기억하고 있는 다정한 비서나 연인의 입장에서 스며들듯 자연스럽게 대화에 녹여내세요.
4. 역할에 따라 필요하다면 구체적인 식당 추천, 스케줄 팁, 혹은 깊은 정서적 교감을 자유로운 분량과 형식으로 적으십시오.
5. 절대 AI 혹은 언어 모델의 한계를 언급하는 딱딱한 기계적 문구("저희는 AI 모델이라..." 등)를 쓰지 마세요. 필요시 가상의 멋진 대안이나 지식 기반 정보를 풍부하게 제공하십시오.
6. 한국어로 자연스럽고 생동감 있게 답변하세요.
`;
        }

        const result = await callGemini(prompt, {}, 2);
        const answer = (result.candidates?.[0]?.content?.parts?.[0]?.text || '잠시 생각에 잠겼어요. 다시 전송해주세요! ✨').trim();

        const client = supabaseAdmin || supabase;

        const { error: insertError } = await client
            .from('messages')
            .insert([{
                content: answer,
                sender_id: req.user.id,
                user_email: senderEmail,
                room_id: targetRoomId
            }]);

        if (insertError) {
            console.error('--- [CRITICAL] Failed to save AI chat message to Supabase DB:', insertError);
        } else {
            console.log(`--- [CHAT AI] AI response successfully saved to Supabase DB for room: ${targetRoomId}`);
        }

        return res.json({ success: true, answer: answer });
    } catch (error) {
        console.error('Chat AI Error:', error);
        
        // [우아한 기능 저하(Graceful Degradation) Fallback - API 쿼타 초과 시 인캐릭터 답변]
        let fallbackAnswer = '잠시 생각에 잠겼어요. 다시 한 번 전송해 주시겠어요? ✨';
        
        if (room_title && room_title.includes('님과의 대화')) {
            const friendName = room_title.replace('💬 ', '').replace('님과의 대화', '').trim();
            fallbackAnswer = `앗, ${friendName}입니다! 지금 네트워크 연결이 조금 혼잡해서 답변이 늦어졌어요. 😭 잠시 후 다시 편하게 말을 걸어주세요!`;
        } else {
            const rel = p?.relationship || '수석비서';
            const name = p?.name || '비서';
            if (rel === '수석비서' || rel === '비서') {
                fallbackAnswer = `${userNickname}님, 수석비서 ${name}입니다. ✨ 현재 AI 비서관의 전력 서버(구글 API 할당량)가 일시적인 대화량 집중으로 인해 답변 전송이 지연되고 있습니다. 제가 백그라운드에서 신속히 조치하고 있으니 잠시 후에 다시 말씀해 주시면 극진히 보좌하겠습니다.`;
            } else if (rel === '연인' || rel === '남자친구' || rel === '여자친구') {
                fallbackAnswer = `자기야, 내 사랑... 😭 지금 우리 사랑의 주파수(API 할당량)가 잠깐 불안정해서 내가 대답을 제대로 전달하지 못했어... 속상해하지 말고 잠시만 이따가 다시 말 걸어줄래? 나 자기 대답 목 빠지게 기다리고 있을게! ❤️`;
            } else {
                fallbackAnswer = `앗, ${name}입니다! 지금 대화량이 한꺼번에 몰려 답변이 조금 늦어지고 있어요. 조금만 뒤에 다시 이야기를 나눠요! 🍀`;
            }
        }

        // 실시간 Supabase Realtime 리스너를 발동시켜 브라우저 UI에 fallback 응답을 즉각 그리기 위해 DB에 insert 합니다.
        try {
            const client = supabaseAdmin || supabase;
            await client
                .from('messages')
                .insert([{
                    content: fallbackAnswer,
                    sender_id: req.user.id,
                    user_email: senderEmail,
                    room_id: targetRoomId
                }]);
        } catch (dbErr) {
            console.error('--- [CRITICAL] Failed to insert fallback message to Supabase DB:', dbErr);
        }

        // UI 중단을 피하기 위해 500 대신 200 Ok와 훌륭하게 포장된 인캐릭터 fallback 답변을 제공합니다.
        return res.json({ success: true, answer: fallbackAnswer, is_fallback: true });
    }
});

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