const fs = require("fs");
const path = require("path");
const modulesDir = path.join("C:", "Dev", "feelingjournal", "public", "modules");
const files = fs.readdirSync(modulesDir).filter(f => f.endsWith(".js"));
for (const file of files) {
    const filePath = path.join(modulesDir, file);
    let content = fs.readFileSync(filePath, "utf8");
    content = content.replace(/import \{(.*?)\} from '\.\/state\.js(\?v=[0-9\.]+)?';/g, "import {$1} from './state.js?v=5.1.2';");
    content = content.replace(/import \{ loadPages \} from '\.\/notebook\.js(\?v=[0-9\.]+)?';/g, "import { loadPages } from './notebook.js?v=5.1.2';");
    fs.writeFileSync(filePath, content, "utf8");
}
console.log("Done");
