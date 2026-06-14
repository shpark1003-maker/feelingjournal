// 1. Supabase 접속 클라이언트 정보 및 API 엔드포인트
export const SUPABASE_BASE_URL = 'https://gfvfilwigbwycnobvnuv.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdmdmZpbHdpZ2J3eWNub2J2bnV2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgzNDIwNzUsImV4cCI6MjA5MzkxODA3NX0.dxvyeqt9tFizpraFDAcp1B3MfV-IGVdsqwAG6A_Ffa8';
export const API_URL = '/api';

// 2. 글로벌 공유 상태 저장소
export const store = {
    supabaseClient: supabase.createClient(SUPABASE_BASE_URL, SUPABASE_ANON_KEY),
    quillEditor: null,
    currentNotebookId: 'nb-1',
    currentPageId: null,
    currentRoomId: null,
    chatChannel: null,
    isAnalysisRunning: false,
    currentUser: null,
    currentAvatarUrl: null,
    activeChatWindows: {}, // Key: roomId, Value: { title, isMinimized, x, y, zIndex }
    settings: {
        alarm: {
            briefingTime: '08:00',
            alarm60: false,
            alarm30: false,
            alarm10: false
        },
        care: {
            enabled: false,
            guardianEmail: '',
            guardianName: ''
        },
        weatherRegion: '서울',
        newsCategories: ['business'],
        aiConsent: null
    },
    
    // 3. 상태 취득/변경용 간결한 도우미 API
    async getSessionToken() {
        const { data: { session } } = await this.supabaseClient.auth.getSession();
        return session ? session.access_token : null;
    }
};

window.store = store;

// 4. Deep Merge 헬퍼 함수
export function deepMerge(target, source) {
    const output = { ...target };
    for (const key of Object.keys(source || {})) {
        if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
            output[key] = deepMerge(output[key] || {}, source[key]);
        } else {
            output[key] = source[key];
        }
    }
    return output;
}

// 5. 초기화 함수 - 서버로부터 기존 설정을 로딩
export async function initState() {
    try {
        const token = await store.getSessionToken();
        if (!token) return;

        const res = await fetch(`${API_URL}/subscribe`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        if (data.success && data.config && data.config.settings) {
            // 서버에 저장된 단층 settings 구조를 V2 중첩 settings 구조로 안전하게 매핑/머지
            const s = data.config.settings;
            const normalizedSettings = {
                alarm: {
                    briefingTime: s.briefingTime || '08:00',
                    alarm60: !!s.alarm60,
                    alarm30: !!s.alarm30,
                    alarm10: !!s.alarm10
                },
                care: {
                    enabled: !!s.careModeEnabled,
                    guardianEmail: s.careGuardianEmail || '',
                    guardianName: s.careGuardianName || ''
                },
                weatherRegion: s.weatherRegion || '서울',
                newsCategories: s.newsCategories || ['business'],
                aiConsent: s.aiConsent !== undefined ? s.aiConsent : null
            };
            store.settings = deepMerge(store.settings, normalizedSettings);
            console.log('--- [STATE] Successfully loaded and normalized settings ---', store.settings);
        }
    } catch (e) {
        console.warn('--- [STATE] Failed to initialize settings from server, using default ---', e);
    }
}

import { registerDailyBriefingPush } from './pushClient.js?v=5.5.3';

// 6. 설정 업데이트 및 Rollback 트랜잭션 함수
export async function updateSettings(newSettings) {
    const prevSettings = typeof structuredClone === 'function'
        ? structuredClone(store.settings)
        : JSON.parse(JSON.stringify(store.settings));

    store.settings = deepMerge(store.settings, newSettings);

    try {
        const token = await store.getSessionToken();
        if (!token) throw new Error('No user session token found');

        // 푸시 토큰 등록 시도 (VAPID 키 조회 후 권한 요청 및 SW 구독 생성)
        let subscription = null;
        try {
            const getRes = await fetch(`${API_URL}/subscribe`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const getData = await getRes.json();
            if (getData.success && getData.pushEnabled && getData.vapidPublicKey) {
                // 사용자가 알림 권한을 승인한 경우 실제 구독 객체를 반환받고, 거부하거나 오류 시 null을 반환
                subscription = await registerDailyBriefingPush(getData.vapidPublicKey);
            }
        } catch (pushErr) {
            console.warn('[STATE] Push subscription registration bypassed:', pushErr.message);
        }

        // 서버 전송을 위해 중첩 settings 객체를 백엔드가 수용 가능한 단층 구조로 평탄화(Flatten)
        const flatSettings = {
            alarm60: store.settings.alarm.alarm60,
            alarm30: store.settings.alarm.alarm30,
            alarm10: store.settings.alarm.alarm10,
            briefingTime: store.settings.alarm.briefingTime,
            weatherRegion: store.settings.weatherRegion,
            newsCategories: store.settings.newsCategories,
            careModeEnabled: store.settings.care.enabled,
            careGuardianEmail: store.settings.care.guardianEmail,
            careGuardianName: store.settings.care.guardianName,
            aiConsent: store.settings.aiConsent
        };

        const res = await fetch(`${API_URL}/subscribe`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                subscription, // 생성된 실제 구독 객체 (권한 거부 시 null)
                settings: flatSettings
            })
        });

        const data = await res.json();

        if (!data.success) {
            throw new Error(data.error || 'Server rejected settings update');
        }
        console.log('--- [STATE] Settings successfully updated and saved ---');
    } catch (e) {
        console.error('--- [STATE] Failed to save settings. Rolling back status ---', e);
        store.settings = prevSettings;
        throw e;
    }
}

export function assertIds(moduleName, ids) {
    const missing = [];
    ids.forEach(id => {
        if (!document.getElementById(id)) {
            missing.push(id);
        }
    });
    if (missing.length > 0) {
        const errorMsg = `[DOM ID ASSERTION FAILED] Module: ${moduleName} - The following required DOM IDs are missing: ${missing.join(', ')}`;
        console.error(errorMsg);
        // Throw an error so it displays in the browser console for testing and verification.
        throw new TypeError(errorMsg);
    } else {
        console.log(`[DOM ID ASSERTION PASSED] Module: ${moduleName} - All required IDs are present: ${ids.join(', ')}`);
    }
}

