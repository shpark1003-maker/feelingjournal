(function () {
    const STORAGE_KEY = 'stitch_design_tokens';

    // 1. 토큰 데이터 구조 검증 함수 (Shape Validation)
    function isValidTokenShape(data) {
        if (!data || typeof data !== 'object') return false;
        if (!data.version || typeof data.version !== 'string') return false;
        if (!data.tokens || typeof data.tokens !== 'object') return false;

        // 필수 핵심 토큰들이 존재하는지 확인 (예: primary-color, background-color)
        const requiredKeys = ['primary-color', 'background-color', 'secondary-color'];
        for (const key of requiredKeys) {
            const val = data.tokens[key];
            if (!val || typeof val !== 'string') return false;
            // 간단한 색상 값 포맷 검증 (Hex 또는 rgb/rgba/var 등의 문자열인지 체크)
            if (!val.startsWith('#') && !val.startsWith('rgb') && !val.startsWith('var') && !val.startsWith('0')) {
                return false;
            }
        }
        return true;
    }

    // 2. CSS Custom Properties (:root) 주입 함수
    function applyTokens(tokens) {
        const root = document.documentElement;
        Object.entries(tokens).forEach(([key, value]) => {
            root.style.setProperty(`--${key}`, value);
        });
    }

    // [Step 1] 동기 블로킹 단계: 로컬 스토리지에 캐시된 토큰 적용 (FOUC 해결)
    let localCache = null;
    try {
        const rawCache = localStorage.getItem(STORAGE_KEY);
        if (rawCache) {
            const parsedCache = JSON.parse(rawCache);
            if (isValidTokenShape(parsedCache)) {
                localCache = parsedCache;
                applyTokens(localCache.tokens);
            } else {
                console.warn('Invalid Stitch token format found in localStorage. Clearing cache.');
                localStorage.removeItem(STORAGE_KEY);
            }
        }
    } catch (e) {
        console.error('Failed to read or apply local theme cache:', e);
    }

    // [Step 2] 백그라운드 비동기 단계: 최신 테마 서버 fetch 및 비교 교체
    // DOM 로드가 완료된 후에 비동기로 백그라운드에서 실행하여 초기 렌더링에 지장을 주지 않음
    function fetchLatestTheme() {
        fetch('/api/stitch')
            .then(res => {
                if (!res.ok) throw new Error('Stitch API status code: ' + res.status);
                return res.json();
            })
            .then(data => {
                if (!isValidTokenShape(data)) {
                    console.error('Fetched Stitch theme format is invalid:', data);
                    return;
                }

                // 기존 로컬스토리지 캐시 버전과 비교하여 다를 때만 repaint 수행
                const currentVersion = localCache ? localCache.version : null;
                if (data.version !== currentVersion) {
                    console.log(`Updating theme to version: ${data.version} (previous: ${currentVersion})`);
                    applyTokens(data.tokens);
                    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
                } else {
                    console.log('Stitch theme is up-to-date. No repaint needed.');
                }
            })
            .catch(err => {
                console.error('Failed to update Stitch theme from server:', err);
            });
    }

    // document가 이미 로드되었으면 바로 호출, 아니면 DOMContentLoaded에 리스너 등록
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', fetchLatestTheme);
    } else {
        // requestIdleCallback 또는 setTimeout을 사용해 완전히 메인 스레드가 한가할 때 백그라운드 처리 권장
        if (window.requestIdleCallback) {
            window.requestIdleCallback(fetchLatestTheme);
        } else {
            setTimeout(fetchLatestTheme, 1);
        }
    }
})();
