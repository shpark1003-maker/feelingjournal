const express = require('express');
const router = express.Router();
const webpush = require('web-push');

const { 
    redis, 
    verifyUser, 
    sendError, 
    pushEnabled, 
    scanRedisKeys, 
    fetchWithTimeout,
    supabase,
    supabaseAdmin
} = require('./shared');

// [NEW] 1. 푸시 알림 및 브리핑 설정 정보 조회 엔드포인트
router.get('/subscribe', verifyUser, async (req, res) => {
    try {
        const user = req.user;
        const subKey = `user:${user.id}:push-config`;
        const configRaw = await redis.get(subKey);
        
        let config = configRaw ? JSON.parse(configRaw) : null;
        
        // Redis 설정이 없거나 신규 시간/지역 정보가 없으면 Supabase에서 복구 및 초기화
        if (!config || !config.settings || !config.settings.briefingTime) {
            const client = supabaseAdmin || supabase;
            const { data: profile } = await client
                .from('profiles')
                .select('briefing_time, weather_region')
                .eq('id', user.id)
                .maybeSingle();
            
            const settings = {
                alarm60: config?.settings?.alarm60 ?? false,
                alarm30: config?.settings?.alarm30 ?? true,
                alarm10: config?.settings?.alarm10 ?? true,
                briefingTime: profile?.briefing_time || '08:00',
                weatherRegion: profile?.weather_region || '서울'
            };
            
            config = {
                subscription: config?.subscription || null,
                settings,
                providerToken: config?.providerToken || '',
                email: user.email
            };
            
            // Redis 캐시 갱신
            await redis.set(subKey, JSON.stringify(config));
        }
        
        return res.json({
            success: true,
            config,
            pushEnabled
        });
    } catch (error) {
        console.error('Get Subscription Error:', error);
        return sendError(res, 500, '구독 설정 조회 실패');
    }
});

// 2. 푸시 알림 구독 및 설정 정보 등록 엔드포인트
router.post('/subscribe', verifyUser, async (req, res) => {
    try {
        const { subscription, settings } = req.body;
        const user = req.user;
        const providerToken = req.headers['x-provider-token'] || '';

        if (!settings) {
            return sendError(res, 400, '알림 설정이 필요합니다.');
        }

        const subKey = `user:${user.id}:push-config`;

        // Redis 저장
        await redis.set(
            subKey,
            JSON.stringify({
                subscription,
                settings,
                providerToken,
                email: user.email
            })
        );

        // Supabase Profiles 테이블 동기화 (예약 발송 시간, 기상 정보 설정 지역)
        try {
            const client = supabaseAdmin || supabase;
            await client
                .from('profiles')
                .upsert({
                    id: user.id,
                    briefing_time: settings.briefingTime || '08:00',
                    weather_region: settings.weatherRegion || '서울'
                }, { onConflict: 'id' });
        } catch (e) {
            console.error('Supabase profiles subscribe settings sync failed:', e);
        }

        return res.json({
            success: true,
            pushEnabled
        });
    } catch (error) {
        console.error('Subscription Error:', error);
        return sendError(res, 500, '구독 저장 실패');
    }
});

// 2. 백그라운드 푸시 알람 디스패처 기동 함수 (60초마다 수행)
function startPushDispatcher() {
    if (!pushEnabled) {
        console.warn('--- [PUSH DISPATCHER] Push notifications disabled. Background worker skipped. ---');
        return;
    }
    
    console.log('--- [PUSH DISPATCHER] Background worker initialized. Running every 60s. ---');
    
    const { generateBriefing } = require('./briefing');
    
    setInterval(async () => {
        try {
            const keys = await scanRedisKeys('user:*:push-config');
            if (keys.length === 0) return;

            const now = new Date();
            
            // KST 기준 현재 HH:MM 계산 (타임존 독립적 포맷터 적용)
            const formatter = new Intl.DateTimeFormat('en-US', {
                timeZone: 'Asia/Seoul',
                hour: '2-digit',
                minute: '2-digit',
                hourCycle: 'h23'
            });
            const parts = formatter.formatToParts(now);
            const hour = parts.find(p => p.type === 'hour').value;
            const minute = parts.find(p => p.type === 'minute').value;
            const currentHourMin = `${hour}:${minute}`; // 예: "08:00"

            const todayStr = now.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }).substring(0, 12).replace(/\s/g, ''); // "2026.5.22."

            for (const key of keys) {
                const data = await redis.get(key);
                if (!data) continue;

                let parsed;
                try {
                    parsed = JSON.parse(data);
                } catch {
                    continue;
                }

                const { subscription, settings, providerToken, email } = parsed;
                if (!subscription || !settings) continue;
                
                const userId = key.split(':')[1];

                // ----------------------------------------------------
                // [⏰ FEATURE A] 사용자가 지정한 아침 예약 브리핑 푸시 알림
                // ----------------------------------------------------
                const targetBriefingTime = settings.briefingTime || '08:00';
                if (currentHourMin === targetBriefingTime) {
                    const briefingSentKey = `push:${key}:briefing_sent:${todayStr}`;
                    const alreadyBriefed = await redis.get(briefingSentKey);
                    
                    if (!alreadyBriefed) {
                        // 중복 발송 차단용 분산 락 즉시 획득 (24시간 만료)
                        await redis.set(briefingSentKey, '1', 'EX', 86400);
                        
                        console.log(`--- [PUSH DISPATCHER] Generating daily briefing for user ${email} at KST ${currentHourMin}... ---`);
                        
                        try {
                            const briefing = await generateBriefing(userId, providerToken);
                            
                            // HTML 태그 및 마크다운 볼드 기호 정제
                            const cleanBriefing = briefing
                                .replace(/<br>/g, '\n')
                                .replace(/<strong[^>]*>(.*?)<\/strong>/g, '$1')
                                .replace(/\*\*(.*?)\*\*/g, '$1');
                            
                            const payload = JSON.stringify({
                                title: `🎩 오늘의 수석 비서관 브리핑`,
                                body: cleanBriefing.length > 200 ? cleanBriefing.substring(0, 197) + '...' : cleanBriefing
                            });

                            await webpush.sendNotification(subscription, payload);
                            console.log(`[Push Sent] Daily Briefing To: ${email} successfully sent.`);
                        } catch (err) {
                            console.error(`[Push Sent Failed] Daily Briefing To: ${email}, Error:`, err.message);
                        }
                    }
                }

                // ----------------------------------------------------
                // [🔔 FEATURE B] 구글 캘린더 약속 일정 10분/30분/60분 전 푸시 알람
                // ----------------------------------------------------
                if (providerToken && providerToken !== 'mock' && providerToken !== 'null') {
                    const timeMin = now.toISOString();
                    const timeMax = new Date(now.getTime() + 65 * 60 * 1000).toISOString();

                    const calUrl =
                        'https://www.googleapis.com/calendar/v3/calendars/primary/events' +
                        `?timeMin=${encodeURIComponent(timeMin)}` +
                        `&timeMax=${encodeURIComponent(timeMax)}` +
                        '&singleEvents=true';

                    try {
                        const calRes = await fetchWithTimeout(
                            calUrl,
                            {
                                headers: { Authorization: `Bearer ${providerToken}` }
                            },
                            10000
                        );

                        const calData = await calRes.json();
                        if (calData?.items) {
                            for (const event of calData.items) {
                                const startTime = new Date(event.start?.dateTime || event.start?.date);
                                if (Number.isNaN(startTime.getTime())) continue;

                                const diffMin = Math.round((startTime - now) / 60000);

                                const shouldNotify =
                                    (settings.alarm10 && diffMin === 10) ||
                                    (settings.alarm30 && diffMin === 30) ||
                                    (settings.alarm60 && diffMin === 60);

                                if (!shouldNotify) continue;

                                const notifyKey = `push:${key}:${event.id}:${diffMin}`;
                                const alreadySent = await redis.get(notifyKey);
                                if (alreadySent) continue;

                                await redis.set(notifyKey, '1', 'EX', 120);

                                const payload = JSON.stringify({
                                    title: `🔔 일정 알람 (${diffMin}분 전)`,
                                    body: `[${event.summary || '제목 없음'}] 일정이 곧 시작됩니다. 준비되셨나요?`
                                });

                                try {
                                    await webpush.sendNotification(subscription, payload);
                                    console.log(
                                        `[Push Sent] To: ${email}, Event: ${event.summary}, Time: ${diffMin}m before`
                                    );
                                } catch (error) {
                                    console.error('Push Send Error:', error.message);
                                }
                            }
                        }
                    } catch (calErr) {
                        console.error(`Calendar fetch inside dispatcher failed for ${email}:`, calErr.message);
                    }
                }
            }
        } catch (error) {
            console.error('Dispatcher Error:', error.message);
        }
    }, 60000);
}

module.exports = {
    router,
    startPushDispatcher
};
