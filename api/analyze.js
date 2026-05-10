const { GoogleGenerativeAI } = require('@google/generative-ai');
const { createClient } = require('@supabase/supabase-js');
const Redis = require('ioredis');
const ws = require('ws');

// Supabase 클라이언트 초기화 (Service Role 사용)
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false },
    realtime: { transport: ws }
});

// Redis 초기화
const redis = new Redis(process.env.REDIS_URL);

module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
    }

    // 1. 인증 토큰 확인
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: '인증 정보가 필요합니다.' });
    }

    const token = authHeader.split(' ')[1];

    try {
        const { content } = req.body;
        if (!content) {
            return res.status(400).json({ error: '일기 내용이 없습니다.' });
        }

        // 2. 사용자 인증 확인 (Supabase Service Role Client 사용)
        const { data: { user }, error: authError } = await supabase.auth.getUser(token);
        if (authError || !user) {
            return res.status(401).json({ error: '유효하지 않은 토큰입니다.' });
        }

        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            return res.status(500).json({ error: '서버 설정 오류: API 키가 없습니다.' });
        }

        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        const prompt = `
            너는 심리 상담가야. 사용자가 작성한 일기 내용을 읽고, 
            사용자의 감정을 한 단어(예: 기쁨, 슬픔, 분노, 불안, 평온 등)로 요약해줘. 
            그리고 그 감정에 깊이 공감해주고, 따뜻한 응원의 메시지를 2~3문장으로 작성해줘. 

            답변 형식은 반드시 아래 형식을 지켜줘:
            감정:[요약된 감정]

            [응원메시지]

            사용자 일기 내용: "${content}"
        `;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();

        // 감정 추출
        const emotionMatch = text.match(/감정:\[(.*?)\]/);
        const emotion = emotionMatch ? emotionMatch[1] : '평온';

        // 3. Redis에 사용자 ID를 포함한 키로 데이터 저장
        const timestamp = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);
        const redisKey = `user:${user.id}:diary-${timestamp}`;
        
        const diaryData = {
            content: content,
            response: text,
            emotion: emotion,
            createdAt: new Date().toISOString(),
            userId: user.id
        };

        await redis.set(redisKey, JSON.stringify(diaryData));
        console.log('Saved to Redis for user:', user.id, 'Key:', redisKey);

        return res.status(200).json({ answer: text });
    } catch (error) {
        console.error('Gemini API/Redis Error:', error);
        return res.status(500).json({ error: 'AI 분석 중 오류가 발생했습니다.' });
    }
};



