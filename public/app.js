import { store, API_URL, initState, assertIds, updateSettings } from './modules/state.js?v=5.2.0';

import { setupNotebooksAndPages, loadNotebooks } from './modules/notebook.js?v=5.2.0';
import { setupEditor } from './modules/editor.js?v=5.2.0';
import { loadCalendar } from './modules/calendar.js?v=5.2.0';
import { setupChatUI, setupChatAssistant, checkFriendSos } from './modules/chat.js?v=5.2.0';
import { setupPersonaUI, loadPersona, loadBriefing } from './modules/persona.js?v=5.2.0';
import { initCareMode, populateGuardianSelect, applyCareSettingsToUI } from './modules/care.js?v=5.2.0';

console.log('App.js is loading as a modern ES Module...');
window.loadNotebooks = loadNotebooks;

/* ==========================================================================
   [IN-APP BROWSER DETECTION & OUTLINK]
   ========================================================================== */
function detectAndHandleInAppBrowser() {
    const userAgent = navigator.userAgent || navigator.vendor || window.opera;
    const isKakao = /kakaotalk/i.test(userAgent);
    const isInstagram = /instagram/i.test(userAgent);
    const isFacebook = /fban|fbav/i.test(userAgent);
    const isLine = /line/i.test(userAgent);
    // Remove loose /inapp|webview/i check as it causes false positives on general mobile browsers
    const isInApp = isKakao || isInstagram || isFacebook || isLine;

    if (isInApp) {
        console.log('--- [DETECT] In-App Browser Environment Detected! ---');

        // Auto-redirect KakaoTalk
        if (isKakao) {
            const externalUrl = "kakaotalk://web/openExternal?url=" + encodeURIComponent(window.location.href);
            window.location.href = externalUrl;
        }

        // Auto-redirect LINE
        if (isLine && !window.location.search.includes('openExternalBrowser=1')) {
            const url = new URL(window.location.href);
            url.searchParams.set('openExternalBrowser', '1');
            window.location.href = url.toString();
        }

        // Show the beautiful glassmorphic overlay
        const overlay = document.getElementById('inapp-browser-overlay');
        if (overlay) {
            overlay.classList.remove('hidden');

            const btnOpenExternal = document.getElementById('btn-inapp-open-external');
            const btnCopyLink = document.getElementById('btn-inapp-copy-link');
            const btnClose = document.getElementById('btn-inapp-close');

            btnOpenExternal?.addEventListener('click', () => {
                if (isKakao) {
                    window.location.href = "kakaotalk://web/openExternal?url=" + encodeURIComponent(window.location.href);
                } else {
                    // Try general android intent redirect or fallback to copying link
                    const isAndroid = /android/i.test(userAgent);
                    if (isAndroid) {
                        const urlWithoutScheme = window.location.href.replace(/^https?:\/\//, '');
                        window.location.href = `intent://${urlWithoutScheme}#Intent;scheme=https;package=com.android.chrome;end`;
                    } else {
                        // iOS fallback: copy link
                        copyToClipboard(window.location.href);
                        alert('링크가 복사되었습니다. Safari나 Chrome 브라우저에 붙여넣어 주세요!');
                    }
                }
            });

            btnCopyLink?.addEventListener('click', () => {
                copyToClipboard(window.location.href);
                alert('링크가 성공적으로 복사되었습니다. 브라우저 주소창에 붙여넣어 주세요!');
            });

            btnClose?.addEventListener('click', () => {
                overlay.classList.add('hidden');
            });
        }
    }
}

function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text);
    } else {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        try {
            document.execCommand('copy');
        } catch (err) {
            console.error('Failed to copy', err);
        }
        document.body.removeChild(textarea);
    }
}

/* ==========================================================================
   [INITIALIZATION]
   ========================================================================== */
document.addEventListener('DOMContentLoaded', async () => {
    console.log('--- [INIT] Feeling Journal Application Started ---');

    // 1단계: 글로벌 상태 및 세션/설정 데이터를 최우선적으로 서버에서 fetch
    await initState();

    // Run in-app browser environment handler
    detectAndHandleInAppBrowser();

    // Check for invite code in query parameters and store it immediately
    const urlParams = new URLSearchParams(window.location.search);
    
    // Check for auth error in query parameters
    const errorMsgQuery = urlParams.get('error_description') || urlParams.get('error');
    if (errorMsgQuery) {
        alert('로그인 실패: ' + decodeURIComponent(errorMsgQuery.replace(/\+/g, ' ')));
        const newUrl = window.location.origin + window.location.pathname;
        window.history.replaceState({}, document.title, newUrl);
    }

    // Check for auth error in URL hash
    if (window.location.hash) {
        const hashParams = new URLSearchParams(window.location.hash.substring(1));
        const errorMsgHash = hashParams.get('error_description') || hashParams.get('error');
        if (errorMsgHash) {
            alert('로그인 실패: ' + decodeURIComponent(errorMsgHash.replace(/\+/g, ' ')));
            const newUrl = window.location.origin + window.location.pathname;
            window.history.replaceState({}, document.title, newUrl);
        }
    }

    const inviteCode = urlParams.get('invite_code');
    if (inviteCode) {
        try {
            localStorage.setItem('pending_invite_code', inviteCode);
        } catch (storageErr) {
            console.warn('Failed to save pending invite code:', storageErr);
        }
        // Clear the query parameter from URL to keep it clean
        const newUrl = window.location.origin + window.location.pathname;
        window.history.replaceState({}, document.title, newUrl);
        console.log(`--- [INVITE] Stored pending invite code: ${inviteCode} ---`);
    }

    // Initialize all modular subsystems
    setupTabs();
    setupAuth();
    setupNotebooksAndPages();
    setupEditor();
    setupChatUI();
    setupChatAssistant();
    setupPersonaUI();
    setupSettingsUI();
    initCareMode();

    // Check initial user session
    const { data: { session } } = await store.supabaseClient.auth.getSession();
    if (session) {
        onUserAuthenticated(session);
    } else {
        showAuthUI();
    }

    // 실시간 음성 일기 저장 시 리스트 자동 갱신 리스너 등록
    window.addEventListener('diary-saved', async () => {
        console.log('--- [SILVER] Spoken diary saved, refreshing notebook pages...');
        await loadNotebooks();
    });
});

/* ==========================================================================
   [AUTHENTICATION & SESSION]
   ========================================================================== */
function setupAuth() {
    assertIds('Auth', ['email', 'password', 'google-login-btn', 'kakao-login-btn', 'logout-btn', 'user-email']);

    const loginBtn = document.getElementById('login-btn');
    const signupBtn = document.getElementById('signup-btn');
    const googleBtn = document.getElementById('google-login-btn');
    const kakaoBtn = document.getElementById('kakao-login-btn');
    const logoutBtn = document.getElementById('logout-btn');

    loginBtn?.addEventListener('click', async (e) => {
        e.preventDefault();
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;
        const { data, error } = await store.supabaseClient.auth.signInWithPassword({ email, password });
        if (error) alert('로그인 실패: ' + error.message);
    });

    signupBtn?.addEventListener('click', async (e) => {
        e.preventDefault();
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;
        const { data, error } = await store.supabaseClient.auth.signUp({ email, password });
        if (error) alert('회원가입 실패: ' + error.message);
        else alert('인증 이메일을 확인해 주세요!');
    });

    googleBtn?.addEventListener('click', async () => {
        const { data, error } = await store.supabaseClient.auth.signInWithOAuth({
            provider: 'google',
            options: {
                redirectTo: window.location.origin,
                scopes: 'https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/contacts.readonly',
                queryParams: {
                    access_type: 'offline',
                    prompt: 'consent',
                }
            }
        });
        if (error) alert('구글 로그인 실패: ' + error.message);
    });


    kakaoBtn?.addEventListener('click', () => {
        window.location.href = `${API_URL}/auth/kakao`;
    });

    logoutBtn?.addEventListener('click', async () => {
        await store.supabaseClient.auth.signOut();
        window.location.reload();
    });

    // Soft input icon focus effect
    const emailInput = document.getElementById('email');
    const passwordInput = document.getElementById('password');
    [emailInput, passwordInput].forEach(input => {
        input?.addEventListener('focus', () => {
            const icon = input.parentElement.querySelector('.material-symbols-outlined');
            if (icon) {
                icon.style.color = '#d4a373';
                icon.style.transform = 'translateY(-50%) scale(1.1)';
            }
        });
        input?.addEventListener('blur', () => {
            const icon = input.parentElement.querySelector('.material-symbols-outlined');
            if (icon) {
                icon.style.color = '#a98467';
                icon.style.transform = 'translateY(-50%) scale(1)';
            }
        });
    });

    store.supabaseClient.auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_IN' && session) {
            onUserAuthenticated(session);
        } else if (event === 'SIGNED_OUT') {
            showAuthUI();
        }
    });
}

let isAppInitialized = false;

async function onUserAuthenticated(session) {
    store.currentUser = session.user;
    document.body.classList.remove('auth-mode');
    document.getElementById('auth-container').style.display = 'none';
    document.getElementById('journal-app').style.display = 'block';

    if (isAppInitialized) return;
    isAppInitialized = true;

    const emailEl = document.getElementById('user-email');
    if (emailEl) emailEl.innerText = session.user.email;

    const activeProviderToken = session.provider_token || localStorage.getItem('google_provider_token');
    const activeRefreshToken = session.provider_refresh_token || localStorage.getItem('google_provider_refresh_token');

    if (activeProviderToken && activeProviderToken !== 'null' && activeProviderToken !== 'undefined') {
        try {
            if (session.provider_token) {
                localStorage.setItem('google_provider_token', session.provider_token);
            }
            if (session.provider_refresh_token) {
                localStorage.setItem('google_provider_refresh_token', session.provider_refresh_token);
            }
        } catch (storageErr) {
            console.warn('Failed to save google provider tokens to localStorage:', storageErr);
        }

        const headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
            'x-provider-token': activeProviderToken
        };

        if (activeRefreshToken && activeRefreshToken !== 'null' && activeRefreshToken !== 'undefined') {
            headers['x-provider-refresh-token'] = activeRefreshToken;
        }

        // Sync provider token to Redis
        fetch(`${API_URL}/subscribe`, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({
                settings: { providerTokenOnly: true }
            })
        }).catch(err => console.error('Failed to sync provider token to Redis:', err));
    }


    // Check/Prompt Nickname
    await checkNickname();

    // Check for pending invite code in localStorage
    const pendingInvite = localStorage.getItem('pending_invite_code');
    if (pendingInvite) {
        console.log(`--- [INVITE] Processing stored invitation code: ${pendingInvite} ---`);
        fetch(`${API_URL}/friends/accept-invite`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${session.access_token}`
            },
            body: JSON.stringify({ inviterId: pendingInvite })
        })
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    alert(`🎉 1촌 초대를 성공적으로 수락하여 실시간 연결되었습니다!`);
                    checkFriendSos();
                }
                localStorage.removeItem('pending_invite_code');
            })
            .catch(err => {
                console.error('Failed to accept invite:', err);
                localStorage.removeItem('pending_invite_code');
            });
    }

    // Load Data
    await populateGuardianSelect(); // 1촌 보호자 목록 가져오기 선행
    await loadNotebooks();
    checkFriendSos();
    await loadUserProfileInSettings();

    // Start background loops
    sendPresenceHeartbeat();
    setInterval(sendPresenceHeartbeat, 15000);
    setInterval(checkFriendSos, 30000);

    setTimeout(() => {
        loadBriefing();
        loadPersona();
        loadSettings();
    }, 1000);
}

async function sendPresenceHeartbeat() {
    try {
        const token = await store.getSessionToken();
        if (!token) return;
        await fetch(`${API_URL}/presence/heartbeat`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
        });
    } catch (e) {
        console.error('Failed to send presence heartbeat:', e);
    }
}

function showAuthUI() {
    isAppInitialized = false;
    document.body.classList.add('auth-mode');
    document.getElementById('auth-container').style.display = 'flex';
    document.getElementById('journal-app').style.display = 'none';
}

async function checkNickname() {
    try {
        const token = await store.getSessionToken();
        if (!token) return;

        const res = await fetch(`${API_URL}/nickname`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();

        if (data.success && !data.nickname) {
            const nickname = prompt('반갑습니다! 당신의 수석 비서가 당신을 어떻게 부르면 좋을까요? (호칭 입력)');
            if (nickname) {
                await fetch(`${API_URL}/nickname`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({ nickname })
                });
                alert(`${nickname}님, 환영합니다. 당신의 하루를 책임지겠습니다.`);
            }
        }
    } catch (e) {
        console.warn('Failed to check or set nickname:', e);
    }
}

/* ==========================================================================
   [TABS & NAVIGATION]
   ========================================================================== */
function setupTabs() {
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');

    const activeClasses = ['bg-primary-container', 'text-on-primary-container', 'rounded-xl', 'py-1.5'];
    const inactiveClasses = ['text-on-surface-variant', 'hover:text-primary', 'p-2'];

    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const tabId = btn.dataset.tab;

            tabBtns.forEach(b => {
                b.classList.remove('active');
                b.classList.remove(...activeClasses);
                b.classList.add(...inactiveClasses);
                
                // Remove FILL 1 from icon
                const icon = b.querySelector('.material-symbols-outlined');
                if(icon) icon.style.fontVariationSettings = "'FILL' 0";
            });

            tabContents.forEach(c => {
                c.classList.remove('active');
                c.style.display = 'none';
            });

            btn.classList.add('active');
            btn.classList.remove(...inactiveClasses);
            btn.classList.add(...activeClasses);
            
            // Add FILL 1 to icon
            const icon = btn.querySelector('.material-symbols-outlined');
            if(icon) icon.style.fontVariationSettings = "'FILL' 1";

            const target = document.getElementById(`${tabId}-view`);
            if (target) {
                target.classList.add('active');
                target.style.display = tabId === 'journal' ? 'flex' : 'block';

                if (tabId === 'calendar') loadCalendar();
                else if (tabId === 'chat') {
                    // Chat module default summon trigger
                    import('./modules/chat.js?v=5.2.0').then(chatMod => {
                        chatMod.initializeChat();
                    });
                }
                else if (tabId === 'persona') loadPersona();
            }
        });
    });
}

/* ==========================================================================
   [SETTINGS & ALARMS]
   ========================================================================== */
const CITIES_COORDS = [
    { name: '서울', lat: 37.5665, lon: 126.9780 },
    { name: '인천', lat: 37.4563, lon: 126.7052 },
    { name: '수원', lat: 37.2636, lon: 127.0286 },
    { name: '춘천', lat: 37.8813, lon: 127.7298 },
    { name: '대전', lat: 36.3504, lon: 127.3845 },
    { name: '청주', lat: 36.6424, lon: 127.4890 },
    { name: '광주', lat: 35.1595, lon: 126.8526 },
    { name: '전주', lat: 35.8242, lon: 127.1480 },
    { name: '대구', lat: 35.8714, lon: 128.6014 },
    { name: '부산', lat: 35.1796, lon: 129.0756 },
    { name: '울산', lat: 35.5389, lon: 129.3114 },
    { name: '제주', lat: 33.4996, lon: 126.5312 }
];

function findClosestCity(lat, lon) {
    let closestCity = '서울';
    let minDistance = Infinity;
    for (const city of CITIES_COORDS) {
        const dLat = lat - city.lat;
        const dLon = lon - city.lon;
        const dist = Math.sqrt(dLat * dLat + dLon * dLon);
        if (dist < minDistance) {
            minDistance = dist;
            closestCity = city.name;
        }
    }
    return closestCity;
}

function setupSettingsUI() {
    console.log('--- [UI] Settings (Notification) UI Setup ---');
    setupUserProfileUpload();
    setupGoogleCalendarConnect();
    const saveBtn = document.getElementById('save-settings-btn');
    if (!saveBtn) return;

    saveBtn.addEventListener('click', async () => {
        saveBtn.disabled = true;
        saveBtn.innerText = '저장 중...';

        const weatherOff = document.getElementById('weather-off')?.checked;
        const briefingTime = document.getElementById('briefing-time-input')?.value || '08:00';

        const config = {
            alarm60: document.getElementById('alarm-60')?.checked || false,
            alarm30: document.getElementById('alarm-30')?.checked || false,
            alarm10: document.getElementById('alarm-10')?.checked || false,
            briefingTime
        };

        const newsCheckboxes = document.querySelectorAll('input[name="news-category"]:checked');
        const newsCategories = Array.from(newsCheckboxes).map(cb => cb.value);
        if (newsCategories.length === 0) newsCategories.push('business'); // Fallback if none selected
        config.newsCategories = newsCategories;

        const executeSave = async (regionValue) => {
            try {
                // state.js의 updateSettings 헬퍼를 사용하여 기존 care 설정을 해치지 않고 deep merge 저장
                await updateSettings({
                    alarm: {
                        alarm60: config.alarm60,
                        alarm30: config.alarm30,
                        alarm10: config.alarm10,
                        briefingTime: config.briefingTime
                    },
                    weatherRegion: regionValue,
                    newsCategories: config.newsCategories
                });

                let msg = '설정 정보가 성공적으로 저장되었습니다.';
                if (regionValue !== 'off') {
                    msg += `\n📍 위치 기반 기상 관측소: ${regionValue}`;
                } else {
                    msg += '\n🔇 기상 예보 안내가 비활성화되었습니다.';
                }
                alert(msg);
            } catch (err) {
                console.error(err);
                alert('설정 저장 중 서버 통신 오류가 발생했습니다.');
            } finally {
                saveBtn.disabled = false;
                saveBtn.innerText = '설정 저장';
            }
        };

        if (weatherOff) {
            await executeSave('off');
        } else {
            if (navigator.geolocation) {
                navigator.geolocation.getCurrentPosition(
                    async (position) => {
                        const lat = position.coords.latitude;
                        const lon = position.coords.longitude;
                        const closest = findClosestCity(lat, lon);
                        await executeSave(closest);
                    },
                    async (error) => {
                        console.warn('Geolocation permission denied or error. Fallback to Seoul.', error);
                        alert('위치 정보 획득 실패 혹은 권한이 거부되어, 기본 기상 관측소(서울)로 설정 저장합니다.');
                        await executeSave('서울');
                    },
                    { enableHighAccuracy: true, timeout: 5000 }
                );
            } else {
                console.warn('Geolocation not supported. Fallback to Seoul.');
                await executeSave('서울');
            }
        }
    });
}

async function loadSettings() {
    console.log('--- [UI] Loading Push & Briefing Settings ---');
    try {
        const token = await store.getSessionToken();
        if (!token) return;

        const res = await fetch(`${API_URL}/subscribe`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        if (data.success && data.config && data.config.settings) {
            const s = data.config.settings;

            const a60 = document.getElementById('alarm-60');
            const a30 = document.getElementById('alarm-30');
            const a10 = document.getElementById('alarm-10');
            if (a60) a60.checked = !!s.alarm60;
            if (a30) a30.checked = !!s.alarm30;
            if (a10) a10.checked = !!s.alarm10;

            const timeInput = document.getElementById('briefing-time-input');
            if (timeInput && s.briefingTime) timeInput.value = s.briefingTime;

            const weatherOn = document.getElementById('weather-on');
            const weatherOff = document.getElementById('weather-off');
            if (s.weatherRegion === 'off') {
                if (weatherOff) weatherOff.checked = true;
            } else {
                if (weatherOn) weatherOn.checked = true;
            }

            if (s.newsCategories && Array.isArray(s.newsCategories)) {
                document.querySelectorAll('input[name="news-category"]').forEach(cb => {
                    cb.checked = s.newsCategories.includes(cb.value);
                });
            }

            // 안심 케어 모드 설정 UI 반영
            applyCareSettingsToUI(s);
        }
    } catch (e) {
        console.error('Failed to load settings:', e);
    }
}

window.loadUserProfileInSettings = loadUserProfileInSettings;
async function loadUserProfileInSettings() {
    const avatarImg = document.getElementById('user-profile-avatar');
    const nameEl = document.getElementById('user-profile-name');
    const emailEl = document.getElementById('user-email');
    
    if (!store.currentUser) return;
    
    if (emailEl) emailEl.innerText = store.currentUser.email;
    
    // Set avatar
    const myAvatarUrl = store.currentUser?.user_metadata?.avatar_url;
    if (avatarImg && myAvatarUrl) {
        avatarImg.src = `${myAvatarUrl}?t=${Date.now()}`;
    }
    
    // Set nickname
    try {
        const token = await store.getSessionToken();
        if (token) {
            const res = await fetch(`${API_URL}/nickname`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            if (data.success && data.nickname) {
                if (nameEl) nameEl.innerText = data.nickname;
            } else {
                if (nameEl) nameEl.innerText = store.currentUser.email.split('@')[0];
            }
        }
    } catch (e) {
        if (nameEl) nameEl.innerText = store.currentUser.email.split('@')[0];
    }
    
    // Check Google Calendar connection status
    await checkGoogleCalendarStatus();
}

function setupUserProfileUpload() {
    const avatarImg = document.getElementById('user-profile-avatar');
    const editBtn = document.getElementById('user-profile-avatar-btn');
    const fileInput = document.getElementById('user-avatar-upload-input');
    
    if (!avatarImg || !fileInput) return;
    
    const triggerUpload = () => fileInput.click();
    avatarImg.addEventListener('click', triggerUpload);
    if (editBtn) editBtn.addEventListener('click', triggerUpload);
    
    fileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        if (editBtn) {
            editBtn.disabled = true;
            editBtn.innerHTML = '<span class="material-symbols-outlined text-sm animate-spin">sync</span>';
        }
        
        try {
            const filePath = `${store.currentUser.id}/avatar.png`;
            
            // Supabase Storage 'avatars' 버킷에 업로드
            const { data, error } = await store.supabaseClient.storage
                .from('avatars')
                .upload(filePath, file, { cacheControl: '0', upsert: true });
                
            if (error) throw error;
            
            const { data: urlData } = store.supabaseClient.storage
                .from('avatars')
                .getPublicUrl(filePath);
                
            const publicUrl = urlData.publicUrl;
            
            // Supabase Auth 사용자 메타데이터에 저장
            const { error: authError } = await store.supabaseClient.auth.updateUser({
                data: { avatar_url: publicUrl }
            });
            
            if (authError) throw authError;
            
            // profiles 테이블 동기화
            await store.supabaseClient
                .from('profiles')
                .update({ avatar_url: publicUrl })
                .eq('id', store.currentUser.id);
                
            alert('✨ 프로필 사진이 성공적으로 변경되었습니다!');
            
            // UI 업데이트
            avatarImg.src = `${publicUrl}?t=${Date.now()}`;
        } catch (err) {
            console.error('Profile photo upload error:', err);
            alert('프로필 사진 변경 중 오류가 발생했습니다: ' + err.message);
        } finally {
            if (editBtn) {
                editBtn.disabled = false;
                editBtn.innerHTML = '<span class="material-symbols-outlined text-sm">edit</span>';
            }
            fileInput.value = '';
        }
    });
}

window.checkGoogleCalendarStatus = checkGoogleCalendarStatus;
async function checkGoogleCalendarStatus() {
    const statusText = document.getElementById('google-cal-status-text');
    const connectBtn = document.getElementById('settings-google-connect-btn');
    if (!statusText || !connectBtn) return;
    
    try {
        const token = await store.getSessionToken();
        const providerToken = await store.getProviderToken();
        if (!token) {
            statusText.innerText = '로그인이 필요합니다.';
            return;
        }
        
        const res = await fetch(`${API_URL}/calendar`, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'x-provider-token': providerToken || ''
            }
        });
        const data = await res.json();
        
        if (data.success) {
            if (data.unlinked) {
                statusText.innerText = '연결되어 있지 않습니다.';
                statusText.className = 'font-label-sm text-xs text-outline';
                connectBtn.innerText = '연결하기';
                connectBtn.className = 'px-5 py-2 bg-primary text-on-primary rounded-full font-label-md text-xs hover:opacity-90 active:scale-95 transition-all shadow-sm';
            } else {
                statusText.innerText = '정상적으로 연동되었습니다.';
                statusText.className = 'font-label-sm text-xs text-[#10ac84] font-semibold';
                connectBtn.innerText = '연결 해제';
                connectBtn.className = 'px-5 py-2 bg-surface-container-highest text-error border border-outline-variant/30 rounded-full font-label-md text-xs hover:opacity-90 active:scale-95 transition-all shadow-sm';
            }
        }
    } catch (err) {
        console.error('Failed to check Google Calendar status:', err);
        statusText.innerText = '상태 확인 중 오류가 발생했습니다.';
    }
}

function setupGoogleCalendarConnect() {
    const connectBtn = document.getElementById('settings-google-connect-btn');
    if (!connectBtn) return;
    
    connectBtn.addEventListener('click', async () => {
        const isConnected = connectBtn.innerText === '연결 해제';
        
        if (isConnected) {
            if (!confirm('정말로 Google 캘린더 연동을 해제하시겠습니까?')) return;
            
            connectBtn.disabled = true;
            connectBtn.innerText = '해제 중...';
            try {
                const token = await store.getSessionToken();
                const res = await fetch(`${API_URL}/auth/unlink-google`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                const data = await res.json();
                if (data.success) {
                    alert('Google 캘린더 연동이 성공적으로 해제되었습니다.');
                    await checkGoogleCalendarStatus();
                    if (window.loadCalendar) await window.loadCalendar();
                } else {
                    alert('연동 해제에 실패했습니다: ' + (data.error || '알 수 없는 오류'));
                }
            } catch (err) {
                console.error(err);
                alert('연동 해제 중 오류가 발생했습니다.');
            } finally {
                connectBtn.disabled = false;
            }
        } else {
            // Connect
            connectBtn.disabled = true;
            connectBtn.innerText = '연결 중...';
            try {
                const { error } = await store.supabaseClient.auth.linkIdentity({
                    provider: 'google',
                    options: {
                        redirectTo: window.location.origin,
                        scopes: 'https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/contacts.readonly',
                        queryParams: {
                            access_type: 'offline',
                            prompt: 'consent'
                        }
                    }
                });
                if (error) throw error;
            } catch (err) {
                alert('구글 로그인 실패: ' + err.message);
                connectBtn.disabled = false;
                connectBtn.innerText = '연결하기';
            }
        }
    });
}