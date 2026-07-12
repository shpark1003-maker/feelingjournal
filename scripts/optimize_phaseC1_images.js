'use strict';

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const rootDir = path.resolve(__dirname, '..');
const publicDir = path.join(rootDir, 'public');
const outputDir = path.join(publicDir, 'optimized');
const reportDir = path.join(rootDir, 'scratch', 'phaseA');

const imageJobs = [
    {
        input: path.join(publicDir, 'angel_mascot.png'),
        outputs: [
            { name: 'angel_mascot-256.webp', width: 256, quality: 82 },
            { name: 'angel_mascot-512.webp', width: 512, quality: 84 },
            { name: 'angel_mascot-128.webp', width: 128, quality: 80 }
        ]
    },
    {
        input: path.join(publicDir, 'mascot.png'),
        outputs: [
            { name: 'mascot-128.webp', width: 128, quality: 80 }
        ]
    },
    {
        input: path.join(publicDir, 'weather_sunny.png'),
        outputs: [
            { name: 'weather_sunny-96.webp', width: 96, quality: 82 }
        ]
    },
    {
        input: path.join(publicDir, 'weather_cloudy.png'),
        outputs: [
            { name: 'weather_cloudy-96.webp', width: 96, quality: 82 }
        ]
    },
    {
        input: path.join(publicDir, 'weather_rainy.png'),
        outputs: [
            { name: 'weather_rainy-96.webp', width: 96, quality: 82 }
        ]
    },
    {
        input: path.join(publicDir, 'weather_snowy.png'),
        outputs: [
            { name: 'weather_snowy-96.webp', width: 96, quality: 82 }
        ]
    }
];

function ensureDir(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
}

function formatKb(bytes) {
    return `${(bytes / 1024).toFixed(1)} KB`;
}

async function run() {
    ensureDir(outputDir);
    ensureDir(reportDir);

    const summary = [];

    for (const job of imageJobs) {
        const originalStat = fs.statSync(job.input);
        const metadata = await sharp(job.input).metadata();

        for (const output of job.outputs) {
            const targetPath = path.join(outputDir, output.name);
            await sharp(job.input)
                .resize({ width: output.width, withoutEnlargement: true })
                .webp({ quality: output.quality, effort: 6 })
                .toFile(targetPath);

            const targetStat = fs.statSync(targetPath);
            summary.push({
                source: path.relative(rootDir, job.input).split(path.sep).join('/'),
                output: path.relative(rootDir, targetPath).split(path.sep).join('/'),
                originalBytes: originalStat.size,
                optimizedBytes: targetStat.size,
                width: output.width,
                sourceWidth: metadata.width,
                sourceHeight: metadata.height
            });
        }
    }

    const jsonPath = path.join(reportDir, 'phaseC1_image_optimization.json');
    const mdPath = path.join(reportDir, 'phaseC1_image_optimization.md');
    fs.writeFileSync(jsonPath, JSON.stringify(summary, null, 2));

    const mdLines = [
        '# Phase C1 Image Optimization Output',
        '',
        ...summary.map((item, index) => {
            const reduction = item.originalBytes > 0
                ? `${(((item.originalBytes - item.optimizedBytes) / item.originalBytes) * 100).toFixed(1)}%`
                : '0.0%';
            return `${index + 1}. ${item.source} -> ${item.output} | ${formatKb(item.originalBytes)} -> ${formatKb(item.optimizedBytes)} | reduction ${reduction}`;
        }),
        ''
    ];

    fs.writeFileSync(mdPath, `${mdLines.join('\n')}\n`);

    console.log(`Wrote image optimization JSON: ${path.relative(rootDir, jsonPath).split(path.sep).join('/')}`);
    console.log(`Wrote image optimization report: ${path.relative(rootDir, mdPath).split(path.sep).join('/')}`);
}

run().catch(error => {
    console.error(error);
    process.exitCode = 1;
});