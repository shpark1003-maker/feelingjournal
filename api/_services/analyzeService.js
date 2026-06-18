const { 
    supabase, 
    supabaseAdmin,
    redis, 
    callGemini, 
    sanitizeContent, 
    extractEventJson,
    fetchWithTimeout,
    encrypt
} = require('../_routes/shared');
const { saveDiary } = require('../_repositories/diaryRepository');
const { getUserNickname, updateUserEmotion } = require('../_repositories/userRepository');

async function analyzeDiary({ userId, userEmail, content, richContent, image, title, mediaId, notebookId, aiConsent, providerToken, e2eKey, clientEmotion, clientResponse, createdAt }) {
    const sanitized = sanitizeContent(content);
    const contentHash = Buffer.from(sanitized || image || '').toString('base64').slice(0, 50);
    const cacheKey = `user:${userId}:last-analyze-cache`;

    // E2E 암호화가 활성화되지 않은 경우에만 일반 평문 캐시 작동
    if (!e2eKey) {
        const cached = await redis.get(cacheKey);
        if (cached) {
            const { hash, result } = JSON.parse(cached);
            if (hash === contentHash) return { cached: true, result };
        }
    }

    let existingEventsStr = '현재 등록된 일정이 없습니다.';
    if (providerToken) {
        try {
            const calendarUrl = `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(new Date().toISOString())}&maxResults=15&singleEvents=true&orderBy=startTime`;
            const calRes = await fetchWithTimeout(calendarUrl, { headers: { Authorization: `Bearer ${providerToken}` }, failFast: true });
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

    // 일기 최초 작성 시각 기준 적용 (상대 날짜 계산용)
    let referenceDate = new Date();
    if (createdAt) {
        const parsed = new Date(createdAt);
        if (!isNaN(parsed.getTime())) {
            referenceDate = parsed;
        }
    }
    const currentTimeStr = referenceDate.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
    
    // 사용자 호칭 조회
    const userNickname = await getUserNickname(userId, userEmail);

    const prompt = `너는 사용자의 감정을 분석하고 일정을 조율하며, 생활 전반을 챙겨주는 품격 있는 수석 비서이자 전문 인지행동치료(CBT) 상담사다.
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
4. "내일", "다음주" 등 상대 시간은 이 일기가 작성된 위 [현재 시간] (${currentTimeStr})을 기준으로 계산하라.`;
5. 첫 줄에 감정:[단어] 형식으로 작성하라.
6. 전문 인지행동치료(CBT)의 임상적 노하우를 고도로 적용하되, 결코 기계적인 상담 용어(예: 'CBT', '인지오류', '치료' 등)를 드러내어 사용자가 상담실에 앉아있는 느낌을 주지 마십시오. 대신 사용자의 지친 부정적 감정이나 생각 속 편향(흑백논리, 자책, 미래 비관 등)이 감지될 때, 수석비서의 지적이고 극진한 존대 어조를 유지하면서 깊은 공감과 함께 건강하고 유연한 대안적 관점(Cognitive Restructuring)을 자연스러운 비즈니스적/생활밀착형 제안으로 깨달을 수 있게 유도하는 품격 있는 단락을 반드시 포함하십시오. 항상 "${userNickname}"님을 따뜻하게 지지하고 위로하는 비서의 태도를 견지하십시오.

EVENT_JSON_START
{"summary":"일정 제목","start":"ISO8601 시작시간","end":"ISO8601 종료시간","type":"task"}
EVENT_JSON_END

사용자 입력:
"""
${sanitized || '(이미지 분석 요청)'}
"""`;

    let text;
    let emotion = '평온';
    let detectedEvent = null;

    if (aiConsent === false) {
        const validEmotions = ['기쁨', '슬픔', '분노', '불안', '평온'];
        emotion = validEmotions.includes(clientEmotion) ? clientEmotion : '평온';
        text = clientResponse || "AI 분석 동의가 비활성화되어 비서의 심층 조언이 제공되지 않습니다.";
    } else {
        let inlineData = null;
        if (image) {
            inlineData = {
                mimeType: image.split(';')[0].split(':')[1],
                data: image.split(',')[1]
            };
        }

        const data = await callGemini(prompt, {}, 3, inlineData, true);
        text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        if (!text) {
            throw new Error('Gemini 응답이 비어 있습니다.');
        }

        const emotionMatch = text.match(/감정:\[(.*?)\]/);
        emotion = emotionMatch ? emotionMatch[1].trim() : '평온';
        detectedEvent = extractEventJson(text);
    }

    const timestamp = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);
    const diaryKey = `user:${userId}:diary-${timestamp}`;
    
    const diaryData = {
        title: title || '제목 없는 메모',
        content: aiConsent === false ? sanitized : encrypt(sanitized, e2eKey),
        richContent: richContent ? (aiConsent === false ? richContent : encrypt(richContent, e2eKey)) : null,
        response: aiConsent === false ? text : encrypt(text, e2eKey),
        createdAt: createdAt || new Date().toISOString(),
        emotion,
        mediaId: mediaId || null,
        notebookId: notebookId || 'nb-1'
    };

    // diaryRepository를 활용하여 Redis & Postgres 동기화 저장
    try {
        await saveDiary(diaryKey, userId, diaryData);
    } catch (dbErr) {
        console.error('--- [ANALYZE DB ERROR] Failed to sync new diary via diaryRepository:', dbErr?.message || dbErr);
    }

    // 캐시 초기화
    try {
        await redis.del(`user:${userId}:calendar-advice-cache`);
        await redis.del(`user:${userId}:briefing-cache`);
    } catch (cacheErr) {
        console.error('Failed to clear advice/briefing caches:', cacheErr);
    }

    // 1촌 감정 상태 공유
    await updateUserEmotion(userId, emotion);

    const finalResult = {
        success: true,
        answer: text,
        emotion,
        event: detectedEvent,
        id: diaryKey,
        title: diaryData.title
    };

    if (!e2eKey && aiConsent !== false) {
        await redis.set(cacheKey, JSON.stringify({ hash: contentHash, result: finalResult }), 'EX', 3600);
    }

    return { cached: false, result: finalResult };
}

module.exports = {
    analyzeDiary
};
