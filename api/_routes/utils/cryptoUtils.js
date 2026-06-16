const crypto = require('crypto');

function encrypt(text, masterKey) {
    if (!text) return text;
    if (!masterKey) return text;
    try {
        const key = crypto.createHash('sha256').update(masterKey).digest();
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
        let encrypted = cipher.update(text, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        return `e2e:${iv.toString('hex')}:${encrypted}`;
    } catch (e) {
        console.error('Encryption Error:', e.message);
        return text;
    }
}

function decrypt(encryptedText, masterKey) {
    if (!encryptedText) return encryptedText;
    if (!encryptedText.startsWith('e2e:')) return encryptedText;
    if (!masterKey) return '[Encrypted Document - Please Enter Password]';
    try {
        const parts = encryptedText.split(':');
        const iv = Buffer.from(parts[1], 'hex');
        const encrypted = parts[2];
        const key = crypto.createHash('sha256').update(masterKey).digest();
        const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
        let decrypted = decipher.update(encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    } catch (e) {
        console.error('Decryption Error:', e.message);
        return '[Decryption Failed - Invalid Password]';
    }
}

module.exports = {
    encrypt,
    decrypt
};
