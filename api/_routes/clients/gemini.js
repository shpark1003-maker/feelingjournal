const { DEFAULT_MODEL, MODEL_FALLBACKS, cleanApiKey } = require('../config/env');
const { fetchWithTimeout } = require('../utils/fetchUtils');

const getGeminiUrl = (model = DEFAULT_MODEL) => {
    return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${cleanApiKey}`;
};



const callGemini = async (prompt, generationConfig = {}, retries = 3, inlineData = null, failFast = false, timeoutMs = 25000, tools = null) => {
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
                generationConfig,
                safetySettings: [
                    { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
                    { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
                    { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
                    { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }
                ]
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
        }
    }

    console.error('--- [CRITICAL] All Gemini Cloud models failed.');
    throw lastError;
};

module.exports = {
    getGeminiUrl,
    callGemini
};
