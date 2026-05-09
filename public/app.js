document.addEventListener('DOMContentLoaded', () => {
    console.log('App initialization started...');
    
    const diaryInput = document.getElementById('diary-input');
    const voiceBtn = document.getElementById('voice-btn');
    const analyzeBtn = document.getElementById('analyze-btn');
    const responseBox = document.getElementById('ai-response-box');
    const responseText = document.getElementById('response-text');
    const historyList = document.getElementById('history-list');
    const sortNewestBtn = document.getElementById('sort-newest');
    const sortOldestBtn = document.getElementById('sort-oldest');
    
    let diaryHistory = [];
    let currentSort = 'newest';

    // 로컬 스토리지에서 이전 기록 불러오기 (초기 화면용)
    const savedDiary = localStorage.getItem('lastDiary');
    const savedResponse = localStorage.getItem('lastResponse');
    if (savedDiary) diaryInput.value = savedDiary;
    if (savedResponse) responseText.innerHTML = savedResponse.replace(/\n/g, '<br>');

    // 히스토리 불러오기 함수
    const loadHistory = async () => {
        try {
            const response = await fetch('/api/history');
            const data = await response.json();
            
            if (data.history) {
                diaryHistory = data.history;
                renderHistory();
            }
        } catch (error) {
            console.error('History Load Error:', error);
        }
    };

    // 히스토리 렌더링 함수
    const renderHistory = () => {
        if (!historyList) return;
        
        historyList.innerHTML = '';
        
        // 정렬
        const sorted = [...diaryHistory].sort((a, b) => {
            const timeA = new Date(a.createdAt).getTime();
            const timeB = new Date(b.createdAt).getTime();
            return currentSort === 'newest' ? timeB - timeA : timeA - timeB;
        });

        if (sorted.length === 0) {
            historyList.innerHTML = '<p class="empty-msg">아직 기록된 일기가 없습니다. 첫 일기를 작성해 보세요! ✍️</p>';
            return;
        }

        sorted.forEach(item => {
            const card = document.createElement('div');
            card.className = 'history-card';
            
            const emotion = extractEmotion(item.aiResponse);
            const dateStr = formatDate(item.createdAt);
            
            card.innerHTML = `
                <div class="card-header">
                    <span class="card-date">${dateStr}</span>
                    <span class="card-emotion">${emotion}</span>
                </div>
                <p class="card-content">${item.originalContent}</p>
                <div class="card-ai">${item.aiResponse.split('\n').filter(l => l.trim()).slice(-1)[0] || ''}</div>
            `;
            
            card.addEventListener('click', () => {
                diaryInput.value = item.originalContent;
                responseText.innerHTML = item.aiResponse.replace(/\n/g, '<br>');
                window.scrollTo({ top: 0, behavior: 'smooth' });
                responseBox.classList.add('highlight');
                setTimeout(() => responseBox.classList.remove('highlight'), 1000);
            });
            
            historyList.appendChild(card);
        });
    };

    // 감정 추출 유틸리티
    const extractEmotion = (text) => {
        const match = text.match(/감정:\[(.*?)\]/);
        return match ? match[1] : '분석완료';
    };

    // 날짜 포맷 유틸리티
    const formatDate = (dateString) => {
        const date = new Date(dateString);
        return `${date.getFullYear()}.${(date.getMonth() + 1).toString().padStart(2, '0')}.${date.getDate().toString().padStart(2, '0')} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
    };

    // 정렬 버튼 이벤트
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

    // 분석 요청 버튼 클릭 이벤트
    analyzeBtn.addEventListener('click', async () => {
        const content = diaryInput.value.trim();
        
        if (!content) {
            alert('일기를 먼저 작성해 주세요!');
            return;
        }

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

            if (data.error) throw new Error(data.error);

            const formattedAnswer = data.answer.replace(/\n/g, '<br>');
            responseText.innerHTML = formattedAnswer;

            localStorage.setItem('lastDiary', content);
            localStorage.setItem('lastResponse', data.answer);
            
            // 히스토리 즉시 갱신
            setTimeout(loadHistory, 1000); 
        } catch (error) {
            console.error('Analysis Error:', error);
            responseText.textContent = '죄송합니다. 분석 중에 오류가 발생했습니다. 다시 시도해 주세요.';
        } finally {
            responseBox.classList.remove('loading');
            analyzeBtn.disabled = false;
        }
    });

    // 앱 시작 시 히스토리 로드
    loadHistory();

    // 음성 인식 설정
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
            diaryInput.placeholder = '말씀해 주세요...';
        };

        recognition.onresult = (event) => {
            let finalTranscript = '';
            let interimTranscript = '';
            for (let i = 0; i < event.results.length; ++i) {
                const transcript = event.results[i][0].transcript;
                if (event.results[i].isFinal) finalTranscript += transcript;
                else interimTranscript += transcript;
            }
            diaryInput.value = initialText + finalTranscript + interimTranscript;
            diaryInput.scrollTop = diaryInput.scrollHeight;
        };

        recognition.onend = () => {
            isRecording = false;
            voiceBtn.innerHTML = '<span class="icon">🎙️</span> 음성으로 입력하기';
            voiceBtn.classList.remove('recording');
            diaryInput.placeholder = '여기에 일기를 작성해 주세요...';
        };

        recognition.onerror = (event) => {
            console.error('Speech recognition error:', event.error);
            recognition.stop();
        };
    }

    voiceBtn.addEventListener('click', () => {
        if (!recognition) {
            alert('이 브라우저는 음성 인식을 지원하지 않습니다.');
            return;
        }
        if (isRecording) recognition.stop();
        else recognition.start();
    });

    diaryInput.addEventListener('focus', () => responseBox.style.opacity = '0.7');
    diaryInput.addEventListener('blur', () => responseBox.style.opacity = '1');
});
