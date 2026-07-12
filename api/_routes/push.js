const express = require('express');
const router = express.Router();

const { 
    redis, 
    verifyUser, 
    sendError, 
    supabase,
    supabaseAdmin,
    scanRedisKeys
} = require('./shared');

const pushRepository = require('../_repositories/pushRepository');
const pushService = require('../_services/pushService');

// 1. 푸시 알림 및 브리핑 설정 정보 조회 엔드포인트
router.get('/subscribe', verifyUser, async (req, res) => {
    try {
        const user = req.user;
        const config = await pushRepository.getUserSubscriptions(user.id);
        
        // Redis 설정이 없거나 신규 시간/지역 정보가 없으면 Supabase에서 복구 및 초기화
        if (!config || !config.settings || !config.settings.briefingTime) {
            const client = supabaseAdmin || supabase;
            const { data: profile } = await client
                .from('profiles')
                .select('briefing_time, weather_region, news_categories')
                .eq('id', user.id)
                .maybeSingle();
            
            config.settings = {
                alarm60: config?.settings?.alarm60 ?? false,
                alarm30: config?.settings?.alarm30 ?? true,
                alarm10: config?.settings?.alarm10 ?? true,
                briefingTime: profile?.briefing_time || '08:00',
                weatherRegion: profile?.weather_region || '서울',
                newsCategories: config?.settings?.newsCategories || profile?.news_categories || ['business']
            };
            config.email = user.email;
            
            // Redis 캐시 갱신
            await pushRepository.saveUserSubscriptions(user.id, config);
        }
        
        return res.json({
            success: true,
            config,
            pushEnabled: pushService.isPushEnabled(),
            vapidPublicKey: pushService.getVapidPublicKey()
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

        // Upsert를 통해 다중 기기/브라우저 구독 정보가 덮어씌워지지 않고 중복 없이 축적되도록 설정
        const config = await pushRepository.upsertSubscription(
            user.id,
            subscription,
            settings,
            user.email,
            providerToken
        );

        // Supabase Profiles 테이블 동기화 (예약 발송 시간, 기상 정보 설정 지역)
        try {
            const client = supabaseAdmin || supabase;
            await client
                .from('profiles')
                .upsert({
                    id: user.id,
                    briefing_time: settings.briefingTime || '08:00',
                    weather_region: settings.weatherRegion || '서울',
                    news_categories: settings.newsCategories || ['business']
                }, { onConflict: 'id' });
        } catch (e) {
            console.error('Supabase profiles subscribe settings sync failed:', e);
        }

        return res.json({
            success: true,
            pushEnabled: pushService.isPushEnabled()
        });
    } catch (error) {
        console.error('Subscription Error:', error);
        return sendError(res, 500, '구독 저장 실패');
    }
});

// 3. 테스트 푸시 발송 엔드포인트
router.post('/subscribe/test', verifyUser, async (req, res) => {
    try {
        const user = req.user;
        const config = await pushRepository.getUserSubscriptions(user.id);
        
        if (!config || !config.subscriptions || config.subscriptions.length === 0) {
            return res.json({
                success: false,
                message: '등록된 푸시 알림 구독 정보가 없습니다. 설정을 먼저 저장하고 알림 권한을 승인해주세요.'
            });
        }

        const payload = {
            title: `🔔 테스트 푸시 알람`,
            body: `테스트 알람이 정상 작동 중입니다! 수석 비서관 브리핑 수신 준비 완료.`
        };

        const successCount = await pushService.sendToUserSubscriptions(config, payload);
        
        // 만약 유효하지 않은 구독 정보가 지워진 경우 변경사항 반영
        await pushRepository.saveUserSubscriptions(user.id, config);

        return res.json({
            success: true,
            message: `테스트 푸시가 성공적으로 전송되었습니다. (성공 디바이스: ${successCount}개)`
        });
    } catch (error) {
        console.error('Test Push Error:', error);
        return sendError(res, 500, `테스트 푸시 전송 실패: ${error.message}`);
    }
});

// 4. 1촌 예약 메시지/선물 등록 엔드포인트
router.post('/schedule-message', verifyUser, async (req, res) => {
    try {
        const { toId, roomId, message, sendAt } = req.body;
        const user = req.user;

        if (!toId || !roomId || !message || !sendAt) {
            return sendError(res, 400, '모든 필수 매개변수(toId, roomId, message, sendAt)가 필요합니다.');
        }

        const sendTime = new Date(sendAt);
        if (isNaN(sendTime.getTime())) {
            return sendError(res, 400, '올바르지 않은 예약 시간 형식입니다.');
        }

        if (sendTime <= new Date()) {
            return sendError(res, 400, '예약 발송 시간은 미래 시간이어야 합니다.');
        }

        // Redis 예약 등록
        const timestamp = sendTime.getTime();
        const scheduleKey = `user:${user.id}:scheduled-msg:${toId}:${timestamp}`;
        const scheduleData = {
            fromId: user.id,
            fromEmail: user.email,
            toId,
            roomId,
            message,
            sendAt: sendTime.toISOString()
        };

        await redis.set(scheduleKey, JSON.stringify(scheduleData));
        console.log(`--- [SCHEDULED MESSAGE REGISTERED] Key: ${scheduleKey} ---`);

        return res.json({
            success: true,
            message: '메시지가 성공적으로 예약되었습니다.'
        });
    } catch (error) {
        console.error('Schedule Message API Error:', error);
        return sendError(res, 500, '메시지 예약 실패');
    }
});

// 5. 백그라운드 푸시 알람 디스패처 기동 함수
async function dispatchPushNotifications() {
    if (!pushService.isPushEnabled()) {
        console.warn('--- [PUSH DISPATCHER] Push notifications disabled. Dispatch skipped. ---');
        return;
    }

    const { generateBriefing } = require('./briefing');
    
    try {
        // [💌 FEATURE C] 1촌 간의 예약 메시지 & 선물 발송 디스패처
        const scheduledKeys = await scanRedisKeys('user:*:scheduled-msg:*');
        if (scheduledKeys.length > 0) {
            const nowTime = new Date();
            const scheduledValues = await redis.mget(scheduledKeys);
            
            for (let i = 0; i < scheduledKeys.length; i++) {
                const key = scheduledKeys[i];
                const value = scheduledValues[i];
                if (!value) continue;
                
                try {
                    const item = JSON.parse(value);
                    const sendTime = new Date(item.sendAt);
                    
                    if (sendTime <= nowTime) {
                        console.log(`--- [PUSH DISPATCHER] Dispatching scheduled message from ${item.fromEmail || item.fromId} to room: ${item.roomId} ---`);
                        
                        // 1. Supabase 'messages' 테이블에 발송 인서트
                        const client = supabaseAdmin || supabase;
                        const { error: dbError } = await client
                            .from('messages')
                            .insert([{
                                content: item.message,
                                sender_id: item.fromId,
                                room_id: item.roomId,
                                created_at: new Date().toISOString()
                            }]);
                            
                        if (dbError) {
                            console.error('Failed to insert scheduled message:', dbError.message);
                        }
                        
                        // 2. 수신자의 push-subscriptions 조회하여 Web Push 발송
                        const toUserConfig = await pushRepository.getUserSubscriptions(item.toId);
                        if (toUserConfig && toUserConfig.subscriptions && toUserConfig.subscriptions.length > 0) {
                            const payload = {
                                title: `💌 예약된 마음 배달 완료`,
                                body: item.message.length > 100 ? item.message.substring(0, 97) + '...' : item.message
                            };
                            const sent = await pushService.sendToUserSubscriptions(toUserConfig, payload);
                            if (sent > 0) {
                                console.log(`[Push Sent] Scheduled Message Push Sent successfully to ${sent} devices.`);
                                await pushRepository.saveUserSubscriptions(item.toId, toUserConfig);
                            }
                        }
                        
                        // 3. 발송 완료된 예약 키 제거
                        await redis.del(key);
                    }
                } catch (err) {
                    console.error('Scheduled Message Dispatch Error:', err.message);
                }
            }
        }

        const usersList = await pushRepository.getAllUsersSubscriptions();
        if (usersList.length === 0) return;

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

        const kstTimeForDate = new Date(now.getTime() + 9 * 60 * 60 * 1000);
        const todayStr = `${kstTimeForDate.getUTCFullYear()}-${kstTimeForDate.getUTCMonth() + 1}-${kstTimeForDate.getUTCDate()}`;

        for (const { userId, config } of usersList) {
            if (!config.settings) continue;
            if (!config.subscriptions || config.subscriptions.length === 0) continue;
            
            const { settings, providerToken, email } = config;

            // ----------------------------------------------------
            // [⏰ FEATURE A] 사용자가 지정한 아침 예약 브리핑 푸시 알림
            // ----------------------------------------------------
            const targetBriefingTime = settings.briefingTime || '08:00';
            
            // KST 시간 기준으로 현재 분단위와 목표 분단위 비교 (Vercel 하루 1회 크론 및 로컬 24시간 대응)
            const [targetHour, targetMin] = targetBriefingTime.split(':').map(Number);
            const currentHour = parseInt(hour, 10);
            const currentMin = parseInt(minute, 10);
            
            const targetMinutes = targetHour * 60 + targetMin;
            const currentMinutes = currentHour * 60 + currentMin;
            
            if (currentMinutes >= targetMinutes) {
                const briefingSentKey = `push:${userId}:briefing_sent:${todayStr}`;
                const alreadyBriefed = await redis.get(briefingSentKey);
                
                if (!alreadyBriefed) {
                    await redis.set(briefingSentKey, '1', 'EX', 86400);
                    
                    console.log(`--- [PUSH DISPATCHER] Generating daily briefing for user ${email} at KST ${currentHourMin}... ---`);
                    
                    try {
                        let briefingResult = await generateBriefing(userId, providerToken);
                        const briefingText = (briefingResult && typeof briefingResult === 'object') ? briefingResult.briefing : briefingResult;
                        
                        const cleanBriefing = (briefingText || '')
                            .replace(/<br>/g, '\n')
                            .replace(/<strong[^>]*>(.*?)<\/strong>/g, '$1')
                            .replace(/\*\*(.*?)\*\*/g, '$1');
                        
                        const payload = {
                            title: `🎩 오늘의 수석 비서관 브리핑`,
                            body: cleanBriefing.length > 200 ? cleanBriefing.substring(0, 197) + '...' : cleanBriefing
                        };

                        const sent = await pushService.sendToUserSubscriptions(config, payload);
                        console.log(`[Push Sent] Daily Briefing To: ${email} successfully sent to ${sent} devices.`);
                        await pushRepository.saveUserSubscriptions(userId, config);
                    } catch (err) {
                        console.error(`[Push Sent Failed] Daily Briefing To: ${email}, Error:`, err.message);
                    }
                }
            }

            // ----------------------------------------------------
            // [🔔 FEATURE B] 구글 캘린더 약속 일정 10분/30분/60분 전 푸시 알람
            // ----------------------------------------------------
            if (providerToken && providerToken !== 'mock' && providerToken !== 'null' && providerToken !== 'undefined') {
                const timeMin = now.toISOString();
                const timeMax = new Date(now.getTime() + 65 * 60 * 1000).toISOString();

                const calUrl =
                    'https://www.googleapis.com/calendar/v3/calendars/primary/events' +
                    `?timeMin=${encodeURIComponent(timeMin)}` +
                    `&timeMax=${encodeURIComponent(timeMax)}` +
                    '&singleEvents=true';

                try {
                    const { fetchWithTimeout } = require('./shared');
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

                            const notifyKey = `push:${userId}:${event.id}:${diffMin}`;
                            const alreadySent = await redis.get(notifyKey);
                            if (alreadySent) continue;

                            await redis.set(notifyKey, '1', 'EX', 120);

                            const payload = {
                                title: `🔔 일정 알람 (${diffMin}분 전)`,
                                body: `[${event.summary || '제목 없음'}] 일정이 곧 시작됩니다. 준비되셨나요?`
                            };

                            try {
                                const sent = await pushService.sendToUserSubscriptions(config, payload);
                                console.log(
                                    `[Push Sent] To: ${email}, Event: ${event.summary}, Time: ${diffMin}m before on ${sent} devices`
                                );
                                await pushRepository.saveUserSubscriptions(userId, config);
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
}

function startPushDispatcher() {
    if (!pushService.isPushEnabled()) {
        console.warn('--- [PUSH DISPATCHER] Push notifications disabled. Background worker skipped. ---');
        return;
    }
    
    console.log('--- [PUSH DISPATCHER] Background worker initialized. Running every 60s. ---');
    global.pushDispatcherInterval = setInterval(dispatchPushNotifications, 60000);
}

module.exports = {
    router,
    startPushDispatcher,
    dispatchPushNotifications
};
