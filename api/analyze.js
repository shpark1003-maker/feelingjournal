const { 
    supabase, 
    redis, 
    callGemini, 
    sanitizeContent, 
    extractEventJson 
} = require('./shared');

module.exports = async (req, res) => {
    if (req.method === 'OPTIONS') return res.status(200).end();
    
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
        
        // supabaseAdmin이 있으면 bypass 가능하므로 static verify 대신 get user 진행
        const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.split(' ')[1]);
        if (authError || !user) {
            return res.status(401).json({ error: 'Invalid user' });
        }

        const { image, title, mediaId, notebookId, richContent } = req.body;
        const content = sanitizeContent(req.body.content);
        
        if (!content && !image && !richContent) {
            return res.status(400).json({ error: '분석할 내용이나 이미지가 없습니다.' });
        }

        const providerToken = req.headers['x-provider-token'];
        const contentHash = Buffer.from(content || image || '').toString('base64').slice(0, 50);
        const cacheKey = `user:${user.id}:last-analyze-cache`;

        const cached = await redis.get(cacheKey);
        if (cached) {
            const { hash, result } = JSON.parse(cached);
            if (hash === contentHash) return res.json(result);
        }

        let existingEventsStr = '현재 등록된 일정이 없습니다.';
        if (providerToken) {
            try {
                const calendarUrl = `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(new Date().toISOString())}&maxResults=15&singleEvents=true&orderBy=startTime`;
                const calRes = await fetchWithTimeout(calendarUrl, { headers: { Authorization: `Bearer ${providerToken}` } });
                const calData = await calRes.json();
                if (calData.items && calData.items.length > 0) {
                    existingEventsStr = calData.items.map(e => {
                        const start = e.start?.dateTime || e.start?.date;
                        const dateObj = new Date(start);
                        const formattedDate = isNaN(dateObj.getTime()) ? start : dateObj.toLocaleString('ko-KR', {
                            year: 'numeric', month: 'long', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Seoul'
                        });
                        return `- 제목: ${e.summary || '제목 없음'}, 시간: ${formattedDate}`;
                    }).join('\n');
                }
            } catch (e) {}
        }

        const currentTimeStr = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
        
        // 사용자 호칭 조회 (Redis에 없으면 이메일 ID 사용)
        const nicknameKey = `user:${user.id}:nickname`;
        const storedNickname = await redis.get(nicknameKey);
        const userNickname = storedNickname || user.email.split('@')[0];

        const prompt = `너는 사용자의 감정을 분석하고 일정을 조율하며, 생활 전반을 챙겨주는 품격 있는 수석 비서다.
사용자의 호칭은 "${userNickname}"이다. 응답 시 반드시 이 호칭으로 불러라.
첨부된 이미지가 있다면 그 안의 텍스트(영수증, 메모, 안내문 등)를 스캔(OCR)하고 내용을 분석하라.

[사용자의 현재 일정 리스트]
${existingEventsStr}

[현재 시간]
${currentTimeStr}

[수행 지시]
1. 이미지 속 텍스트와 사용자의 메모를 종합 분석하라.
2. 기존 일정과 대조하여 충돌 여부를 확인하라.
3. 할 일이 발견되면 EVENT_JSON_START/END 형식으로 제안하라.
4. "내일", "다음주" 등 상대 시간은 현재 시간을 기준으로 계산하라.
5. 첫 줄에 감정:[단어] 형식으로 작성하라.
6. 분석 결과에 따라 따뜻한 위로나 조언을 제공하되, 반드시 "${userNickname}"님이라고 호칭하라.

EVENT_JSON_START
{"summary":"일정 제목","start":"ISO8601 시작시간","end":"ISO8601 종료시간","type":"task"}
EVENT_JSON_END

사용자 입력:
"""
${content || '(이미지 분석 요청)'}
"""`;

        let inlineData = null;
        if (image) {
            inlineData = {
                mimeType: image.split(';')[0].split(':')[1],
                data: image.split(',')[1]
            };
        }

        const data = await callGemini(prompt, {}, 3, inlineData);
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        if (!text) {
            throw new Error('Gemini 응답이 비어 있습니다.');
        }

        const emotionMatch = text.match(/감정:\[(.*?)\]/);
        const emotion = emotionMatch ? emotionMatch[1].trim() : '평온';
        const detectedEvent = extractEventJson(text);

        const timestamp = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);
        const diaryKey = `user:${user.id}:diary-${timestamp}`;
        
        // server-local.js의 완벽한 데이터 규격과 완전히 정렬
        const diaryData = {
            title: title || '제목 없는 메모',
            content,
            richContent: richContent || null,
            response: text,
            createdAt: new Date().toISOString(),
            emotion,
            mediaId: mediaId || null,
            notebookId: notebookId || 'nb-1'
        };
        await redis.set(diaryKey, JSON.stringify(diaryData), 'EX', 3600 * 24 * 30);

        // 프로필 감정 상태 동기화 (1촌 공유용) 추가
        try {
            const { error: profileError } = await supabase
                .from('profiles')
                .upsert({ 
                    id: user.id, 
                    current_emotion: emotion, 
                    emotion_updated_at: new Date().toISOString() 
                }, { onConflict: 'id' });
            
            if (profileError) console.error('Profile Emotion Sync Error:', profileError);
        } catch (e) {
            console.error('Profile DB Error:', e);
        }

        const finalResult = {
            success: true,
            answer: text,
            emotion,
            event: detectedEvent,
            id: diaryKey,
            title: diaryData.title
        };
        await redis.set(cacheKey, JSON.stringify({ hash: contentHash, result: finalResult }), 'EX', 3600);

        return res.json(finalResult);
    } catch (error) {
        console.error('Critical Analyze Error:', error);
        return res.json({
            success: false,
            answer: '분석 중 문제가 발생했습니다. 조금만 기다려 주시겠어요?'
        });
    }
};
