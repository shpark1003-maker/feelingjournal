const fs = require('fs');
const content = fs.readFileSync('c:/Dev/feelingjournal/public/modules/chat.js.bak', 'utf8');

// Function extraction
const regex = /^(export )?(async )?function [a-zA-Z0-9_]+\s*\(/gm;
let matches = [];
let match;
while ((match = regex.exec(content)) !== null) {
    matches.push({
        index: match.index,
        name: match[0].replace(/^(export )?(async )?function /, '').split('(')[0].trim()
    });
}
const funcs = {};
for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index;
    const end = i < matches.length - 1 ? matches[i+1].index : content.length;
    funcs[matches[i].name] = content.substring(start, end).trim() + '\n\n';
}
const windowRegex = /^window\.[a-zA-Z0-9_]+\s*=\s*(async\s*)?function\s*\(/gm;
let winMatches = [];
while ((match = windowRegex.exec(content)) !== null) {
    winMatches.push({
        index: match.index,
        name: match[0].replace(/^window\./, '').split('=')[0].trim()
    });
}
for (let i = 0; i < winMatches.length; i++) {
    const start = winMatches[i].index;
    let end = content.length;
    for (const m of matches) if (m.index > start && m.index < end) end = m.index;
    for (const m of winMatches) if (m.index > start && m.index < end) end = m.index;
    funcs[winMatches[i].name] = content.substring(start, end).trim() + '\n\n';
}

// Extract global variables block from top
const globalStart = content.indexOf('let localStream = null;');
const globalEnd = content.indexOf('export async function initializeChat()');
const globalVars = content.substring(globalStart, globalEnd).trim() + '\n';
funcs['globals'] = globalVars;

// Write chatState.js
fs.writeFileSync('c:/Dev/feelingjournal/public/modules/chat/chatState.js', 
`export const chatState = {
    localStream: null,
    isCallActive: false,
    callRecognition: null,
    currentFriendSortMode: 'name',
    renderedMessageIds: new Set()
};
`);

// Write chatMarkdown.js
fs.writeFileSync('c:/Dev/feelingjournal/public/modules/chat/chatMarkdown.js', 
`export function parseMarkdown(content) {
    const imgMatch = content && content.trim().match(/^!\\[image\\]\\((.*?)\\)$/);
    const isImage = !!imgMatch;
    const imageUrl = isImage ? imgMatch[1] : '';
    const contentHtml = isImage 
        ? \`<img class="chat-inline-photo" src="\${imageUrl}" style="max-width: 250px; border-radius: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.08); cursor: pointer; display: block; margin-top: 4px; border: 2px solid #5d574d;" data-action="open-image" data-url="\${imageUrl}" onerror="this.onerror=null; this.outerHTML='<div class=&quot;image-load-failed&quot; style=&quot;padding: 10px 14px; background: #ffebee; color: #d63031; border-radius: 12px; font-size: 0.85rem; display: flex; align-items: center; gap: 6px; border: 1.5px solid #5d574d; font-weight: 500;&quot;>⚠️ 이미지를 불러올 수 없습니다.</div>';">\`
        : content;
    return { isImage, imageUrl, contentHtml };
}
`);

// To avoid 'renderedMessageIds' undefined in chatApi and chatUI, I will replace renderedMessageIds with chatState.renderedMessageIds
for (const key in funcs) {
    funcs[key] = funcs[key].replace(/renderedMessageIds/g, 'chatState.renderedMessageIds');
    funcs[key] = funcs[key].replace(/localStream/g, 'chatState.localStream');
    funcs[key] = funcs[key].replace(/isCallActive/g, 'chatState.isCallActive');
    funcs[key] = funcs[key].replace(/callRecognition/g, 'chatState.callRecognition');
    funcs[key] = funcs[key].replace(/currentFriendSortMode/g, 'chatState.currentFriendSortMode');
}

// Modify appendMessage to use parseMarkdown
funcs['appendMessage'] = funcs['appendMessage'].replace(
    /const imgMatch = msg\.content && msg\.content\.trim\(\)\.match\(\/\^!\\\[image\\\]\\(\(\.\*\?\)\\)\$\/\);\s+const isImage = !!imgMatch;\s+const imageUrl = isImage \? imgMatch\[1\] : '';\s+\/\/ 이미지가 로드 실패\(onerror\)할 경우, 경고 카드 형태의 UI로 안전하게 대체 처리\s+const contentHtml = isImage\s+\? `<img class="chat-inline-photo" .*?`\s+: msg\.content;/g,
    `const { isImage, imageUrl, contentHtml } = parseMarkdown(msg.content);`
);

// Write chatApi.js skipped, we will use our pure one.

// Write chatUI.js
let uiCode = `import { store, API_URL, assertIds } from '../../state.js';\n`;
uiCode += `import { chatState } from './chatState.js';\n`;
uiCode += `import { parseMarkdown } from './chatMarkdown.js';\n\n`;
uiCode += (funcs['initializeChat'] || '').replace(/^function/, 'export function');
uiCode += (funcs['loadMessages'] || '').replace(/^function/, 'export function');
uiCode += (funcs['appendMessage'] || '').replace(/^function/, 'export function');
uiCode += (funcs['callChatAI'] || '').replace(/^function/, 'export function');
uiCode += (funcs['appendChatErrorMsg'] || '').replace(/^function/, 'export function');
uiCode += (funcs['setupChatAssistant'] || '').replace(/^function/, 'export function');
uiCode += (funcs['setupChatUI'] || '').replace(/^function/, 'export function');
uiCode += (funcs['openChatWithAi'] || '').replace(/^function/, 'export function');
uiCode += (funcs['switchChatRoom'] || '').replace(/^function/, 'export function');
uiCode += (funcs['loadContacts'] || '').replace(/^function/, 'export function');
uiCode += (funcs['checkFriendSos'] || '').replace(/^function/, 'export function');
uiCode += (funcs['setupUserProfileInChat'] || '').replace(/^function/, 'export function');
uiCode += (funcs['toggleInviteOverlay'] || '').replace(/^function/, 'export function');
uiCode += (funcs['switchSocialTab'] || '').replace(/^function/, 'export function');
uiCode += (funcs['updateEmotionThermometer'] || '').replace(/^function/, 'export function');
uiCode += (funcs['getEmotionMetrics'] || '').replace(/^function/, 'export function');

// All the call related ones
uiCode += funcs['setupCallSystem'] || '';
uiCode += funcs['startCall'] || '';
uiCode += funcs['startCallSpeechRecognition'] || '';
uiCode += funcs['endCall'] || '';
uiCode += funcs['speakCallResponse'] || '';
uiCode += funcs['startVideoAnalysisLoop'] || '';

fs.writeFileSync('c:/Dev/feelingjournal/public/modules/chat/chatUI.js', uiCode);

// chatTools.js will be created but left mostly empty for now since the backend handles it
fs.writeFileSync('c:/Dev/feelingjournal/public/modules/chat/chatTools.js', `// Tool execution logic goes here (currently handled mostly on backend)\nexport const chatTools = {};\n`);

// index.js
let indexCode = `import { initializeChat, loadMessages, callChatAI, setupChatAssistant, setupChatUI, setupCallSystem, switchSocialTab, toggleInviteOverlay, loadContacts, checkFriendSos } from './chatUI.js';\n`;
indexCode += `import { chatApi } from './chatApi.js';\n`;
indexCode += `import { chatState } from './chatState.js';\n\n`;
indexCode += `window.chatApi = chatApi;\n\n`;

// Include the window.xxx definitions properly
indexCode += `export {\n`;
for (let key of Object.keys(funcs)) {
    if (key.match(/^(toggle|open|delete|block|switch|start|end)[A-Z]/) && !['toggleInviteOverlay', 'switchSocialTab'].includes(key)) {
        indexCode += `    ${key},\n`;
    }
}
indexCode += `};\n\n`;

for (let key of Object.keys(funcs)) {
    if (key.match(/^(toggle|open|delete|block|switch|start|end)[A-Z]/) && !['toggleInviteOverlay', 'switchSocialTab'].includes(key)) {
        indexCode += funcs[key].replace(/^window\.[a-zA-Z0-9_]+\s*=\s*(async\s*)?function/gm, 'export $1 function ' + key) + '\n\n';
    }
}

indexCode += `export function initChat() {\n`;
indexCode += `    initializeChat();\n`;
indexCode += `    setupChatAssistant();\n`;
indexCode += `    setupChatUI();\n`;
indexCode += `    setupCallSystem();\n`;
indexCode += `}\n`;

fs.writeFileSync('c:/Dev/feelingjournal/public/modules/chat/index.js', indexCode);

console.log('Build completed!');
