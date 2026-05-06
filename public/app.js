document.addEventListener('DOMContentLoaded', () => {
    console.log('App initialization started...');
    
    const diaryInput = document.getElementById('diary-input');
    const voiceBtn = document.getElementById('voice-btn');
    const analyzeBtn = document.getElementById('analyze-btn');
    const responseBox = document.getElementById('ai-response-box');
    const responseText = document.getElementById('response-text');
    
    // [추가] 로컬 스토리지에서 이전 기록 불러오기
    const savedDiary = localStorage.getItem('lastDiary');
    const savedResponse = localStorage.getItem('lastResponse');

    if (savedDiary) {
        diaryInput.value = savedDiary;
    }
    if (savedResponse) {
        responseText.innerHTML = savedResponse.replace(/\n/g, '<br>');
    }

    // 분석 요청 버튼 클릭 이벤트
    analyzeBtn.addEventListener('click', async () => {
        const content = diaryInput.value.trim();
        
        if (!content) {
            alert('일기를 먼저 작성해 주세요!');
            return;
        }

        // 로딩 상태 표시
        responseText.textContent = 'AI가 당신의 일기를 정성껏 읽고 있습니다... 잠시만 기다려 주세요. ✨';
        responseBox.classList.add('loading');
        analyzeBtn.disabled = true;

        try {
            const response = await fetch('/api/analyze', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ content }),
            });

            const data = await response.json();

            if (data.error) {
                throw new Error(data.error);
            }

            // 결과 표시
            const formattedAnswer = data.answer.replace(/\n/g, '<br>');
            responseText.innerHTML = formattedAnswer;

            // [추가] 로컬 스토리지에 저장
            localStorage.setItem('lastDiary', content);
            localStorage.setItem('lastResponse', data.answer);
        } catch (error) {
            console.error('Analysis Error:', error);
            responseText.textContent = '죄송합니다. 분석 중에 오류가 발생했습니다. 다시 시도해 주세요.';
        } finally {
            responseBox.classList.remove('loading');
            analyzeBtn.disabled = false;
            responseText.style.color = '#2d3436';
        }
    });

    // 음성 인식 설정
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    let recognition = null;
    let isRecording = false;

    if (SpeechRecognition) {
        recognition = new SpeechRecognition();
        recognition.lang = 'ko-KR';
        recognition.continuous = true;
        recognition.interimResults = true;
        console.log('✅ 음성 인식 시스템 준비 완료 (ko-KR)');

        let initialText = '';

        recognition.onstart = () => {
            isRecording = true;
            initialText = diaryInput.value + (diaryInput.value ? ' ' : ''); // 기존 텍스트 저장 및 공백 처리
            voiceBtn.innerHTML = '<span class="icon">🛑</span> 녹음 중지하기';
            voiceBtn.classList.add('recording');
            diaryInput.placeholder = '말씀해 주세요...';
            console.log('Recognition started. Initial text saved.');
        };

        recognition.onresult = (event) => {
            let finalTranscript = '';
            let interimTranscript = '';

            for (let i = 0; i < event.results.length; ++i) {
                const transcript = event.results[i][0].transcript;
                if (event.results[i].isFinal) {
                    finalTranscript += transcript;
                } else {
                    interimTranscript += transcript;
                }
            }

            // 전체 텍스트 업데이트: 시작 전 텍스트 + 인식 완료된 텍스트 + 인식 중인 텍스트
            diaryInput.value = initialText + finalTranscript + interimTranscript;
            
            // 입력창 하단으로 자동 스크롤
            diaryInput.scrollTop = diaryInput.scrollHeight;
            console.log('Transcript updated:', diaryInput.value);
        };

        recognition.onend = () => {
            isRecording = false;
            voiceBtn.innerHTML = '<span class="icon">🎙️</span> 음성으로 입력하기';
            voiceBtn.classList.remove('recording');
            diaryInput.placeholder = '여기에 일기를 작성해 주세요...';
            console.log('Recognition ended.');
        };

        // 소리 감지 이벤트 추가
        recognition.onsoundstart = () => console.log('🔊 소리가 감지되었습니다.');
        recognition.onspeechstart = () => console.log('🗣️ 음성 인식이 시작되었습니다.');
        recognition.onaudiostart = () => console.log('🎙️ 오디오 캡처가 시작되었습니다.');

        recognition.onerror = (event) => {
            console.error('Speech recognition error:', event.error);
            if (event.error === 'no-speech') {
                console.warn('인식된 목소리가 없습니다. 마이크 설정을 확인해 주세요.');
            } else if (event.error === 'not-allowed') {
                alert('마이크 사용 권한이 거부되었습니다. 주소창의 자물쇠 아이콘을 클릭하여 마이크를 허용해 주세요.');
            } else {
                alert('음성 인식 중 오류가 발생했습니다: ' + event.error);
            }
            recognition.stop();
        };
    }

    // 음성 입력 버튼 클릭 이벤트
    voiceBtn.addEventListener('click', () => {
        console.log('Voice button clicked. Current recording state:', isRecording);
        
        if (!recognition) {
            console.error('SpeechRecognition API not supported in this browser.');
            alert('이 브라우저는 음성 인식을 지원하지 않습니다. Chrome 또는 Edge를 사용해 주세요.');
            return;
        }

        if (isRecording) {
            try {
                recognition.stop();
                console.log('Recognition stop requested.');
            } catch (e) {
                console.error('Error stopping recognition:', e);
            }
        } else {
            try {
                recognition.start();
                console.log('Recognition start requested.');
            } catch (e) {
                console.error('Error starting recognition:', e);
                // 이미 시작된 경우 등의 오류 처리
                if (e.name === 'InvalidStateError') {
                    recognition.stop();
                    setTimeout(() => recognition.start(), 100);
                }
            }
        }
    });

    // 입력창 애니메이션 효과
    diaryInput.addEventListener('focus', () => {
        responseBox.style.opacity = '0.7';
    });

    diaryInput.addEventListener('blur', () => {
        responseBox.style.opacity = '1';
    });
});
