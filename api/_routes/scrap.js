const axios = require('axios');
const cheerio = require('cheerio');
const multer = require('multer');

const { 
    supabase,
    sendError, 
    isSafeUrl, 
    callGemini, 
    getBrowserInstance 
} = require('./shared');

const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB 제한
});

// Express 미들웨어를 Serverless Async 환경에서 실행하기 위한 래퍼 헬퍼
const runMiddleware = (req, res, fn) => {
    return new Promise((resolve, reject) => {
        fn(req, res, (result) => {
            if (result instanceof Error) {
                return reject(result);
            }
            return resolve(result);
        });
    });
};

module.exports = async (req, res) => {
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return sendError(res, 401, '인증 정보가 필요합니다.');
        }

        const token = authHeader.split(' ')[1];
        const { data: { user }, error: authError } = await supabase.auth.getUser(token);
        if (authError || !user) {
            return sendError(res, 401, '유효하지 않은 토큰입니다.');
        }

        req.user = user;
        const url = req.url;
        const path = url.split('?')[0];

        // 1. 일반 웹페이지 크롤링 (POST /api/scrap/scrap 또는 /api/scrap)
        if (req.method === 'POST' && (path.includes('/scrap') && !path.includes('-'))) {
            const { url: targetUrl } = req.body;
            if (!targetUrl) return sendError(res, 400, 'URL이 필요합니다.');
            if (!isSafeUrl(targetUrl)) return sendError(res, 400, '안전하지 않은 URL 접근이 감지되었습니다.');

            console.log('--- [SCRAP] Fetching URL:', targetUrl);
            
            const response = await axios.get(targetUrl, {
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

            return res.json({
                success: true,
                title: title.trim(),
                content: content.trim()
            });
        }

        // 2. 동적 웹페이지 캡처 후 Gemini OCR 추출 (POST /api/scrap/scrap-url-snapshot)
        if (req.method === 'POST' && path.includes('/scrap-url-snapshot')) {
            const { url: targetUrl } = req.body;
            if (!targetUrl) return sendError(res, 400, 'URL이 필요합니다.');
            if (!isSafeUrl(targetUrl)) return sendError(res, 400, '허용되지 않는 외부 접근 대상 URL입니다.');

            console.log('--- [URL SNAPSHOT] Launching Browser for:', targetUrl);
            
            let browser;
            let page;
            let isDedicatedBrowser = false;
            try {
                try {
                    browser = await getBrowserInstance();
                    page = await browser.newPage();
                } catch (e) {
                    console.log('Shared browser launch failed. Creating dedicated browser fallback. Error:', e.message);
                    isDedicatedBrowser = true;
                    if (process.env.VERCEL) {
                        const chromium = require('@sparticuz/chromium');
                        const puppeteerCore = require('puppeteer-core');
                        browser = await puppeteerCore.launch({
                            args: chromium.args,
                            defaultViewport: chromium.defaultViewport,
                            executablePath: await chromium.executablePath(),
                            headless: chromium.headless,
                            ignoreHTTPSErrors: true,
                        });
                    } else {
                        const puppeteer = require('puppeteer');
                        browser = await puppeteer.launch({
                            headless: 'new',
                            args: ['--no-sandbox', '--disable-setuid-sandbox']
                        });
                    }
                    page = await browser.newPage();
                }

                await page.setViewport({ width: 1280, height: 800 });
                await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 30000 });
                
                const pageTitle = await page.title();
                const screenshotBuffer = await page.screenshot({ type: 'jpeg', quality: 80 });
                
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

            return res.json({
                success: true,
                title: data.title || pageTitle,
                content: data.content
            });
            } finally {
                if (page) {
                    try {
                        await page.close();
                    } catch (err) {
                        console.error('Failed to close page:', err);
                    }
                }
                if (isDedicatedBrowser && browser) {
                    try {
                        await browser.close();
                    } catch (err) {
                        console.error('Failed to close dedicated browser:', err);
                    }
                }
            }
        }

        // 3. 사용자가 직접 캡처하여 올린 스크린샷 이미지 분석 (POST /api/scrap/scrap-screenshot)
        if (req.method === 'POST' && path.includes('/scrap-screenshot')) {
            await runMiddleware(req, res, upload.single('image'));

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

            return res.json({
                success: true,
                title: data.title,
                content: data.content
            });
        }

        return res.status(404).json({ error: 'Endpoint Not Found' });
    } catch (error) {
        console.error('Scraping Router Error:', error);
        return res.status(500).json({ error: '스크랩 실패: ' + error.message });
    }
};
