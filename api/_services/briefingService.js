const { 
    supabase, 
    redis, 
    callGemini, 
    scanRedisKeys,
    getLiveWeather,
    getNewsHeadlines,
    supabaseAdmin,
    fetchGoogleCalendarEvents
} = require('../_routes/shared');

async function generateBriefing(userId, providerToken, regionOverride, clientDiaries = [], consent = false, userEmail = '', forceRefresh = false) {
    const cacheKey = `user:${userId}:briefing-cache`;
    
    if (clientDiaries.length === 0 && !forceRefresh) {
        try {
            const cached = await redis.get(cacheKey);
            if (cached) {
                console.log('--- [CACHE] Returning cached briefing from core.');
                try {
                    const parsed = JSON.parse(cached);
                    if (parsed && typeof parsed === 'object' && parsed.briefing) {
                        return parsed;
                    }
                } catch (jsonErr) {
                    // Not JSON, fall back to string format
                }
                return { briefing: cached, weather: null, updatedAt: Date.now() };
            }
        } catch (error) {
            console.error('Briefing Cache Error:', error.message);
        }
    }

    const nowKST = new Date();
    
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
            const calResult = await fetchGoogleCalendarEvents(userId, yesterday.toISOString(), tomorrow.toISOString(), userEmail);
            if (calResult && calResult.events && calResult.events.length > 0) {
                return calResult.events
                    .map((event) => {
                        const rawStart = event.start?.dateTime || event.start?.date;
                        let startStr = rawStart;
                        if (rawStart) {
                            const d = new Date(rawStart);
                            if (!isNaN(d.getTime())) {
                                const isAllDay = !event.start?.dateTime;
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
                        return `- ${event.summary || '제목 없음'} (${startStr})`;
                    })
                    .join('\n');
            }
        } catch (e) {
            console.error('Briefing Calendar Fetch Error:', e.message);
        }
        return '일정 정보 없음';
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

    const diariesPromise = (async () => {
        const pattern = `user:${userId}:diary-*`;
        const keys = await scanRedisKeys(pattern);
        let recentDiaries = '일기 기록 없음';
        let reminiscenceMemory = '특별한 과거 회상 없음';

        if (keys.length > 0) {
            const sortedKeys = keys.sort().reverse();
            
            const latestKeys = sortedKeys.slice(0, 3);
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

            const historyKeys = sortedKeys.slice(0, 15);
            const historyValues = await redis.mget(historyKeys);
            let foundMemory = null;
            
            const contextEvents = await contextEventsPromise;
            const upcomingEventLower = contextEvents.toLowerCase();

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
        }

        return { recentDiaries, reminiscenceMemory };
    })();

    const [
        contextEvents,
        { weatherStr, weatherObj },
        { recentDiaries: rawRecentDiaries, reminiscenceMemory },
        storedNickname
    ] = await Promise.all([
        contextEventsPromise,
        weatherNewsPromise,
        diariesPromise,
        redis.get(nicknameKey)
    ]);

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

    let dbTasksStr = '';
    try {
        const { supabaseAdmin } = require('../_routes/shared');
        if (supabaseAdmin) {
            const yesterdayDateStr = yesterday.toISOString().split('T')[0];
            const tomorrowDateStr = tomorrow.toISOString().split('T')[0];
            
            const { data: dbSubTasks } = await supabaseAdmin
                .from('sub_tasks')
                .select('title, due_date, start_date, is_completed, tasks!inner(title, user_id)')
                .eq('tasks.user_id', userId)
                .eq('is_completed', false)
                .gte('due_date', yesterdayDateStr)
                .lte('start_date', tomorrowDateStr);

            if (dbSubTasks && dbSubTasks.length > 0) {
                dbTasksStr = dbSubTasks.map(st => {
                    const parentTitle = st.tasks?.title || '과제';
                    return `- ${st.title} (대과제: ${parentTitle}, 기한: ${st.due_date})`;
                }).join('\n');
            }
        }
    } catch (err) {
        console.error('[Briefing Service] Failed to fetch active DB tasks:', err.message);
    }

    const rawNickname = storedNickname || '사용자';
    const userNickname = rawNickname.endsWith('님') ? rawNickname.slice(0, -1) : rawNickname;

    const briefingPrompt = `
너는 사용자의 하루를 책임지는 완벽하고 꼼꼼한 감성 수석 비서다. 아래 데이터를 참고하여 품격 있고 깊이감 있는 오늘의 데일리 브리핑을 작성하라.
사용자의 호칭은 "${userNickname}"이다. 브리핑 시작과 끝에 반드시 이 호칭으로 직접 불러 정성껏 안내하십시오.

[실시간 수집 데이터]
1. 현재 시간: ${currentTimeStr}
2. 구글 일정 (어제~내일): ${contextEvents}
3. 최근 생각(Diary) (작성일 포함): 
${recentDiaries}
4. 실시간 기상 예보: ${weatherStr}
5. 연계된 과거의 기억(Reminiscence): 
${reminiscenceMemory}
6. 진행 중인 과제 및 세부 과제:
${dbTasksStr || '진행 중인 과제 없음'}

[수행 지시]
1. **당일 및 내일 일정 완벽 브리핑**: 구글 일정 중 '오늘(당일)' 예정된 일정을 시작으로 '내일'의 주요 일정까지 순차적으로 꼼꼼하게 모두 챙겨서 언급하라. 오늘 일정이 끝났더라도 남은 내일 일정을 알려주며, 성공적인 하루를 위한 준비 사항을 비서의 어조로 따뜻하게 조언하라.
   - **지인 기념일 강조**: 만약 구글 일정에 지인의 생일, 기념일(예: '생일', 'Birthday', '결혼기념일' 등)이 포함되어 있다면, 이를 절대 빠뜨리지 말고 오늘의 최우선 및 핵심 일정으로 반드시 비중 있게 언급하며 따뜻한 축하 멘트를 함께 담아 서술하십시오.
   - **시간 표현 지침**: 브리핑 본문에서 구체적인 분/시 단위의 정확한 작성 시간이나 시각을 일일이 구구절절 언급할 필요는 없습니다. 날짜(오늘, 내일 등)와 함께 시간대를 **새벽, 아침, 오전, 오후, 저녁, 밤**의 6등분 범위로 유연하게 표현하여 한층 더 자연스럽게 설명해 주십시오 (예: '오늘 오후', '내일 아침' 등).
2. **실시간 날씨 에스코트**: 실시간 기상 예보가 '날씨 안내 비활성화됨'인 경우에는 일절 날씨나 온도, 옷차림에 관련된 코멘트를 브리핑 전체에서 절대 언급하지 말고 완전히 생략하십시오. 그렇지 않고 기상 예보가 주어졌다면 오늘 외출 시 필요한 옷차림 조언이나 소지품 챙기기(예: 강수 확률에 따른 우산 소지, 환절기 겉옷 챙기기 등) 등의 섬세한 에스코트 조언을 어조에 녹여내십시오.
3. **미래의 할 일 리마인드**: 최근 생각(Diary)에 명시된 약속, 계획, 일정 등 미래의 할 일은 반드시 각 일기의 [일기 작성일]을 기준으로 날짜를 계산해야 합니다. 현재 조회 시간인 ${currentTimeStr} 기준의 내일로 대입하여 날짜를 잘못 밀어내지 않도록 각별히 유의하여 리마인드하십시오.
4. **감성적 과거 회상 매칭**: '연계된 과거의 기억'이 '특별한 과거 회상 없음'이 아닌 유효한 데이터로 제공되었다면, 다가올 미래의 일정 또는 오늘 하루를 시작하는 사용자에게 과거와 현재를 따뜻하게 엮어주는 아련하고 감성적인 회상 한마디를 브리핑 후반부에 반드시 어우러지게 서술하십시오.
5. **과제(Task) 리마인드**: 진행 중인 과제 목록을 확인하고, 마감 임박 과제가 있으면 우선적으로 짧게 리마인드하라.
6. **분량**: 전체 브리핑은 4~5문장 내외로 간결하면서도 최고의 품격을 지닌 대화체로 작성하고, 불필요한 장문을 배제하여 생성 속도를 단축하라.
7. **강조**: 가장 중요한 키워드나 할 일은 **텍스트**로 강조하라.
`;

    const data = await callGemini(briefingPrompt, {}, 3, null, false);
    const briefing = data?.candidates?.[0]?.content?.parts?.[0]?.text || '비서가 브리핑을 준비하지 못했습니다. (API 할당량 초과일 수 있습니다)';

    const resultObj = {
        briefing,
        weather: weatherObj || null,
        updatedAt: Date.now()
    };

    if (clientDiaries.length === 0 && data?.candidates?.[0]?.content?.parts?.[0]?.text) {
        const isFallback = briefing.includes('API 할당량 초과') || briefing.includes('바쁘네요') || briefing.includes('준비하지 못했습니다');
        const cacheTTL = isFallback ? 15 : 3600;
        try {
            await redis.set(cacheKey, JSON.stringify(resultObj), 'EX', cacheTTL);
        } catch (cacheSetErr) {
            console.error('Briefing Cache Write Error:', cacheSetErr.message);
        }
    }

    return resultObj;
}

module.exports = {
    generateBriefing
};
