'use strict';

const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const publicDir = path.join(rootDir, 'public');
const appJsPath = path.join(publicDir, 'app.js');
const indexHtmlPath = path.join(publicDir, 'index.html');
const indexBootPath = path.join(publicDir, 'modules', 'indexBoot.js');
const outputDir = path.join(rootDir, 'scratch', 'phaseA');
const reportPath = path.join(outputDir, 'day0_baseline_report.md');
const dataPath = path.join(outputDir, 'day0_baseline_data.json');

function ensureDir(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
}

function readText(filePath) {
    return fs.readFileSync(filePath, 'utf8');
}

function toPosixRelative(filePath) {
    return path.relative(rootDir, filePath).split(path.sep).join('/');
}

function getFileSize(filePath) {
    return fs.statSync(filePath).size;
}

function walkFiles(dirPath, collected = []) {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
            walkFiles(fullPath, collected);
            continue;
        }
        collected.push(fullPath);
    }
    return collected;
}

function parseStaticImports(sourceText) {
    const importRegex = /^import\s+.*?from\s+['"](.+?)['"];?$/gm;
    const imports = [];
    let match;
    while ((match = importRegex.exec(sourceText)) !== null) {
        imports.push(match[1]);
    }
    return imports;
}

function parseScriptTags(htmlText) {
    const scriptRegex = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
    const scripts = [];
    let match;
    while ((match = scriptRegex.exec(htmlText)) !== null) {
        const attrs = match[1] || '';
        const body = match[2] || '';
        const srcMatch = attrs.match(/src=["']([^"']+)["']/i);
        const typeMatch = attrs.match(/type=["']([^"']+)["']/i);
        const idMatch = attrs.match(/id=["']([^"']+)["']/i);
        scripts.push({
            src: srcMatch ? srcMatch[1] : null,
            type: typeMatch ? typeMatch[1] : 'classic',
            id: idMatch ? idMatch[1] : null,
            inline: !srcMatch,
            inlineLength: !srcMatch ? body.trim().length : 0
        });
    }
    return scripts;
}

function parseCalledFunctions(sourceText, regex) {
    const names = [];
    let match;
    while ((match = regex.exec(sourceText)) !== null) {
        names.push(match[1]);
    }
    return Array.from(new Set(names));
}

function getLargestFiles(targetDir, limit) {
    return walkFiles(targetDir)
        .map(filePath => ({
            path: toPosixRelative(filePath),
            size: getFileSize(filePath)
        }))
        .sort((a, b) => b.size - a.size)
        .slice(0, limit);
}

function scoreCandidate({ size, importCount, initTouches }) {
    return (size / 1024) + (importCount * 10) + (initTouches * 15);
}

function collectModuleMetrics() {
    const candidateFiles = [
        path.join(publicDir, 'modules', 'notebook.js'),
        path.join(publicDir, 'modules', 'editor.js'),
        path.join(publicDir, 'modules', 'chat.js'),
        path.join(publicDir, 'modules', 'persona.js'),
        path.join(publicDir, 'modules', 'calendar.js'),
        path.join(publicDir, 'modules', 'care.js'),
        path.join(publicDir, 'modules', 'chat', 'chatUI.js'),
        path.join(publicDir, 'modules', 'notebook', 'notebookUI.js'),
        path.join(publicDir, 'modules', 'notebook', 'notebookList.js')
    ].filter(filePath => fs.existsSync(filePath));

    return candidateFiles.map(filePath => {
        const sourceText = readText(filePath);
        const importCount = parseStaticImports(sourceText).length;
        const filename = path.basename(filePath);
        const initTouches = filename === 'chat.js' || filename === 'notebook.js' || filename === 'editor.js' || filename === 'persona.js' || filename === 'care.js' || filename === 'calendar.js'
            ? 1
            : 0;
        const size = getFileSize(filePath);
        return {
            path: toPosixRelative(filePath),
            size,
            importCount,
            initTouches,
            impactScore: Number(scoreCandidate({ size, importCount, initTouches }).toFixed(1))
        };
    }).sort((a, b) => b.impactScore - a.impactScore);
}

function collectDuplicateImportFanIn() {
    const moduleDir = path.join(publicDir, 'modules');
    const jsFiles = walkFiles(moduleDir).filter(filePath => filePath.endsWith('.js'));
    const importersBySpecifier = new Map();

    for (const filePath of jsFiles) {
        const imports = parseStaticImports(readText(filePath));
        for (const specifier of imports) {
            if (!specifier.startsWith('.')) continue;
            if (!importersBySpecifier.has(specifier)) {
                importersBySpecifier.set(specifier, new Set());
            }
            importersBySpecifier.get(specifier).add(toPosixRelative(filePath));
        }
    }

    return Array.from(importersBySpecifier.entries())
        .map(([specifier, importers]) => ({
            specifier,
            importerCount: importers.size,
            importers: Array.from(importers).sort()
        }))
        .filter(entry => entry.importerCount > 1)
        .sort((a, b) => b.importerCount - a.importerCount)
        .slice(0, 20);
}

function buildReport(data) {
    const lines = [];
    lines.push('# Phase A Day 0 Baseline Report');
    lines.push('');
    lines.push('## Summary');
    lines.push('');
    lines.push(`- Entry HTML script tags: ${data.entry.scriptTagCount}`);
    lines.push(`- Entry module script tags: ${data.entry.moduleScriptCount}`);
    lines.push(`- Entry inline script tags: ${data.entry.inlineScriptCount}`);
    lines.push(`- App top-level static imports: ${data.entry.appImportCount}`);
    lines.push(`- DOMContentLoaded setup calls in app bootstrap: ${data.initialization.appSetupCalls.length}`);
    lines.push(`- onReady setup calls in index boot: ${data.initialization.indexBootSetupCalls.length}`);
    lines.push('');
    lines.push('## Entry Script Inventory');
    lines.push('');
    data.entry.scripts.forEach((script, index) => {
        const descriptor = script.src
            ? `${script.type} | ${script.src}`
            : `${script.type} | inline (${script.inlineLength} chars${script.id ? `, id=${script.id}` : ''})`;
        lines.push(`${index + 1}. ${descriptor}`);
    });
    lines.push('');
    lines.push('## App Static Imports');
    lines.push('');
    data.entry.appImports.forEach((importPath, index) => {
        lines.push(`${index + 1}. ${importPath}`);
    });
    lines.push('');
    lines.push('## Initialization Dependency Map');
    lines.push('');
    lines.push('### app.js DOMContentLoaded setup calls');
    lines.push('');
    data.initialization.appSetupCalls.forEach((name, index) => {
        lines.push(`${index + 1}. ${name}`);
    });
    lines.push('');
    lines.push('### app.js authenticated load path');
    lines.push('');
    data.initialization.authenticatedLoadCalls.forEach((name, index) => {
        lines.push(`${index + 1}. ${name}`);
    });
    lines.push('');
    lines.push('### indexBoot.js onReady setup calls');
    lines.push('');
    data.initialization.indexBootSetupCalls.forEach((name, index) => {
        lines.push(`${index + 1}. ${name}`);
    });
    lines.push('');
    lines.push('## Largest Public Files');
    lines.push('');
    data.largeFiles.forEach((file, index) => {
        lines.push(`${index + 1}. ${file.path} - ${(file.size / 1024).toFixed(1)} KB`);
    });
    lines.push('');
    lines.push('## Initial Optimization Candidates by Impact Score');
    lines.push('');
    data.candidates.forEach((candidate, index) => {
        lines.push(`${index + 1}. ${candidate.path} | score=${candidate.impactScore} | size=${(candidate.size / 1024).toFixed(1)} KB | imports=${candidate.importCount}`);
    });
    lines.push('');
    lines.push('## Duplicate Import Fan-In Report');
    lines.push('');
    data.duplicateImportFanIn.forEach((entry, index) => {
        lines.push(`${index + 1}. ${entry.specifier} | imported by ${entry.importerCount} modules`);
    });
    lines.push('');
    lines.push('## Observations');
    lines.push('');
    lines.push('1. The entry path currently mixes inline boot logic, CDN dependencies, vendor files, and two module entrypoints in index.html.');
    lines.push('2. app.js eagerly imports every major feature module at the top level, which makes it the primary first-split target class.');
    lines.push('3. indexBoot.js contains repeated polling-style UI synchronization through setInterval, which should be reviewed before any lazy loading to avoid duplicated timers.');
    lines.push('4. Briefing and calendar remain measurement-only targets for this round and should not be structurally split before other low-risk candidates are validated.');
    lines.push('');
    lines.push('## Remaining Day 0 Gaps');
    lines.push('');
    lines.push('1. Runtime probe artifacts now exist separately in scratch/phaseA/runtime_probe_report.md and runtime_probe.json.');
    lines.push('2. Lighthouse-equivalent scoring is still not captured because no dedicated Lighthouse pass is installed yet.');
    lines.push('3. Duplicate dependency confirmation across future lazy chunks still needs chunk-aware bundle tooling support.');
    lines.push('4. Heap growth, detached DOM, and listener count still require repeated-navigation instrumentation, not just first-load capture.');
    return `${lines.join('\n')}\n`;
}

function main() {
    ensureDir(outputDir);

    const appText = readText(appJsPath);
    const indexText = readText(indexHtmlPath);
    const indexBootText = readText(indexBootPath);

    const scripts = parseScriptTags(indexText);
    const appImports = parseStaticImports(appText);
    const appSetupCalls = parseCalledFunctions(appText, /\b(setup[A-Z][A-Za-z0-9_]*)\(/g).filter(name => name !== 'setupSettingsUI');
    const authenticatedLoadCalls = parseCalledFunctions(appText, /\b(load[A-Z][A-Za-z0-9_]*|populateGuardianSelect|checkFriendSos|startBackgroundLoops)\(/g);
    const indexBootSetupCalls = parseCalledFunctions(indexBootText, /\b(setup[A-Z][A-Za-z0-9_]*)\(/g);

    const data = {
        generatedAt: new Date().toISOString(),
        entry: {
            scriptTagCount: scripts.length,
            moduleScriptCount: scripts.filter(script => script.type === 'module').length,
            inlineScriptCount: scripts.filter(script => script.inline).length,
            scripts,
            appImportCount: appImports.length,
            appImports
        },
        initialization: {
            appSetupCalls,
            authenticatedLoadCalls,
            indexBootSetupCalls
        },
        largeFiles: getLargestFiles(publicDir, 15),
        candidates: collectModuleMetrics(),
        duplicateImportFanIn: collectDuplicateImportFanIn()
    };

    fs.writeFileSync(dataPath, JSON.stringify(data, null, 2));
    fs.writeFileSync(reportPath, buildReport(data));

    console.log(`Wrote baseline data: ${toPosixRelative(dataPath)}`);
    console.log(`Wrote baseline report: ${toPosixRelative(reportPath)}`);
}

main();