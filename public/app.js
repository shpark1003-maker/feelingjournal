console.log('App.js is loading...');

window.onerror = function (msg, url, lineNo, columnNo, error) {
    console.error('Global Error:', msg, 'at', url, ':', lineNo, ':', columnNo, error);
    return false;
};

const SUPABASE_URL = 'https://gfvfilwigbwycnobvnuv.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdmdmZpbHdpZ2J3eWNub2J2bnV2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgzNDIwNzUsImV4cCI6MjA5MzkxODA3NX0.dxvyeqt9tFizpraFDAcp1B3MfV-IGVdsqwAG6A_Ffa8';

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

document.addEventListener('DOMContentLoaded', () => {
    console.log('App initialization started...');

    // 1. [알람 시스템] 서비스 워커 등록 및 알림 권한 요청
    const publicVapidKey = 'BFaiQCVuphAhi6QmLixXjsuPcxpSVi5ktV0lrRgGqXPwmhqOKxrwc3nzJcGQvebhG38JMBbayFeMjjoG9wbDehg';

    function urlBase64ToUint8Array(base64String) {
        const padding = '='.repeat((4 - base64String.length % 4) % 4);
        const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
        const rawData = window.atob(base64);
        const outputArray = new Uint8Array(rawData.length);
        for (let i = 0; i < rawData.length; ++i) {
            outputArray[i] = rawData.charCodeAt(i);
        }
        return outputArray;
    }

    if ('serviceWorker' in navigator && 'Notification' in window) {
        navigator.serviceWorker.register('/sw.js')
            .then(reg => {
                console.log('Service Worker registered');
                // 알림 권한이 있으면 자동 구독 시도
                if (Notification.permission === 'granted') {
                    subscribeToPush(reg);
                }
            })
            .catch(err => console.error('SW Registration Error:', err));

        if (Notification.permission !== 'granted' && Notification.permission !== 'denied') {
            Notification.requestPermission().then(permission => {
                if (permission === 'granted') {
                    navigator.serviceWorker.ready.then(reg => subscribeToPush(reg));
                }
            });
        }
    }

    async function subscribeToPush(registration) {
        try {
            const subscription = await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array(publicVapidKey)
            });

            const response = await fetch('/api/subscribe', {
                method: 'POST',
                body: JSON.stringify({ subscription, settings: getAlarmSettings() }),
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${userSession?.access_token || ''}`,
                    'x-provider-token': getProviderToken() || ''
                }
            });
            
            if (response.ok) {
                console.log('Push Subscribed successfully');
            } else {
                console.warn('Push Subscription Server Refused:', response.status);
            }
        } catch (e) {
            console.error('Push Subscription Failed:', e);
        }
    }

    function getAlarmSettings() {
        return {
            alarm60: document.getElementById('alarm-60')?.checked || false,
            alarm30: document.getElementById('alarm-30')?.checked || false,
            alarm10: document.getElementById('alarm-10')?.checked || false
        };
    }

    const authContainer = document.getElementById('auth-container');
    const journalApp = document.getElementById('journal-app');
    const authForm = document.getElementById('auth-form');
    const emailInput = document.getElementById('email');
    const passwordInput = document.getElementById('password');
    const signupBtn = document.getElementById('signup-btn');
    const googleLoginBtn = document.getElementById('google-login-btn');
    const kakaoLoginBtn = document.getElementById('kakao-login-btn');
    const logoutBtn = document.getElementById('logout-btn');
    const userEmailSpan = document.getElementById('user-email');

    const diaryInput = document.getElementById('diary-input');
    const voiceBtn = document.getElementById('voice-btn');
    const analyzeBtn = document.getElementById('analyze-btn');
    const responseBox = document.getElementById('ai-response-box');
    const responseText = document.getElementById('response-text');
    const historyList = document.getElementById('history-list');
    const sortNewestBtn = document.getElementById('sort-newest');
    const sortOldestBtn = document.getElementById('sort-oldest');

    const chatMessagesContainer = document.getElementById('chat-messages');
    const chatInput = document.getElementById('chat-input');
    const sendChatBtn = document.getElementById('send-chat-btn');

    let diaryHistory = [];
    let currentSort = 'newest';
    let userSession = null;

    let isSubscribed = false;
    let chatChannel = null;
    let calendarInstance = null;
    let isCalendarLoading = false;

    const renderedMessageIds = new Set();

    const safeJson = async (response) => {
        try {
            return await response.json();
        } catch {
            throw new Error('서버 응답을 해석할 수 없습니다.');
        }
    };

    const clearElement = (el) => {
        while (el.firstChild) el.removeChild(el.firstChild);
    };

    const appendTextWithBreaks = (parent, text) => {
        const lines = String(text || '').split('\n');

        lines.forEach((line, index) => {
            if (index > 0) parent.appendChild(document.createElement('br'));
            parent.appendChild(document.createTextNode(line));
        });
    };

    const cleanAiAnswer = (answer) => {
        return String(answer || '')
            .replace(/EVENT_JSON_START[\s\S]*?EVENT_JSON_END/g, '')
            .replace(/EVENT_JSON:.*/gs, '')
            .trim();
    };

    const getProviderToken = () => {
        return userSession?.provider_token || localStorage.getItem('google_provider_token');
    };

    const updateAuthState = (session) => {
        console.log('Update Auth State Triggered. session:', !!session);

        if (userSession?.user?.id === session?.user?.id && !!userSession === !!session) {
            console.log('Session identical, skipping UI update.');
            return;
        }

        userSession = session;

        if (session) {
            console.log('Signed In as:', session.user.email);

            if (session.provider_token) {
                localStorage.setItem('google_provider_token', session.provider_token);
                console.log('Google Provider Token saved');
            }

            authContainer.style.display = 'none';
            journalApp.style.display = 'block';
            userEmailSpan.textContent = session.user.email || '';

            window.loadHistory();
            subscribeToMessages();
            // [브리핑 기능] 로그인 직후 AI 브리핑 로드
            if (typeof loadBriefing === 'function') loadBriefing();

            // [문제 4, 5 해결] 로그인 직후 캘린더 자동 로드 (DOM 안정화 대기)
            setTimeout(() => {
                if (typeof loadCalendar === 'function') loadCalendar();
            }, 200);
        } else {
            console.log('Signed Out');

            authContainer.style.display = 'flex';
            journalApp.style.display = 'none';
            userEmailSpan.textContent = '';
            localStorage.removeItem('google_provider_token');

            if (chatChannel) {
                supabaseClient.removeChannel(chatChannel);
                chatChannel = null;
            }

            isSubscribed = false;
            renderedMessageIds.clear();
        }
    };

    const createMessageElement = (msg) => {
        const isMe = msg.sender_id === userSession?.user?.id;

        const msgDiv = document.createElement('div');
        msgDiv.className = `message ${isMe ? 'sent' : 'received'}`;

        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';
        contentDiv.textContent = msg.content || '';

        const infoSpan = document.createElement('span');
        infoSpan.className = 'message-info';
        infoSpan.textContent = new Date(msg.created_at).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit'
        });

        msgDiv.appendChild(contentDiv);
        msgDiv.appendChild(infoSpan);

        return msgDiv;
    };

    const addSingleMessage = (msg) => {
        if (!msg || !msg.id || renderedMessageIds.has(msg.id)) return;

        renderedMessageIds.add(msg.id);
        chatMessagesContainer.appendChild(createMessageElement(msg));
        chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight;
    };

    const renderMessages = (messages) => {
        clearElement(chatMessagesContainer);
        renderedMessageIds.clear();

        const fragment = document.createDocumentFragment();

        messages.forEach((msg) => {
            if (!msg.id || renderedMessageIds.has(msg.id)) return;
            renderedMessageIds.add(msg.id);
            fragment.appendChild(createMessageElement(msg));
        });

        chatMessagesContainer.appendChild(fragment);
        chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight;
    };

    const loadMessages = async () => {
        if (!userSession) return;

        const { data, error } = await supabaseClient
            .from('messages')
            .select('*')
            .order('created_at', { ascending: true })
            .limit(50);

        if (error) {
            console.error('Load Messages Error:', error);
            return;
        }

        renderMessages(data || []);
    };

    const subscribeToMessages = () => {
        if (isSubscribed || chatChannel) {
            console.log('Already subscribed or channel exists, skipping.');
            return;
        }

        console.log('Initializing Realtime Subscription...');

        chatChannel = supabaseClient.channel('public:messages');

        chatChannel
            .on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'messages'
                },
                (payload) => {
                    console.log('Realtime Message:', payload.new);
                    addSingleMessage(payload.new);
                }
            )
            .subscribe((status) => {
                if (status === 'SUBSCRIBED') {
                    isSubscribed = true;
                    console.log('Realtime Status: Connected');
                } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                    console.error('Realtime Channel Error:', status);
                    isSubscribed = false;

                    if (chatChannel) {
                        supabaseClient.removeChannel(chatChannel);
                        chatChannel = null;
                    }
                }
            });
    };

    sendChatBtn.addEventListener('click', async () => {
        const content = chatInput.value.trim();
        if (!content || !userSession) return;

        const { error } = await supabaseClient
            .from('messages')
            .insert([{ content, sender_id: userSession.user.id }]);

        if (error) {
            alert('메시지 전송 실패: ' + error.message);
            return;
        }

        chatInput.value = '';
    });

    chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendChatBtn.click();
        }
    });

    const getCalendarContainer = () => document.getElementById('calendar-container');

    const loadCalendar = async () => {
        if (!userSession || isCalendarLoading) return;

        const container = getCalendarContainer();
        if (!container) return;

        isCalendarLoading = true;
        container.textContent = 'AI 비서가 구글 캘린더 일정을 분석 중입니다... ✨';

        try {
            const providerToken = getProviderToken();

            if (!providerToken) {
                container.textContent = '구글 계정 연결이 필요합니다. 다시 로그인해주세요.';
                return;
            }

            const response = await fetch('/api/calendar', {
                headers: {
                    Authorization: `Bearer ${userSession.access_token}`,
                    'x-provider-token': providerToken
                }
            });

            const data = await safeJson(response);

            if (!response.ok || data.error) {
                throw new Error(data.error || '캘린더 로딩 실패');
            }

            if (data.events && data.events.length > 0) {
                renderCalendar(data.events);
            } else {
                container.textContent = '가져올 일정이 없습니다. 구글 캘린더를 확인해 주세요. 📅';
            }
        } catch (error) {
            console.error('Calendar Load Error:', error);
            container.textContent = `일정을 불러오는 중 오류가 발생했습니다. ${error.message}`;
        } finally {
            isCalendarLoading = false;
        }
    };

    const renderCalendar = (events) => {
        const container = getCalendarContainer();
        if (!container) return;

        console.log('--- [DEBUG] Starting renderCalendar with events:', events);
        clearElement(container);

        // [문제 3 해결] 라이브러리 존재 여부 검사
        if (!window.FullCalendar) {
            console.error('FullCalendar library not loaded');
            container.textContent = '캘린더 라이브러리 로드 실패. 인터넷 연결을 확인해 주세요.';
            return;
        }

        try {
            if (calendarInstance) {
                calendarInstance.destroy();
                calendarInstance = null;
            }

            calendarInstance = new FullCalendar.Calendar(container, {
                // [개선] 대화면과 모바일에 최적화된 비율과 높이
                initialView: window.innerWidth < 768 ? 'listMonth' : 'dayGridMonth',
                locale: 'ko',
                contentHeight: window.innerWidth < 768 ? 'auto' : 750, // 대화면에서 더 길게!
                aspectRatio: window.innerWidth < 768 ? 0.8 : 1.5, // 가로세로 비율 최적화
                handleWindowResize: true,
                headerToolbar: {
                    left: 'prev,next today',
                    center: 'title',
                    right: window.innerWidth < 768 ? 'listMonth' : 'dayGridMonth,timeGridWeek'
                },
                buttonText: {
                    today: '오늘',
                    month: '월간',
                    week: '주간',
                    list: '일정'
                },
                allDaySlot: true,
                // [개선] 할 일(Red)과 일반 일정(Green) 구분 렌더링
                events: (events || []).map((e) => ({
                    id: e.id,
                    title: e.title || '제목 없음',
                    start: e.start,
                    end: e.end,
                    allDay: e.allDay,
                    className: e.type === 'task' ? 'event-task' : '', // 할 일은 빨간색!
                    extendedProps: {
                        advice: e.advice || '분석 대기 중',
                        type: e.type || 'event'
                    },
                    color: e.type === 'task' ? '#ff4757' : 
                          ((e.advice || '').includes('식사') ? '#FF6B6B' : 
                           (e.advice || '').includes('업무') ? '#4D96FF' : '#6BCB77')
                })),
                eventDidMount: function(info) {
                    // 호버 시 전체 제목 및 비서 조언 표시
                    info.el.setAttribute('title', info.event.title + (info.event.extendedProps.advice ? '\n\n' + info.event.extendedProps.advice : ''));
                },
                eventClick(info) {
                    const advice = info.event.extendedProps.advice || '';
                    const label = info.event.extendedProps.type === 'task' ? '🚨 [할 일]' : '📅 [일정]';
                    alert(`${label} ${info.event.title}\n\n${advice}`);
                }
            });

            calendarInstance.render();

            // [문제 4 해결] 사이즈 업데이트
            setTimeout(() => {
                if (calendarInstance) {
                    calendarInstance.updateSize();
                }
            }, 300);

        } catch (error) {
            console.error('--- [CRITICAL] FullCalendar Initialization Failed:', error);
            container.textContent = `캘린더 초기화 실패: ${error.message}`;
        }
    };

    window.addEventListener('resize', () => {
        if (calendarInstance) {
            const newView = window.innerWidth < 768 ? 'listMonth' : 'dayGridMonth';
            if (calendarInstance.view.type !== newView) {
                calendarInstance.changeView(newView);
            }
            calendarInstance.updateSize();
        }
    });

    supabaseClient.auth.onAuthStateChange((event, session) => {
        console.log('Supabase Auth Event:', event);

        if (event === 'INITIAL_SESSION' && !session && userSession) {
            console.log('Ignoring null INITIAL_SESSION event');
            return;
        }

        updateAuthState(session);
    });

    authForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const email = emailInput.value.trim();
        const password = passwordInput.value;

        const { error } = await supabaseClient.auth.signInWithPassword({
            email,
            password
        });

        if (error) alert('로그인 실패: ' + error.message);
    });

    signupBtn.addEventListener('click', async () => {
        const email = emailInput.value.trim();
        const password = passwordInput.value;

        if (!email || !password) {
            alert('이메일과 비밀번호를 입력해주세요.');
            return;
        }

        const { error } = await supabaseClient.auth.signUp({
            email,
            password
        });

        if (error) alert('회원가입 실패: ' + error.message);
        else alert('확인 이메일을 보냈습니다. 이메일을 확인해주세요!');
    });

    googleLoginBtn.addEventListener('click', async () => {
        const { error } = await supabaseClient.auth.signInWithOAuth({
            provider: 'google',
            options: {
                redirectTo: window.location.origin,
                scopes:
                    'openid profile email https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/calendar.events',
                queryParams: {
                    access_type: 'offline',
                    prompt: 'consent'
                }
            }
        });

        if (error) alert('Google 로그인 실패: ' + error.message);
    });

    kakaoLoginBtn.addEventListener('click', async () => {
        const { error } = await supabaseClient.auth.signInWithOAuth({
            provider: 'kakao',
            options: {
                redirectTo: window.location.origin
            }
        });

        if (error) alert('Kakao 로그인 실패: ' + error.message);
    });

    logoutBtn.addEventListener('click', async () => {
        await supabaseClient.auth.signOut();
    });

    window.deleteMemo = async (id) => {
        if (!userSession) return;
        if (!confirm('이 메모를 정말 삭제할까요?')) return;

        try {
            const response = await fetch(`/api/history/${encodeURIComponent(id)}`, {
                method: 'DELETE',
                headers: {
                    Authorization: `Bearer ${userSession.access_token}`
                }
            });

            const data = await safeJson(response);

            if (!response.ok || data.error) {
                throw new Error(data.error || '삭제 실패');
            }

            window.loadHistory();
        } catch (error) {
            alert('삭제 오류: ' + error.message);
        }
    };

    window.loadHistory = async () => {
        if (!userSession) return;

        try {
            const response = await fetch('/api/history', {
                headers: {
                    Authorization: `Bearer ${userSession.access_token}`
                }
            });

            const data = await safeJson(response);

            if (!response.ok || data.error) {
                throw new Error(data.error || '히스토리 로딩 실패');
            }

            diaryHistory = data.history || [];
            renderHistory();
        } catch (error) {
            console.error('History Load Error:', error);
        }
    };

    const createHistoryCard = (item) => {
        const card = document.createElement('div');
        card.className = 'history-card';

        const header = document.createElement('div');
        header.className = 'card-header';

        const dateSpan = document.createElement('span');
        dateSpan.className = 'card-date';
        dateSpan.textContent = formatDate(item.createdAt);

        const emotionSpan = document.createElement('span');
        emotionSpan.className = 'card-emotion';
        emotionSpan.textContent = item.emotion || '분석완료';

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'btn-delete';
        deleteBtn.title = '삭제';
        deleteBtn.textContent = '×';

        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            window.deleteMemo(item.id);
        });

        header.appendChild(dateSpan);
        header.appendChild(emotionSpan);
        header.appendChild(deleteBtn);

        const body = document.createElement('div');
        body.className = 'card-body';

        const contentP = document.createElement('p');
        contentP.className = 'card-content';
        contentP.textContent = item.originalContent || '';

        const toggleDiv = document.createElement('div');
        toggleDiv.className = 'card-ai-toggle';
        toggleDiv.textContent = 'AI 분석 보기';

        const aiDiv = document.createElement('div');
        aiDiv.className = 'card-ai-response hidden';
        appendTextWithBreaks(aiDiv, item.aiResponse || '');

        body.appendChild(contentP);
        body.appendChild(toggleDiv);
        body.appendChild(aiDiv);

        toggleDiv.addEventListener('click', (e) => {
            e.stopPropagation();
            aiDiv.classList.toggle('hidden');
        });

        card.addEventListener('click', () => {
            diaryInput.value = item.originalContent || '';
            clearElement(responseText);
            appendTextWithBreaks(responseText, item.aiResponse || '');
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });

        card.appendChild(header);
        card.appendChild(body);

        return card;
    };

    const renderHistory = () => {
        if (!historyList) return;

        clearElement(historyList);

        const sorted = [...diaryHistory].sort((a, b) => {
            const timeA = new Date(a.createdAt).getTime();
            const timeB = new Date(b.createdAt).getTime();
            return currentSort === 'newest' ? timeB - timeA : timeA - timeB;
        });

        if (sorted.length === 0) {
            const empty = document.createElement('p');
            empty.className = 'empty-msg';
            empty.textContent = '아직 기록된 메모가 없습니다. 첫 메모를 작성해 보세요! ✍️';
            historyList.appendChild(empty);
            return;
        }

        const fragment = document.createDocumentFragment();
        sorted.forEach((item) => fragment.appendChild(createHistoryCard(item)));
        historyList.appendChild(fragment);
    };

    const formatDate = (dateString) => {
        const date = new Date(dateString);

        return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(
            date.getDate()
        ).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(
            date.getMinutes()
        ).padStart(2, '0')}`;
    };

    sortNewestBtn.addEventListener('click', () => {
        currentSort = 'newest';
        sortNewestBtn.classList.add('active');
        sortOldestBtn.classList.remove('active');
        renderHistory();
    });

    sortOldestBtn.addEventListener('click', () => {
        currentSort = 'oldest';
        sortOldestBtn.classList.add('active');
        sortNewestBtn.classList.remove('active');
        renderHistory();
    });

    analyzeBtn.addEventListener('click', async () => {
        const content = diaryInput.value.trim();
        if (!content) {
            alert('일기를 먼저 작성해 주세요!');
            return;
        }

        // 중복 클릭 방지 및 상태 표시
        analyzeBtn.disabled = true;
        analyzeBtn.innerHTML = '<span class="loading-spinner"></span> 분석 중...';

        // 기존 텍스트 엘리먼트 활용
        responseText.textContent = 'AI가 당신의 일기를 읽고 일정을 확인하고 있습니다...';

        try {
            const providerToken = localStorage.getItem('google_provider_token');
            const response = await fetch('/api/analyze', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${userSession?.access_token || ''}`,
                    'x-provider-token': providerToken || ''
                },
                body: JSON.stringify({ content })
            });

            const data = await safeJson(response);

            if (!response.ok) {
                throw new Error(data.error || '분석 요청에 실패했습니다.');
            }

            // AI 답변에서 감정 태그 등 제거하고 출력
            const cleanAnswer = data.answer.replace(/감정:\[.*?\]/g, '').trim();
            clearElement(responseText);
            appendTextWithBreaks(responseText, cleanAnswer);

            if (data.event) {
                showEventConfirmation(data.event);
            }

            setTimeout(window.loadHistory, 1000);
        } catch (err) {
            console.error('Analysis Error:', err);
            responseText.textContent = '죄송합니다. 오류가 발생했습니다. ' + err.message;
        } finally {
            analyzeBtn.disabled = false;
            analyzeBtn.innerHTML = 'AI 조언 받기';
        }
    });

    const showEventConfirmation = (event) => {
        const existingConfirm = document.getElementById('event-confirm-box');
        if (existingConfirm) existingConfirm.remove();

        const confirmBox = document.createElement('div');
        confirmBox.id = 'event-confirm-box';
        confirmBox.className = 'confirm-box';

        const contentBox = document.createElement('div');
        contentBox.className = 'confirm-content';

        const titleP = document.createElement('p');
        titleP.appendChild(document.createTextNode('📅 '));

        const strong = document.createElement('strong');
        strong.textContent = `"${event.summary || '일정'}"`;
        titleP.appendChild(strong);
        titleP.appendChild(document.createTextNode(' 일정을 감지했습니다.'));

        const timeP = document.createElement('p');
        timeP.className = 'time-info';

        const startTime = new Date(event.start).toLocaleString('ko-KR', {
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });

        timeP.textContent = `${startTime}에 캘린더에 기록할까요?`;

        const btnBox = document.createElement('div');
        btnBox.className = 'confirm-btns';

        const yesBtn = document.createElement('button');
        yesBtn.id = 'event-yes';
        yesBtn.className = 'btn primary sm';
        yesBtn.textContent = '네, 기록해줘요';

        const noBtn = document.createElement('button');
        noBtn.id = 'event-no';
        noBtn.className = 'btn secondary sm';
        noBtn.textContent = '아니요, 괜찮아요';

        btnBox.appendChild(yesBtn);
        btnBox.appendChild(noBtn);

        contentBox.appendChild(titleP);
        contentBox.appendChild(timeP);
        contentBox.appendChild(btnBox);
        confirmBox.appendChild(contentBox);
        responseBox.appendChild(confirmBox);

        yesBtn.addEventListener('click', async () => {
            const providerToken = getProviderToken();

            if (!providerToken) {
                alert('구글 권한이 필요합니다.');
                return;
            }

            yesBtn.disabled = true;
            yesBtn.textContent = '기록 중...';

            try {
                const res = await fetch('/api/calendar/add', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${userSession.access_token}`,
                        'x-provider-token': providerToken
                    },
                    body: JSON.stringify(event)
                });

                const result = await safeJson(res);

                if (!res.ok || result.error) {
                    throw new Error(result.error || '일정 등록 실패');
                }

                confirmBox.textContent = '✅ 캘린더에 일정이 등록되었습니다!';
                setTimeout(() => confirmBox.remove(), 2000);
            } catch (error) {
                alert('일정 등록 실패: ' + error.message);
                yesBtn.disabled = false;
                yesBtn.textContent = '네, 기록해줘요';
            }
        });

        noBtn.addEventListener('click', () => {
            confirmBox.remove();
        });
    };

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    let recognition = null;
    let isRecording = false;

    if (SpeechRecognition) {
        recognition = new SpeechRecognition();
        recognition.lang = 'ko-KR';
        recognition.continuous = true;
        recognition.interimResults = true;

        let initialText = '';

        recognition.onstart = () => {
            isRecording = true;
            initialText = diaryInput.value + (diaryInput.value ? ' ' : '');
            voiceBtn.innerHTML = '<span class="icon">🛑</span> 녹음 중지하기';
            voiceBtn.classList.add('recording');
        };

        recognition.onresult = (event) => {
            let finalTranscript = '';
            let interimTranscript = '';

            for (let i = event.resultIndex; i < event.results.length; i++) {
                if (event.results[i].isFinal) {
                    finalTranscript += event.results[i][0].transcript;
                } else {
                    interimTranscript += event.results[i][0].transcript;
                }
            }

            diaryInput.value = initialText + finalTranscript + interimTranscript;
        };

        recognition.onerror = (event) => {
            console.error('Speech Recognition Error:', event.error);
        };

        recognition.onend = () => {
            isRecording = false;
            voiceBtn.innerHTML = '<span class="icon">🎙️</span> 음성으로 입력하기';
            voiceBtn.classList.remove('recording');
        };
    }

    voiceBtn.addEventListener('click', () => {
        if (!recognition) {
            alert('음성 인식을 지원하지 않는 브라우저입니다.');
            return;
        }

        if (isRecording) recognition.stop();
        else recognition.start();
    });

    const loadBriefing = async () => {
        const briefingCard = document.getElementById('briefing-card');
        const briefingContent = document.getElementById('briefing-content');
        if (!briefingCard || !briefingContent) return;

        briefingCard.classList.remove('hidden');
        briefingContent.textContent = '비서가 밤새 작성한 브리핑을 가져오고 있습니다...';

        try {
            const response = await fetch('/api/briefing', {
                headers: {
                    'Authorization': `Bearer ${userSession?.access_token || ''}`,
                    'x-provider-token': getProviderToken() || ''
                }
            });
            const data = await safeJson(response);
            if (data.success) {
                briefingContent.textContent = data.briefing;
            } else {
                console.warn('Briefing failed, hiding card.');
                briefingCard.classList.add('hidden');
            }
        } catch (error) {
            console.error('Briefing Load Error:', error);
            briefingCard.classList.add('hidden');
        }
    };

    // [설정 기능] 설정 저장 버튼 클릭 이벤트
    const saveSettingsBtn = document.getElementById('save-settings-btn');
    if (saveSettingsBtn) {
        saveSettingsBtn.addEventListener('click', async () => {
            const settings = getAlarmSettings();
            localStorage.setItem('secretary_settings', JSON.stringify(settings));
            
            // 서비스 워커를 통해 서버에 최신 설정 업데이트
            const reg = await navigator.serviceWorker.ready;
            await subscribeToPush(reg);
            
            alert('비서 설정이 저장되었습니다. 선택하신 시간에 맞춰 알람을 드릴게요! 🎩');
        });
    }

    // [설정 기능] 저장된 설정 불러오기
    const loadSettings = () => {
        const saved = localStorage.getItem('secretary_settings');
        if (saved) {
            const settings = JSON.parse(saved);
            if (document.getElementById('alarm-60')) document.getElementById('alarm-60').checked = settings.alarm60;
            if (document.getElementById('alarm-30')) document.getElementById('alarm-30').checked = settings.alarm30;
            if (document.getElementById('alarm-10')) document.getElementById('alarm-10').checked = settings.alarm10;
        }
    };

    loadSettings();

    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');

    tabBtns.forEach((btn) => {
        btn.addEventListener('click', () => {
            const targetTab = btn.getAttribute('data-tab');
            console.log('Tab Switched to:', targetTab);

            tabBtns.forEach((b) => b.classList.remove('active'));
            tabContents.forEach((c) => c.classList.remove('active'));

            btn.classList.add('active');

            const targetView = document.getElementById(`${targetTab}-view`);
            if (targetView) targetView.classList.add('active');

            if (targetTab === 'calendar') {
                // 이미 캘린더가 렌더링되어 있다면 추가 서버 요청 방지 (할당량 극강의 보호)
                if (calendarInstance) {
                    console.log('--- [DEBUG] Calendar already rendered, skipping fetch.');
                    setTimeout(() => calendarInstance.updateSize(), 100);
                } else {
                    setTimeout(loadCalendar, 300);
                }
            }

            if (targetTab === 'chat') {
                loadMessages();
            }
        });
    });
});