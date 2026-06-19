const analyze = require('./analyze');
const apiSettings = require('./api-settings');
const auth = require('./auth');
const briefing = require('./briefing');
const calendar = require('./calendar');
const chat = require('./chat');
const contacts = require('./contacts');
const cronPush = require('./cron-push');
const friends = require('./friends');
const history = require('./history');
const invite = require('./invite');
const nickname = require('./nickname');
const notebooks = require('./notebooks');
const persona = require('./persona');
const presence = require('./presence');
const userSearch = require('./user-search');
const push = require('./push');
const scrap = require('./scrap');
const tts = require('./tts');
const news = require('./news');
const aiTasks = require('./ai-tasks');

const routes = [
    { path: '/api/ai-tasks', handler: aiTasks, auth: true },
    { path: '/api/api-settings', handler: apiSettings, auth: true },
    { path: '/api/news', handler: news, auth: true },
    { path: '/api/analyze', handler: analyze, auth: true },
    { path: '/api/auth', handler: auth, auth: false },
    { path: '/api/briefing', handler: briefing, auth: true },
    { path: '/api/calendar', handler: calendar, auth: true },
    { path: '/api/chat', handler: chat, auth: true },
    { path: '/api/contacts', handler: contacts, auth: true },
    { path: '/api/cron-push', handler: cronPush, auth: false },
    { path: '/api/friends', handler: friends, auth: true },
    { path: '/api/history', handler: history, auth: true },
    { path: '/api/invite', handler: invite, auth: true },
    { path: '/api/nickname', handler: nickname, auth: true },
    { path: '/api/notebooks', handler: notebooks, auth: true },
    { path: '/api/persona', handler: persona, auth: true },
    { path: '/api/presence', handler: presence, auth: true },
    { path: '/api/users/search', handler: userSearch, auth: true },
    { path: '/api/scrap', handler: scrap, auth: false },
    { path: '/api/tts', handler: tts, auth: true },
    
    // Express sub-routers matching
    { path: '/api/push', handler: push.router, auth: false, customRouter: true, stripPrefix: '/api/push' },
    { path: '/api/schedule-message', handler: push.router, auth: false, customRouter: true, stripPrefix: '/api' },
    { path: '/api/subscribe', handler: push.router, auth: false, customRouter: true, stripPrefix: '/api' }
];

module.exports = routes;
