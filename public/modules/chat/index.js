import { initializeChat, loadMessages, appendMessage, callChatAI, setupChatAssistant, setupChatUI, setupCallSystem, switchSocialTab, toggleInviteOverlay, loadContacts, checkFriendSos, speakCallResponse, updateEmotionThermometer } from './chatUI.js';
import { chatApi } from './chatApi.js';
import { chatState } from './chatState.js';

export { initializeChat, setupChatAssistant, setupChatUI, checkFriendSos } from './chatUI.js';

window.chatApi = chatApi;



export async function openChatWithAi() {
    try {
        const user = store.currentUser || (await store.supabaseClient.auth.getUser()).data?.user;
        if (!user) return;

        const roomName = `Private-AI-${user.id.slice(0, 8)}`;
        const token = await store.getSessionToken();
        
        const res = await fetch(`${API_URL}/chat/room`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ name: roomName, type: 'private' })
        });

        const data = await res.json();
        if (data.success && data.room) {
            const { openChatWindow } = await import('../floatingChat.js');
            await openChatWindow(data.room.id, `✨ ${document.getElementById('ai-name')?.value || '비서'}와 대화`);
        } else {
            console.error('Failed to get/create chat room:', data.error);
            alert('채팅방 연결에 실패했습니다.');
        }
    } catch (err) {
        console.error('openChatWithAi Error:', err);
    }
}



export async function switchChatRoom(roomId, title) {
    console.log(`--- [CHAT] Switch Request: ${roomId} (${title}) ---`);
    if (!roomId) return;

    store.currentRoomId = roomId;
    const titleEl = document.getElementById('chat-room-title-text');
    if (titleEl) titleEl.innerText = title;

    // Close mobile chat drawer on switching room
    if (window.innerWidth <= 768) {
        document.querySelector('.chat-sidebar')?.classList.remove('active-drawer');
    }

    // [NEW] 1촌 감성 온도계 & 예보 배너 다이내믹 렌더링
    try {
        const friend = (store.allFriends || []).find(f => f.nickname === title);
        const isFriendRoom = !!friend;
        const settingsBtn = document.getElementById('chat-friend-settings-btn');
        if (isFriendRoom) {
            const friendNickname = friend.nickname;
            const emotion = friend ? friend.current_emotion : '평온';
            updateEmotionThermometer(friendNickname, emotion);
            if (settingsBtn && friend) {
                settingsBtn.style.display = 'block';
                settingsBtn.onclick = () => window.openFriendSettingsModal(friend);
            }
        } else {
            // AI 비서방이거나 비밀 대화 등인 경우 감성 배너 숨김
            updateEmotionThermometer(null, null);
            if (settingsBtn) settingsBtn.style.display = 'none';
        }
    } catch (err) {
        console.error('Failed to update emotional thermometer banner:', err);
    }

    if (store.chatChannel) {
        console.log('--- [CHAT] Removing previous channel ---');
        await store.supabaseClient.removeChannel(store.chatChannel);
    }

    store.chatChannel = store.supabaseClient.channel(`room:${store.currentRoomId}`)
        .on('postgres_changes', {
            event: 'INSERT',
            schema: 'public',
            table: 'messages',
            filter: `room_id=eq.${store.currentRoomId}`
        }, (payload) => {
            console.log('--- [CHAT] New message received via Realtime ---', payload.new);
            appendMessage(payload.new);

            const isMyMessage = store.currentUser?.id && payload.new.sender_id === store.currentUser.id;
            const isAiMessage = payload.new.user_email === 'ai@feeling.journal';

            if (title.includes('와 대화') && isMyMessage && !isAiMessage) {
                console.log('--- [CHAT] Triggering AI Auto-Response ---');
                callChatAI(payload.new.content);
            }
        })
        .subscribe((status) => {
            console.log(`--- [CHAT] Subscription Status for ${store.currentRoomId}: ${status} ---`);
            if (status === 'SUBSCRIBED') {
                loadMessages();
            }
        });
}



export async function startCall(mode) {
    console.log(`--- [CALL] Starting ${mode} call ---`);
    const overlay = document.getElementById('call-overlay');
    const videoPreview = document.getElementById('user-video-preview');
    const statusText = document.getElementById('call-status-text');
    const avatarBox = document.getElementById('ai-video-avatar');

    try {
        chatState.localStream = await navigator.mediaDevices.getUserMedia({
            video: mode === 'video',
            audio: true
        });

        chatState.isCallActive = true;
        if (overlay) overlay.classList.remove('hidden');
        if (videoPreview) videoPreview.srcObject = chatState.localStream;

        const currentGender = document.querySelector('input[name="gender"]:checked')?.value || '여성';
        if (avatarBox) avatarBox.innerText = currentGender === '여성' ? '👩‍💼' : '👨‍💼';

        if (statusText) statusText.innerText = '비서와 연결되었습니다...';

        speakCallResponse('안녕하세요! 무엇을 도와드릴까요? 편안하게 말씀하세요.');

        if (mode === 'video') {
            startVideoAnalysisLoop();
        }

        startCallSpeechRecognition();

    } catch (err) {
        console.error('Call Start Error:', err);
        chatState.isCallActive = false;
        if (overlay) overlay.classList.add('hidden');
        alert('카메라 또는 마이크 하드웨어 권한 획득에 실패하여, 일반 음성/정적 비서 대화방 모드로 안전하게 전환합니다.');
        endCall();
    }
}



export function startCallSpeechRecognition() {
    if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) return;
    
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    chatState.callRecognition = new SpeechRec();
    chatState.callRecognition.continuous = false;
    chatState.callRecognition.interimResults = false;
    chatState.callRecognition.lang = 'ko-KR';

    chatState.callRecognition.onend = () => {
        if (chatState.isCallActive) {
            try {
                chatState.callRecognition.start();
            } catch (e) {}
        }
    };

    chatState.callRecognition.onresult = async (event) => {
        const text = event.results[0][0].transcript.trim();
        if (!text) return;
        
        console.log(`--- [CALL-STT] User said: ${text} ---`);
        const statusText = document.getElementById('call-status-text');
        if (statusText) statusText.innerText = `나: "${text}"`;

        try {
            const token = await store.getSessionToken();
            const res = await fetch(`${API_URL}/chat/ai-response`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    message: text,
                    context: '비서와 실시간 음성/화상 통화 중입니다. 다정하고 부드럽게 바로 대화해주는 투로 짤막하게 한 문장으로 대답해 주세요.'
                })
            });
            const data = await res.json();
            if (data.success) {
                speakCallResponse(data.answer);
            }
        } catch (err) {
            console.error(err);
        }
    };

    try {
        chatState.callRecognition.start();
    } catch(e) {}
}



export function endCall() {
    console.log('--- [CALL] Ending call ---');
    chatState.isCallActive = false;
    if (chatState.callRecognition) {
        chatState.callRecognition.onend = null;
        chatState.callRecognition.stop();
        chatState.callRecognition = null;
    }
    if (chatState.localStream) {
        chatState.localStream.getTracks().forEach(track => track.stop());
        chatState.localStream = null;
    }
    document.getElementById('call-overlay')?.classList.add('hidden');
    window.speechSynthesis.cancel();
}



export async function startVideoAnalysisLoop() {
    const video = document.getElementById('user-video-preview');
    const canvas = document.createElement('canvas');

    while (chatState.isCallActive) {
        if (chatState.localStream && chatState.localStream.getVideoTracks()[0] && chatState.localStream.getVideoTracks()[0].enabled && video) {
            canvas.width = video.videoWidth / 2;
            canvas.height = video.videoHeight / 2;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const frameData = canvas.toDataURL('image/jpeg', 0.5);
        }
        await new Promise(r => setTimeout(r, 5000));
    }
}

/* ==========================================================================
   [NEW] 1촌 감성 온도계 & 예보 배너 UI 헬퍼 함수들 (Phase 1)
   ========================================================================== */



export  function toggleFriendSettings(friendId) {
    const friend = (store.allFriends || []).find(f => f.id === friendId);
    if (friend) {
        window.openFriendSettingsModal(friend);
    }
};



export  function openFriendSettingsModal(friend) {
    const modal = document.getElementById('friend-settings-modal');
    if (!modal) return;

    document.getElementById('friend-settings-modal-title').innerText = `👥 1촌 설정 (${friend.nickname})`;

    const stealthBtn = document.getElementById('modal-stealth-btn');
    const shareBtn = document.getElementById('modal-share-btn');
    const deleteBtn = document.getElementById('modal-delete-btn');
    const blockBtn = document.getElementById('modal-block-btn');

    if (stealthBtn) {
        stealthBtn.innerText = friend.my_stealth ? '🤫 스텔스 중' : '🤫 스텔스 꺼짐';
        stealthBtn.style.background = friend.my_stealth ? '#667eea' : '#f1f2f6';
        stealthBtn.style.color = friend.my_stealth ? 'white' : '#2f3542';
        stealthBtn.onclick = async () => {
            await window.toggleFriendStealth(friend.id, friend.my_stealth);
            friend.my_stealth = !friend.my_stealth;
            window.openFriendSettingsModal(friend);
        };
    }

    if (shareBtn) {
        shareBtn.innerText = friend.my_share ? '🧠 공유 중' : '🧠 공유 꺼짐';
        shareBtn.style.background = friend.my_share ? '#2bcbba' : '#f1f2f6';
        shareBtn.style.color = friend.my_share ? 'white' : '#2f3542';
        shareBtn.onclick = async () => {
            await window.toggleFriendShare(friend.id, friend.my_share);
            friend.my_share = !friend.my_share;
            window.openFriendSettingsModal(friend);
        };
    }

    if (deleteBtn) {
        deleteBtn.onclick = async () => {
            await window.deleteFriend(friend.id);
            modal.style.display = 'none';
        };
    }

    if (blockBtn) {
        blockBtn.onclick = async () => {
            await window.blockFriend(friend.id);
            modal.style.display = 'none';
        };
    }

    modal.style.display = 'flex';
};



export  function openInviteModal() {
    const modal = document.getElementById('invite-modal');
    if (modal) modal.style.display = 'flex';
    if (window.innerWidth <= 768) {
        document.querySelector('.chat-sidebar')?.classList.remove('active-drawer');
    }
    loadContacts();
};



export async  function toggleFriendStealth(friendId, currentStealth) {
    try {
        const token = await store.getSessionToken();
        const res = await fetch(`${API_URL}/friends/settings`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                friendId,
                field: 'stealth_mode',
                value: !currentStealth
            })
        });
        const data = await res.json();
        if (data.success) {
            alert('스텔스 상태가 변경되었습니다.');
            checkFriendSos();
        } else {
            alert('설정 변경 실패: ' + data.error);
        }
    } catch (err) {
        console.error(err);
        alert('서버 통신 오류');
    }
};



export async  function toggleFriendShare(friendId, currentShare) {
    try {
        const token = await store.getSessionToken();
        const res = await fetch(`${API_URL}/friends/settings`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                friendId,
                field: 'share_emotion',
                value: !currentShare
            })
        });
        const data = await res.json();
        if (data.success) {
            alert('감정 공유 상태가 변경되었습니다.');
            checkFriendSos();
        } else {
            alert('설정 변경 실패: ' + data.error);
        }
    } catch (err) {
        console.error(err);
        alert('서버 통신 오류');
    }
};



export async  function deleteFriend(friendId) {
    if (!confirm('정말 1촌 관계를 해제하시겠습니까?')) return;
    try {
        const token = await store.getSessionToken();
        const res = await fetch(`${API_URL}/friends/delete`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ friendId })
        });
        const data = await res.json();
        if (data.success) {
            alert('1촌 관계가 해제되었습니다.');
            checkFriendSos();
        } else {
            alert('해제 실패: ' + data.error);
        }
    } catch (err) {
        console.error(err);
        alert('서버 통신 오류');
    }
};



export async  function blockFriend(friendId) {
    if (!confirm('정말 이 친구를 차단하시겠습니까? 서로의 친구 목록에서 보이지 않게 됩니다.')) return;
    try {
        const token = await store.getSessionToken();
        const res = await fetch(`${API_URL}/friends/settings`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                friendId,
                field: 'is_blocked',
                value: true
            })
        });
        const data = await res.json();
        if (data.success) {
            alert('친구가 차단되었습니다.');
            checkFriendSos();
        } else {
            alert('차단 실패: ' + data.error);
        }
    } catch (err) {
        console.error(err);
        alert('서버 통신 오류');
    }
};

// 바인딩용 global helper
window.openChatWithAi = openChatWithAi;



export async  function openChatWithFriend(friendId, friendNickname) {
    try {
        const { data: { user } } = await store.supabaseClient.auth.getUser();
        if (!user) return;

        const ids = [user.id, friendId].sort();
        const roomName = `Friend-${ids[0].slice(0, 8)}-${ids[1].slice(0, 8)}`;
        const token = await store.getSessionToken();

        const res = await fetch(`${API_URL}/chat/room`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ name: roomName, type: 'private' })
        });
        const data = await res.json();
        if (data.success && data.room) {
            const { openChatWindow } = await import('../floatingChat.js');
            await openChatWindow(data.room.id, friendNickname);
        } else {
            console.error('Room registration failed:', data.error);
            alert('채팅방 연결에 실패했습니다.');
        }
    } catch (e) {
        console.error('openChatWithFriend Error:', e);
    }
};



export async  function openSmsQrInviteModal(name, phone) {
    const oldModal = document.getElementById('sms-qr-invite-modal');
    if (oldModal) oldModal.remove();

    // Close the mobile drawer when the modal opens
    const sidebar = document.querySelector('.chat-sidebar');
    if (sidebar && sidebar.classList.contains('active-drawer')) {
        sidebar.classList.remove('active-drawer');
    }


    let currentUser = store.currentUser;
    if (!currentUser) {
        const { data: { user } } = await store.supabaseClient.auth.getUser();
        currentUser = user;
    }
    const inviterName = currentUser?.email ? currentUser.email.split('@')[0] : '친구';
    let origin = window.location.origin;
    if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
        origin = 'https://feelingjournal.vercel.app';
    }
    const shareLink = `${origin}/?invite_code=${currentUser?.id || ''}`;
    const qrLink = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(shareLink)}`;
    const smsBody = `[Feeling Journal] 감정 일기장 초대장 ✨\n\n${inviterName}님이 당신을 마음 온도를 공유하는 Feeling Journal로 초대했습니다!\n\n🔗 초대 링크 접속:\n${shareLink}`;

    const modal = document.createElement('div');
    modal.id = 'sms-qr-invite-modal';
    modal.style.cssText = `
        position: fixed;
        top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0,0,0,0.5);
        backdrop-filter: blur(8px);
        display: flex; align-items: center; justify-content: center;
        z-index: 10000;
    `;

    modal.innerHTML = `
        <div style="background: white; border-radius: 24px; padding: 30px; width: 90%; max-width: 420px; box-shadow: 0 20px 40px rgba(0,0,0,0.15); text-align: center; font-family: 'Outfit', 'Nanum', sans-serif;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                <h3 style="margin: 0; font-size: 1.3rem; font-weight: 700; color: #2d3436; font-family: sans-serif;">📱 SMS 및 QR코드 초대</h3>
                <button onclick="document.getElementById('sms-qr-invite-modal').remove()" style="background: none; border: none; font-size: 1.5rem; cursor: pointer; color: #b2bec3;">&times;</button>
            </div>
            
            <p style="font-size: 0.95rem; color: #636e72; line-height: 1.5; margin-bottom: 20px; font-family: sans-serif;">
                <strong>${name}</strong>님(${phone})에게 보낼 초대 메시지와 QR코드입니다.<br>
                아래 방법 중 하나를 선택해 친구를 초대해 보세요!
            </p>

            <div style="background: #f1f2f6; border-radius: 16px; padding: 15px; margin-bottom: 20px; display: inline-block;">
                <img src="${qrLink}" alt="QR Code" style="width: 160px; height: 160px; display: block; border-radius: 8px; box-shadow: 0 4px 10px rgba(0,0,0,0.05);">
                <span style="font-size: 0.75rem; color: #7f8c8d; display: block; margin-top: 8px; font-family: sans-serif;">📷 폰 카메라로 스캔하여 즉시 입장</span>
            </div>

            <div style="text-align: left; background: #fafafa; border: 1px dashed #dfe6e9; border-radius: 12px; padding: 12px; font-size: 0.85rem; color: #2d3436; max-height: 100px; overflow-y: auto; margin-bottom: 20px; word-break: break-all; font-family: sans-serif;">
                ${smsBody.replace(/\n/g, '<br>')}
            </div>

            <div style="display: flex; flex-direction: column; gap: 10px;">
                <button id="copy-sms-btn" style="background: linear-gradient(135deg, #6c5ce7, #a29bfe); color: white; border: none; padding: 12px; border-radius: 12px; font-weight: 700; cursor: pointer; transition: all 0.2s; box-shadow: 0 4px 10px rgba(108,92,231,0.2); font-family: sans-serif;">
                    📋 초대 메시지 & 링크 복사
                </button>
                <a href="sms:${phone.replace(/[^0-9+]/g, '')}?body=${encodeURIComponent(smsBody + '\n🖼️ QR코드로 접속:\n' + qrLink)}" style="text-decoration: none; background: #00b894; color: white; padding: 12px; border-radius: 12px; font-weight: 700; cursor: pointer; display: block; transition: all 0.2s; box-shadow: 0 4px 10px rgba(0,184,148,0.2); text-align: center; font-family: sans-serif;">
                    💬 휴대폰 문자(SMS)로 보내기
                </a>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    document.getElementById('copy-sms-btn').addEventListener('click', () => {
        navigator.clipboard.writeText(`${smsBody}\n🖼️ QR코드로 접속:\n${qrLink}`).then(() => {
            alert('📋 초대 메시지와 QR코드 링크가 클립보드에 성공적으로 복사되었습니다!\n카카오톡이나 문자 메시지에 붙여넣어 공유하세요.');
        }).catch(() => {
            alert('복사에 실패했습니다. 메시지 창에서 텍스트를 직접 복사해 주세요.');
        });
    });
};



export function initChat() {
    initializeChat();
    setupChatAssistant();
    setupChatUI();
    setupCallSystem();
}
