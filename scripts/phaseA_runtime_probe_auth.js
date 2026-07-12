'use strict';

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const rootDir = path.resolve(__dirname, '..');
const outputDir = path.join(rootDir, 'scratch', 'phaseA');
const jsonPath = path.join(outputDir, 'runtime_probe_auth.json');
const reportPath = path.join(outputDir, 'runtime_probe_auth_report.md');
const screenshotPath = path.join(outputDir, 'runtime_probe_auth.png');

const targetUrl = process.env.PHASE_A_URL || 'http://127.0.0.1:3000/';
const loginEmail = process.env.PHASE_A_EMAIL || '';
const loginPassword = process.env.PHASE_A_PASSWORD || '';
let currentStage = 'init';

function ensureDir(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
}

function formatKb(bytes) {
    return `${(bytes / 1024).toFixed(1)} KB`;
}

function formatPercent(usedBytes, totalBytes) {
    if (!totalBytes) return '0.0%';
    return `${((usedBytes / totalBytes) * 100).toFixed(1)}%`;
}

function summarizeCoverage(entries) {
    const normalized = entries.map(entry => {
        const usedBytes = entry.ranges.reduce((sum, range) => sum + (range.end - range.start - 1), 0);
        return {
            url: entry.url || '(inline)',
            totalBytes: entry.text.length,
            usedBytes,
            unusedBytes: Math.max(entry.text.length - usedBytes, 0)
        };
    });

    normalized.sort((a, b) => b.totalBytes - a.totalBytes);

    return {
        entries: normalized,
        totalBytes: normalized.reduce((sum, entry) => sum + entry.totalBytes, 0),
        usedBytes: normalized.reduce((sum, entry) => sum + entry.usedBytes, 0),
        unusedBytes: normalized.reduce((sum, entry) => sum + entry.unusedBytes, 0)
    };
}

function buildReport(data) {
    const lines = [];
    lines.push('# Phase A Runtime Probe Report (Authenticated Path)');
    lines.push('');
    lines.push(`- URL: ${data.url}`);
    lines.push(`- Timestamp: ${data.generatedAt}`);
    lines.push('');
    lines.push('## Flow');
    lines.push('');
    lines.push('1. Open app entry URL');
    lines.push('2. Login with PHASE_A_EMAIL / PHASE_A_PASSWORD');
    lines.push('3. Wait for authenticated shell');
    lines.push('4. Enter journal tab, then calendar tab, then chat tab');
    lines.push('5. Capture runtime/network/coverage snapshot');
    lines.push('');
    lines.push('## Step Timings');
    lines.push('');
    lines.push(`- Login submit to auth shell: ${data.timings.authShellReadyMs} ms`);
    lines.push(`- Journal tab settle: ${data.timings.journalTabSettleMs} ms`);
    lines.push(`- Calendar tab settle: ${data.timings.calendarTabSettleMs} ms`);
    lines.push(`- Chat tab settle: ${data.timings.chatTabSettleMs} ms`);
    lines.push(`- Total probe time: ${data.timings.totalProbeMs} ms`);
    lines.push('');
    lines.push('## Core Metrics');
    lines.push('');
    lines.push(`- JS heap used: ${formatKb(data.memory.jsHeapUsedSize)}`);
    lines.push(`- JS heap total: ${formatKb(data.memory.jsHeapTotalSize)}`);
    lines.push(`- DOM nodes: ${data.memory.nodes}`);
    lines.push(`- Event listeners: ${data.memory.jsEventListeners}`);
    lines.push('');
    lines.push('## Network Summary');
    lines.push('');
    lines.push(`- Requests captured: ${data.network.requestCount}`);
    lines.push(`- Encoded bytes: ${formatKb(data.network.totalEncodedBytes)}`);
    lines.push(`- Script bytes: ${formatKb(data.network.scriptEncodedBytes)}`);
    lines.push(`- Stylesheet bytes: ${formatKb(data.network.stylesheetEncodedBytes)}`);
    lines.push(`- Image bytes: ${formatKb(data.network.imageEncodedBytes)}`);
    lines.push(`- Third-party requests: ${data.network.thirdPartyRequests}`);
    lines.push('');
    lines.push('## JS Coverage');
    lines.push('');
    lines.push(`- Total bytes: ${formatKb(data.coverage.js.totalBytes)}`);
    lines.push(`- Used bytes: ${formatKb(data.coverage.js.usedBytes)} (${formatPercent(data.coverage.js.usedBytes, data.coverage.js.totalBytes)})`);
    lines.push(`- Unused bytes: ${formatKb(data.coverage.js.unusedBytes)} (${formatPercent(data.coverage.js.unusedBytes, data.coverage.js.totalBytes)})`);
    lines.push('');
    lines.push('## CSS Coverage');
    lines.push('');
    lines.push(`- Total bytes: ${formatKb(data.coverage.css.totalBytes)}`);
    lines.push(`- Used bytes: ${formatKb(data.coverage.css.usedBytes)} (${formatPercent(data.coverage.css.usedBytes, data.coverage.css.totalBytes)})`);
    lines.push(`- Unused bytes: ${formatKb(data.coverage.css.unusedBytes)} (${formatPercent(data.coverage.css.usedBytes, data.coverage.css.totalBytes)})`);
    lines.push('');
    lines.push('## Top Requests By Encoded Size');
    lines.push('');
    data.network.requests
        .slice()
        .sort((a, b) => b.encodedDataLength - a.encodedDataLength)
        .slice(0, 15)
        .forEach((request, index) => {
            lines.push(`${index + 1}. ${request.type} | ${formatKb(request.encodedDataLength)} | ${request.url}`);
        });
    lines.push('');
    lines.push('## Notes');
    lines.push('');
    lines.push('1. This probe requires local credentials via PHASE_A_EMAIL and PHASE_A_PASSWORD.');
    lines.push('2. Keep this probe separate from unauthenticated first-load probe for trend clarity.');
    return `${lines.join('\n')}\n`;
}

async function waitForVisible(page, selector, timeout = 60000) {
    await page.waitForSelector(selector, { visible: true, timeout });
}

async function clickTab(page, tabName) {
    const selector = `.tab-btn[data-tab="${tabName}"]`;
    await waitForVisible(page, selector);
    await page.click(selector);
    await page.waitForNetworkIdle({ idleTime: 600, timeout: 120000 });
}

async function main() {
    currentStage = 'validate-env';
    if (!loginEmail || !loginPassword) {
        throw new Error('Missing PHASE_A_EMAIL or PHASE_A_PASSWORD environment variables.');
    }

    currentStage = 'prepare-output';
    ensureDir(outputDir);

    currentStage = 'launch-browser';
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    try {
        currentStage = 'open-page';
        const page = await browser.newPage();
        await page.setViewport({ width: 1440, height: 1024, deviceScaleFactor: 1 });

        let authDialogMessage = '';
        let rejectAuthDialog;
        const authDialogPromise = new Promise((_, reject) => {
            rejectAuthDialog = reject;
        });
        page.on('dialog', async dialog => {
            authDialogMessage = dialog.message();
            await dialog.dismiss();
            if (rejectAuthDialog) {
                rejectAuthDialog(new Error(`Authentication dialog: ${authDialogMessage}`));
            }
        });

        const client = await page.target().createCDPSession();
        await client.send('Network.enable');

        const requests = new Map();
        client.on('Network.responseReceived', event => {
            requests.set(event.requestId, {
                url: event.response.url,
                status: event.response.status,
                type: event.type,
                mimeType: event.response.mimeType,
                encodedDataLength: 0
            });
        });
        client.on('Network.loadingFinished', event => {
            const request = requests.get(event.requestId);
            if (request) {
                request.encodedDataLength = event.encodedDataLength || 0;
            }
        });

        await page.coverage.startJSCoverage({ resetOnNavigation: false });
        await page.coverage.startCSSCoverage({ resetOnNavigation: false });

        const probeStart = Date.now();
        currentStage = 'navigate-entry';
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });

        currentStage = 'wait-login-form';
        await waitForVisible(page, '#email');
        await waitForVisible(page, '#password');

        currentStage = 'fill-login-form';
        await page.$eval('#email', (el, value) => { el.value = value; }, loginEmail);
        await page.$eval('#password', (el, value) => { el.value = value; }, loginPassword);

        const loginStart = Date.now();
        currentStage = 'submit-login';
        await Promise.all([
            page.click('#login-btn'),
            Promise.race([
                page.waitForFunction(() => {
                    const journalApp = document.getElementById('journal-app');
                    return !!journalApp && getComputedStyle(journalApp).display !== 'none';
                }, { timeout: 120000 }),
                authDialogPromise
            ])
        ]);
        const authShellReadyMs = Date.now() - loginStart;

        const journalStart = Date.now();
        currentStage = 'open-journal-tab';
        await clickTab(page, 'journal');
        const journalTabSettleMs = Date.now() - journalStart;

        const calendarStart = Date.now();
        currentStage = 'open-calendar-tab';
        await clickTab(page, 'calendar');
        const calendarTabSettleMs = Date.now() - calendarStart;

        const chatStart = Date.now();
        currentStage = 'open-chat-tab';
        await clickTab(page, 'chat');
        const chatTabSettleMs = Date.now() - chatStart;

        currentStage = 'wait-network-idle';
        await page.waitForNetworkIdle({ idleTime: 1000, timeout: 120000 });

        currentStage = 'collect-metrics';
        const metrics = await page.metrics();
        await page.screenshot({ path: screenshotPath, fullPage: false });

        const jsCoverage = summarizeCoverage(await page.coverage.stopJSCoverage());
        const cssCoverage = summarizeCoverage(await page.coverage.stopCSSCoverage());

        const networkRequests = Array.from(requests.values());
        const sameHost = new URL(targetUrl).host;

        const data = {
            generatedAt: new Date().toISOString(),
            url: targetUrl,
            timings: {
                authShellReadyMs,
                journalTabSettleMs,
                calendarTabSettleMs,
                chatTabSettleMs,
                totalProbeMs: Date.now() - probeStart
            },
            memory: {
                jsHeapUsedSize: metrics.JSHeapUsedSize || 0,
                jsHeapTotalSize: metrics.JSHeapTotalSize || 0,
                nodes: metrics.Nodes || 0,
                jsEventListeners: metrics.JSEventListeners || 0
            },
            network: {
                requestCount: networkRequests.length,
                totalEncodedBytes: networkRequests.reduce((sum, request) => sum + request.encodedDataLength, 0),
                scriptEncodedBytes: networkRequests.filter(request => request.type === 'Script').reduce((sum, request) => sum + request.encodedDataLength, 0),
                stylesheetEncodedBytes: networkRequests.filter(request => request.type === 'Stylesheet').reduce((sum, request) => sum + request.encodedDataLength, 0),
                imageEncodedBytes: networkRequests.filter(request => request.type === 'Image').reduce((sum, request) => sum + request.encodedDataLength, 0),
                thirdPartyRequests: networkRequests.filter(request => {
                    try {
                        return new URL(request.url).host !== sameHost;
                    } catch (error) {
                        return false;
                    }
                }).length,
                requests: networkRequests
            },
            coverage: {
                js: jsCoverage,
                css: cssCoverage
            }
        };

        currentStage = 'write-artifacts';
        fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2));
        fs.writeFileSync(reportPath, buildReport(data));

        console.log(`Wrote runtime auth data: ${path.relative(rootDir, jsonPath).split(path.sep).join('/')}`);
        console.log(`Wrote runtime auth report: ${path.relative(rootDir, reportPath).split(path.sep).join('/')}`);
        console.log(`Wrote runtime auth screenshot: ${path.relative(rootDir, screenshotPath).split(path.sep).join('/')}`);
        currentStage = 'done';
    } finally {
        await browser.close();
    }
}

main().catch(error => {
    const message = error && error.message ? error.message : String(error);
    console.error(`Probe failed at stage: ${currentStage}`);
    console.error(`Reason: ${message}`);
    process.exitCode = 1;
});
