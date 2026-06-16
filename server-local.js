// Touch for node watch restart (Updated: 2026-06-17)
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

// 3. 모듈형 Express API 라우터 연동 (Registry SSOT 동적 매핑)
const routes = require('./api/_routes/registry');
const { startPushDispatcher } = require('./api/_routes/push');

routes.forEach(route => {
    if (route.customRouter) {
        if (route.path === '/api/push') {
            app.use('/api', route.handler);
        }
        return;
    }

    const middleware = route.auth ? [verifyUser] : [];

    if (route.path === '/api/scrap') {
        app.all('/api/scrap*', ...middleware, route.handler);
    } else if (route.path === '/api/users/search') {
        app.all(route.path, ...middleware, route.handler);
    } else {
        app.all(route.path, ...middleware, route.handler);
        app.all(route.path + '/*', ...middleware, route.handler);
    }
});

// 백그라운드 스케줄러(구글 캘린더 자동 푸시 등) 시작
startPushDispatcher();

app.listen(PORT, () => {
    console.log(`Server is running at http://localhost:${PORT}`);
});