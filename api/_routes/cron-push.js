const { dispatchPushNotifications } = require('./push');

module.exports = async (req, res) => {
    if (req.method === 'OPTIONS') return res.status(200).end();

    // CRON_SECRET 환경변수가 설정되어 있는 경우 인증 확인
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret) {
        const authHeader = req.headers.authorization;
        if (!authHeader || authHeader !== `Bearer ${cronSecret}`) {
            console.warn('--- [CRON ACCESS DENIED] Invalid or missing CRON_SECRET token ---');
            return res.status(401).json({ error: 'Unauthorized: Invalid Cron Secret' });
        }
    }

    try {
        console.log('--- [CRON] Triggered push dispatcher from Serverless environment ---');
        await dispatchPushNotifications();
        return res.json({ success: true, message: 'Serverless push dispatch executed successfully.' });
    } catch (error) {
        console.error('--- [CRON ERROR] Push dispatcher failed:', error.message);
        return res.status(500).json({ error: error.message });
    }
};
