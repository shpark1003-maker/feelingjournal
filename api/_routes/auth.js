const { supabase, sendError, redis } = require('./shared');

module.exports = async (req, res) => {
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const url = req.url;
        const path = url.split('?')[0];

        // 1. 회원가입 엔드포인트
        if (req.method === 'POST' && path.includes('/signup')) {
            const { email, password } = req.body;
            const { data, error } = await supabase.auth.signUp({ email, password });
            if (error) return sendError(res, 400, error.message);
            return res.json({ success: true, user: data.user });
        }

        // 2. 로그인 엔드포인트
        if (req.method === 'POST' && path.includes('/login')) {
            const { email, password } = req.body;
            const { data, error } = await supabase.auth.signInWithPassword({ email, password });
            if (error) return sendError(res, 400, error.message);
            return res.json({ 
                success: true, 
                session: data.session, 
                user: data.user,
                provider_token: data.session?.provider_token
            });
        }

        // 3. 내 정보 조회 엔드포인트
        if (req.method === 'GET' && path.includes('/me')) {
            const authHeader = req.headers.authorization;
            if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
            
            const token = authHeader.split(' ')[1];
            const { data: { user }, error: authError } = await supabase.auth.getUser(token);
            if (authError || !user) return res.status(401).json({ error: 'Invalid user' });
            
            return res.json({ success: true, user });
        }

        // 4. 로그아웃 엔드포인트
        if (req.method === 'POST' && path.includes('/logout')) {
            await supabase.auth.signOut();
            return res.json({ success: true });
        }

        // 4.5 구글 연동 해제 엔드포인트
        if (req.method === 'POST' && path.includes('/unlink-google')) {
            const authHeader = req.headers.authorization;
            if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
            
            const token = authHeader.split(' ')[1];
            const { data: { user }, error: authError } = await supabase.auth.getUser(token);
            if (authError || !user) return res.status(401).json({ error: 'Invalid user' });

            try {
                const { Client } = require('pg');
                const client = new Client({
                    connectionString: process.env.POSTGRES_URL || process.env.SUPABASE_DB_URL,
                    ssl: { rejectUnauthorized: false }
                });
                await client.connect();
                await client.query(
                    `DELETE FROM auth.identities WHERE user_id = $1 AND provider = 'google'`,
                    [user.id]
                );
                await client.end();
                console.log(`--- [OAuth Google Link] Successfully deleted Google identity for user ${user.id} ---`);
                return res.json({ success: true });
            } catch (dbErr) {
                console.error('--- [OAuth Google Link] Database error deleting identity:', dbErr.message);
                return res.status(500).json({ error: dbErr.message });
            }
        }

        // 5. [OAuth] 구글 로그인 리디렉션
        if (req.method === 'GET' && path.includes('/google')) {
            const { access_token } = req.query;
            let userId = null;
            
            if (access_token) {
                try {
                    const { data: { user }, error: authError } = await supabase.auth.getUser(access_token);
                    if (authError || !user) {
                        console.warn('--- [OAuth Google Link] Invalid access token provided for Google Link ---');
                        return res.status(401).json({ error: '유효하지 않은 인증 토큰입니다.' });
                    }
                    userId = user.id;
                } catch (jwtErr) {
                    console.error('--- [OAuth Google Link] Token verification error:', jwtErr.message);
                    return res.status(401).json({ error: '인증 토큰 검증 실패' });
                }
            }

            const protocol = req.headers['x-forwarded-proto'] || 'http';
            const host = req.headers.host || 'localhost:3000';
            const redirectUrl = `${protocol}://${host}/api/auth/callback`;
            
            const clientId = (process.env.GOOGLE_CLIENT_ID || '').replace(/["']/g, '').trim();
            
            if (userId) {
                // If logged in, we use direct Google OAuth flow to fetch tokens directly from Google!
                const scopes = 'https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/contacts.readonly';
                const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` + new URLSearchParams({
                    client_id: clientId,
                    redirect_uri: redirectUrl,
                    response_type: 'code',
                    scope: scopes,
                    access_type: 'offline',
                    prompt: 'consent',
                    state: userId
                }).toString();
                
                console.log(`--- [OAuth Google Direct Link] Redirecting user ${userId} to Google OAuth ---`);
                res.redirect(authUrl);
                return;
            } else {
                // Otherwise, standard Supabase OAuth login
                console.log(`--- [OAuth Google Supabase Signin] Redirecting to Supabase OAuth ---`);
                const { data, error } = await supabase.auth.signInWithOAuth({
                    provider: 'google',
                    options: {
                        redirectTo: redirectUrl,
                        scopes: 'https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/contacts.readonly',
                        queryParams: {
                            access_type: 'offline',
                            prompt: 'consent'
                        }
                    }
                });
                if (error) throw error;
                res.redirect(data.url);
                return;
            }
        }

        // 6. [OAuth] 카카오 로그인 리디렉션
        if (req.method === 'GET' && path.includes('/kakao')) {
            const protocol = req.headers['x-forwarded-proto'] || 'http';
            const host = req.headers.host || 'localhost:3000';
            const redirectUrl = `${protocol}://${host}/api/auth/callback`;

            console.log(`--- [OAuth Kakao] Redirecting to dynamic URL: ${redirectUrl} ---`);

            const { data, error } = await supabase.auth.signInWithOAuth({
                provider: 'kakao',
                options: {
                    redirectTo: redirectUrl
                }
            });
            if (error) throw error;
            res.redirect(data.url);
            return;
        }

        // 7. [OAuth] 콜백 처리 엔드포인트
        if (req.method === 'GET' && path.includes('/callback')) {
            const { code, state } = req.query;
            
            const protocol = req.headers['x-forwarded-proto'] || 'http';
            const host = req.headers.host || 'localhost:3000';
            const redirectUrl = `${protocol}://${host}/api/auth/callback`;
            
            if (code && state) {
                // This is a direct Google Calendar link flow for an active user!
                try {
                    const clientId = (process.env.GOOGLE_CLIENT_ID || '').replace(/["']/g, '').trim();
                    const clientSecret = (process.env.GOOGLE_CLIENT_SECRET || '').replace(/["']/g, '').trim();
                    
                    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                        body: new URLSearchParams({
                            code,
                            client_id: clientId,
                            client_secret: clientSecret,
                            redirect_uri: redirectUrl,
                            grant_type: 'authorization_code'
                        })
                    });
                    
                    const tokenData = await tokenResponse.json();
                    if (tokenResponse.ok) {
                        const providerToken = tokenData.access_token;
                        const providerRefreshToken = tokenData.refresh_token;

                        if (providerToken) {
                            await redis.set(`user:${state}:google_provider_token`, providerToken, 'EX', 3600);
                            await redis.del(`user:${state}:calendar-advice-cache`);
                            console.log(`--- [Direct Google Link] Cached provider token for user ${state} ---`);
                        }
                        if (providerRefreshToken) {
                            await redis.set(`user:${state}:google_provider_refresh_token`, providerRefreshToken);
                            console.log(`--- [Direct Google Link] Cached refresh token for user ${state} ---`);
                        }
                        
                        res.redirect('/#linked=google');
                        return;
                    } else {
                        console.error('--- [Direct Google Link] Failed to exchange code for tokens:', tokenData);
                        res.redirect('/?error=' + encodeURIComponent('Google token exchange failed'));
                        return;
                    }
                } catch (linkErr) {
                    console.error('--- [Direct Google Link] Error during token exchange:', linkErr.message);
                    res.redirect('/?error=' + encodeURIComponent(linkErr.message));
                    return;
                }
            }
            
            if (code && !state) {
                // Standard Supabase login flow
                const { data, error } = await supabase.auth.exchangeCodeForSession(code);
                if (error) throw error;

                if (data && data.session && data.user) {
                    const targetUserId = data.user.id;
                    const providerToken = data.session.provider_token;
                    const providerRefreshToken = data.session.provider_refresh_token;

                    if (providerToken) {
                        await redis.set(`user:${targetUserId}:google_provider_token`, providerToken, 'EX', 3600);
                        await redis.del(`user:${targetUserId}:calendar-advice-cache`);
                        console.log(`--- [OAuth Callback] Cached google_provider_token for target user ${targetUserId} and cleared calendar cache ---`);
                    }
                    if (providerRefreshToken) {
                        await redis.set(`user:${targetUserId}:google_provider_refresh_token`, providerRefreshToken);
                        console.log(`--- [OAuth Callback] Cached google_provider_refresh_token for target user ${targetUserId} ---`);
                    }

                    // 브라우저 측 Supabase SDK가 로그인을 온전히 인식할 수 있도록 hash fragment로 세션 정보 전달
                    const accessToken = data.session.access_token;
                    const refreshToken = data.session.refresh_token;
                    const expiresIn = data.session.expires_in || 3600;
                    const tokenType = data.session.token_type || 'bearer';
                    
                    res.redirect(`/#access_token=${accessToken}&refresh_token=${refreshToken}&expires_in=${expiresIn}&token_type=${tokenType}`);
                    return;
                }
            }
            res.redirect('/');
            return;
        }

        return res.status(404).json({ error: 'Endpoint Not Found' });
    } catch (err) {
        console.error('Auth API Error:', err.message);
        if (req.method === 'GET' && (req.url.includes('/google') || req.url.includes('/kakao') || req.url.includes('/callback'))) {
            return res.redirect('/?error=' + encodeURIComponent(err.message));
        }
        return sendError(res, 500, err.message);
    }
};
