import { store, API_URL, updateSettings, assertIds } from './state.js?v=5.7.7';

let recognition = null;
let isListening = false;
let isSpeaking = false;
let selectedGuardianName = '';

// 케어모드 시스템 초기화 및 이벤트 바인딩
export function initCareMode() {
    console.log('--- [CARE] initCareMode started ---');
    
    // [Required ID 체크] Module 6: Daily Alarms & Safe Care
    assertIds('Care & Settings', [
        'briefing-time-input',
        'weather-on',
        'weather-off',
        'alarm-60',
        'alarm-30',
        'alarm-10',
        'save-settings-btn',
        'care-mode-active',
        'care-guardian-select',
        'save-care-settings-btn',
        'care-mode-overlay'
    ]);

    const startBtn = document.getElementById('care-mode-start-btn');
    const closeBtn = document.getElementById('close-care-btn');
    const overlay = document.getElementById('care-mode-overlay');
    const micBtn = document.getElementById('care-mic-btn');

    if (startBtn) {
        startBtn.addEventListener('click', () => {
            if (overlay) {
                overlay.classList.remove('hidden');
                overlay.style.display = 'flex';
                // 케어모드 진입 즉시 맞춤형 환영 인사 및 복약 스캔 수행
                speakWelcomeAndReminders();
            }
        });
    }

    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            if (overlay) {
                overlay.classList.add('hidden');
                overlay.style.display = 'none';
                stopSpeaking();
                if (recognition) recognition.stop();
            }
        });
    }

    if (micBtn) {
        micBtn.addEventListener('click', () => {
            if (isSpeaking) {
                stopSpeaking();
            }
            toggleListening();
        });
    }

    // Settings 내 1촌 보호자 지정 Dropdown 설정 & 저장 바인딩
    setupCareSettingsUI();

    // STT 엔진 설정
    initSpeechRecognition();
}

// 1. Settings 내 1촌 친구 목록 로딩 및 보호자 드롭다운 렌더링
export async function populateGuardianSelect() {
    const select = document.getElementById('care-guardian-select');
    const targetsList = document.getElementById('care-targets-list');
    if (!select) return;

    try {
        const token = await store.getSessionToken();

        const res = await fetch(`${API_URL}/contacts`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        const data = await res.json();
        if (data.success && data.contacts) {
            // 1. 드롭다운 옵션 리셋 및 채우기
            select.innerHTML = '<option value="">보호자를 지정하지 않음</option>';
            data.contacts.forEach(c => {
                const opt = document.createElement('option');
                opt.value = c.email; // 보호자 구글 이메일을 식별자로 사용
                opt.textContent = `${c.name} (${c.email || c.phone})`;
                select.appendChild(opt);
            });

            // 2. 동적 1촌 지인 목록 UI 렌더링 (#care-targets-list)
            if (targetsList) {
                if (data.contacts.length === 0) {
                    targetsList.innerHTML = `
                        <div class="text-center py-6 px-4 text-on-surface-variant/70 text-xs bg-white/40 backdrop-blur-sm rounded-2xl border border-white/20">
                            <span class="material-symbols-outlined text-3xl text-on-surface-variant/40 mb-2 block">group_off</span>
                            <span>연동된 1촌 지인이 없습니다.<br>친구를 먼저 초대해 마음을 나누어 보세요!</span>
                        </div>
                    `;
                } else {
                    targetsList.innerHTML = '';
                    data.contacts.forEach((c, index) => {
                        const isGuardian = store.settings?.care?.enabled && (store.settings?.care?.guardianEmail === c.email);
                        
                        // 아바타 색상 다양화
                        const colors = ['#d98c9e', '#5b8266', '#8ba88e', '#645e49', '#7d525c'];
                        const avatarColor = colors[index % colors.length];
                        const initials = c.name ? c.name.slice(0, 2) : '지인';

                        const card = document.createElement('div');
                        card.className = `bg-white/60 p-3 rounded-2xl border ${isGuardian ? 'border-primary bg-primary/5' : 'border-white/40'} flex items-center justify-between shadow-sm transition-all hover:shadow-md duration-300`;
                        card.innerHTML = `
                            <div class="flex items-center gap-3">
                                <div class="h-10 w-10 rounded-full flex items-center justify-center text-white text-xs font-bold shadow-sm" style="background-color: ${avatarColor};">
                                    ${initials}
                                </div>
                                <div class="max-w-[150px] md:max-w-none">
                                    <p class="text-sm font-bold text-on-surface truncate">${c.name}</p>
                                    <p class="text-[10px] text-on-surface-variant truncate">${c.email || c.phone || '연락처 정보 없음'}</p>
                                </div>
                            </div>
                            <div class="flex flex-col items-end gap-1">
                                <span class="text-[9px] font-bold ${isGuardian ? 'text-primary' : 'text-on-surface-variant'}">${isGuardian ? '보호자 케어 중' : '보호자 지정'}</span>
                                <div class="relative inline-block w-10 h-5">
                                    <input type="checkbox" class="toggle-checkbox hidden" id="target-toggle-${index}" ${isGuardian ? 'checked' : ''}>
                                    <label class="toggle-label block overflow-hidden h-5 rounded-full ${isGuardian ? 'bg-primary' : 'bg-outline-variant'} cursor-pointer relative after:w-4 after:h-4 after:top-[2px] after:left-[2px]" for="target-toggle-${index}"></label>
                                </div>
                            </div>
                        `;

                        // 토글 이벤트 바인딩
                        const checkbox = card.querySelector(`#target-toggle-${index}`);
                        checkbox.addEventListener('change', async (e) => {
                            const isChecked = e.target.checked;
                            
                            // 모든 다른 토글 체크 해제
                            if (isChecked) {
                                document.querySelectorAll('#care-targets-list .toggle-checkbox').forEach(cb => {
                                    if (cb.id !== checkbox.id) cb.checked = false;
                                });
                            }

                            // settings UI 엘리먼트 값 변경
                            const careModeActive = document.getElementById('care-mode-active');
                            const careGuardianSelect = document.getElementById('care-guardian-select');

                            if (careModeActive) careModeActive.checked = isChecked;
                            if (careGuardianSelect) {
                                careGuardianSelect.value = isChecked ? c.email : '';
                            }

                            // 저장 API 실행 및 동기화
                            try {
                                await updateSettings({
                                    care: {
                                        enabled: isChecked,
                                        guardianEmail: isChecked ? c.email : '',
                                        guardianName: isChecked ? c.name : ''
                                    }
                                });
                                // 헤더 버튼 동기화
                                syncCareModeHeaderButton(isChecked);
                                // 목록 새로고침
                                await populateGuardianSelect();
                            } catch (err) {
                                console.error('Failed to update care settings via toggle:', err);
                                alert('설정 업데이트에 실패했습니다: ' + err.message);
                                e.target.checked = !isChecked; // 원복
                            }
                        });

                        targetsList.appendChild(card);
                    });
                }
            }
        }
    } catch (e) {
        console.error('Failed to populate guardians from contacts:', e);
        if (targetsList) {
            targetsList.innerHTML = `
                <div class="text-center py-6 px-4 text-error text-xs bg-error-container/10 border border-error/20 rounded-2xl">
                    <span class="material-symbols-outlined text-3xl text-error mb-2 block">warning</span>
                    <span>주소록 데이터를 불러오지 못했습니다.</span>
                </div>
            `;
        }
    }
}

// 2. 케어 설정 전용 저장 핸들러
function setupCareSettingsUI() {
    const saveCareBtn = document.getElementById('save-care-settings-btn');
    if (!saveCareBtn) return;

    saveCareBtn.addEventListener('click', async () => {
        saveCareBtn.disabled = true;
        saveCareBtn.innerText = '저장 중...';

        const careActive = document.getElementById('care-mode-active').checked;
        const guardianSelect = document.getElementById('care-guardian-select');
        const guardianEmail = guardianSelect ? guardianSelect.value : '';
        const selectedOpt = guardianSelect ? guardianSelect.options[guardianSelect.selectedIndex] : null;
        const guardianName = selectedOpt && selectedOpt.value ? selectedOpt.textContent.split('(')[0].trim() : '';

        // 실패 대비 이전 UI 상태 백업
        const prevActive = store.settings.care.enabled;
        const prevEmail = store.settings.care.guardianEmail;

        try {
            // state.js의 공통 비동기 업데이트 헬퍼 호출 (Deep Merge 및 Rollback 처리)
            await updateSettings({
                care: {
                    enabled: careActive,
                    guardianEmail: guardianEmail,
                    guardianName: guardianName
                }
            });

            alert('🏡 안심 케어 모드 연동 설정이 완벽하게 저장되었습니다.');
            // 헤더 버튼 노출 동기화
            syncCareModeHeaderButton(careActive);
            await populateGuardianSelect();
        } catch (e) {
            console.error('Save Care Settings error:', e);
            alert('케어 설정 저장 실패: ' + e.message);
            
            // UI 상태 원복
            document.getElementById('care-mode-active').checked = prevActive;
            if (guardianSelect) guardianSelect.value = prevEmail;
            syncCareModeHeaderButton(prevActive);
        } finally {
            saveCareBtn.disabled = false;
            saveCareBtn.innerText = '케어 설정 저장';
        }
    });
}

// 헤더 시작 버튼 노출/숨김 동기화 헬퍼
export function syncCareModeHeaderButton(enabled) {
    const startBtn = document.getElementById('care-mode-start-btn');
    if (startBtn) {
        startBtn.style.display = enabled ? 'flex' : 'none';
    }
}

// 3. 케어 설정 데이터 로딩 바인딩 (V1 평탄화 객체와 V2 중첩 구조 모두 대응하도록 안전 설계)
export function applyCareSettingsToUI(settings) {
    const s = (settings && (settings.careModeEnabled !== undefined || settings.careGuardianEmail !== undefined))
        ? {
            enabled: !!settings.careModeEnabled,
            guardianEmail: settings.careGuardianEmail || '',
            guardianName: settings.careGuardianName || ''
          }
        : store.settings.care;

    const careActive = document.getElementById('care-mode-active');
    const guardianSelect = document.getElementById('care-guardian-select');

    if (careActive) careActive.checked = !!s.enabled;
    if (guardianSelect) {
        guardianSelect.value = s.guardianEmail;
        
        // 선택된 보호자 텍스트 획득
        const selectedOpt = guardianSelect.options[guardianSelect.selectedIndex];
        selectedGuardianName = selectedOpt && selectedOpt.value ? selectedOpt.textContent.split('(')[0].trim() : '보호자';
    }

    syncCareModeHeaderButton(!!s.enabled);
}

// 4. 아버님/사용자 맞춤형 복약 안내 및 안부 전송 음성 조합
async function speakWelcomeAndReminders() {
    const captionText = document.getElementById('care-caption-text');
    if (captionText) captionText.innerText = "사용자님의 안심 복약 일정과 1촌 소식을 가져오고 있습니다. 잠시만 기다려주세요...";

    try {
        const token = await store.getSessionToken();

        // 1. 보호자 닉네임/이름 설정
        const guardianSelect = document.getElementById('care-guardian-select');
        const selectedOpt = guardianSelect ? guardianSelect.options[guardianSelect.selectedIndex] : null;
        const guardianDisplayName = selectedOpt && selectedOpt.value ? selectedOpt.textContent.split('(')[0].trim() : '보호자';

        // 2. 오늘 약 복용 캘린더 추출
        const res = await fetch(`${API_URL}/calendar`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        const data = await res.json();
        
        let medicationAlerts = [];
        if (data.success && data.events) {
            const todayStr = new Date().toLocaleDateString('ko-KR');
            const todayMeds = data.events.filter(e => {
                const eventDate = new Date(e.start).toLocaleDateString('ko-KR');
                const hasKeyword = e.title.includes('약') || e.title.includes('복용');
                return eventDate === todayStr && hasKeyword;
            });

            medicationAlerts = todayMeds.map(m => {
                const timeStr = new Date(m.start).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
                return `${timeStr}에 예정된 '${m.title}'`;
            });
        }

        let speakText = `반갑습니다! 수석 비서입니다. 🎩 오늘 하루 평안히 보내고 계신가요? `;
        if (guardianDisplayName !== '보호자') {
            speakText += `보호자로 연결되신 ${guardianDisplayName}님께서 사용자님의 따뜻한 하루를 늘 든든하게 응원하고 계십니다. 💕 `;
        }

        if (medicationAlerts.length > 0) {
            speakText += `오늘 일정 중 ${medicationAlerts.join(', ')} 일정이 있습니다. 복용 주기를 놓치지 않고 챙겨 드실 수 있도록 곁에서 보살펴 드리겠습니다. 💊 자, 오늘 기분이나 들려주고 싶으신 일상의 기록을 마이크 버튼을 누르고 저에게 들려주세요.`;
        } else {
            speakText += `오늘 예정된 복약 스케줄은 없어 참으로 다행입니다. 오늘 느끼신 편안한 기분이나 하시고 싶은 이야기를 아래 마이크 버튼을 가볍게 누르신 뒤 저에게 편안하게 귀띔해 주십시오.`;
        }

        if (captionText) captionText.innerText = speakText;
        speakLoud(speakText);

    } catch (error) {
        console.error('Care Mode Fetch failed:', error);
        const fallbackText = "반갑습니다! 오늘 있었던 편안한 하루 이야기나 감정을 아래 마이크 버튼을 누르고 편하게 말씀해 주세요. 수석 비서관이 정성껏 경청하겠습니다.";
        if (captionText) captionText.innerText = fallbackText;
        speakLoud(fallbackText);
    }
}

// 5. STT (Speech to Text) 음성 인식 초기화
function initSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        console.warn('Speech Recognition not supported.');
        return;
    }

    recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.lang = 'ko-KR';
    recognition.interimResults = false;

    recognition.onstart = () => {
        isListening = true;
        updateMicButtonUI();
        const helpText = document.getElementById('care-status-help');
        const transText = document.getElementById('care-transcript-text');
        if (helpText) helpText.innerText = "귀 기울여 경청하고 있습니다. 편안하게 말씀해 주십시오...";
        if (transText) {
            transText.style.display = 'none';
            transText.innerText = '';
        }
    };

    recognition.onresult = async (event) => {
        const transcript = event.results[0][0].transcript;
        const transText = document.getElementById('care-transcript-text');
        if (transText) {
            transText.style.display = 'block';
            transText.innerText = `💬 인식된 말: "${transcript}"`;
        }

        await processVoiceDiary(transcript);
    };

    recognition.onerror = (event) => {
        console.error('STT Error:', event.error);
        const helpText = document.getElementById('care-status-help');
        if (helpText) helpText.innerText = "말소리가 잘 전달되지 않았습니다. 마이크를 다시 누르고 말씀해 주십시오.";
        isListening = false;
        updateMicButtonUI();
    };

    recognition.onend = () => {
        isListening = false;
        updateMicButtonUI();
    };
}

function toggleListening() {
    if (!recognition) {
        alert('이 기기는 음성 인식을 지원하지 않습니다.');
        return;
    }

    if (isListening) {
        recognition.stop();
    } else {
        recognition.start();
    }
}

function updateMicButtonUI() {
    const micBtn = document.getElementById('care-mic-btn');
    const avatar = document.getElementById('care-avatar');
    if (!micBtn) return;

    if (isListening) {
        micBtn.style.background = 'linear-gradient(135deg, #ff4757 0%, #ff6b81 100%)';
        micBtn.style.transform = 'scale(1.15)';
        micBtn.innerText = '🔴';
        if (avatar) avatar.style.transform = 'scale(0.9)';
    } else {
        micBtn.style.background = 'linear-gradient(135deg, #6c5ce7 0%, #a29bfe 100%)';
        micBtn.style.transform = 'scale(1)';
        micBtn.innerText = '🎙️';
        if (avatar) avatar.style.transform = 'scale(1)';
    }
}

// 6. 음성 일기 저장 API 및 실시간 AI 비서 답변 합성 연동
async function processVoiceDiary(text) {
    const captionText = document.getElementById('care-caption-text');
    const helpText = document.getElementById('care-status-help');
    if (captionText) captionText.innerText = "사용자님의 귀중한 음성 일기를 비서관이 정리하여 저장 중입니다. 잠시만 기다려주세요...";
    if (helpText) helpText.innerText = "AI 비서가 답변을 조합 중입니다...";

    try {
        const token = await store.getSessionToken();

        const res = await fetch(`${API_URL}/analyze`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                title: `${new Date().toLocaleDateString('ko-KR')} 음성 일기 (케어모드)`,
                content: text,
                notebookId: 'nb-1'
            })
        });

        const data = await res.json();
        if (data.success) {
            let cleanResponse = data.answer.replace(/EVENT_JSON_START[\s\S]*EVENT_JSON_END/g, '').trim();
            cleanResponse = cleanResponse.replace(/감정:\[.*?\]/g, '').trim();

            if (captionText) captionText.innerText = cleanResponse;
            if (helpText) helpText.innerText = `오늘 감정: ${data.emotion}`;
            
            speakLoud(cleanResponse);

            // 리스트 자동 동기화용 이벤트 트리거
            const listUpdateEvent = new CustomEvent('diary-saved');
            window.dispatchEvent(listUpdateEvent);
        } else {
            throw new Error(data.error);
        }
    } catch (error) {
        console.error('Voice Diary Save failed:', error);
        const errorMsg = "기록 도중 잠시 지연이 발생했습니다. 편안하실 때 다시 말씀해 주시겠습니까?";
        if (captionText) captionText.innerText = errorMsg;
        speakLoud(errorMsg);
    }
}

// 7. TTS 음성 재생
function speakLoud(text) {
    if (!window.speechSynthesis) return;

    stopSpeaking();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'ko-KR';
    utterance.rate = 0.95; // 케어 대상자를 배려한 편안한 속도
    utterance.pitch = 1.0;

    const voices = window.speechSynthesis.getVoices();
    const premiumVoice = voices.find(v => v.name.includes('Yumi') || v.name.includes('Google 한국의') || v.lang === 'ko-KR');
    if (premiumVoice) {
        utterance.voice = premiumVoice;
    }

    utterance.onstart = () => {
        isSpeaking = true;
        const micBtn = document.getElementById('care-mic-btn');
        if (micBtn) micBtn.innerText = '⏹️';
    };

    utterance.onend = () => {
        isSpeaking = false;
        updateMicButtonUI();
        const helpText = document.getElementById('care-status-help');
        if (helpText) helpText.innerText = "말씀이 끝났습니다. 다시 녹음하시려면 마이크를 누르세요.";
    };

    utterance.onerror = () => {
        isSpeaking = false;
        updateMicButtonUI();
    };

    window.speechSynthesis.speak(utterance);
}

function stopSpeaking() {
    if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
    }
    isSpeaking = false;
}
