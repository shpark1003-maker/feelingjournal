const assert = require('assert');
const fs = require('fs');
const path = require('path');

// Mock shared modules before importing routes
const shared = require('../api/_routes/shared');
let geminiCallCount = 0;
const originalCallGemini = shared.callGemini;

// Override callGemini to count calls
shared.callGemini = async function(prompt, options, retries, inlineData, safeSearch) {
    geminiCallCount++;
    return {
        candidates: [{
            content: {
                parts: [{
                    text: "감정:[기쁨]\n일정 제안 없음"
                }]
            }
        }]
    };
};

const analyzeHandler = require('../api/_routes/analyze');

async function runTests() {
    console.log('--- STARTING AUTOMATED UNIT TESTS ---');

    // 1. Test Client-Side localEmotionAnalyzer scoring
    console.log('\n[TEST 1] Testing client-side localEmotionAnalyzer...');
    const localEmotionAnalyzerPath = path.join(__dirname, '../public/modules/localEmotionAnalyzer.js');
    const localAnalyzerContent = fs.readFileSync(localEmotionAnalyzerPath, 'utf8')
        .replace(/export /g, ''); // strip export keywords to eval in CommonJS
    
    // Evaluate in current scope to get analyzeEmotionLocally function
    const localEval = new Function(localAnalyzerContent + '\nreturn { analyzeEmotionLocally };')();
    const { analyzeEmotionLocally } = localEval;

    // Test cases for keyword matching
    assert.strictEqual(analyzeEmotionLocally("오늘 하루 너무 행복하고 기분 좋아!"), "기쁨");
    assert.strictEqual(analyzeEmotionLocally("너무 슬퍼서 눈물 나고 힘들어..."), "슬픔");
    assert.strictEqual(analyzeEmotionLocally("진짜 짜증나고 화가 난다 스트레스 쌓여"), "분노");
    assert.strictEqual(analyzeEmotionLocally("불안하고 걱정되고 긴장된다"), "불안");
    assert.strictEqual(analyzeEmotionLocally("평이한 하루를 보냈다. 밥 먹고 공부했다."), "평온");
    // Dominant emotion matching tie/weight test
    assert.strictEqual(analyzeEmotionLocally("행복하고 좋아 (기쁨 2) 그런데 한편으론 걱정(불안 1)"), "기쁨"); 
    assert.strictEqual(analyzeEmotionLocally("슬프고 우울(슬픔 2) 짜증(분노 1)"), "슬픔");
    console.log('=> Client-side localEmotionAnalyzer tests PASSED!');

    // 2. Mock Request / Response for Backend Router tests
    console.log('\n[TEST 2] Testing backend Router (aiConsent = false)...');
    
    const mockUser = { id: 'test-user-id', email: 'test@example.com' };
    
    // Stub Supabase User check on request
    const originalGetUser = shared.supabase.auth.getUser;
    shared.supabase.auth.getUser = async () => ({ data: { user: mockUser }, error: null });

    const mockRes = {
        statusCode: 200,
        headers: {},
        body: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(obj) {
            this.body = obj;
            return this;
        }
    };

    // Case 2a: Consent = false (Gemini count must remain 0)
    geminiCallCount = 0;
    const reqFalse = {
        method: 'POST',
        headers: { authorization: 'Bearer mock-token' },
        body: {
            content: "오늘 너무 신나는 날!",
            richContent: "<p>오늘 너무 신나는 날!</p>",
            title: "테스트 일기",
            notebookId: "nb-1",
            aiConsent: false,
            emotion: "기쁨"
        }
    };

    await analyzeHandler(reqFalse, mockRes);
    assert.strictEqual(mockRes.statusCode, 200);
    assert.strictEqual(geminiCallCount, 0, "Gemini should NOT be called when aiConsent is false");
    assert.strictEqual(mockRes.body.success, true);
    assert.strictEqual(mockRes.body.emotion, "기쁨");
    assert.ok(mockRes.body.answer.includes("AI 분석 동의가 비활성화되어"));
    console.log('=> Gemini bypass and callCount=0 test PASSED!');

    // Case 2b: Emotion Enum validation check (Invalid emotion fallback to 평온)
    const reqInvalidEmotion = {
        method: 'POST',
        headers: { authorization: 'Bearer mock-token' },
        body: {
            content: "오늘 너무 화가 나!",
            richContent: "<p>오늘 너무 화가 나!</p>",
            title: "테스트 일기 2",
            notebookId: "nb-1",
            aiConsent: false,
            emotion: "해킹된상태" // Invalid emotion
        }
    };

    await analyzeHandler(reqInvalidEmotion, mockRes);
    assert.strictEqual(mockRes.body.emotion, "평온", "Invalid emotion should fallback to '평온'");
    console.log('=> Emotion Enum validation test PASSED!');

    // Case 2c: Consent = true (Gemini count must be 1)
    geminiCallCount = 0;
    const reqTrue = {
        method: 'POST',
        headers: { authorization: 'Bearer mock-token' },
        body: {
            content: "오늘 너무 행복해!",
            richContent: "<p>오늘 너무 행복해!</p>",
            title: "테스트 일기 3",
            notebookId: "nb-1",
            aiConsent: true
        }
    };

    await analyzeHandler(reqTrue, mockRes);
    assert.strictEqual(geminiCallCount, 1, "Gemini should be called when aiConsent is true");
    console.log('=> Gemini normal path test PASSED!');

    // Restore original functions
    shared.callGemini = originalCallGemini;
    shared.supabase.auth.getUser = originalGetUser;

    console.log('\n--- ALL UNIT TESTS COMPLETED SUCCESSFULLY! ---');
}

runTests().catch(err => {
    console.error('Test failed with error:', err);
    process.exit(1);
});
