const fs = require('fs');
const path = require('path');

const stylePath = path.join(__dirname, 'style.css');
let styleCss = fs.readFileSync(stylePath, 'utf8');

// Replace class names using regex with word boundaries
styleCss = styleCss.replace(/\.container\b/g, '.legacy-container');
styleCss = styleCss.replace(/\.btn\b/g, '.legacy-btn');
styleCss = styleCss.replace(/\.card\b/g, '.legacy-card');
styleCss = styleCss.replace(/\.message\b/g, '.legacy-message');
styleCss = styleCss.replace(/\.auth-card\b/g, '.legacy-auth-card');

fs.writeFileSync(stylePath, styleCss, 'utf8');

const indexPath = path.join(__dirname, 'index.html');
let indexHtml = fs.readFileSync(indexPath, 'utf8');

// Auth View
indexHtml = indexHtml.replace(
  '<main class="flex-grow flex flex-col items-center justify-center px-margin-mobile pt-12 pb-8 ghibli-entrance">',
  '<main class="flex-grow flex flex-col items-center justify-center px-margin-mobile pt-8 md:pt-12 pb-8 ghibli-entrance">'
);

// Journal View
indexHtml = indexHtml.replace(
  '<div class="bg-surface-container-low paper-texture rounded-xl p-6 soft-shadow border border-outline-variant/30 relative overflow-hidden" id="briefing-card">',
  '<div class="bg-surface-container-low paper-texture rounded-xl p-5 md:p-6 soft-shadow border border-outline-variant/30 relative overflow-hidden" id="briefing-card">'
);
indexHtml = indexHtml.replace(
  '<section class="bg-surface-container-low rounded-xl p-5 shadow-[0_4px_20px_-2px_rgba(0,0,0,0.05)] border border-outline-variant/30" id="calendar-container">',
  '<section class="bg-surface-container-low rounded-xl p-4 md:p-5 shadow-[0_4px_20px_-2px_rgba(0,0,0,0.05)] border border-outline-variant/30" id="calendar-container">'
);

// Persona View
indexHtml = indexHtml.replace(/rounded-2xl p-5 custom-shadow/g, 'rounded-2xl p-4 md:p-5 custom-shadow');

fs.writeFileSync(indexPath, indexHtml, 'utf8');
console.log('Fixed CSS and HTML encoding correctly.');
