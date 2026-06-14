// Touch for node watch restart
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
    verifyUser,
    getGoogleAccessToken
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

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// 민감 정보 로그 마스킹 미들웨어 (Zero-Knowledge 보안성 확보)
app.use((req, res, next) => {
    if (req.body && typeof req.body === 'object') {
        const sensitiveFields = ['decryptedDiaries', 'userDiaryContext', 'content', 'response'];
        const masked = { ...req.body };
        sensitiveFields.forEach(field => {
            if (masked[field] !== undefined) {
                masked[field] = '[MASKED_SENSITIVE_DATA]';
            }
        });

        // JSON.stringify(req.body) 시 자동 마스킹
        Object.defineProperty(req.body, 'toJSON', {
            value: function() { return masked; },
            configurable: true,
            writable: true
        });

        // console.log(req.body) 등 Node.js inspect 시 자동 마스킹
        const customInspect = Symbol.for('nodejs.util.inspect.custom');
        Object.defineProperty(req.body, customInspect, {
            value: function() { return masked; },
            configurable: true,
            writable: true
        });
    }
    next();
});

app.use(express.static(path.join(__dirname, 'public'), {
    setHeaders: (res, filepath) => {
        if (path.basename(filepath) === 'index.html') {
            res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
        }
    }
}));
app.use('/v2', (req, res) => {
    res.redirect(302, '/');
});

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
const ttsRoute = require('./api/_routes/tts');
const apiSettingsRoute = require('./api/_routes/api-settings');

app.use('/api/calendar', verifyUser, calendarRoute);
app.post('/api/analyze', verifyUser, analyzeRoute);
app.get('/api/history', verifyUser, historyRoute);
app.get('/api/briefing', verifyUser, briefingRoute);
app.post('/api/briefing', verifyUser, briefingRoute);
app.get('/api/contacts', verifyUser, contactsRoute);
app.post('/api/tts', verifyUser, ttsRoute);
app.get('/api/api-settings', verifyUser, apiSettingsRoute);
app.post('/api/api-settings', verifyUser, apiSettingsRoute);

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

// 5. 노트북(전자 필기장) 목록 보관 및 조회
app.all('/api/notebooks', verifyUser, notebooksRoute);

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