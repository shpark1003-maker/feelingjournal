const fs = require('fs');

let index = fs.readFileSync('c:/Dev/feelingjournal/public/modules/chat/index.js', 'utf8');

const eventListener = `
document.addEventListener('click', (e) => {
    const actionBtn = e.target.closest('[data-action]');
    if (!actionBtn) return;
    
    const action = actionBtn.dataset.action;
    
    if (action === 'openChatWithFriend') {
        openChatWithFriend(actionBtn.dataset.id, actionBtn.dataset.name);
    } else if (action === 'toggleFriendSettings') {
        toggleFriendSettings(actionBtn.dataset.id);
    } else if (action === 'openFriendSettingsModal') {
        const friendStr = actionBtn.dataset.friend;
        if (friendStr) openFriendSettingsModal(JSON.parse(friendStr));
    } else if (action === 'deleteFriend') {
        deleteFriend(actionBtn.dataset.id);
    } else if (action === 'blockFriend') {
        blockFriend(actionBtn.dataset.id);
    } else if (action === 'toggleFriendStealth') {
        toggleFriendStealth(actionBtn.dataset.id, actionBtn.dataset.stealth === 'true');
    } else if (action === 'toggleFriendShare') {
        toggleFriendShare(actionBtn.dataset.id, actionBtn.dataset.share === 'true');
    } else if (action === 'openInviteModal') {
        openInviteModal();
    } else if (action === 'openSmsQrInviteModal') {
        openSmsQrInviteModal(actionBtn.dataset.name, actionBtn.dataset.phone);
    }
});
`;

if (!index.includes('data-action')) {
    fs.writeFileSync('c:/Dev/feelingjournal/public/modules/chat/index.js', index + '\n' + eventListener);
}

// Now replace onclick in chatUI.js and chatApi.js
function replaceOnclick(file) {
    if (!fs.existsSync(file)) return;
    let content = fs.readFileSync(file, 'utf8');
    
    // openChatWithFriend('id', 'name')
    content = content.replace(/onclick="window\.openChatWithFriend\('([^']+)',\s*'([^']+)'\)"/g, 'data-action="openChatWithFriend" data-id="$1" data-name="$2"');
    
    // toggleFriendSettings('id')
    content = content.replace(/onclick="window\.toggleFriendSettings\('([^']+)'\)"/g, 'data-action="toggleFriendSettings" data-id="$1"');
    
    // openFriendSettingsModal(...)
    content = content.replace(/onclick='window\.openFriendSettingsModal\((.*?)\)'/g, "data-action=\"openFriendSettingsModal\" data-friend='$1'");
    
    // deleteFriend('id')
    content = content.replace(/onclick="window\.deleteFriend\('([^']+)'\)"/g, 'data-action="deleteFriend" data-id="$1"');
    
    // blockFriend('id')
    content = content.replace(/onclick="window\.blockFriend\('([^']+)'\)"/g, 'data-action="blockFriend" data-id="$1"');
    
    // toggleFriendStealth('id', true|false)
    content = content.replace(/onclick="window\.toggleFriendStealth\('([^']+)',\s*(true|false)\)"/g, 'data-action="toggleFriendStealth" data-id="$1" data-stealth="$2"');
    
    // toggleFriendShare('id', true|false)
    content = content.replace(/onclick="window\.toggleFriendShare\('([^']+)',\s*(true|false)\)"/g, 'data-action="toggleFriendShare" data-id="$1" data-share="$2"');
    
    // openInviteModal()
    content = content.replace(/onclick="window\.openInviteModal\(\)"/g, 'data-action="openInviteModal"');
    
    // openSmsQrInviteModal('name', 'phone')
    content = content.replace(/onclick="window\.openSmsQrInviteModal\('([^']+)',\s*'([^']+)'\)"/g, 'data-action="openSmsQrInviteModal" data-name="$1" data-phone="$2"');
    
    fs.writeFileSync(file, content);
}

replaceOnclick('c:/Dev/feelingjournal/public/modules/chat/chatUI.js');
replaceOnclick('c:/Dev/feelingjournal/public/modules/chat/chatApi.js');
console.log('Event delegation updated successfully.');
