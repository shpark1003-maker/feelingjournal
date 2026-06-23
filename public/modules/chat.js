import { store, API_URL, assertIds } from './state.js?v=5.7.3';


let localStream = null;
let isCallActive = false;
let callRecognition = null;
let currentFriendSortMode = 'name'; // 'name', 'degree', 'sos'

export async function initializeChat() {
    assertIds('Chat', [
        'tab-people', 'tab-chats', 'friend-status-list', 'friend-sort-options-v2', 
        'chat-room-list', 'copy-share-link-btn', 'chat-history', 'chat-room-title-text', 
        'message-input-field', 'send-btn', 'chat-attach-btn', 'chat-image-attach-input', 
        'invite-modal', 'friend-settings-modal', 'call-overlay'
    ]);

    console.log('--- [CHAT] Initializing Chat - Defaulting to AI Secretary ---');
    
    try {
        const token = await store.getSessionToken();
        if (token) {
            const res = await fetch(`${API_URL}/persona`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            if (data.success && data.persona) {
                store.currentAvatarUrl = data.persona.avatarUrl || '';
                store.currentAvatarName = data.persona.name || '비서';

                // Update dynamic name/avatar in chat list
                const listName = document.getElementById('v2-chat-list-ai-name');
                if (listName) {
                    listName.innerText = `✨ ${store.currentAvatarName}와 대화`;
                }
                const listAvatar = document.getElementById('v2-chat-list-ai-avatar');
                if (listAvatar && store.currentAvatarUrl) {
                    listAvatar.src = store.currentAvatarUrl;
                }
            }
        }
    } catch (e) {
        console.warn('Failed to prefetch AI persona for chat:', e);
    }
}

export async function loadMessages() {
    try {
        const token = await store.getSessionToken();
        if (!token) return;

        const res = await fetch(`${API_URL}/chat/messages?roomId=${encodeURIComponent(store.currentRoomId)}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        
        const container = document.getElementById('chat-history');
        if (container) {
            container.innerHTML = '';
            data?.messages?.forEach(appendMessage);
        }
    } catch (e) {
        console.error('Failed to load messages:', e);
    }
}

export function appendMessage(msg) {
    const container = document.getElementById('chat-history');
    if (!container) return;

    // [Cozy Ghibli Interaction] Conversational Dimming: 이전 메시지들은 흐리게 처리
    const previousBubbles = container.querySelectorAll('.message-content');
    previousBubbles.forEach(b => {
        b.classList.remove('active-bubble');
        b.classList.add('dim-context');
    });

    const isAi = msg.user_email === 'ai@feeling.journal' || msg.sender_id === '00000000-0000-0000-0000-000000000000';
    const isFriend = msg.user_email && msg.user_email.startsWith('friend-');
    const isMe = !isAi && !isFriend && (msg.sender_id === store.currentUser?.id || msg.user_email === document.getElementById('user-email')?.innerText);

    const div = document.createElement('div');
    div.className = `message ${isMe ? 'sent' : 'received'} ${(isAi || isFriend) ? 'ai-message' : ''}`;

    let senderName = msg.user_email ? msg.user_email.split('@')[0] : '알수없음';
    if (isAi) {
        senderName = document.getElementById('ai-name')?.value || '비서';
    } else if (isFriend) {
        const decodedPart = msg.user_email.replace('friend-', '').split('@')[0];
        try {
            senderName = decodeURIComponent(decodedPart);
        } catch (e) {
            senderName = decodedPart;
        }
    }

    // [NEW] 사용자별 프로필 이미지 동적 결합 (Ghibli Theme)
    const myAvatarUrl = store.currentUser?.user_metadata?.avatar_url || '';
    const avatarHtml = isMe 
        ? (myAvatarUrl 
            ? `<img class="chat-msg-avatar" src="${myAvatarUrl}?t=${Date.now()}" style="width: 34px; height: 34px; border-radius: 50%; object-fit: cover; border: 2px solid #5d574d; margin-right: 8px; box-shadow: 1px 1px 0px rgba(0,0,0,0.05);">`
            : `<div class="chat-msg-avatar-fallback" style="width: 34px; height: 34px; border-radius: 50%; background: #e8f0e0; display: flex; align-items: center; justify-content: center; font-size: 1.1rem; border: 2px solid #5d574d; margin-right: 8px; color: #5d574d; box-shadow: 1px 1px 0px rgba(0,0,0,0.05);">👤</div>`)
        : (isAi 
            ? (store.currentAvatarUrl
                ? `<img class="chat-msg-avatar" src="${store.currentAvatarUrl}" style="width: 34px; height: 34px; border-radius: 50%; object-fit: cover; border: 2px solid #5d574d; margin-right: 8px; box-shadow: 1px 1px 0px rgba(0,0,0,0.05);">`
                : `<div class="chat-msg-avatar-fallback" style="width: 34px; height: 34px; border-radius: 50%; background: #f9d976; display: flex; align-items: center; justify-content: center; font-size: 1.2rem; border: 2px solid #5d574d; margin-right: 8px; color: #5d574d; box-shadow: 1px 1px 0px rgba(0,0,0,0.05);">🤖</div>`)
            : `<div class="chat-msg-avatar-fallback" style="width: 34px; height: 34px; border-radius: 50%; background: #fdf2b5; display: flex; align-items: center; justify-content: center; font-size: 1.1rem; border: 2px solid #5d574d; margin-right: 8px; color: #5d574d; box-shadow: 1px 1px 0px rgba(0,0,0,0.05);">👥</div>`);

    // [NEW] 만약 메시지 본문이 ![image](url) 형식이면 이미지 카드로 아름답게 렌더링
    const imgMatch = msg.content && msg.content.trim().match(/^!\[image\]\((.*?)\)$/);
    const isImage = !!imgMatch;
    const imageUrl = isImage ? imgMatch[1] : '';

    // 이미지가 로드 실패(onerror)할 경우, 경고 카드 형태의 UI로 안전하게 대체 처리
    const contentHtml = isImage 
        ? `<img class="chat-inline-photo" src="${imageUrl}" style="max-width: 250px; border-radius: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.08); cursor: pointer; display: block; margin-top: 4px; border: 2px solid #5d574d;" onclick="window.open('${imageUrl}', '_blank')" onerror="this.onerror=null; this.outerHTML='<div class=&quot;image-load-failed&quot; style=&quot;padding: 10px 14px; background: #ffebee; color: #d63031; border-radius: 12px; font-size: 0.85rem; display: flex; align-items: center; gap: 6px; border: 1.5px solid #5d574d; font-weight: 500;&quot;>⚠️ 이미지를 불러올 수 없습니다.</div>';">`
        : msg.content;

    // [Ghibli Theme Redesign Style mapping]
    let messageContentStyle = '';
    if (isMe) {
        // Alternating background colors for user messages matching the prototype design
        const isAlternate = msg.content && msg.content.length % 2 === 0;
        messageContentStyle = `padding: ${isImage ? '6px' : '10px 14px'}; border-radius: 12px 2px 12px 12px; font-size: clamp(12px, 3vw + 8px, 15px); max-width: 80%; background: ${isAlternate ? '#e8f0e0' : '#fdf2b5'}; border: 2px solid #5d574d; color: #433e37; box-shadow: 2px 2px 0px rgba(93,87,77,0.15);`;
    } else {
        messageContentStyle = `padding: ${isImage ? '6px' : '10px 14px'}; border-radius: 2px 12px 12px 12px; font-size: clamp(12px, 3vw + 8px, 15px); max-width: 80%; background: #fffef0; border: 2px solid #5d574d; color: #433e37; box-shadow: 2px 2px 0px rgba(93,87,77,0.15);`;
    }

    div.innerHTML = `
        <div style="display: flex; align-items: flex-start; gap: 8px; width: 100%; ${isMe ? 'flex-direction: row-reverse;' : ''}">
            ${avatarHtml}
            <div style="flex: 1; display: flex; flex-direction: column; align-items: ${isMe ? 'flex-end' : 'flex-start'};">
                <span class="message-sender" style="font-size: clamp(10px, 2vw + 6px, 13px); color: #5d574d; font-weight: 700; margin-bottom: 2px;">${senderName}</span>
                <div class="message-content paper-note active-bubble" style="${messageContentStyle}">${contentHtml}</div>
                <span class="message-info" style="font-size: clamp(9px, 1.5vw + 5px, 11px); color: #8b8273; margin-top: 4px;">${new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
        </div>
    `;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

export async function callChatAI(msg) {
    try {
        const token = await store.getSessionToken();
        const title = document.getElementById('chat-room-title-text')?.innerText || '';
        const res = await fetch(`${API_URL}/chat/ai-response`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ 
                message: msg, 
                room_id: store.currentRoomId,
                room_title: title
            })
        });
        const data = await res.json();
        if (!data.success) {
            throw new Error(data.error || 'Server error');
        }
    } catch (err) {
        console.error('AI Response Error:', err);
        appendChatErrorMsg(msg);
    }
}

function appendChatErrorMsg(retryMsg) {
    const container = document.getElementById('chat-history');
    if (!container) return;
    
    const div = document.createElement('div');
    div.className = 'message received ai-message error-bubble';
    div.style.alignSelf = 'flex-start';
    
    const personaName = document.getElementById('ai-name')?.value || '비서';
    
    div.innerHTML = `
        <div style="display: flex; align-items: flex-start; gap: 8px; width: 100%;">
            <div class="chat-msg-avatar-fallback" style="width: 34px; height: 34px; border-radius: 50%; background: #ffebee; display: flex; align-items: center; justify-content: center; font-size: 1.1rem; border: 2px solid #5d574d; margin-right: 8px; color: #d63031; box-shadow: 1px 1px 0px rgba(0,0,0,0.05);">⚠️</div>
            <div style="flex: 1; display: flex; flex-direction: column; align-items: flex-start;">
                <span class="message-sender" style="font-size: clamp(10px, 2vw + 6px, 13px); color: #5d574d; font-weight: 700; margin-bottom: 2px;">${personaName}</span>
                <div class="message-content paper-note active-bubble" style="padding: 10px 14px; border-radius: 2px 12px 12px 12px; font-size: clamp(12px, 3vw + 8px, 15px); max-width: 80%; background: #ffebee; border: 2px solid #d63031; color: #c0392b; box-shadow: 2px 2px 0px rgba(93,87,77,0.15); display: flex; flex-direction: column; gap: 8px;">
                    <span>비서가 답변을 작성하지 못했습니다. (연결 상태 확인 필요)</span>
                    <button class="chat-retry-btn" style="align-self: flex-start; background: #D4A373; border: 1.5px solid #5D574D; border-radius: 8px; padding: 4px 10px; font-size: 0.75rem; color: white; cursor: pointer; font-weight: bold; box-shadow: 1px 1px 0px rgba(0,0,0,0.15); transition: transform 0.1s;">다시 보내기 ↻</button>
                </div>
            </div>
        </div>
    `;
    const btn = div.querySelector('.chat-retry-btn');
    btn.addEventListener('click', () => {
        div.remove();
        callChatAI(retryMsg);
    });
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

export function setupChatAssistant() {
    document.getElementById('ai-summon-btn')?.addEventListener('click', async () => {
        const lastMsg = document.querySelector('.message:last-child .message-content')?.innerText || '안녕?';
        callChatAI(`[참여 요청] 현재 대화 상황을 파악하고 대화에 참여해줘. 마지막 말: "${lastMsg}"`);
    });

    document.getElementById('ai-secret-btn')?.addEventListener('click', async () => {
        const token = await store.getSessionToken();
        const lastMsg = document.querySelector('.message:last-child .message-content')?.innerText || '';

        const res = await fetch(`${API_URL}/chat/ai-response`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                message: lastMsg,
                context: '사용자가 현재 대화에 대한 비서의 비밀 조언을 듣고 싶어합니다. 대화 상대에게는 보이지 않는 조언을 해주세요.'
            })
        });
        const data = await res.json();
        if (data.success) {
            alert(`🤫 비서의 비밀 조언:\n\n${data.answer}`);
        }
    });
}

export function setupChatUI() {
    // [NEW] 내 프로필 섹션 기동
    setupUserProfileInChat();

    const inviteBtn = document.getElementById('invite-friend-btn');
    const modal = document.getElementById('invite-modal') || document.getElementById('invite-overlay');

    inviteBtn?.addEventListener('click', () => {
        toggleInviteOverlay(true);
        loadContacts();
    });

    // 1촌 초대 모달 내 닫기 액션 위임 (인라인 onclick 대체)
    modal?.addEventListener('click', (e) => {
        const target = e.target.closest('[data-action="close-invite"], #overlay-backdrop');
        if (target) {
            e.preventDefault();
            toggleInviteOverlay(false);
        }
    });

    document.getElementById('copy-share-link-btn')?.addEventListener('click', async () => {
        try {
            const user = store.currentUser || (await store.supabaseClient.auth.getUser()).data.user;
            if (!user) {
                alert('로그인이 필요합니다.');
                return;
            }
            let origin = window.location.origin;
            if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
                origin = 'https://feelingjournal.vercel.app';
            }
            const shareLink = `${origin}/?invite_code=${user.id}`;
            await navigator.clipboard.writeText(shareLink);
            alert(`📋 1촌 초대 링크가 클립보드에 성공적으로 복사되었습니다!\n\n${shareLink}\n\n이 링크를 카카오톡이나 문자로 친구에게 공유해 보세요.`);
        } catch (err) {
            console.error('Failed to copy share link:', err);
            alert('초대 링크 복사에 실패했습니다.');
        }
    });

    // Chat input event list
    const sendBtn = document.getElementById('send-btn');
    sendBtn?.addEventListener('click', async () => {
        const input = document.getElementById('message-input-field');
        if (!input) return;
        const content = input.value.trim();
        if (!content) return;

        try {
            const token = await store.getSessionToken();
            if (!token) return;

            const res = await fetch(`${API_URL}/chat/messages`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    roomId: store.currentRoomId,
                    content
                })
            });

            const data = await res.json();
            if (!data.success) throw new Error(data.error);

            input.value = '';

            const title = document.getElementById('chat-room-title-text').innerText;
            if (title.includes('님과의 대화')) {
                // 데모/가상 친구방(영희, 철수, 민수, 데모)인 경우에만 자동 답변 처리
                const isMock = title.includes('영희') || title.includes('철수') || title.includes('민수') || title.includes('데모');
                if (isMock) {
                    callChatAI(content);
                } else {
                    // 실제 친구 대화방에서는 @비서 등 멘션이 포함된 경우에만 호출하여 '참견/조언' 유도
                    const personaName = document.getElementById('ai-name')?.value || '비서';
                    const mentions = ['@비서', '@ai', '@원이', '@원이비서', `@${personaName.toLowerCase()}`, `@${personaName.toLowerCase()}비서`];
                    const lowerContent = content.toLowerCase();
                    if (mentions.some(m => lowerContent.includes(m))) {
                        callChatAI(content);
                    }
                }
            } else if (!title.includes('비밀 채팅')) {
                const personaName = document.getElementById('ai-name')?.value || '비서';
                const mentions = ['@비서', '@ai', '@원이', '@원이비서', `@${personaName.toLowerCase()}`, `@${personaName.toLowerCase()}비서`];
                const lowerContent = content.toLowerCase();
                if (mentions.some(m => lowerContent.includes(m))) {
                    callChatAI(content);
                }
            }
        } catch (e) {
            console.error('Failed to send message:', e);
            alert('메시지 전송에 실패했습니다.');
        }
    });

    // Send chat on pressing Enter (without Shift)
    const chatInput = document.getElementById('message-input-field');
    chatInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            document.getElementById('send-btn')?.click();
        }
    });

    // [NEW] 이미지 파일 첨부 버튼 이벤트 및 업로드 처리
    const attachBtn = document.getElementById('chat-attach-btn');
    const attachInput = document.getElementById('chat-image-attach-input');

    attachBtn?.addEventListener('click', () => {
        attachInput.click();
    });

    attachInput?.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        if (attachBtn) {
            attachBtn.disabled = true;
            attachBtn.innerText = '⏳';
        }

        try {
            // 1. 유저 정보 검증
            if (!store.currentUser) {
                const { data: { user } } = await store.supabaseClient.auth.getUser();
                if (user) store.currentUser = user;
            }
            if (!store.currentUser) throw new Error('로그인이 필요합니다.');

            const fileExt = file.name.split('.').pop();
            const filePath = `${store.currentUser.id}/${Date.now()}.${fileExt}`;

            // 2. Supabase Storage 'chat-images' 버킷에 업로드
            const { data, error } = await store.supabaseClient.storage
                .from('chat-images')
                .upload(filePath, file, { cacheControl: '3600', upsert: true });

            if (error) throw error;

            // 3. 업로드 성공한 파일의 공개 URL 가져오기
            const { data: urlData } = store.supabaseClient.storage
                .from('chat-images')
                .getPublicUrl(filePath);

            const publicUrl = urlData.publicUrl;

            // 4. 메시지로 이미지 공개 URL 전송 (마크다운 포맷)
            const token = await store.getSessionToken();
            if (!token) return;

            const res = await fetch(`${API_URL}/chat/messages`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    roomId: store.currentRoomId,
                    content: `![image](${publicUrl})`
                })
            });

            const sendData = await res.json();
            if (!sendData.success) throw new Error(sendData.error);

            // 5. 메시지 목록 즉각 갱신
            await loadMessages();
        } catch (err) {
            console.error('Image attachment failed:', err);
            alert('이미지 첨부 중 오류가 발생했습니다: ' + err.message);
        } finally {
            if (attachBtn) {
                attachBtn.disabled = false;
                attachBtn.innerText = '📎';
            }
            attachInput.value = ''; // Input 초기화
        }
    });
    // Call systems setup
    setupCallSystem();

    // [NEW] 모바일 드로워 여닫기 및 자동 닫힘 핫픽스 스크립트 (1촌 목록용)
    const chatDrawerToggle = document.getElementById('mobile-chat-drawer-toggle');
    const chatSidebar = document.querySelector('.chat-sidebar');
    const chatMain = document.querySelector('.chat-main');

    if (chatDrawerToggle && chatSidebar) {
        chatDrawerToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = chatSidebar.classList.contains('active-drawer');
            if (isOpen) {
                chatSidebar.classList.remove('active-drawer');
            } else {
                chatSidebar.classList.add('active-drawer');
            }
        });

        // 에디터 영역 터치/클릭 시 드로워 자동 닫기
        chatMain?.addEventListener('click', () => {
            if (window.innerWidth <= 768) {
                chatSidebar.classList.remove('active-drawer');
            }
        });
    }

    // 모바일에서 1촌 목록 영역을 탭하면 목록이 열리거나 닫히도록 지원 (hover 보완용)
    const friendStatusList = document.getElementById('friend-status-list') || document.getElementById('friend-list');
    if (friendStatusList) {
        friendStatusList.addEventListener('click', function(e) {
            // ⚙️ 버튼이나 개별 친구 클릭 시 방 이동을 방해하지 않기 위해 target 체크
            if (e.target.closest('.friend-settings-btn-icon') || e.target.closest('.friend-item:not(.active)')) {
                return;
            }
            friendStatusList.classList.toggle('expanded');
        });
    }

    // [NEW] 친구 목록 정렬 칩 이벤트 바인딩
    const bindSortChips = (containerId) => {
        const sortContainer = document.getElementById(containerId);
        if (sortContainer) {
            const chips = sortContainer.querySelectorAll('button');
            chips.forEach(chip => {
                chip.addEventListener('click', (e) => {
                    const sortMode = e.target.dataset.sort;
                    if (!sortMode) return;

                    currentFriendSortMode = sortMode;

                    // 활성화된 칩 스타일 적용
                    chips.forEach(c => {
                        c.className = 'px-3 py-1.5 rounded-full text-[11px] md:text-label-sm font-bold transition-all bg-surface-container-high text-on-surface-variant whitespace-nowrap';
                    });
                    e.target.className = 'px-3 py-1.5 rounded-full text-[11px] md:text-label-sm font-bold transition-all bg-secondary-container text-on-secondary-container shadow-sm active-sort-chip whitespace-nowrap';

                    // 다른 쪽 정렬 필터 UI도 동기화
                    const otherContainerId = containerId === 'friend-sort-options' ? 'friend-sort-options-v2' : 'friend-sort-options';
                    const otherContainer = document.getElementById(otherContainerId);
                    if (otherContainer) {
                        const otherChips = otherContainer.querySelectorAll('button');
                        otherChips.forEach(oc => {
                            if (oc.dataset.sort === sortMode) {
                                oc.className = 'px-3 py-1.5 rounded-full text-[11px] md:text-label-sm font-bold transition-all bg-secondary-container text-on-secondary-container shadow-sm active-sort-chip whitespace-nowrap';
                            } else {
                                oc.className = 'px-3 py-1.5 rounded-full text-[11px] md:text-label-sm font-bold transition-all bg-surface-container-high text-on-surface-variant whitespace-nowrap';
                            }
                        });
                    }

                    // 친구 목록 데이터 새로고침
                    checkFriendSos();
                });
            });
        }
    };

    bindSortChips('friend-sort-options');
    bindSortChips('friend-sort-options-v2');

    // [NEW] HTML onclick 전면 제거에 따른 이벤트 위임(Event Delegation)
    document.addEventListener('click', async (e) => {
        const target = e.target.closest('[data-action]');
        if (!target) return;

        const action = target.dataset.action;
        if (action === 'switch-social-tab') {
            e.preventDefault();
            const tab = target.dataset.tab;
            switchSocialTab(tab);
        } else if (action === 'close-chat-detail') {
            e.preventDefault();
            document.getElementById('chat-detail-overlay')?.classList.add('hidden');
        } else if (action === 'open-chat-ai') {
            e.preventDefault();
            e.stopPropagation();
            openChatWithAi();
        } else if (action === 'open-chat-friend') {
            e.preventDefault();
            e.stopPropagation();
            const friendId = target.dataset.id;
            const nickname = target.dataset.nickname;
            window.openChatWithFriend(friendId, nickname);
        } else if (action === 'toggle-friend-settings') {
            e.preventDefault();
            e.stopPropagation();
            const friendId = target.dataset.id;
            window.toggleFriendSettings(friendId);
        } else if (action === 'open-chat-room') {
            e.preventDefault();
            e.stopPropagation();
            const roomId = target.dataset.roomId;
            const title = target.dataset.title;
            const { openChatWindow } = await import('./floatingChat.js?v=5.7.3');
            await openChatWindow(roomId, title);
        }
    });

    // 최외곽 detail overlay 내부의 닫기 버튼은 chat-view 바깥에 있어 글로벌 리스너 위임 바인딩
    document.addEventListener('click', (e) => {
        const closeBtn = e.target.closest('#chat-detail-overlay [data-action="close-chat-detail"]');
        if (closeBtn) {
            e.preventDefault();
            console.log('--- [CHAT] Closing chat detail overlay via global delegation ---');
            document.getElementById('chat-detail-overlay')?.classList.add('hidden');
        }
    });

    // 직접 이벤트 리스너 추가 바인딩 (이벤트 버블링 차단 방지용)
    const directCloseBtn = document.querySelector('#chat-detail-overlay [data-action="close-chat-detail"]');
    if (directCloseBtn) {
        directCloseBtn.addEventListener('click', (e) => {
            e.preventDefault();
            console.log('--- [CHAT] Closing chat detail overlay directly ---');
            document.getElementById('chat-detail-overlay')?.classList.add('hidden');
        });
    }
}

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
            const { openChatWindow } = await import('./floatingChat.js?v=5.7.3');
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
        const isFriendRoom = title.includes('님과의 대화');
        const settingsBtn = document.getElementById('chat-friend-settings-btn');
        if (isFriendRoom) {
            const friendNickname = title.replace('💬 ', '').replace('님과의 대화', '').trim();
            const friend = (store.allFriends || []).find(f => 
                f.nickname === friendNickname || 
                f.nickname.includes(friendNickname)
            );
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

export async function loadContacts() {
    const list = document.getElementById('contact-list');
    if (!list) return;

    list.innerHTML = `
        <div style="padding: 15px; border-bottom: 1px solid #eee; background: #fdfdfd; position: sticky; top: 0; z-index: 10; display: flex; gap: 8px;">
            <input type="text" id="contact-search" placeholder="🔍 친구 이름 또는 이메일로 검색..." 
                style="flex: 1; padding: 12px 15px; border-radius: 10px; border: 2px solid #eee; outline: none; transition: border-color 0.3s; font-size: 0.95rem;">
            <button id="contact-search-btn" class="btn primary" style="padding: 0 20px; border-radius: 10px; border: none; font-weight: 600; background: linear-gradient(135deg, #667eea, #764ba2); color: white; cursor: pointer; transition: all 0.2s;">검색</button>
        </div>
        <div id="contact-items-container" style="max-height: 400px; overflow-y: auto; padding: 10px;">
            <div class="loading">연락처를 불러오고 있습니다...</div>
        </div>
    `;

    try {
        const token = await store.getSessionToken();

        const res = await fetch(`${API_URL}/contacts`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(errData.message || 'Google Contacts API 호출 실패');
        }

        const data = await res.json();
        
        if (data.isMock) {
            throw new Error(data.warning || '구글 인증이 만료되었거나 연동되지 않았습니다.');
        }

        const contacts = data.contacts || [];

        const container = document.getElementById('contact-items-container');

        const renderContacts = (filter = '') => {
            const filtered = contacts.filter(c =>
                (c.name && c.name.toLowerCase().includes(filter.toLowerCase())) ||
                (c.email && c.email.toLowerCase().includes(filter.toLowerCase())) ||
                (c.phone && c.phone.includes(filter))
            );

            if (filtered.length === 0) {
                container.innerHTML = '<div style="text-align:center; padding:30px; color:#999;">검색 결과가 없습니다.</div>';
                return;
            }

            container.innerHTML = filtered.map(c => `
                <div class="contact-item" style="display: flex; justify-content: space-between; align-items: center; padding: 12px; border-bottom: 1px solid #f9f9f9;">
                    <div class="contact-info">
                        <strong style="display: block; font-size: 1rem;">${c.name || '이름 없음'}</strong>
                        <span style="color: #888; font-size: 0.85rem;">${c.email || c.phone || '연락처 정보 없음'}</span>
                    </div>
                    <button class="btn sm primary invite-action-btn" data-email="${c.email || ''}" data-phone="${c.phone || ''}" data-name="${c.name || '친구'}">초대</button>
                </div>
            `).join('');

            container.querySelectorAll('.invite-action-btn').forEach(btn => {
                btn.addEventListener('click', async () => {
                    let email = btn.dataset.email;
                    const name = btn.dataset.name;
                    const phone = btn.dataset.phone;

                    if (!email) {
                        if (phone) {
                            window.openSmsQrInviteModal(name, phone);
                            btn.innerText = '초대됨';
                            return;
                        }

                        const userEmailInput = prompt(`🤫 ${name}님의 초대를 전송할 이메일 주소를 입력해주세요:`);
                        if (!userEmailInput) return;
                        email = userEmailInput.trim();
                        if (!email.includes('@')) {
                            alert('올바른 이메일 형식이 아닙니다.');
                            return;
                        }
                    }

                    btn.disabled = true;
                    btn.innerText = '초대 중...';

                    const sessionToken = await store.getSessionToken();
                    try {
                        const inviteRes = await fetch(`${API_URL}/invite`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${sessionToken}` },
                            body: JSON.stringify({ email, name })
                        });
                        const resData = await inviteRes.json();
                        if (resData.success) {
                            if (resData.emailSent) {
                                alert(`✨ ${name}님에게 초대 메일을 성공적으로 발송했습니다!`);
                            } else {
                                const copyLink = confirm(`💡 이메일 서버 미설정으로, 대신 친구와 직접 공유할 수 있는 초대 링크가 생성되었습니다.\n\n확인 버튼을 누르시면 아래의 초대 링크가 클립보드에 자동으로 복사됩니다:\n\n${resData.shareLink}`);
                                if (copyLink) {
                                    navigator.clipboard.writeText(resData.shareLink).then(() => {
                                        alert('📋 초대 링크가 클립보드에 복사되었습니다! 카카오톡이나 문자로 친구에게 공유해 보세요.');
                                    }).catch(() => {
                                        alert(`링크를 직접 복사해 주세요:\n${resData.shareLink}`);
                                    });
                                }
                            }
                            btn.innerText = '초대됨';
                        } else {
                            alert(`❌ 초대장 발송 실패: ${resData.error || '일시적인 오류가 발생했습니다.'}`);
                            btn.disabled = false;
                            btn.innerText = '초대';
                        }
                    } catch (err) {
                        console.error('Invite API Error:', err);
                        alert('❌ 시스템 연동 오류로 초대장을 발송하지 못했습니다. 설정 정보를 확인해주세요.');
                        btn.disabled = false;
                        btn.innerText = '초대';
                    }
                });
            });
        };

        const searchInput = document.getElementById('contact-search');
        const searchBtn = document.getElementById('contact-search-btn');

        const triggerSearch = () => {
            renderContacts(searchInput.value);
        };

        searchBtn?.addEventListener('click', triggerSearch);
        searchInput?.addEventListener('keyup', (e) => {
            if (e.key === 'Enter') triggerSearch();
        });
        searchInput?.addEventListener('input', (e) => {
            renderContacts(e.target.value);
        });

        if (searchInput) searchInput.focus();
        renderContacts();

        // [NEW HOTFIX] 직접 이메일 입력창의 수동 초대 버튼(#manual-invite-btn) 이벤트 바인딩 신설
        const manualEmailInput = document.getElementById('manual-email-input');
        const manualInviteBtn = document.getElementById('manual-invite-btn');

        if (manualInviteBtn && manualEmailInput) {
            // 중복 클릭 리스너 오버랩 방지를 위한 교체 바인딩
            const newInviteBtn = manualInviteBtn.cloneNode(true);
            manualInviteBtn.parentNode.replaceChild(newInviteBtn, manualInviteBtn);

            newInviteBtn.addEventListener('click', async () => {
                const email = manualEmailInput.value.trim();
                if (!email) {
                    alert('초대할 이메일 주소를 입력해주세요.');
                    return;
                }
                if (!email.includes('@')) {
                    alert('올바른 이메일 형식이 아닙니다.');
                    return;
                }

                newInviteBtn.disabled = true;
                newInviteBtn.innerText = '발송 중...';

                const sessionToken = await store.getSessionToken();
                try {
                    const inviteRes = await fetch(`${API_URL}/invite`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${sessionToken}` },
                        body: JSON.stringify({ email, name: email.split('@')[0] })
                    });
                    const resData = await inviteRes.json();
                    if (resData.success) {
                        if (resData.emailSent) {
                            alert(`✨ ${email}님에게 초대 메일을 성공적으로 발송했습니다!`);
                        } else {
                            const copyLink = confirm(`💡 이메일 서버 미설정으로, 대신 친구와 직접 공유할 수 있는 초대 링크가 생성되었습니다.\n\n확인 버튼을 누르시면 아래의 초대 링크가 클립보드에 자동으로 복사됩니다:\n\n${resData.shareLink}`);
                            if (copyLink) {
                                navigator.clipboard.writeText(resData.shareLink).then(() => {
                                    alert('📋 초대 링크가 클립보드에 복사되었습니다! 카카오톡이나 문자로 친구에게 공유해 보세요.');
                                }).catch(() => {
                                    alert(`링크를 직접 복사해 주세요:\n${resData.shareLink}`);
                                });
                            }
                        }
                        newInviteBtn.innerText = '초대됨';
                        manualEmailInput.value = '';
                    } else {
                        alert(`❌ 초대장 발송 실패: ${resData.error || '이메일 발송 중 오류가 발생했습니다.'}`);
                        newInviteBtn.disabled = false;
                        newInviteBtn.innerText = '초대장 발송';
                    }
                } catch (err) {
                    console.error('Manual Invite API Error:', err);
                    alert('❌ 시스템 연동 오류로 초대장을 발송하지 못했습니다.');
                    newInviteBtn.disabled = false;
                    newInviteBtn.innerText = '초대장 발송';
                }
            });
        }

    } catch (e) {
        console.error('loadContacts Error:', e);
        const container = document.getElementById('contact-items-container');
        if (container) {
            container.innerHTML = `
                <div style="text-align: center; padding: 40px 20px; color: #555;">
                    <div style="font-size: 3rem; margin-bottom: 15px;">🔒</div>
                    <h4 style="font-size: 1.1rem; margin-bottom: 10px; font-weight: 600;">구글 연락처 연동이 필요합니다</h4>
                    <p style="font-size: 0.9rem; color: #777; margin-bottom: 20px; line-height: 1.5;">
                        친구들을 초대하고 함께 감정 일기를 나누려면<br>구글 연락처 접근 권한 승인이 필요합니다.
                    </p>
                    <button id="reauth-google-btn" class="btn primary" style="padding: 12px 24px; border-radius: 30px; border: none; font-weight: 600; background: linear-gradient(135deg, #4285F4, #34A853); color: white; cursor: pointer; transition: transform 0.2s; box-shadow: 0 4px 15px rgba(66, 133, 244, 0.3);">
                        구글 계정 연동 및 승인하기
                    </button>
                </div>
            `;
            
            document.getElementById('reauth-google-btn')?.addEventListener('click', async () => {
                await store.supabaseClient.auth.linkIdentity({
                    provider: 'google',
                    options: {
                        redirectTo: window.location.origin,
                        queryParams: {
                            access_type: 'offline',
                            prompt: 'consent'
                        },
                        scopes: 'https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/contacts.readonly'
                    }
                });
            });
        }
    }
}

export async function checkFriendSos() {
    try {
        const token = await store.getSessionToken();
        if (!token) return;

        const res = await fetch(`${API_URL}/friends/sos`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();

        // [NEW] Save friends list globally for instant lookups in room switches
        let friends = data.allFriends || [];

        // 친구 목록 정렬 적용
        if (currentFriendSortMode === 'name') {
            friends.sort((a, b) => (a.nickname || '').localeCompare(b.nickname || '', 'ko'));
        } else if (currentFriendSortMode === 'degree') {
            // 1촌(진짜 친구): Supabase 가입자 -> 2촌(데모 친구): mock-
            friends.sort((a, b) => {
                const aIsMock = (a.id || '').startsWith('mock-');
                const bIsMock = (b.id || '').startsWith('mock-');
                if (aIsMock && !bIsMock) return 1;
                if (!aIsMock && bIsMock) return -1;
                return (a.nickname || '').localeCompare(b.nickname || '', 'ko');
            });
        } else if (currentFriendSortMode === 'sos') {
            friends.sort((a, b) => {
                const aIsSos = data.sosList?.some(s => s.id === a.id);
                const bIsSos = data.sosList?.some(s => s.id === b.id);
                if (aIsSos && !bIsSos) return -1;
                if (!aIsSos && bIsSos) return 1;
            if (a.is_online && !b.is_online) return -1;
            if (!a.is_online && b.is_online) return 1;
            return (a.nickname || '').localeCompare(b.nickname || '', 'ko');
        });
    }

    store.allFriends = friends;

    // [NEW] Update thermometer dynamically if currently chatting with this friend
    try {
        const titleEl = document.getElementById('chat-room-title-text');
        const activeTitle = titleEl ? titleEl.innerText : '';
        if (activeTitle && activeTitle.includes('님과의 대화')) {
            const friendNickname = activeTitle.replace('💬 ', '').replace('님과의 대화', '').trim();
            const friend = friends.find(f => 
                f.nickname === friendNickname || 
                f.nickname.includes(friendNickname)
            );
            if (friend) {
                updateEmotionThermometer(friendNickname, friend.current_emotion);
            }
        }
    } catch (err) {
        console.error('Failed to auto-update thermometer in heartbeat:', err);
    }

    const list = document.getElementById('friend-status-list') || document.getElementById('friend-list');
    if (list) {
        const isAiActive = store.currentRoomId && !friends.some(f => f.id === store.currentRoomId);
        const aiAvatarHtml = store.currentAvatarUrl
            ? `<img class="friend-avatar" src="${store.currentAvatarUrl}" style="width:34px; height:34px; border-radius:50%; object-fit:cover; flex-shrink:0;">`
            : `<div class="friend-avatar" style="background: var(--accent-color); color: white; display:flex; align-items:center; justify-content:center; flex-shrink:0; width:34px; height:34px; border-radius:50%; font-size: 0.95rem;">✨</div>`;

        const aiFriendHtml = `
        <div class="page-item friend-item ai-friend ${isAiActive ? 'active' : ''}" data-action="open-chat-ai" style="display:flex; align-items:center; gap:12px;">
            ${aiAvatarHtml}
            <div style="flex:1; min-width:0; display:flex; flex-direction:column; gap:2px;">
                <div class="page-item-title" style="margin:0; font-weight:700; font-size:0.95rem; color:#323130; display:flex; align-items:center; gap:8px;">
                    <span>✨ ${store.currentAvatarName || '원이'} 비서</span>
                </div>
                <div class="page-item-meta" style="display:flex; justify-content:space-between; align-items:center; font-size:0.75rem; color:#605e5c;">
                    <span class="emotion-tag" style="background:#f0f4ff; color:#667eea; border:1px solid #e1e4ff; padding:2px 6px; border-radius:4px; font-size:0.72rem;">실시간 상담 대기</span>
                </div>
            </div>
        </div>
        `;

        let htmlContent = aiFriendHtml + friends.map(f => {
            const isSos = data.sosList?.some(s => s.id === f.id);
            const onlineDot = f.is_online
                ? `<span style="display:inline-block; width:8px; height:8px; background:#2ed573; border-radius:50%; margin-right:4px; box-shadow: 0 0 8px #2ed573;"></span>`
                : `<span style="display:inline-block; width:8px; height:8px; background:#a4b0be; border-radius:50%; margin-right:4px;"></span>`;

            return `
            <div class="page-item friend-item ${isSos ? 'sos' : ''} ${store.currentRoomId === f.id ? 'active' : ''}" data-action="open-chat-friend" data-id="${f.id}" data-nickname="${f.nickname}" style="display:flex; align-items:center; gap:12px;">
                <div class="friend-avatar" style="position:relative; background:#888; color:white; font-weight:600; display:flex; align-items:center; justify-content:center; width:34px; height:34px; border-radius:50%; flex-shrink:0;">
                    ${f.nickname?.[0] || '👤'}
                </div>
                <div style="flex:1; min-width:0; display:flex; flex-direction:column; gap:2px;">
                    <div class="page-item-title" style="margin:0; font-weight:700; font-size:0.95rem; color:#323130; display:flex; align-items:center; justify-content:space-between;">
                        <span style="display:flex; align-items:center; gap:6px;">
                            <span>${f.nickname || '익명'}</span>
                            ${onlineDot}
                        </span>
                        <button data-action="toggle-friend-settings" data-id="${f.id}" class="friend-settings-btn-icon" style="background:none; border:none; cursor:pointer; font-size:0.95rem; padding:0; display:flex; align-items:center; justify-content:center; color:#888; transition:color 0.2s;" title="1촌 설정">⚙️</button>
                    </div>
                    <div class="page-item-meta" style="display:flex; justify-content:space-between; align-items:center; font-size:0.75rem; color:#605e5c;">
                        <span class="emotion-tag" style="padding:2px 6px; border-radius:4px; font-size:0.72rem; background:rgba(0,0,0,0.05); color:#444;">${f.current_emotion || '평온'}</span>
                        ${isSos ? '<span class="sos-badge" style="background:#ff4757; color:white; font-size:10px; padding:2px 6px; border-radius:4px; animation: pulse-border 1.5s infinite; font-weight:700;">🚨 위로 필요</span>' : ''}
                    </div>
                </div>
            </div>
            `;
        }).join('');

        list.innerHTML = htmlContent;
    }

    // [NEW] Chats Tab (chat-room-list) Dynamic Rendering
    const chatRoomList = document.getElementById('chat-room-list');
    if (chatRoomList) {
        const isAiActive = store.currentRoomId && !friends.some(f => f.id === store.currentRoomId);
        const aiAvatarUrl = store.currentAvatarUrl || './angel_mascot.png';
        const aiName = store.currentAvatarName || '원이';

        // Render AI chat room item
        let roomsHtml = `
        <div data-action="open-chat-ai" class="bg-white/40 backdrop-blur-sm p-4 rounded-xl flex items-center gap-4 hover:bg-white/60 cursor-pointer transition-all border ${isAiActive ? 'border-primary bg-white/70' : 'border-transparent'} hover:border-primary-container/30">
            <img class="w-12 h-12 rounded-full object-cover" src="${aiAvatarUrl}" alt="AI"/>
            <div class="flex-1 min-w-0">
                <div class="flex justify-between items-baseline">
                    <h3 class="font-bold truncate text-primary">✨ ${aiName}와 대화</h3>
                    <span class="text-[10px] text-on-surface-variant">실시간</span>
                </div>
                <p class="text-[12px] text-on-surface-variant truncate">무엇이든 이야기해 주세요. 든든한 동반자가 되어 드릴게요.</p>
            </div>
        </div>
        `;

        // Render other friend chat rooms
        roomsHtml += friends.map(f => {
            const isSos = data.sosList?.some(s => s.id === f.id);
            const isRoomActive = store.currentRoomId === f.id;
            const onlineDot = f.is_online
                ? `<span style="display:inline-block; width:6px; height:6px; background:#2ed573; border-radius:50%; margin-left:4px; box-shadow: 0 0 6px #2ed573;"></span>`
                : `<span style="display:inline-block; width:6px; height:6px; background:#a4b0be; border-radius:50%; margin-left:4px;"></span>`;

            return `
            <div data-action="open-chat-friend" data-id="${f.id}" data-nickname="${f.nickname}" class="bg-white/40 backdrop-blur-sm p-4 rounded-xl flex items-center gap-4 hover:bg-white/60 cursor-pointer transition-all border ${isRoomActive ? 'border-primary bg-white/70' : 'border-transparent'} hover:border-primary-container/30">
                <div style="background:#8b8273; color:white; font-weight:bold; display:flex; align-items:center; justify-content:center; width:44px; height:44px; border-radius:50%; flex-shrink:0; font-size:1.1rem; border:2px solid #5d574d;">
                    ${f.nickname?.[0] || '👤'}
                </div>
                <div class="flex-1 min-w-0">
                    <div class="flex justify-between items-baseline">
                        <h3 class="font-bold truncate text-on-surface" style="display:flex; align-items:center; gap:4px;">
                            <span>${f.nickname || '익명'}</span>
                            ${onlineDot}
                        </h3>
                        <span class="text-[10px] text-on-surface-variant">${f.my_stealth ? '🤫 스텔스' : '1촌'}</span>
                    </div>
                    <p class="text-[12px] text-on-surface-variant truncate" style="display:flex; justify-content:space-between; align-items:center;">
                        <span>상태: ${f.current_emotion || '평온'}</span>
                        ${isSos ? '<span style="background:#ff4757; color:white; font-size:8px; padding:1px 4px; border-radius:3px; font-weight:bold;">위로 필요</span>' : ''}
                    </p>
                </div>
            </div>
            `;
        }).join('');

        chatRoomList.innerHTML = roomsHtml;
    }
    } catch (err) {
        console.error('Failed to check friend SOS status:', err);
    }
}

// 1촌 소셜 설정 및 전역 제어 함수 바인딩
window.toggleFriendSettings = function(friendId) {
    const friend = (store.allFriends || []).find(f => f.id === friendId);
    if (friend) {
        window.openFriendSettingsModal(friend);
    }
};

window.openFriendSettingsModal = function(friend) {
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

window.openInviteModal = function() {
    const modal = document.getElementById('invite-modal');
    if (modal) modal.style.display = 'flex';
    if (window.innerWidth <= 768) {
        document.querySelector('.chat-sidebar')?.classList.remove('active-drawer');
    }
    loadContacts();
};



window.toggleFriendStealth = async function(friendId, currentStealth) {
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

window.toggleFriendShare = async function(friendId, currentShare) {
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

window.deleteFriend = async function(friendId) {
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

window.blockFriend = async function(friendId) {
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

window.openChatWithFriend = async function(friendId, friendNickname) {
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
            const { openChatWindow } = await import('./floatingChat.js?v=5.7.3');
            await openChatWindow(data.room.id, `💬 ${friendNickname}님과의 대화`);
        } else {
            console.error('Room registration failed:', data.error);
            alert('채팅방 연결에 실패했습니다.');
        }
    } catch (e) {
        console.error('openChatWithFriend Error:', e);
    }
};

export function setupCallSystem() {
    const voiceBtn = document.getElementById('voice-call-btn');
    const videoBtn = document.getElementById('video-call-btn');
    const endBtn = document.getElementById('end-call-btn');
    const muteBtn = document.getElementById('mute-btn');
    const camBtn = document.getElementById('camera-toggle-btn');

    voiceBtn?.addEventListener('click', () => startCall('voice'));
    videoBtn?.addEventListener('click', () => startCall('video'));
    endBtn?.addEventListener('click', endCall);

    muteBtn?.addEventListener('click', () => {
        if (localStream) {
            const audioTrack = localStream.getAudioTracks()[0];
            audioTrack.enabled = !audioTrack.enabled;
            muteBtn.innerText = audioTrack.enabled ? '🎙️' : '🔇';
            muteBtn.style.background = audioTrack.enabled ? 'rgba(255,255,255,0.15)' : '#ff4757';
        }
    });

    camBtn?.addEventListener('click', () => {
        if (localStream) {
            const videoTrack = localStream.getVideoTracks()[0];
            if (videoTrack) {
                videoTrack.enabled = !videoTrack.enabled;
                camBtn.innerText = videoTrack.enabled ? '📷' : '🚫';
                camBtn.style.background = videoTrack.enabled ? 'rgba(255,255,255,0.15)' : '#ff4757';
            }
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
        localStream = await navigator.mediaDevices.getUserMedia({
            video: mode === 'video',
            audio: true
        });

        isCallActive = true;
        if (overlay) overlay.classList.remove('hidden');
        if (videoPreview) videoPreview.srcObject = localStream;

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
        isCallActive = false;
        if (overlay) overlay.classList.add('hidden');
        alert('카메라 또는 마이크 하드웨어 권한 획득에 실패하여, 일반 음성/정적 비서 대화방 모드로 안전하게 전환합니다.');
        endCall();
    }
}

export function startCallSpeechRecognition() {
    if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) return;
    
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    callRecognition = new SpeechRec();
    callRecognition.continuous = false;
    callRecognition.interimResults = false;
    callRecognition.lang = 'ko-KR';

    callRecognition.onend = () => {
        if (isCallActive) {
            try {
                callRecognition.start();
            } catch (e) {}
        }
    };

    callRecognition.onresult = async (event) => {
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
        callRecognition.start();
    } catch(e) {}
}

export function endCall() {
    console.log('--- [CALL] Ending call ---');
    isCallActive = false;
    if (callRecognition) {
        callRecognition.onend = null;
        callRecognition.stop();
        callRecognition = null;
    }
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    document.getElementById('call-overlay')?.classList.add('hidden');
    window.speechSynthesis.cancel();
}

export function speakCallResponse(text) {
    const bubble = document.getElementById('ai-speech-bubble');
    if (bubble) {
        bubble.innerText = text;
        bubble.classList.remove('hidden');
    }

    const msg = new SpeechSynthesisUtterance(text);
    msg.lang = 'ko-KR';

    const voices = window.speechSynthesis.getVoices();
    const koVoices = voices.filter(v => v.lang.startsWith('ko'));
    const selectedVoice = koVoices.find(v => v.name.includes('Sun-Hi') || v.name.includes('Heami') || v.name.includes('Google') || v.name.includes('Female')) || koVoices[0];

    if (selectedVoice) msg.voice = selectedVoice;
    msg.pitch = 1.0;
    msg.rate = 1.0;

    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(msg);
}

export async function startVideoAnalysisLoop() {
    const video = document.getElementById('user-video-preview');
    const canvas = document.createElement('canvas');

    while (isCallActive) {
        if (localStream && localStream.getVideoTracks()[0] && localStream.getVideoTracks()[0].enabled && video) {
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
export function updateEmotionThermometer(friendNickname, emotionStr) {
    const banner = document.getElementById('friend-emotion-banner');
    const nameEl = document.getElementById('friend-banner-name');
    const tempEl = document.getElementById('friend-banner-temp');
    const adviceEl = document.getElementById('friend-banner-advice');
    const avatarEl = document.getElementById('friend-banner-avatar');
    const fillEl = document.getElementById('friend-banner-fill');
    const headerEl = document.querySelector('.chat-main-header');

    if (!banner) return;

    if (!friendNickname || !emotionStr) {
        banner.style.display = 'none';
        const spiritWhispersEl = document.getElementById('ghibli-spirit-whispers');
        if (spiritWhispersEl) spiritWhispersEl.style.display = 'none';
        if (headerEl) {
            headerEl.className = 'chat-main-header glow-muted';
        }
        return;
    }

    // 1. 감성 기온 및 피드백/조언 취득
    const metrics = getEmotionMetrics(emotionStr);

    // 2. 텍스트 설정
    if (nameEl) nameEl.innerText = friendNickname;
    if (tempEl) {
        tempEl.innerText = `${metrics.temp} (${metrics.statusText})`;
        tempEl.style.color = metrics.color;
    }
    if (adviceEl) adviceEl.innerText = metrics.advice;
    if (avatarEl) avatarEl.innerText = metrics.emoji;
    
    // 3. 온도계 게이지 바 채우기 및 색상 변경 (부드러운 애니메이션)
    if (fillEl) {
        if (fillEl.classList.contains('gauge-needle')) {
            fillEl.style.left = metrics.fillPercent;
            fillEl.style.background = ''; // reset gradient bg on the needle
        } else {
            fillEl.style.width = metrics.fillPercent;
            fillEl.style.background = `linear-gradient(90deg, ${metrics.color}, var(--secondary-color))`;
        }
    }

    // 3.1 Ghibli Spirit Whispers (AI Insight Box) 텍스트 동적 업데이트
    const spiritWhispersEl = document.getElementById('ghibli-spirit-whispers');
    const whispersTextEl = document.getElementById('spirit-whispers-text');
    if (spiritWhispersEl && whispersTextEl) {
        whispersTextEl.innerText = metrics.advice.replace('💡 비서 조언: ', '');
        spiritWhispersEl.style.display = 'flex';
    }

    // 4. 감성 톤에 따른 대화방 헤더의 네온 글로우 색상 실시간 반영
    if (headerEl) {
        headerEl.className = 'chat-main-header'; // reset
        if (metrics.color === '#0984e3') {
            headerEl.classList.add('glow-blue');
        } else if (metrics.color === '#ff4757') {
            headerEl.classList.add('glow-red');
        } else if (metrics.color === '#2ed573') {
            headerEl.classList.add('glow-green');
        } else if (metrics.color === '#ffa502') {
            headerEl.classList.add('glow-orange');
        } else {
            headerEl.classList.add('glow-muted');
        }
    }

    // 5. 배너 표시
    banner.style.display = 'flex';
}

function getEmotionMetrics(emotionStr) {
    const defaultMetrics = {
        temp: "36.5°C",
        statusText: "평온",
        emoji: "😊",
        fillPercent: "50%",
        color: "#2ed573", // Premium Green/Teal
        advice: "💡 비서 조언: 상대방이 차분하고 평화로운 평온 기온을 유지하고 있습니다. 편안하게 안부를 묻는 일상 대화가 좋습니다."
    };

    const privateMetrics = {
        temp: "비공개",
        statusText: "비공개",
        emoji: "🤫",
        fillPercent: "0%",
        color: "#a4b0be", // Cool Muted Grey
        advice: "💡 비서 조언: 상대방이 감정 공유를 비활성화했거나 스텔스 모드 상태입니다. 자연스럽게 인사를 건네보세요."
    };

    // null 또는 undefined 입력 방어
    if (emotionStr === null || emotionStr === undefined) {
        return defaultMetrics;
    }

    // 문자열 타입 변환 및 특수타입(객체, 배열 등) 문자열화 방어
    let targetStr = ""; // 안전한 문자열 가공을 위해 초기값을 빈 문자열로 명확히 표시
    if (typeof emotionStr !== 'string') {
        try {
            targetStr = String(emotionStr).trim();
        } catch (e) {
            return defaultMetrics;
        }
    } else {
        targetStr = emotionStr.trim();
    }

    // 빈 문자열 방어
    if (targetStr.length === 0) {
        return defaultMetrics;
    }

    // 비공개 감정 명시적 처리
    if (targetStr === '비공개 감정' || targetStr === '비공개') {
        return privateMetrics;
    }

    const lower = targetStr.toLowerCase();
    
    // [우울 / 슬픔 / 절망 / 무기력 / 힘듦 / 고통] -> 낮은 기온 (Blue Theme)
    if (
        lower.includes('우울') || 
        lower.includes('슬픔') || 
        lower.includes('절망') || 
        lower.includes('무기력') || 
        lower.includes('힘들') || 
        lower.includes('고통') || 
        lower.includes('슬픈') || 
        lower.includes('😭') || 
        lower.includes('😔') || 
        lower.includes('😢')
    ) {
        return {
            temp: "18.5°C",
            statusText: "우울/슬픔",
            emoji: "😭",
            fillPercent: "18%",
            color: "#0984e3", // Elegant Cobalt Blue
            advice: targetStr.length > 5 && !targetStr.startsWith('오늘 하루도') && !targetStr.startsWith('조금 슬픔')
                ? `💡 비서 조언: 상대방의 현재 상태는 "${targetStr}"입니다. 따뜻한 위로와 경청으로 그 마음을 헤아려 주세요.`
                : "💡 비서 조언: 상대방이 심리적 우울감이나 지침을 겪고 있습니다. 가벼운 위로와 따뜻한 마음을 나누어주세요."
        };
    }
    
    // [분노 / 화남 / 스트레스 / 짜증 / 예민] -> 높은 기온 (Red Theme)
    if (
        lower.includes('화') || 
        lower.includes('분노') || 
        lower.includes('스트레스') || 
        lower.includes('짜증') || 
        lower.includes('예민') ||
        lower.includes('😡') || 
        lower.includes('🤬')
    ) {
        return {
            temp: "39.5°C",
            statusText: "스트레스/화남",
            emoji: "😡",
            fillPercent: "85%",
            color: "#ff4757", // Premium Soft Crimson Red
            advice: targetStr.length > 5 && !targetStr.startsWith('오늘 하루도') && !targetStr.startsWith('조금 슬픔')
                ? `💡 비서 조언: 상대방의 현재 상태는 "${targetStr}"입니다. 불필요한 마찰을 피하고 공감의 태도를 추천합니다.`
                : "💡 비서 조언: 상대방이 다소 예민하거나 스트레스를 받은 상태입니다. 경청하고 공감해 주는 부드러운 대화가 필요합니다."
        };
    }
    
    // [기쁨 / 행복 / 보람 / 설렘 / 신남 / 즐거움] -> 따뜻하고 포근한 기온 (Orange/Gold Theme)
    if (
        lower.includes('기쁨') || 
        lower.includes('행복') || 
        lower.includes('보람') || 
        lower.includes('설렘') || 
        lower.includes('🥰') || 
        lower.includes('🥳') || 
        lower.includes('신남') || 
        lower.includes('즐겁')
    ) {
        return {
            temp: "37.2°C",
            statusText: "행복/설렘",
            emoji: "🥰",
            fillPercent: "72%",
            color: "#ffa502", // Premium warm Gold/Orange
            advice: targetStr.length > 5 && !targetStr.startsWith('오늘 하루도') && !targetStr.startsWith('보람찬 하루를')
                ? `💡 비서 조언: 상대방의 현재 상태는 "${targetStr}"입니다. 그 긍정적인 기운을 담아 기쁨을 함께 나눠보세요!`
                : "💡 비서 조언: 상대방이 매우 긍정적이고 활기찬 감정을 느끼고 있습니다. 함께 기쁨을 공유하고 축하해 주세요!"
        };
    }

    // 기본 매칭이 안 되는 기타 임의의 상태 텍스트 처리
    if (targetStr.length > 5 && !targetStr.startsWith('오늘 하루도') && !targetStr.startsWith('보람찬 하루를') && !targetStr.startsWith('조금 슬픔')) {
        return {
            temp: "36.5°C",
            statusText: "평온",
            emoji: "😊",
            fillPercent: "50%",
            color: "#2ed573",
            advice: `💡 비서 조언: 상대방의 현재 상태는 "${targetStr}"입니다. 이를 배려한 다정한 소통을 추천합니다.`
        };
    }

    return defaultMetrics;
}

// [NEW] 내 프로필 이미지 변경 및 Supabase Storage 업로드 연동
export async function setupUserProfileInChat() {
    const avatarImg = document.getElementById('chat-my-avatar');
    const fallbackDiv = document.getElementById('chat-my-avatar-fallback');
    const fileInput = document.getElementById('chat-avatar-upload-input');
    const changeBtn = document.getElementById('chat-change-photo-btn');

    if (!avatarImg || !fileInput) return;

    // 1. 유저 정보 획득
    if (!store.currentUser) {
        const { data: { user } } = await store.supabaseClient.auth.getUser();
        if (user) store.currentUser = user;
    }
    if (!store.currentUser) return;

    // 2. 프로필 정보 조회 및 렌더링
    async function loadUserProfilePhoto() {
        try {
            // Supabase Auth 세션의 최신 정보 리프레시
            const { data: { user } } = await store.supabaseClient.auth.getUser();
            if (user) store.currentUser = user;

            const myAvatarUrl = store.currentUser?.user_metadata?.avatar_url;

            if (myAvatarUrl) {
                // 브라우저 이미지 캐시 강제 무효화(Buster)를 적용하여 즉시 갱신
                avatarImg.src = `${myAvatarUrl}?t=${Date.now()}`;
                avatarImg.style.display = 'block';
                fallbackDiv.style.display = 'none';
            } else {
                avatarImg.style.display = 'none';
                fallbackDiv.style.display = 'flex';
            }
        } catch (err) {
            console.error('Failed to load user profile photo:', err);
        }
    }

    await loadUserProfilePhoto();

    // 3. 파일 선택기 트리거
    const triggerUpload = () => fileInput.click();
    avatarImg.addEventListener('click', triggerUpload);
    fallbackDiv.addEventListener('click', triggerUpload);
    changeBtn?.addEventListener('click', triggerUpload);

    // 4. 업로드, Auth 메타데이터 갱신 및 DB 동기화
    fileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        // 업로드 중 상태 UI 업데이트
        if (changeBtn) {
            changeBtn.disabled = true;
            changeBtn.innerText = '업로드 중...';
        }

        try {
            // [요청 1] 파일 경로를 사용자의 id를 사용해서 고유하게 만듦 (예: '[user_id]/avatar.png')
            const filePath = `${store.currentUser.id}/avatar.png`;

            // Supabase Storage 'avatars' 버킷에 업로드 (덮어쓰기 허용 cacheControl: 0, upsert: true)
            const { data, error } = await store.supabaseClient.storage
                .from('avatars')
                .upload(filePath, file, { cacheControl: '0', upsert: true });

            if (error) throw error;

            // [요청 2] 업로드 성공한 파일의 공개 URL 가져오기
            const { data: urlData } = store.supabaseClient.storage
                .from('avatars')
                .getPublicUrl(filePath);

            const publicUrl = urlData.publicUrl;

            // [요청 3] 가져온 URL을 supabase Auth의 사용자 메타데이터에 저장
            const { data: authData, error: authError } = await store.supabaseClient.auth.updateUser({
                data: { avatar_url: publicUrl }
            });

            if (authError) throw authError;

            // 추가적으로 profiles 테이블 데이터베이스도 동기화 (1촌 공유용)
            await store.supabaseClient
                .from('profiles')
                .update({ avatar_url: publicUrl })
                .eq('id', store.currentUser.id);

            alert('✨ 프로필 사진이 성공적으로 변경되었습니다!');
            
            // [요청 4] 즉시 화면 상단의 프로필 이미지도 새로운 사진으로 갱신
            await loadUserProfilePhoto();

            // [요청 5] 채팅에서 사용자별 이미지도 업데이트 되면 즉시 새로운 사진이 나타나게 메시지 다시 로드
            await loadMessages();
        } catch (err) {
            console.error('Profile photo upload error:', err);
            alert('프로필 사진 변경 중 오류가 발생했습니다: ' + err.message);
        } finally {
            if (changeBtn) {
                changeBtn.disabled = false;
                changeBtn.innerText = '사진 변경';
            }
            fileInput.value = ''; // Input 초기화
        }
    });
}

window.openSmsQrInviteModal = async function(name, phone) {
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

export function toggleInviteOverlay(force) {
    const modal = document.getElementById('invite-modal');
    const backdrop = document.getElementById('overlay-backdrop');
    const panel = document.getElementById('overlay-panel');
    if (!modal) return;

    const shouldOpen = (typeof force === 'boolean')
        ? force
        : modal.classList.contains('hidden');

    if (shouldOpen) {
        modal.classList.remove('hidden');
        // Trigger reflow to let CSS transition happen
        modal.offsetHeight;
        modal.classList.remove('pointer-events-none');
        if (backdrop) {
            backdrop.classList.remove('opacity-0', 'pointer-events-none');
            backdrop.classList.add('opacity-100', 'pointer-events-auto');
        }
        if (panel) panel.classList.remove('translate-y-full');
    } else {
        if (backdrop) {
            backdrop.classList.add('opacity-0', 'pointer-events-none');
            backdrop.classList.remove('opacity-100', 'pointer-events-auto');
        }
        if (panel) panel.classList.add('translate-y-full');
        setTimeout(() => {
            modal.classList.add('pointer-events-none');
            modal.classList.add('hidden');
        }, 300);
    }
}

export function switchSocialTab(tab) {
    const tabPeople = document.getElementById('tab-people');
    const tabChats = document.getElementById('tab-chats');
    const peopleView = document.getElementById('people-view');
    const chatsView = document.getElementById('chats-view');

    if(tab === 'people') {
        tabPeople?.classList.add('border-primary', 'text-primary', 'font-bold');
        tabPeople?.classList.remove('border-transparent', 'text-on-surface-variant');
        const icon1 = tabPeople?.querySelector('.material-symbols-outlined');
        if(icon1) icon1.style.fontVariationSettings = "'FILL' 1";
        
        tabChats?.classList.remove('border-primary', 'text-primary', 'font-bold');
        tabChats?.classList.add('border-transparent', 'text-on-surface-variant');
        const icon2 = tabChats?.querySelector('.material-symbols-outlined');
        if(icon2) icon2.style.fontVariationSettings = "'FILL' 0";

        peopleView?.classList.remove('hidden');
        chatsView?.classList.add('hidden');
    } else {
        tabChats?.classList.add('border-primary', 'text-primary', 'font-bold');
        tabChats?.classList.remove('border-transparent', 'text-on-surface-variant');
        const icon1 = tabChats?.querySelector('.material-symbols-outlined');
        if(icon1) icon1.style.fontVariationSettings = "'FILL' 1";
        
        tabPeople?.classList.remove('border-primary', 'text-primary', 'font-bold');
        tabPeople?.classList.add('border-transparent', 'text-on-surface-variant');
        const icon2 = tabPeople?.querySelector('.material-symbols-outlined');
        if(icon2) icon2.style.fontVariationSettings = "'FILL' 0";

        chatsView?.classList.remove('hidden');
        peopleView?.classList.add('hidden');
    }
}

// Global namespace binding for popup windows
window.FeelingJournalChat = window.FeelingJournalChat || {};
window.FeelingJournalChat.startCall = startCall;


