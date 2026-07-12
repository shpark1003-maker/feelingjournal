import { store, API_URL } from '../state.js';
import { escapeHTML } from './sanitize.js';
import { getTodayKSTDateString } from './dateUtils.js';

export function initAiAngel(loadCalendarCallback) {
    const angelSendBtn = document.getElementById('ai-angel-send-btn');
    const angelInput = document.getElementById('ai-angel-input');
    const angelChatBox = document.getElementById('ai-angel-chat-box');

    if (angelSendBtn && angelInput && angelChatBox && !angelSendBtn.dataset.bound) {
        angelSendBtn.dataset.bound = "true";
        let angelChatHistory = [];

        const appendChat = (sender, message, isCard = false) => {
            const div = document.createElement('div');
            div.className = 'flex gap-2';
            if (sender === 'user') {
                div.className = 'flex gap-2 justify-end';
                div.innerHTML = `
                    <div class="bg-primary/10 text-on-surface-variant p-2.5 rounded-2xl rounded-tr-none max-w-[85%] leading-relaxed">${escapeHTML(message)}</div>
                    <span class="text-[18px]">👤</span>
                `;
            } else {
                if (isCard) {
                    div.innerHTML = `
                        <span class="text-[18px]">👼</span>
                        <div class="bg-white dark:bg-zinc-900 border border-amber-200/50 dark:border-amber-900/30 p-4 rounded-2xl rounded-tl-none max-w-[85%] shadow-sm space-y-3">
                            ${message}
                        </div>
                    `;
                } else {
                    div.innerHTML = `
                        <span class="text-[18px]">👼</span>
                        <div class="bg-amber-100/60 dark:bg-amber-900/20 text-on-surface-variant p-2.5 rounded-2xl rounded-tl-none max-w-[85%] leading-relaxed">${escapeHTML(message)}</div>
                    `;
                }
            }
            angelChatBox.appendChild(div);
            angelChatBox.scrollTop = angelChatBox.scrollHeight;
        };

        const handleSend = async () => {
            const text = angelInput.value.trim();
            if (!text) return;

            angelInput.value = '';
            appendChat('user', text);
            angelChatHistory.push({ role: 'user', content: text });

            // 로딩 상태 표시
            const loadingId = 'angel-loading-' + Date.now();
            const loadingDiv = document.createElement('div');
            loadingDiv.id = loadingId;
            loadingDiv.className = 'flex gap-2';
            loadingDiv.innerHTML = `
                <span class="text-[18px]">👼</span>
                <div class="bg-amber-100/40 text-on-surface-variant p-2.5 rounded-2xl rounded-tl-none max-w-[85%] flex items-center gap-1.5">
                    <span class="material-symbols-outlined text-[16px] animate-spin">sync</span>
                    <span>천사가 일정을 설계하는 중...</span>
                </div>
            `;
            angelChatBox.appendChild(loadingDiv);
            angelChatBox.scrollTop = angelChatBox.scrollHeight;

            try {
                const token = await store.getSessionToken();
                const res = await fetch(`${API_URL}/ai-tasks/suggest`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({ history: angelChatHistory })
                });

                const data = await res.json();
                
                // 로딩 제거
                document.getElementById(loadingId)?.remove();

                if (data.success) {
                    if (data.advice) {
                        appendChat('angel', data.advice);
                        angelChatHistory.push({ role: 'assistant', content: data.advice });
                    }

                    if (data.isFinalized && data.suggestedTasks && data.suggestedTasks.length > 0) {
                        // 세부 과제 카드 생성
                        const taskListHtml = data.suggestedTasks.map(t => `
                            <div class="flex items-center justify-between text-[11px] p-2 bg-amber-50/40 dark:bg-amber-950/10 rounded-lg border border-amber-100/20">
                                <span class="font-medium text-amber-800 dark:text-amber-400">Step ${t.sequence}</span>
                                <span class="flex-1 px-2 text-on-surface-variant truncate">${escapeHTML(t.title)}</span>
                                <span class="shrink-0 bg-white/80 dark:bg-zinc-800 px-1.5 py-0.5 rounded text-[10px] text-amber-700 dark:text-amber-500 font-semibold">${t.duration}일</span>
                            </div>
                        `).join('');

                        const cardHtml = `
                        <div class="space-y-2">
                            <h4 class="font-bold text-[12px] text-primary flex items-center gap-1">
                                <span>📅 추천 세부 과제 구성</span>
                            </h4>
                            <div class="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                                ${taskListHtml}
                            </div>
                            <div class="mt-2 flex items-center gap-1.5 text-[10px] text-secondary">
                                <input type="checkbox" id="angel-consent-cal-${loadingId}" class="rounded border-outline text-primary focus:ring-primary w-3.5 h-3.5 cursor-pointer" checked>
                                <label for="angel-consent-cal-${loadingId}" class="cursor-pointer select-none">AI 천사 과제 전용 Google 캘린더 생성 및 연동에 동의합니다.</label>
                            </div>
                            <div class="pt-2 border-t border-outline-variant/20 flex gap-2">
                                <button class="flex-1 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg font-semibold text-[11px] transition-colors shadow-sm" id="angel-btn-confirm-${loadingId}" data-reschedule-id="${data.rescheduleTaskId || ''}">
                                    일정 등록 및 확정 👼
                                </button>
                            </div>
                        </div>
                    `;

                    appendChat('angel', cardHtml, true);

                    // 확정 버튼 이벤트 바인딩
                    document.getElementById(`angel-btn-confirm-${loadingId}`)?.addEventListener('click', async () => {
                        const confirmBtn = document.getElementById(`angel-btn-confirm-${loadingId}`);
                        const consentCheckbox = document.getElementById(`angel-consent-cal-${loadingId}`);
                        const syncGoogle = consentCheckbox ? consentCheckbox.checked : false;
                        const rescheduleId = confirmBtn ? confirmBtn.dataset.rescheduleId : '';

                        const restoreConfirmBtn = () => {
                            if (confirmBtn) {
                                confirmBtn.disabled = false;
                                confirmBtn.innerText = '일정 등록 및 확정 👼';
                            }
                        };

                        if (confirmBtn) {
                            confirmBtn.disabled = true;
                            confirmBtn.innerText = '저장하는 중...';
                        }

                        try {
                            const todayStr = getTodayKSTDateString();
                            const saveRes = await fetch(`${API_URL}/ai-tasks/confirm`, {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json',
                                    'Authorization': `Bearer ${token}`
                                },
                                body: JSON.stringify({
                                    taskId: rescheduleId || undefined,
                                    parentTitle: (data.mainTaskTitle || text).substring(0, 120),
                                    startDate: todayStr,
                                    steps: data.suggestedTasks,
                                    status: 'in-progress',
                                    syncGoogle: syncGoogle
                                })
                            });

                            const saveData = await saveRes.json();
                            if (saveData.success) {
                                appendChat('angel', '세부 일정이 데이터베이스에 일괄 저장되었습니다. 캘린더를 새로고침합니다! 👼');
                                angelChatHistory = []; // 대화 기록 초기화
                                if (loadCalendarCallback) loadCalendarCallback(true);
                            } else {
                                appendChat('angel', '저장 실패: ' + escapeHTML(saveData.message || '오류 발생'));
                                restoreConfirmBtn();
                            }
                        } catch (confirmErr) {
                            console.error(confirmErr);
                            appendChat('angel', '저장 도중 서버 통신 실패가 발생했습니다.');
                            restoreConfirmBtn();
                        }
                    });

                    } else if (!data.isFinalized) {
                        // 대화 중일 경우 추가 카드를 띄우지 않음
                    } else {
                        appendChat('angel', data.message || '일정 추천을 가져오지 못했습니다.');
                    }
                } else {
                    appendChat('angel', data.message || '일정 추천을 가져오지 못했습니다.');
                }
            } catch (err) {
                console.error(err);
                document.getElementById(loadingId)?.remove();
                appendChat('angel', '일정 추천 조회 도중 오류가 발생했습니다.');
            }
        };

        angelSendBtn.addEventListener('click', handleSend);
        angelInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') handleSend();
        });
    }
}
