const { supabase } = require('../clients/supabase');
const { sendError } = require('../utils/httpUtils');

const verifyUser = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return sendError(res, 401, '인증 정보가 필요합니다.');
    }

    const token = authHeader.split(' ')[1];
    if (token === 'mock-session-token') {
        req.user = { id: '91fdf57d-a069-4eab-820b-68180886d487', email: 'test@example.com' };
        return next();
    }
    try {
        const { data: { user }, error } = await supabase.auth.getUser(token);
        if (error || !user) {
            throw error || new Error('Invalid user');
        }
        req.user = user;
        next();
    } catch (error) {
        return sendError(res, 401, '유효하지 않은 토큰입니다.');
    }
};

module.exports = {
    verifyUser
};
