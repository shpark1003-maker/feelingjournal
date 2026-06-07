const { 
    supabase, 
    redis, 
    fetchWithTimeout, 
    callGemini, 
    scanRedisKeys,
    getLiveWeather,
    getNewsHeadlines,
    supabaseAdmin,
    decrypt,
    getGoogleAccessToken
} = require('./shared');

// [MODULAR] ⏰ 데일리 브리핑 코어 스케줄러 & 과거 회상(Reminiscence) 공용 엔진
async function generateBriefing(userId, providerToken, regionOverride, e2eKey) {
    const cacheKey = `user:${userId}:briefing-cache`;
    
    // E2E 활성화 모드가 아닐 때만 기존 일반 캐시 사용
    if (!e2eKey) {
        try {
            const cachedBriefing = await redis.get(cacheKey);
            if (cachedBriefing) {
                console.log('--- [CACHE] Returning cached briefing from core.');
                return cachedBriefing;
            }
        } catch (error) {
            console.error('Briefing Cache Error:', error.message);
        }
    }

    // 사용자 예보 지역 설정 조회
    let region = '서울';
    let newsCategories = ['business'];
    if (regionOverride) {
        region = regionOverride;
    } else {
        try {
            const client = supabaseAdmin || supabase;
            const { data: profile } = await client
                .from('profiles')
                .select('weather_region, news_categories')
                .eq('id', userId)
                .maybeSingle();
            
            if (profile?.weather_region) {
                region = profile.weather_region;
            }
            if (profile?.news_categories && profile.news_categories.length > 0) {
                newsCategories = profile.news_categories;
            }
        } catch (e) {
            console.error('Briefing profile fetch failed, fallback to defaults:', e.message);
        }
    }

    // 실시간 날씨 및 경제/선택분야 헤드라인 크롤링 (병렬 비동기 수행으로 응답 최적화)
    let weatherStr = '날씨 정보 조회 불가';
    let newsStr = '주요 뉴스 헤드라인 정보 없음';

    const weatherPromise = region === 'off'
        ? Promise.resolve(null)
        : getLiveWeather(region);

    const [weatherRes, newsRes] = await Promise.allSettled([
        weatherPromise,
        getNewsHeadlines(newsCategories)
    ]);

    if (region === 'off') {
        weatherStr = '날씨 안내 비활성화됨';
    } else if (weatherRes.status === 'fulfilled' && weatherRes.value) {
        const w = weatherRes.value;
        weatherStr = `[${w.region} 날씨] 상태: ${w.sky}, 기온: ${w.temp}℃, 강수 확률: ${w.rainProb}%, 강수 형태: ${w.rainType}`;
    }
    
    if (newsRes.status === 'fulfilled' && newsRes.value && newsRes.value.length > 0) {
        newsStr = newsRes.value.map((title, idx) => `${idx + 1}. ${title}`).join('\n');
    }

    // 서버 시간대(UTC 등)와 관계없이 KST(한국 표준시, UTC+9) 기준으로 정확한 날짜 계산
    const kstOffset = 9 * 60 * 60 * 1000;
    const nowKST = new Date(Date.now() + kstOffset);
    
    // KST 기준 어제 00:00:00
    const yesterdayKST = new Date(nowKST);
    yesterdayKST.setDate(yesterdayKST.getDate() - 1);
    yesterdayKST.setUTCHours(0, 0, 0, 0);
    const yesterday = new Date(yesterdayKST.getTime() - kstOffset);

    // KST 기준 내일 23:59:59
    const tomorrowKST = new Date(nowKST);
    tomorrowKST.setDate(tomorrowKST.getDate() + 1);
    tomorrowKST.setUTCHours(23, 59, 59, 999);
    const tomorrow = new Date(tomorrowKST.getTime() - kstOffset);

    let contextEvents = '일정 정보 없음';
    if (providerToken) {
        try {
            const calendarUrl = `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(yesterday.toISOString())}&timeMax=${encodeURIComponent(tomorrow.toISOString())}&singleEvents=true&orderBy=startTime`;
            const calRes = await fetchWithTimeout(calendarUrl, { headers: { Authorization: `Bearer ${providerToken}` }, failFast: true });
            if (calRes.status === 401 || calRes.status === 403) {
                await redis.del(`user:${userId}:google_provider_token`);
                await redis.del(`user:${userId}:google_provider_refresh_token`);
                console.warn(`--- [BRIEFING] Invalid token detected (Status ${calRes.status}). Evicted Google tokens from Redis for user ${userId} ---`);
            }
            const calData = await calRes.json();
            if (calData.items) {
                contextEvents = calData.items
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
    }

    const pattern = `user:${userId}:diary-*`;
    const keys = await scanRedisKeys(pattern);
    let recentDiaries = '일기 기록 없음';
    let reminiscenceMemory = '특별한 과거 회상 없음';

    if (keys.length > 0) {
        const sortedKeys = keys.sort().reverse();
        
        // 1. 최근 3일의 일기 데이터 요약 (E2E 복호화 적용)
        const latestKeys = sortedKeys.slice(0, 3);
        const values = await redis.mget(latestKeys);
        recentDiaries = values
            .filter(Boolean)
            .map((value) => {
                try {
                    const item = JSON.parse(value);
                    const plainContent = decrypt(item.content, e2eKey);
                    if (!plainContent) return '';
                    const dateStr = new Date(item.createdAt || new Date()).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' });
                    return `[일기 작성일: ${dateStr}]\n내용: ${plainContent}`;
                } catch {
                    return '';
                }
            })
            .filter(Boolean)
            .join('\n---\n') || '일기 기록 없음';

        // 2. [과거 회상 엔진] 일정이나 중요 키워드와 연계된 15개 이전 일기 검색
        const historyKeys = sortedKeys.slice(0, 15);
        const historyValues = await redis.mget(historyKeys);
        let foundMemory = null;
        const upcomingEventLower = contextEvents.toLowerCase();

        // 2-1. 키워드 매칭 우선 기법 (캘린더 키워드가 과거 일기에 있는지 스캔)
        for (let i = 3; i < historyValues.length; i++) {
            if (!historyValues[i]) continue;
            try {
                const item = JSON.parse(historyValues[i]);
                const plainContent = decrypt(item.content, e2eKey) || '';
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

        // 2-2. 차선책: 감정이 매우 긍정적이었던 과거 다이어리 기억 소환
        if (!foundMemory) {
            for (let i = 3; i < historyValues.length; i++) {
                if (!historyValues[i]) continue;
                try {
                    const item = JSON.parse(historyValues[i]);
                    const plainContent = decrypt(item.content, e2eKey) || '';
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

    const currentTimeStr = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
    
    // 사용자 호칭 조회 및 중복 '님' 제거 정제
    const nicknameKey = `user:${userId}:nickname`;
    const storedNickname = await redis.get(nicknameKey);
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
5. 당일 주요 관심분야 뉴스: 
${newsStr}
6. 연계된 과거의 기억(Reminiscence): 
${reminiscenceMemory}

[수행 지시]
1. **당일 및 내일 일정 완벽 브리핑**: 구글 일정 중 '오늘(당일)' 예정된 일정을 시작으로 '내일'의 주요 일정까지 순차적으로 꼼꼼하게 모두 챙겨서 언급하라. 오늘 일정이 끝났더라도 남은 내일 일정을 알려주며, 성공적인 하루를 위한 준비 사항을 비서의 어조로 따뜻하게 조언하라.
2. **실시간 날씨 에스코트**: 실시간 기상 예보가 '날씨 안내 비활성화됨'인 경우에는 일절 날씨나 온도, 옷차림에 관련된 코멘트를 브리핑 전체에서 절대 언급하지 말고 완전히 생략하십시오. 그렇지 않고 기상 예보가 주어졌다면 오늘 외출 시 필요한 옷차림 조언이나 소지품 챙기기(예: 강수 확률에 따른 우산 소지, 환절기 겉옷 챙기기 등) 등의 섬세한 에스코트 조언을 어조에 녹여내십시오.
3. **당일 뉴스 짧은 브리핑**: 오늘(당일) 수집된 사용자의 관심 분야 주요 헤드라인 리스트를 바탕으로 가장 중요하거나 상징적인 시사적 흐름을 짧고 간결하게 브리핑하여 생활 밀착형 인사이트를 제공하십시오.
4. **미래의 할 일 리마인드**: 최근 생각(Diary)에 명시된 약속, 계획, 일정 등 미래의 할 일은 반드시 각 일기의 [일기 작성일]을 기준으로 날짜를 계산해야 합니다. 예를 들어, [일기 작성일: 2026-05-18]인 일기에 '내일 마트 가야지'라고 써있다면, 마트 가는 날은 2026-05-19(오늘)입니다. 현재 조회 시간인 ${currentTimeStr} 기준의 내일(2026-05-20)로 대입하여 날짜를 잘못 밀어내지 않도록 각별히 유의하여 리마인드하십시오.
5. **(통합됨)**: 1번 지시사항에 통합됨.
6. **감성적 과거 회상 매칭**: '연계된 과거의 기억'이 '특별한 과거 회상 없음'이 아닌 유효한 데이터로 제공되었다면, 다가올 미래의 일정 또는 오늘 하루를 시작하는 사용자에게 "그때의 기쁨/보람을 떠올리며 힘을 내보세요" 또는 "과거의 소중한 기억이 이번 활동에도 좋은 영감이 되길 바랍니다"라는 뉘앙스로 과거와 현재를 따뜻하게 엮어주는 아련하고 감성적인 회상 한마디를 브리핑 후반부에 반드시 어우러지게 서술하십시오.
7. 전체 브리핑은 5~6문장 내외로 간결하면서도 최고의 품격을 지닌 대화체로 작성하라.
8. 가장 중요한 키워드나 할 일은 **텍스트**로 강조하라.
`;

    const data = await callGemini(briefingPrompt, {}, 3, null, true);
    const briefing = data?.candidates?.[0]?.content?.parts?.[0]?.text || '비서가 브리핑을 준비하지 못했습니다. (API 할당량 초과일 수 있습니다)';

    // 성공적인 브리핑 생성 시 Redis 캐시 저장 (E2E가 아닐 때만)
    if (!e2eKey && data?.candidates?.[0]?.content?.parts?.[0]?.text) {
        const isFallback = briefing.includes('API 할당량 초과');
        const cacheTTL = isFallback ? 15 : 300;
        await redis.set(cacheKey, briefing, 'EX', cacheTTL);
    }

    return briefing;
}

module.exports = async (req, res) => {
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
        const { data: { user } } = await supabase.auth.getUser(authHeader.split(' ')[1]);
        if (!user) return res.status(401).json({ error: 'Invalid user' });

        // Google Provider Token을 helper를 통해 조회하고 헤더에서 폴백
        let providerToken = null;
        try {
            providerToken = await getGoogleAccessToken(user.id);
        } catch (redisErr) {
            console.warn('--- [BRIEFING] Redis connection offline/error, falling back to header:', redisErr.message);
        }

        if (!providerToken) {
            providerToken = req.headers['x-provider-token'];
        }

        const e2eKey = req.headers['x-e2e-key'] || null;
        const regionOverride = req.query.region || null;
        
        const briefing = await generateBriefing(user.id, providerToken, regionOverride, e2eKey);
        return res.json({ success: true, briefing });
    } catch (error) {
        console.error('Briefing Error:', error.message);
        return res.json({
            success: true,
            briefing: `비서가 지금 조금 바쁘네요. (원인: ${error.message}) 잠시 후 다시 브리핑을 준비해 드릴게요! 🎩`
        });
    }
};

module.exports.generateBriefing = generateBriefing;
