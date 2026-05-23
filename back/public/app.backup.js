console.log('App.js is loading...');

/* ==========================================================================
   [GLOBAL STATE & CONFIG]
   ========================================================================== */
const SUPABASE_BASE_URL = 'https://gfviwwivwcyozvnuv.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdmdml3d2l2d2N5b3p2bnV2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3MTU2OTI2MTEsImV4cCI6MjAzMTI2ODYxMX0.dyyextqFiizraFDacp3BMfM-IGdsqswA6G_AfFfa8';
const supabaseClient = supabase.createClient(SUPABASE_BASE_URL, SUPABASE_ANON_KEY);
const API_URL = '/api';

let quillEditor = null;
let currentNotebookId = 'nb-1'; // 기본 노트북 ID
let currentPageId = null;
let currentRoomId = null;
let chatChannel = null;
let isAnalysisRunning = false;

/* ==========================================================================
   [INITIALIZATION]
   ========================================================================== */
document.addEventListener('DOMContentLoaded', async () => {
    console.log('--- [INIT] Feeling Journal Application Started ---');
    
    setupTabs();
    setupAuth();
    setupEditor();
    setupResizers();
    setupEmojiPicker();
    setupChatUI();
    setupPersonaUI();
    setupScrapLogic();
    setupWritingHelper();
    
    // Check session on start
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (session) {
        onUserAuthenticated(session);
    } else {
        showAuthUI();
    }
});

/* ==========================================================================
   [AUTHENTICATION & PROFILE]
   ========================================================================== */
function setupAuth() {
    const authForm = document.getElementById('auth-form');
    const loginBtn = document.getElementById('login-btn');
    const signupBtn = document.getElementById('signup-btn');
    const googleBtn = document.getElementById('google-login-btn');
    const logoutBtn = document.getElementById('logout-btn');

    loginBtn?.addEventListener('click', async (e) => {
        e.preventDefault();
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;
        const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
        if (error) alert('로그인 실패: ' + error.message);
    });

    signupBtn?.addEventListener('click', async (e) => {
        e.preventDefault();
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;
        const { data, error } = await supabaseClient.auth.signUp({ email, password });
        if (error) alert('회원가입 실패: ' + error.message);
        else alert('인증 이메일을 확인해 주세요!');
    });

    googleBtn?.addEventListener('click', async () => {
        await supabaseClient.auth.signInWithOAuth({
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

    logoutBtn?.addEventListener('click', async () => {
        await supabaseClient.auth.signOut();
        window.location.reload();
    });

    supabaseClient.auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_IN' && session) {
            onUserAuthenticated(session);
        } else if (event === 'SIGNED_OUT') {
            showAuthUI();
        }
    });
}

async function onUserAuthenticated(session) {
    document.getElementById('auth-container').style.display = 'none';
    document.getElementById('journal-app').style.display = 'block';
    document.getElementById('user-email').innerText = session.user.email;
    
    if (session.provider_token) {
        localStorage.setItem('google_provider_token', session.provider_token);
    }
    
    // Check/Prompt Nickname
    await checkNickname();
    
    // Load Data
    loadNotebooks();
    loadBriefing();
    checkFriendSos();

    // Add Notebook/Page Event Listeners
    document.getElementById('add-notebook-btn')?.addEventListener('click', addNotebook);
    document.getElementById('new-page-btn')?.addEventListener('click', addNewPage);
}

function showAuthUI() {
    document.getElementById('auth-container').style.display = 'flex';
    document.getElementById('journal-app').style.display = 'none';
}

async function checkNickname() {
    const res = await fetch(`${API_URL}/nickname`, {
        headers: { 'Authorization': `Bearer ${(await supabaseClient.auth.getSession()).data.session?.access_token}` }
    });
    const data = await res.json();
    
    if (data.success && !data.nickname) {
        const nickname = prompt('반갑습니다! 당신의 수석 비서가 당신을 어떻게 부르면 좋을까요? (호칭 입력)');
        if (nickname) {
            await fetch(`${API_URL}/nickname`, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${(await supabaseClient.auth.getSession()).data.session?.access_token}` 
                },
                body: JSON.stringify({ nickname })
            });
            alert(`${nickname}님, 환영합니다. 당신의 하루를 책임지겠습니다.`);
        }
    }
}

/* ==========================================================================
   [TABS & NAVIGATION]
   ========================================================================== */
function setupTabs() {
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');

    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const tabId = btn.dataset.tab;
            
            tabBtns.forEach(b => b.classList.remove('active'));
            tabContents.forEach(c => {
                c.classList.remove('active');
                c.style.display = 'none';
            });

            btn.classList.add('active');
            const target = document.getElementById(`${tabId}-view`);
            if (target) {
                target.classList.add('active');
                target.style.display = tabId === 'journal' ? 'flex' : 'block';
                
                if (tabId === 'calendar') loadCalendar();
                else if (tabId === 'chat') initializeChat();
                else if (tabId === 'persona') loadPersona();
            }
        });
    });
}

/* ==========================================================================
   [3-COLUMN JOURNAL LOGIC]
   ========================================================================== */
async function loadNotebooks() {
    const res = await fetch(`${API_URL}/notebooks`, {
        headers: { 'Authorization': `Bearer ${(await supabaseClient.auth.getSession()).data.session?.access_token}` }
    });
    const data = await res.json();
    
    const list = document.getElementById('notebook-list');
    if (!list) return;
    
    const notebooks = (data.success && data.notebooks?.length > 0) 
        ? data.notebooks 
        : [{ id: 'nb-1', name: '내 일기장', color: '#6366f1' }];
        
    list.innerHTML = notebooks.map(nb => `
        <li class="notebook-item ${currentNotebookId === nb.id ? 'active' : ''}" data-id="${nb.id}">
            <span class="folder-icon">📁</span>
            <span class="name">${nb.name}</span>
        </li>
    `).join('');
    
    list.querySelectorAll('.notebook-item').forEach(item => {
        item.addEventListener('click', () => {
            currentNotebookId = item.dataset.id;
            document.querySelectorAll('.notebook-item').forEach(i => i.classList.remove('active'));
            item.classList.add('active');
            loadPages();
        });
    });
    
    loadPages();
}

async function loadPages() {
    const res = await fetch(`${API_URL}/history`, {
        headers: { 'Authorization': `Bearer ${(await supabaseClient.auth.getSession()).data.session?.access_token}` }
    });
    const data = await res.json();
    
    const list = document.getElementById('page-list');
    if (!list) return;
    
    const filtered = (data.history || []).filter(h => h.notebookId === currentNotebookId);
    
    list.innerHTML = filtered.length > 0 ? filtered.map(p => `
        <div class="page-item ${currentPageId === p.id ? 'active' : ''}" data-id="${p.id}">
            <div class="page-title">${p.title || '제목 없음'}</div>
            <div class="page-meta">
                <span class="emotion-tag">${p.emotion || '평온'}</span>
                <span class="date">${new Date(p.createdAt).toLocaleDateString()}</span>
            </div>
        </div>
    `).join('') : '<div class="empty-msg">작성된 페이지가 없습니다.</div>';
    
    list.querySelectorAll('.page-item').forEach(item => {
        item.addEventListener('click', () => {
            selectPage(item.dataset.id, data.history);
        });
    });
}

function selectPage(pageId, history) {
    const page = history.find(p => p.id === pageId);
    if (!page) return;
    
    currentPageId = pageId;
    document.querySelectorAll('.page-item').forEach(i => i.classList.remove('active'));
    document.querySelector(`.page-item[data-id="${pageId}"]`)?.classList.add('active');
    
    document.getElementById('note-title').value = page.title || '';
    if (quillEditor) {
        quillEditor.root.innerHTML = page.richContent || `<p>${page.originalContent || ''}</p>`;
    }
    
    document.getElementById('response-text').innerText = page.aiResponse || '비서가 대기 중입니다.';
    document.getElementById('note-date-display').innerText = new Date(page.createdAt).toLocaleString();
}

async function addNotebook() {
    const name = prompt('새 전자 필기장 이름을 입력하세요:');
    if (!name) return;
    
    const { data: { session } } = await supabaseClient.auth.getSession();
    const res = await fetch(`${API_URL}/notebooks`, {
        headers: { 'Authorization': `Bearer ${session.access_token}` }
    });
    const data = await res.json();
    const notebooks = data.notebooks || [];
    
    const newNb = { id: `nb-${Date.now()}`, name, color: '#6366f1' };
    notebooks.push(newNb);
    
    await fetch(`${API_URL}/notebooks`, {
        method: 'POST',
        headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}` 
        },
        body: JSON.stringify({ notebooks })
    });
    
    currentNotebookId = newNb.id;
    loadNotebooks();
}

async function addNewPage() {
    if (quillEditor) quillEditor.root.innerHTML = '';
    document.getElementById('note-title').value = '';
    document.getElementById('response-text').innerText = '새로운 페이지를 작성해 보세요.';
    currentPageId = null;
    document.querySelectorAll('.page-item').forEach(i => i.classList.remove('active'));
}

function setupResizers() {
    const resizer1 = document.getElementById('resizer-1');
    const resizer2 = document.getElementById('resizer-2');
    const sidebar1 = document.querySelector('.notebook-sidebar');
    const sidebar2 = document.querySelector('.pages-sidebar');
    
    if (!resizer1 || !resizer2) return;

    let isResizing = false;

    resizer1.addEventListener('mousedown', (e) => {
        isResizing = true;
        document.addEventListener('mousemove', handleResize1);
        document.addEventListener('mouseup', () => {
            isResizing = false;
            document.removeEventListener('mousemove', handleResize1);
        });
    });

    resizer2.addEventListener('mousedown', (e) => {
        isResizing = true;
        document.addEventListener('mousemove', handleResize2);
        document.addEventListener('mouseup', () => {
            isResizing = false;
            document.removeEventListener('mousemove', handleResize2);
        });
    });

    function handleResize1(e) {
        if (!isResizing) return;
        const width = e.clientX - sidebar1.getBoundingClientRect().left;
        if (width > 100 && width < 400) sidebar1.style.width = width + 'px';
    }

    function handleResize2(e) {
        if (!isResizing) return;
        const width = e.clientX - sidebar2.getBoundingClientRect().left;
        if (width > 150 && width < 500) sidebar2.style.width = width + 'px';
    }
}

/* ==========================================================================
   [QUILL EDITOR]
   ========================================================================== */
function setupEditor() {
    if (typeof Quill === 'undefined') return;
    
    const Font = Quill.import('formats/font');
    Font.whitelist = ['serif', 'monospace', 'nanum'];
    Quill.register(Font, true);

    quillEditor = new Quill('#quill-editor', {
        theme: 'snow',
        modules: { toolbar: '#quill-toolbar' },
        placeholder: '오늘 당신의 마음은 어떤가요? 자유롭게 적어보세요...'
    });

    quillEditor.on('text-change', () => {
        const content = quillEditor.getText().trim();
        document.getElementById('diary-input').value = content;
        // Optional: Auto-save logic here
    });

    const analyzeBtn = document.getElementById('analyze-btn');
    analyzeBtn?.addEventListener('click', analyzeDiary);
}

async function analyzeDiary() {
    if (isAnalysisRunning) return;
    
    const content = quillEditor.getText().trim();
    const richContent = quillEditor.root.innerHTML;
    const title = document.getElementById('note-title').value.trim();
    
    if (!content) return alert('분석할 내용이 없습니다.');
    
    isAnalysisRunning = true;
    const btn = document.getElementById('analyze-btn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> 분석 중...';
    
    try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        const providerToken = localStorage.getItem('google_provider_token');
        
        const res = await fetch(`${API_URL}/analyze`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${session.access_token}`,
                'x-provider-token': providerToken || ''
            },
            body: JSON.stringify({ content, richContent, title, notebookId: currentNotebookId })
        });
        
        const data = await res.json();
        if (data.success) {
            document.getElementById('response-text').innerText = data.answer;
            alert('비서가 분석을 완료하고 기록을 저장했습니다.');
            loadPages();
            if (data.event) {
                if (confirm(`AI가 새로운 일정을 제안했습니다: [${data.event.summary}]\n캘린더에 등록할까요?`)) {
                    registerEventToGoogle(data.event);
                }
            }
        }
    } catch (e) {
        console.error(e);
        alert('분석 중 오류가 발생했습니다.');
    } finally {
        isAnalysisRunning = false;
        btn.disabled = false;
        btn.innerHTML = 'AI 분석 및 저장';
    }
}

async function registerEventToGoogle(event) {
    const { data: { session } } = await supabaseClient.auth.getSession();
    const providerToken = localStorage.getItem('google_provider_token');
    
    const res = await fetch(`${API_URL}/calendar/add`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
            'x-provider-token': providerToken || ''
        },
        body: JSON.stringify(event)
    });
    
    const data = await res.json();
    if (data.success) alert('구글 캘린더에 일정이 성공적으로 등록되었습니다.');
}

/* ==========================================================================
   [AI DAILY BRIEFING]
   ========================================================================== */
async function loadBriefing() {
    const card = document.getElementById('briefing-card');
    const content = document.getElementById('briefing-content');
    if (!card || !content) return;
    
    try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        const providerToken = localStorage.getItem('google_provider_token');
        
        card.classList.remove('hidden');
        content.innerHTML = '<div class="loading"></div> 비서가 브리핑을 준비 중입니다...';
        
        const res = await fetch(`${API_URL}/briefing`, {
            headers: {
                'Authorization': `Bearer ${session.access_token}`,
                'x-provider-token': providerToken || ''
            }
        });
        
        const data = await res.json();
        if (data.success) {
            content.innerHTML = data.briefing.replace(/\n/g, '<br>');
        }
    } catch (e) {
        console.error('Briefing Error:', e);
        content.innerText = '오늘은 브리핑을 가져오지 못했습니다.';
    }
}

/* ==========================================================================
   [CALENDAR]
   ========================================================================== */
let fullCalendar = null;

async function loadCalendar() {
    const container = document.getElementById('calendar-container');
    if (!container) return;
    
    container.innerHTML = '<div class="loading-full">일정을 불러오는 중...</div>';
    
    try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        const providerToken = localStorage.getItem('google_provider_token');
        
        const res = await fetch(`${API_URL}/calendar`, {
            headers: {
                'Authorization': `Bearer ${session.access_token}`,
                'x-provider-token': providerToken || ''
            }
        });
        
        const data = await res.json();
        if (!data.success) throw new Error(data.error);
        
        if (fullCalendar) fullCalendar.destroy();
        
        fullCalendar = new FullCalendar.Calendar(container, {
            initialView: 'dayGridMonth',
            locale: 'ko',
            height: 'auto',
            headerToolbar: {
                left: 'prev,next today',
                center: 'title',
                right: 'dayGridMonth,timeGridWeek,listMonth'
            },
            events: data.events,
            eventDidMount: (info) => {
                if (info.event.extendedProps.advice) {
                    tippy(info.el, { content: info.event.extendedProps.advice });
                }
            }
        });
        
        fullCalendar.render();
    } catch (e) {
        console.error(e);
        container.innerHTML = `<div class="error">캘린더 로드 실패: ${e.message}</div>`;
    }
}

/* ==========================================================================
   [REALTIME CHAT & SOS]
   ========================================================================== */
async function initializeChat() {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) return;
    
    // Find Lobby
    let { data: lobby } = await supabaseClient.from('rooms').select('id').eq('name', 'Lobby').maybeSingle();
    if (!lobby) {
        const { data: newLobby } = await supabaseClient.from('rooms').insert([{ name: 'Lobby', type: 'group' }]).select().single();
        lobby = newLobby;
    }
    currentRoomId = lobby.id;
    
    if (chatChannel) supabaseClient.removeChannel(chatChannel);
    
    chatChannel = supabaseClient.channel(`room:${currentRoomId}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `room_id=eq.${currentRoomId}` }, (payload) => {
            appendMessage(payload.new);
        })
        .subscribe();
        
    loadMessages();
}

async function loadMessages() {
    const { data } = await supabaseClient.from('messages')
        .select('*')
        .eq('room_id', currentRoomId)
        .order('created_at', { ascending: true })
        .limit(50);
        
    const container = document.getElementById('chat-messages-tab');
    if (container) {
        container.innerHTML = '';
        data?.forEach(appendMessage);
    }
}

function appendMessage(msg) {
    const container = document.getElementById('chat-messages-tab');
    if (!container) return;
    
    const { data: { user } } = supabaseClient.auth.getSession()?.data?.session || { data: { user: null } };
    const isMe = msg.sender_id === user?.id;
    
    const div = document.createElement('div');
    div.className = `message ${isMe ? 'sent' : 'received'}`;
    div.innerHTML = `
        <span class="message-sender">${msg.user_email.split('@')[0]}</span>
        <div class="message-content">${msg.content}</div>
        <span class="message-info">${new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
    `;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

document.getElementById('send-chat-btn-tab')?.addEventListener('click', async () => {
    const input = document.getElementById('chat-input-tab');
    const content = input.value.trim();
    if (!content) return;
    
    const { data: { user } } = await supabaseClient.auth.getUser();
    await supabaseClient.from('messages').insert([{
        content,
        sender_id: user.id,
        user_email: user.email,
        room_id: currentRoomId
    }]);
    
    input.value = '';
    
    // AI Mention Check
    if (content.includes('@비서') || content.includes('@AI')) {
        callChatAI(content);
    }
});

async function callChatAI(msg) {
    const { data: { session } } = await supabaseClient.auth.getSession();
    const res = await fetch(`${API_URL}/chat/ai-response`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ message: msg })
    });
    const data = await res.json();
    if (data.success) {
        await supabaseClient.from('messages').insert([{
            content: data.answer,
            sender_id: '00000000-0000-0000-0000-000000000000',
            user_email: 'ai@feeling.journal',
            room_id: currentRoomId
        }]);
    }
}

function setupChatUI() {
    const inviteBtn = document.getElementById('invite-friend-btn');
    const closeInviteBtn = document.getElementById('close-invite-modal');
    const modal = document.getElementById('invite-modal');
    
    inviteBtn?.addEventListener('click', () => {
        modal.style.display = 'flex';
        loadContacts();
    });
    
    closeInviteBtn?.addEventListener('click', () => {
        modal.style.display = 'none';
    });
}

async function loadContacts() {
    const list = document.getElementById('contact-list');
    if (!list) return;
    
    list.innerHTML = '<div class="loading">연락처를 불러오고 있습니다...</div>';
    
    // Mock contacts for now, or fetch from real API if available
    const mockContacts = [
        { name: '김철수', email: 'chulsoo@example.com' },
        { name: '이영희', email: 'younghee@example.com' },
        { name: '박민수', email: 'minsu@example.com' }
    ];
    
    list.innerHTML = mockContacts.map(c => `
        <div class="contact-item">
            <div class="contact-info">
                <strong>${c.name}</strong>
                <span>${c.email}</span>
            </div>
            <button class="btn sm primary invite-action-btn" data-email="${c.email}" data-name="${c.name}">초대</button>
        </div>
    `).join('');
    
    list.querySelectorAll('.invite-action-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const email = btn.dataset.email;
            const name = btn.dataset.name;
            btn.disabled = true;
            btn.innerText = '초대 중...';
            
            const { data: { session } } = await supabaseClient.auth.getSession();
            const res = await fetch(`${API_URL}/invite`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${session.access_token}`
                },
                body: JSON.stringify({ email, name })
            });
            
            if ((await res.json()).success) {
                alert(`${name}님에게 초대 메일을 보냈습니다.`);
                btn.innerText = '초대됨';
            } else {
                alert('초대 실패');
                btn.disabled = false;
                btn.innerText = '초대';
            }
        });
    });
}

function setupPersonaUI() {
    // Already has save listener in the main script, but we can add more logic here
    console.log('--- [UI] Persona Atelier Setup ---');
}

async function checkFriendSos() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    const res = await fetch(`${API_URL}/friends/sos`, {
        headers: { 'Authorization': `Bearer ${session.access_token}` }
    });
    const data = await res.json();
    
    const list = document.getElementById('friend-status-list');
    if (list && data.allFriends) {
        list.innerHTML = data.allFriends.map(f => `
            <div class="friend-item ${data.sosList?.some(s => s.id === f.id) ? 'sos' : ''}">
                <div class="friend-avatar">${f.nickname?.[0] || '👤'}</div>
                <div class="friend-info">
                    <div class="friend-name">${f.nickname || '익명'}</div>
                    <div class="friend-emotion">${f.current_emotion || '평온'}</div>
                </div>
                ${data.sosList?.some(s => s.id === f.id) ? '<span class="sos-badge">🚨 SOS</span>' : ''}
            </div>
        `).join('');
    }
}

/* ==========================================================================
   [PERSONA ATELIER]
   ========================================================================== */
async function loadPersona() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    const res = await fetch(`${API_URL}/persona`, {
        headers: { 'Authorization': `Bearer ${session.access_token}` }
    });
    const data = await res.json();
    if (data.success && data.persona) {
        const p = data.persona;
        if (p.gender) document.querySelector(`input[name="gender"][value="${p.gender}"]`).checked = true;
        document.getElementById('ai-age').value = p.age || '20대';
        document.getElementById('ai-relationship').value = p.relationship || '비서';
        document.getElementById('ai-personality').value = p.personality || '';
        renderPersonaAvatar(p);
    }
}

function renderPersonaAvatar(p) {
    const preview = document.getElementById('ai-avatar-preview');
    if (!preview) return;
    const color = p.gender === '여성' ? '#f8a5c2' : '#778beb';
    preview.style.background = `radial-gradient(circle, ${color} 0%, #2d3436 100%)`;
    preview.innerHTML = `<span style="font-size: 80px;">${p.gender === '여성' ? '👩‍💼' : '👨‍💼'}</span>`;
}

document.getElementById('save-persona-btn')?.addEventListener('click', async () => {
    const persona = {
        gender: document.querySelector('input[name="gender"]:checked').value,
        age: document.getElementById('ai-age').value,
        relationship: document.getElementById('ai-relationship').value,
        personality: document.getElementById('ai-personality').value
    };
    
    const { data: { session } } = await supabaseClient.auth.getSession();
    const res = await fetch(`${API_URL}/persona`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ persona })
    });
    
    if ((await res.json()).success) {
        alert('비서의 성격과 모습이 반영되었습니다.');
        renderPersonaAvatar(persona);
    }
});

/* ==========================================================================
   [EMOJI PICKER]
   ========================================================================== */
const EMOJI_DATA = {
    emotion: ['😊','😍','😂','😭','🥰','😒','😤','😡','😱','😴','🥳','😇','🤡','👻','💀','👽','🤖','🎃','😺','👋','👏','🙌','🙏','💪'],
    nature: ['🌸','🍀','🌈','☀️','⭐','🌙','🔥','💧','❄️','🍃','🍁','🍂','🍄','🌾','🌵','🌴','🌲','🌳','🌱','🌿','🌞','🌝','🌍','🌌'],
    food: ['🍎','🍓','🍕','🍔','🍦','☕','🍺','🍰','🍣','🍜','🍳','🥐','🥨','🥯','🥞','🧀','🍗','🥩','🥓','🍔','🍟','핫도그','🥪','🌮'],
};

function setupEmojiPicker() {
    const btn = document.getElementById('emoji-picker-btn');
    const panel = document.getElementById('emoji-panel');
    const grid = document.getElementById('emoji-grid');
    
    btn?.addEventListener('click', (e) => {
        e.stopPropagation();
        panel?.classList.toggle('hidden');
        renderEmojis('emotion');
    });

    document.querySelectorAll('.emoji-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.emoji-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            renderEmojis(tab.dataset.cat);
        });
    });

    function renderEmojis(cat) {
        if (!grid) return;
        const list = EMOJI_DATA[cat] || EMOJI_DATA.emotion;
        grid.innerHTML = list.map(e => `<span class="emoji-item">${e}</span>`).join('');
        grid.querySelectorAll('.emoji-item').forEach(item => {
            item.addEventListener('click', () => {
                if (quillEditor) {
                    const range = quillEditor.getSelection(true);
                    quillEditor.insertText(range.index, item.innerText);
                    quillEditor.setSelection(range.index + item.innerText.length);
                }
                panel.classList.add('hidden');
            });
        });
    }

    document.addEventListener('click', () => panel?.classList.add('hidden'));
    panel?.addEventListener('click', (e) => e.stopPropagation());
}

/* ==========================================================================
   [SCRAP LOGIC]
   ========================================================================== */
function setupScrapLogic() {
    const scrapBtn = document.getElementById('scrap-btn');
    scrapBtn?.addEventListener('click', () => {
        const url = prompt('스크랩할 웹 주소를 입력하세요:');
        if (url) performUrlScrap(url);
    });
}

async function performUrlScrap(url) {
    const { data: { session } } = await supabaseClient.auth.getSession();
    const btn = document.getElementById('scrap-btn');
    btn.innerHTML = '🌐 스캔 중...';
    
    try {
        const res = await fetch(`${API_URL}/scrap-url-snapshot`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${session.access_token}`
            },
            body: JSON.stringify({ url })
        });
        const data = await res.json();
        if (data.success) {
            document.getElementById('note-title').value = data.title;
            quillEditor.root.innerHTML = `<p>${data.content.replace(/\n/g, '</p><p>')}</p>`;
            alert('웹 페이지 내용을 성공적으로 가져왔습니다.');
        }
    } catch (e) {
        alert('스크랩 실패');
    } finally {
        btn.innerHTML = '🌐 스크랩';
    }
}

/* ==========================================================================
   [WRITING HELPER (BUBBLE)]
   ========================================================================== */
function setupWritingHelper() {
    const btn = document.getElementById('writing-helper-btn');
    const panel = document.getElementById('writing-helper-panel');
    const closeBtn = document.getElementById('close-helper-btn');
    const sendBtn = document.getElementById('send-helper-reply-btn');
    const input = document.getElementById('helper-reply-input');
    
    btn?.addEventListener('click', () => {
        panel.classList.toggle('hidden');
        if (!panel.classList.contains('hidden')) {
            startHelperConversation();
        }
    });
    
    closeBtn?.addEventListener('click', () => panel.classList.add('hidden'));
    
    sendBtn?.addEventListener('click', async () => {
        const text = input.value.trim();
        if (!text) return;
        appendHelperMsg('user', text);
        input.value = '';
        
        const { data: { session } } = await supabaseClient.auth.getSession();
        const res = await fetch(`${API_URL}/chat/ai-response`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${session.access_token}`
            },
            body: JSON.stringify({ message: text, context: '사용자가 일기를 쓰기 위해 도움을 요청하고 있습니다.' })
        });
        const data = await res.json();
        if (data.success) appendHelperMsg('bot', data.answer);
    });
}

function startHelperConversation() {
    const area = document.getElementById('helper-chat-area');
    area.innerHTML = '';
    appendHelperMsg('bot', '안녕하세요! 오늘 하루는 어떠셨나요? 무엇이든 이야기해 주시면 제가 일기로 정리해 드릴게요.');
}

function appendHelperMsg(type, text) {
    const area = document.getElementById('helper-chat-area');
    const div = document.createElement('div');
    div.className = `${type}-msg`;
    div.innerText = text;
    area.appendChild(div);
    area.scrollTop = area.scrollHeight;
}