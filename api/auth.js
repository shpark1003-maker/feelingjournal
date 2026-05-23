const express = require('express');
const router = express.Router();
const { supabase, verifyUser, sendError } = require('./shared');

// 1. 회원가입 엔드포인트
router.post('/signup', async (req, res) => {
    try {
        const { email, password } = req.body;
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) return sendError(res, 400, error.message);
        return res.json({ success: true, user: data.user });
    } catch (err) {
        return sendError(res, 500, '회원가입 중 서버 오류가 발생했습니다.');
    }
});

// 2. 로그인 엔드포인트
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) return sendError(res, 400, error.message);
        return res.json({ 
            success: true, 
            session: data.session, 
            user: data.user,
            provider_token: data.session?.provider_token
        });
    } catch (err) {
        return sendError(res, 500, '로그인 중 서버 오류가 발생했습니다.');
    }
});

// 3. 내 정보 조회 엔드포인트
router.get('/me', verifyUser, (req, res) => {
    return res.json({ success: true, user: req.user });
});

// 4. 로그아웃 엔드포인트
router.post('/logout', async (req, res) => {
    try {
        await supabase.auth.signOut();
        return res.json({ success: true });
    } catch (err) {
        return sendError(res, 500, '로그아웃 실패');
    }
});

// 5. [OAuth] 구글 로그인 리디렉션
router.get('/google', async (req, res) => {
    try {
        const protocol = req.headers['x-forwarded-proto'] || 'http';
        const host = req.headers.host || 'localhost:3000';
        const redirectUrl = `${protocol}://${host}/api/auth/callback`;
        
        console.log(`--- [OAuth Google] Redirecting to dynamic URL: ${redirectUrl} ---`);
        
        const { data, error } = await supabase.auth.signInWithOAuth({
            provider: 'google',
            options: {
                redirectTo: redirectUrl,
                scopes: 'https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/contacts.readonly',
                queryParams: {
                    access_type: 'offline',
                    prompt: 'consent',
                },
            }
        });
        if (error) throw error;
        res.redirect(data.url);
    } catch (err) {
        console.error('Google OAuth Error:', err.message);
        res.redirect('/?error=' + encodeURIComponent(err.message));
    }
});

// 6. [OAuth] 카카오 로그인 리디렉션
router.get('/kakao', async (req, res) => {
    try {
        const protocol = req.headers['x-forwarded-proto'] || 'http';
        const host = req.headers.host || 'localhost:3000';
        const redirectUrl = `${protocol}://${host}/api/auth/callback`;

        const { data, error } = await supabase.auth.signInWithOAuth({
            provider: 'kakao',
            options: {
                redirectTo: redirectUrl
            }
        });
        if (error) throw error;
        res.redirect(data.url);
    } catch (err) {
        console.error('Kakao OAuth Error:', err.message);
        res.redirect('/?error=' + encodeURIComponent(err.message));
    }
});

// 7. [OAuth] 콜백 처리 엔드포인트
router.get('/callback', async (req, res) => {
    try {
        const { code } = req.query;
        if (code) {
            const { error } = await supabase.auth.exchangeCodeForSession(code);
            if (error) throw error;
        }
        res.redirect('/');
    } catch (err) {
        console.error('OAuth Callback Error:', err.message);
        res.redirect('/?error=callback_failed');
    }
});

module.exports = router;
