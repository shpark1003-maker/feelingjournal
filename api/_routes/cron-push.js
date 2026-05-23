const { dispatchPushNotifications } = require('./push');

module.exports = async (req, res) => {
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        console.log('--- [CRON] Triggered push dispatcher from Serverless environment ---');
        await dispatchPushNotifications();
        return res.json({ success: true, message: 'Serverless push dispatch executed successfully.' });
    } catch (error) {
        console.error('--- [CRON ERROR] Push dispatcher failed:', error.message);
        return res.status(500).json({ error: error.message });
    }
};
