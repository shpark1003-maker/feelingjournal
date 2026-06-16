const webpush = require('web-push');

const pushEnabled = !!process.env.VAPID_PUBLIC_KEY && !!process.env.VAPID_PRIVATE_KEY;
if (pushEnabled) {
    webpush.setVapidDetails(
        process.env.VAPID_SUBJECT || process.env.VAPID_EMAIL || 'mailto:shpark1003@gmail.com',
        process.env.VAPID_PUBLIC_KEY,
        process.env.VAPID_PRIVATE_KEY
    );
}

module.exports = {
    pushEnabled,
    webpush
};
