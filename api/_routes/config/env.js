const path = require('path');
const dotenv = require('dotenv');

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// 1. 환경 변수 초기화 (.env 로드)
dotenv.config({
    path: path.join(__dirname, '../../../.env'), // Note: this file is inside api/_routes/config/ so it needs to go up 3 levels to reach root
    override: true
});

// 2. 핵심 설정 정보 추출
const PORT = process.env.PORT || 3000;
const DEFAULT_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const MODEL_FALLBACKS = ['gemini-flash-latest', 'gemini-3.1-flash-lite', 'gemini-2.5-flash', 'gemini-2.0-flash'];

const supabaseUrl = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '')
    .replace(/["']/g, '')
    .trim();
const supabaseAnonKey = (process.env.SUPABASE_ANON_KEY || '')
    .replace(/["']/g, '')
    .trim();
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '')
    .replace(/["']/g, '')
    .trim();

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

module.exports = {
    PORT,
    DEFAULT_MODEL,
    MODEL_FALLBACKS,
    supabaseUrl,
    supabaseAnonKey,
    supabaseServiceKey,
    cleanApiKey
};
