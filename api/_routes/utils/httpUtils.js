function isSafeUrl(urlStr) {
    try {
        const url = new URL(urlStr);
        if (!['http:', 'https:'].includes(url.protocol)) return false;
        const hostname = url.hostname.toLowerCase();
        
        const blockedHosts = [
            'localhost', '127.0.0.1', '::1', '0.0.0.0',
            '169.254.169.254', // Cloud Metadata Service
        ];
        if (blockedHosts.includes(hostname)) return false;

        const isInternalIp = /^(10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.)/.test(hostname);
        if (isInternalIp) return false;

        return true;
    } catch (e) {
        return false;
    }
}

const sendError = (res, status, message) => {
    return res.status(status).json({
        success: false,
        error: message
    });
};

module.exports = {
    isSafeUrl,
    sendError
};
