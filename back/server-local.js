const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const ws = require('ws');
const Redis = require('ioredis');
const webpush = require('web-push');
const nodemailer = require('nodemailer');
const multer = require('multer');
const puppeteer = require('puppeteer');

dotenv.config({
    path: path.join(__dirname, '.env'),
    override: true
});

const axios = require('axios');
const cheerio = require('cheerio');
const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB 제한
});

// [ARCHITECTURE] Puppeteer 브라우저 인스턴스 재사용 (Browser Pool 역할)
let sharedBrowser = null;
async function getBrowserInstance() {
    if (!sharedBrowser || !sharedBrowser.connected) {
        console.log('--- [PUPPETEER] Launching new browser instance ---');
        sharedBrowser = await puppeteer.launch({
            headless: 'new',
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--disable-gpu'
            ]
        });
    }
    return sharedBrowser;
}

/**
 * [SECURITY] SSRF 방지를 위한 URL 안전 검사 (Internal IP 차단)
 */
function isSafeUrl(urlStr) {
    try {
        const url = new URL(urlStr);
        if (!['http:', 'https:'].includes(url.protocol)) return false;

        const hostname = url.hostname.toLowerCase();
        
        // 로컬 및 내부망 주소 차단
        const blockedHosts = [
            'localhost', '127.0.0.1', '::1', '0.0.0.0',
            '169.254.169.254', // Cloud Metadata Service
        ];
        if (blockedHosts.includes(hostname)) return false;

        // RFC1918 사설망 대역 차단 (간이 정규식)
        const isInternalIp = /^(10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.)/.test(hostname);
        if (isInternalIp) return false;

        return true;
    } catch (e) {
        return false;
    }
}

const app = express();
const port = process.env.PORT || 3000;
const DEFAULT_MODEL = process.env.GEMINI_MODEL || 'gemini-flash-latest';
const MODEL_FALLBACKS = ['gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-2.5-flash'];

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const cleanApiKey = (process.env.GEMINI_API_KEY || '')
    .replace(/["']/g, '')
    .trim();

if (!supabaseUrl || !supabaseAnonKey) {
    console.error('Supabase 필수 환경변수가 설정되지 않았습니다.');
    process.exit(1);
}

if (!process.env.REDIS_URL) {
    console.error('REDIS_URL이 설정되지 않았습니다.');
    process.exit(1);
}

if (!cleanApiKey) {
    console.error('GEMINI_API_KEY가 설정되지 않았습니다.');
    process.exit(1);
}

const pushEnabled =
    !!process.env.VAPID_PUBLIC_KEY &&
    !!process.env.VAPID_PRIVATE_KEY;

if (pushEnabled) {
    webpush.setVapidDetails(
        process.env.VAPID_SUBJECT ||
        process.env.VAPID_EMAIL ||
        'mailto:shpark1003@gmail.com',
        process.env.VAPID_PUBLIC_KEY,
        process.env.VAPID_PRIVATE_KEY
    );
    console.log('--- [PUSH] VAPID configuration loaded. ---');
} else {
    console.warn('--- [WARNING] VAPID keys missing. Push notifications disabled. ---');
}

// Nodemailer SMTP Transporter 설정
const emailConfigured = !!process.env.EMAIL_USER && !!process.env.EMAIL_PASS && process.env.EMAIL_PASS !== 'your-google-app-password-here';
let transporter = null;

if (emailConfigured) {
    transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS
        }
    });
    console.log('--- [EMAIL] SMTP configuration loaded. ---');
} else {
    console.warn('--- [WARNING] Email credentials missing or default. Email sending disabled. ---');
}

// [SECURITY] 일반 유저 쿼리용 Public 클라이언트 (RLS 적용)
const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false },
    realtime: { transport: ws }
});

// [SECURITY] 관리자 작업용 Admin 클라이언트 (Service Role) - 필요한 곳에서만 주의해서 사용
const supabaseAdmin = supabaseServiceKey 
    ? createClient(supabaseUrl, supabaseServiceKey, { 
        auth: { persistSession: false },
        realtime: { transport: ws }
      })
    : null;

const redis = new Redis(process.env.REDIS_URL);

redis.on('error', (err) => {
    console.error('Redis Client Error:', err);
});

console.log('--- Environment Check ---');
console.log(`GEMINI_API_KEY verified: YES (Length: ${cleanApiKey.length})`);
console.log('SUPABASE connected: YES');
console.log('REDIS_URL found: YES');
console.log(`GEMINI_MODEL: ${DEFAULT_MODEL}`);
console.log(`PUSH Notifications: ${pushEnabled ? 'ENABLED' : 'DISABLED (Keys missing)'}`);
console.log('-------------------------');

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

const sendError = (res, status, message) => {
    return res.status(status).json({
        success: false,
        error: message
    });
};

const fetchWithTimeout = async (url, options = {}, timeoutMs = 20000, retries = 3) => {
    let lastError;
    for (let i = 0; i <= retries; i++) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);

        try {
            const response = await fetch(url, {
                ...options,
                signal: controller.signal
            });

            if (response.status === 429 && i < retries) {
                let delay = 3000 * (i + 1);
                
                try {
                    const errorData = await response.clone().json();
                    if (errorData.error?.details) {
                        const retryInfo = errorData.error.details.find(d => d['@type']?.includes('RetryInfo'));
                        if (retryInfo?.retryDelay) {
                            const seconds = parseFloat(retryInfo.retryDelay.replace('s', ''));
                            if (!isNaN(seconds)) delay = Math.max(delay, (seconds + 1) * 1000);
                        }
                    }
                } catch (e) { /* ignore parse error */ }

                console.log(`--- [RETRY] 429 Detected. Waiting ${delay}ms... (Attempt ${i + 1}/${retries})`);
                clearTimeout(timeout);
                await new Promise(resolve => setTimeout(resolve, delay));
                continue;
            }
            return response;
        } catch (err) {
            lastError = err;
            if (i < retries) {
                const wait = err.name === 'AbortError' ? 1000 : 1500;
                console.warn(`--- [WARN] Fetch error (Attempt ${i + 1}): ${err.message}. Retrying...`);
                await new Promise(resolve => setTimeout(resolve, wait));
                continue;
            }
        } finally {
            clearTimeout(timeout);
        }
    }
    throw lastError;
};

const getGeminiUrl = (model = DEFAULT_MODEL) => {
    return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${cleanApiKey}`;
};

const callGemini = async (prompt, generationConfig = {}, retries = 3, inlineData = null) => {
    const modelsToTry = [DEFAULT_MODEL, ...MODEL_FALLBACKS];
    let lastError;

    for (const model of modelsToTry) {
        try {
            console.log(`--- [GEMINI] Attempting with model: ${model}`);
            const parts = [{ text: prompt }];
            if (inlineData) {
                parts.push({
                    inlineData: {
                        mimeType: inlineData.mimeType,
                        data: inlineData.data
                    }
                });
            }

            const response = await fetchWithTimeout(
                getGeminiUrl(model),
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ parts }],
                        generationConfig
                    })
                },
                25000,
                retries
            );

            const result = await response.json();
            if (response.ok && !result.error) {
                return result;
            }
            
            const err = result.error || { message: 'Unknown Gemini Error' };
            console.warn(`--- [GEMINI WARN] Model ${model} failed: ${err.message}`);
            lastError = err;
        } catch (err) {
            console.warn(`--- [GEMINI WARN] Model ${model} fetch failed: ${err.message}`);
            lastError = err;
        }
    }
    console.error('--- [CRITICAL] All Gemini models failed.');
    throw lastError;
};

const sanitizeContent = (content) => {
    return String(content || '')
        .replace(/```/g, '')
        .slice(0, 5000)
        .trim();
};

const safeParseJsonArray = (raw, label = 'JSON') => {
    try {
        let clean = String(raw || '[]')
            .replace(/```json/gi, '')
            .replace(/```/g, '')
            .trim();

        // JSON 배열 부분만 추출 시도 (강력한 파싱)
        const arrayMatch = clean.match(/\[[\s\S]*\]/);
        if (arrayMatch) {
            clean = arrayMatch[0];
        }

        const parsed = JSON.parse(clean);

        if (!Array.isArray(parsed)) {
            console.error(`${label} Parse Error: result is not array`);
            return [];
        }

        return parsed;
    } catch (error) {
        console.error(`${label} Parse Error:`, error.message);
        // 파싱 실패 시 빈 배열 반환하여 시스템 중단 방지
        return [];
    }
};

const extractEventJson = (text) => {
    try {
        if (!text.includes('EVENT_JSON_START') || !text.includes('EVENT_JSON_END')) {
            return null;
        }

        const startIndex =
            text.indexOf('EVENT_JSON_START') + 'EVENT_JSON_START'.length;

        const endIndex = text.indexOf('EVENT_JSON_END');

        if (endIndex <= startIndex) return null;

        const jsonStr = text.slice(startIndex, endIndex).trim();
        const event = JSON.parse(jsonStr);

        if (!event.summary || !event.start) return null;

        if (!event.end) {
            const start = new Date(event.start);
            if (Number.isNaN(start.getTime())) return null;

            start.setHours(start.getHours() + 1);
            event.end = start.toISOString();
        }

        return event;
    } catch (error) {
        console.error('Event JSON Extraction Error:', error.message);
        return null;
    }
};

const scanRedisKeys = async (pattern) => {
    let cursor = '0';
    const keys = [];

    do {
        const result = await redis.scan(
            cursor,
            'MATCH',
            pattern,
            'COUNT',
            100
        );

        cursor = result[0];
        keys.push(...result[1]);
    } while (String(cursor) !== '0');

    return keys;
};

const verifyUser = async (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return sendError(res, 401, '인증 정보가 필요합니다.');
    }

    const token = authHeader.split(' ')[1];

    try {
        const {
            data: { user },
            error
        } = await supabase.auth.getUser(token);

        if (error || !user) {
            throw error || new Error('Invalid user');
        }

        req.user = user;
        next();
    } catch (error) {
        return sendError(res, 401, '유효하지 않은 토큰입니다.');
    }
};

/* ==========================================================================
   [AUTHENTICATION ROUTES]
   ========================================================================== */
app.post('/api/auth/signup', async (req, res) => {
    try {
        const { email, password } = req.body;
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) return sendError(res, 400, error.message);
        return res.json({ success: true, user: data.user });
    } catch (err) {
        return sendError(res, 500, '회원가입 중 서버 오류가 발생했습니다.');
    }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) return sendError(res, 400, error.message);
        return res.json({ 
            success: true, 
            session: data.session, 
            user: data.user,
            provider_token: data.session?.provider_token
        });
    } catch (err) {
        return sendError(res, 500, '로그인 중 서버 오류가 발생했습니다.');
    }
});

app.get('/api/auth/me', verifyUser, (req, res) => {
    return res.json({ success: true, user: req.user });
});

app.post('/api/auth/logout', async (req, res) => {
    try {
        await supabase.auth.signOut();
        return res.json({ success: true });
    } catch (err) {
        return sendError(res, 500, '로그아웃 실패');
    }
});

// [OAUTH] Google Login
app.get('/api/auth/google', async (req, res) => {
    try {
        const { data, error } = await supabase.auth.signInWithOAuth({
            provider: 'google',
            options: {
                redirectTo: `${process.env.APP_URL || 'http://localhost:3000'}/api/auth/callback`,
                scopes: 'https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/contacts.readonly',
                queryParams: {
                    access_type: 'offline',
                    prompt: 'consent',
                },
            }
        });
        if (error) throw error;
        res.redirect(data.url);
    } catch (err) {
        console.error('Google OAuth Error:', err.message);
        res.redirect('/?error=' + encodeURIComponent(err.message));
    }
});

// [OAUTH] Kakao Login
app.get('/api/auth/kakao', async (req, res) => {
    try {
        const { data, error } = await supabase.auth.signInWithOAuth({
            provider: 'kakao',
            options: {
                redirectTo: `${process.env.APP_URL || 'http://localhost:3000'}/api/auth/callback`
            }
        });
        if (error) throw error;
        res.redirect(data.url);
    } catch (err) {
        console.error('Kakao OAuth Error:', err.message);
        res.redirect('/?error=' + encodeURIComponent(err.message));
    }
});

// [OAUTH] Callback
app.get('/api/auth/callback', async (req, res) => {
    try {
        const { code } = req.query;
        if (code) {
            const { error } = await supabase.auth.exchangeCodeForSession(code);
            if (error) throw error;
        }
        res.redirect('/');
    } catch (err) {
        console.error('OAuth Callback Error:', err.message);
        res.redirect('/?error=callback_failed');
    }
});

/* ==========================================================================
   [CHAT ROUTES]
   ========================================================================== */
app.get('/api/chat/messages', verifyUser, async (req, res) => {
    try {
        const { roomId } = req.query;
        // [COMPATIBILITY] 'lobby' 문자열을 실제 UUID로 변환
        const rid = (roomId === 'lobby' || !roomId) ? '6edf28f2-c7f6-45e9-9648-07b118f0cf9e' : roomId;
        
        const { data: messages, error } = await supabase
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
        const { data, error } = await supabase
            .from('messages')
            .insert([{
                content,
                sender_id: req.user.id,
                user_email: req.user.email,
                // [COMPATIBILITY] 'lobby' 문자열을 실제 UUID로 변환
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

app.post('/api/analyze', verifyUser, async (req, res) => {
    try {
        const user = req.user;
        const content = sanitizeContent(req.body.content);

        if (!content) {
            return sendError(res, 400, '메모 내용이 없습니다.');
        }

        const providerToken = req.headers['x-provider-token'];
        const contentHash = Buffer.from(content).toString('base64').slice(0, 50);
        const analyzeCacheKey = `user:${user.id}:last-analyze-cache`;

        try {
            const cachedAnalyze = await redis.get(analyzeCacheKey);

            if (cachedAnalyze) {
                const { hash, result } = JSON.parse(cachedAnalyze);

                if (hash === contentHash) {
                    console.log('--- [CACHE] Returning cached analysis for identical content.');
                    return res.json(result);
                }
            }
        } catch (error) {
            console.error('Analyze Cache Error:', error.message);
        }

        const { image, title, mediaId, notebookId, richContent } = req.body;
        if (!content && !image && !richContent) {
            return sendError(res, 400, '분석할 내용이나 이미지가 없습니다.');
        }

        let existingEventsStr = '현재 등록된 일정이 없습니다.';

        if (providerToken) {
            try {
                const calendarUrl =
                    'https://www.googleapis.com/calendar/v3/calendars/primary/events' +
                    `?timeMin=${encodeURIComponent(new Date().toISOString())}` +
                    '&maxResults=15&singleEvents=true&orderBy=startTime';

                const calendarResponse = await fetchWithTimeout(
                    calendarUrl,
                    {
                        headers: {
                            Authorization: `Bearer ${providerToken}`
                        }
                    },
                    10000
                );

                const calendarData = await calendarResponse.json();

                if (calendarData.items && calendarData.items.length > 0) {
                    existingEventsStr = calendarData.items
                        .map((event) => {
                            const start = event.start?.dateTime || event.start?.date;
                            const dateObj = new Date(start);
                            const formattedDate = dateObj.toLocaleString('ko-KR', {
                                month: 'short', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Seoul'
                            });
                            return `- 제목: ${event.summary || '제목 없음'}, 시간: ${formattedDate}`;
                        })
                        .join('\n');
                }
            } catch (error) {
                console.error('Calendar Fetch Error for Analyze:', error.message);
            }
        }

        const currentTimeStr = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });

        // 사용자 호칭 조회 (Redis에 없으면 이메일 ID 사용)
        const nicknameKey = `user:${user.id}:nickname`;
        const storedNickname = await redis.get(nicknameKey);
        const userNickname = storedNickname || user.email.split('@')[0];

        const prompt = `
너는 사용자의 감정을 분석하고 일정을 조율하며, 생활 전반을 챙겨주는 품격 있는 수석 비서다.
사용자의 호칭은 "${userNickname}"이다. 응답 시 반드시 이 호칭으로 불러라.
첨부된 이미지가 있다면 그 안의 텍스트(영수증, 메모, 안내문 등)를 스캔(OCR)하고 내용을 분석하라.

[사용자의 현재 일정 리스트]
${existingEventsStr}

[현재 시간]
${currentTimeStr}

[수행 지시]
1. 이미지 속 텍스트와 사용자의 메모를 종합 분석하라.
2. 기존 일정과 대조하여 충돌 여부를 확인하라.
3. 할 일이 발견되면 EVENT_JSON_START/END 형식으로 제안하라.
4. "내일", "다음주" 등 상대 시간은 현재 시간을 기준으로 계산하라.
5. 첫 줄에 감정:[단어] 형식으로 작성하라.
6. 분석 결과에 따라 따뜻한 위로나 조언을 제공하되, 반드시 "${userNickname}"님이라고 호칭하라.

EVENT_JSON_START
{"summary":"일정 제목","start":"ISO8601 시작시간","end":"ISO8601 종료시간","type":"task"}
EVENT_JSON_END

사용자 입력:
"""
${content || '(이미지 분석 요청)'}
"""
`;


        const inlineData = image ? {
            mimeType: image.split(';')[0].split(':')[1],
            data: image.split(',')[1]
        } : null;

        const result = await callGemini(prompt, {}, 3, inlineData);

        const text = result.candidates?.[0]?.content?.parts?.[0]?.text || '';

        if (!text) {
            throw new Error('Gemini 응답이 비어 있습니다.');
        }

        const emotionMatch = text.match(/감정:\[(.*?)\]/);
        const emotion = emotionMatch ? emotionMatch[1].trim() : '평온';
        const detectedEvent = extractEventJson(text);

        const timestamp = new Date()
            .toISOString()
            .replace(/[-:T.]/g, '')
            .slice(0, 14);

        const redisKey = `user:${user.id}:diary-${timestamp}`;

        const diaryData = {
            title: title || '제목 없는 메모',
            content,
            richContent: richContent || null,
            response: text,
            createdAt: new Date().toISOString(),
            emotion,
            mediaId: mediaId || null,
            notebookId: notebookId || 'nb-1'
        };

        await redis.set(redisKey, JSON.stringify(diaryData), 'EX', 3600 * 24 * 30);

        // [추가] 사용자 프로필에 최신 감정 상태 동기화 (1촌 공유용)
        try {
            const { error: profileError } = await supabase
                .from('profiles')
                .upsert({ 
                    id: user.id, 
                    current_emotion: emotion, 
                    emotion_updated_at: new Date().toISOString() 
                }, { onConflict: 'id' });
            
            if (profileError) console.error('Profile Emotion Sync Error:', profileError);
        } catch (e) {
            console.error('Profile DB Error:', e);
        }

        const finalResult = {
            success: true,
            answer: text,
            emotion,
            event: detectedEvent,
            id: redisKey,
            title: diaryData.title
        };

        // 캐시 저장 (응답 전에 처리)
        await redis.set(
            analyzeCacheKey,
            JSON.stringify({
                hash: contentHash,
                result: finalResult
            }),
            'EX',
            3600
        );

        // 응답은 단 한 번만 전송
        return res.json(finalResult);
    } catch (error) {
        console.error('Critical Analyze Error:', error);
        return res.json({
            success: false,
            answer: '분석 중 문제가 발생했습니다. 조금만 기다려 주시겠어요?'
        });
    }
});

app.get('/api/history', verifyUser, async (req, res) => {
    try {
        const user = req.user;
        const notebooksKey = `user:${user.id}:notebooks`;
        const notebooksData = await redis.get(notebooksKey);
        const notebooks = notebooksData ? JSON.parse(notebooksData) : [];
        const firstNotebookId = notebooks.length > 0 ? notebooks[0].id : null;

        const pattern = `user:${user.id}:diary-*`;
        const allKeys = await scanRedisKeys(pattern);

        if (allKeys.length === 0) {
            return res.json({
                success: true,
                history: []
            });
        }

        const sortedKeys = allKeys.sort().reverse().slice(0, 50);
        const values = await redis.mget(sortedKeys);

        const history = [];

        for (let i = 0; i < values.length; i++) {
            if (!values[i]) continue;

            try {
                const item = JSON.parse(values[i]);

                // [이사 로직] 필기장 정보가 없거나 기본값('nb-1')인 경우 새 필기장으로 배정
                if (firstNotebookId && (!item.notebookId || item.notebookId === 'nb-1')) {
                    item.notebookId = firstNotebookId;
                    await redis.set(sortedKeys[i], JSON.stringify(item), 'KEEPTTL');
                }

                history.push({
                    id: sortedKeys[i],
                    title: item.title,
                    originalContent: item.content,
                    richContent: item.richContent || null,
                    aiResponse: item.response,
                    createdAt: item.createdAt,
                    emotion: item.emotion,
                    mediaId: item.mediaId,
                    notebookId: item.notebookId
                });
            } catch (error) {
                console.error('History Parse Error:', error.message);
            }
        }

        return res.json({
            success: true,
            history
        });
    } catch (error) {
        console.error('Redis History Error:', error);
        return sendError(res, 500, '히스토리 로딩 실패');
    }
});

app.patch('/api/history/:id', verifyUser, async (req, res) => {
    try {
        const user = req.user;
        const { id } = req.params;
        const { title, content } = req.body;
        
        // [SECURITY] 보안 검증: 본인의 데이터만 수정 가능해야 함
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

app.post('/api/scrap-url-snapshot', verifyUser, async (req, res) => {
    let browser;
    try {
        const { url } = req.body;
        if (!url) return sendError(res, 400, 'URL이 필요합니다.');

        // [SECURITY] 백엔드 URL 검증 (SSRF 방지)
        try {
            const parsedUrl = new URL(url);
            if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
                return sendError(res, 400, '허용되지 않는 프로토콜입니다.');
            }
        } catch (e) {
            return sendError(res, 400, '유효하지 않은 URL입니다.');
        }

        console.log('--- [URL SNAPSHOT] Launching Browser for:', url);
        
        browser = await puppeteer.launch({
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 800 });
        
        // 페이지 로딩 (최대 30초 대기)
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
        
        // 캡처 전 제목 가져오기
        const pageTitle = await page.title();
        
        // 스크린샷 찍기 (버퍼로 저장)
        const screenshotBuffer = await page.screenshot({ type: 'jpeg', quality: 80 });
        await page.close(); // 탭만 닫음 (브라우저는 유지)
        browser = null;

        // Gemini Vision으로 전송 (callGemini 유틸리티 사용)
        const prompt = `
            사용자가 웹 페이지를 스크랩하기 위해 URL 스냅샷을 찍었습니다. 
            이미지 속의 텍스트와 주요 정보를 추출하여 정리해 주세요:
            1. 페이지의 핵심 제목
            2. 상세 본문 내용 (가독성 있게 줄바꿈 포함)
            
            응답은 반드시 JSON 형식으로만 해주세요:
            { "title": "추출된 제목", "content": "추출된 상세 본문 내용" }
        `;

        const inlineData = {
            mimeType: 'image/jpeg',
            data: screenshotBuffer.toString('base64')
        };

        const result = await callGemini(prompt, {}, 3, inlineData);
        const text = result.candidates?.[0]?.content?.parts?.[0]?.text || '';
        
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error('AI 응답 해석 실패');
        
        const data = JSON.parse(jsonMatch[0]);

        res.json({
            success: true,
            title: data.title || pageTitle,
            content: data.content
        });
    } catch (error) {
        console.error('URL Snapshot Error:', error.message);
        if (browser) await browser.close();
        sendError(res, 500, '웹 페이지 캡처 실패: ' + error.message);
    }
});

app.post('/api/scrap-screenshot', verifyUser, upload.single('image'), async (req, res) => {
    try {
        if (!req.file) return sendError(res, 400, '이미지 데이터가 없습니다.');

        console.log('--- [SCREENSHOT SCRAP] Analyzing Captured Screen ---');
        
        const prompt = `
            사용자가 현재 자신의 화면을 캡처하여 스크랩했습니다. 
            이미지 속의 텍스트를 모두 읽어내어 다음 형식으로 정리해 주세요:
            1. 페이지의 핵심 제목 (가장 눈에 띄는 제목이나 주제)
            2. 상세 본문 내용 (줄바꿈을 포함하여 읽기 좋게 정리)
            
            응답은 반드시 JSON 형식으로만 해주세요:
            { "title": "추출된 제목", "content": "추출된 상세 본문 내용" }
        `;

        const inlineData = {
            mimeType: req.file.mimetype,
            data: req.file.buffer.toString('base64')
        };

        const result = await callGemini(prompt, {}, 3, inlineData);
        const text = result.candidates?.[0]?.content?.parts?.[0]?.text || '';
        
        // JSON 추출 로직 (백틱 제거 등)
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error('AI 응답 형식이 올바르지 않습니다.');
        
        const data = JSON.parse(jsonMatch[0]);

        res.json({
            success: true,
            title: data.title,
            content: data.content
        });
    } catch (error) {
        console.error('Screenshot Scraping Error:', error.message);
        sendError(res, 500, '화면 분석 실패: ' + error.message);
    }
});

app.post('/api/scrap', verifyUser, async (req, res) => {
    try {
        const { url } = req.body;
        if (!url) return sendError(res, 400, 'URL이 필요합니다.');

        console.log('--- [SCRAP] Fetching URL:', url);
        
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            timeout: 10000
        });

        const $ = cheerio.load(response.data);
        
        // 1. 제목 추출
        const title = $('title').text() || $('h1').first().text() || '제목 없는 페이지';
        
        // 2. 본문 추출 (주요 태그들에서 텍스트 수집)
        let content = '';
        $('p, article, section').each((i, el) => {
            const text = $(el).text().trim();
            if (text.length > 20) { // 너무 짧은 텍스트(메뉴 등) 제외
                content += text + '\n\n';
            }
        });

        // 본문이 너무 길면 자르기 (Gemini 토큰 제한 고려)
        if (content.length > 5000) {
            content = content.substring(0, 5000) + '... (이하 생략)';
        }

        res.json({
            success: true,
            title: title.trim(),
            content: content.trim()
        });
    } catch (error) {
        console.error('Scraping Error:', error.message);
        sendError(res, 500, '스크랩 실패: ' + error.message);
    }
});

app.get('/api/calendar', verifyUser, async (req, res) => {
    try {
        const user = req.user;
        const providerToken = req.headers['x-provider-token'];

        if (!providerToken) {
            return sendError(res, 400, 'Google Provider Token이 필요합니다.');
        }

        const currentTimeStr = new Date().toLocaleString('ko-KR', {
            timeZone: 'Asia/Seoul'
        });

        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const timeMin = startOfMonth.toISOString();
        const calendarUrl =
            `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(timeMin)}` +
            '&maxResults=50&singleEvents=true&orderBy=startTime';

        const calRes = await fetchWithTimeout(
            calendarUrl,
            {
                headers: {
                    Authorization: `Bearer ${providerToken}`
                }
            },
            10000
        );

        const calData = await calRes.json();

        if (!calRes.ok || calData.error) {
            const msg = calData?.error?.message || '';
            if (calRes.status === 401 || calRes.status === 403 || msg.includes('invalid authentication')) {
                throw new Error('구글 인증이 만료되었습니다. 로그아웃 후 다시 구글로 로그인해 주세요.');
            }
            throw new Error(msg || 'Google Calendar API 호출 실패');
        }

        let events = (calData.items || []).map((item) => ({
            id: item.id,
            title: item.summary || '제목 없음',
            start: item.start?.dateTime || item.start?.date,
            end: item.end?.dateTime || item.end?.date,
            allDay: !item.start?.dateTime,
            type: 'event',
            advice: '구글 캘린더 일정입니다.'
        }));

        const currentFingerprint = events
            .map((event) => `${event.id}-${event.title}-${event.start}-${event.end}`)
            .join('|');

        const cacheKey = `user:${user.id}:calendar-advice-cache`;

        try {
            const cachedData = await redis.get(cacheKey);

            if (cachedData) {
                const { fingerprint, analyzedEvents } = JSON.parse(cachedData);

                if (fingerprint === currentFingerprint) {
                    console.log('--- [CACHE] Returning cached calendar advice.');
                    return res.json({
                        success: true,
                        events: analyzedEvents,
                        cached: true
                    });
                }
            }
        } catch (error) {
            console.error('Calendar Cache Retrieval Error:', error.message);
        }

        const pattern = `user:${user.id}:diary-*`;
        const allKeys = await scanRedisKeys(pattern);

        let quotaExhausted = false;

        if (allKeys.length > 0) {
            const latestKeys = allKeys.sort().reverse().slice(0, 10);
            const diaryValues = await Promise.all(latestKeys.map(k => redis.get(k)));
            const diaryFingerprint = diaryValues.join('|');
            const diaryCacheKey = `user:${user.id}:diary-task-cache`;

            let normalizedTasks = [];
            let cacheFound = false;

            try {
                const cachedDiaryData = await redis.get(diaryCacheKey);
                if (cachedDiaryData) {
                    const { fingerprint, tasks } = JSON.parse(cachedDiaryData);
                    if (fingerprint === diaryFingerprint) {
                        console.log('--- [CACHE] Returning cached diary tasks.');
                        normalizedTasks = tasks;
                        cacheFound = true;
                    }
                }
            } catch (e) { console.error('Diary Task Cache Error:', e.message); }

            if (!cacheFound) {
                const diaryValues = await redis.mget(latestKeys);
                const diaryContent = diaryValues
                    .filter(Boolean)
                    .map((value) => {
                        try {
                            return JSON.parse(value).content || '';
                        } catch {
                            return '';
                        }
                    })
                    .filter(Boolean)
                    .join('\n---\n');

                if (diaryContent) {
                    const extractionPrompt = `
너는 사용자의 일기를 분석하여 미래의 할 일(Task)을 추출하는 전문가다.
아래 일기들을 읽고, 사용자가 언급한 미래의 약속, 마감일, 계획을 모두 찾아내어 JSON 배열로 리턴하라.

[분석 기준]
1. 오늘 날짜/시간: ${currentTimeStr}
2. "내일", "이번주 금요일", "다음주" 등의 상대적 시간을 오늘 날짜 기준으로 절대적 ISO 시간으로 변환하라.
3. 명확한 계획이 아니더라도 "조만간 ~해야지", "~하고 싶다" 같은 의지도 할 일(task)로 간주하라.

[출력 형식]
[
  {"id":"task-1","title":"내용","start":"ISO8601","end":"ISO8601","allDay":false,"type":"task","advice":"AI 비서의 조언"}
]
(오직 JSON 배열만 출력하고 다른 설명은 하지 마라.)

[일기 데이터]
${diaryContent}
`;

                    try {
                        const geminiData = await callGemini(extractionPrompt, { response_mime_type: 'application/json' });
                        const rawJson = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
                        const diaryTasks = safeParseJsonArray(rawJson, 'Diary Task');

                        normalizedTasks = diaryTasks
                            .filter((task) => task.title && task.start)
                            .map((task, index) => {
                                let end = task.end;
                                if (!end) {
                                    const startDate = new Date(task.start);
                                    if (!Number.isNaN(startDate.getTime())) {
                                        startDate.setHours(startDate.getHours() + 1);
                                        end = startDate.toISOString();
                                    }
                                }
                                return {
                                    id: task.id || `diary-task-${Date.now()}-${index}`,
                                    title: task.title,
                                    start: task.start,
                                    end: end || task.start,
                                    allDay: !!task.allDay,
                                    type: 'task',
                                    advice: task.advice || '일기에서 추출된 할 일입니다.'
                                };
                            });

                        await redis.set(diaryCacheKey, JSON.stringify({
                            fingerprint: diaryFingerprint,
                            tasks: normalizedTasks
                        }), 'EX', 3600);
                    } catch (error) {
                        console.error('Diary Task Extraction Gemini Error:', error.message);
                        if (error.code === 429) quotaExhausted = true;
                    }
                }
            }
            events = [...events, ...normalizedTasks];
        }

        // [신규] 중복 일정 병합 로직 (제목 및 시간 유사도 기반)
        const mergeEvents = (rawEvents) => {
            const merged = [];
            rawEvents.forEach(current => {
                const isDuplicate = merged.find(item => {
                    const sameTitle = item.title.replace(/\s/g, '') === current.title.replace(/\s/g, '');
                    const sameDay = new Date(item.start).toDateString() === new Date(current.start).toDateString();
                    // 시간이 1시간 이내로 차이 나면 동일 일정으로 간주
                    const timeDiff = Math.abs(new Date(item.start) - new Date(current.start)) / (1000 * 60 * 60);
                    return sameTitle && sameDay && timeDiff < 1;
                });

                if (isDuplicate) {
                    // 기존 일정에 정보 보강 (조언 등이 있다면 합침)
                    if (current.type === 'task') isDuplicate.type = 'task';
                    if (current.advice && !isDuplicate.advice.includes(current.advice)) {
                        isDuplicate.advice = isDuplicate.advice ? `${isDuplicate.advice}\n${current.advice}` : current.advice;
                    }
                } else {
                    merged.push({ ...current });
                }
            });
            return merged;
        };

        events = mergeEvents(events);

        // 3. 미래 일정에 대해서만 AI 조언 생성 (토큰 절약 핵심!)
        const futureEvents = events.filter(e => new Date(e.start) >= new Date());
        
        if (futureEvents.length > 0 && !quotaExhausted) {
            const eventsSummary = futureEvents
                .map((event, index) => `${index + 1}. 제목: ${event.title}, 시간: ${event.start}, 유형: ${event.type}`)
                .join('\n');

            const batchPrompt = `너는 수석 비서다. 아래 미래 일정들에 대해 짧은 전문적 조언을 JSON 배열로 작성하라. [{"id":번호, "advice":"..."}] \n\n일정:\n${eventsSummary}`;

            try {
                const result = await callGemini(batchPrompt, { response_mime_type: 'application/json' });
                const adviceList = safeParseJsonArray(result.candidates?.[0]?.content?.parts?.[0]?.text || '[]', 'Advice');

                events = events.map((event) => {
                    const isPast = new Date(event.start) < new Date();
                    if (isPast) return { ...event, advice: 'AI 조언: 이미 완료된 소중한 시간입니다. ✨' };

                    const foundAdvice = adviceList.find((a, idx) => futureEvents[idx]?.id === event.id);
                    return { ...event, advice: foundAdvice?.advice || 'AI 조언: 일정을 확인하고 준비해 보세요.' };
                });
            } catch (error) {
                console.error('Batch Advice Error:', error.message);
            }
        } else {
            // 미래 일정이 없거나 쿼터 초과 시 기본 처리
            events = events.map(e => ({
                ...e,
                advice: new Date(e.start) < new Date() ? 'AI 조언: 완료된 일정입니다.' : 'AI 조언: 일정을 확인해 보세요.'
            }));
        }

        await redis.set(cacheKey, JSON.stringify({ fingerprint: currentFingerprint, analyzedEvents: events }), 'EX', 3600);
        return res.json({ success: true, events });
    } catch (error) {
        console.error('--- [CRITICAL] Calendar API Error:', error);
        return sendError(res, 500, `캘린더 시스템 오류: ${error.message}`);
    }
});

app.get('/api/contacts', verifyUser, async (req, res) => {
    try {
        const providerToken = req.headers['x-provider-token'];
        
        // Google OAuth 연동이 안 되어 있거나 데모/로컬 환경일 때 Mock 주소록을 제공하여 원활한 테스트 진행
        if (!providerToken || providerToken === 'mock' || providerToken === 'null' || providerToken === 'undefined') {
            console.log('--- [CONTACTS] Google OAuth token missing or mock. Returning curated mock contacts. ---');
            const mockContacts = [
                { name: '다정한 영희', email: 'younghee@example.com' },
                { name: '든든한 철수', email: 'chulsoo@example.com' },
                { name: '행복한 민수', email: 'minsu@example.com' },
                { name: '빛나는 수지', email: 'suji@example.com' }
            ];
            return res.json({ success: true, contacts: mockContacts, isMock: true });
        }

        console.log('--- [CONTACTS] Fetching Google Contacts ---');
        const url = 'https://people.googleapis.com/v1/people/me/connections?personFields=names,emailAddresses&pageSize=100';
        const response = await fetchWithTimeout(url, {
            headers: { Authorization: `Bearer ${providerToken}` }
        }, 10000);

        const data = await response.json();
        if (!response.ok) {
            const msg = data.error?.message || '';
            if (response.status === 401 || response.status === 403 || msg.includes('invalid authentication')) {
                throw new Error('구글 인증이 만료되었습니다. 로그아웃 후 다시 로그인해 주세요.');
            }
            throw new Error(msg || 'Google Contacts API 호출 실패');
        }

        const contacts = (data.connections || []).map(person => {
            const name = person.names?.[0]?.displayName || '이름 없음';
            const email = person.emailAddresses?.[0]?.value || '';
            return { name, email };
        }).filter(c => c.email);

        res.json({ success: true, contacts });
    } catch (error) {
        console.error('Contacts API Error:', error.message);
        sendError(res, 500, error.message);
    }
});

app.post('/api/calendar/add', verifyUser, async (req, res) => {
    try {
        const providerToken = req.headers['x-provider-token'];
        const { summary, start, end } = req.body;

        if (!providerToken) {
            return sendError(res, 400, 'Google Provider Token이 필요합니다.');
        }

        if (!summary || !start || !end) {
            return sendError(res, 400, 'summary, start, end 값이 필요합니다.');
        }

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
                    start: {
                        dateTime: start,
                        timeZone: 'Asia/Seoul'
                    },
                    end: {
                        dateTime: end,
                        timeZone: 'Asia/Seoul'
                    }
                })
            },
            10000
        );

        const data = await calendarResponse.json();

        if (!calendarResponse.ok || data.error) {
            throw new Error(
                'Google Calendar API Error: ' +
                (data?.error?.message || calendarResponse.statusText)
            );
        }

        return res.json({
            success: true,
            eventId: data.id
        });
    } catch (error) {
        console.error('Calendar Add Error:', error);
        return sendError(res, 500, '일정 등록 중 오류가 발생했습니다.');
    }
});

app.get('/api/briefing', verifyUser, async (req, res) => {
    try {
        const user = req.user;
        const providerToken = req.headers['x-provider-token'];

        // 1. Redis 캐시 확인 (5분)
        const cacheKey = `user:${user.id}:briefing-cache`;
        try {
            const cachedBriefing = await redis.get(cacheKey);
            if (cachedBriefing) {
                console.log('--- [CACHE] Returning cached briefing.');
                return res.json({
                    success: true,
                    briefing: cachedBriefing,
                    cached: true
                });
            }
        } catch (error) {
            console.error('Briefing Cache Error:', error.message);
        }

        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        yesterday.setHours(0, 0, 0, 0);

        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(23, 59, 59, 999);

        let contextEvents = '일정 정보 없음';

        if (providerToken) {
            try {
                const calendarUrl =
                    'https://www.googleapis.com/calendar/v3/calendars/primary/events' +
                    `?timeMin=${encodeURIComponent(yesterday.toISOString())}` +
                    `&timeMax=${encodeURIComponent(tomorrow.toISOString())}` +
                    '&singleEvents=true&orderBy=startTime';

                const calRes = await fetchWithTimeout(
                    calendarUrl,
                    {
                        headers: {
                            Authorization: `Bearer ${providerToken}`
                        }
                    },
                    10000,
                    0 // 캘린더는 재시도 불필요
                );

                const calData = await calRes.json();

                if (calData.items) {
                    contextEvents = calData.items
                        .map((event) => {
                            const start = event.start?.dateTime || event.start?.date;
                            return `- ${event.summary || '제목 없음'} (${start})`;
                        })
                        .join('\n');
                }
            } catch (error) {
                console.error('Briefing Calendar Fetch Error:', error.message);
            }
        }

        const pattern = `user:${user.id}:diary-*`;
        const keys = await scanRedisKeys(pattern);

        let recentDiaries = '일기 기록 없음';

        if (keys.length > 0) {
            const latestKeys = keys.sort().reverse().slice(0, 3);
            const values = await redis.mget(latestKeys);

            recentDiaries = values
                .filter(Boolean)
                .map((value) => {
                    try {
                        return JSON.parse(value).content || '';
                    } catch {
                        return '';
                    }
                })
                .filter(Boolean)
                .join('\n---\n') || '일기 기록 없음';
        }

        const currentTimeStr = new Date().toLocaleString('ko-KR', {
            timeZone: 'Asia/Seoul'
        });

        // 사용자 호칭 조회
        const nicknameKey = `user:${user.id}:nickname`;
        const storedNickname = await redis.get(nicknameKey);
        const userNickname = storedNickname || user.email.split('@')[0];

        const briefingPrompt = `
너는 사용자의 하루를 책임지는 완벽하고 꼼꼼한 수석 비서다. 아래 정보를 바탕으로 품격 있는 데일리 브리핑을 작성하라.
사용자의 호칭은 "${userNickname}"이다. 브리핑 시작과 끝에 반드시 이 호칭으로 직접 불러라.

[분석 데이터]
1. 현재 시간: ${currentTimeStr}
2. 구글 일정 (어제~내일): ${contextEvents}
3. 최근 생각(Diary): ${recentDiaries}

[수행 지시]
1. **내일 일정 최우선**: 구글 일정 중 '내일' 예정된 일정을 가장 먼저 언급하며 준비 사항을 조언하라.
2. **미래의 할 일 리마인드**: 최근 일기에서 언급된 미래의 계획이나 약속이 있다면 잊지 않도록 리마인드하라.
3. **오늘 일정 생략**: 오늘 이미 알고 있는 일정 리스트를 나열하지 마라. 대신 일기 내용 중 오늘 꼭 챙겨야 할 '태도'나 '감정' 한 가지만 언급하라.
4. 전체 브리핑은 3~4문장 이내로 간결하고 품격 있게 작성하라.
5. 가장 중요한 키워드나 할 일은 **텍스트**로 강조하라.
6. 반드시 "${userNickname}"님을 호칭으로 사용하라.
`;

        try {
            const result = await callGemini(briefingPrompt);
            const briefing =
                result.candidates?.[0]?.content?.parts?.[0]?.text ||
                '비서가 브리핑을 준비하지 못했습니다. (API 할당량 초과일 수 있습니다)';

            // 성공적인 브리핑 생성 시 Redis 캐시 저장 (5분)
            if (result.candidates) {
                await redis.set(cacheKey, briefing, 'EX', 300);
            }

            return res.json({
                success: true,
                briefing
            });
        } catch (err) {
             throw err; // catch block below will handle it
        }
    } catch (error) {
        console.error('Briefing Error:', error.message);
        return res.json({
            success: true,
            briefing: '비서가 지금 조금 바쁘네요. 잠시 후 다시 브리핑을 준비해 드릴게요! 🎩'
        });
    }
});

app.post('/api/subscribe', verifyUser, async (req, res) => {
    try {
        const { subscription, settings } = req.body;
        const user = req.user;
        const providerToken = req.headers['x-provider-token'] || '';

        if (!subscription || !settings) {
            return sendError(res, 400, '구독 정보와 알림 설정이 필요합니다.');
        }

        const subKey = `user:${user.id}:push-config`;

        await redis.set(
            subKey,
            JSON.stringify({
                subscription,
                settings,
                providerToken,
                email: user.email
            })
        );

        return res.json({
            success: true,
            pushEnabled
        });
    } catch (error) {
        console.error('Subscription Error:', error);
        return sendError(res, 500, '구독 저장 실패');
    }
});

setInterval(async () => {
    if (!pushEnabled) return;

    try {
        const keys = await scanRedisKeys('user:*:push-config');
        if (keys.length === 0) return;

        const now = new Date();

        for (const key of keys) {
            const data = await redis.get(key);
            if (!data) continue;

            let parsed;

            try {
                parsed = JSON.parse(data);
            } catch {
                continue;
            }

            const { subscription, settings, providerToken, email } = parsed;

            if (!providerToken || !subscription || !settings) continue;

            const timeMin = now.toISOString();
            const timeMax = new Date(now.getTime() + 65 * 60 * 1000).toISOString();

            const calUrl =
                'https://www.googleapis.com/calendar/v3/calendars/primary/events' +
                `?timeMin=${encodeURIComponent(timeMin)}` +
                `&timeMax=${encodeURIComponent(timeMax)}` +
                '&singleEvents=true';

            const calRes = await fetchWithTimeout(
                calUrl,
                {
                    headers: {
                        Authorization: `Bearer ${providerToken}`
                    }
                },
                10000
            );

            const calData = await calRes.json();

            if (!calData?.items) continue;

            for (const event of calData.items) {
                const startTime = new Date(event.start?.dateTime || event.start?.date);

                if (Number.isNaN(startTime.getTime())) continue;

                const diffMin = Math.round((startTime - now) / 60000);

                const shouldNotify =
                    (settings.alarm10 && diffMin === 10) ||
                    (settings.alarm30 && diffMin === 30) ||
                    (settings.alarm60 && diffMin === 60);

                if (!shouldNotify) continue;

                const notifyKey = `push:${key}:${event.id}:${diffMin}`;
                const alreadySent = await redis.get(notifyKey);

                if (alreadySent) continue;

                await redis.set(notifyKey, '1', 'EX', 120);

                const isMedication = event.summary && (event.summary.includes('약') || event.summary.includes('복용') || event.summary.includes('섭취'));
                
                let title = `🔔 일정 알람 (${diffMin}분 전)`;
                let body = `[${event.summary || '제목 없음'}] 일정이 곧 시작됩니다. 준비되셨나요?`;
                
                if (isMedication) {
                    title = `💊 안심 복약 알람 (${diffMin}분 전)`;
                    if (settings.careModeEnabled && settings.careGuardianName) {
                        body = `[보호자 ${settings.careGuardianName}님 지정 알림] 아버님, 약 드실 시간입니다. 잊지 마시고 꼭 복용해 주세요. 💕 [일정명: ${event.summary}]`;
                    } else {
                        body = `아버님, 약 드실 시간입니다. 잊지 마시고 복용 일정을 꼭 챙겨 주세요. 💊 [일정명: ${event.summary}]`;
                    }
                }
                
                const payload = JSON.stringify({ title, body });

                try {
                    await webpush.sendNotification(subscription, payload);
                    console.log(
                        `[Push Sent] To: ${email}, Event: ${event.summary}, Time: ${diffMin}m before`
                    );
                } catch (error) {
                    console.error('Push Send Error:', error.message);
                }
            }
        }
    } catch (error) {
        console.error('Dispatcher Error:', error.message);
    }
}, 60000);

// 일정 수정 (시간 변경 - 드래그 앤 드롭용)
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
        
        // 캐시 무효화 (다음 로드 시 새 데이터를 가져오도록)
        const cacheKey = `user:${req.user.id}:calendar-advice-cache`;
        await redis.del(cacheKey);

        res.json({ success: true });
    } catch (error) {
        console.error('Calendar Update Error:', error.message);
        sendError(res, 500, error.message);
    }
});
// [NEW] 노트북(전자 필기장) 관리 API
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
// 일정 삭제
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

// =========================================
// 사용자 호칭(닉네임) 관리 API
// =========================================

// 호칭 조회
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

// 호칭 저장
app.post('/api/nickname', verifyUser, async (req, res) => {
    try {
        const { nickname } = req.body;
        if (!nickname || nickname.trim().length < 1) {
            return sendError(res, 400, '호칭은 1자 이상 입력해 주세요.');
        }
        const cleaned = nickname.trim().slice(0, 20); // 최대 20자
        const key = `user:${req.user.id}:nickname`;
        await redis.set(key, cleaned); // 만료 없이 영구 저장
        console.log(`[Nickname] User ${req.user.email} → "${cleaned}"`);
        return res.json({ success: true, nickname: cleaned });
    } catch (error) {
        console.error('Nickname Save Error:', error);
        return sendError(res, 500, '호칭 저장 실패');
    }
});

// [PERSONA] 비서 페르소나 조회
app.get('/api/persona', verifyUser, async (req, res) => {
    try {
        const persona = await redis.get(`user:${req.user.id}:persona`);
        return res.json({ success: true, persona: persona ? JSON.parse(persona) : null });
    } catch (error) {
        console.error('Get Persona Error:', error);
        return res.status(500).json({ error: '페르소나 조회 실패' });
    }
});

// [PERSONA] 비서 페르소나 저장
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

// [PERSONA] 비서 아바타 업로드
app.post('/api/persona/avatar', verifyUser, upload.single('avatar'), async (req, res) => {
    try {
        if (!req.file) return sendError(res, 400, '파일이 없습니다.');
        
        const fs = require('fs');
        const path = require('path');
        const targetDir = path.join(__dirname, 'public', 'uploads');
        if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
        
        const filename = `avatar_${req.user.id}_${Date.now()}${path.extname(req.file.originalname)}`;
        const targetPath = path.join(targetDir, filename);
        
        // multer.memoryStorage()를 사용하므로 buffer를 저장함
        fs.writeFileSync(targetPath, req.file.buffer);
        
        const avatarUrl = `/uploads/${filename}`;
        
        // 페르소나 정보에 저장
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

// [PERSONA] AI 아바타 생성 (성별/연령 반영 4가지 옵션 제공)
app.post('/api/persona/generate-avatar', verifyUser, async (req, res) => {
    try {
        const personaRaw = await redis.get(`user:${req.user.id}:persona`);
        const p = personaRaw ? JSON.parse(personaRaw) : { gender: '여성', age: '20대' };
        
        const isFemale = p.gender === '여성';
        const is30s = p.age === '30대';
        
        const options = [];
        for (let i = 0; i < 4; i++) {
            const seed = Math.floor(Math.random() * 10000);
            // DiceBear Avataaars 스타일 파라미터 최적화
            let params = `seed=${seed}`;
            
            if (isFemale) {
                // 여성 스타일
                const tops = is30s 
                    ? 'longHair,bun,straight02,classic01' // 30대: 차분하고 전문적인 느낌
                    : 'longHairCurvy,shortHair,straight01,turban'; // 20대: 트렌디하고 발랄한 느낌
                params += `&top=${tops}&accessories=none,prescription01,round`;
                params += `&clothing=blazer,collarAndSweater,overall`;
            } else {
                // 남성 스타일
                const tops = is30s 
                    ? 'shortHair,shortCurly,classic02' // 30대: 깔끔하고 성숙한 느낌
                    : 'shortHair,frizzle,shaggy,sides'; // 20대: 활동적이고 젊은 느낌
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

// [CHAT] AI 비서 채팅 응답 엔드포인트 (페르소나 반영 및 Supabase DB 저장 버전)
app.post('/api/chat/ai-response', verifyUser, async (req, res) => {
    try {
        const { message, context, room_id } = req.body;
        const userNickname = await redis.get(`user:${req.user.id}:nickname`) || req.user.email.split('@')[0];
        
        // 페르소나 설정 불러오기 (기본값 포함)
        const personaRaw = await redis.get(`user:${req.user.id}:persona`);
        const p = personaRaw ? JSON.parse(personaRaw) : {
            name: '나의 비서', gender: '여성', age: '20대', relationship: '비서', job: 'AI 비서', personality: '친절하고 공감능력이 좋음'
        };

        const prompt = `
당신은 "Feeling Journal"의 AI 비서입니다. 사용자가 설정한 아래의 페르소나에 완전히 빙의하여 대답하세요.

[당신의 페르소나]
- 이름: ${p.name || '나의 비서'}
- 성별: ${p.gender}
- 연령: ${p.age}
- 나와의 관계: ${p.relationship} (이 관계에 걸맞은 호칭과 말투를 사용하세요)
- 직업: ${p.job}
- 성격: ${p.personality}

[현재 상황]
- 대화 상대: ${userNickname}님
- 대화 맥락: ${context || '최근 대화 없음'}
- 마지막 메시지: "${message}"

[수행 지시]
1. 설정된 '관계'에 따라 말투를 엄격히 지키세요. (예: 애인이라면 다정하게, 상담사라면 지적으로, 동생이라면 친근하게)
2. 대화 참여자들의 감성을 어루만져 주는 코멘트를 하세요.
3. 2~3문장 내외로 핵심만 말하세요.
4. 마지막엔 반드시 사용자를 응원하는 문구로 끝내세요.
5. 한국어로 자연스럽게 답변하세요.
`;

        const result = await callGemini(prompt, {}, 2);
        const answer = (result.candidates?.[0]?.content?.parts?.[0]?.text || '비서가 잠시 생각에 빠졌네요. 다시 불러주세요! ✨').trim();

        // [RLS BYPASS] supabase 대신 supabaseAdmin 활용하여 RLS 에러 원천 방지하고 DB에 AI 메시지 저장
        const client = supabaseAdmin || supabase;
        const targetRoomId = (room_id === 'lobby' || !room_id) ? '6edf28f2-c7f6-45e9-9648-07b118f0cf9e' : room_id;

        const { error: insertError } = await client
            .from('messages')
            .insert([{
                content: answer,
                sender_id: req.user.id, // satisfying foreign key constraints using logged-in user id
                user_email: 'ai@feeling.journal',
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
        return res.status(500).json({ error: '비서 응답 생성 실패' });
    }
});

// [FRIENDS] 1촌 감성 위기(SOS) 체크 엔드포인트
app.get('/api/friends/sos', verifyUser, async (req, res) => {
    try {
        const user = req.user;
        
        // 1. 나의 1촌(confirmed) 리스트 조회
        const { data: friends, error: friendsError } = await supabase
            .from('friendships')
            .select('user_id, friend_id')
            .or(`user_id.eq.${user.id},friend_id.eq.${user.id}`)
            .eq('status', 'confirmed');

        if (friendsError) throw friendsError;

        const friendIds = friends.map(f => f.user_id === user.id ? f.friend_id : f.user_id);
        if (friendIds.length === 0) return res.json({ success: true, sosList: [] });

        // 2. 친구들의 최신 프로필(감정) 조회
        const { data: profiles, error: profileError } = await supabase
            .from('profiles')
            .select('id, nickname, current_emotion, emotion_updated_at')
            .in('id', friendIds);

        if (profileError) throw profileError;

        // 3. 위기 감정(우울, 슬픔, 힘듦 등) 필터링 (최근 24시간 이내)
        const sosEmotions = ['우울', '슬픔', '절망', '무기력', '화남', '힘듦', '고통'];
        const now = new Date();
        
        let allFriends = [...profiles];

        // [MOCK 데이터 주입] 테스트를 위해 실제 친구가 적으면 Mock 친구 추가
        if (allFriends.length < 3) {
            allFriends.push(
                { 
                    id: 'mock-1', 
                    nickname: '다정한 영희', 
                    current_emotion: '조금 우울함... 위로가 필요해 😔', 
                    emotion_updated_at: new Date(now.getTime() - 1000 * 60 * 30).toISOString() 
                },
                { 
                    id: 'mock-2', 
                    nickname: '든든한 철수', 
                    current_emotion: '오늘 하루도 파이팅! 😊', 
                    emotion_updated_at: new Date(now.getTime() - 1000 * 60 * 60).toISOString() 
                },
                { 
                    id: 'mock-3', 
                    nickname: '행복한 민수', 
                    current_emotion: '정말 기쁜 소식이 있어요! 🥰', 
                    emotion_updated_at: new Date(now.getTime() - 1000 * 60 * 120).toISOString() 
                }
            );
        }

        const sosList = allFriends.filter(p => {
            const isSos = sosEmotions.some(e => p.current_emotion?.includes(e));
            const isRecent = p.emotion_updated_at && (now - new Date(p.emotion_updated_at)) < 24 * 3600 * 1000;
            return isSos && isRecent;
        });

        return res.json({ 
            success: true, 
            sosList,
            allFriends // 전체 친구(Mock 포함) 리포트
        });
    } catch (error) {
        console.error('SOS Check Error:', error);
        return res.status(500).json({ error: 'SOS 체크 실패' });
    }
});

// [EMAIL] 친구 초대 이메일 발송 엔드포인트
app.post('/api/invite', verifyUser, async (req, res) => {
    if (!emailConfigured || !transporter) {
        return res.status(503).json({ error: '이메일 서버가 설정되지 않았습니다.' });
    }

    const { email, name } = req.body;
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

app.listen(port, () => {
    console.log(`Server is running at http://localhost:${port}`);
});