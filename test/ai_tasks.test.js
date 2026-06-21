'use strict';

const assert = require('assert');
const path = require('path');

// 1. Mocking callGemini
let geminiCallCount = 0;
let geminiShouldFail = false;
let mockGeminiResponse = {};

const shared = require('../api/_routes/shared');
const originalCallGemini = shared.callGemini;
const originalSupabaseAdmin = shared.supabaseAdmin;

// Override callGemini
shared.callGemini = async function(prompt, options, retries, inlineData, safeSearch) {
    geminiCallCount++;
    if (geminiShouldFail) {
        throw new Error('Gemini API Error');
    }
    return mockGeminiResponse;
};

// Mocking Supabase Admin for RPC Transaction
let rpcCallCount = 0;
let rpcShouldFail = false;
let mockRpcPayload = {};

const mockSupabaseAdmin = {
    rpc: async (fnName, params) => {
        rpcCallCount++;
        mockRpcPayload = { fnName, params };
        if (rpcShouldFail) {
            return { data: null, error: { message: 'Database Error' } };
        }
        return { data: 'mocked-task-uuid-1234', error: null };
    },
    from: (tableName) => {
        return {
            select: (cols) => {
                return {
                    eq: (col, val) => {
                        return {
                            data: [
                                { id: 'mock-subtask-1', title: '주제 선정 및 조사', sequence_order: 1, due_date: '2026-06-24' },
                                { id: 'mock-subtask-2', title: '논문 목차 및 구조화', sequence_order: 2, due_date: '2026-06-27' }
                            ],
                            error: null
                        };
                    }
                };
            },
            update: (payload) => {
                return {
                    eq: (col, val) => {
                        return {
                            data: [],
                            error: null
                        };
                    }
                };
            }
        };
    }
};
shared.supabaseAdmin = mockSupabaseAdmin;

const aiTasksHandler = require('../api/_routes/ai-tasks');

async function runTests() {
    console.log('=== STARTING AI SCHEDULE ANGEL PIPELINE TESTS ===');

    const mockUser = { id: '91fdf57d-a069-4eab-820b-68180886d487', email: 'test@example.com' };

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

    // [TEST 1] /api/ai-tasks/suggest - 정상 작동 케이스 검증
    console.log('\n[TEST 1] Testing /suggest endpoint (Normal Path)...');
    geminiCallCount = 0;
    geminiShouldFail = false;
    mockGeminiResponse = {
        candidates: [{
            content: {
                parts: [{
                    text: JSON.stringify({
                        advice: "천사가 추천하는 세부 일정입니다. 👼",
                        suggestedTasks: [
                            { sequence: 1, title: "1단계 실천 과제", duration: 5 },
                            { sequence: 2, title: "2단계 실천 과제", duration: 3 }
                        ]
                    })
                }]
            }
        }]
    };

    const reqSuggestNormal = {
        method: 'POST',
        url: '/api/ai-tasks/suggest',
        user: mockUser,
        body: { message: "프로젝트 기획을 하려는데 막막해요." }
    };

    await aiTasksHandler(reqSuggestNormal, mockRes);
    assert.strictEqual(mockRes.statusCode, 200);
    assert.strictEqual(geminiCallCount, 1);
    assert.strictEqual(mockRes.body.success, true);
    assert.strictEqual(mockRes.body.suggestedTasks.length, 2);
    assert.strictEqual(mockRes.body.suggestedTasks[0].title, "1단계 실천 과제");
    assert.strictEqual(mockRes.body.suggestedTasks[0].duration, 5);
    console.log('=> Suggest normal path check PASSED!');


    // [TEST 2] /api/ai-tasks/suggest - Gemini 에러 시 Fallback 검증
    console.log('\n[TEST 2] Testing /suggest endpoint (Gemini Failure Fallback)...');
    geminiShouldFail = true;

    const reqSuggestFail = {
        method: 'POST',
        url: '/api/ai-tasks/suggest',
        user: mockUser,
        body: { message: "에러를 유발해 주세요." }
    };

    await aiTasksHandler(reqSuggestFail, mockRes);
    assert.strictEqual(mockRes.statusCode, 500);
    assert.strictEqual(mockRes.body.success, false);
    assert.strictEqual(mockRes.body.errorCode, 'AI_SUGGESTION_UNAVAILABLE');
    assert.ok(mockRes.body.message.includes('어려움을 겪고 있습니다'));
    console.log('=> Suggest failure fallback check PASSED!');


    // [TEST 3] /api/ai-tasks/confirm - KST 순차 날짜 연산 및 DB RPC 연동 검증
    console.log('\n[TEST 3] Testing /confirm endpoint (KST date calculations & RPC mapping)...');
    rpcCallCount = 0;
    rpcShouldFail = false;
    mockRes.statusCode = 200;
    mockRes.body = null;

    const reqConfirmNormal = {
        method: 'POST',
        url: '/api/ai-tasks/confirm',
        user: mockUser,
        body: {
            parentTitle: "학사 학위 논문 작성",
            startDate: "2026-06-20",
            steps: [
                { sequence: 1, title: "주제 선정 및 조사", duration: 5 },
                { sequence: 2, title: "논문 목차 및 구조화", duration: 3 }
            ]
        }
    };

    await aiTasksHandler(reqConfirmNormal, mockRes);
    console.log('[DEBUG] confirm response body:', mockRes.body);
    assert.strictEqual(mockRes.statusCode, 200);
    assert.strictEqual(rpcCallCount, 1);
    assert.strictEqual(mockRes.body.success, true);
    assert.strictEqual(mockRes.body.taskId, 'mocked-task-uuid-1234');

    // RPC 호출 데이터 검증
    const rpcParams = mockRpcPayload.params;
    assert.strictEqual(rpcParams.task_user_id, mockUser.id);
    assert.strictEqual(rpcParams.task_title, "학사 학위 논문 작성");
    assert.strictEqual(rpcParams.task_start_date, "2026-06-20");
    assert.strictEqual(rpcParams.task_due_date, "2026-06-27"); // 6/20 + 5일 - 1 = 6/24(1단계), 6/25 + 3일 - 1 = 6/27(2단계)
    assert.strictEqual(rpcParams.task_source, "ai_angel");
    assert.strictEqual(rpcParams.task_status, "in-progress");

    const parsedSubTasks = rpcParams.sub_tasks_list;
    assert.strictEqual(parsedSubTasks.length, 2);
    assert.strictEqual(parsedSubTasks[0].start_date, "2026-06-20");
    assert.strictEqual(parsedSubTasks[0].due_date, "2026-06-24");
    assert.strictEqual(parsedSubTasks[1].start_date, "2026-06-25");
    assert.strictEqual(parsedSubTasks[1].due_date, "2026-06-27");
    console.log('=> Confirm Normal Path and date math check PASSED!');


    // [TEST 4] /api/ai-tasks/confirm - DB RPC 실패 트랜잭션 롤백 에러 처리 검증
    console.log('\n[TEST 4] Testing /confirm endpoint (Database Transaction Failure Rollback)...');
    rpcShouldFail = true;
    mockRes.statusCode = 200;
    mockRes.body = null;

    await aiTasksHandler(reqConfirmNormal, mockRes);
    assert.strictEqual(mockRes.statusCode, 500);
    assert.strictEqual(mockRes.body.success, false);
    assert.strictEqual(mockRes.body.errorCode, 'TRANSACTION_FAILED');
    console.log('=> Transaction failure fallback check PASSED!');

    // [TEST 5] syncGoogle=true
    console.log('\n[TEST 5] Testing /confirm endpoint with syncGoogle=true...');
    rpcShouldFail = false;
    mockRes.statusCode = 200;
    mockRes.body = null;
    
    // Mock getGoogleAccessToken
    const originalGetGoogleAccessToken = shared.getGoogleAccessToken;
    shared.getGoogleAccessToken = async () => 'mock-google-token';
    
    // Mock calendarService.addGoogleCalendarEvent
    const calendarService = require('../api/_services/calendarService');
    const originalAddGoogleCalendarEvent = calendarService.addGoogleCalendarEvent;
    let addEventCount = 0;
    calendarService.addGoogleCalendarEvent = async (token, eventData, calendarId) => {
        addEventCount++;
        return { id: `mock-google-event-${addEventCount}` };
    };

    const reqConfirmSync = {
        method: 'POST',
        url: '/api/ai-tasks/confirm',
        user: mockUser,
        body: {
            parentTitle: "학사 학위 논문 작성",
            startDate: "2026-06-20",
            steps: [
                { sequence: 1, title: "주제 선정 및 조사", duration: 5 },
                { sequence: 2, title: "논문 목차 및 구조화", duration: 3 }
            ],
            syncGoogle: true
        }
    };

    await aiTasksHandler(reqConfirmSync, mockRes);
    assert.strictEqual(mockRes.statusCode, 200);
    assert.strictEqual(mockRes.body.success, true);
    assert.strictEqual(mockRes.body.googleCalendarSynced, true);
    assert.strictEqual(addEventCount, 2); // 2 events added
    console.log('=> syncGoogle=true check PASSED!');
    
    // Restore google token and calendar helper
    shared.getGoogleAccessToken = originalGetGoogleAccessToken;
    calendarService.addGoogleCalendarEvent = originalAddGoogleCalendarEvent;

    // Restore original functions
    shared.callGemini = originalCallGemini;
    shared.supabaseAdmin = originalSupabaseAdmin;

    console.log('\n=== ALL AI SCHEDULE ANGEL INTEGRATION TESTS PASSED! ===');
}

runTests().catch(err => {
    console.error('Test pipeline failed with error:', err);
    process.exit(1);
});
