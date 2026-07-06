'use strict';

const { callGemini, supabase, redis, getGoogleAccessToken } = require('./shared');

const GOOGLE_SYNC_CONCURRENCY = 3;
const STATUS_UPDATE_CONCURRENCY = 5;

// KST 시간 포맷 도우미
function getKstDateTimeString() {
    const kstOffset = 9 * 60 * 60 * 1000;
    const now = new Date();
    const kstDate = new Date(now.getTime() + kstOffset);
    return kstDate.toISOString().replace('T', ' ').substring(0, 19) + ' (KST)';
}

async function mapWithConcurrency(items, limit, mapper) {
    if (!Array.isArray(items) || items.length === 0) return [];

    const results = new Array(items.length);
    const workerCount = Math.max(1, Math.min(limit || 1, items.length));
    let nextIndex = 0;

    const worker = async () => {
        while (true) {
            const currentIndex = nextIndex;
            nextIndex += 1;
            if (currentIndex >= items.length) break;
            results[currentIndex] = await mapper(items[currentIndex], currentIndex);
        }
    };

    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    return results;
}

module.exports = async (req, res) => {
    if (req.method === 'OPTIONS') return res.status(200).end();

    const url = req.url || '';
    let subPath = url.split('?')[0];

    // 라우터 마운트 경로 정규화
    if (subPath.startsWith('/api/ai-tasks')) {
        subPath = subPath.substring('/api/ai-tasks'.length);
    }

    const user = req.user;
    if (!user) {
        return res.status(401).json({ error: 'Unauthorized: Missing user session.' });
    }

    // 1. AI 일정 세분화 제안 라우트
    if (req.method === 'POST' && (subPath === '/suggest' || subPath === '/suggest/')) {
        const { message, history } = req.body || {};
        
        let validHistory = [];
        if (Array.isArray(history)) {
            validHistory = history.map(item => {
                if (!item || typeof item !== 'object') return null;
                const role = item.role === 'user' ? 'user' : 'assistant';
                let content = typeof item.content === 'string' ? item.content.trim() : '';
                if (content.length > 500) content = content.substring(0, 500) + '...';
                if (!content) return null;
                return { role, content };
            }).filter(Boolean).slice(-20); // 최근 20개만 사용
        } else if (message && typeof message === 'string' && message.trim().length > 0) {
            let content = message.trim();
            if (content.length > 500) content = content.substring(0, 500) + '...';
            validHistory.push({ role: 'user', content });
        }

        if (validHistory.length === 0) {
            return res.status(400).json({ error: '요구사항을 텍스트로 입력해 주세요.' });
        }

        const currentTimeStr = getKstDateTimeString();
        
        // 마지막 메시지에서 reschedule taskId 추출
        const lastUserMessage = validHistory.slice().reverse().find(m => m.role === 'user')?.content || '';
        const taskIdMatch = lastUserMessage.match(/\(ID:\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)/i);
        const rescheduleTaskId = taskIdMatch ? taskIdMatch[1] : null;

        let existingTaskContext = "";
        if (rescheduleTaskId) {
            try {
                const { supabaseAdmin } = require('./shared');
                const { data: taskData } = await supabaseAdmin
                    .from('tasks')
                    .select('*')
                    .eq('id', rescheduleTaskId)
                    .eq('user_id', user.id) // Verify ownership
                    .single();
                
                if (taskData) {
                    const { data: subTasksData } = await supabaseAdmin
                        .from('sub_tasks')
                        .select('*')
                        .eq('task_id', rescheduleTaskId)
                        .order('sequence_order', { ascending: true });

                    if (subTasksData && subTasksData.length > 0) {
                        existingTaskContext = `
[기존 대과제 정보]
대과제 ID: ${taskData.id}
대과제 제목: ${taskData.title}
기존 시작일: ${taskData.start_date}
기존 종료일: ${taskData.due_date}

[기존 세부과제 목록]
${subTasksData.map(st => {
    const isCompleted = st.is_completed || (st.progress || 0) >= 100;
    const isEvaluated = (st.rating || 0) > 0 || st.review_text || st.reviewed_at || st.reflection;
    const statusStr = isCompleted ? "완료됨" : (isEvaluated ? "평가됨/진행중" : "미완료");
    return `- 단계 ${st.sequence_order}: ${st.title} (기존 기간: ${st.start_date} ~ ${st.due_date}, 진행도: ${st.progress || 0}%, 평가: ${st.rating || 0}점, 상태: ${statusStr})`;
}).join('\n')}
`;
                    }
                }
            } catch (err) {
                console.warn('[AI Angel] Failed to fetch existing task for reschedule context:', err.message);
            }
        }

        // Gemini Structured JSON Response Schema
        const schema = {
            type: "OBJECT",
            properties: {
                isFinalized: { type: "BOOLEAN", description: "일정 세분화가 완료되어 사용자에게 확정을 요청할 때 true" },
                advice: { type: "STRING", description: "사용자에게 하는 말 (대답, 질문, 제안 설명)" },
                mainTaskTitle: { type: "STRING", description: "대과제 제목 (isFinalized가 true일 때만 필수)" },
                suggestedTasks: {
                    type: "ARRAY",
                    description: "세부 일정 제안 목록 (isFinalized가 true일 때 포함, 아닐 때는 빈 배열)",
                    items: {
                        type: "OBJECT",
                        properties: {
                            sequence: { type: "INTEGER" },
                            title: { type: "STRING" },
                            duration: { type: "INTEGER" }
                        },
                        required: ["sequence", "title", "duration"]
                    }
                }
            },
            required: ["isFinalized", "advice"]
        };

        const conversationStr = validHistory.map(msg => `${msg.role === 'user' ? '사용자' : 'AI'}: ${msg.content}`).join('\n\n');

        let prompt = `너는 사용자의 일정을 지키고 동기부여를 담당하는 품격 있는 AI 일정 가이드 천사(Schedule Angel)다. 👼
사용자와 대화(History)를 나누며 일정을 설계하십시오.

[중요 규칙: isFinalized 설정 조건]
1. 사용자의 요구사항이 모호하거나 일정 생성에 필요한 정보가 부족하다면 'isFinalized'를 false로 유지하고, 'advice'를 통해 구체적인 기간, 세부 단계, 조율하고 싶은 부분을 질문하십시오.
2. 사용자가 명확하게 일정을 등록하겠다고 승인하거나 ("좋아", "저장해줘", "그대로 해줘" 등), 처음부터 완전하고 구체적인 지시("내일 3시에 병원 예약 일정 등록해줘")를 내린 경우에만 'isFinalized'를 true로 설정하고 'suggestedTasks'를 채워 반환하십시오.
3. 'isFinalized'가 false일 경우 'suggestedTasks'는 빈 배열로 반환하십시오.

현재 시각(KST): ${currentTimeStr}

[대화 내역]
${conversationStr}
`;

        if (existingTaskContext) {
            prompt += `
사용자가 기존에 등록했던 아래 대과제의 일정을 변경/재조정(Rescheduling)하려 합니다.
${existingTaskContext}

[일정 재조정 지침]
- 기존 세부 단계명과 순서를 최대한 유지하되, 변경된 일정 정보(수정된 duration 등)를 반영하여 새로운 세부 과제 리스트를 제안하십시오.
- 이미 "완료됨" 또는 "평가됨/진행중" 상태인 단계는 절대로 내용이나 기간을 임의로 변경하거나 순서를 뒤섞지 마십시오. (완료/평가된 단계의 순서와 기존 소요 기간을 변경 없이 그대로 포함시키고, 오직 미완료된 미래 단계들의 기간만 재배정/재조정하십시오.)
`;
        }

        prompt += `
[수행 규칙 및 제약사항]
1. 사용자의 장황한 고민이나 목표를 요약하여 20자 이내의 깔끔하고 명확한 대과제 제목으로 만들어 'mainTaskTitle'에 적어주십시오. (예: "학사 학위 논문 작성", "다이어트 계획")
2. 사용자가 털어놓은 목표에 공감하고 용기를 북돋는 멘트를 'advice'에 2~3문장 이내로 다정하고 정중하게 적어주십시오.
3. 제안하는 세부 과제 리스트('suggestedTasks')는 다음 제한 사항을 철저히 준수하십시오:
   - **suggestedTasks 개수**: 최대 10개 이하로만 생성하십시오.
   - **duration (소요 일수)**: 각 단계마다 반드시 1일 이상 30일 이하의 정수로만 배정하십시오.
   - **title (단계명)**: 단계별 명확한 실천 목표를 담아 최대 120자 이내로 명확하게 작성하십시오. (예: "핵심 참고 논문 3편 상세 분석 및 연구 문제 확정")
   - **sequence (순서)**: 1부터 시작하여 중복 없이 연속적으로 증가하는 정수로 채우십시오 (1, 2, 3, ...).
4. 응답은 반드시 지정된 JSON 규격 스키마를 완벽히 준수하는 순수 JSON 문자열이어야 합니다.`;

        try {
            const generationConfig = {
                response_mime_type: "application/json",
                response_schema: schema
            };

            const data = await callGemini(prompt, generationConfig, 1, null, true, 20000);
            const rawJson = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
            
            let result;
            try {
                result = JSON.parse(rawJson);
            } catch (err) {
                console.error('[AI Angel] JSON parsing failed from Gemini output:', rawJson);
                throw new Error('JSON_PARSE_FAILED');
            }

            // --- 엄격한 스키마 구조 검증 (Schema Validation) ---
            if (typeof result.isFinalized !== 'boolean' || !result.advice) {
                throw new Error('INVALID_STRUCTURE');
            }

            if (!Array.isArray(result.suggestedTasks)) {
                result.suggestedTasks = [];
            }

            if (!result.isFinalized) {
                result.mainTaskTitle = undefined;
                result.suggestedTasks = [];
            }

            const tasks = result.suggestedTasks || [];

            // 1) 개수 검증 (최대 10개)
            let validatedTasks = tasks;
            if (validatedTasks.length > 10) {
                console.warn('[AI Angel] Task count exceeded:', validatedTasks.length);
                validatedTasks = validatedTasks.slice(0, 10);
            }

            // sequence 무조건 1부터 재정렬하여 연속성 보장
            validatedTasks.sort((a, b) => a.sequence - b.sequence);
            validatedTasks.forEach((t, idx) => {
                t.sequence = idx + 1;
            });

            result.suggestedTasks = validatedTasks;

            return res.json({
                success: true,
                isFinalized: result.isFinalized,
                mainTaskTitle: result.mainTaskTitle || undefined,
                advice: result.advice,
                suggestedTasks: result.suggestedTasks,
                rescheduleTaskId: rescheduleTaskId || undefined
            });

        } catch (err) {
            console.error('[AI Angel] suggest API runtime error:', err);
            // 피드백 반영: 명확한 에러 코드 리턴
            return res.status(500).json({
                success: false,
                errorCode: "AI_SUGGESTION_UNAVAILABLE",
                message: "AI 천사가 잠시 일정을 분할하는 데 어려움을 겪고 있습니다. 잠시 후 다시 시도해 주세요."
            });
        }
    }

    // 2. 최종 일정 승인 및 일괄 저장 라우트 (Supabase RPC 트랜잭션 보장 및 재조정 지원)
    if (req.method === 'POST' && (subPath === '/confirm' || subPath === '/confirm/')) {
        const { taskId, parentTitle, startDate, steps, status = 'in-progress', syncGoogle = false } = req.body || {};

        // 1) 필수값 검증 및 길이 유효성
        if (!parentTitle || typeof parentTitle !== 'string' || parentTitle.trim().length === 0) {
            return res.status(400).json({ error: '대과제 제목(parentTitle)은 필수 항목입니다.' });
        }
        if (parentTitle.length > 120) {
            return res.status(400).json({ error: '대과제 제목은 최대 120자 이하이어야 합니다.' });
        }

        if (!Array.isArray(steps) || steps.length === 0) {
            return res.status(400).json({ error: '세부 단계(steps) 목록이 없거나 유효하지 않습니다.' });
        }
        if (steps.length > 10) {
            return res.status(400).json({ error: '세부 단계는 최대 10개까지만 허용됩니다.' });
        }

        // status 값 검증 (enum처럼 허용값 검증)
        if (status !== 'in-progress' && status !== 'completed') {
            return res.status(400).json({ error: '유효하지 않은 status 값입니다. (in-progress, completed만 허용)' });
        }

        // 2) KST 기준 날짜 파싱 및 검증
        let currentKstDate;
        if (startDate && /^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
            currentKstDate = new Date(startDate + 'T00:00:00+09:00');
        } else {
            const kstOffset = 9 * 60 * 60 * 1000;
            const now = new Date();
            currentKstDate = new Date(now.getTime() + kstOffset);
            currentKstDate.setUTCHours(0, 0, 0, 0); // KST 자정 기준
        }

        const formatDateKst = (date) => {
            // date는 KST 시간대로 생성된 것이어야 함
            const y = date.getFullYear();
            const m = String(date.getMonth() + 1).padStart(2, '0');
            const d = String(date.getDate()).padStart(2, '0');
            return `${y}-${m}-${d}`;
        };

        // 3) sequence_order 정렬 및 start_date / due_date 순차 누적 계산
        const sortedSteps = [...steps]
            .map(s => ({
                sequence_order: parseInt(s.sequence || s.sequence_order, 10),
                title: (s.title || '').trim().substring(0, 120),
                // duration_days 컬럼명과 API 응답의 duration 이름을 명확히 매핑
                duration_days: Math.min(Math.max(parseInt(s.duration || s.duration_days, 10) || 1, 1), 30)
            }))
            .sort((a, b) => a.sequence_order - b.sequence_order);

        // 시퀀스 유효성 최종 확인
        const seenSeqs = new Set();
        for (let i = 0; i < sortedSteps.length; i++) {
            const s = sortedSteps[i];
            if (isNaN(s.sequence_order) || s.sequence_order <= 0 || seenSeqs.has(s.sequence_order)) {
                return res.status(400).json({ error: '세부 단계의 순서(sequence) 번호는 1부터 중복 없이 연속되어야 합니다.' });
            }
            seenSeqs.add(s.sequence_order);
            if (!s.title) {
                return res.status(400).json({ error: '각 세부 단계의 제목(title)을 입력해 주세요.' });
            }
        }

        const mappedSubTasks = [];
        let runningDate = new Date(currentKstDate.getTime());

        for (let i = 0; i < sortedSteps.length; i++) {
            const s = sortedSteps[i];
            const stepStart = new Date(runningDate.getTime());
            
            // due_date 계산: start_date + duration - 1일
            const stepDue = new Date(stepStart.getTime());
            stepDue.setDate(stepDue.getDate() + s.duration_days - 1);

            mappedSubTasks.push({
                sequence_order: s.sequence_order,
                title: s.title,
                start_date: formatDateKst(stepStart),
                due_date: formatDateKst(stepDue),
                is_completed: false
            });

            // 다음 단계를 위해 runningDate 갱신: 현재 due_date + 1일
            runningDate = new Date(stepDue.getTime());
            runningDate.setDate(runningDate.getDate() + 1);
        }

        const { supabaseAdmin } = require('./shared');
        if (!supabaseAdmin) {
            return res.status(500).json({ error: 'Supabase admin client not initialized.' });
        }

        try {
            let finalTaskId = taskId;
            let syncTasksList = [];

            if (taskId) {
                // --- UPDATE / RESCHEDULE EXISTING TASK ---
                // 1) Verify user ownership
                const { data: existingTask, error: taskFetchErr } = await supabaseAdmin
                    .from('tasks')
                    .select('*')
                    .eq('id', taskId)
                    .eq('user_id', user.id)
                    .single();

                if (taskFetchErr || !existingTask) {
                    return res.status(403).json({ error: 'Forbidden: You do not own this task.' });
                }

                // 2) Get existing subtasks to check completion or evaluation
                const { data: existingSubTasks } = await supabaseAdmin
                    .from('sub_tasks')
                    .select('*')
                    .eq('task_id', taskId);

                // Preserve if completed (is_completed || progress >= 100) OR evaluated (rating > 0 || review_text || reviewed_at || reflection)
                const isPreserved = (st) => {
                    const isCompleted = st.is_completed || (st.progress || 0) >= 100;
                    const isEvaluated = (st.rating || 0) > 0 || st.review_text || st.reviewed_at || st.reflection;
                    return isCompleted || isEvaluated;
                };

                const preservedSubTasks = (existingSubTasks || []).filter(isPreserved);
                const preservedIds = new Set(preservedSubTasks.map(st => st.id));
                const subTasksToDelete = (existingSubTasks || []).filter(st => !preservedIds.has(st.id));

                // 3) Delete non-preserved subtasks from DB and calendar
                if (subTasksToDelete.length > 0) {
                    if (syncGoogle) {
                        try {
                            const token = await getGoogleAccessToken(user.id);
                            if (token) {
                                const calendarService = require('../_services/calendarService');
                                const deletableGoogleEvents = subTasksToDelete.filter(st => st.google_event_id);
                                await mapWithConcurrency(deletableGoogleEvents, GOOGLE_SYNC_CONCURRENCY, async (st) => {
                                    try {
                                        await calendarService.deleteGoogleCalendarEvent(token, st.google_event_id, user.id);
                                    } catch (googleErr) {
                                        console.warn(`[AI Angel Confirm Reschedule] Google Calendar event deletion failed (id: ${st.google_event_id}):`, googleErr.message);
                                    }
                                });
                            }
                        } catch (tokErr) {
                            console.warn('[AI Angel Confirm Reschedule] Google Calendar token fetch failed:', tokErr.message);
                        }
                    }

                    const { error: delErr } = await supabaseAdmin
                        .from('sub_tasks')
                        .delete()
                        .in('id', subTasksToDelete.map(st => st.id));
                    if (delErr) throw delErr;
                }

                // 4) Insert only the uncompleted, non-preserved steps
                const preservedSequences = new Set(preservedSubTasks.map(st => st.sequence_order));
                
                // 새로운 미완료 단계를 위한 날짜 베이스라인 계산
                let baseDate = new Date(currentKstDate.getTime());
                if (preservedSubTasks.length > 0) {
                    const lastPreserved = preservedSubTasks.sort((a, b) => a.sequence_order - b.sequence_order)[preservedSubTasks.length - 1];
                    if (lastPreserved && lastPreserved.due_date) {
                        baseDate = new Date(lastPreserved.due_date + 'T00:00:00+09:00');
                        baseDate.setDate(baseDate.getDate() + 1); // 보존된 마지막 단계 종료 다음날부터 시작
                    }
                }

                const newStepsToInsert = [];
                let currentInsertDate = new Date(baseDate.getTime());

                // mappedSubTasks는 클라이언트가 올려준 전체 스텝들
                const stepsToProcess = mappedSubTasks.filter(st => !preservedSequences.has(st.sequence_order));
                
                for (let i = 0; i < stepsToProcess.length; i++) {
                    const st = stepsToProcess[i];
                    
                    const stepStart = new Date(currentInsertDate.getTime());
                    
                    // st.duration_days 정보를 역산해야 하나, mappedSubTasks에 duration_days 정보가 이미 날짜로 흩어졌으므로 재산출
                    const origStart = new Date(st.start_date + 'T00:00:00+09:00');
                    const origDue = new Date(st.due_date + 'T00:00:00+09:00');
                    const diffTime = Math.abs(origDue - origStart);
                    const durationDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;

                    const stepDue = new Date(stepStart.getTime());
                    stepDue.setDate(stepDue.getDate() + durationDays - 1);

                    newStepsToInsert.push({
                        task_id: taskId,
                        title: st.title,
                        sequence_order: st.sequence_order,
                        start_date: formatDateKst(stepStart),
                        due_date: formatDateKst(stepDue),
                        is_completed: false
                    });

                    currentInsertDate = new Date(stepDue.getTime());
                    currentInsertDate.setDate(currentInsertDate.getDate() + 1);
                }

                let insertedSubTasks = [];
                if (newStepsToInsert.length > 0) {
                    const { data: insData, error: insErr } = await supabaseAdmin
                        .from('sub_tasks')
                        .insert(newStepsToInsert)
                        .select();
                    if (insErr) throw insErr;
                    insertedSubTasks = insData || [];
                }

                syncTasksList = insertedSubTasks;

                const allSubTasks = [...preservedSubTasks, ...insertedSubTasks].sort((a, b) => a.sequence_order - b.sequence_order);
                const taskStartDateStr = allSubTasks.length > 0 ? allSubTasks[0].start_date : formatDateKst(currentKstDate);
                const taskDueDateStr = allSubTasks.length > 0 ? allSubTasks[allSubTasks.length - 1].due_date : taskStartDateStr;

                // 5) Update parent task details
                const { error: parentUpdateErr } = await supabaseAdmin
                    .from('tasks')
                    .update({
                        title: parentTitle.substring(0, 120),
                        start_date: taskStartDateStr,
                        due_date: taskDueDateStr,
                        status: status
                    })
                    .eq('id', taskId)
                    .eq('user_id', user.id);

                if (parentUpdateErr) throw parentUpdateErr;

            } else {
                // --- CREATE NEW TASK (Transaction with Fallback) ---
                const taskStartDateStr = formatDateKst(currentKstDate);
                const taskDueDateStr = mappedSubTasks.length > 0 ? mappedSubTasks[mappedSubTasks.length - 1].due_date : taskStartDateStr;

                // 1) Insert Parent Task
                const { data: createdTask, error: taskErr } = await supabaseAdmin
                    .from('tasks')
                    .insert({
                        user_id: user.id,
                        title: parentTitle.substring(0, 120),
                        start_date: taskStartDateStr,
                        due_date: taskDueDateStr,
                        source: 'ai_angel',
                        status: status
                    })
                    .select('id').single();

                if (taskErr) {
                    console.error('[AI Angel] Failed to insert parent task:', taskErr);
                    throw taskErr;
                }

                finalTaskId = createdTask.id;

                // 2) Insert Subtasks
                const subTasksToInsert = mappedSubTasks.map(st => ({
                    task_id: finalTaskId,
                    title: st.title,
                    sequence_order: st.sequence_order,
                    start_date: st.start_date,
                    due_date: st.due_date,
                    is_completed: false
                }));

                const { data: createdSubTasks, error: subTaskErr } = await supabaseAdmin
                    .from('sub_tasks')
                    .insert(subTasksToInsert)
                    .select('id, title, sequence_order, due_date');

                if (subTaskErr) {
                    console.error('[AI Angel] Failed to insert subtasks, rolling back task creation:', subTaskErr);
                    // Rollback: delete the created parent task
                    await supabaseAdmin.from('tasks').delete().eq('id', finalTaskId);
                    return res.status(500).json({ error: "세부 일정을 저장하는 데 실패하여 생성된 상위 작업을 정리했습니다." });
                }

                syncTasksList = createdSubTasks || [];
            }

            let googleCalendarSynced = false;
            const syncResults = [];

            if (syncGoogle && syncTasksList.length > 0) {
                try {
                    const token = await getGoogleAccessToken(user.id);
                    if (token) {
                        const { getOrCreateAiAngelCalendar } = require('./clients/google');
                        const calendarId = await getOrCreateAiAngelCalendar(user.id, token);
                        
                        if (calendarId) {
                            googleCalendarSynced = true;
                            const calendarService = require('../_services/calendarService');
                            const syncTaskResults = await mapWithConcurrency(syncTasksList, GOOGLE_SYNC_CONCURRENCY, async (subTask) => {
                                try {
                                    // Calculate end date: due_date + 1 day
                                    const nextDay = new Date(subTask.due_date + 'T00:00:00+09:00');
                                    nextDay.setDate(nextDay.getDate() + 1);
                                    const nextDayStr = nextDay.toISOString().split('T')[0];

                                    const eventData = {
                                        summary: `👼 ${subTask.title} 마감`,
                                        startTime: subTask.due_date,
                                        endTime: nextDayStr,
                                        description: `대과제: ${parentTitle}`
                                    };

                                    const googleEvent = await calendarService.addGoogleCalendarEvent(token, eventData, calendarId, user.id);
                                    if (!googleEvent || !googleEvent.id) {
                                        throw new Error('Google Calendar returned empty event data');
                                    }

                                    const { error: updateErr } = await supabaseAdmin
                                        .from('sub_tasks')
                                        .update({
                                            google_calendar_id: calendarId,
                                            google_event_id: googleEvent.id,
                                            google_sync_status: 'synced'
                                        })
                                        .eq('id', subTask.id);
                                    if (updateErr) throw updateErr;

                                    // Cache event to calendar ID mapping in Redis (if available)
                                    if (redis) {
                                        try {
                                            await redis.set(`user:${user.id}:event-calendar-map:${googleEvent.id}`, calendarId, 'EX', 3600 * 24 * 30);
                                        } catch (redisErr) {
                                            console.warn(`[AI Angel] Redis cache error for event ${googleEvent.id}:`, redisErr.message);
                                        }
                                    }

                                    return {
                                        subTaskId: subTask.id,
                                        title: subTask.title,
                                        status: 'synced',
                                        googleEventId: googleEvent.id
                                    };
                                } catch (eventErr) {
                                    console.error(`[AI Angel] Failed to sync subtask ${subTask.id} to Google Calendar:`, eventErr.message);
                                    const { error: failedStatusErr } = await supabaseAdmin
                                        .from('sub_tasks')
                                        .update({ google_sync_status: 'failed' })
                                        .eq('id', subTask.id);

                                    if (failedStatusErr) {
                                        console.warn(`[AI Angel] Failed to mark google_sync_status=failed for subtask ${subTask.id}:`, failedStatusErr.message);
                                        return {
                                            subTaskId: subTask.id,
                                            title: subTask.title,
                                            status: 'failed',
                                            reason: 'DB_SYNC_STATUS_UPDATE_FAILED'
                                        };
                                    }

                                    return {
                                        subTaskId: subTask.id,
                                        title: subTask.title,
                                        status: 'failed',
                                        reason: eventErr.message
                                    };
                                }
                            });
                            syncResults.push(...syncTaskResults);
                            
                            // Invalidate advice cache (if Redis available)
                            if (redis) {
                                try {
                                    await redis.del(`user:${user.id}:calendar-advice-cache`);
                                } catch (redisErr) {
                                    console.warn(`[AI Angel] Redis cache invalidation error:`, redisErr.message);
                                }
                            }
                        }
                    } else {
                        // Google not connected
                        const tokenMissingResults = await mapWithConcurrency(syncTasksList, STATUS_UPDATE_CONCURRENCY, async (subTask) => {
                            const { error: tokenMissingErr } = await supabaseAdmin
                                .from('sub_tasks')
                                .update({ google_sync_status: 'token_missing' })
                                .eq('id', subTask.id);

                            if (tokenMissingErr) {
                                console.warn(`[AI Angel] Failed to mark google_sync_status=token_missing for subtask ${subTask.id}:`, tokenMissingErr.message);
                                return {
                                    subTaskId: subTask.id,
                                    title: subTask.title,
                                    status: 'failed',
                                    reason: 'DB_SYNC_STATUS_UPDATE_FAILED'
                                };
                            }

                            return {
                                subTaskId: subTask.id,
                                title: subTask.title,
                                status: 'failed',
                                reason: 'GOOGLE_NOT_CONNECTED'
                            };
                        });
                        syncResults.push(...tokenMissingResults);
                    }
                } catch (syncErr) {
                    console.error('[AI Angel] Google Calendar sync pipeline failed:', syncErr.message);
                }
            } else {
                // syncGoogle is false or no new tasks to sync
                for (const subTask of syncTasksList) {
                    syncResults.push({
                        subTaskId: subTask.id,
                        title: subTask.title,
                        status: 'not_requested'
                    });
                }
            }

            if (redis) {
                try {
                    await redis.del(`user:${user.id}:briefing-cache`);
                } catch (redisErr) {
                    console.warn(`[AI Angel] Redis cache deletion error:`, redisErr.message);
                }
            }
            
            return res.json({
                success: true,
                taskId: finalTaskId,
                googleCalendarSynced,
                syncResults
            });

        } catch (dbErr) {
            console.error('[AI Angel] confirm API transaction failed, stack:', dbErr.stack || dbErr);
            return res.status(500).json({
                success: false,
                errorCode: "TRANSACTION_FAILED",
                message: "세부 일정을 데이터베이스에 저장하는 데 실패하여 트랜잭션이 안전하게 롤백되었습니다. 에러: " + dbErr.message
            });
        }
    }

    return res.status(404).json({ error: `Not Found: ${subPath}` });
};
