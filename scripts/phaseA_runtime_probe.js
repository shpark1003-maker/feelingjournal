'use strict';

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const rootDir = path.resolve(__dirname, '..');
const outputDir = path.join(rootDir, 'scratch', 'phaseA');
const jsonPath = path.join(outputDir, 'runtime_probe.json');
const reportPath = path.join(outputDir, 'runtime_probe_report.md');
const screenshotPath = path.join(outputDir, 'runtime_probe.png');
const targetUrl = process.env.PHASE_A_URL || 'http://127.0.0.1:3000/';

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
    lines.push('# Phase A Runtime Probe Report');
    lines.push('');
    lines.push(`- URL: ${data.url}`);
    lines.push(`- Timestamp: ${data.generatedAt}`);
    lines.push('');
    lines.push('## Core Metrics');
    lines.push('');
    lines.push(`- DOMContentLoaded: ${data.timings.domContentLoadedMs} ms`);
    lines.push(`- Load event: ${data.timings.loadMs} ms`);
    lines.push(`- Network idle settle: ${data.timings.networkIdleWaitMs} ms`);
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
        .slice(0, 12)
        .forEach((request, index) => {
            lines.push(`${index + 1}. ${request.type} | ${formatKb(request.encodedDataLength)} | ${request.url}`);
        });
    lines.push('');
    lines.push('## Top JS Coverage Gaps');
    lines.push('');
    data.coverage.js.entries
        .slice()
        .sort((a, b) => b.unusedBytes - a.unusedBytes)
        .slice(0, 10)
        .forEach((entry, index) => {
            lines.push(`${index + 1}. ${formatKb(entry.unusedBytes)} unused of ${formatKb(entry.totalBytes)} | ${entry.url}`);
        });
    lines.push('');
    lines.push('## Top CSS Coverage Gaps');
    lines.push('');
    data.coverage.css.entries
        .slice()
        .sort((a, b) => b.unusedBytes - a.unusedBytes)
        .slice(0, 10)
        .forEach((entry, index) => {
            lines.push(`${index + 1}. ${formatKb(entry.unusedBytes)} unused of ${formatKb(entry.totalBytes)} | ${entry.url}`);
        });
    lines.push('');
    lines.push('## Notes');
    lines.push('');
    lines.push('1. This probe captures unauthenticated first-load behavior only.');
    lines.push('2. Briefing and calendar remain measurement-only targets and should not be structurally changed based on this probe alone.');
    lines.push('3. Detached DOM and heap growth over repeated navigation still require a multi-step navigation script.');
    return `${lines.join('\n')}\n`;
}

async function main() {
    ensureDir(outputDir);

    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    try {
        const page = await browser.newPage();
        await page.setViewport({ width: 1440, height: 1024, deviceScaleFactor: 1 });

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

        const startTime = Date.now();
        await page.goto(targetUrl, { waitUntil: 'load', timeout: 120000 });
        const loadReachedAt = Date.now();
        await page.waitForNetworkIdle({ idleTime: 1000, timeout: 120000 });
        const idleReachedAt = Date.now();

        const perfSnapshot = await page.evaluate(() => {
            const nav = performance.getEntriesByType('navigation')[0];
            const resources = performance.getEntriesByType('resource').map(entry => ({
                name: entry.name,
                initiatorType: entry.initiatorType,
                transferSize: entry.transferSize,
                encodedBodySize: entry.encodedBodySize,
                decodedBodySize: entry.decodedBodySize,
                duration: entry.duration
            }));
            return {
                domContentLoadedMs: nav ? Math.round(nav.domContentLoadedEventEnd) : null,
                loadMs: nav ? Math.round(nav.loadEventEnd) : null,
                resources
            };
        });

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
                domContentLoadedMs: perfSnapshot.domContentLoadedMs,
                loadMs: perfSnapshot.loadMs,
                networkIdleWaitMs: idleReachedAt - loadReachedAt,
                totalProbeMs: idleReachedAt - startTime
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
            },
            resourceTimings: perfSnapshot.resources
        };

        fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2));
        fs.writeFileSync(reportPath, buildReport(data));

        console.log(`Wrote runtime data: ${path.relative(rootDir, jsonPath).split(path.sep).join('/')}`);
        console.log(`Wrote runtime report: ${path.relative(rootDir, reportPath).split(path.sep).join('/')}`);
        console.log(`Wrote runtime screenshot: ${path.relative(rootDir, screenshotPath).split(path.sep).join('/')}`);
    } finally {
        await browser.close();
    }
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});