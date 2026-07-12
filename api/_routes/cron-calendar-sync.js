const { redis } = require('./shared');
const pushRepository = require('../_repositories/pushRepository');
const calendarSyncService = require('../_services/calendarSyncService');

module.exports = async (req, res) => {
    // 1. CRON_SECRET 보안 검증
    const authHeader = req.headers.authorization;
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        console.log('--- [CRON SYNC] Starting Calendar Sync Cron Job ---');

        // 2. 전체 유저 설정 조회
        const allUsers = await pushRepository.getAllUsersSubscriptions();
        
        // 3. 연동 활성화된 유저 필터링
        const enabledUsers = allUsers.filter(u => u.config?.settings?.googleCalendarEnabled === true);
        
        if (enabledUsers.length === 0) {
            console.log('--- [CRON SYNC] No users with googleCalendarEnabled = true ---');
            return res.json({ success: true, message: 'No enabled users' });
        }

        // 4. last_calendar_synced_at 기준 정렬 (오래된 순)
        const userSyncTimes = await Promise.all(enabledUsers.map(async (u) => {
            const timeStr = await redis.get(`user:${u.userId}:last_calendar_synced_at`);
            return {
                userId: u.userId,
                settings: u.config.settings,
                lastSyncTime: timeStr ? new Date(timeStr).getTime() : 0
            };
        }));

        userSyncTimes.sort((a, b) => a.lastSyncTime - b.lastSyncTime);

        // 5. 50명 Batch Limit 적용
        const batch = userSyncTimes.slice(0, 50);
        console.log(`--- [CRON SYNC] Processing batch of ${batch.length} users ---`);

        const results = {
            successCount: 0,
            failCount: 0,
            errors: []
        };

        // 6. 동기화 실행
        for (const user of batch) {
            try {
                const syncOptions = {
                    selectedCalendars: user.settings.selectedGoogleCalendars || []
                };
                
                await calendarSyncService.syncGoogleCalendarToLocal(user.userId, syncOptions);
                
                // 성공 시 동기화 시간 갱신
                await redis.set(`user:${user.userId}:last_calendar_synced_at`, new Date().toISOString());
                results.successCount++;
            } catch (err) {
                console.error(`--- [CRON SYNC] Error syncing user ${user.userId}: ${err.message} ---`);
                results.failCount++;
                results.errors.push({ userId: user.userId, error: err.message });
                // 실패한 경우 다음 크론에서 재시도할 수 있도록 시간을 갱신하지 않음
            }
        }

        console.log(`--- [CRON SYNC] Completed. Success: ${results.successCount}, Fail: ${results.failCount} ---`);
        return res.json({ success: true, ...results });
    } catch (err) {
        console.error('--- [CRON SYNC] Fatal Error ---', err);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};
