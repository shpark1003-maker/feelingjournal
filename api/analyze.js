const { GoogleGenerativeAI } = require('@google/generative-ai');
const Redis = require('ioredis');

// Redis 클라이언트 초기화 (Vercel Serverless 환경에서 재사용을 위해 핸들러 외부에서 선언)
const redis = process.env.REDIS_URL ? new Redis(process.env.REDIS_URL) : null;

module.exports = async (req, res) => {
    // Vercel serverless function handler
    
    // 1. POST 요청만 허용
    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
    }

    try {
        const { content } = req.body;

        if (!content) {
            return res.status(400).json({ error: '일기 내용이 없습니다.' });
        }

        // 2. 환경 변수에서 API 키 가져오기
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            console.error('GEMINI_API_KEY is not defined in environment variables.');
            return res.status(500).json({ error: '서버 설정 오류: API 키가 없습니다.' });
        }

        const genAI = new GoogleGenerativeAI(apiKey);
        
        // 최신 모델 gemini-2.5-flash 사용 (사용자 요청 사항 반영)
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

        const prompt = `
            너는 심리 상담가야. 사용자가 작성한 일기 내용을 읽고, 
            사용자의 감정을 한 단어(예: 기쁨, 슬픔, 분노, 불안, 평온 등)로 요약해줘. 
            그리고 그 감정에 깊이 공감해주고, 따뜻한 응원의 메시지를 2~3문장으로 작성해줘. 

            답변 형식은 반드시 아래 형식을 지켜줘:
            감정:[요약된 감정]

            [응원메시지]

            사용자 일기 내용: "${content}"
        `;

        // 4. Gemini API 호출
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();

        // 6. Redis에 데이터 저장
        if (redis) {
            try {
                // 현재 시간을 YYYYMMDDHHMMSS 형식으로 생성
                const now = new Date();
                const timestamp = now.getFullYear().toString() +
                    (now.getMonth() + 1).toString().padStart(2, '0') +
                    now.getDate().toString().padStart(2, '0') +
                    now.getHours().toString().padStart(2, '0') +
                    now.getMinutes().toString().padStart(2, '0') +
                    now.getSeconds().toString().padStart(2, '0');
                
                const key = `diary-${timestamp}`;
                
                // 데이터 저장 (원본 내용과 AI 답변)
                await redis.set(key, JSON.stringify({
                    originalContent: content,
                    aiResponse: text,
                    createdAt: now.toISOString()
                }));
                
                console.log(`Saved to Redis with key: ${key}`);
            } catch (redisError) {
                console.error('Redis Storage Error:', redisError);
                // Redis 저장 실패가 사용자 응답에 영향을 주지 않도록 에러만 기록
            }
        } else {
            console.warn('Redis client not initialized. Skipping storage.');
        }

        // 5. 결과 반환
        return res.status(200).json({ answer: text });
    } catch (error) {
        console.error('Gemini API Serverless Error:', error);
        
        if (error.message && error.message.includes('API key')) {
            return res.status(401).json({ error: 'API 키가 유효하지 않습니다.' });
        }
        
        return res.status(500).json({ error: 'AI 분석 중 오류가 발생했습니다.' });
    }
};
