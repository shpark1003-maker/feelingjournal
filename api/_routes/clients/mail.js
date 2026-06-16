const nodemailer = require('nodemailer');

const rawPass = process.env.EMAIL_PASS || '';
const cleanPass = rawPass.replace(/\s+/g, '').trim();
const emailConfigured = !!process.env.EMAIL_USER && !!cleanPass && cleanPass !== 'your-google-app-password-here';
let transporter = null;
if (emailConfigured) {
    transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.EMAIL_USER,
            pass: cleanPass
        }
    });
}

module.exports = {
    emailConfigured,
    transporter
};
