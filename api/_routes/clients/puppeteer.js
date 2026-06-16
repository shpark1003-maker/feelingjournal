let sharedBrowser = null;

async function getBrowserInstance() {
    if (!sharedBrowser || !sharedBrowser.connected) {
        console.log('--- [PUPPETEER] Launching new browser instance ---');
        
        // Lazy loading of Puppeteer dependencies inside the execution block
        if (process.env.VERCEL) {
            console.log('--- [PUPPETEER] Running on Vercel Serverless (Lazy Load) ---');
            const chromium = require('@sparticuz/chromium');
            const puppeteerCore = require('puppeteer-core');
            sharedBrowser = await puppeteerCore.launch({
                args: chromium.args,
                defaultViewport: chromium.defaultViewport,
                executablePath: await chromium.executablePath(),
                headless: chromium.headless,
                ignoreHTTPSErrors: true,
            });
        } else {
            console.log('--- [PUPPETEER] Running on Local Environment (Lazy Load) ---');
            const puppeteer = require('puppeteer');
            sharedBrowser = await puppeteer.launch({
                headless: 'new',
                args: [
                    '--no-sandbox', 
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--disable-gpu'
                ]
            });
        }
    }
    return sharedBrowser;
}

module.exports = {
    getBrowserInstance
};
