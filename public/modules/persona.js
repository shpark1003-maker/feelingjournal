import { store, API_URL, assertIds } from './state.js?v=5.2.0';

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

    setupLearningCenter();
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
        if (!token) return;

        const aiName = document.getElementById('ai-name')?.value || '비서';
        const titleEl = document.getElementById('briefing-title-text');
        if (titleEl) titleEl.innerText = `일과 브리핑`;

        card.style.display = 'block';
        card.classList.remove('hidden');
        content.innerHTML = `
            <div style="display:flex; align-items:center; gap:10px; color:#6366f1;">
                <div class="loading" style="width:20px; height:20px;"></div> 
                <span>${aiName}가 오늘의 일정을 분석하여 브리핑을 준비하고 있습니다...</span>
            </div>
        `;

        const providerToken = await store.getProviderToken();
        const weatherOff = document.getElementById('weather-off')?.checked;
        
        let url = `${API_URL}/briefing`;
        if (!weatherOff && navigator.geolocation) {
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
        } else if (weatherOff) {
            url += `?region=off`;
        }

        const res = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'x-provider-token': providerToken || ''
            }
        });

        const data = await res.json();
        if (data.success && data.briefing) {
            content.innerHTML = data.briefing
                .replace(/\n/g, '<br>')
                .replace(/\*\*(.*?)\*\*/g, '<strong style="color:var(--accent-color)">$1</strong>');
        } else {
            content.innerHTML = `<span style="color:#ee5253;">⚠️ ${data.error || '브리핑을 생성할 수 없습니다. 나중에 다시 시도해 주세요.'}</span>`;
        }
    } catch (e) {
        console.error('Briefing Error:', e);
        content.innerHTML = '<span style="color:#ee5253;">연결 오류로 브리핑을 가져오지 못했습니다.</span>';
    }
}
