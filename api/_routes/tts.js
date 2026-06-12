const { verifyUser, fetchWithTimeout } = require('./shared');

module.exports = async (req, res) => {
    // OPTIONS request bypass for CORS
    if (req.method === 'OPTIONS') return res.status(200).end();

    // Only allow POST requests for text-to-speech synthesis
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const { text, voiceId } = req.body;
        if (!text) {
            return res.status(400).json({ error: '음성으로 합성할 텍스트(text)가 없습니다.' });
        }

        // 로컬 구동될 GPT-SoVITS API 서버 기본 주소 (환경변수 또는 로컬호스트 9880 포트)
        const localTtsBaseUrl = process.env.LOCAL_TTS_URL || 'http://127.0.0.1:9880';
        
        // GPT-SoVITS API 표준 규격에 맞게 쿼리 생성
        // 기본 옵션: 한국어(ko), 필요 시 voiceId 또는 다른 설정을 파라미터로 붙임
        const params = new URLSearchParams({
            text: text,
            text_language: 'ko', // 한국어 기본값
            voice_id: voiceId || 'default'
        });

        const targetUrl = `${localTtsBaseUrl}/?${params.toString()}`;
        console.log(`--- [TTS PROXY] Calling local AI Voice engine: ${targetUrl} ---`);

        // 로컬 TTS 서버 호출 (최대 15초 대기)
        const ttsResponse = await fetchWithTimeout(targetUrl, {
            method: 'GET'
        }, 15000, 1);

        if (!ttsResponse.ok) {
            throw new Error(`로컬 AI 음성 합성 엔진 오류 (상태코드: ${ttsResponse.status})`);
        }

        // 수신한 음성 데이터(wav) 바이너리를 클라이언트에 그대로 스트리밍 전달
        const audioBuffer = await ttsResponse.arrayBuffer();
        res.set({
            'Content-Type': 'audio/wav',
            'Content-Length': audioBuffer.byteLength,
            'Cache-Control': 'no-cache'
        });

        return res.send(Buffer.from(audioBuffer));
    } catch (error) {
        console.error('--- [TTS PROXY ERROR] Failed to synthesize voice:', error?.message || error);
        return res.status(500).json({ 
            error: '로컬 음성 합성 엔진 연결에 실패했습니다. 로컬 컴퓨터의 GPT-SoVITS API 서버(포트 9880)가 구동 중인지 확인해 주세요.' 
        });
    }
};
