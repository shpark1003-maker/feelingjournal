const { 
    supabase, 
    redis, 
    callGemini, 
    scanRedisKeys,
    getLiveWeather,
    supabaseAdmin,
    fetchGoogleCalendarEvents,
    getKstDateKey
} = require('../_routes/shared');

const crypto = require('crypto');

function looksTruncatedBriefing(text, finishReason) {
    const trimmed = (text || '').trim();
    if (!trimmed) return true;
    if (finishReason === 'MAX_TOKENS') return true;

    // If required closing section exists, treat as complete.
    if (/제목\s*:\s*오늘 가장 먼저 해야 할 일|오늘 가장 먼저 해야 할 일/i.test(trimmed)) {
        return false;
    }

    // Abrupt terminal tokens often indicate cut-off generation.
    if (/[,:;\-]\s*$/.test(trimmed)) return true;

    // Long output without sentence-ending punctuation is likely incomplete.
    if (trimmed.length >= 220 && !/[.!?…]\s*$/.test(trimmed)) return true;

    return false;
}

async function completeTruncatedBriefing(originalText) {
    const continuationPrompt = `아래 데일리 브리핑 문장이 중간에 끊겼습니다. 기존 톤과 내용을 유지하여 자연스럽게 이어서 완성하세요.

규칙:
1) 기존 문장을 반복하지 말고 이어서 작성
2) 4~7문장 내에서 간결하게 마무리
3) 마지막에는 반드시 다음 형식을 포함
제목: 오늘 가장 먼저 해야 할 일
내용: [가장 중요한 과제나 일정 1가지]

[끊긴 브리핑 원문]
${originalText}`;

    try {
        const continuationData = await callGemini(continuationPrompt, { maxOutputTokens: 1024 }, 1, null, true);
        const continuationParts = continuationData?.candidates?.[0]?.content?.parts || [];
        const continuation = continuationParts.map(p => p.text || '').join('').trim();
        if (!continuation) return originalText;

        const normalizedOriginal = (originalText || '').trim();
        const normalizedContinuation = continuation.replace(/^\s*[\-–—]*\s*/, '');
        return `${normalizedOriginal}\n${normalizedContinuation}`.trim();
    } catch (e) {
        console.warn('--- [BRIEFING COMPLETION GUARD] Continuation failed, using original text:', e.message);
        return originalText;
    }
}

function stableStringify(obj) {
    if (Array.isArray(obj)) return `[${obj.map(stableStringify).sort().join(',')}]`;
    if (obj !== null && typeof obj === 'object') {
        return `{${Object.keys(obj).sort().map(k => `"${k}":${stableStringify(obj[k])}`).join(',')}}`;
    }
    return JSON.stringify(obj);
}

async function generateBriefing(userId, providerToken, regionOverride, clientDiaries = [], consent = false, userEmail = '', forceRefresh = false, skipIfUnchanged = false, forceRefreshCalendar = false, options = {}) {
    const { skipCacheSave = false } = options;

    const dateStr = getKstDateKey();
    const lockKey = `user:${userId}:briefing-prebuild-lock`;
    if (skipIfUnchanged) {
        const isLocked = await redis.set(lockKey, 'LOCKED', 'NX', 'EX', 120);
        if (!isLocked) {
            console.log(`--- [PRE-GEN] Locked for ${userId}, skipping ---`);
            return;
        }
    }

    try {
        const cacheKey = `user:${userId}:briefing:${dateStr}`;
        const legacyKey = `user:${userId}:briefing-cache`;
        
        if (clientDiaries.length === 0) {
            let cachedData = null;
            try {
                const cached = await redis.get(cacheKey);
                if (cached) {
                    cachedData = JSON.parse(cached);
                }
            } catch (e) {}

            // Legacy Migration
            if (!cachedData) {
                try {
                    const legacyStr = await redis.get(legacyKey);
                    if (legacyStr && legacyStr !== 'GENERATING') {
                        const legacyData = JSON.parse(legacyStr);
                        if (legacyData && legacyData.briefing && legacyData.briefing !== 'GENERATING') {
                            const isToday = legacyData.briefingDate === dateStr || 
                                (legacyData.updatedAtMs && getKstDateKey(legacyData.updatedAtMs) === dateStr) ||
                                (legacyData.updatedAt && getKstDateKey(legacyData.updatedAt) === dateStr);
                            
                            if (isToday) {
                                cachedData = {
                                    schemaVersion: 2,
                                    briefingDate: dateStr,
                                    briefing: legacyData.briefing,
                                    updatedAtMs: Date.now(),
                                    dataHash: legacyData.dataHash || 'legacy',
                                    source: 'legacy-migrated',
                                    weather: legacyData.weather || null
                                };
                                await redis.set(cacheKey, JSON.stringify(cachedData), 'EX', 129600);
                            }
                        }
                    }
                } catch (e) {}
            }

            if (cachedData && cachedData.briefing && !forceRefresh) {
                // Return cached data with stale status if requested by frontend GET
                const revisionKey = `user:${userId}:briefing-revision:${dateStr}`;
                const isDirty = await redis.exists(revisionKey);
                if (isDirty) {
                    cachedData.fromCache = true;
                    cachedData.isStale = true;
                    
                    // checking if anyone holds the build lock
                    const buildLock = await redis.get(`user:${userId}:briefing-build-lock:${dateStr}`);
                    if (buildLock) {
                        cachedData.refreshStatus = 'in_progress';
                    } else {
                        cachedData.refreshStatus = 'not_started';
                    }
                }
                console.log('--- [CACHE] Returning cached briefing ---');
                return cachedData;
            }
        }
    } catch (error) {
        console.error('Briefing Cache Error:', error.message);
    }

    const nowKST = new Date();
    const todayKSTStr = new Date(nowKST.getTime() + 9 * 60 * 60 * 1000).toISOString().split('T')[0];
    
    const yesterdayKST = new Date(nowKST.getTime() + 9 * 60 * 60 * 1000);
    yesterdayKST.setDate(yesterdayKST.getDate() - 1);
    yesterdayKST.setUTCHours(0, 0, 0, 0);
    const yesterday = new Date(yesterdayKST.getTime() - 9 * 60 * 60 * 1000);

    const tomorrowKST = new Date(nowKST.getTime() + 9 * 60 * 60 * 1000);
    tomorrowKST.setDate(tomorrowKST.getDate() + 1);
    tomorrowKST.setUTCHours(23, 59, 59, 999);
    const tomorrow = new Date(tomorrowKST.getTime() - 9 * 60 * 60 * 1000);

    const currentTimeStr = nowKST.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
    const nicknameKey = `user:${userId}:nickname`;

    const contextEventsPromise = (async () => {
        try {
            if (forceRefreshCalendar) {
                try {
                    const calendarSyncService = require('./calendarSyncService');
                    await calendarSyncService.syncGoogleCalendarToLocal(userId, { primaryOnly: false });
                } catch (syncErr) {
                    console.warn('[Briefing] Force sync failed:', syncErr.message);
                }
            }

            // Google API 직접 호출 제거 -> SSOT 내부 DB만 조회 (Phase 3)
            const rangeStart = yesterday.toISOString();
            const rangeEnd = tomorrow.toISOString();
            
            const { data: calEvents, error: calErr } = await supabaseAdmin
                .from('calendar_events')
                .select('*')
                .eq('user_id', userId)
                .eq('is_deleted', false)
                .lt('start_time', rangeEnd)
                // start_time/end_time overlap 조건
                .or(`end_time.gt.${rangeStart},end_time.is.null`)
                .order('start_time', { ascending: true });

            if (calErr) {
                console.error('Briefing Calendar Fetch Error (DB):', calErr.message);
                return { full: '일정 정보 없음', future: '일정 정보 없음' };
            }

            if (calEvents && calEvents.length > 0) {
                const todayTime = new Date(todayKSTStr).getTime() - 9 * 60 * 60 * 1000;
                
                const formatEvent = (event) => {
                    const rawStart = event.start_time;
                    let startStr = rawStart;
                    if (rawStart) {
                        const d = new Date(rawStart);
                        if (!isNaN(d.getTime())) {
                            const isAllDay = event.is_all_day;
                            startStr = d.toLocaleString('ko-KR', {
                                timeZone: 'Asia/Seoul',
                                year: 'numeric',
                                month: 'long',
                                day: 'numeric',
                                weekday: 'short',
                                hour: isAllDay ? undefined : 'numeric',
                                minute: isAllDay ? undefined : 'numeric',
                                hour12: !isAllDay
                            });
                            if (isAllDay) startStr += ' (종일)';
                        }
                    }
                    return `- ${event.title || '제목 없음'} (${startStr})`;
                };

                const fullEvents = calEvents.map(formatEvent).join('\n');
                
                const futureEvents = calEvents.filter(event => {
                    const rawStart = event.start_time;
                    if (!rawStart) return true;
                    const d = new Date(rawStart);
                    return isNaN(d.getTime()) || d.getTime() >= todayTime;
                }).map(formatEvent).join('\n');
                
                return { full: fullEvents, future: futureEvents };
            }
        } catch (e) {
            console.error('Briefing Calendar Fetch Error:', e.message);
        }
        return { full: '일정 정보 없음', future: '일정 정보 없음' };
    })();

    const weatherNewsPromise = (async () => {
        let region = '서울';
        try {
            const pushRepository = require('../_repositories/pushRepository');
            const config = await pushRepository.getUserSubscriptions(userId);
            if (regionOverride) {
                region = regionOverride;
            } else if (config?.settings?.weatherRegion) {
                region = config.settings.weatherRegion;
            }
        } catch (e) {
            console.error('Briefing Redis settings fetch failed, fallback to defaults:', e.message);
            if (regionOverride) {
                region = regionOverride;
            }
        }

        let weatherStr = '날씨 정보 조회 불가';
        let weatherObj = null;

        const weatherPromise = region === 'off'
            ? Promise.resolve(null)
            : getLiveWeather(region);

        try {
            const weatherRes = await weatherPromise;
            weatherObj = weatherRes;
            if (region === 'off') {
                weatherStr = '날씨 안내 비활성화됨';
            } else if (weatherRes) {
                weatherStr = `[${weatherRes.region} 날씨] 상태: ${weatherRes.sky}, 기온: ${weatherRes.temp}℃, 강수 확률: ${weatherRes.rainProb}%, 강수 형태: ${weatherRes.rainType}`;
            }
        } catch (err) {
            console.error(`--- [WEATHER FETCH ERROR] Region: ${region}, Error: ${err.message} ---`);
        }

        return { weatherStr, weatherObj };
    })();

    // diariesPromise: 최근 일기만 조회 (contextEventsPromise 의존성 제거하여 완전 병렬화)
    const diariesPromise = (async () => {
        const pattern = `user:${userId}:diary-*`;
        const keys = await scanRedisKeys(pattern);
        let recentDiaries = '일기 기록 없음';
        let diarySortedKeys = [];

        if (keys.length > 0) {
            diarySortedKeys = keys.sort().reverse();
            
            const latestKeys = diarySortedKeys.slice(0, 3);
            const values = await redis.mget(latestKeys);
            recentDiaries = values
                .filter(Boolean)
                .map((value) => {
                    try {
                        const item = JSON.parse(value);
                        if (item.content && item.content.startsWith('e2e:')) {
                            return '';
                        }
                        const dateStr = new Date(item.createdAt || new Date()).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' });
                        return `[일기 작성일: ${dateStr}]\n내용: ${item.content}`;
                    } catch {
                        return '';
                    }
                })
                .filter(Boolean)
                .join('\n---\n') || '일기 기록 없음';
        }

        return { recentDiaries, diarySortedKeys };
    })();

    const dbTasksPromise = (async () => {
        let dbTasksStr = '';
        let lowProgressWarningStr = '';
        try {
            const { supabaseAdmin } = require('../_routes/shared');
            if (supabaseAdmin) {
                const yesterdayDateStr = yesterday.toISOString().split('T')[0];
                const tomorrowDateStr = tomorrow.toISOString().split('T')[0];
                
                // Supabase 쿼리들을 병렬 실행하여 데이터베이스 조회 대기 시간 최적화
                const [dbSubTasksRes, allUncompletedRes] = await Promise.all([
                    supabaseAdmin
                        .from('sub_tasks')
                        .select('title, due_date, start_date, is_completed, tasks!inner(title, user_id)')
                        .eq('tasks.user_id', userId)
                        .eq('is_completed', false)
                        .gte('due_date', yesterdayDateStr)
                        .lte('start_date', tomorrowDateStr),
                    supabaseAdmin
                        .from('sub_tasks')
                        .select('title, progress, due_date, tasks!inner(title, user_id)')
                        .eq('tasks.user_id', userId)
                        .eq('is_completed', false)
                ]);

                const dbSubTasks = dbSubTasksRes.data;
                if (dbSubTasks && dbSubTasks.length > 0) {
                    dbTasksStr = dbSubTasks.map(st => {
                        const parentTitle = st.tasks?.title || '과제';
                        return `- ${st.title} (대과제: ${parentTitle}, 기한: ${st.due_date})`;
                    }).join('\n');
                }

                const allUncompleted = allUncompletedRes.data;
                
                const overdueTasks = (allUncompleted || []).filter(st => st.due_date && st.due_date <= todayKSTStr);
                if (overdueTasks.length > 0) {
                    const todayTime = new Date(todayKSTStr).getTime();
                    
                    overdueTasks.sort((a, b) => {
                        const aDueTime = new Date(a.due_date).getTime();
                        const bDueTime = new Date(b.due_date).getTime();
                        const aDays = (aDueTime - todayTime) / (1000 * 60 * 60 * 24);
                        const bDays = (bDueTime - todayTime) / (1000 * 60 * 60 * 24);
                        const aScore = aDays * 10 - (a.progress || 0);
                        const bScore = bDays * 10 - (b.progress || 0);
                        return aScore - bScore; // Lower score is higher priority
                    });

                    const topTask = overdueTasks[0];
                    const highestPriorityTaskStr = `[오늘 가장 시급한 과제 후보]: "${topTask.title}" (마감: ${topTask.due_date}, 달성률: ${topTask.progress || 0}%) - 이를 브리핑 최우선 과제로 고려하십시오.`;

                    const displayTasks = overdueTasks.slice(0, 5);
                    const hiddenCount = overdueTasks.length - 5;
                    
                    let taskListStr = displayTasks.map(st => `- ${st.title} (대과제: ${st.tasks?.title || '과제'}, 달성률: ${st.progress || 0}%, 마감일: ${st.due_date})`).join('\n');
                    if (hiddenCount > 0) {
                        taskListStr += `\n외 ${hiddenCount}개의 밀린 과제가 있습니다.`;
                    }

                    lowProgressWarningStr = `🚨 [필독 - 밀린 과제 경고]: 현재 마감 기한이 도래했거나 지났음에도 완료되지 않은 과제가 총 ${overdueTasks.length}개 있습니다. 브리핑의 최우선 목적은 과제 관리이므로, 이 과제들의 수행을 강력히 독려하십시오:\n${taskListStr}\n\n${highestPriorityTaskStr}`;
                }
            }
        } catch (err) {
            console.error('[Briefing Service] Failed to fetch active DB tasks:', err.message);
        }
        return { dbTasksStr, lowProgressWarningStr };
    })();

    const [
        contextEvents,
        { weatherStr, weatherObj },
        { recentDiaries: rawRecentDiaries, diarySortedKeys },
        storedNickname,
        { dbTasksStr, lowProgressWarningStr }
    ] = await Promise.all([
        contextEventsPromise,
        weatherNewsPromise,
        diariesPromise,
        redis.get(nicknameKey),
        dbTasksPromise
    ]);

    // 회상 매칭 — Promise.all 완료 후 수행 (contextEvents가 확정된 상태)
    let reminiscenceMemory = '특별한 과거 회상 없음';
    if (diarySortedKeys.length > 3) {
        try {
            const historyKeys = diarySortedKeys.slice(0, 15);
            const historyValues = await redis.mget(historyKeys);
            let foundMemory = null;

            const upcomingEventLower = contextEvents.full.toLowerCase();

            for (let i = 3; i < historyValues.length; i++) {
                if (!historyValues[i]) continue;
                try {
                    const item = JSON.parse(historyValues[i]);
                    if (item.content && item.content.startsWith('e2e:')) continue;
                    const plainContent = item.content || '';
                    if (!plainContent || plainContent.length < 10) continue;

                    const words = upcomingEventLower.match(/[가-힣a-zA-Z0-9]{2,}/g) || [];
                    const matchedWord = words.find(w => w !== '일정' && w !== '제목' && w !== '시간' && w !== '생일' && w !== '회의' && plainContent.toLowerCase().includes(w));

                    if (matchedWord) {
                        const dateStr = new Date(item.createdAt).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' });
                        foundMemory = {
                            date: dateStr,
                            content: plainContent,
                            emotion: item.emotion || '평온',
                            type: 'keyword',
                            keyword: matchedWord
                        };
                        break;
                    }
                } catch (e) {}
            }

            if (!foundMemory) {
                for (let i = 3; i < historyValues.length; i++) {
                    if (!historyValues[i]) continue;
                    try {
                        const item = JSON.parse(historyValues[i]);
                        if (item.content && item.content.startsWith('e2e:')) continue;
                        const plainContent = item.content || '';
                        if (!plainContent || plainContent.length < 10) continue;

                        const emo = item.emotion || '';
                        if (emo.includes('행복') || emo.includes('기쁨') || emo.includes('설렘') || emo.includes('보람') || emo.includes('🥰') || emo.includes('😊')) {
                            const dateStr = new Date(item.createdAt).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' });
                            foundMemory = {
                                date: dateStr,
                                content: plainContent,
                                emotion: emo,
                                type: 'happy'
                            };
                            break;
                        }
                    } catch (e) {}
                }
            }

            if (foundMemory) {
                if (foundMemory.type === 'keyword') {
                    reminiscenceMemory = `[${foundMemory.date}의 추억 (다가올 일정 관련 단어 '${foundMemory.keyword}' 연계)]\n당시 감정 상태: ${foundMemory.emotion}\n내용: ${foundMemory.content}`;
                } else {
                    reminiscenceMemory = `[${foundMemory.date}의 눈부셨던 과거의 기록 (당시 감정: ${foundMemory.emotion})]\n내용: ${foundMemory.content}`;
                }
            }
        } catch (reminErr) {
            console.warn('--- [BRIEFING] Reminiscence matching failed (non-blocking):', reminErr.message);
        }
    }

    let recentDiaries = rawRecentDiaries;

    if (clientDiaries.length > 0 && consent) {
        const clientContent = clientDiaries.map(d => {
            const dateStr = new Date(d.date || new Date()).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' });
            return `[일기 작성일(명시적 전송): ${dateStr}]\n내용: ${d.content}`;
        }).join('\n---\n');
        
        recentDiaries = [
            recentDiaries === '일기 기록 없음' ? '' : recentDiaries,
            clientContent
        ].filter(Boolean).join('\n---\n') || '일기 기록 없음';
    }

    const rawNickname = storedNickname || '사용자';
    const userNickname = rawNickname.endsWith('님') ? rawNickname.slice(0, -1) : rawNickname;

    const briefingPrompt = `
너는 사용자의 하루를 책임지는 완벽하고 꼼꼼한 감성 수석 비서다. 아래 데이터를 참고하여 품격 있고 깊이감 있는 오늘의 데일리 브리핑을 작성하라.
사용자의 호칭은 "${userNickname}"이다. 브리핑 시작과 끝에 반드시 이 호칭으로 직접 불러 정성껏 안내하십시오.

[실시간 수집 데이터]
1. 현재 시간: ${currentTimeStr}
2. 구글 일정 (어제~내일): ${contextEvents.future}
3. 최근 생각(Diary) (작성일 포함): 
${recentDiaries}
4. 실시간 기상 예보: ${weatherStr}
5. 연계된 과거의 기억(Reminiscence): 
${reminiscenceMemory}
6. 진행 중인 과제 및 세부 과제:
${dbTasksStr || '진행 중인 과제 없음'}
${lowProgressWarningStr ? `7. [달성률 저조 경고]:\n${lowProgressWarningStr}\n` : ''}

[수행 지시]
1. **브리핑 구조 및 우선순위 엄수**: 브리핑은 산만하지 않게 다음의 5가지 흐름으로 자연스럽게 서술하십시오.
   ① 오늘의 핵심 (가장 시급한 과제나 주요 일정 짚어주기)
   ② 오늘의 일정 (구글 일정 기반)
   ③ 밀린 과제 점검 (존재할 경우 단호한 동기부여)
   ④ 실시간 날씨 및 외출 조언
   ⑤ 오늘의 한마디 (과거 회상과 엮어 따뜻한 격려)
2. **과제 수행 최우선 관리**: [필독 - 밀린 과제 경고]와 [오늘 가장 시급한 과제 후보]가 있다면 반드시 반영하여 당장 실행에 옮기도록 유도하십시오.
3. **현재 시간 기반 일정 안내**: 오늘 일정을 안내할 때, 현재 시각(${currentTimeStr})을 기준으로 '이미 지난 일정'보다는 '앞으로 남은 일정'을 우선적으로 소개하여 자연스럽게 브리핑하십시오. 지인의 생일, 기념일은 시간과 무관하게 최우선으로 언급하며 축하 멘트를 남기십시오.
4. **미래 할 일 리마인드**: 일기에 언급된 할 일은 반드시 작성일 기준으로 날짜를 계산하여 밀리지 않도록 유의하십시오. 날씨는 예보가 '날씨 안내 비활성화됨'일 경우 완전히 생략하십시오.
5. **어조 및 분량**: 비서로서의 품격을 유지하며, 전체 브리핑은 8~12문장 정도로 상세하게 작성하십시오. 중요한 일정이나 키워드는 **텍스트** 로 강조하십시오.
6. **응답 잘림 방지**: 응답 텍스트가 도중에 끊어지는 일이 없도록 분량을 조절하여 반드시 **완전한 문장**으로 서술을 마무리지으십시오.
7. **오늘 가장 먼저 해야 할 일 (마무리 포맷)**: 브리핑의 맨 마지막에는 어떠한 인사말도 덧붙이지 말고, 의미적으로 다음 형태를 유지하여 브리핑을 끝마치십시오. (기호나 서식은 유연하게 하되, 제목과 1가지 핵심 행동이 명확히 보이도록 할 것)

제목: 오늘 가장 먼저 해야 할 일
내용: [가장 중요한 과제나 일정 1가지]
`;

    const currentDataHash = crypto.createHash('sha256').update(
        stableStringify({
            contextEvents: contextEvents.full,
            weatherStr,
            recentDiaries: rawRecentDiaries,
            dbTasksStr,
            reminiscenceMemory
        })
    ).digest('hex');

    if (skipIfUnchanged && cachedData) {
        if (cachedData.dataHash === currentDataHash && cachedData.briefing !== 'GENERATING') {
            console.log('--- [BRIEFING] Data hash matched! Skipping Gemini generation ---');
            return cachedData;
        }
    }

    // failFast를 true로 설정하여 429 딜레이 발생 시 기다리지 않고 즉시 다음 모델(Fallback)로 넘어가도록 처리
    let data;
    try {
        data = await callGemini(briefingPrompt, { maxOutputTokens: 4096 }, 2, null, true);
    } catch (apiErr) {
        console.error('--- [BRIEFING GEMINI ERROR] ---', apiErr.message);
    }
    const candidate = data?.candidates?.[0] || null;
    const parts = candidate?.content?.parts || [];
    const finishReason = candidate?.finishReason || '';
    const rawBriefing = parts.map(p => p.text || '').join('') || '사용자님, 현재 AI 비서의 집중력이 잠시 흩어졌습니다. (API 할당량 초과 또는 네트워크 지연)\n조금 뒤에 다시 새로고침을 해주시면, 꼼꼼하게 다시 브리핑을 준비해 드릴게요!';

    const briefing = looksTruncatedBriefing(rawBriefing, finishReason)
        ? await completeTruncatedBriefing(rawBriefing)
        : rawBriefing;


    const resultObj = {
        schemaVersion: 2,
        briefingDate: getKstDateKey(),
        briefing,
        weather: weatherObj || null,
        updatedAtMs: Date.now(),
        dataHash: currentDataHash,
        calendarIncluded: !contextEvents.full.includes('일정 정보 없음'),
        source: skipIfUnchanged ? 'pre_generated' : 'on_demand'
    };

    if (!skipCacheSave && clientDiaries.length === 0 && briefing && !briefing.includes('할당량 초과')) {
        const dateStr = getKstDateKey();
        try {
            await redis.set(`user:${userId}:briefing:${dateStr}`, JSON.stringify(resultObj), 'EX', 129600);
        } catch (cacheSetErr) {
            console.error('Briefing Cache Write Error:', cacheSetErr.message);
        }
    }

    return resultObj;
}


async function commitBriefingData(userId, dateStr, readyData, ownerToken, revisionAtStart) {
    const lockKey = `user:${userId}:briefing-build-lock:${dateStr}`;
    const revisionKey = `user:${userId}:briefing-revision:${dateStr}`;
    const cacheKey = `user:${userId}:briefing:${dateStr}`;
    
    const luaScript = `
        if redis.call("get", KEYS[1]) ~= ARGV[1] then
            return -1 -- lock owner mismatch
        end
        local currentRevision = redis.call("get", KEYS[2])
        if (currentRevision or "__NONE__") ~= ARGV[2] then
            return -2 -- revision changed
        end
        local ok = redis.call("set", KEYS[3], ARGV[3], "EX", ARGV[4])
        if not ok then
            return -3 -- set failed
        end
        if currentRevision then
            redis.call("del", KEYS[2])
        end
        redis.call("del", KEYS[1])
        return 1
    `;
    
    try {
        const result = await redis.eval(
            luaScript,
            3,
            lockKey, revisionKey, cacheKey,
            ownerToken, revisionAtStart, JSON.stringify(readyData), 129600
        );
        return result;
    } catch (e) {
        console.error('Lua Commit Error:', e);
        return -3;
    }
}

async function invalidateTodayBriefing(userId, { reason, mode = 'dirty' }) {
    const dateStr = getKstDateKey();
    const cacheKey = `user:${userId}:briefing:${dateStr}`;
    const revisionKey = `user:${userId}:briefing-revision:${dateStr}`;
    
    const newRevision = crypto.randomUUID();
    
    await redis.del(`user:${userId}:briefing-cache`); // legacy
    
    if (mode === 'disable') {
        await redis.del(cacheKey);
    } else if (mode === 'purge') {
        await redis.del(cacheKey);
        await redis.set(revisionKey, newRevision, 'EX', 172800);
    } else {
        await redis.set(revisionKey, newRevision, 'EX', 172800);
    }
}

module.exports = {
    generateBriefing,
    commitBriefingData,
    invalidateTodayBriefing
};
