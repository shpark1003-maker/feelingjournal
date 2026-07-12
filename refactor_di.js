const fs = require('fs');

let code = fs.readFileSync('c:/Dev/feelingjournal/public/modules/chat/chatUI.js', 'utf8');

function replaceBlock(searchStart, searchEnd, replacement) {
    const start = code.indexOf(searchStart);
    if (start === -1) return false;
    const end = code.indexOf(searchEnd, start) + searchEnd.length;
    code = code.substring(0, start) + replacement + code.substring(end);
    return true;
}

// 1. Line 22
replaceBlock(
    "const res = await fetch(`${API_URL}/persona`, {",
    "});\n            const data = await res.json();",
    "const data = await chatApi.fetchPersona();"
);

// 2. Line 51
replaceBlock(
    "const res = await fetch(`${API_URL}/chat/messages?roomId=${encodeURIComponent(store.currentRoomId)}`, {",
    "});\n        const data = await res.json();",
    "const data = await chatApi.fetchMessages(store.currentRoomId);"
);

// 3. Line 174
replaceBlock(
    "const res = await fetch(`${API_URL}/chat/ai-response`, {",
    "});\n        const data = await res.json();",
    "const data = await chatApi.postAiResponse({ message: msg, room_id: store.currentRoomId, room_title: title });"
);

// 4. Line 259
replaceBlock(
    "const res = await fetch(`${API_URL}/chat/ai-response`, {",
    "});\n        const data = await res.json();",
    "const data = await chatApi.postAiResponse({ message: lastMsg, context: '사용자가 현재 대화에 대한 비서의 비밀 조언을 듣고 싶어합니다. 대화 상대에게는 보이지 않는 조언을 해주세요.' });"
);

// 5. Line 336
replaceBlock(
    "const res = await fetch(`${API_URL}/chat/messages`, {",
    "});\n\n            const data = await res.json();",
    "const data = await chatApi.postMessage({ roomId: store.currentRoomId, content });"
);

// 6. Line 448
replaceBlock(
    "const res = await fetch(`${API_URL}/chat/messages`, {",
    "});\n            const data = await res.json();",
    "const data = await chatApi.postMessage({ roomId: store.currentRoomId, content: imageUrl });"
);

// 7. Line 624
replaceBlock(
    "const res = await fetch(`${API_URL}/chat/room`, {",
    "});\n        const data = await res.json();",
    "const data = await chatApi.createChatRoom({ title: roomTitle });"
);

// 8. Line 730
replaceBlock(
    "const res = await fetch(`${API_URL}/contacts`, {",
    "});\n        const data = await res.json();",
    "const data = await chatApi.fetchContacts();"
);

// 9. Line 798
replaceBlock(
    "const inviteRes = await fetch(`${API_URL}/invite`, {",
    "});\n                        const inviteData = await inviteRes.json();",
    "const inviteData = await chatApi.sendSmsInvite({ name: user.user_metadata?.full_name || '사용자', phone, inviteCode: user.id });"
);

// 10. Line 876
replaceBlock(
    "const inviteRes = await fetch(`${API_URL}/invite`, {",
    "});\n                    const inviteData = await inviteRes.json();",
    "const inviteData = await chatApi.sendSmsInvite({ name: user.user_metadata?.full_name || '사용자', phone, inviteCode: user.id });"
);

// 11. Line 950
replaceBlock(
    "const res = await fetch(`${API_URL}/friends/sos`, {",
    "});\n        const data = await res.json();",
    "const data = await chatApi.fetchFriendSos();"
);

// 12. Line 1184
replaceBlock(
    "const res = await fetch(`${API_URL}/friends/settings`, {",
    "});\n        const data = await res.json();",
    "const data = await chatApi.updateFriendSettings({ target_friend_id: friendId, stealth_mode: newStealth });"
);

// 13. Line 1212
replaceBlock(
    "const res = await fetch(`${API_URL}/friends/settings`, {",
    "});\n        const data = await res.json();",
    "const data = await chatApi.updateFriendSettings({ target_friend_id: friendId, share_mode: newShare });"
);

// 14. Line 1241
replaceBlock(
    "const res = await fetch(`${API_URL}/friends/delete`, {",
    "});\n        const data = await res.json();",
    "const data = await chatApi.deleteFriend({ target_friend_id: friendId });"
);

// 15. Line 1266
replaceBlock(
    "const res = await fetch(`${API_URL}/friends/settings`, {",
    "});\n        const data = await res.json();",
    "const data = await chatApi.updateFriendSettings({ target_friend_id: friendId, is_blocked: true });"
);

// 16. Line 1303
replaceBlock(
    "const res = await fetch(`${API_URL}/chat/room`, {",
    "});\n        const data = await res.json();",
    "const data = await chatApi.createChatRoom({ title: roomTitle });"
);

// 17. Line 1422
replaceBlock(
    "const res = await fetch(`${API_URL}/chat/ai-response`, {",
    "});\n            const data = await res.json();",
    "const data = await chatApi.postAiResponse({ message: transcript, room_id: store.currentRoomId, room_title: 'AI Video Call' });"
);

const fetchCount = (code.match(/fetch\(/g) || []).length;
console.log('Remaining fetch calls:', fetchCount);

if (fetchCount === 0) {
    fs.writeFileSync('c:/Dev/feelingjournal/public/modules/chat/chatUI.js', code);
    console.log('chatUI.js written successfully.');
} else {
    console.log('ERROR: Some fetch calls were not replaced!');
}
