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
const subscribe = require('./_routes/subscribe');

module.exports = async (req, res) => {
    // Enable CORS for OPTIONS preflight
    if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE, PATCH');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Provider-Token');
        return res.status(200).end();
    }

    const url = req.url || '';
    const path = url.split('?')[0];

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
            return await push(req, res);
        }
        if (path === '/api/scrap' || path.startsWith('/api/scrap/')) {
            return await scrap(req, res);
        }
        if (path === '/api/subscribe' || path.startsWith('/api/subscribe/')) {
            return await subscribe(req, res);
        }

        return res.status(404).json({ error: `Not Found: ${path}` });
    } catch (err) {
        console.error(`Router Error [${path}]:`, err);
        return res.status(500).json({ error: err.message });
    }
};
