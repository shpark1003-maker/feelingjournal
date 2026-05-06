const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config({ override: true });

async function listModels() {
    try {
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY.trim());
        const result = await genAI.listModels();
        console.log('--- Available Models ---');
        result.models.forEach(model => {
            console.log(`Name: ${model.name}, DisplayName: ${model.displayName}, Methods: ${model.supportedGenerationMethods}`);
        });
        console.log('-------------------------');
    } catch (error) {
        console.error('Error listing models:', error);
    }
}

listModels();
