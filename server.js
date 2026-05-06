const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const path = require('path');

// 환경 변수 로드 (로컬 .env 파일 우선 적용)
dotenv.config({ override: true });

console.log('--- Environment Check ---');
if (process.env.GEMINI_API_KEY) {
    const trimmedKey = process.env.GEMINI_API_KEY.trim();
    console.log('GEMINI_API_KEY loaded: YES');
    console.log('Key length:', trimmedKey.length, 'characters');
    console.log('Key starts with:', trimmedKey.substring(0, 7));
    console.log('Key ends with:', trimmedKey.substring(trimmedKey.length - 4));
} else {
    console.log('GEMINI_API_KEY loaded: NO');
}
console.log('-------------------------');

const app = express();
const port = process.env.PORT || 3000;

// 미들웨어 설정
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, './'))); // 정적 파일(HTML, CSS, JS) 서빙

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

        // Vercel 서버리스 함수와 동일하게 gemini-1.5-flash 모델을 사용합니다.
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

        res.json({ answer: text });
    } catch (error) {
        console.error('Gemini API Error:', error);
        res.status(500).json({ error: 'AI 분석 중 오류가 발생했습니다.' });
    }
});

app.listen(port, () => {
    console.log(`Server is running at http://localhost:${port}`);
    console.log(`Gemini API Key Loaded: ${process.env.GEMINI_API_KEY ? 'YES' : 'NO'}`);
});
