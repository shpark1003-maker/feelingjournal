'use strict';

const assert = require('assert');
const path = require('path');
const { closeRedisClient } = require('./testUtils');

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

// Mocking Supabase Admin for direct insert/update transaction path
let taskInsertShouldFail = false;
let subTaskInsertShouldFail = false;

const originalGetGoogleAccessToken = shared.getGoogleAccessToken;
shared.getGoogleAccessToken = async () => 'mock-google-token';

const googleClient = require('../api/_routes/clients/google');
const originalGetOrCreateAiAngelCalendar = googleClient.getOrCreateAiAngelCalendar;
googleClient.getOrCreateAiAngelCalendar = async () => 'mock-ai-calendar-id';

const mockSupabaseAdmin = {
    from: (tableName) => {
        let selectData = [];
        let op = 'select';
        let insertPayload = null;
        let lastInsertTable = null;
        if (tableName === 'sub_tasks') {
            selectData = [
                { id: 'mock-subtask-1', title: '주제 선정 및 조사', sequence_order: 1, start_date: '2026-06-20', due_date: '2026-06-24', is_completed: true, progress: 100, task_id: 'mocked-task-uuid-1234', tasks: { user_id: '91fdf57d-a069-4eab-820b-68180886d487', due_date: '2026-06-27' } },
                { id: 'mock-subtask-2', title: '논문 목차 및 구조화', sequence_order: 2, start_date: '2026-06-25', due_date: '2026-06-27', is_completed: false, progress: 0, task_id: 'mocked-task-uuid-1234', tasks: { user_id: '91fdf57d-a069-4eab-820b-68180886d487', due_date: '2026-06-27' } }
            ];
        } else if (tableName === 'tasks') {
            selectData = [
                { id: 'mocked-task-uuid-1234', title: '학사 학위 논문 작성', start_date: '2026-06-20', due_date: '2026-06-27', user_id: '91fdf57d-a069-4eab-820b-68180886d487' }
            ];
        }

        const chain = {
            select: (cols) => {
                if (op !== 'insert') {
                    op = 'select';
                }
                return chain;
            },
            eq: (col, val) => {
                if (col === 'id' && tableName === 'sub_tasks') {
                    selectData = selectData.filter(s => s.id === val);
                } else if (col === 'task_id' && tableName === 'sub_tasks') {
                    selectData = selectData.filter(s => s.task_id === val);
                } else if (col === 'id' && tableName === 'tasks') {
                    selectData = selectData.filter(t => t.id === val);
                } else if (col === 'user_id' && tableName === 'tasks') {
                    selectData = selectData.filter(t => t.user_id === val);
                }
                return chain;
            },
            gt: (col, val) => {
                if (col === 'sequence_order') {
                    selectData = selectData.filter(s => s.sequence_order > val);
                }
                return chain;
            },
            in: (col, val) => chain,
            single: async () => {
                if (op === 'insert' && tableName === 'tasks') {
                    if (taskInsertShouldFail) {
                        return { data: null, error: { message: 'Database Error' } };
                    }
                    return { data: { id: 'mocked-task-uuid-1234' }, error: null };
                }
                return { data: selectData[0] || null, error: null };
            },
            order: (col, opts) => chain,
            delete: () => {
                op = 'delete';
                return chain;
            },
            update: (payload) => {
                op = 'update';
                return chain;
            },
            insert: (payload) => {
                op = 'insert';
                lastInsertTable = tableName;
                insertPayload = payload;
                return chain;
            },
            then: (resolve) => {
                if (op === 'insert' && tableName === 'sub_tasks') {
                    if (subTaskInsertShouldFail) {
                        resolve({ data: null, error: { message: 'Subtask Insert Error' } });
                        return;
                    }

                    const rows = Array.isArray(insertPayload)
                        ? insertPayload.map((row, idx) => ({
                            id: `mock-subtask-new-${idx + 1}`,
                            title: row.title,
                            sequence_order: row.sequence_order,
                            due_date: row.due_date
                        }))
                        : [];
                    resolve({ data: rows, error: null });
                    return;
                }
                resolve({ data: selectData, error: null });
            }
        };
        return chain;
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
                        isFinalized: true,
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


    // [TEST 3] /api/ai-tasks/confirm - KST 순차 날짜 연산 및 DB 저장 경로 검증
    console.log('\n[TEST 3] Testing /confirm endpoint (KST date calculations & direct DB mapping)...');
    taskInsertShouldFail = false;
    subTaskInsertShouldFail = false;
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
    assert.strictEqual(mockRes.body.success, true);
    assert.strictEqual(mockRes.body.taskId, 'mocked-task-uuid-1234');
    assert.strictEqual(Array.isArray(mockRes.body.syncResults), true);
    assert.strictEqual(mockRes.body.syncResults.length, 2);
    assert.strictEqual(mockRes.body.syncResults[0].status, 'not_requested');
    assert.strictEqual(mockRes.body.syncResults[1].status, 'not_requested');
    console.log('=> Confirm Normal Path and date math check PASSED!');


    // [TEST 4] /api/ai-tasks/confirm - DB 저장 실패 트랜잭션 에러 처리 검증
    console.log('\n[TEST 4] Testing /confirm endpoint (Database Transaction Failure Rollback)...');
    taskInsertShouldFail = true;
    mockRes.statusCode = 200;
    mockRes.body = null;

    await aiTasksHandler(reqConfirmNormal, mockRes);
    assert.strictEqual(mockRes.statusCode, 500);
    assert.strictEqual(mockRes.body.success, false);
    assert.strictEqual(mockRes.body.errorCode, 'TRANSACTION_FAILED');
    taskInsertShouldFail = false;
    console.log('=> Transaction failure fallback check PASSED!');

    // [TEST 5] syncGoogle=true
    console.log('\n[TEST 5] Testing /confirm endpoint with syncGoogle=true...');
    taskInsertShouldFail = false;
    mockRes.statusCode = 200;
    mockRes.body = null;
    
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
    
    // [TEST 6] /api/ai-tasks/confirm with taskId (Reschedule Update Scenario)
    console.log('\n[TEST 6] Testing /confirm with taskId (Rescheduling)...');
    mockRes.statusCode = 200;
    mockRes.body = null;

    const reqConfirmReschedule = {
        method: 'POST',
        url: '/api/ai-tasks/confirm',
        user: mockUser,
        body: {
            taskId: "mocked-task-uuid-1234",
            parentTitle: "학사 학위 논문 작성 (수정됨)",
            startDate: "2026-06-20",
            steps: [
                { sequence: 1, title: "주제 선정 및 조사", duration: 5 }, // Completed/preserved in mock
                { sequence: 2, title: "논문 목차 및 구조화 (새 계획)", duration: 4 } // Non-preserved
            ],
            syncGoogle: false
        }
    };

    await aiTasksHandler(reqConfirmReschedule, mockRes);
    assert.strictEqual(mockRes.statusCode, 200);
    assert.strictEqual(mockRes.body.success, true);
    assert.strictEqual(mockRes.body.taskId, "mocked-task-uuid-1234");
    console.log('=> /confirm Reschedule check PASSED!');

    // [TEST 7] /api/calendar PATCH Cascade shift check
    console.log('\n[TEST 7] Testing calendar PATCH cascade shift...');
    const calendarHandler = require('../api/_routes/calendar');
    mockRes.statusCode = 200;
    mockRes.body = null;

    const reqCalendarPatch = {
        method: 'PATCH',
        url: '/api/calendar/events/mock-subtask-2',
        user: mockUser,
        headers: {},
        body: {
            summary: "논문 목차 및 구조화 (새 계획) 마감",
            start: "2026-06-25",
            end: "2026-06-29", // Shifted by +2 days from old due date 2026-06-27
            description: "[Task][Progress: 0][Rating: 0][ReviewDate: ][Reflection: ]"
        },
        params: { id: "mock-subtask-2" }
    };

    await calendarHandler(reqCalendarPatch, mockRes);
    console.log('[DEBUG] calendar PATCH response:', mockRes.body);
    assert.strictEqual(mockRes.statusCode, 200);
    assert.strictEqual(mockRes.body.success, true);
    console.log('=> Calendar PATCH Cascade shift check PASSED!');

    // Restore google token and calendar helper
    shared.getGoogleAccessToken = originalGetGoogleAccessToken;
    googleClient.getOrCreateAiAngelCalendar = originalGetOrCreateAiAngelCalendar;
    calendarService.addGoogleCalendarEvent = originalAddGoogleCalendarEvent;

    // Restore original functions
    shared.callGemini = originalCallGemini;
    shared.supabaseAdmin = originalSupabaseAdmin;

    console.log('\n=== ALL AI SCHEDULE ANGEL INTEGRATION TESTS PASSED! ===');
}

runTests()
    .catch(err => {
        console.error('Test pipeline failed with error:', err);
        process.exitCode = 1;
    })
    .finally(async () => {
        await closeRedisClient(shared.redis);
    });
