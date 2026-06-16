const { DEFAULT_MODEL, MODEL_FALLBACKS, cleanApiKey } = require('../config/env');
const { fetchWithTimeout } = require('../utils/fetchUtils');

const getGeminiUrl = (model = DEFAULT_MODEL) => {
    return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${cleanApiKey}`;
};

const callLocalLLM = async (prompt) => {
    const localUrls = [
        process.env.LOCAL_LLM_URL, 
        'http://localhost:11434/v1/chat/completions', 
        'http://localhost:1234/v1/chat/completions'   
    ].filter(Boolean);

    for (const url of localUrls) {
        try {
            console.log(`--- [LOCAL LLM] Attempting local model at: ${url}`);
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: process.env.LOCAL_LLM_MODEL || 'local-model',
                    messages: [{ role: 'user', content: prompt }],
                    temperature: 0.7
                })
            });

            if (response.ok) {
                const data = await response.json();
                const text = data.choices?.[0]?.message?.content;
                if (text) {
                    console.log(`--- [LOCAL LLM SUCCESS] Successfully retrieved answer from: ${url}`);
                    return {
                        candidates: [{
                            content: {
                                parts: [{ text }]
                            }
                        }]
                    };
                }
            }
        } catch (e) {
            console.warn(`--- [LOCAL LLM WARN] Failed to connect to local model at ${url}: ${e.message}`);
        }
    }
    throw new Error('All Local LLM endpoints failed.');
};

const callGemini = async (prompt, generationConfig = {}, retries = 3, inlineData = null, failFast = false, timeoutMs = 25000, tools = null) => {
    if (process.env.USE_LOCAL_LLM === 'true') {
        try {
            return await callLocalLLM(prompt);
        } catch (e) {
            console.warn('--- [LOCAL LLM FAILURE] Direct local LLM failed, falling back to Gemini Cloud...');
        }
    }

    const modelsToTry = [DEFAULT_MODEL, ...MODEL_FALLBACKS];
    let lastError;

    for (const model of modelsToTry) {
        try {
            console.log(`--- [GEMINI] Attempting with model: ${model}`);
            const parts = [{ text: prompt }];
            if (inlineData) {
                parts.push({
                    inlineData: {
                        mimeType: inlineData.mimeType,
                        data: inlineData.data
                    }
                });
            }

            const requestBody = {
                contents: [{ parts }],
                generationConfig
            };
            if (tools) {
                requestBody.tools = tools;
            }

            const response = await fetchWithTimeout(
                getGeminiUrl(model),
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(requestBody),
                    failFast
                },
                timeoutMs,
                retries
            );

            if (response.ok) {
                const data = await response.json();
                if (data.candidates && data.candidates.length > 0) {
                    return data;
                }
                throw new Error(JSON.stringify(data));
            } else {
                const text = await response.text();
                throw new Error(`HTTP ${response.status}: ${text}`);
            }
        } catch (err) {
            console.error(`--- [GEMINI ERROR] Model ${model} failed: ${err.message} ---`);
            lastError = err;
            if (failFast) {
                break;
            }
        }
    }

    try {
        console.warn('--- [FALLBACK] Gemini Cloud failed. Falling back to local LLM...');
        return await callLocalLLM(prompt);
    } catch (localErr) {
        console.error('--- [CRITICAL] Both Cloud Gemini and Local LLM fallbacks failed.');
        throw lastError || localErr;
    }
};

module.exports = {
    getGeminiUrl,
    callGemini
};
