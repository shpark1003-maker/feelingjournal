import { store, API_URL, assertIds } from './state.js?v=5.4.3';

export async function loadPersona() {
    assertIds('Persona', [
        'ai-name', 'ai-age', 'ai-relationship', 'ai-personality', 'ai-voice-select', 'test-voice-btn', 
        'ai-avatar-preview', 'upload-avatar-btn', 'generate-avatar-btn', 'avatar-options-grid', 
        'video-dropzone', 'learning-video-input', 'start-learning-btn', 'learning-status', 'status-text', 
        'save-persona-btn'
    ]);

    const token = await store.getSessionToken();
    if (!token) return;

    const res = await fetch(`${API_URL}/persona`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    if (data.success && data.persona) {
        const p = data.persona;
        if (p.gender) {
            const genderRadio = document.querySelector(`input[name="gender"][value="${p.gender}"]`);
            if (genderRadio) genderRadio.checked = true;
        }
        const ageSelect = document.getElementById('ai-age');
        if (ageSelect) ageSelect.value = p.age || '20대';
        
        const relSelect = document.getElementById('ai-relationship');
        if (relSelect) relSelect.value = p.relationship || '수석비서';

        const nameInput = document.getElementById('ai-name');
        if (nameInput) {
            nameInput.value = p.name || '비서';
            const friendNameEl = document.getElementById('friend-list-ai-name');
            if (friendNameEl) friendNameEl.innerText = `${nameInput.value} 비서`;
        }

        let personalityText = p.personality || '';
        if (p.voice_features && !personalityText.includes(p.voice_features)) {
            personalityText += `\n\n* 분석된 음성 특징: ${p.voice_features}`;
        }
        const personalityArea = document.getElementById('ai-personality');
        if (personalityArea) personalityArea.value = personalityText;

        store.currentAvatarUrl = p.avatarUrl;
        renderPersonaAvatar(p);
    }
    // API 연동 설정 함께 로드
    if (typeof loadApiSettings === 'function') {
        loadApiSettings();
    }
}

export function renderPersonaAvatar(p) {
    const preview = document.getElementById('ai-avatar-preview');
    if (!preview) return;

    const color = p.gender === '여성' ? '#f8a5c2' : '#778beb';
    preview.style.background = `radial-gradient(circle, ${color} 0%, #2d3436 100%)`;

    if (p.avatarUrl) {
        preview.innerHTML = `<img src="${p.avatarUrl}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;">`;
    } else {
        preview.innerHTML = `<span style="font-size: 80px;">${p.gender === '여성' ? '👩‍💼' : '👨‍💼'}</span>`;
    }
}

export function setupPersonaUI() {
    console.log('--- [UI] Persona Atelier Setup ---');

    // 1. 비서 정보 저장 버튼
    document.getElementById('save-persona-btn')?.addEventListener('click', async () => {
        const aiName = document.getElementById('ai-name')?.value || '비서';
        const genderEl = document.querySelector('input[name="gender"]:checked');
        const ageEl = document.getElementById('ai-age');
        const relationshipEl = document.getElementById('ai-relationship');
        const personalityEl = document.getElementById('ai-personality');

        const persona = {
            name: aiName,
            gender: genderEl ? genderEl.value : '여성',
            age: ageEl ? ageEl.value : '20대',
            relationship: relationshipEl ? relationshipEl.value : '수석비서',
            personality: personalityEl ? personalityEl.value : '',
            avatarUrl: store.currentAvatarUrl
        };

        const token = await store.getSessionToken();
        const res = await fetch(`${API_URL}/persona`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ persona })
        });

        if ((await res.json()).success) {
            alert(`${aiName}의 성격과 모습이 반영되었습니다.`);
            renderPersonaAvatar(persona);

            const friendNameEl = document.getElementById('friend-list-ai-name');
            if (friendNameEl) friendNameEl.innerText = `${aiName} 비서`;

            const chatTitleEl = document.getElementById('chat-room-title-text');
            if (chatTitleEl && chatTitleEl.innerText.includes('와 대화')) {
                chatTitleEl.innerText = `✨ ${aiName}와 대화`;
            }
        }
    });

    // 2. AI 얼굴 생성 버튼
    document.getElementById('generate-avatar-btn')?.addEventListener('click', async () => {
        const btn = document.getElementById('generate-avatar-btn');
        const grid = document.getElementById('avatar-options-grid');
        if (!btn || !grid) return;

        btn.innerText = '🎨 생성 중...';

        try {
            const token = await store.getSessionToken();
            const res = await fetch(`${API_URL}/persona/generate-avatar`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();

            if (data.success && data.options) {
                grid.classList.remove('hidden');
                grid.style.display = 'grid'; // Force display
                grid.innerHTML = data.options.map(url => `
                    <div class="avatar-option-item" style="cursor:pointer; border:2px solid transparent; border-radius:50%; overflow:hidden; transition:all 0.2s;">
                        <img src="${url}" style="width:100%; height:100%; object-fit:cover;">
                    </div>
                `).join('');

                grid.querySelectorAll('.avatar-option-item').forEach((item, idx) => {
                    item.addEventListener('click', () => {
                        store.currentAvatarUrl = data.options[idx];
                        const genderVal = document.querySelector('input[name="gender"]:checked')?.value || '여성';
                        renderPersonaAvatar({ gender: genderVal, avatarUrl: store.currentAvatarUrl });
                        
                        grid.querySelectorAll('.avatar-option-item').forEach(i => i.style.borderColor = 'transparent');
                        item.style.borderColor = 'var(--accent-color)';
                    });
                });

                renderPersonaAvatar({ avatarUrl: data.options[0] });
                alert('4가지 새로운 얼굴 추천이 생성되었습니다! 마음에 드는 얼굴을 선택해 보세요.');
            }
        } catch (e) {
            console.error('Avatar Generation Error:', e);
            alert('아바타 생성 중 오류가 발생했습니다.');
        } finally {
            btn.innerText = '🎨 AI 얼굴 생성';
        }
    });

    // 3. 비서 이름 실시간 동기화
    document.getElementById('ai-name')?.addEventListener('input', (e) => {
        const newName = e.target.value || '원이';
        const friendNameEl = document.getElementById('friend-list-ai-name');
        if (friendNameEl) friendNameEl.innerText = `${newName} 비서`;

        const chatTitleEl = document.getElementById('chat-room-title-text');
        if (chatTitleEl && chatTitleEl.innerText.includes('와 대화')) {
            chatTitleEl.innerText = `✨ ${newName}와 대화`;
        }
    });

    // 4. 사진 업로드 기능 구현
    const photoInput = (function () {
        let inp = document.getElementById('ai-photo-input');
        if (!inp) {
            inp = document.createElement('input');
            inp.type = 'file';
            inp.id = 'ai-photo-input';
            inp.accept = 'image/*';
            inp.style.display = 'none';
            document.body.appendChild(inp);
        }
        return inp;
    })();

    document.getElementById('upload-avatar-btn')?.addEventListener('click', () => photoInput.click());

    photoInput.addEventListener('change', async (e) => {
        if (e.target.files.length === 0) return;
        const file = e.target.files[0];
        const formData = new FormData();
        formData.append('avatar', file);

        try {
            const token = await store.getSessionToken();
            const res = await fetch(`${API_URL}/persona/avatar`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` },
                body: formData
            });
            const data = await res.json();
            if (data.success) {
                store.currentAvatarUrl = data.avatarUrl || data.url;
                renderPersonaAvatar({ avatarUrl: store.currentAvatarUrl });
                alert('사진이 성공적으로 업로드되었습니다. "저장" 버튼을 눌러 확정해 주세요.');
            }
        } catch (err) {
            alert('사진 업로드 중 오류가 발생했습니다.');
        }
    });

    // 5. 목소리 테스트 버튼
    document.getElementById('test-voice-btn')?.addEventListener('click', () => {
        const aiName = document.getElementById('ai-name')?.value || '비서';
        const msg = new SpeechSynthesisUtterance(`안녕하세요, 당신의 하루를 기록하는 비서 ${aiName}입니다.`);
        msg.lang = 'ko-KR';

        const voices = window.speechSynthesis.getVoices();
        const koVoices = voices.filter(v => v.lang.startsWith('ko'));
        const selectedVoice = koVoices.find(v => v.name.includes('Sun-Hi') || v.name.includes('Heami') || v.name.includes('Google') || v.name.includes('Female')) || koVoices[0];

        if (selectedVoice) msg.voice = selectedVoice;
        msg.pitch = 1.0;
        msg.rate = 1.0;

        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(msg);
    });

    const voiceSelect = document.getElementById('ai-voice-select');
    if (voiceSelect && voiceSelect.options.length === 0) {
        const voices = [
            { id: 'v1', name: '기본 한국어 목소리' }
        ];
        voiceSelect.innerHTML = voices.map(v => `<option value="${v.id}">${v.name}</option>`).join('');
    }

    // 6. 테마 설정 이벤트 바인딩
    document.getElementById('theme-btn-ghibli')?.addEventListener('click', () => {
        if (window.applyTheme) window.applyTheme('ghibli');
    });
    document.getElementById('theme-btn-pink')?.addEventListener('click', () => {
        if (window.applyTheme) window.applyTheme('pink');
    });

    setupLearningCenter();
    setupApiIntegrationUI();
}

export function setupLearningCenter() {
    const dropzone = document.getElementById('video-dropzone');
    const input = document.getElementById('learning-video-input');
    const startBtn = document.getElementById('start-learning-btn');
    const status = document.getElementById('learning-status');
    const statusText = document.getElementById('status-text');

    let selectedFile = null;

    dropzone?.addEventListener('click', () => input.click());

    dropzone?.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropzone.style.borderColor = 'var(--accent-color)';
        dropzone.style.background = 'rgba(99, 102, 241, 0.05)';
    });

    dropzone?.addEventListener('dragleave', () => {
        dropzone.style.borderColor = '#ccc';
        dropzone.style.background = 'transparent';
    });

    dropzone?.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropzone.style.borderColor = '#ccc';
        dropzone.style.background = 'transparent';

        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            handleFile(e.dataTransfer.files[0]);
        }
    });

    input?.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleFile(e.target.files[0]);
        }
    });

    function handleFile(file) {
        if (!file.type.startsWith('video/')) {
            alert('영상 파일만 업로드 가능합니다.');
            return;
        }
        selectedFile = file;
        const text = document.getElementById('dropzone-text');
        if (text) text.innerText = `선택됨: ${file.name}`;
        if (startBtn) startBtn.disabled = false;
    }

    startBtn?.addEventListener('click', async () => {
        if (!selectedFile) return;

        startBtn.disabled = true;
        status?.classList.remove('hidden');
        if (statusText) statusText.innerText = '인격 분석 중... (약 1분 소요)';

        const formData = new FormData();
        formData.append('video', selectedFile);

        try {
            const token = await store.getSessionToken();
            const res = await fetch(`${API_URL}/persona/learn-video`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` },
                body: formData
            });
            const data = await res.json();

            if (data.success) {
                const a = data.analysis;
                const nameInp = document.getElementById('ai-name');
                if (nameInp) nameInp.value = a.name;

                const personalityInp = document.getElementById('ai-personality');
                if (personalityInp) {
                    personalityInp.value = `${a.personality}\n\n[말투 가이드] ${a.speech_guide}\n\n[추천 관계] ${a.suggested_relationship}\n\n* 분석된 특징: ${a.voice_features}`;
                }

                if (data.avatarUrl) {
                    store.currentAvatarUrl = data.avatarUrl;
                    renderPersonaAvatar({ gender: a.gender, avatarUrl: store.currentAvatarUrl });
                }
                alert('인격, 이미지, 음성 학습이 모두 완료되었습니다! "저장" 버튼을 눌러 확정해 주세요.');
                loadPersona();
            } else {
                alert('분석 실패: ' + data.error);
            }
        } catch (e) {
            alert('서버 통신 오류');
        } finally {
            status?.classList.add('hidden');
            startBtn.disabled = false;
        }
    });
}

export async function loadBriefing() {
    const card = document.getElementById('briefing-card');
    const content = document.getElementById('briefing-content');
    if (!card || !content) return;

    try {
        const token = await store.getSessionToken();
        if (!token) {
            card.style.display = 'none';
            return;
        }

        const aiName = document.getElementById('ai-name')?.value || '비서';
        const titleEl = document.getElementById('briefing-title-text');
        if (titleEl) titleEl.innerText = `일과 브리핑`;

        card.style.display = 'block';
        card.classList.remove('hidden');

        // [1. Loading State] Premium Skeleton Loader
        content.innerHTML = `
            <div class="animate-pulse space-y-3 py-2">
                <div class="flex items-center gap-3 text-primary">
                    <span class="material-symbols-outlined animate-spin text-xl">sync</span>
                    <span class="font-medium text-sm">${aiName}가 오늘의 일정을 분석하여 브리핑을 준비하고 있습니다...</span>
                </div>
                <div class="h-3 bg-primary/10 rounded-full w-3/4"></div>
                <div class="h-3 bg-primary/10 rounded-full w-5/6"></div>
                <div class="h-3 bg-primary/10 rounded-full w-2/3"></div>
            </div>
        `;

        const weatherOff = document.getElementById('weather-off')?.checked;
        let url = `${API_URL}/briefing`;
        if (!weatherOff) {
            const gpsBtn = document.getElementById('weather-gps-btn');
            const isGpsMode = gpsBtn ? gpsBtn.classList.contains('bg-white') : true;

            if (isGpsMode && navigator.geolocation) {
                try {
                    const position = await new Promise((resolve, reject) => {
                        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 3000 });
                    });
                    const lat = position.coords.latitude;
                    const lon = position.coords.longitude;
                    
                    const cities = [
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
                    
                    let closestCity = '서울';
                    let minDistance = Infinity;
                    for (const city of cities) {
                        const dLat = lat - city.lat;
                        const dLon = lon - city.lon;
                        const dist = Math.sqrt(dLat * dLat + dLon * dLon);
                        if (dist < minDistance) {
                            minDistance = dist;
                            closestCity = city.name;
                        }
                    }
                    url += `?region=${encodeURIComponent(closestCity)}`;
                    console.log(`--- [GPS DYNAMIC BRIEFING] Resolved active region: ${closestCity} ---`);
                } catch (err) {
                    console.warn('Real-time GPS capture skipped or denied, fallback to saved region.', err);
                }
            } else {
                const locationInput = document.getElementById('weather-location-input');
                const fixedRegion = locationInput?.value?.trim() || store.settings?.weatherRegion || '서울';
                url += `?region=${encodeURIComponent(fixedRegion)}`;
                console.log(`--- [FIXED BRIEFING] Using fixed region: ${fixedRegion} ---`);
            }
        } else if (weatherOff) {
            url += `?region=off`;
        }

        console.log("--- [BRIEFING] Requesting briefing from backend API...");
        const res = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        const data = await res.json();
        
        // [2. Loaded State / Empty State / Error State split]
        if (data.success && data.briefing) {
            const briefingText = data.briefing.trim();

            // 실시간 날씨 위젯 처리 (눈비맑음 아이콘 + 온도 표시)
            const weatherWidget = document.getElementById('briefing-weather-widget');
            const weatherIcon = document.getElementById('briefing-weather-icon');
            const weatherTemp = document.getElementById('briefing-weather-temp');

            if (data.weather && weatherWidget && weatherIcon && weatherTemp) {
                const w = data.weather;
                let weatherImgName = 'weather_sunny.png';

                const skyLower = (w.sky || '').toLowerCase();
                const rainTypeLower = (w.rainType || '').toLowerCase();

                if ((rainTypeLower.includes('강수') && !rainTypeLower.includes('없음')) || skyLower.includes('rain') || skyLower.includes('drizzle') || skyLower.includes('비')) {
                    weatherImgName = 'weather_rainy.png';
                } else if (skyLower.includes('snow') || skyLower.includes('눈') || skyLower.includes('freeze')) {
                    weatherImgName = 'weather_snowy.png';
                } else if (skyLower.includes('cloud') || skyLower.includes('흐림') || skyLower.includes('구름') || skyLower.includes('overcast') || skyLower.includes('mist') || skyLower.includes('haze')) {
                    weatherImgName = 'weather_cloudy.png';
                }

                weatherIcon.src = `./${weatherImgName}`;
                weatherTemp.innerText = `${Math.round(w.temp)}°C`;
                weatherWidget.classList.remove('hidden');
                weatherWidget.style.display = 'flex';
            } else if (weatherWidget) {
                weatherWidget.classList.add('hidden');
                weatherWidget.style.display = 'none';
            }
            if (briefingText.length === 0) {
                // [3. Empty State]
                content.innerHTML = `
                    <div class="flex flex-col items-center justify-center py-6 text-center text-on-surface-variant/70 gap-2 bg-white/40 backdrop-blur-sm rounded-2xl border border-white/20 p-4">
                        <span class="material-symbols-outlined text-4xl text-on-surface-variant/40 animate-bounce">coffee</span>
                        <p class="text-sm font-medium">오늘 예정된 특별한 일정이나 기록이 없어 한결 가뿐한 하루입니다. ☕</p>
                    </div>
                `;
            } else {
                // [4. Loaded State]
                console.log("--- [BRIEFING] Successfully loaded briefing from server.");
                content.innerHTML = data.briefing
                    .replace(/\n/g, '<br>')
                    .replace(/\*\*(.*?)\*\*/g, '<strong style="color:var(--primary)">$1</strong>');
            }
        } else {
            // [5. Error State (Server failed)]
            console.error("--- [BRIEFING] Server failed to generate briefing:", data.error);
            content.innerHTML = `
                <div class="flex flex-col items-center justify-center py-6 text-center text-error gap-2 bg-error-container/10 border border-error/20 rounded-2xl p-4">
                    <span class="material-symbols-outlined text-3xl text-error">warning</span>
                    <p class="text-sm font-medium">⚠️ ${data.error || '브리핑을 생성할 수 없습니다. 나중에 다시 시도해 주세요.'}</p>
                </div>
            `;
        }
    } catch (e) {
        // [6. Error State (Runtime/Network error)]
        console.error('Briefing Error:', e);
        content.innerHTML = `
            <div class="flex flex-col items-center justify-center py-6 text-center text-error gap-2 bg-error-container/10 border border-error/20 rounded-2xl p-4">
                <span class="material-symbols-outlined text-3xl text-error">warning</span>
                <p class="text-sm font-medium">⚠️ 연결 오류로 브리핑을 가져오지 못했습니다. 잠시 후 다시 시도해 주세요.</p>
            </div>
        `;
    }
}

export function setupApiIntegrationUI() {
    const tabFree = document.getElementById('api-tab-free');
    const tabPaid = document.getElementById('api-tab-paid');
    const freeSection = document.getElementById('api-free-section');
    const paidSection = document.getElementById('api-paid-section');

    const toggleNsight = document.getElementById('api-nsight-toggle');
    const containerNsight = document.getElementById('nsight-credentials-container');
    const toggleEleven = document.getElementById('api-eleven-toggle');
    const containerEleven = document.getElementById('eleven-credentials-container');
    const toggleGeminiPro = document.getElementById('api-geminipro-toggle');
    const containerGeminiPro = document.getElementById('geminipro-credentials-container');

    const saveBtn = document.getElementById('save-api-settings-btn');

    // Tab switching
    tabFree?.addEventListener('click', () => {
        tabFree.className = 'flex-1 py-2 rounded-xl bg-white shadow-sm text-primary font-label-md';
        tabPaid.className = 'flex-1 py-2 rounded-xl text-on-surface-variant font-label-md';
        freeSection?.classList.remove('hidden');
        paidSection?.classList.add('hidden');
    });

    tabPaid?.addEventListener('click', () => {
        tabPaid.className = 'flex-1 py-2 rounded-xl bg-white shadow-sm text-primary font-label-md';
        tabFree.className = 'flex-1 py-2 rounded-xl text-on-surface-variant font-label-md';
        paidSection?.classList.remove('hidden');
        freeSection?.classList.add('hidden');
    });

    // Toggle sub-containers
    toggleNsight?.addEventListener('change', () => {
        if (toggleNsight.checked) {
            containerNsight?.classList.remove('hidden');
            alert('💡 nsight 투자 컨설팅 API 연동이 활성화되었습니다! 설정을 저장하시면 대화창에서 AI 비서에게 고도화된 경제/주식/자산 컨설팅 지침이 장착됩니다.');
        } else {
            containerNsight?.classList.add('hidden');
        }
    });

    toggleEleven?.addEventListener('change', () => {
        if (toggleEleven.checked) {
            containerEleven?.classList.remove('hidden');
            alert('💡 ElevenLabs 음성 합성 API 연동이 활성화되었습니다! API Key와 보이스를 기반으로 작동합니다.');
        } else {
            containerEleven?.classList.add('hidden');
        }
    });

    toggleGeminiPro?.addEventListener('change', () => {
        if (toggleGeminiPro.checked) {
            containerGeminiPro?.classList.remove('hidden');
            alert('💡 Gemini 1.5 Pro 모델이 활성화되었습니다! 더 높은 수준의 사고와 인지 능력을 발휘합니다.');
        } else {
            containerGeminiPro?.classList.add('hidden');
        }
    });

    // Save action
    saveBtn?.addEventListener('click', async () => {
        try {
            const token = await store.getSessionToken();
            if (!token) return;

            const payload = {
                settings: {
                    weatherEnabled: document.getElementById('api-weather-toggle')?.checked !== false,
                    newsEnabled: document.getElementById('api-news-toggle')?.checked !== false,
                    nsightEnabled: !!toggleNsight?.checked,
                    nsightKey: document.getElementById('api-nsight-key')?.value || '',
                    elevenEnabled: !!toggleEleven?.checked,
                    elevenKey: document.getElementById('api-eleven-key')?.value || '',
                    geminiProEnabled: !!toggleGeminiPro?.checked,
                    geminiProKey: document.getElementById('api-geminipro-key')?.value || ''
                }
            };

            const res = await fetch(`${API_URL}/api-settings`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(payload)
            });

            const data = await res.json();
            if (data.success) {
                alert('✨ API 연동 설정이 성공적으로 저장 및 반영되었습니다!');
                loadApiSettings();
            } else {
                alert('API 설정 저장 실패: ' + (data.error || '알 수 없는 오류'));
            }
        } catch (err) {
            console.error('Failed to save API settings:', err);
            alert('API 설정 저장 중 서버 오류가 발생했습니다.');
        }
    });
}

export async function loadApiSettings() {
    try {
        const token = await store.getSessionToken();
        if (!token) return;

        const res = await fetch(`${API_URL}/api-settings`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();

        if (data.success && data.settings) {
            const s = data.settings;
            
            const weatherToggle = document.getElementById('api-weather-toggle');
            if (weatherToggle) weatherToggle.checked = s.weatherEnabled !== false;

            const newsToggle = document.getElementById('api-news-toggle');
            if (newsToggle) newsToggle.checked = s.newsEnabled !== false;

            const nsightToggle = document.getElementById('api-nsight-toggle');
            if (nsightToggle) {
                nsightToggle.checked = !!s.nsightEnabled;
                const container = document.getElementById('nsight-credentials-container');
                if (s.nsightEnabled) container?.classList.remove('hidden');
                else container?.classList.add('hidden');
            }
            const nsightKey = document.getElementById('api-nsight-key');
            if (nsightKey) nsightKey.value = s.nsightKey || 'demo-api-key-active';

            const elevenToggle = document.getElementById('api-eleven-toggle');
            if (elevenToggle) {
                elevenToggle.checked = !!s.elevenEnabled;
                const container = document.getElementById('eleven-credentials-container');
                if (s.elevenEnabled) container?.classList.remove('hidden');
                else container?.classList.add('hidden');
            }
            const elevenKey = document.getElementById('api-eleven-key');
            if (elevenKey) elevenKey.value = s.elevenKey || '';

            const geminiProToggle = document.getElementById('api-geminipro-toggle');
            if (geminiProToggle) {
                geminiProToggle.checked = !!s.geminiProEnabled;
                const container = document.getElementById('geminipro-credentials-container');
                if (s.geminiProEnabled) container?.classList.remove('hidden');
                else container?.classList.add('hidden');
            }
            const geminiProKey = document.getElementById('api-geminipro-key');
            if (geminiProKey) geminiProKey.value = s.geminiProKey || '';
        }
    } catch (err) {
        console.warn('Failed to load API settings:', err);
    }
}
