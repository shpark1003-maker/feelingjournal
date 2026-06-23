import { store, API_URL } from './state.js?v=5.7.4';

const MAX_FLOATING_CHAT_WINDOWS = 4;
const WINDOW_WIDTH = 360;
const WINDOW_HEIGHT = 480;

// 메시지 중복 렌더링 방지용 맵 (roomId => Set of messageIds)
const renderedMessageIds = {};

export function isMobileChatMode() {
    const isMobileDevice = /Mobi|Android|iPhone|iPad|iPod|Windows Phone/i.test(navigator.userAgent);
    return isMobileDevice && window.matchMedia('(max-width: 768px)').matches;
}

// 최대 z-index 가져오기
function getNextZIndex() {
    let maxZ = 100;
    Object.values(store.activeChatWindows).forEach(w => {
        if (w.zIndex > maxZ) maxZ = w.zIndex;
    });
    return maxZ + 1;
}

// 모바일 resize 처리 리스너
export function handleChatModeChange() {
    if (isMobileChatMode()) {
        // 모바일 해상도 진입 시 모든 플로팅 창을 정리(닫기)하고 단일 화면으로 전환
        const activeIds = Object.keys(store.activeChatWindows);
        if (activeIds.length > 0) {
            console.log('--- [MOBILE FALLBACK] Transitioning to mobile. Cleaning up floating windows. ---');
            activeIds.forEach(roomId => {
                closeChatWindow(roomId);
            });
            // 모바일 탭으로 전환
            const chatTab = document.getElementById('nav-chat-tab');
            if (chatTab) chatTab.click();
        }
    }
}

// 초기 로드 시 리사이즈 이벤트 바인딩
window.addEventListener('resize', handleChatModeChange);

// 플로팅 채팅방 열기
export async function openChatWindow(roomId, title) {
    if (!roomId) return;

    // 0. 유저 세션 정보 복구 가드
    if (!store.currentUser) {
        try {
            const { data: { user } } = await store.supabaseClient.auth.getUser();
            if (user) store.currentUser = user;
        } catch (e) {
            console.warn('Failed to retrieve user session on floating open:', e);
        }
    }

    // 1. 모바일 처리
    if (isMobileChatMode()) {
        // 모바일인 경우 플로팅이 아닌 전체화면으로 대화방 전환
        console.log('--- [CHAT] Mobile Mode: Redirecting to fullscreen chat room ---');
        const chatTab = document.getElementById('nav-chat-tab');
        if (chatTab) chatTab.click();
        
        // 전역 window 헬퍼가 있을 경우 이를 통해 단일 뷰 스위치
        if (window.openChatWithFriend) {
            const titleEl = document.getElementById('chat-room-title-text');
            if (titleEl) titleEl.innerText = title;

            // Switch room to load messages and bind realtime events
            import('./chat.js?v=5.7.4').then(async (chatMod) => {
                await chatMod.switchChatRoom(roomId, title);
            }).catch(err => {
                console.error('Failed to import chat.js for mobile switchChatRoom:', err);
            });

            // index.html의 overlay 노출
            const chatOverlay = document.getElementById('chat-detail-overlay');
            if (chatOverlay) chatOverlay.classList.remove('hidden');
        }
        return;
    }

    // 2. PC 데스크톱 처리: 카카오톡 PC 프로그램 스타일로 브라우저 탭 밖의 실제 팝업 창을 생성
    console.log('--- [CHAT] Desktop Mode: Opening chat in a new standalone popup window ---');
    const width = 380;
    const height = 540;
    const left = (window.screen.width - width) / 2;
    const top = (window.screen.height - height) / 2;
    
    const popUrl = `/chat-pop.html?roomId=${encodeURIComponent(roomId)}&title=${encodeURIComponent(title)}`;
    const winName = `chat_pop_${roomId.replace(/[^a-zA-Z0-9]/g, '_')}`;
    
    const features = `width=${width},height=${height},left=${left},top=${top},menubar=no,status=no,toolbar=no,resizable=yes`;
    const popWin = window.open(popUrl, winName, features);
    if (popWin) {
        popWin.focus();
    } else {
        alert('팝업 차단이 활성화되어 있을 수 있습니다. 브라우저 주소창 우측에서 이 사이트의 팝업 허용을 해주세요.');
    }
    return;

    // 2. 중복 열기 방지
    if (store.activeChatWindows[roomId]) {
        focusChatWindow(roomId);
        return;
    }

    // 3. 최대 창 개수 제한 (데스크톱 4개)
    const activeCount = Object.keys(store.activeChatWindows).length;
    if (activeCount >= MAX_FLOATING_CHAT_WINDOWS) {
        // 가장 오래된 최소화 창을 자동으로 찾아 닫음으로써 편의성 제공
        const minimizedRoomId = Object.keys(store.activeChatWindows).find(id => store.activeChatWindows[id].isMinimized);
        if (minimizedRoomId) {
            console.log(`--- [CHAT] Auto-closing minimized window ${minimizedRoomId} to free slot ---`);
            closeChatWindow(minimizedRoomId);
        } else {
            alert(`최대 ${MAX_FLOATING_CHAT_WINDOWS}개의 채팅창만 동시에 열 수 있습니다. 기존 창을 닫아주세요.`);
            return;
        }
    }

    // 4. 자동 배치 (Cascading) 계산 및 Clamp
    const offset = Object.keys(store.activeChatWindows).length * 28;
    let x = window.innerWidth - WINDOW_WIDTH - 20 - offset;
    let y = window.innerHeight - WINDOW_HEIGHT - 60 - offset;

    // Viewport clamp
    x = Math.max(10, Math.min(x, window.innerWidth - WINDOW_WIDTH - 10));
    y = Math.max(60, Math.min(y, window.innerHeight - WINDOW_HEIGHT - 10));

    const zIndex = getNextZIndex();

    // 5. 상태 기록
    store.activeChatWindows[roomId] = {
        title,
        isMinimized: false,
        x,
        y,
        zIndex
    };

    // 6. DOM 생성
    createWindowDOM(roomId, title, x, y, zIndex);

    // 7. 메시지 초기 로딩 및 Realtime 바인딩
    renderedMessageIds[roomId] = new Set();
    await loadWindowMessages(roomId);
    subscribeRoomRealtime(roomId);
}

// 윈도우 DOM 동적 빌드
function createWindowDOM(roomId, title, x, y, zIndex) {
    const container = document.getElementById('v2-floating-chat-container');
    if (!container) return;

    const win = document.createElement('div');
    win.className = 'floating-chat-window active shadow-2xl';
    win.setAttribute('data-room-id', roomId);
    win.style.left = `${x}px`;
    win.style.top = `${y}px`;
    win.style.zIndex = zIndex;
    win.style.pointerEvents = 'auto'; // pointer-events 통과 방지

    win.innerHTML = `
        <header class="floating-chat-header flex items-center justify-between px-3 py-2 cursor-move select-none">
            <span class="font-bold text-sm truncate flex-1 mr-2 text-primary">${title}</span>
            <div class="flex items-center gap-1.5 flex-shrink-0">
                <button class="minimize-win-btn flex items-center justify-center w-6 h-6 hover:bg-black/10 rounded-full transition-colors" aria-label="채팅창 최소화">
                    <span class="material-symbols-outlined text-sm font-bold">remove</span>
                </button>
                <button class="close-win-btn flex items-center justify-center w-6 h-6 hover:bg-black/10 rounded-full transition-colors text-red-500" aria-label="채팅창 닫기">
                    <span class="material-symbols-outlined text-sm font-bold">close</span>
                </button>
            </div>
        </header>
        <main class="floating-chat-body flex flex-col flex-1 p-3 overflow-y-auto space-y-3 bg-[#f8f9fa] no-scrollbar"></main>
        <footer class="floating-chat-footer p-2 bg-white border-t flex gap-2 items-center">
            <textarea class="chat-win-textarea flex-1 resize-none bg-slate-100 border border-slate-200 rounded-lg p-2 text-xs h-9 max-h-16 outline-none focus:border-primary focus:bg-white transition-all" placeholder="메시지를 입력하세요..."></textarea>
            <button class="chat-win-send-btn flex items-center justify-center w-9 h-9 bg-primary text-white rounded-lg hover:scale-105 active:scale-95 transition-all flex-shrink-0" aria-label="보내기">
                <span class="material-symbols-outlined text-md">send</span>
            </button>
        </footer>
    `;

    // 이벤트 리스너들 바인딩
    win.addEventListener('mousedown', () => focusChatWindow(roomId));

    // 드래그 기능 바인딩
    const header = win.querySelector('.floating-chat-header');
    setupDragAndDrop(header, win, roomId);

    // 최소화/닫기 리스너
    win.querySelector('.minimize-win-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        minimizeChatWindow(roomId);
    });
    win.querySelector('.close-win-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        closeChatWindow(roomId);
    });

    // 메시지 전송 리스너
    const textarea = win.querySelector('.chat-win-textarea');
    const sendBtn = win.querySelector('.chat-win-send-btn');
    
    const sendMessageAction = () => {
        const text = textarea.value.trim();
        if (!text) return;
        textarea.value = '';
        sendWindowMessage(roomId, text);
    };

    sendBtn.addEventListener('click', sendMessageAction);
    textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessageAction();
        }
    });

    container.appendChild(win);
}

// Drag & Drop 처리와 Clamp
function setupDragAndDrop(headerEl, windowEl, roomId) {
    let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
    
    headerEl.onmousedown = dragMouseDown;

    function dragMouseDown(e) {
        e = e || window.event;
        // 드래그 시 최상위 포커스 강제화
        focusChatWindow(roomId);
        
        pos3 = e.clientX;
        pos4 = e.clientY;
        document.onmouseup = closeDragElement;
        document.onmousemove = elementDrag;
    }

    function elementDrag(e) {
        e = e || window.event;
        e.preventDefault();
        
        pos1 = pos3 - e.clientX;
        pos2 = pos4 - e.clientY;
        pos3 = e.clientX;
        pos4 = e.clientY;

        let targetTop = windowEl.offsetTop - pos2;
        let targetLeft = windowEl.offsetLeft - pos1;

        // Viewport Clamp
        targetLeft = Math.max(0, Math.min(targetLeft, window.innerWidth - WINDOW_WIDTH));
        targetTop = Math.max(50, Math.min(targetTop, window.innerHeight - WINDOW_HEIGHT));

        windowEl.style.top = `${targetTop}px`;
        windowEl.style.left = `${targetLeft}px`;
    }

    function closeDragElement() {
        document.onmouseup = null;
        document.onmousemove = null;

        // 최종 안착 좌표 기록
        if (store.activeChatWindows[roomId]) {
            store.activeChatWindows[roomId].x = windowEl.offsetLeft;
            store.activeChatWindows[roomId].y = windowEl.offsetTop;
        }
    }
}

// 윈도우 포커싱
export function focusChatWindow(roomId) {
    const winState = store.activeChatWindows[roomId];
    if (!winState) return;

    // 1. 최소화 해제 처리
    if (winState.isMinimized) {
        winState.isMinimized = false;
        // Dock에서 칩 제거
        const chip = document.querySelector(`#floating-chat-dock [data-dock-id="${roomId}"]`);
        if (chip) chip.remove();
    }

    // 2. DOM 노출 및 z-index 상향
    const winEl = document.querySelector(`#v2-floating-chat-container [data-room-id="${roomId}"]`);
    if (winEl) {
        const newZ = getNextZIndex();
        winState.zIndex = newZ;
        winEl.style.zIndex = newZ;
        winEl.style.display = 'flex';
        winEl.classList.add('active');
        winEl.classList.remove('minimized');
    }
}

// 윈도우 최소화
export function minimizeChatWindow(roomId) {
    const winState = store.activeChatWindows[roomId];
    if (!winState) return;

    winState.isMinimized = true;

    // DOM 숨김
    const winEl = document.querySelector(`#v2-floating-chat-container [data-room-id="${roomId}"]`);
    if (winEl) {
        winEl.style.display = 'none';
        winEl.classList.remove('active');
        winEl.classList.add('minimized');
    }

    // Dock에 칩 컴포넌트 추가
    const dock = document.getElementById('floating-chat-dock');
    if (dock && !dock.querySelector(`[data-dock-id="${roomId}"]`)) {
        const chip = document.createElement('button');
        chip.className = 'bg-primary text-white text-xs font-bold px-3 py-1.5 rounded-full shadow-lg hover:scale-105 active:scale-95 transition-all flex items-center gap-1';
        chip.setAttribute('data-dock-id', roomId);
        chip.style.pointerEvents = 'auto';
        chip.innerHTML = `
            <span class="material-symbols-outlined text-xs">chat_bubble</span>
            <span class="truncate max-w-[100px]">${winState.title}</span>
        `;
        chip.addEventListener('click', () => focusChatWindow(roomId));
        dock.appendChild(chip);
    }
}

// 윈도우 닫기 (채널 릴리즈 필수)
export function closeChatWindow(roomId) {
    // 1. Supabase 채널 구독 끊기
    const chanName = `room_win:${roomId}`;
    const channel = store.supabaseClient.channel(chanName);
    if (channel) {
        store.supabaseClient.removeChannel(channel);
    }

    // 2. DOM 객체 정리
    const winEl = document.querySelector(`#v2-floating-chat-container [data-room-id="${roomId}"]`);
    if (winEl) winEl.remove();

    const chip = document.querySelector(`#floating-chat-dock [data-dock-id="${roomId}"]`);
    if (chip) chip.remove();

    // 3. 전역 상태 갱신
    delete store.activeChatWindows[roomId];
    delete renderedMessageIds[roomId];
}

// 메시지 데이터 로드
async function loadWindowMessages(roomId) {
    const winEl = document.querySelector(`#v2-floating-chat-container [data-room-id="${roomId}"]`);
    if (!winEl) return;

    const body = winEl.querySelector('.floating-chat-body');
    if (!body) return;

    body.innerHTML = '<div class="text-xs text-slate-400 text-center py-4">대화 기록을 가져오는 중...</div>';

    try {
        const token = await store.getSessionToken();
        const res = await fetch(`${API_URL}/chat/messages?roomId=${encodeURIComponent(roomId)}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        if (data.success && data.messages) {
            body.innerHTML = '';
            const messages = data.messages || [];
            messages.forEach(msg => appendWindowMessage(roomId, msg));
            scrollToBottom(body);
        } else {
            body.innerHTML = '<div class="text-xs text-red-400 text-center py-4">기록을 불러오지 못했습니다.</div>';
        }
    } catch (e) {
        console.error('Failed to load window messages:', e);
        body.innerHTML = '<div class="text-xs text-red-400 text-center py-4">네트워크 통신 오류</div>';
    }
}

// 윈도우 내 개별 메시지 추가 및 Deduplication
export function appendWindowMessage(roomId, msg) {
    const winEl = document.querySelector(`#v2-floating-chat-container [data-room-id="${roomId}"]`);
    if (!winEl || !msg.id) return;

    // 중복 체크
    if (renderedMessageIds[roomId]?.has(msg.id)) return;
    renderedMessageIds[roomId]?.add(msg.id);

    const body = winEl.querySelector('.floating-chat-body');
    if (!body) return;

    const userEmailFromDom = document.getElementById('user-email')?.innerText || '';
    const isAiMessage = msg.user_email === 'ai@feeling.journal' || msg.sender_id === '00000000-0000-0000-0000-000000000000';
    const isFriendMessage = msg.user_email && msg.user_email.startsWith('friend-');
    const isMyMessage = !isAiMessage && !isFriendMessage && (
        (store.currentUser?.id && (
            msg.sender_id === store.currentUser.id || 
            msg.user_email === store.currentUser.email
        )) || (msg.user_email && userEmailFromDom && msg.user_email === userEmailFromDom)
    );

    const msgDiv = document.createElement('div');
    msgDiv.className = `flex flex-col ${isMyMessage ? 'items-end self-end' : 'items-start self-start'} space-y-1 w-full`;

    let contentHTML = '';
    
    // 이미지 메시지 여부 파악
    if (msg.content && msg.content.startsWith('![image](')) {
        const imgUrl = msg.content.match(/\((.*?)\)/)?.[1] || '';
        contentHTML = `<img src="${imgUrl}" class="max-w-[200px] rounded-lg shadow-sm border" style="cursor:zoom-in;" onclick="window.open('${imgUrl}')">`;
    } else {
        const textClass = isMyMessage 
            ? 'bg-primary text-white' 
            : (isAiMessage ? 'bg-secondary-container text-on-secondary-container' : 'bg-slate-200 text-slate-800');
        contentHTML = `<div class="px-3 py-2 rounded-2xl text-xs max-w-[240px] break-words shadow-sm ${textClass}">${msg.content}</div>`;
    }

    const senderName = isMyMessage ? '나' : (isAiMessage ? '비서 원이' : (msg.user_metadata?.nickname || '친구'));
    const timeStr = new Date(msg.created_at || msg.createdAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });

    msgDiv.innerHTML = `
        <span class="text-[10px] text-slate-400 px-1">${senderName} • ${timeStr}</span>
        ${contentHTML}
    `;

    body.appendChild(msgDiv);
    scrollToBottom(body);
}

// 메시지 전송
async function sendWindowMessage(roomId, text) {
    try {
        const token = await store.getSessionToken();
        const res = await fetch(`${API_URL}/chat/messages`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                roomId,
                content: text
            })
        });
        const data = await res.json();
        if (data.success) {
            // DB insert 후 Realtime을 통해 수신되거나, 만약 Realtime 연결 지연이 있다면 바로 렌더링되도록 함
            if (data.message) {
                appendWindowMessage(roomId, data.message);
            }
        }
    } catch (e) {
        console.error('Failed to send window message:', e);
    }
}

// Realtime 구독
function subscribeRoomRealtime(roomId) {
    const chanName = `room_win:${roomId}`;
    
    const channel = store.supabaseClient.channel(chanName)
        .on('postgres_changes', {
            event: 'INSERT',
            schema: 'public',
            table: 'messages',
            filter: `room_id=eq.${roomId}`
        }, (payload) => {
            console.log('--- [CHAT WIN] Realtime message received ---', payload.new);
            appendWindowMessage(roomId, payload.new);

            // AI 대화방 자동 응답 트리거
            const isMyMessage = store.currentUser?.id && (
                payload.new.sender_id === store.currentUser.id ||
                payload.new.user_email === store.currentUser.email
            );
            const isAiMessage = payload.new.user_email === 'ai@feeling.journal';
            const winState = store.activeChatWindows[roomId];

            if (winState && winState.title.includes('비서와 대화') && isMyMessage && !isAiMessage) {
                triggerWindowAiResponse(roomId, payload.new.content);
            }
        })
        .subscribe((status) => {
            console.log(`--- [CHAT WIN] Subscription status for ${roomId}: ${status} ---`);
        });
}

async function triggerWindowAiResponse(roomId, text) {
    const winEl = document.querySelector(`#v2-floating-chat-container [data-room-id="${roomId}"]`);
    if (!winEl) return;

    const body = winEl.querySelector('.floating-chat-body');

    // 타이핑 징조 표시
    const typingIndicator = document.createElement('div');
    typingIndicator.className = 'typing-indicator text-[10px] text-slate-400 p-2 italic self-start';
    typingIndicator.innerText = '원이 비서가 생각 중입니다...';
    body?.appendChild(typingIndicator);
    scrollToBottom(body);

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
                roomId
            })
        });
        const data = await res.json();
        
        // 타이핑 제거
        typingIndicator.remove();

        if (data.success && data.message) {
            appendWindowMessage(roomId, data.message);
        } else {
            throw new Error(data.error || 'Server error');
        }
    } catch (e) {
        console.error('Window AI response error:', e);
        typingIndicator.remove();
        appendWindowChatErrorMsg(roomId, text);
    }
}

function appendWindowChatErrorMsg(roomId, retryMsg) {
    const winEl = document.querySelector(`#v2-floating-chat-container [data-room-id="${roomId}"]`);
    if (!winEl) return;
    const body = winEl.querySelector('.floating-chat-body');
    if (!body) return;

    const msgDiv = document.createElement('div');
    msgDiv.className = `flex flex-col items-start self-start space-y-1 w-full error-bubble`;
    msgDiv.innerHTML = `
        <span class="text-[10px] text-red-400 px-1">비서 원이 • 오류</span>
        <div class="px-3 py-2 rounded-2xl text-xs max-w-[240px] break-words shadow-sm bg-red-100 text-red-800 border-2 border-red-300 flex flex-col gap-2">
            <span>비서가 답변을 작성하지 못했습니다.</span>
            <button class="chat-win-retry-btn" style="align-self: flex-start; background: #D4A373; border: 1.5px solid #5D574D; border-radius: 6px; padding: 2px 8px; font-size: 10px; color: white; cursor: pointer; font-weight: bold; box-shadow: 1px 1px 0px rgba(0,0,0,0.15); transition: transform 0.1s;">다시 보내기 ↻</button>
        </div>
    `;
    const btn = msgDiv.querySelector('.chat-win-retry-btn');
    btn.addEventListener('click', () => {
        msgDiv.remove();
        triggerWindowAiResponse(roomId, retryMsg);
    });
    body.appendChild(msgDiv);
    scrollToBottom(body);
}

// 스크롤 최하단 헬퍼
function scrollToBottom(el) {
    if (el) {
        el.scrollTop = el.scrollHeight;
    }
}
