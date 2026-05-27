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
} = require('./api/_routes/shared');

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
const authRoute = require('./api/_routes/auth');
const scrapRoute = require('./api/_routes/scrap');
const { router: pushRouter, startPushDispatcher } = require('./api/_routes/push');

app.all('/api/auth*', authRoute);
app.all('/api/scrap*', scrapRoute);
app.use('/api', pushRouter);

// 4. 단일 Serverless 핸들러 모듈 바인딩 (Vercel 로컬 매핑 호환)
const calendarRoute = require('./api/_routes/calendar');
const analyzeRoute = require('./api/_routes/analyze');
const historyRoute = require('./api/_routes/history');
const briefingRoute = require('./api/_routes/briefing');
const contactsRoute = require('./api/_routes/contacts');
const chatRoute = require('./api/_routes/chat');
const personaRoute = require('./api/_routes/persona');
const notebooksRoute = require('./api/_routes/notebooks');
const nicknameRoute = require('./api/_routes/nickname');
const friendsRoute = require('./api/_routes/friends');
const inviteRoute = require('./api/_routes/invite');
const presenceRoute = require('./api/_routes/presence');

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
        const user = req.user;
        let providerToken = null;
        try {
            providerToken = await redis.get(`user:${user.id}:google_provider_token`);
        } catch (redisErr) {
            console.warn('--- [CALENDAR ADD] Redis connection offline/error, falling back to header:', redisErr.message);
        }

        if (!providerToken) {
            providerToken = req.headers['x-provider-token'];
        }

        const { summary, start, end } = req.body;

        if (!providerToken || providerToken === 'mock' || providerToken === 'null' || providerToken === 'undefined') {
            return sendError(res, 400, 'Google Provider Token이 필요하며, 연동이 활성화되어 있지 않습니다.');
        }
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

// 9. 실시간 온라인 존재(Presence) 상태 및 1촌/초대 연동 매핑 (신규 서버리스 일관 바인딩)
app.all('/api/presence*', verifyUser, presenceRoute);
app.all('/api/friends*', verifyUser, friendsRoute);
app.all('/api/invite*', verifyUser, inviteRoute);

// 백그라운드 스케줄러(구글 캘린더 자동 푸시 등) 시작
startPushDispatcher();

app.listen(PORT, () => {
    console.log(`Server is running at http://localhost:${PORT}`);
});