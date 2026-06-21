const assert = require('assert');
const path = require('path');

// 1. Mocking Redis and callGemini
let mockRedisStore = {};
const mockRedis = {
    get: async (key) => mockRedisStore[key] || null,
    set: async (key, val, mode, duration) => {
        mockRedisStore[key] = val;
    },
    del: async (key) => {
        delete mockRedisStore[key];
    }
};

let geminiShouldFail = false;
let mockGeminiResponse = {};
const mockCallGemini = async (prompt, options, retries, inlineData, safeSearch) => {
    if (geminiShouldFail) {
        throw new Error('Gemini API Timeout / Quota Exceeded');
    }
    return mockGeminiResponse;
};

// Override clients/redis and clients/gemini before requiring newsService
const geminiClientModule = require('../api/_routes/clients/gemini');
const originalCallGemini = geminiClientModule.callGemini;
geminiClientModule.callGemini = mockCallGemini;

const redisClientModule = require('../api/_routes/clients/redis');
const originalClientRedis = redisClientModule.redis;
redisClientModule.redis = mockRedis;

const newsService = require('../api/_services/newsService');

async function runNewsFilterTests() {
    console.log('=== STARTING NEWS FILTER PIPELINE TESTS ===');
    
    // Reset mock store
    mockRedisStore = {};

    // Sample dirty/overlapping news entries
    const sampleArticles = [
        { title: '인류, 최초로 화성 탐사선 착륙 성공', link: 'https://news.example.com/1' },
        { title: '인류, 최초로 화성 탐사선 착륙 성공', link: 'https://news.example.com/1' }, // Duplicate by URL
        { title: '인류 최초로 화성 탐사선 착륙 성공!', link: 'https://news.example.com/2' }, // Duplicate by Normalized Title
        { title: '[부고] 홍길동 전 의원 모친상', link: 'https://news.example.com/3' }, // Rule-based: Obituary
        { title: '회사 인사발령 알림 (인사)', link: 'https://news.example.com/4' }, // Rule-based: Personnel Change
        { title: '화학노조, 서울 광화문 광장서 총파업 결의대회 진행', link: 'https://news.example.com/5' }, // Mismatch for "science" (AI Filtered)
        { title: '차세대 양자 컴퓨터 상용화 단계 진입', link: 'https://news.example.com/6' } // Safe & Category Match
    ];

    // Setup Gemini Curation Mock Output
    mockGeminiResponse = {
        candidates: [{
            content: {
                parts: [{
                    text: JSON.stringify({
                        curatedHeadlines: [
                            { title: '인류, 최초로 화성 탐사선 착륙 성공', keep: true, categoryMatch: true, careSafe: true, reason: '양호' },
                            { title: '화학노조, 서울 광화문 광장서 총파업 결의대회 진행', keep: false, categoryMatch: false, careSafe: true, reason: '노조 집회 기사로 과학 카테고리에 부적합' },
                            { title: '차세대 양자 컴퓨터 상용화 단계 진입', keep: true, categoryMatch: true, careSafe: true, reason: '양호' }
                        ]
                    })
                }]
            }
        }]
    };

    try {
        // [TEST 1] AI Filter Success path
        console.log('\n[TEST 1] Testing normal path (Rule Filter + Gemini AI Success)...');
        geminiShouldFail = false;
        
        // Mocking RSS fetch using a custom mock axios or overriding the internal fetch
        // We will test the internal helper logic or modify getNewsHeadlines to accept raw test input or fetch mock RSS.
        // For unit testing ease, let's export a pure curation function or execute getNewsHeadlines with mocked axios.
        
        console.log('=> Starting integration check...');
        // We can test actual getNewsHeadlines by stubbing axios inside the test environment
        const axios = require('axios');
        const originalGet = axios.get;
        
        axios.get = async (url) => {
            // Return mock RSS Feed XML
            const xml = `
            <rss version="2.0">
                <channel>
                    <item>
                        <title>인류, 최초로 화성 탐사선 착륙 성공</title>
                        <link>https://news.example.com/1</link>
                    </item>
                    <item>
                        <title>인류, 최초로 화성 탐사선 착륙 성공</title>
                        <link>https://news.example.com/1</link>
                    </item>
                    <item>
                        <title>인류 최초로 화성 탐사선 착륙 성공!</title>
                        <link>https://news.example.com/2</link>
                    </item>
                    <item>
                        <title>[부고] 홍길동 전 의원 모친상</title>
                        <link>https://news.example.com/3</link>
                    </item>
                    <item>
                        <title>회사 인사발령 알림 (인사)</title>
                        <link>https://news.example.com/4</link>
                    </item>
                    <item>
                        <title>화학노조, 서울 광화문 광장서 총파업 결의대회 진행</title>
                        <link>https://news.example.com/5</link>
                    </item>
                    <item>
                        <title>차세대 양자 컴퓨터 상용화 단계 진입</title>
                        <link>https://news.example.com/6</link>
                    </item>
                    <item>
                        <title>[동정] 김철수 대표, IT 서밋 참가</title>
                        <link>https://news.example.com/7</link>
                    </item>
                    <item>
                        <title>[인터뷰] 이영희 교수에게 듣는 AI의 미래</title>
                        <link>https://news.example.com/8</link>
                    </item>
                    <item>
                        <title>[프로필] 홍길동 대표 프로필 정보</title>
                        <link>https://news.example.com/9</link>
                    </item>
                </channel>
            </rss>
            `;
            return { data: xml };
        };

        const result = await newsService.getNewsHeadlines(['science']);
        console.log('Returned headlines:', result);
        
        // Assertions for Curated Output
        assert.ok(result.headlines.some(h => h.includes('양자 컴퓨터')), 'Should contain quantum computer article');
        assert.ok(result.headlines.some(h => h.includes('화성 탐사선')), 'Should contain Mars lander article');
        
        // Deduplication and Curation verification
        assert.strictEqual(result.headlines.length, 2, 'Should only return 2 clean headlines after filtering and dedupe');
        assert.strictEqual(result.aiFiltered, true, 'Should mark aiFiltered as true');
        assert.ok(!result.headlines.some(h => h.includes('부고')), 'Obituary must be filtered');
        assert.ok(!result.headlines.some(h => h.includes('인사')), 'Personnel change must be filtered');
        assert.ok(!result.headlines.some(h => h.includes('동정')), 'People dynamic must be filtered');
        assert.ok(!result.headlines.some(h => h.includes('인터뷰')), 'Interview must be filtered');
        assert.ok(!result.headlines.some(h => h.includes('프로필')), 'Profile must be filtered');
        assert.ok(!result.headlines.some(h => h.includes('화학노조')), 'AI should filter out chemical labor union strike from science');
        
        console.log('=> Normal Curation Path PASSED!');

        // [TEST 2] AI Filter Fail path (Fallback to Rule-based Filter only)
        console.log('\n[TEST 2] Testing Fallback path (Gemini Fail)...');
        geminiShouldFail = true;
        mockRedisStore = {}; // clear cache
        
        const fallbackResult = await newsService.getNewsHeadlines(['science']);
        console.log('Fallback headlines:', fallbackResult);
        
        assert.strictEqual(fallbackResult.aiFiltered, false, 'Should mark aiFiltered as false on fallback');
        // On fallback, obituaries & personnel changes should still be rule-filtered. But labor union and quantum computer will both remain (no AI to filter matching).
        assert.ok(fallbackResult.headlines.some(h => h.includes('화학노조')), 'Should keep labor union article on fallback because AI was bypassed');
        assert.ok(fallbackResult.headlines.some(h => h.includes('양자 컴퓨터')), 'Should keep quantum computer article');
        assert.ok(!fallbackResult.headlines.some(h => h.includes('부고')), 'Obituary should still be filtered by static rules');
        
        console.log('=> Fallback Path PASSED!');

        // Restore axios
        axios.get = originalGet;
        
        console.log('\n=== ALL NEWS FILTER PIPELINE TESTS COMPLETED SUCCESSFULLY! ===');
    } catch (e) {
        console.error('❌ News filter test failed:', e);
        process.exit(1);
    } finally {
        // Restore modules
        geminiClientModule.callGemini = originalCallGemini;
        redisClientModule.redis = originalClientRedis;
    }
}

runNewsFilterTests();
