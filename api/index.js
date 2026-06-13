const analyze = require('./_routes/analyze');
const auth = require('./_routes/auth');
const briefing = require('./_routes/briefing');
const calendar = require('./_routes/calendar');
const chat = require('./_routes/chat');
const contacts = require('./_routes/contacts');
const cronPush = require('./_routes/cron-push');
const friends = require('./_routes/friends');
const history = require('./_routes/history');
const invite = require('./_routes/invite');
const nickname = require('./_routes/nickname');
const notebooks = require('./_routes/notebooks');
const persona = require('./_routes/persona');
const presence = require('./_routes/presence');
const push = require('./_routes/push');
const scrap = require('./_routes/scrap');

module.exports = async (req, res) => {
    // 민감 정보 로그 마스킹 처리 (Zero-Knowledge 보안성 확보)
    if (req.body && typeof req.body === 'object') {
        const sensitiveFields = ['decryptedDiaries', 'userDiaryContext', 'content', 'response'];
        const masked = { ...req.body };
        sensitiveFields.forEach(field => {
            if (masked[field] !== undefined) {
                masked[field] = '[MASKED_SENSITIVE_DATA]';
            }
        });

        Object.defineProperty(req.body, 'toJSON', {
            value: function() { return masked; },
            configurable: true,
            writable: true
        });

        const customInspect = Symbol.for('nodejs.util.inspect.custom');
        Object.defineProperty(req.body, customInspect, {
            value: function() { return masked; },
            configurable: true,
            writable: true
        });
    }

    // Enable CORS for OPTIONS preflight
    if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE, PATCH');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Provider-Token');
        return res.status(200).end();
    }

    const url = req.url || '';
    const path = url.split('?')[0];

    // [V2 ROUTE REDIRECT FOR BACKWARD COMPATIBILITY]
    if (path === '/v2' || path.startsWith('/v2/')) {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
        res.writeHead(302, { 'Location': '/' });
        return res.end();
    }

    // [IN-APP BROWSER DETECT & OUTLINK REDIRECT]
    if (path === '/' || path === '/index.html') {
        const userAgent = req.headers['user-agent'] || '';
        const isKakao = /kakaotalk/i.test(userAgent);
        const isLine = /line/i.test(userAgent);
        const isInstagram = /instagram/i.test(userAgent);
        const isFacebook = /fban|fbav/i.test(userAgent);
        const isInApp = isKakao || isInstagram || isFacebook || isLine || /inapp|webview|naver/i.test(userAgent);

        if (isInApp) {
            const protocol = req.headers['x-forwarded-proto'] || 'https';
            const host = req.headers['host'] || 'feelingjournal.vercel.app';
            const fullUrl = `${protocol}://${host}${url}`;

            // Add headers to completely disable caching for the redirect page
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');

            let redirectUrl = fullUrl;
            if (isKakao) {
                redirectUrl = "kakaotalk://web/openExternal?url=" + encodeURIComponent(fullUrl);
            } else if (isLine) {
                const parsedUrl = new URL(fullUrl);
                parsedUrl.searchParams.set('openExternalBrowser', '1');
                redirectUrl = parsedUrl.toString();
            }

            return res.status(200).send(`
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta http-equiv="refresh" content="0;url=${redirectUrl}">
    <title>안전한 브라우저로 이동 중</title>
    <script>
        window.location.href = "${redirectUrl}";
    </script>
</head>
<body style="background-color: #f8f9fa; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; padding: 20px; box-sizing: border-box;">
    <div style="background: white; padding: 30px; border-radius: 20px; box-shadow: 0 10px 30px rgba(0,0,0,0.05); text-align: center; max-width: 400px; width: 100%;">
        <span style="font-size: 3rem; margin-bottom: 20px; display: inline-block;">🔒</span>
        <h3 style="margin: 0 0 10px 0; color: #1e293b; font-size: 1.25rem; font-weight: 700;">안전한 브라우저로 이동 중</h3>
        <p style="color: #64748b; font-size: 0.95rem; line-height: 1.6; margin: 0 0 20px 0; word-break: keep-all;">
            Google 로그인 정책상 인앱 브라우저에서의 로그인이 차단되어 전용 브라우저(Chrome/Safari)로 자동 이동합니다.
        </p>
        <div style="background: #f1f5f9; padding: 12px; border-radius: 10px; font-size: 0.85rem; color: #475569; margin-bottom: 20px;">
            자동으로 이동하지 않는 경우 우측 상단의 메뉴(⋮ 또는 ⋯)를 누르고 <strong>'다른 브라우저로 열기'</strong>를 선택해 주세요.
        </div>
        <a href="${redirectUrl}" style="display: inline-block; background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%); color: white; text-decoration: none; padding: 12px 24px; border-radius: 12px; font-weight: 600; font-size: 0.95rem; box-shadow: 0 4px 15px rgba(99,102,241,0.3);">
            외부 브라우저로 수동 열기
        </a>
    </div>
</body>
</html>
            `);
        }

        // If not in-app browser, read and serve the static public/index.html
        const fs = require('fs');
        const pathLib = require('path');
        const indexPath = pathLib.join(__dirname, '../public/index.html');
        
        try {
            const html = fs.readFileSync(indexPath, 'utf8');
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
            return res.status(200).send(html);
        } catch (err) {
            console.error('Failed to read index.html:', err);
            return res.status(500).send('Server Error: Static assets not found');
        }
    }

    try {
        if (path === '/api/analyze' || path.startsWith('/api/analyze/')) {
            return await analyze(req, res);
        }
        if (path === '/api/auth' || path.startsWith('/api/auth/')) {
            return await auth(req, res);
        }
        if (path === '/api/briefing' || path.startsWith('/api/briefing/')) {
            return await briefing(req, res);
        }
        if (path === '/api/calendar' || path.startsWith('/api/calendar/')) {
            return await calendar(req, res);
        }
        if (path === '/api/chat' || path.startsWith('/api/chat/')) {
            return await chat(req, res);
        }
        if (path === '/api/contacts' || path.startsWith('/api/contacts/')) {
            return await contacts(req, res);
        }
        if (path === '/api/cron-push' || path.startsWith('/api/cron-push/')) {
            return await cronPush(req, res);
        }
        if (path === '/api/friends' || path.startsWith('/api/friends/')) {
            return await friends(req, res);
        }
        if (path === '/api/history' || path.startsWith('/api/history/')) {
            return await history(req, res);
        }
        if (path === '/api/invite' || path.startsWith('/api/invite/')) {
            return await invite(req, res);
        }
        if (path === '/api/nickname' || path.startsWith('/api/nickname/')) {
            return await nickname(req, res);
        }
        if (path === '/api/notebooks' || path.startsWith('/api/notebooks/')) {
            return await notebooks(req, res);
        }
        if (path === '/api/persona' || path.startsWith('/api/persona/')) {
            return await persona(req, res);
        }
        if (path === '/api/presence' || path.startsWith('/api/presence/')) {
            return await presence(req, res);
        }
        if (path === '/api/push' || path.startsWith('/api/push/')) {
            const originalUrl = req.url;
            req.url = req.url.replace(/^\/api\/push/, '');
            return push.router(req, res, () => {
                req.url = originalUrl;
                res.status(404).json({ error: `Not Found: ${path}` });
            });
        }
        if (path === '/api/schedule-message') {
            const originalUrl = req.url;
            req.url = req.url.replace(/^\/api/, '');
            return push.router(req, res, () => {
                req.url = originalUrl;
                res.status(404).json({ error: `Not Found: ${path}` });
            });
        }
        if (path === '/api/scrap' || path.startsWith('/api/scrap/') || path.startsWith('/api/scrap-')) {
            return await scrap(req, res);
        }
        if (path === '/api/subscribe' || path.startsWith('/api/subscribe/')) {
            const originalUrl = req.url;
            req.url = req.url.replace(/^\/api/, '');
            return push.router(req, res, () => {
                req.url = originalUrl;
                res.status(404).json({ error: `Not Found: ${path}` });
            });
        }

        return res.status(404).json({ error: `Not Found: ${path}` });
    } catch (err) {
        console.error(`Router Error [${path}]:`, err);
        return res.status(500).json({ error: err.message });
    }
};
