const fs = require('fs');
let code = fs.readFileSync('c:/Dev/feelingjournal/public/modules/chat/chatUI.js', 'utf8');

function replaceBlock(searchStart, searchEnd, replacement) {
    const start = code.indexOf(searchStart);
    if (start === -1) {
        console.log('Failed to find:', searchStart);
        return false;
    }
    const end = code.indexOf(searchEnd, start) + searchEnd.length;
    code = code.substring(0, start) + replacement + code.substring(end);
    return true;
}

replaceBlock(
    "const res = await fetch(`${API_URL}/persona`, {",
    "});\n            const data = await res.json();",
    "const data = await window.chatApi.fetchPersona();"
);

replaceBlock(
    "const res = await fetch(`${API_URL}/chat/messages?roomId=${encodeURIComponent(store.currentRoomId)}`, {",
    "});\n        const data = await res.json();",
    "const data = await window.chatApi.fetchMessages(store.currentRoomId);"
);

replaceBlock(
    "const res = await fetch(`${API_URL}/chat/ai-response`, {",
    "});\n        const data = await res.json();",
    "const data = await window.chatApi.postAiResponse({ message: msg, room_id: store.currentRoomId, room_title: title });"
);

replaceBlock(
    "const res = await fetch(`${API_URL}/chat/ai-response`, {",
    "});\n        const data = await res.json();",
    "const data = await window.chatApi.postAiResponse({ message: lastMsg, context: '사용자가 현재 대화에 대한 비서의 비밀 조언을 듣고 싶어합니다. 대화 상대에게는 보이지 않는 조언을 해주세요.' });"
);

replaceBlock(
    "const res = await fetch(`${API_URL}/chat/messages`, {",
    "});\n\n            const data = await res.json();",
    "const data = await window.chatApi.postMessage({ roomId: store.currentRoomId, content });"
);

replaceBlock(
    "const res = await fetch(`${API_URL}/chat/messages`, {",
    "});\n            const data = await res.json();",
    "const data = await window.chatApi.postMessage({ roomId: store.currentRoomId, content: imageUrl });"
);

replaceBlock(
    "const res = await fetch(`${API_URL}/chat/room`, {",
    "});\n        const data = await res.json();",
    "const data = await window.chatApi.createChatRoom({ title: roomTitle });"
);

replaceBlock(
    "const res = await fetch(`${API_URL}/contacts`, {",
    "});\n        const data = await res.json();",
    "const data = await window.chatApi.fetchContacts();"
);

replaceBlock(
    "const inviteRes = await fetch(`${API_URL}/invite`, {",
    "});\n                        const inviteData = await inviteRes.json();",
    "const inviteData = await window.chatApi.sendSmsInvite({ name: user.user_metadata?.full_name || '사용자', phone, inviteCode: user.id });"
);

replaceBlock(
    "const inviteRes = await fetch(`${API_URL}/invite`, {",
    "});\n                    const inviteData = await inviteRes.json();",
    "const inviteData = await window.chatApi.sendSmsInvite({ name: user.user_metadata?.full_name || '사용자', phone, inviteCode: user.id });"
);

replaceBlock(
    "const res = await fetch(`${API_URL}/friends/sos`, {",
    "});\n        const data = await res.json();",
    "const data = await window.chatApi.fetchFriendSos();"
);

replaceBlock(
    "const res = await fetch(`${API_URL}/friends/settings`, {",
    "});\n        const data = await res.json();",
    "const data = await window.chatApi.updateFriendSettings({ target_friend_id: friendId, stealth_mode: newStealth });"
);

replaceBlock(
    "const res = await fetch(`${API_URL}/friends/settings`, {",
    "});\n        const data = await res.json();",
    "const data = await window.chatApi.updateFriendSettings({ target_friend_id: friendId, share_mode: newShare });"
);

replaceBlock(
    "const res = await fetch(`${API_URL}/friends/delete`, {",
    "});\n        const data = await res.json();",
    "const data = await window.chatApi.deleteFriend({ target_friend_id: friendId });"
);

replaceBlock(
    "const res = await fetch(`${API_URL}/friends/settings`, {",
    "});\n        const data = await res.json();",
    "const data = await window.chatApi.updateFriendSettings({ target_friend_id: friendId, is_blocked: true });"
);

replaceBlock(
    "const res = await fetch(`${API_URL}/chat/room`, {",
    "});\n        const data = await res.json();",
    "const data = await window.chatApi.createChatRoom({ title: roomTitle });"
);

replaceBlock(
    "const res = await fetch(`${API_URL}/chat/ai-response`, {",
    "});\n            const data = await res.json();",
    "const data = await window.chatApi.postAiResponse({ message: transcript, room_id: store.currentRoomId, room_title: 'AI Video Call' });"
);

fs.writeFileSync('c:/Dev/feelingjournal/public/modules/chat/chatUI.js', code);
console.log('Replaced fetches in chatUI.js');
