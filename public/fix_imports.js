const fs = require('fs');
const path = require('path');

function processDir(dir) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const fullPath = path.join(dir, file);
        if (fs.statSync(fullPath).isDirectory()) {
            processDir(fullPath);
        } else if (fullPath.endsWith('.js')) {
            let content = fs.readFileSync(fullPath, 'utf8');
            let newContent = content.replace(/(import\s+.*?from\s+['"][^'"]*?)\?v=[0-9.]+(['"])/g, '$1$2');
            newContent = newContent.replace(/(import\s*\(['"][^'"]*?)\?v=[0-9.]+(['"]\))/g, '$1$2');
            if (content !== newContent) {
                fs.writeFileSync(fullPath, newContent);
                console.log('Fixed ' + fullPath);
            }
        }
    }
}
processDir('c:/Dev/feelingjournal/public');
