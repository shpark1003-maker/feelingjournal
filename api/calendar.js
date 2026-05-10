const { GoogleGenerativeAI } = require('@google/generative-ai');

module.exports = async (req, res) => {
    if (req.method !== 'GET') {
        res.setHeader('Allow', ['GET']);
        return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: '인증 정보가 필요합니다.' });
    }

    const token = authHeader.split(' ')[1];

    try {
        // 구글 캘린더 API 호출 (사용자의 access_token 사용)
        // 주의: 이 토큰은 Supabase JWT가 아니라 구글에서 발급받은 access_token이어야 함.
        // 클라이언트에서 캘린더 접근용으로 발급받은 provider_token을 사용합니다.
        const providerToken = req.headers['x-provider-token'];
        
        if (!providerToken) {
            return res.status(400).json({ error: 'Google Access Token이 없습니다.' });
        }

        const calendarResponse = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=' + new Date().toISOString() + '&maxResults=10&singleEvents=true&orderBy=startTime', {
            headers: {
                'Authorization': `Bearer ${providerToken}`
            }
        });

        const calendarData = await calendarResponse.json();

        if (calendarData.error) {
            console.error('Google Calendar API Error:', calendarData.error);
            return res.status(500).json({ error: '캘린더 일정을 가져오는데 실패했습니다.' });
        }

        // AI 조언 추가 (Gemini 활용)
        const apiKey = process.env.GEMINI_API_KEY;
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        const events = calendarData.items || [];
        const enrichedEvents = await Promise.all(events.map(async (event) => {
            const prompt = `
                일정명: "${event.summary}"
                일정 설명: "${event.description || '없음'}"
                시작 시간: "${event.start.dateTime || event.start.date}"

                너는 똑똑한 라이프 비서야. 이 일정을 보고 사용자가 미리 준비해야 할 사항이나 도움이 될 만한 조언을 1~2문장으로 짧게 해줘. 
                예를 들어 세무 일정이라면 서류 준비, 기념일이라면 선물 제안 등 상황에 맞게 조언해줘.
            `;

            try {
                const result = await model.generateContent(prompt);
                const advice = (await result.response).text();
                return {
                    id: event.id,
                    title: event.summary,
                    start: event.start.dateTime || event.start.date,
                    advice: advice.trim()
                };
            } catch (e) {
                return {
                    id: event.id,
                    title: event.summary,
                    start: event.start.dateTime || event.start.date,
                    advice: "준비물을 미리 챙겨보세요!"
                };
            }
        }));

        return res.status(200).json({ events: enrichedEvents });
    } catch (error) {
        console.error('Calendar Logic Error:', error);
        return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
    }
};
