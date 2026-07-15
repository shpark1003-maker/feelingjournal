const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://localhost:3000';
const OUTPUT_DIR = path.join(__dirname, '..', 'test', 'visual-baseline');

const VIEWPORTS = [
    { width: 360, height: 800, name: '360' },
    { width: 390, height: 844, name: '390' },
    { width: 768, height: 1024, name: '768' },
    { width: 1440, height: 900, name: '1440' },
];

async function captureBaseline() {
    console.log('Starting visual baseline capture...');
    
    // Ensure output directory exists
    if (!fs.existsSync(OUTPUT_DIR)) {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    const browser = await puppeteer.launch({
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-animations']
    });

    try {
        const page = await browser.newPage();
        
        // 1. Auth View Baseline
        console.log('Navigating to Auth...');
        await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle0' });
        
        // Mask dynamic/varying elements if needed
        await page.evaluate(() => {
            const style = document.createElement('style');
            style.textContent = `
                * { transition: none !important; animation: none !important; caret-color: transparent !important; }
            `;
            document.head.appendChild(style);
        });

        for (const vp of VIEWPORTS) {
            await page.setViewport(vp);
            await new Promise(r => setTimeout(r, 500)); // wait for layout
            const filepath = path.join(OUTPUT_DIR, `auth-${vp.name}.png`);
            await page.screenshot({ path: filepath, fullPage: true });
            console.log(`Saved: ${filepath}`);
        }

        // Login to get to Journal View
        console.log('Logging in to capture internal views...');
        await page.evaluate(() => {
            const emailInput = document.getElementById('email');
            if(emailInput) emailInput.value = 'test@example.com';
            
            const pwdInput = document.getElementById('password');
            if(pwdInput) pwdInput.value = 'password';
            
            const loginBtn = document.getElementById('login-btn');
            if(loginBtn) loginBtn.click();
        });

        await page.waitForSelector('#journal-view.active', { visible: true, timeout: 5000 }).catch(e => console.log('Timeout waiting for journal view'));
        await new Promise(r => setTimeout(r, 1000)); // wait for network calls to settle
        
        // Mask dynamic data in Journal
        await page.evaluate(() => {
            const weatherTemp = document.getElementById('briefing-weather-temp');
            if(weatherTemp) weatherTemp.innerHTML = 'XX°C';
        });

        // 2. Journal View Baseline
        for (const vp of VIEWPORTS) {
            await page.setViewport(vp);
            await new Promise(r => setTimeout(r, 500));
            const filepath = path.join(OUTPUT_DIR, `journal-${vp.name}.png`);
            await page.screenshot({ path: filepath, fullPage: true });
            console.log(`Saved: ${filepath}`);
        }

        // 3. Calendar View Baseline
        console.log('Navigating to Calendar...');
        await page.evaluate(() => {
            const calTab = document.getElementById('nav-calendar-tab');
            if(calTab) calTab.click();
        });
        await page.waitForSelector('#calendar-view.active', { visible: true, timeout: 5000 }).catch(e => console.log('Timeout waiting for calendar view'));
        await new Promise(r => setTimeout(r, 1000));

        for (const vp of VIEWPORTS) {
            await page.setViewport(vp);
            await new Promise(r => setTimeout(r, 500));
            const filepath = path.join(OUTPUT_DIR, `calendar-${vp.name}.png`);
            await page.screenshot({ path: filepath, fullPage: true });
            console.log(`Saved: ${filepath}`);
        }

        // 4. Settings View Baseline
        console.log('Navigating to Settings...');
        await page.evaluate(() => {
            const setTab = document.getElementById('nav-settings-tab');
            if(setTab) setTab.click();
        });
        await page.waitForSelector('#persona-view.active', { visible: true, timeout: 5000 }).catch(e => console.log('Timeout waiting for settings view'));
        await new Promise(r => setTimeout(r, 1000));

        for (const vp of VIEWPORTS) {
            await page.setViewport(vp);
            await new Promise(r => setTimeout(r, 500));
            const filepath = path.join(OUTPUT_DIR, `settings-${vp.name}.png`);
            await page.screenshot({ path: filepath, fullPage: true });
            console.log(`Saved: ${filepath}`);
        }

    } catch (error) {
        console.error('Error during baseline capture:', error);
    } finally {
        await browser.close();
        console.log('Baseline capture complete.');
    }
}

captureBaseline();
