const path = require('path');
const dotenv = require('dotenv');

// 1. 환경 변수 초기화 (.env 로드)
dotenv.config({
    path: path.join(__dirname, '../../.env'),
    override: true
});

const { createClient } = require('@supabase/supabase-js');
const Redis = require('ioredis');
const webpush = require('web-push');
const nodemailer = require('nodemailer');

// 2. 핵심 설정 정보 추출
const PORT = process.env.PORT || 3000;
const DEFAULT_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const MODEL_FALLBACKS = ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro'];

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const cleanApiKey = (process.env.GEMINI_API_KEY || '')
    .replace(/["']/g, '')
    .trim();

// 3. 의존성 누락 경고 및 가드
if (!supabaseUrl || !supabaseAnonKey) {
    console.error('Supabase 필수 환경변수가 설정되지 않았습니다.');
}
if (!process.env.REDIS_URL) {
    console.error('REDIS_URL이 설정되지 않았습니다.');
}
if (!cleanApiKey) {
    console.error('GEMINI_API_KEY가 설정되지 않았습니다.');
}

// 4. Web Push 설정
const pushEnabled = !!process.env.VAPID_PUBLIC_KEY && !!process.env.VAPID_PRIVATE_KEY;
if (pushEnabled) {
    webpush.setVapidDetails(
        process.env.VAPID_SUBJECT || process.env.VAPID_EMAIL || 'mailto:shpark1003@gmail.com',
        process.env.VAPID_PUBLIC_KEY,
        process.env.VAPID_PRIVATE_KEY
    );
}

// 5. Nodemailer SMTP Transporter 설정
const rawPass = process.env.EMAIL_PASS || '';
const cleanPass = rawPass.replace(/\s+/g, '').trim();
const emailConfigured = !!process.env.EMAIL_USER && !!cleanPass && cleanPass !== 'your-google-app-password-here';
let transporter = null;
if (emailConfigured) {
    transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.EMAIL_USER,
            pass: cleanPass
        }
    });
}

// 6. DB 및 캐시 인스턴스 싱글톤 초기화
let supabase;
let supabaseAdmin;
let redis;

if (process.env.VERCEL) {
    if (!global.supabaseInstance) {
        global.supabaseInstance = createClient(supabaseUrl, supabaseAnonKey, {
            auth: { persistSession: false },
            realtime: { transport: require('ws') },
            global: {
                fetch: (url, options) => fetchWithTimeout(url, options, 10000, 1)
            }
        });
    }
    supabase = global.supabaseInstance;

    if (supabaseServiceKey) {
        if (!global.supabaseAdminInstance) {
            global.supabaseAdminInstance = createClient(supabaseUrl, supabaseServiceKey, {
                auth: { persistSession: false },
                realtime: { transport: require('ws') },
                global: {
                    fetch: (url, options) => fetchWithTimeout(url, options, 10000, 1)
                }
            });
        }
        supabaseAdmin = global.supabaseAdminInstance;
    } else {
        supabaseAdmin = null;
    }

    if (!global.redisInstance) {
        global.redisInstance = new Redis(process.env.REDIS_URL, {
            connectTimeout: 5000,
            maxRetriesPerRequest: 1
        });
        global.redisInstance.on('error', (err) => {
            console.error('Redis Client Error:', err);
        });
    }
    redis = global.redisInstance;
} else {
    supabase = createClient(supabaseUrl, supabaseAnonKey, {
        auth: { persistSession: false },
        realtime: { transport: require('ws') },
        global: {
            fetch: (url, options) => fetchWithTimeout(url, options, 10000, 1)
        }
    });
    supabaseAdmin = supabaseServiceKey 
        ? createClient(supabaseUrl, supabaseServiceKey, { 
            auth: { persistSession: false },
            realtime: { transport: require('ws') },
            global: {
                fetch: (url, options) => fetchWithTimeout(url, options, 10000, 1)
            }
          })
        : null;
    redis = new Redis(process.env.REDIS_URL, {
        connectTimeout: 5000,
        maxRetriesPerRequest: 1
    });
    redis.on('error', (err) => {
        console.error('Redis Client Error:', err);
    });
}

// 7. Puppeteer 브라우저 인스턴스 재사용 헬퍼 (Browser Pool & Serverless 스위칭)
let sharedBrowser = null;
async function getBrowserInstance() {
    if (!sharedBrowser || !sharedBrowser.connected) {
        console.log('--- [PUPPETEER] Launching new browser instance ---');
        if (process.env.VERCEL) {
            console.log('--- [PUPPETEER] Running on Vercel Serverless ---');
            const chromium = require('@sparticuz/chromium');
            const puppeteerCore = require('puppeteer-core');
            sharedBrowser = await puppeteerCore.launch({
                args: chromium.args,
                defaultViewport: chromium.defaultViewport,
                executablePath: await chromium.executablePath(),
                headless: chromium.headless,
                ignoreHTTPSErrors: true,
            });
        } else {
            console.log('--- [PUPPETEER] Running on Local Environment ---');
            const puppeteer = require('puppeteer');
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
    }
    return sharedBrowser;
}

// 8. SSRF 방지를 위한 URL 안전 검사 (Internal IP 차단)
function isSafeUrl(urlStr) {
    try {
        const url = new URL(urlStr);
        if (!['http:', 'https:'].includes(url.protocol)) return false;
        const hostname = url.hostname.toLowerCase();
        
        const blockedHosts = [
            'localhost', '127.0.0.1', '::1', '0.0.0.0',
            '169.254.169.254', // Cloud Metadata Service
        ];
        if (blockedHosts.includes(hostname)) return false;

        const isInternalIp = /^(10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.)/.test(hostname);
        if (isInternalIp) return false;

        return true;
    } catch (e) {
        return false;
    }
}

// 9. HTTP 에러 유틸리티
const sendError = (res, status, message) => {
    return res.status(status).json({
        success: false,
        error: message
    });
};

// 10. Fetch Timeout 헬퍼 (지수 백오프 및 재시도 통합)
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

                if (options.failFast && delay > 3000) {
                    console.log(`--- [RETRY BYPASS] 429 Detected but retry delay (${delay}ms) is too long for real-time request. Skipping retry. ---`);
                    break;
                }

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

// 11. Gemini API 연동 유틸리티 (폴백 지원)
const getGeminiUrl = (model = DEFAULT_MODEL) => {
    return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${cleanApiKey}`;
};

// 11.5 로컬 데스크톱 LLM (Ollama / LM Studio) 연동용 OpenAI 규격 호출
const callLocalLLM = async (prompt) => {
    const localUrls = [
        process.env.LOCAL_LLM_URL, // e.g. http://localhost:1234/v1/chat/completions (LM Studio)
        'http://localhost:11434/v1/chat/completions', // Ollama OpenAI 규격 기본값
        'http://localhost:1234/v1/chat/completions'   // LM Studio OpenAI 규격 기본값
    ].filter(Boolean);

    for (const url of localUrls) {
        try {
            console.log(`--- [LOCAL LLM] Attempting local model at: ${url}`);
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: process.env.LOCAL_LLM_MODEL || 'local-model',
                    messages: [{ role: 'user', content: prompt }],
                    temperature: 0.7
                })
            });

            if (response.ok) {
                const data = await response.json();
                const text = data.choices?.[0]?.message?.content;
                if (text) {
                    console.log(`--- [LOCAL LLM SUCCESS] Successfully retrieved answer from: ${url}`);
                    // Gemini 규격으로 래핑하여 기존 호출자들의 파싱 에러 방지
                    return {
                        candidates: [{
                            content: {
                                parts: [{ text }]
                            }
                        }]
                    };
                }
            }
        } catch (e) {
            console.warn(`--- [LOCAL LLM WARN] Failed to connect to local model at ${url}: ${e.message}`);
        }
    }
    throw new Error('All Local LLM endpoints failed.');
};

const callGemini = async (prompt, generationConfig = {}, retries = 3, inlineData = null, failFast = false, timeoutMs = 25000, tools = null) => {
    // 1. .env에 USE_LOCAL_LLM=true로 명시되어 있으면 로컬 AI를 우선 사용합니다.
    if (process.env.USE_LOCAL_LLM === 'true') {
        try {
            return await callLocalLLM(prompt);
        } catch (e) {
            console.warn('--- [LOCAL LLM FAILURE] Direct local LLM failed, falling back to Gemini Cloud...');
        }
    }

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

            const requestBody = {
                contents: [{ parts }],
                generationConfig
            };
            if (tools) {
                requestBody.tools = tools;
            }

            const response = await fetchWithTimeout(
                getGeminiUrl(model),
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(requestBody),
                    failFast
                },
                timeoutMs,
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

    // 2. 최종 폴백: 클라우드 Gemini의 쿼타가 소진(429)되었을 때, 로컬에 켜진 Ollama / LM Studio로 자동 연결!
    console.warn('--- [CLOUD GEMINI EXHAUSTED] Triggering Automatic Fallback to Local Desktop LLM...');
    try {
        return await callLocalLLM(prompt);
    } catch (localErr) {
        console.error('--- [CRITICAL] Both Cloud Gemini and Local LLM fallbacks failed.');
    }

    console.error('--- [CRITICAL] All Gemini models failed.');
    throw lastError;
};

// 12. 공통 가공 및 파싱 헬퍼
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
        return [];
    }
};

const extractEventJson = (text) => {
    try {
        if (!text.includes('EVENT_JSON_START') || !text.includes('EVENT_JSON_END')) {
            return null;
        }

        const startIndex = text.indexOf('EVENT_JSON_START') + 'EVENT_JSON_START'.length;
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
        const result = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
        cursor = result[0];
        keys.push(...result[1]);
    } while (String(cursor) !== '0');

    return keys;
};

// 13. 인증 검증 미들웨어
const verifyUser = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return sendError(res, 401, '인증 정보가 필요합니다.');
    }

    const token = authHeader.split(' ')[1];
    try {
        const { data: { user }, error } = await supabase.auth.getUser(token);
        if (error || !user) {
            throw error || new Error('Invalid user');
        }
        req.user = user;
        next();
    } catch (error) {
        return sendError(res, 401, '유효하지 않은 토큰입니다.');
    }
};

const ZONE_MAP = {
    '서울': '1168060000',
    '인천': '2820052500',
    '수원': '4111555000',
    '춘천': '4211054500',
    '대전': '3017055500',
    '청주': '4311151100',
    '광주': '2915551500',
    '전주': '4511153000',
    '대구': '2714055500',
    '부산': '2644053000',
    '울산': '3114056000',
    '제주': '5011059000'
};

async function getLiveWeather(region) {
    const axios = require('axios');
    const cheerio = require('cheerio');
    const zone = ZONE_MAP[region] || ZONE_MAP['서울'];
    const url = `http://www.kma.go.kr/wid/queryDFSRSS.jsp?zone=${zone}`;
    
    try {
        const res = await axios.get(url, { timeout: 5000 });
        const $ = cheerio.load(res.data, { xmlMode: true });
        const dataBlock = $('data').first();
        
        if (!dataBlock.length) return null;
        
        const temp = dataBlock.find('temp').text();
        const wfKor = dataBlock.find('wfKor').text();
        const pop = dataBlock.find('pop').text();
        const pty = dataBlock.find('pty').text();
        
        let ptyStr = '강수 없음';
        if (pty === '1') ptyStr = '비';
        else if (pty === '2') ptyStr = '진눈깨비';
        else if (pty === '3') ptyStr = '눈';
        else if (pty === '4') ptyStr = '소나기';
        
        return {
            region,
            temp: parseFloat(temp),
            sky: wfKor,
            rainProb: parseInt(pop, 10),
            rainType: ptyStr
        };
    } catch (e) {
        console.error(`--- [WEATHER CRAWL ERROR] Region: ${region}, Error: ${e.message} ---`);
        return null;
    }
}

async function getEconomicHeadlines() {
    const axios = require('axios');
    const cheerio = require('cheerio');
    const url = 'https://news.naver.com/rss/section/101';
    
    try {
        const res = await axios.get(url, { timeout: 5000 });
        const $ = cheerio.load(res.data, { xmlMode: true });
        const headlines = [];
        
        $('item').slice(0, 3).each((i, el) => {
            const title = $(el).find('title').text().trim();
            if (title) headlines.push(title);
        });
        
        return headlines;
    } catch (e) {
        console.error(`--- [NEWS CRAWL ERROR] Error: ${e.message} ---`);
        return [];
    }
}

const crypto = require('crypto');

function encrypt(text, masterKey) {
    if (!text) return text;
    if (!masterKey) return text;
    try {
        const key = crypto.createHash('sha256').update(masterKey).digest();
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
        let encrypted = cipher.update(text, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        return `e2e:${iv.toString('hex')}:${encrypted}`;
    } catch (e) {
        console.error('Encryption Error:', e.message);
        return text;
    }
}

function decrypt(encryptedText, masterKey) {
    if (!encryptedText) return encryptedText;
    if (!encryptedText.startsWith('e2e:')) return encryptedText;
    if (!masterKey) return '[Encrypted Document - Please Enter Password]';
    try {
        const parts = encryptedText.split(':');
        const iv = Buffer.from(parts[1], 'hex');
        const encrypted = parts[2];
        const key = crypto.createHash('sha256').update(masterKey).digest();
        const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
        let decrypted = decipher.update(encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    } catch (e) {
        console.error('Decryption Error:', e.message);
        return '[Decryption Failed - Invalid Password]';
    }
}

module.exports = {
    PORT,
    DEFAULT_MODEL,
    MODEL_FALLBACKS,
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
    getLiveWeather,
    getEconomicHeadlines,
    encrypt,
    decrypt
};
