const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const path = require('path');
const Redis = require('ioredis');

// 환경 변수 로드 (로컬 .env 파일 우선 적용)
dotenv.config({ override: true });

// Redis 클라이언트 초기화
const redis = process.env.REDIS_URL ? new Redis(process.env.REDIS_URL) : null;

console.log('--- Environment Check ---');
if (process.env.GEMINI_API_KEY) {
    const trimmedKey = process.env.GEMINI_API_KEY.trim();
    console.log('GEMINI_API_KEY loaded: YES');
}
if (redis) {
    console.log('REDIS_URL loaded: YES');
}
console.log('-------------------------');

const app = express();
const port = process.env.PORT || 3000;

// 미들웨어 설정
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'))); // public 폴더의 정적 파일 서빙

// Gemini AI 설정
const apiKey = process.env.GEMINI_API_KEY ? process.env.GEMINI_API_KEY.trim() : '';
const genAI = new GoogleGenerativeAI(apiKey);

// 분석 요청 API 엔드포인트
app.post('/api/analyze', async (req, res) => {
    try {
        const { content } = req.body;

        if (!content) {
            return res.status(400).json({ error: '일기 내용이 없습니다.' });
        }

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

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();

        // Redis에 데이터 저장
        if (redis) {
            try {
                const now = new Date();
                const timestamp = now.getFullYear().toString() +
                    (now.getMonth() + 1).toString().padStart(2, '0') +
                    now.getDate().toString().padStart(2, '0') +
                    now.getHours().toString().padStart(2, '0') +
                    now.getMinutes().toString().padStart(2, '0') +
                    now.getSeconds().toString().padStart(2, '0');
                
                const key = `diary-${timestamp}`;
                
                await redis.set(key, JSON.stringify({
                    originalContent: content,
                    aiResponse: text,
                    createdAt: now.toISOString()
                }));
                
                console.log(`[Local] Saved to Redis with key: ${key}`);
            } catch (redisError) {
                console.error('Redis Storage Error:', redisError);
            }
        }

        res.json({ answer: text });
    } catch (error) {
        console.error('Gemini API Error:', error);
        res.status(500).json({ error: 'AI 분석 중 오류가 발생했습니다.' });
    }
});

// 히스토리 요청 API 엔드포인트
app.get('/api/history', async (req, res) => {
    if (!redis) {
        return res.status(500).json({ error: 'Redis 연결 설정이 되어 있지 않습니다.' });
    }

    try {
        let cursor = '0';
        let allKeys = [];

        do {
            const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', 'diary-*', 'COUNT', 100);
            cursor = nextCursor;
            allKeys = allKeys.concat(keys);
        } while (cursor !== '0');

        if (allKeys.length === 0) {
            return res.json({ history: [] });
        }

        const values = await redis.mget(allKeys);
        const history = allKeys.map((key, index) => {
            try {
                const data = JSON.parse(values[index]);
                return { id: key, ...data };
            } catch (e) {
                return null;
            }
        }).filter(item => item !== null);

        res.json({ history });
    } catch (error) {
        console.error('History Fetch Error:', error);
        res.status(500).json({ error: '히스토리 로딩 실패' });
    }
});

app.listen(port, () => {
    console.log(`Server is running at http://localhost:${port}`);
    console.log(`Gemini API Key Loaded: ${process.env.GEMINI_API_KEY ? 'YES' : 'NO'}`);
    if (redis) console.log('Redis connected successfully!');
});
