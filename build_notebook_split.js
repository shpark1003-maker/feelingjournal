const fs = require('fs');

const content = fs.readFileSync('c:/Dev/feelingjournal/public/modules/notebook.js.bak', 'utf8');

const listFuncsList = [
    'loadNotebooks', 'addNotebook', 'saveNotebooks', 'deleteNotebook', 
    'populateV2NotebookSelect', 'deleteV2Notebook', 'loadPages', 
    'selectPage', 'setupNotebooksAndPages', 'setupResizers', 'renderV2MemoryFragments'
];

const editorFuncsList = [
    'addNewPage', 'openV2Editor', 'closeV2Editor', 'openV2Gallery', 
    'closeV2Gallery', 'v2QuickAddPage', 'deleteV2Page', 
    'setupDirectFragmentUpload', 'setupGallerySharing'
];

const funcRegex = /^(export )?(async )?function ([a-zA-Z0-9_]+)\s*\(/gm;
let match;
let matches = [];
while ((match = funcRegex.exec(content)) !== null) {
    matches.push({ name: match[3], index: match.index });
}

const windowRegex = /^window\.([a-zA-Z0-9_]+)\s*=\s*(async\s*)?function/gm;
while ((match = windowRegex.exec(content)) !== null) {
    matches.push({ name: match[1], index: match.index });
}

matches.sort((a, b) => a.index - b.index);

const funcs = {};
for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index;
    const end = i < matches.length - 1 ? matches[i+1].index : content.length;
    funcs[matches[i].name] = content.substring(start, end).trim() + '\n\n';
}

const globalsEnd = matches.length > 0 ? matches[0].index : 0;
const globals = content.substring(0, globalsEnd).trim() + '\n\n';

let listContent = `import { API_URL, store, assertIds } from '../../state.js';\nimport { notebookState } from './notebookState.js';\nimport { notebookApi } from './notebookApi.js';\n\n`;
let editorContent = `import { API_URL, store, assertIds } from '../../state.js';\nimport { notebookState } from './notebookState.js';\nimport { notebookApi } from './notebookApi.js';\n\n`;

for (const name of listFuncsList) {
    if (funcs[name]) listContent += funcs[name];
}

for (const name of editorFuncsList) {
    if (funcs[name]) editorContent += funcs[name];
}

fs.writeFileSync('c:/Dev/feelingjournal/public/modules/notebook/notebookList.js', listContent);
fs.writeFileSync('c:/Dev/feelingjournal/public/modules/notebook/noteEditor.js', editorContent);

const stateContent = `export const notebookState = {
    selectModeActive: false,
    selectedPageIds: new Set(),
    customAddedRecipients: [],
    
    toggleSelectMode() {
        this.selectModeActive = !this.selectModeActive;
        if (!this.selectModeActive) this.selectedPageIds.clear();
    },
    togglePageSelect(pageId) {
        if (this.selectedPageIds.has(pageId)) this.selectedPageIds.delete(pageId);
        else this.selectedPageIds.add(pageId);
    }
};\n`;
fs.writeFileSync('c:/Dev/feelingjournal/public/modules/notebook/notebookState.js', stateContent);

// To avoid breaking the monolithic state globals that were let vars:
// We need to replace let selectModeActive, let selectedPageIds inside noteEditor
editorContent = editorContent.replace(/selectedPageIds/g, 'notebookState.selectedPageIds');
editorContent = editorContent.replace(/selectModeActive/g, 'notebookState.selectModeActive');
editorContent = editorContent.replace(/customAddedRecipients/g, 'notebookState.customAddedRecipients');

listContent = listContent.replace(/selectedPageIds/g, 'notebookState.selectedPageIds');
listContent = listContent.replace(/selectModeActive/g, 'notebookState.selectModeActive');

fs.writeFileSync('c:/Dev/feelingjournal/public/modules/notebook/notebookList.js', listContent);
fs.writeFileSync('c:/Dev/feelingjournal/public/modules/notebook/noteEditor.js', editorContent);

console.log('Notebook split complete');
