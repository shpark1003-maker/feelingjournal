import { store, API_URL } from './state.js';
import { loadPages } from './notebook.js';

let cropperInstance = null;
let cameraStream = null;

const EMOJI_DATA = {
    emotion: ['😊', '😍', '😂', '😭', '🥰', '😒', '😤', '😡', '😱', '😴', '🥳', '😇', '🤡', '👻', '💀', '👽', '🤖', '🎃', '😺', '👋', '👏', '🙌', '🙏', '💪'],
    nature: ['🌸', '🍀', '🌈', '☀️', '⭐', '🌙', '🔥', '💧', '❄️', '🍃', '🍁', '🍂', '🍄', '🌾', '🌵', '🌴', '🌲', '🌳', '🌱', '🌿', '🌞', '🌝', '🌍', '🌌'],
    food: ['🍎', '🍓', '🍕', '🍔', '🍦', '☕', '🍺', '🍰', '🍣', '🍜', '🍳', '🥐', '🥨', '🥯', '🥞', '🧀', '🍗', '🥩', '🥓', '🍔', '🍟', '핫도그', '🥪', '🌮'],
};

export function setupEditor() {
    if (typeof Quill === 'undefined') return;

    const Font = Quill.import('formats/font');
    Font.whitelist = ['serif', 'monospace', 'nanum'];
    Quill.register(Font, true);

    store.quillEditor = new Quill('#quill-editor', {
        theme: 'snow',
        modules: { toolbar: '#quill-toolbar' },
        placeholder: '오늘 당신의 마음은 어떤가요? 자유롭게 적어보세요...'
    });

    store.quillEditor.on('text-change', () => {
        const content = store.quillEditor.getText().trim();
        const input = document.getElementById('diary-input');
        if (input) input.value = content;
    });

    document.getElementById('analyze-btn')?.addEventListener('click', analyzeDiary);

    // Call sub UI loaders
    setupEmojiPicker();
    setupCamera();
    setupScrapLogic();
    setupWritingHelper();
    setupVoiceRecognition();
}

export async function analyzeDiary() {
    if (store.isAnalysisRunning) return;

    const content = store.quillEditor.getText().trim();
    const richContent = store.quillEditor.root.innerHTML;
    const title = document.getElementById('note-title').value.trim();

    if (!content) return alert('분석할 내용이 없습니다.');

    store.isAnalysisRunning = true;
    const btn = document.getElementById('analyze-btn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> 분석 중...';

    try {
        const token = await store.getSessionToken();
        const providerToken = await store.getProviderToken();

        const res = await fetch(`${API_URL}/analyze`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
                'x-provider-token': providerToken || ''
            },
            body: JSON.stringify({ content, richContent, title, notebookId: store.currentNotebookId })
        });

        const data = await res.json();
        if (data.success) {
            const resultArea = document.getElementById('analysis-result-area');
            const resultContent = document.getElementById('analysis-content');
            if (resultArea && resultContent) {
                resultArea.classList.remove('hidden');
                resultContent.innerHTML = data.answer.replace(/\n/g, '<br>');
            }
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
        store.isAnalysisRunning = false;
        btn.disabled = false;
        btn.innerHTML = 'AI 분석 및 저장';
    }
}

export async function registerEventToGoogle(event) {
    const token = await store.getSessionToken();
    const providerToken = await store.getProviderToken();

    const res = await fetch(`${API_URL}/calendar/add`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
            'x-provider-token': providerToken || ''
        },
        body: JSON.stringify(event)
    });

    const data = await res.json();
    if (data.success) alert('구글 캘린더에 일정이 성공적으로 등록되었습니다.');
}

export function setupEmojiPicker() {
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
                if (store.quillEditor) {
                    const range = store.quillEditor.getSelection(true);
                    store.quillEditor.insertText(range.index, item.innerText);
                    store.quillEditor.setSelection(range.index + item.innerText.length);
                }
                panel.classList.add('hidden');
            });
        });
    }

    document.addEventListener('click', () => panel?.classList.add('hidden'));
    panel?.addEventListener('click', (e) => e.stopPropagation());
}

export function setupCamera() {
    const cameraBtn = document.getElementById('camera-btn');
    const cameraModal = document.getElementById('camera-modal');
    const webcamView = document.getElementById('webcam-view');
    const snapshotCanvas = document.getElementById('snapshot-canvas');
    const cameraCloseBtn = document.getElementById('camera-close-btn');
    const shutterBtn = document.getElementById('shutter-btn');

    if (!cameraBtn || !cameraModal) return;

    cameraBtn.addEventListener('click', async () => {
        try {
            cameraStream = await navigator.mediaDevices.getUserMedia({
                video: { width: 1280, height: 720 },
                audio: false
            });
            if (webcamView) webcamView.srcObject = cameraStream;
            cameraModal.style.display = 'flex';
        } catch (err) {
            console.error('Camera Access Error:', err);
            alert('카메라 하드웨어 권한 획득에 실패하여, 카메라 스냅 기능을 실행할 수 없습니다. 설정에서 권한을 확인해 주세요.');
            closeCamera();
        }
    });

    const closeCamera = () => {
        if (cameraStream) {
            cameraStream.getTracks().forEach(track => track.stop());
            cameraStream = null;
        }
        cameraModal.style.display = 'none';
        if (webcamView) webcamView.srcObject = null;
    };

    cameraCloseBtn?.addEventListener('click', closeCamera);

    shutterBtn?.addEventListener('click', () => {
        if (!cameraStream || !webcamView || !snapshotCanvas) return;

        const ctx = snapshotCanvas.getContext('2d');
        snapshotCanvas.width = webcamView.videoWidth || 640;
        snapshotCanvas.height = webcamView.videoHeight || 480;

        ctx.drawImage(webcamView, 0, 0, snapshotCanvas.width, snapshotCanvas.height);
        const imgUrl = snapshotCanvas.toDataURL('image/jpeg', 0.85);

        if (store.quillEditor) {
            const range = store.quillEditor.getSelection(true);
            store.quillEditor.insertEmbed(range.index, 'image', imgUrl);
            store.quillEditor.setSelection(range.index + 1);
        }

        closeCamera();
    });
}

export function setupScrapLogic() {
    const scrapBtn = document.getElementById('scrap-btn');
    const choiceModal = document.getElementById('scrap-choice-modal');
    const closeChoiceBtn = document.getElementById('close-scrap-choice-btn');
    const optUrlSnapshot = document.getElementById('opt-url-snapshot');
    const optAreaCapture = document.getElementById('opt-area-capture');

    const urlModal = document.getElementById('scrap-url-modal');
    const closeUrlBtn = document.getElementById('close-scrap-url-btn');
    const urlInput = document.getElementById('scrap-url-input');
    const btnDoUrlScrap = document.getElementById('btn-do-url-scrap');

    const cropModal = document.getElementById('scrap-crop-modal');
    const cropTargetImg = document.getElementById('crop-target-img');
    const btnDoAreaScrap = document.getElementById('btn-do-area-scrap');

    if (!scrapBtn || !choiceModal) return;

    scrapBtn.addEventListener('click', () => {
        choiceModal.classList.remove('hidden');
        choiceModal.style.display = 'flex';
    });

    closeChoiceBtn?.addEventListener('click', () => {
        choiceModal.classList.add('hidden');
        choiceModal.style.display = 'none';
    });

    optUrlSnapshot?.addEventListener('click', () => {
        choiceModal.classList.add('hidden');
        choiceModal.style.display = 'none';
        if (urlModal) {
            urlModal.classList.remove('hidden');
            urlModal.style.display = 'flex';
        }
        if (urlInput) urlInput.focus();
    });

    closeUrlBtn?.addEventListener('click', () => {
        if (urlModal) {
            urlModal.classList.add('hidden');
            urlModal.style.display = 'none';
        }
    });

    btnDoUrlScrap?.addEventListener('click', () => {
        const url = urlInput ? urlInput.value.trim() : '';
        if (url) {
            performUrlScrap(url);
            if (urlModal) {
                urlModal.classList.add('hidden');
                urlModal.style.display = 'none';
            }
        } else {
            alert('웹 주소를 입력해 주세요.');
        }
    });

    optAreaCapture?.addEventListener('click', async () => {
        choiceModal.classList.add('hidden');
        choiceModal.style.display = 'none';

        const scrapBtn = document.getElementById('scrap-btn');
        const originalText = scrapBtn ? scrapBtn.innerHTML : '🌐 스크랩';
        if (scrapBtn) {
            scrapBtn.innerHTML = '🌐 화면 캡처 대기...';
            scrapBtn.disabled = true;
        }

        try {
            if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
                throw new Error('이 브라우저는 실시간 화면 캡처 API(getDisplayMedia)를 지원하지 않습니다.');
            }

            // 시스템 화면 공유 및 캡처 요청 (사용자가 다른 탭, 창, 모니터 화면 중 선택 가능)
            const stream = await navigator.mediaDevices.getDisplayMedia({
                video: {
                    displaySurface: "monitor",
                    width: { ideal: 1920 },
                    height: { ideal: 1080 }
                },
                audio: false
            });

            // 임시 비디오 엘리먼트에 스트림 연결하여 캔버스 드로잉 준비
            const video = document.createElement('video');
            video.srcObject = stream;
            video.muted = true;
            video.playsInline = true;

            await new Promise((resolve, reject) => {
                video.onloadedmetadata = () => {
                    video.play().then(resolve).catch(reject);
                };
                video.onerror = reject;
            });

            // 비디오의 첫 프레임을 캔버스에 찰칵 복사
            const canvas = document.createElement('canvas');
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

            // 캡처가 끝났으므로 화면 공유 트랙을 즉각 정지하여 공유 중단
            stream.getTracks().forEach(track => track.stop());

            const dataUrl = canvas.toDataURL('image/jpeg', 0.9);

            if (cropTargetImg) {
                cropTargetImg.src = dataUrl;
            }

            if (cropModal) {
                cropModal.classList.remove('hidden');
                cropModal.style.display = 'flex';
            }

            if (cropperInstance) cropperInstance.destroy();
            cropperInstance = new Cropper(cropTargetImg, {
                aspectRatio: NaN,
                viewMode: 1,
                autoCropArea: 0.8,
                background: false
            });

        } catch (err) {
            console.error('화면 영역 캡처 에러:', err);
            // 사용자가 화면 선택 팝업창에서 '취소'를 눌렀을 때(NotAllowedError)는 의도적인 취소이므로 경고창 생략
            if (err.name !== 'NotAllowedError') {
                alert('화면 영역 캡처에 실패했습니다: ' + err.message);
            }
        } finally {
            if (scrapBtn) {
                scrapBtn.innerHTML = originalText;
                scrapBtn.disabled = false;
            }
        }
    });

    document.getElementById('close-scrap-crop-btn')?.addEventListener('click', () => {
        if (cropModal) {
            cropModal.classList.add('hidden');
            cropModal.style.display = 'none';
        }
        if (cropperInstance) {
            cropperInstance.destroy();
            cropperInstance = null;
        }
    });

    btnDoAreaScrap?.addEventListener('click', async () => {
        if (!cropperInstance) return;

        btnDoAreaScrap.disabled = true;
        btnDoAreaScrap.innerHTML = '<span class="spinner"></span> 분석 중...';

        const canvas = cropperInstance.getCroppedCanvas({
            maxWidth: 1920,
            maxHeight: 1080
        });

        canvas.toBlob(async (blob) => {
            if (!blob) {
                alert('이미지 크롭에 실패했습니다.');
                btnDoAreaScrap.disabled = false;
                btnDoAreaScrap.innerText = '분석 시작';
                return;
            }

            const formData = new FormData();
            formData.append('image', blob, 'screenshot.jpg');

            try {
                const token = await store.getSessionToken();
                const res = await fetch(`${API_URL}/scrap-screenshot`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${token}` },
                    body: formData
                });

                const data = await res.json();
                if (data.success) {
                    const titleEl = document.getElementById('note-title');
                    if (titleEl) titleEl.value = data.title || '스크랩한 페이지';
                    if (store.quillEditor) {
                        store.quillEditor.root.innerHTML = `<p>${(data.content || '').replace(/\n/g, '</p><p>')}</p>`;
                    }
                    alert('화면 분석 및 텍스트 추출이 완료되었습니다.');
                    if (cropModal) {
                        cropModal.classList.add('hidden');
                        cropModal.style.display = 'none';
                    }
                    if (cropperInstance) {
                        cropperInstance.destroy();
                        cropperInstance = null;
                    }
                } else {
                    alert('영역 스캔 실패: ' + data.error);
                }
            } catch (err) {
                console.error(err);
                alert('분석 중 서버 오류가 발생했습니다.');
            } finally {
                btnDoAreaScrap.disabled = false;
                btnDoAreaScrap.innerText = '분석 시작';
            }
        }, 'image/jpeg', 0.85);
    });
}

export async function performUrlScrap(url) {
    const token = await store.getSessionToken();
    const scrapBtn = document.getElementById('scrap-btn');
    const originalText = scrapBtn ? scrapBtn.innerHTML : '🌐 스크랩';
    if (scrapBtn) {
        scrapBtn.innerHTML = '🌐 스캔 중...';
        scrapBtn.disabled = true;
    }

    try {
        const res = await fetch(`${API_URL}/scrap-url-snapshot`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ url })
        });
        const data = await res.json();
        if (data.success) {
            const titleEl = document.getElementById('note-title');
            if (titleEl) titleEl.value = data.title || '스크랩된 웹페이지';
            if (store.quillEditor) {
                store.quillEditor.root.innerHTML = `<p>${(data.content || '').replace(/\n/g, '</p><p>')}</p>`;
            }
            alert('웹 페이지 내용을 성공적으로 가져왔습니다.');
        } else {
            alert('스크랩 실패: ' + data.error);
        }
    } catch (e) {
        alert('스크랩 중 오류가 발생했습니다.');
    } finally {
        if (scrapBtn) {
            scrapBtn.innerHTML = originalText;
            scrapBtn.disabled = false;
        }
    }
}

export function setupWritingHelper() {
    const btn = document.getElementById('writing-helper-btn');
    const panel = document.getElementById('writing-helper-panel');
    const closeBtn = document.getElementById('close-helper-btn');
    const sendBtn = document.getElementById('send-helper-reply-btn');
    const input = document.getElementById('helper-reply-input');
    const finishBtn = document.getElementById('finish-helper-btn');

    btn?.addEventListener('click', () => {
        panel.classList.toggle('hidden');
        if (!panel.classList.contains('hidden')) {
            startHelperConversation();
        }
    });

    closeBtn?.addEventListener('click', () => panel.classList.add('hidden'));

    const sendMsg = async () => {
        const text = input.value.trim();
        if (!text) return;
        appendHelperMsg('user', text);
        input.value = '';

        try {
            const token = await store.getSessionToken();
            const res = await fetch(`${API_URL}/chat/ai-response`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ message: text, context: '사용자가 일기를 쓰기 위해 도움을 요청하고 있습니다.' })
            });
            const data = await res.json();
            if (data.success) appendHelperMsg('bot', data.answer);
        } catch (err) {
            console.error(err);
            appendHelperMsg('bot', '답변을 가져오는 도중 오류가 발생했습니다.');
        }
    };

    sendBtn?.addEventListener('click', sendMsg);
    input?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendMsg();
    });

    finishBtn?.addEventListener('click', async () => {
        const messages = Array.from(document.querySelectorAll('#helper-chat-area div')).map(el => {
            const isUser = el.className.includes('user-msg');
            return `${isUser ? '사용자' : '비서'}: ${el.innerText}`;
        }).join('\n');

        if (messages.length < 20) {
            return alert('더 풍부한 대화를 나눈 후에 일기를 생성해 보세요!');
        }

        finishBtn.disabled = true;
        finishBtn.innerHTML = '<span class="spinner"></span> 일기 작성 중...';

        try {
            const token = await store.getSessionToken();
            const res = await fetch(`${API_URL}/chat/ai-response`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    message: `[일기 생성 요청] 아래 나누었던 대화 기록을 바탕으로 감정이 풍부한 1인칭 시점의 일기를 완성해줘.\n\n대화 기록:\n${messages}`,
                    context: '사용자가 비서와의 대화를 바탕으로 오늘의 일기를 작성해 달라고 요청했습니다. 대화 내용을 핵심적으로 반영하여 가슴이 따뜻해지는 아름다운 일기를 본문만 작성해 주세요. 머리말이나 인사말은 생략하고 일기 내용만 리턴해주세요.'
                })
            });

            const data = await res.json();
            if (data.success) {
                if (store.quillEditor) {
                    const todayStr = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
                    document.getElementById('note-title').value = `${todayStr}의 기록`;
                    store.quillEditor.root.innerHTML = `<p>${data.answer.replace(/\n/g, '</p><p>')}</p>`;
                }
                alert('대화 내용을 기반으로 일기 초안이 작성되었습니다! 에디터에서 자유롭게 편집해 보세요.');
                panel.classList.add('hidden');
            } else {
                alert('일기 생성 실패: ' + data.error);
            }
        } catch (err) {
            alert('일기 생성 중 오류 발생');
        } finally {
            finishBtn.disabled = false;
            finishBtn.innerText = '일기 생성';
        }
    });
}

function startHelperConversation() {
    const area = document.getElementById('helper-chat-area');
    if (!area) return;
    area.innerHTML = '';
    appendHelperMsg('bot', '안녕하세요! 오늘 하루는 어떠셨나요? 무엇이든 이야기해 주시면 제가 일기로 정리해 드릴게요.');
}

function appendHelperMsg(type, text) {
    const area = document.getElementById('helper-chat-area');
    if (!area) return;
    const div = document.createElement('div');
    div.className = `${type}-msg`;
    div.innerText = text;
    area.appendChild(div);
    area.scrollTop = area.scrollHeight;
}

export function setupVoiceRecognition() {
    const voiceBtn = document.getElementById('voice-btn');
    if (!voiceBtn) return;

    let recognition = null;
    let isListening = false;

    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
        const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
        recognition = new SpeechRec();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'ko-KR';

        recognition.onstart = () => {
            isListening = true;
            voiceBtn.style.background = '#ff4757';
            voiceBtn.style.color = 'white';
            const txt = voiceBtn.querySelector('.btn-text');
            if (txt) txt.innerText = '듣는 중...';
        };

        recognition.onend = () => {
            isListening = false;
            voiceBtn.style.background = '';
            voiceBtn.style.color = '';
            const txt = voiceBtn.querySelector('.btn-text');
            if (txt) txt.innerText = '음성';
        };

        recognition.onerror = (e) => {
            console.error('Speech Recognition Error:', e);
            isListening = false;
            recognition.stop();
        };

        recognition.onresult = (event) => {
            let finalTranscript = '';
            for (let i = event.resultIndex; i < event.results.length; ++i) {
                if (event.results[i].isFinal) {
                    finalTranscript += event.results[i][0].transcript;
                }
            }

            if (finalTranscript && store.quillEditor) {
                const range = store.quillEditor.getSelection(true);
                store.quillEditor.insertText(range.index, ' ' + finalTranscript);
                store.quillEditor.setSelection(range.index + finalTranscript.length + 1);
            }
        };
    }

    voiceBtn.addEventListener('click', () => {
        if (!recognition) {
            return alert('이 브라우저는 음성 인식을 지원하지 않습니다. 크롬 또는 사파리를 권장합니다.');
        }

        if (isListening) {
            recognition.stop();
        } else {
            try {
                recognition.start();
            } catch (err) {
                console.error(err);
            }
        }
    });
}
