const { 
    supabase, 
    redis, 
    fetchWithTimeout, 
    callGemini, 
    scanRedisKeys,
    getLiveWeather,
    getNewsHeadlines,
    supabaseAdmin,
    getGoogleAccessToken,
    fetchGoogleCalendarEvents
} = require('./shared');

// [MODULAR] ⏰ 데일리 브리핑 코어 스케줄러 & 과거 회상(Reminiscence) 공용 엔진
async function generateBriefing(userId, providerToken, regionOverride, clientDiaries = [], consent = false, userEmail = '') {
    const cacheKey = `user:${userId}:briefing-cache`;
    
    // E2E 활성화 모드(클라이언트 전송 다이어리가 있는 경우)가 아닐 때만 기존 일반 캐시 사용
    if (clientDiaries.length === 0) {
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

    // 서버 시간대(UTC 등)와 관계없이 KST(한국 표준시, UTC+9) 기준으로 정확한 날짜 계산
    const nowKST = new Date();
    
    // KST 기준 어제 00:00:00
    const yesterdayKST = new Date(nowKST.getTime() + 9 * 60 * 60 * 1000);
    yesterdayKST.setDate(yesterdayKST.getDate() - 1);
    yesterdayKST.setUTCHours(0, 0, 0, 0);
    const yesterday = new Date(yesterdayKST.getTime() - 9 * 60 * 60 * 1000);

    // KST 기준 내일 23:59:59
    const tomorrowKST = new Date(nowKST.getTime() + 9 * 60 * 60 * 1000);
    tomorrowKST.setDate(tomorrowKST.getDate() + 1);
    tomorrowKST.setUTCHours(23, 59, 59, 999);
    const tomorrow = new Date(tomorrowKST.getTime() - 9 * 60 * 60 * 1000);

    const currentTimeStr = nowKST.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
    const nicknameKey = `user:${userId}:nickname`;

    // 1. 구글 캘린더 일정 조회 Promise 정의
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
        let newsCategories = ['business'];
        try {
            const client = supabaseAdmin || supabase;
            const { data: profile } = await client
                .from('profiles')
                .select('weather_region, news_categories')
                .eq('id', userId)
                .maybeSingle();
            
            if (regionOverride) {
                region = regionOverride;
            } else if (profile?.weather_region) {
                region = profile.weather_region;
            }
            if (profile?.news_categories && profile.news_categories.length > 0) {
                newsCategories = profile.news_categories;
            }
        } catch (e) {
            console.error('Briefing profile fetch failed, fallback to defaults:', e.message);
            if (regionOverride) {
                region = regionOverride;
            }
        }

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

        return { weatherStr, newsStr };
    })();

    // 3. 일기 데이터 조회 및 과거 회상 매칭 Promise 정의 (구글 일정이 완료되어야 하므로 contextEventsPromise 대입)
    const diariesPromise = (async () => {
        const pattern = `user:${userId}:diary-*`;
        const keys = await scanRedisKeys(pattern);
        let recentDiaries = '일기 기록 없음';
        let reminiscenceMemory = '특별한 과거 회상 없음';

        if (keys.length > 0) {
            const sortedKeys = keys.sort().reverse();
            
            // 1. 최근 3일의 일기 데이터 요약 (암호화되지 않은 것만 요약)
            const latestKeys = sortedKeys.slice(0, 3);
            const values = await redis.mget(latestKeys);
            recentDiaries = values
                .filter(Boolean)
                .map((value) => {
                    try {
                        const item = JSON.parse(value);
                        if (item.content && item.content.startsWith('e2e:')) {
                            return ''; // E2E 암호화된 일기는 백엔드에서 복호화하지 않고 생략
                        }
                        const dateStr = new Date(item.createdAt || new Date()).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' });
                        return `[일기 작성일: ${dateStr}]\n내용: ${item.content}`;
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
            
            // 구글 캘린더 일정이 조회 완료되면 매칭 시작
            const contextEvents = await contextEventsPromise;
            const upcomingEventLower = contextEvents.toLowerCase();

            // 2-1. 키워드 매칭 우선 기법 (캘린더 키워드가 과거 일기에 있는지 스캔)
            for (let i = 3; i < historyValues.length; i++) {
                if (!historyValues[i]) continue;
                try {
                    const item = JSON.parse(historyValues[i]);
                    if (item.content && item.content.startsWith('e2e:')) continue; // Skip encrypted
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

            // 2-2. 차선책: 감정이 매우 긍정적이었던 과거 다이어리 기억 소환
            if (!foundMemory) {
                for (let i = 3; i < historyValues.length; i++) {
                    if (!historyValues[i]) continue;
                    try {
                        const item = JSON.parse(historyValues[i]);
                        if (item.content && item.content.startsWith('e2e:')) continue; // Skip encrypted
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

    // 4. 모든 핵심 데이터 가져오기 병렬 대기
    const [
        contextEvents,
        { weatherStr, newsStr },
        { recentDiaries: rawRecentDiaries, reminiscenceMemory },
        storedNickname
    ] = await Promise.all([
        contextEventsPromise,
        weatherNewsPromise,
        diariesPromise,
        redis.get(nicknameKey)
    ]);

    let recentDiaries = rawRecentDiaries;

    // 3. 클라이언트 전송 컨텍스트 병합 (사용자 동의 시)
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
2. 구글 일정 (어제~내일): ${contextEvents}
3. 최근 생각(Diary) (작성일 포함): 
${recentDiaries}
4. 실시간 기상 예보: ${weatherStr}
5. 당일 주요 관심분야 뉴스 (카테고리 접두사 포함): 
${newsStr}
6. 연계된 과거의 기억(Reminiscence): 
${reminiscenceMemory}

[수행 지시]
1. **당일 및 내일 일정 완벽 브리핑**: 구글 일정 중 '오늘(당일)' 예정된 일정을 시작으로 '내일'의 주요 일정까지 순차적으로 꼼꼼하게 모두 챙겨서 언급하라. 오늘 일정이 끝났더라도 남은 내일 일정을 알려주며, 성공적인 하루를 위한 준비 사항을 비서의 어조로 따뜻하게 조언하라.
   - **시간 표현 지침**: 브리핑 본문에서 구체적인 분/시 단위의 정확한 작성 시간이나 시각을 일일이 구구절절 언급할 필요는 없습니다. 날짜(오늘, 내일 등)와 함께 시간대를 **새벽, 아침, 오전, 오후, 저녁, 밤**의 6등분 범위로 유연하게 표현하여 한층 더 자연스럽게 설명해 주십시오 (예: '오늘 오후', '내일 아침' 등).
2. **실시간 날씨 에스코트**: 실시간 기상 예보가 '날씨 안내 비활성화됨'인 경우에는 일절 날씨나 온도, 옷차림에 관련된 코멘트를 브리핑 전체에서 절대 언급하지 말고 완전히 생략하십시오. 그렇지 않고 기상 예보가 주어졌다면 오늘 외출 시 필요한 옷차림 조언이나 소지품 챙기기(예: 강수 확률에 따른 우산 소지, 환절기 겉옷 챙기기 등) 등의 섬세한 에스코트 조언을 어조에 녹여내십시오.
3. **뉴스 요약 및 메모화 지침 (중요)**: 
   - 절대 뉴스 내용을 문장으로 길게 풀어 쓰거나 수식어로 꾸며 쓰지 마십시오.
   - 브리핑 본문 중간에 반드시 **'뉴스정리'**를 소제목으로 잡고, 그 하위에 메모/리스트 형식으로 한 줄씩 간결하게 출력해야 합니다.
   - 사용자가 선택한 뉴스 카테고리(정치, 경제 등)별로 각각 **딱 3개씩만** 추출하여 한 줄 요약 형태로 표기하십시오. 
   - 예시 포맷:
     [뉴스정리]
     • 정치: ... 한 줄 요약
     • 경제: ... 한 줄 요약
4. **미래의 할 일 리마인드**: 최근 생각(Diary)에 명시된 약속, 계획, 일정 등 미래의 할 일은 반드시 각 일기의 [일기 작성일]을 기준으로 날짜를 계산해야 합니다. 현재 조회 시간인 ${currentTimeStr} 기준의 내일로 대입하여 날짜를 잘못 밀어내지 않도록 각별히 유의하여 리마인드하십시오.
5. **(통합됨)**: 1번 지시사항에 통합됨.
6. **감성적 과거 회상 매칭**: '연계된 과거의 기억'이 '특별한 과거 회상 없음'이 아닌 유효한 데이터로 제공되었다면, 다가올 미래의 일정 또는 오늘 하루를 시작하는 사용자에게 과거와 현재를 따뜻하게 엮어주는 아련하고 감성적인 회상 한마디를 브리핑 후반부에 반드시 어우러지게 서술하십시오.
7. 전체 브리핑은 뉴스 영역을 제외하면 4~5문장 내외로 간결하면서도 최고의 품격을 지닌 대화체로 작성하고, 불필요한 장문을 배제하여 생성 속도를 단축하라.
8. 가장 중요한 키워드나 할 일은 **텍스트**로 강조하라.
9. 뉴스정리는 반드시 '[뉴스정리]'라는 소제목 하위에 카테고리별로 기사 제목 한 줄 요약만 나열해야 합니다. 절대 설명조 문장으로 길게 쓰지 말고 딱 한 줄로만 요약하십시오.
`;

    const data = await callGemini(briefingPrompt, {}, 3, null, true);
    const briefing = data?.candidates?.[0]?.content?.parts?.[0]?.text || '비서가 브리핑을 준비하지 못했습니다. (API 할당량 초과일 수 있습니다)';

    // 성공적인 브리핑 생성 시 Redis 캐시 저장 (E2E 암호화가 아닌 경우에만)
    if (clientDiaries.length === 0 && data?.candidates?.[0]?.content?.parts?.[0]?.text) {
        const isFallback = briefing.includes('API 할당량 초과') || briefing.includes('바쁘네요') || briefing.includes('준비하지 못했습니다');
        const cacheTTL = isFallback ? 15 : 3600;
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

        const regionOverride = req.query.region || null;
        
        let clientDiaries = [];
        let consent = false;

        if (req.method === 'POST') {
            consent = req.body?.aiContextConsent === true;
            clientDiaries = req.body?.decryptedDiaries || [];
            const isAnalyzeRequest = consent || clientDiaries.length > 0;

            if (isAnalyzeRequest) {
                if (!consent) {
                    return res.status(400).json({ error: 'AI 분석 제공 동의(aiContextConsent)가 누락되었습니다.' });
                }
                if (clientDiaries.length > 5) {
                    return res.status(400).json({ error: '최대 5개의 다이어리만 분석할 수 있습니다.' });
                }
                for (const d of clientDiaries) {
                    if (d.content && d.content.length > 2000) {
                        return res.status(400).json({ error: '다이어리 평문 내용은 최대 2,000자까지만 허용됩니다.' });
                    }
                }
            }
        }

        const briefing = await generateBriefing(user.id, providerToken, regionOverride, clientDiaries, consent, user.email);

        // Fetch weather to return to frontend
        let weather = null;
        try {
            const client = supabaseAdmin || supabase;
            const { data: profile } = await client
                .from('profiles')
                .select('weather_region')
                .eq('id', user.id)
                .maybeSingle();
            const region = regionOverride || profile?.weather_region || '서울';
            if (region !== 'off') {
                weather = await getLiveWeather(region);
            }
        } catch (e) {
            console.error('Failed to get weather for response:', e.message);
        }

        return res.json({ success: true, briefing, weather });
    } catch (error) {
        console.error('Briefing Error:', error?.message || error);
        return res.json({
            success: true,
            briefing: `비서가 지금 조금 바쁘네요. (원인: ${error?.message || error}) 잠시 후 다시 브리핑을 준비해 드릴게요! 🎩`
        });
    }
};

module.exports.generateBriefing = generateBriefing;
