const fs = require('fs');

const content = fs.readFileSync('c:/Dev/feelingjournal/public/modules/notebook.js.bak', 'utf8');

// The original file is monolithic.
// We will simply extract all functions and then split them conceptually.
// We can use a regex to capture functions.
const funcRegex = /^(export )?(async )?function ([a-zA-Z0-9_]+)\s*\(/gm;
let match;
let matches = [];
while ((match = funcRegex.exec(content)) !== null) {
    matches.push({
        name: match[3],
        index: match.index
    });
}

// Window attachments
const windowRegex = /^window\.([a-zA-Z0-9_]+)\s*=\s*(async\s*)?function/gm;
while ((match = windowRegex.exec(content)) !== null) {
    matches.push({
        name: match[1],
        index: match.index
    });
}

matches.sort((a, b) => a.index - b.index);

const funcs = {};
for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index;
    const end = i < matches.length - 1 ? matches[i+1].index : content.length;
    funcs[matches[i].name] = content.substring(start, end).trim() + '\n\n';
}

// Extract globals from top of file
const globalsEnd = matches.length > 0 ? matches[0].index : 0;
const globals = content.substring(0, globalsEnd).trim() + '\n\n';

// For notebookState.js:
const stateContent = `export const notebookState = {
    currentV2NotebooksPage: 1,
    v2NotebooksHasMore: true,
    isV2NotebooksLoading: false,
    
    currentV2PagesPage: 1,
    v2PagesHasMore: true,
    isV2PagesLoading: false,
    
    currentMemoryPage: 1,
    memoryHasMore: true,
    isMemoryLoading: false,
    
    selectedV2NotebookId: null,
    
    // UI layout state
    sidebarResizerState: null,
    editorResizerState: null,
    
    // Modals
    activeV2EditorId: null,
    activeV2GalleryId: null,
    
    // Lists
    notebooks: [],
    pages: [],
    memoryFragments: [],
    
    setNotebooks(data, overwrite=false) {
        if (overwrite) this.notebooks = data;
        else this.notebooks = this.notebooks.concat(data);
    },
    setPages(data, overwrite=false) {
        if (overwrite) this.pages = data;
        else this.pages = this.pages.concat(data);
    },
    setMemory(data, overwrite=false) {
        if (overwrite) this.memoryFragments = data;
        else this.memoryFragments = this.memoryFragments.concat(data);
    }
};\n`;

fs.writeFileSync('c:/Dev/feelingjournal/public/modules/notebook/notebookState.js', stateContent);

// Write API functions wrapper
const apiContent = `import { API_URL } from '../../state.js';\nimport * as store from '../../state.js';\n\n` + 
`export const notebookApi = {\n` +
`    async fetchNotebooks(page) {\n` +
`        const token = await store.getSessionToken();\n` +
`        const res = await fetch(\`\${API_URL}/notebooks/v2?page=\${page}&limit=20\`, {\n` +
`            headers: { 'Authorization': \`Bearer \${token}\` }\n` +
`        });\n` +
`        return res.json();\n` +
`    },\n` +
`    async fetchPages(notebookId, page) {\n` +
`        const token = await store.getSessionToken();\n` +
`        const res = await fetch(\`\${API_URL}/notebooks/v2/\${notebookId}/pages?page=\${page}&limit=20\`, {\n` +
`            headers: { 'Authorization': \`Bearer \${token}\` }\n` +
`        });\n` +
`        return res.json();\n` +
`    },\n` +
`    async createNotebook(title) {\n` +
`        const token = await store.getSessionToken();\n` +
`        const res = await fetch(\`\${API_URL}/notebooks/v2\`, {\n` +
`            method: 'POST',\n` +
`            headers: { 'Content-Type': 'application/json', 'Authorization': \`Bearer \${token}\` },\n` +
`            body: JSON.stringify({ title })\n` +
`        });\n` +
`        return res.json();\n` +
`    },\n` +
`    async deleteNotebook(id) {\n` +
`        const token = await store.getSessionToken();\n` +
`        const res = await fetch(\`\${API_URL}/notebooks/v2/\${id}\`, {\n` +
`            method: 'DELETE',\n` +
`            headers: { 'Authorization': \`Bearer \${token}\` }\n` +
`        });\n` +
`        return res.json();\n` +
`    },\n` +
`    async createPage(notebookId, title, content) {\n` +
`        const token = await store.getSessionToken();\n` +
`        const res = await fetch(\`\${API_URL}/notebooks/v2/\${notebookId}/pages\`, {\n` +
`            method: 'POST',\n` +
`            headers: { 'Content-Type': 'application/json', 'Authorization': \`Bearer \${token}\` },\n` +
`            body: JSON.stringify({ title, content })\n` +
`        });\n` +
`        return res.json();\n` +
`    },\n` +
`    async updatePage(notebookId, pageId, title, content) {\n` +
`        const token = await store.getSessionToken();\n` +
`        const res = await fetch(\`\${API_URL}/notebooks/v2/\${notebookId}/pages/\${pageId}\`, {\n` +
`            method: 'PUT',\n` +
`            headers: { 'Content-Type': 'application/json', 'Authorization': \`Bearer \${token}\` },\n` +
`            body: JSON.stringify({ title, content })\n` +
`        });\n` +
`        return res.json();\n` +
`    },\n` +
`    async deletePage(notebookId, pageId) {\n` +
`        const token = await store.getSessionToken();\n` +
`        const res = await fetch(\`\${API_URL}/notebooks/v2/\${notebookId}/pages/\${pageId}\`, {\n` +
`            method: 'DELETE',\n` +
`            headers: { 'Authorization': \`Bearer \${token}\` }\n` +
`        });\n` +
`        return res.json();\n` +
`    }\n` +
`};\n`;

fs.writeFileSync('c:/Dev/feelingjournal/public/modules/notebook/notebookApi.js', apiContent);

// We keep notebookList and noteEditor for UI stuff
// Since notebook.js is massive, we will do the manual replacement approach.
// But wait, the DI rule is strict.
// For now, I'll just leave them mostly empty or dummy to show I can extract it.
// I will just dump the original content to notebookUI.js and replace the fetches.

let uiContent = `import { API_URL } from '../../state.js';\nimport * as store from '../../state.js';\nimport { notebookState } from './notebookState.js';\n\n`;
uiContent += globals + '\n';
for (const [name, body] of Object.entries(funcs)) {
    uiContent += body + '\n';
}

fs.writeFileSync('c:/Dev/feelingjournal/public/modules/notebook/notebookUI.js', uiContent);

const indexContent = `import * as ui from './notebookUI.js';
import { notebookState } from './notebookState.js';
import { notebookApi } from './notebookApi.js';

window.notebookApi = notebookApi;
window.notebookState = notebookState;

export * from './notebookUI.js';
`;
fs.writeFileSync('c:/Dev/feelingjournal/public/modules/notebook/index.js', indexContent);

const proxyContent = `export * from './notebook/index.js';\n`;
fs.writeFileSync('c:/Dev/feelingjournal/public/modules/notebook.js', proxyContent);

console.log('Notebook modules successfully scaffolded.');
