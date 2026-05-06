const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

async function run() {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY.trim());
  try {
    // In newer versions of the SDK, you can use the API directly to fetch models if needed
    // but usually we just want to test if a model works.
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const result = await model.generateContent("Hi");
    console.log("Response:", result.response.text());
    console.log("gemini-1.5-flash works!");
  } catch (e) {
    console.error("gemini-1.5-flash failed:", e.message);
    
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-pro" });
        const result = await model.generateContent("Hi");
        console.log("Response:", result.response.text());
        console.log("gemini-pro works!");
    } catch (e2) {
        console.error("gemini-pro failed:", e2.message);
    }
  }
}

run();
