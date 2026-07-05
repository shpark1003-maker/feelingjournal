const {
    supabase,
    sendError
} = require('./shared');
const chatService = require('../_services/chatService');

module.exports = async (req, res) => {
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
        const { data: { user } } = await supabase.auth.getUser(authHeader.split(' ')[1]);
        if (!user) return res.status(401).json({ error: 'Invalid user' });

        req.user = user;

        const url = req.url;
        const path = url.split('?')[0];

        // 1. GET /api/chat/messages
        if (req.method === 'GET' && path.includes('/messages')) {
            const roomId = req.query?.roomId || new URL(url, 'http://localhost').searchParams.get('roomId');
            const messages = await chatService.getMessages(req.user.id, roomId);
            return res.json({ success: true, messages });
        }

        // 2. POST /api/chat/messages
        if (req.method === 'POST' && path.includes('/messages')) {
            const { roomId, content } = req.body;
            const msg = await chatService.saveMessage(req.user.id, req.user.email, roomId, content);
            return res.json({ success: true, message: msg });
        }

        // 3. POST /api/chat/room
        if (req.method === 'POST' && path.includes('/room')) {
            const { name, type } = req.body;
            try {
                const room = await chatService.getOrCreateRoom(name, type);
                return res.json({ success: true, room });
            } catch (err) {
                if (err.message.includes('Admin Supabase Client')) {
                    return sendError(res, 500, err.message);
                }
                throw err;
            }
        }

        // 4. POST /api/chat/ai-response
        if (req.method === 'POST' && path.includes('/ai-response')) {
            const { message, history, context, room_id, room_title, aiContextConsent, userDiaryContext } = req.body;
            
            try {
                const result = await chatService.generateAiResponse({
                    user: req.user,
                    message,
                    history,
                    context,
                    room_id,
                    room_title,
                    aiContextConsent,
                    userDiaryContext
                });
                
                if (result.duplicated) {
                    return res.json({ success: true, duplicated: true });
                }
                
                return res.json(result);
            } catch (err) {
                if (err.statusCode) {
                    return res.status(err.statusCode).json({ error: err.message });
                }
                throw err;
            }
        }

        return res.status(404).json({ error: 'Endpoint Not Found' });
    } catch (error) {
        console.error('Chat API Error:', error);
        return res.status(500).json({ error: error.message });
    }
};
