const fetchWithTimeout = async (url, options = {}, timeoutMs = 20000, retries = 3) => {
    let lastError;
    for (let i = 0; i <= retries; i++) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);

        try {
            const response = await fetch(url, {
                ...options,
                signal: controller.signal
            });

            if (response.status === 429 && i < retries) {
                let delay = 3000 * (i + 1);
                
                try {
                    const errorData = await response.clone().json();
                    if (errorData.error?.details) {
                        const retryInfo = errorData.error.details.find(d => d['@type']?.includes('RetryInfo'));
                        if (retryInfo?.retryDelay) {
                            const seconds = parseFloat(retryInfo.retryDelay.replace('s', ''));
                            if (!isNaN(seconds)) delay = Math.max(delay, (seconds + 1) * 1000);
                        }
                    }
                } catch (e) { /* ignore parse error */ }

                if (options.failFast && delay > 3000) {
                    console.log(`--- [RETRY BYPASS] 429 Detected but retry delay (${delay}ms) is too long for real-time request. Skipping retry. ---`);
                    lastError = new Error(`429 Too Many Requests (Retry delay ${delay}ms is too long for failFast)`);
                    break;
                }

                console.log(`--- [RETRY] 429 Detected. Waiting ${delay}ms... (Attempt ${i + 1}/${retries})`);
                clearTimeout(timeout);
                await new Promise(resolve => setTimeout(resolve, delay));
                continue;
            }
            return response;
        } catch (err) {
            lastError = err;
            if (i < retries) {
                const wait = err.name === 'AbortError' ? 1000 : 1500;
                console.warn(`--- [WARN] Fetch error (Attempt ${i + 1}): ${err.message}. Retrying...`);
                await new Promise(resolve => setTimeout(resolve, wait));
                continue;
            }
        } finally {
            clearTimeout(timeout);
        }
    }
    throw lastError;
};

module.exports = {
    fetchWithTimeout
};
