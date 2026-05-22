const express = require('express');
const router = express.Router();
const axios = require('axios');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer');
const multer = require('multer');

const { 
    verifyUser, 
    sendError, 
    isSafeUrl, 
    callGemini, 
    getBrowserInstance 
} = require('./shared');

const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB 제한
});

// 1. 일반 웹페이지 크롤링
router.post('/scrap', verifyUser, async (req, res) => {
    try {
        const { url } = req.body;
        if (!url) return sendError(res, 400, 'URL이 필요합니다.');
        if (!isSafeUrl(url)) return sendError(res, 400, '안전하지 않은 URL 접근이 감지되었습니다.');

        console.log('--- [SCRAP] Fetching URL:', url);
        
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            timeout: 10000
        });

        const $ = cheerio.load(response.data);
        const title = $('title').text() || $('h1').first().text() || '제목 없는 페이지';
        
        let content = '';
        $('p, article, section').each((i, el) => {
            const text = $(el).text().trim();
            if (text.length > 20) {
                content += text + '\n\n';
            }
        });

        if (content.length > 5000) {
            content = content.substring(0, 5000) + '... (이하 생략)';
        }

        res.json({
            success: true,
            title: title.trim(),
            content: content.trim()
        });
    } catch (error) {
        console.error('Scraping Error:', error.message);
        sendError(res, 500, '스크랩 실패: ' + error.message);
    }
});

// 2. 동적 웹페이지 캡처 후 Gemini OCR 추출
router.post('/scrap-url-snapshot', verifyUser, async (req, res) => {
    let browser;
    try {
        const { url } = req.body;
        if (!url) return sendError(res, 400, 'URL이 필요합니다.');
        if (!isSafeUrl(url)) return sendError(res, 400, '허용되지 않는 외부 접근 대상 URL입니다.');

        console.log('--- [URL SNAPSHOT] Launching Browser for:', url);
        
        // Browser Pool에서 인스턴스 획득 시도 또는 새로 기동
        let page;
        try {
            browser = await getBrowserInstance();
            page = await browser.newPage();
        } catch (e) {
            console.log('Shared browser launch failed. Creating dedicated browser fallback.');
            browser = await puppeteer.launch({
                headless: 'new',
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            });
            page = await browser.newPage();
        }

        await page.setViewport({ width: 1280, height: 800 });
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
        
        const pageTitle = await page.title();
        const screenshotBuffer = await page.screenshot({ type: 'jpeg', quality: 80 });
        await page.close();

        const prompt = `
            사용자가 웹 페이지를 스크랩하기 위해 URL 스냅샷을 찍었습니다. 
            이미지 속의 텍스트와 주요 정보를 추출하여 정리해 주세요:
            1. 페이지의 핵심 제목
            2. 상세 본문 내용 (가독성 있게 줄바꿈 포함)
            
            응답은 반드시 JSON 형식으로만 해주세요:
            { "title": "추출된 제목", "content": "추출된 상세 본문 내용" }
        `;

        const inlineData = {
            mimeType: 'image/jpeg',
            data: screenshotBuffer.toString('base64')
        };

        const result = await callGemini(prompt, {}, 3, inlineData);
        const text = result.candidates?.[0]?.content?.parts?.[0]?.text || '';
        
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error('AI 응답 해석 실패');
        
        const data = JSON.parse(jsonMatch[0]);

        res.json({
            success: true,
            title: data.title || pageTitle,
            content: data.content
        });
    } catch (error) {
        console.error('URL Snapshot Error:', error.message);
        sendError(res, 500, '웹 페이지 캡처 실패: ' + error.message);
    }
});

// 3. 사용자가 직접 캡처하여 올린 스크린샷 이미지 분석
router.post('/scrap-screenshot', verifyUser, upload.single('image'), async (req, res) => {
    try {
        if (!req.file) return sendError(res, 400, '이미지 데이터가 없습니다.');

        console.log('--- [SCREENSHOT SCRAP] Analyzing Captured Screen ---');
        
        const prompt = `
            사용자가 현재 자신의 화면을 캡처하여 스크랩했습니다. 
            이미지 속의 텍스트를 모두 읽어내어 다음 형식으로 정리해 주세요:
            1. 페이지의 핵심 제목 (가장 눈에 띄는 제목이나 주제)
            2. 상세 본문 내용 (줄바꿈을 포함하여 읽기 좋게 정리)
            
            응답은 반드시 JSON 형식으로만 해주세요:
            { "title": "추출된 제목", "content": "추출된 상세 본문 내용" }
        `;

        const inlineData = {
            mimeType: req.file.mimetype,
            data: req.file.buffer.toString('base64')
        };

        const result = await callGemini(prompt, {}, 3, inlineData);
        const text = result.candidates?.[0]?.content?.parts?.[0]?.text || '';
        
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error('AI 응답 형식이 올바르지 않습니다.');
        
        const data = JSON.parse(jsonMatch[0]);

        res.json({
            success: true,
            title: data.title,
            content: data.content
        });
    } catch (error) {
        console.error('Screenshot Scraping Error:', error.message);
        sendError(res, 500, '화면 분석 실패: ' + error.message);
    }
});

module.exports = router;
