'use strict';
const axios = require('axios');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

async function checkGemini() {
    const apiKey = process.env.GEMINI_API_KEY;
    console.log(`Checking Gemini API for Feeling Journal...`);
    console.log(`Key: ${apiKey ? apiKey.substring(0, 8) + '...' : 'MISSING'}`);
    
    if (!apiKey) {
        console.error('❌ GEMINI_API_KEY is missing in .env');
        return;
    }

    try {
        const r = await axios.get(
            `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
            { timeout: 10000, validateStatus: s => s < 500 }
        );
        if (r.status === 200) {
            console.log(`✅ Gemini API is working! Models found: ${r.data.models.length}`);
        } else {
            console.error(`❌ Gemini API failed with status ${r.status}`);
            console.error(JSON.stringify(r.data, null, 2));
        }
    } catch (e) {
        console.error(`❌ Error checking Gemini API: ${e.message}`);
    }
}

checkGemini();
