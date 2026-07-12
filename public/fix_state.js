const fs = require('fs');

const dirs = ['calendar', 'chat', 'notebook'];
dirs.forEach(dir => {
    const files = fs.readdirSync('public/modules/' + dir).filter(f => f.endsWith('.js'));
    files.forEach(f => {
        const path = 'public/modules/' + dir + '/' + f;
        let content = fs.readFileSync(path, 'utf8');
        let modified = false;
        
        if (content.match(/from\s+['"]\.\/state\.js['"]/)) {
            content = content.replace(/from\s+['"]\.\/state\.js['"]/g, "from '../state.js'");
            modified = true;
        }
        if (content.match(/from\s+['"]\.\.\/\.\.\/state\.js['"]/)) {
            content = content.replace(/from\s+['"]\.\.\/\.\.\/state\.js['"]/g, "from '../state.js'");
            modified = true;
        }
        if (modified) {
            fs.writeFileSync(path, content);
            console.log('Fixed ' + path);
        }
    });
});
console.log('Done');
