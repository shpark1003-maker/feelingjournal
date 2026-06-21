const path = require('path');

// 1. 공통 설정 정보 로드
const {
    PORT,
    DEFAULT_MODEL,
    MODEL_FALLBACKS,
    supabaseUrl,
    supabaseAnonKey,
    supabaseServiceKey,
    cleanApiKey
} = require('./config/env');

// 2. 개별 클라이언트 로드
const { supabase, supabaseAdmin } = require('./clients/supabase');
const { redis, scanRedisKeys } = require('./clients/redis');
const { emailConfigured, transporter } = require('./clients/mail');
const { pushEnabled, webpush } = require('./clients/push');
const { getGeminiUrl, callGemini } = require('./clients/gemini');
const { refreshGoogleAccessToken, getGoogleAccessToken, fetchGoogleCalendarEvents, clearGoogleCalendarCache } = require('./clients/google');

const { sanitizeContent, safeParseJsonArray, extractEventJson } = require('./utils/pureUtils');
const { isSafeUrl, sendError } = require('./utils/httpUtils');
const { fetchWithTimeout } = require('./utils/fetchUtils');

const { verifyUser } = require('./middleware/auth');

// 7. Puppeteer 브라우저 인스턴스 재사용 헬퍼 (Lazy Load 모듈 분리 및 re-export)
const { getBrowserInstance } = require('./clients/puppeteer');

// Gemini API 연동 로직은 clients/gemini.js 모듈로 분리됨

// scanRedisKeys는 clients/redis.js 모듈로 분리됨

// verifyUser 미들웨어는 middleware/auth.js 모듈로 분리됨

// 날씨 조회 및 뉴스 크롤링 로직 분리 및 re-export
const { getLiveWeather, ZONE_MAP } = require('../_services/weatherService');
const { getNewsHeadlines } = require('../_services/newsService');

const { encrypt, decrypt } = require('./utils/cryptoUtils');

// Google OAuth 토큰 갱신 및 조회, 캘린더 조회 기능은 clients/google.js 모듈로 분리됨

// Mock bypass for local Puppeteer testing
if (supabase && supabase.auth) {
    const originalGetUser = supabase.auth.getUser.bind(supabase.auth);
    supabase.auth.getUser = async (token) => {
        if (token === 'mock-session-token') {
            return { data: { user: { id: '91fdf57d-a069-4eab-820b-68180886d487', email: 'test@example.com' } }, error: null };
        }
        return originalGetUser(token);
    };
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
    getNewsHeadlines,
    encrypt,
    decrypt,
    refreshGoogleAccessToken,
    getGoogleAccessToken,
    fetchGoogleCalendarEvents,
    clearGoogleCalendarCache
};

