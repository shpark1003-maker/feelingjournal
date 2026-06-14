import { store, API_URL, assertIds } from './state.js?v=5.5.3';
import { loadPages } from './notebook.js?v=5.5.3';

let cropperInstance = null;
let cameraStream = null;

const EMOJI_DATA = {
    emotion: ['😊', '😍', '😂', '😭', '🥰', '😒', '😤', '😡', '😱', '😴', '🥳', '😇', '🤡', '👻', '💀', '👽', '🤖', '🎃', '😺', '👋', '👏', '🙌', '🙏', '💪'],
    nature: ['🌸', '🍀', '🌈', '☀️', '⭐', '🌙', '🔥', '💧', '❄️', '🍃', '🍁', '🍂', '🍄', '🌾', '🌵', '🌴', '🌲', '🌳', '🌱', '🌿', '🌞', '🌝', '🌍', '🌌'],
    food: ['🍎', '🍓', '🍕', '🍔', '🍦', '☕', '🍺', '🍰', '🍣', '🍜', '🍳', '🥐', '🥨', '🥯', '🥞', '🧀', '🍗', '🥩', '🥓', '🍔', '🍟', '핫도그', '🥪', '🌮'],
};

export function setupEditor() {
    assertIds('Editor', [
        'v2-quick-add-nb-btn', 'note-title', 'quill-editor', 'analyze-btn', 
        'analysis-result-area', 'analysis-content', 'camera-btn', 'scrap-btn', 'writing-helper-btn',
        'camera-modal', 'scrap-choice-modal', 'scrap-url-modal', 'scrap-crop-modal', 'writing-helper-panel'
    ]);

    if (typeof Quill === 'undefined') return;

    const Font = Quill.import('formats/font');
    Font.whitelist = ['serif', 'monospace', 'nanum'];
    Quill.register(Font, true);

    if (typeof QuillBlotFormatter !== 'undefined') {
        Quill.register('modules/blotFormatter', QuillBlotFormatter.default);
    }

    store.quillEditor = new Quill('#quill-editor', {
        theme: 'snow',
        modules: { 
            toolbar: '#quill-toolbar',
            blotFormatter: {}
        },
        placeholder: '오늘 당신의 마음은 어떤가요? 자유롭게 적어보세요...'
    });

    store.quillEditor.on('text-change', () => {
        const content = store.quillEditor.getText().trim();
        const input = document.getElementById('diary-input');
        if (input) input.value = content;
    });

    document.getElementById('analyze-btn')?.addEventListener('click', analyzeDiary);

    const editorLock = document.getElementById('v2-editor-e2e-lock');
    if (editorLock && !editorLock.dataset.bound) {
        editorLock.dataset.bound = "true";
        editorLock.style.cursor = 'pointer';
        editorLock.addEventListener('click', () => {
            const hasPass = localStorage.getItem('e2e_password');
            if (hasPass) {
                if (confirm('현재 E2E 암호화 비밀번호가 설정되어 있습니다. 비밀번호를 변경하거나 삭제하시겠습니까?\n확인(예)을 누르면 변경/삭제가 진행됩니다.')) {
                    const act = prompt('비밀번호를 새로 입력하시거나, 공백으로 두어 E2E 암호화를 비활성화하십시오:', hasPass);
                    if (act === null) return;
                    if (act.trim() === '') {
                        localStorage.removeItem('e2e_password');
                        alert('E2E 암호화가 비활성화되었습니다. (서버 평문 저장 정책 적용)');
                    } else {
                        localStorage.setItem('e2e_password', act.trim());
                        alert('E2E 암호화 비밀번호가 새롭게 설정되었습니다.');
                    }
                }
            } else {
                const pass = prompt('E2E 종단간 암호화 비밀번호를 입력해주세요. (입력 시 브라우저에서 직접 데이터를 암호화하여 저장합니다. 비밀번호는 서버로 전송되지 않습니다.):');
                if (pass && pass.trim() !== '') {
                    localStorage.setItem('e2e_password', pass.trim());
                    alert('E2E 암호화 비밀번호가 설정되었습니다. 이제 일기가 저장될 때 로컬에서 안전하게 암호화됩니다.');
                }
            }
        });
    }

    // V2 Toggle logic for share options
    const shareToggle = document.getElementById('share-toggle-input');
    const shareOptions = document.getElementById('share-options');
    if (shareToggle && shareOptions) {
        shareToggle.addEventListener('change', function() {
            if (this.checked) {
                shareOptions.classList.remove('opacity-50', 'pointer-events-none');
            } else {
                shareOptions.classList.add('opacity-50', 'pointer-events-none');
            }
        });
    }

    // Call sub UI loaders
    setupEmojiPicker();
    setupCamera();
    setupScrapLogic();
    setupWritingHelper();
    setupVoiceRecognition();
    setupLocalUpload();
}

export async function analyzeDiary() {
    if (store.isAnalysisRunning) return;

    const content = store.quillEditor.getText().trim();
    const richContent = store.quillEditor.root.innerHTML;
    const title = document.getElementById('note-title').value.trim();
    const v2NotebookSelect = document.getElementById('v2-notebook-select');
    const notebookId = v2NotebookSelect ? v2NotebookSelect.value : store.currentNotebookId;

    // Extract the first image for Gemini OCR
    let image = null;
    const imgMatch = richContent.match(/<img[^>]+src=["']([^"']+)["']/);
    if (imgMatch && imgMatch[1].startsWith('data:image')) {
        image = imgMatch[1];
    }

    if (!content && !image) return alert('분석할 내용이 없습니다.');

    store.isAnalysisRunning = true;
    const btn = document.getElementById('analyze-btn');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner"></span> 저장 중...';
    }

    try {
        console.log('Sending analyze request...');
        const token = await store.getSessionToken();

        let payload = { content, richContent, title, notebookId, image, aiConsent: true };
        const hasConsent = store.settings.aiConsent !== false;

        if (!hasConsent) {
            const { analyzeEmotionLocally, encryptClientSide } = await import('./localEmotionAnalyzer.js');
            const emotion = analyzeEmotionLocally(content);
            const e2ePassword = localStorage.getItem('e2e_password');

            let finalContent = content;
            let finalRich = richContent;
            let finalResponse = "AI 분석 동의가 비활성화되어 비서의 심층 조언이 제공되지 않습니다.";

            if (e2ePassword) {
                finalContent = await encryptClientSide(content, e2ePassword);
                finalRich = await encryptClientSide(richContent, e2ePassword);
                finalResponse = await encryptClientSide(finalResponse, e2ePassword);
            }

            payload = {
                content: finalContent,
                richContent: finalRich,
                response: finalResponse,
                title,
                notebookId,
                image,
                aiConsent: false,
                emotion
            };
        }

        const res = await fetch(`${API_URL}/analyze`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(payload)
        });

        const data = await res.json();
        console.log('Analyze response:', data);

        if (data.success) {
            // Update currentPageId so we don't create duplicates on subsequent saves
            if (data.id) {
                store.currentPageId = data.id;
            }
            
            if (hasConsent) {
                const resultArea = document.getElementById('analysis-result-area');
                const resultContent = document.getElementById('analysis-content');
                if (resultArea && resultContent) {
                    resultArea.classList.remove('hidden');
                    // Trigger reflow to apply transition properly
                    void resultArea.offsetWidth;
                    resultArea.classList.remove('opacity-0', 'translate-y-4');
                    resultArea.classList.add('opacity-100', 'translate-y-0');
                    resultContent.innerHTML = data.answer.replace(/\n/g, '<br>');
                }
                alert('비서가 분석을 완료하고 기록을 저장했습니다.');
            } else {
                const resultArea = document.getElementById('analysis-result-area');
                if (resultArea) {
                    resultArea.classList.add('hidden');
                }
                alert('기록이 안전하게 저장되었습니다.');
            }
            loadPages();
            // Scroll to the result area so the user sees the analysis
            if (resultArea) {
                resultArea.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
            if (data.event) {
                if (confirm(`AI가 새로운 일정을 제안했습니다: [${data.event.summary}]\n캘린더에 등록할까요?`)) {
                    registerEventToGoogle(data.event);
                }
            }
        } else {
            alert('저장 실패: ' + (data.error || data.answer || '알 수 없는 오류가 발생했습니다.'));
        }
    } catch (e) {
        console.error('Analyze Diary Error:', e);
        alert('저장 중 오류가 발생했습니다.');
    } finally {
        store.isAnalysisRunning = false;
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '저장';
        }
    }
}

export async function registerEventToGoogle(event) {
    try {
        const token = await store.getSessionToken();

        const res = await fetch(`${API_URL}/calendar/add`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(event)
        });

        const data = await res.json();
        if (data.success) alert('구글 캘린더에 일정이 성공적으로 등록되었습니다.');
        else alert('일정 등록 실패: ' + (data.error || '알 수 없는 오류'));
    } catch (e) {
        console.error('Event Registration Error:', e);
        alert('일정을 캘린더에 등록하는 중 네트워크 오류가 발생했습니다.');
    }
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

    const sendMsg = async (retryText) => {
        const text = (typeof retryText === 'string') ? retryText : input.value.trim();
        if (!text) return;
        if (typeof retryText !== 'string') {
            appendHelperMsg('user', text);
            input.value = '';
        }

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
                    context: `당신은 사용자의 일기 작성을 돕는 다정하고 유능한 "글쓰기 동반자이자 코치(Writing Guide)"입니다.
단순히 사용자가 한 말을 받아 적어 요약만 해주는 기계적인 비서가 되지 마십시오.
사용자가 자신의 하루를 성찰하고, 보다 풍부하고 감성적인 일기를 스스로 작성할 수 있도록 다음 원칙에 따라 가이드하십시오.

[대화 및 가이드 원칙]
1. 사용자가 단답형이나 짧은 단어(예: "힘들었어", "재밌었어")로 답하더라도, 공감과 경청의 리액션을 따뜻하게 건넨 후 구체적인 꼬리 질문을 던져 이야기를 이끌어내세요.
   * 예: "많이 지치셨겠어요. 오늘 어떤 일 때문에 가장 마음이 힘드셨는지 비서에게 조금만 더 들려주실 수 있나요?"
2. 일기를 쉽게 쓸 수 있도록 구체적인 글감(질문)을 한 번에 하나씩만 제안하세요. 
   - (1단계) 오늘 있었던 가장 인상 깊은 사건이나 행동
   - (2단계) 그 사건 속에서 느꼈던 감정이나 생각 (왜 그런 기분이 들었는지)
   - (3단계) 그 하루를 통해 얻은 작은 배움이나 내일 나에게 바라는 점
3. 문장 교정 팁이나 표현 추천도 자연스럽게 섞어주세요. (예: "이 감정은 '아쉬움'보다는 '뿌듯한 그리움'에 가까운 것 같네요. 일기에 쓸 때 '마음 한구석이 몽글몽글해졌다'고 표현해 보면 어떨까요?")
4. 존댓말과 따뜻하고 정제된 비서의 말투를 유지하되, 사용자가 편안함을 느끼도록 정서적으로 깊이 지지해 주세요.`
                })
            });
            const data = await res.json();
            if (data.success) {
                appendHelperMsg('bot', data.answer);
            } else {
                throw new Error(data.error || 'Server error');
            }
        } catch (err) {
            console.error(err);
            appendHelperErrorMsg(text);
        }
    };

    function appendHelperErrorMsg(retryText) {
        const area = document.getElementById('helper-chat-area');
        if (!area) return;
        const div = document.createElement('div');
        div.className = 'bot-msg error-bubble';
        div.style.display = 'flex';
        div.style.flexDirection = 'column';
        div.style.gap = '8px';
        div.style.background = '#ffebee';
        div.style.color = '#c0392b';
        div.style.borderColor = '#d63031';
        div.innerHTML = `
            <span>⚠️ 답변을 가져오는 도중 오류가 발생했습니다.</span>
            <button class="retry-helper-btn" style="align-self: flex-start; background: #D4A373; border: 2px solid #5D574D; border-radius: 8px; padding: 4px 8px; font-size: 0.75rem; color: white; cursor: pointer; font-weight: bold; box-shadow: 1px 1px 0px rgba(0,0,0,0.15); transition: transform 0.1s;">다시 보내기 ↻</button>
        `;
        const btn = div.querySelector('.retry-helper-btn');
        btn.addEventListener('click', () => {
            div.remove();
            sendMsg(retryText);
        });
        area.appendChild(div);
        area.scrollTop = area.scrollHeight;
    }

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
                // Remove previous edit containers if any
                const existingEditBox = document.getElementById('helper-edit-container');
                if (existingEditBox) existingEditBox.remove();

                const editContainer = document.createElement('div');
                editContainer.id = 'helper-edit-container';
                editContainer.style.marginTop = '16px';
                editContainer.style.padding = '12px';
                editContainer.style.background = '#F5EFEB';
                editContainer.style.border = '2px solid #5D574D';
                editContainer.style.borderRadius = '16px';
                editContainer.style.display = 'flex';
                editContainer.style.flexDirection = 'column';
                editContainer.style.gap = '10px';

                const titleLabel = document.createElement('label');
                titleLabel.innerText = '📝 일기 제목';
                titleLabel.style.fontWeight = 'bold';
                titleLabel.style.fontSize = '0.85rem';
                titleLabel.style.color = '#4A6741';

                const todayStr = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
                const titleInput = document.createElement('input');
                titleInput.type = 'text';
                titleInput.value = `${todayStr}의 기록`;
                titleInput.style.width = '100%';
                titleInput.style.padding = '8px 12px';
                titleInput.style.border = '2px solid #5D574D';
                titleInput.style.borderRadius = '12px';
                titleInput.style.fontSize = '0.85rem';
                titleInput.style.background = '#ffffff';

                const contentLabel = document.createElement('label');
                contentLabel.innerText = '✍️ 초안 내용 (마음껏 수정해 보세요)';
                contentLabel.style.fontWeight = 'bold';
                contentLabel.style.fontSize = '0.85rem';
                contentLabel.style.color = '#4A6741';

                const contentTextarea = document.createElement('textarea');
                contentTextarea.rows = 8;
                contentTextarea.value = data.answer;
                contentTextarea.style.width = '100%';
                contentTextarea.style.padding = '8px 12px';
                contentTextarea.style.border = '2px solid #5D574D';
                contentTextarea.style.borderRadius = '12px';
                contentTextarea.style.fontSize = '0.85rem';
                contentTextarea.style.resize = 'vertical';
                contentTextarea.style.background = '#ffffff';
                contentTextarea.style.lineHeight = '1.5';

                const insertBtn = document.createElement('button');
                insertBtn.innerText = '에디터에 적용하기 ✨';
                insertBtn.style.background = '#4A6741';
                insertBtn.style.color = 'white';
                insertBtn.style.border = '2px solid #5D574D';
                insertBtn.style.padding = '10px';
                insertBtn.style.borderRadius = '12px';
                insertBtn.style.fontWeight = 'bold';
                insertBtn.style.cursor = 'pointer';
                insertBtn.style.fontSize = '0.85rem';
                insertBtn.style.transition = 'transform 0.1s';

                insertBtn.addEventListener('click', () => {
                    const finalTitle = titleInput.value.trim();
                    const finalContent = contentTextarea.value.trim();

                    if (store.quillEditor) {
                        document.getElementById('note-title').value = finalTitle;
                        store.quillEditor.root.innerHTML = `<p>${finalContent.replace(/\n/g, '</p><p>')}</p>`;
                    }
                    alert('일기 본문이 에디터에 적용되었습니다! 노트를 저장하여 작성을 완료하세요.');
                    panel.classList.add('hidden');
                    editContainer.remove();
                });

                editContainer.appendChild(titleLabel);
                editContainer.appendChild(titleInput);
                editContainer.appendChild(contentLabel);
                editContainer.appendChild(contentTextarea);
                editContainer.appendChild(insertBtn);

                const area = document.getElementById('helper-chat-area');
                if (area) {
                    area.appendChild(editContainer);
                    area.scrollTop = area.scrollHeight;
                }
            } else {
                alert('일기 생성 실패: ' + data.error);
            }
        } catch (err) {
            console.error(err);
            alert('일기 생성 중 오류 발생');
        } finally {
            finishBtn.disabled = false;
            finishBtn.innerText = '일기 완성하기';
        }
    });
}

function startHelperConversation() {
    const area = document.getElementById('helper-chat-area');
    if (!area) return;
    area.innerHTML = '';
    appendHelperMsg('bot', '안녕하세요! 오늘 하루도 참 고생 많으셨습니다. 숲속의 작은 서재에 오신 것을 환영해요. 숲속의 정령 비서가 당신의 하루를 아름다운 기록으로 함께 엮어 드릴게요. 😊\n\n오늘 하루 중 가장 기억에 남는 하나의 순간이나 머릿속에 맴도는 생각은 무엇인가요? 편안하게 들려주세요.');
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

export function setupLocalUpload() {
    const uploadBtn = document.getElementById('local-upload-btn');
    const fileInput = document.getElementById('editor-local-file-input');

    if (!uploadBtn || !fileInput) return;

    uploadBtn.addEventListener('click', () => {
        fileInput.click();
    });

    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        if (file.size > 5 * 1024 * 1024) {
            alert('사진 크기는 최대 5MB를 초과할 수 없습니다.');
            fileInput.value = '';
            return;
        }

        const reader = new FileReader();
        reader.onload = (event) => {
            const imgUrl = event.target.result;
            if (store.quillEditor) {
                const range = store.quillEditor.getSelection(true);
                store.quillEditor.insertEmbed(range.index, 'image', imgUrl);
                store.quillEditor.setSelection(range.index + 1);
            }
            fileInput.value = ''; // Reset to allow same file selection
        };
        reader.readAsDataURL(file);
    });
}
