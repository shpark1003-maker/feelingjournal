import { store, API_URL, assertIds } from './state.js?v=5.7.7';

function getEventLocalDateString(eventDateStr) {
    if (!eventDateStr) return '';
    if (typeof eventDateStr !== 'string') {
        eventDateStr = String(eventDateStr);
    }
    if (eventDateStr.length === 10 && eventDateStr.includes('-')) {
        return eventDateStr;
    }
    if (eventDateStr.length >= 10 && eventDateStr[4] === '-' && eventDateStr[7] === '-') {
        return eventDateStr.slice(0, 10);
    }
    const d = new Date(eventDateStr);
    if (isNaN(d.getTime())) return '';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function parseDateSafe(dateStr) {
    if (!dateStr) return new Date();
    if (typeof dateStr !== 'string') {
        dateStr = String(dateStr);
    }
    const parts = dateStr.split('T')[0].split('-');
    if (parts.length === 3) {
        return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
    }
    return new Date(dateStr);
}

let initialized = false;
let currentYear = new Date().getFullYear();
let currentMonth = new Date().getMonth(); // 0-indexed
let calendarEvents = [];
let selectedDateStr = null;

window.v2TaskEditTrigger = function(id) {
    const task = calendarEvents.find(t => t.id === id);
    if (task) {
        openTaskEditor('edit', task);
    }
};

window.v2RescheduleTaskWithAi = function(parentTitle, taskId) {
    const feedback = prompt(`'${parentTitle}' 과제의 일정을 AI와 함께 변경합니다.\n변경 사유나 원하는 새 일정을 입력해주세요.\n(예: 위원회 교육일정이 21일로 당겨져서, 일정을 앞당기고 싶어요.)`);
    if (!feedback) return;

    const chatInput = document.getElementById('ai-angel-input');
    if (chatInput) {
        chatInput.value = `[일정 재조정] 대과제: "${parentTitle}" (ID: ${taskId})\n사용자 변경 요청: ${feedback}`;
        document.getElementById('ai-schedule-angel-section')?.scrollIntoView({ behavior: 'smooth' });
    }
};

window.v2TaskDeleteTrigger = async function(id) {
    if (!confirm('정말로 이 과제를 삭제하시겠습니까?')) return;
    try {
        const token = await store.getSessionToken();
        const response = await fetch(`${API_URL}/calendar/events/${id}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        const data = await response.json();
        if (data.success) {
            alert('과제가 성공적으로 삭제되었습니다.');
            loadCalendar(true); // 데이터 새로고침 및 목록 갱신
        } else {
            alert('과제 삭제에 실패했습니다: ' + (data.error || '알 수 없는 오류'));
        }
    } catch (err) {
        console.error('Task Delete Error:', err);
        alert('과제 삭제 중 오류가 발생했습니다.');
    }
};

window.v2ToggleTaskAccordion = function(el, event) {
    if (event) {
        if (event.target.closest('.edit-task-btn') || event.target.closest('.task-details')) {
            return;
        }
    }
    const isExpanded = el.getAttribute('aria-expanded') === 'true';
    el.setAttribute('aria-expanded', isExpanded ? 'false' : 'true');
    if (!isExpanded) {
        el.classList.add('ring-2', 'ring-primary/20', 'shadow-md');
    } else {
        el.classList.remove('ring-2', 'ring-primary/20', 'shadow-md');
    }
};

function formatLocalISO(date) {
    if (!date) return '';
    const tzOffset = date.getTimezoneOffset() * 60000;
    return (new Date(date - tzOffset)).toISOString().slice(0, 16);
}

function getDayName(dayIndex) {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return days[dayIndex];
}

function getMonthName(monthIndex) {
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    return months[monthIndex];
}

function initCalendarUI() {
    if (initialized) return;
    initialized = true;

    // 모달 및 슬라이더 카드 관련 요소 초기화 및 이벤트 리스너 바인딩
    const prevBtn = document.getElementById('calendar-prev-btn');
    const nextBtn = document.getElementById('calendar-next-btn');

    if (prevBtn) {
        prevBtn.addEventListener('click', () => {
            currentMonth--;
            if (currentMonth < 0) {
                currentMonth = 11;
                currentYear--;
            }
            renderCustomGrid();
        });
    }

    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            currentMonth++;
            if (currentMonth > 11) {
                currentMonth = 0;
                currentYear++;
            }
            renderCustomGrid();
        });
    }

    // 일정 추가/상세 모달 이벤트 바인딩
    const modal = document.getElementById('calendar-event-modal');
    const form = document.getElementById('calendar-event-form');
    const closeBtn = document.getElementById('close-calendar-modal');
    const deleteBtn = document.getElementById('delete-calendar-event-btn');

    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            modal.style.display = 'none';
        });
    }

    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const id = document.getElementById('calendar-event-id').value;
            const summary = document.getElementById('calendar-event-summary').value;
            const startTime = document.getElementById('calendar-event-start').value;
            const endTime = document.getElementById('calendar-event-end').value;
            const description = document.getElementById('calendar-event-desc').value;

            try {
                const token = await store.getSessionToken();

                const isEdit = !!id;
                let url = `${API_URL}/calendar`;
                let method = 'POST';

                if (isEdit) {
                    // 구글 캘린더 패치 API 
                    url = `${API_URL}/calendar/events/${id}`;
                    method = 'PATCH';
                }

                const payload = isEdit 
                    ? { start: startTime, end: endTime } 
                    : { summary, startTime, endTime, description };

                const res = await fetch(url, {
                    method: method,
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify(payload)
                });

                const data = await res.json();
                if (data.success) {
                    alert(isEdit ? '일정이 성공적으로 수정되었습니다.' : '일정이 구글 캘린더에 성공적으로 저장되었습니다.');
                    modal.style.display = 'none';
                    closeDayView();
                    loadCalendar(true);
                } else {
                    alert('일정 저장 실패: ' + data.error);
                }
            } catch (err) {
                console.error(err);
                alert('서버 통신 오류');
            }
        });
    }

    if (deleteBtn) {
        deleteBtn.addEventListener('click', async () => {
            const id = document.getElementById('calendar-event-id').value;
            if (!id) return;

            if (!confirm('이 일정을 구글 캘린더에서 정말 삭제하시겠습니까?')) return;

            try {
                const token = await store.getSessionToken();

                // 구글 캘린더 삭제 API 호출
                const res = await fetch(`${API_URL}/calendar/events/${id}`, {
                    method: 'DELETE',
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                });

                const data = await res.json();
                if (data.success) {
                    alert('일정이 성공적으로 삭제되었습니다.');
                    modal.style.display = 'none';
                    closeDayView();
                    loadCalendar(true);
                } else {
                    alert('일정 삭제 실패: ' + data.error);
                }
            } catch (err) {
                console.error(err);
                alert('서버 통신 오류');
            }
        });
    }

    // 날짜 상세 슬라이더(dayView) 관련 이벤트 바인딩
    const dayViewCloseBg = document.getElementById('dayViewCloseBg');
    const dayViewCloseBtn = document.getElementById('dayViewCloseBtn');
    const dayViewAddBtn = document.getElementById('day-view-add-btn');

    if (dayViewCloseBg) dayViewCloseBg.addEventListener('click', closeDayView);
    if (dayViewCloseBtn) dayViewCloseBtn.addEventListener('click', closeDayView);

    if (dayViewAddBtn) {
        dayViewAddBtn.addEventListener('click', () => {
            // 현재 상세 뷰가 띄워진 날짜 기준 일정 추가 열기
            const dateStr = dayViewAddBtn.dataset.date; 
            if (!dateStr) return;

            const baseDate = new Date(dateStr);
            const startISO = formatLocalISO(baseDate);
            const endISO = formatLocalISO(new Date(baseDate.getTime() + 60 * 60 * 1000)); // 1시간 뒤

            openEventModal('add', {
                start: startISO,
                end: endISO
            });
        });
    }

    const v2CalendarAddBtn = document.getElementById('v2-calendar-add-btn');
    if (v2CalendarAddBtn) {
        v2CalendarAddBtn.addEventListener('click', () => {
            if (typeof openEventModal === 'function') {
                const today = new Date();
                const startISO = formatLocalISO(today);
                const endISO = formatLocalISO(new Date(today.getTime() + 60 * 60 * 1000));
                openEventModal('add', {
                    start: startISO,
                    end: endISO
                });
            }
        });
    }
    const v2TaskAddBtn = document.getElementById('v2-task-add-btn');
    if (v2TaskAddBtn) {
        v2TaskAddBtn.addEventListener('click', () => {
            openTaskEditor('add', {}, 'task');
        });
    }

    // Type Selector Tab Toggles
    const typeEventBtn = document.getElementById('type-event');
    const typeTaskBtn = document.getElementById('type-task');
    if (typeEventBtn && !typeEventBtn.dataset.bound) {
        typeEventBtn.dataset.bound = "true";
        typeEventBtn.addEventListener('click', () => {
            window.v2ToggleTaskType('event');
        });
    }
    if (typeTaskBtn && !typeTaskBtn.dataset.bound) {
        typeTaskBtn.dataset.bound = "true";
        typeTaskBtn.addEventListener('click', () => {
            window.v2ToggleTaskType('task');
        });
    }

    // Delete Button Click Handler
    const taskDeleteBtn = document.getElementById('v2-task-editor-delete');
    if (taskDeleteBtn && !taskDeleteBtn.dataset.bound) {
        taskDeleteBtn.dataset.bound = "true";
        taskDeleteBtn.addEventListener('click', async () => {
            const container = document.getElementById('v2-task-editor-container');
            const id = container.dataset.id;
            if (!id) return;

            if (!confirm('이 일정/과제를 정말 삭제하시겠습니까?')) return;

            try {
                const token = await store.getSessionToken();

                const res = await fetch(`${API_URL}/calendar/events/${id}`, {
                    method: 'DELETE',
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                });

                const data = await res.json();
                if (data.success) {
                    alert('성공적으로 삭제되었습니다.');
                    closeTaskEditor();
                    loadCalendar(true);
                } else {
                    alert('삭제 실패: ' + data.error);
                }
            } catch (err) {
                console.error('Failed to delete event/task:', err);
                alert('서버 통신 중 오류가 발생했습니다.');
            }
        });
    }

    // 별점 버튼 이벤트 바인딩
    const starBtns = document.querySelectorAll('#v2-task-rating-container .rating-star-btn');
    starBtns.forEach(btn => {
        if (!btn.dataset.bound) {
            btn.dataset.bound = "true";
            btn.addEventListener('click', () => {
                const rating = parseInt(btn.dataset.rating, 10);
                const ratingInput = document.getElementById('v2-task-rating-input');
                if (ratingInput) ratingInput.value = rating;
                updateEditorStarsUI(rating);
                
                // Dynamically update hidden progress fields
                const progressInput = document.getElementById('v2-task-progress-input');
                const progressVal = document.getElementById('v2-task-progress-val');
                if (progressInput) progressInput.value = rating * 20;
                if (progressVal) progressVal.innerText = `${rating * 20}%`;
            });
        }
    });

    // 진행률 슬라이더 실시간 표시
    const progressInput = document.getElementById('v2-task-progress-input');
    const progressVal = document.getElementById('v2-task-progress-val');
    if (progressInput && progressVal && !progressInput.dataset.bound) {
        progressInput.dataset.bound = "true";
        progressInput.addEventListener('input', (e) => {
            progressVal.innerText = `${e.target.value}%`;
        });
    }

    const taskSaveBtn = document.getElementById('v2-task-editor-save');
    if (taskSaveBtn && !taskSaveBtn.dataset.bound) {
        taskSaveBtn.dataset.bound = "true";
        taskSaveBtn.addEventListener('click', async () => {
            const container = document.getElementById('v2-task-editor-container');
            const mode = container.dataset.mode;
            const id = container.dataset.id;
            const type = container.dataset.type || 'event';
            
            const title = document.getElementById('v2-task-title-input').value.trim();
            const start = document.getElementById('v2-task-start-input').value;
            const end = document.getElementById('v2-task-end-input').value;
            const desc = document.getElementById('v2-task-desc-input').value.trim();

            if (!title || !start || !end) {
                alert('일정/과제 제목과 시작/종료 시간을 입력해 주세요.');
                return;
            }

            try {
                const token = await store.getSessionToken();

                const isEdit = mode === 'edit';
                let url = `${API_URL}/calendar`;
                let method = 'POST';

                if (isEdit) {
                    url = `${API_URL}/calendar/events/${id}`;
                    method = 'PATCH';
                }

                let finalDesc = desc;
                if (type === 'task') {
                    const progress = document.getElementById('v2-task-progress-input').value;
                    const rating = document.getElementById('v2-task-rating-input').value;
                    const reviewDate = document.getElementById('v2-task-review-date-input').value;
                    const reflection = document.getElementById('v2-task-reflection-input').value.trim();
                    finalDesc = serializeTaskMetadata(desc, progress, rating, reviewDate, reflection);
                }

                const payload = isEdit
                    ? { start, end, summary: title, description: finalDesc }
                    : { summary: title, startTime: start, endTime: end, description: finalDesc };

                const res = await fetch(url, {
                    method: method,
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify(payload)
                });

                const data = await res.json();
                if (data.success) {
                    alert(isEdit ? '일정/과제가 수정되었습니다.' : '일정/과제가 추가되었습니다.');
                    closeTaskEditor();
                    loadCalendar(true);
                } else {
                    alert('저장 실패: ' + data.error);
                }
            } catch (err) {
                console.error('Failed to save event/task:', err);
                alert('서버 통신 중 오류가 발생했습니다.');
            }
        });
    }

    const taskCloseBtn = document.getElementById('v2-task-editor-close');
    if (taskCloseBtn && !taskCloseBtn.dataset.bound) {
        taskCloseBtn.dataset.bound = "true";
        taskCloseBtn.addEventListener('click', () => {
            closeTaskEditor();
        });
    }

    // === [AI 일정 천사] 이벤트 바인딩 (1단계) ===
    const angelSendBtn = document.getElementById('ai-angel-send-btn');
    const angelInput = document.getElementById('ai-angel-input');
    const angelChatBox = document.getElementById('ai-angel-chat-box');

    if (angelSendBtn && angelInput && angelChatBox && !angelSendBtn.dataset.bound) {
        angelSendBtn.dataset.bound = "true";

        const appendChat = (sender, message, isCard = false) => {
            const div = document.createElement('div');
            div.className = 'flex gap-2';
            if (sender === 'user') {
                div.className = 'flex gap-2 justify-end';
                div.innerHTML = `
                    <div class="bg-primary/10 text-on-surface-variant p-2.5 rounded-2xl rounded-tr-none max-w-[85%] leading-relaxed">${message}</div>
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
                        <div class="bg-amber-100/60 dark:bg-amber-900/20 text-on-surface-variant p-2.5 rounded-2xl rounded-tl-none max-w-[85%] leading-relaxed">${message}</div>
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
                    body: JSON.stringify({ message: text })
                });

                const data = await res.json();
                
                // 로딩 제거
                document.getElementById(loadingId)?.remove();

                if (data.success && data.suggestedTasks) {
                    appendChat('angel', data.advice);

                    // 세부 과제 카드 생성
                    const taskListHtml = data.suggestedTasks.map(t => `
                        <div class="flex items-center justify-between text-[11px] p-2 bg-amber-50/40 dark:bg-amber-950/10 rounded-lg border border-amber-100/20">
                            <span class="font-medium text-amber-800 dark:text-amber-400">Step ${t.sequence}</span>
                            <span class="flex-1 px-2 text-on-surface-variant truncate">${t.title}</span>
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

                        if (confirmBtn) {
                            confirmBtn.disabled = true;
                            confirmBtn.innerText = '저장하는 중...';
                        }

                        try {
                            const todayStr = new Date().toISOString().split('T')[0];
                            const saveRes = await fetch(`${API_URL}/ai-tasks/confirm`, {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json',
                                    'Authorization': `Bearer ${token}`
                                },
                                body: JSON.stringify({
                                    taskId: rescheduleId || undefined,
                                    parentTitle: data.mainTaskTitle || text,
                                    startDate: todayStr,
                                    steps: data.suggestedTasks,
                                    status: 'in-progress',
                                    syncGoogle: syncGoogle
                                })
                            });

                            const saveData = await saveRes.json();
                            if (saveData.success) {
                                appendChat('angel', '세부 일정이 데이터베이스에 일괄 저장되었습니다. 캘린더를 새로고침합니다! 👼');
                                loadCalendar(true);
                            } else {
                                appendChat('angel', '저장 실패: ' + (saveData.message || '오류 발생'));
                            }
                        } catch (confirmErr) {
                            console.error(confirmErr);
                            appendChat('angel', '저장 도중 서버 통신 실패가 발생했습니다.');
                        }
                    });

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

export async function loadCalendar(forceRefresh = false) {
    assertIds('Calendar', [
        'calendar-days-grid', 'calendar-month-year-text', 'calendar-prev-btn', 'calendar-next-btn', 
        'calendar-refresh-btn', 'v2-calendar-add-btn', 'v2-task-list', 'v2-task-add-btn', 
        'calendar-event-modal', 'dayViewContainer'
    ]);

    initCalendarUI();
    const container = document.getElementById('calendar-days-grid');
    if (!container) return;

    // Bind refresh button event
    const refreshBtn = document.getElementById('calendar-refresh-btn');
    if (refreshBtn) {
        const newRefreshBtn = refreshBtn.cloneNode(true);
        refreshBtn.parentNode.replaceChild(newRefreshBtn, refreshBtn);
        newRefreshBtn.addEventListener('click', () => {
            newRefreshBtn.style.transform = 'rotate(360deg)';
            newRefreshBtn.style.transition = 'transform 0.6s ease';
            setTimeout(() => {
                newRefreshBtn.style.transform = 'none';
                newRefreshBtn.style.transition = 'none';
            }, 600);
            loadCalendar(true);
        });
    }

    container.innerHTML = `
        <div style="grid-column: span 7; text-align: center; padding: 60px 20px; color: var(--text-muted); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 15px;">
            <div style="width: 40px; height: 40px; border: 4px solid var(--primary-container); border-top: 4px solid var(--primary-color); border-radius: 50%; animation: spin 1s linear infinite;"></div>
            <span style="font-weight: 600; font-size: 1.1rem; letter-spacing: 0.5px;">일정표를 펼치는 중...</span>
            <style>@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }</style>
        </div>
    `;

    try {
        const token = await store.getSessionToken();

        const res = await fetch(`${API_URL}/calendar${forceRefresh ? '?refresh=true' : ''}`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        const data = await res.json();
        if (!data.success) throw new Error(data.error);

        calendarEvents = data.events || [];
        const isUnlinked = data.unlinked;

        // 구글 연동 배너 처리
        let banner = document.getElementById('google-calendar-link-banner');
        if (isUnlinked) {
            if (!banner) {
                banner = document.createElement('div');
                banner.id = 'google-calendar-link-banner';
                banner.style.cssText = `
                    background: linear-gradient(135deg, rgba(255, 234, 167, 0.25) 0%, rgba(255, 118, 117, 0.08) 100%);
                    backdrop-filter: blur(12px);
                    border: 1px solid rgba(255, 234, 167, 0.45);
                    border-radius: 16px;
                    padding: 16px 20px;
                    margin-bottom: 20px;
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    box-shadow: 0 8px 32px rgba(255, 118, 117, 0.04);
                    gap: 15px;
                `;
                banner.innerHTML = `
                    <div style="display: flex; align-items: center; gap: 12px;">
                        <span style="font-size: 1.5rem;">💡</span>
                        <div style="text-align: left;">
                            <strong style="color: #e17055; font-size: 0.95rem; display: block; margin-bottom: 2px;">구글 캘린더 양방향 연동이 필요한가요?</strong>
                            <span style="color: #636e72; font-size: 0.85rem;">현재 일반/카카오 로그인 상태입니다. 구글 계정을 추가 연동하시면 실시간 캘린더 동기화가 활성화됩니다.</span>
                        </div>
                    </div>
                    <button id="google-link-action-btn" style="
                        background: white; 
                        color: #2d3436; 
                        border: 1px solid rgba(0,0,0,0.1); 
                        border-radius: 20px; 
                        padding: 8px 18px; 
                        font-size: 0.85rem; 
                        font-weight: 700; 
                        cursor: pointer; 
                        display: flex; 
                        align-items: center; 
                        gap: 6px; 
                        box-shadow: 0 4px 10px rgba(0,0,0,0.05);
                        transition: all 0.2s;
                        white-space: nowrap;
                    " onmouseover="this.style.transform='translateY(-1px)'; this.style.boxShadow='0 6px 15px rgba(0,0,0,0.1)';" onmouseout="this.style.transform='none'; this.style.boxShadow='0 4px 10px rgba(0,0,0,0.05)';">
                        <svg viewBox="0 0 24 24" width="16" height="16" style="display: inline-block; vertical-align: middle;">
                            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22c-.62-.62-1.07-1.37-1.42-2.15z"/>
                            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                        </svg>
                        구글 계정 연동
                    </button>
                `;
                
                const linkBtn = banner.querySelector('#google-link-action-btn');
                linkBtn?.addEventListener('click', async () => {
                    linkBtn.disabled = true;
                    linkBtn.innerText = '연동 진행 중...';
                    try {
                        const { data: { session } } = await store.supabaseClient.auth.getSession();
                        const token = session?.access_token;
                        if (!token) throw new Error('세션 토큰을 찾을 수 없습니다.');
                        window.location.href = `${API_URL}/auth/google?access_token=${encodeURIComponent(token)}`;
                    } catch (err) {
                        alert('연동 실패: ' + err.message);
                        linkBtn.disabled = false;
                        linkBtn.innerHTML = '구글 계정 연동';
                    }
                });
                
                const cardContainer = document.getElementById('calendar-container') || document.getElementById('ai-briefing-section');
                if (cardContainer) {
                    cardContainer.parentNode.insertBefore(banner, cardContainer);
                }
            }
        } else {
            if (banner) banner.remove();
        }

        renderCustomGrid();
        renderV2TaskList();
        
        if (!selectedDateStr) {
            const today = new Date();
            selectedDateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
        }
        openDayView(selectedDateStr);
    } catch (e) {
        console.error(e);
        container.innerHTML = `<div style="grid-column: span 7; text-align: center; padding: 40px; color: #ff4d4d;">캘린더 로드 실패: ${e.message}</div>`;
    }
}

function renderCustomGrid() {
    const grid = document.getElementById('calendar-days-grid');
    const monthYearText = document.getElementById('calendar-month-year-text');
    if (!grid || !monthYearText) return;

    monthYearText.innerText = `${currentYear}년 ${currentMonth + 1}월`;

    grid.innerHTML = '';

    const firstDayDate = new Date(currentYear, currentMonth, 1);
    const startDayOfWeek = firstDayDate.getDay();
    const lastDayDate = new Date(currentYear, currentMonth + 1, 0);
    const totalDays = lastDayDate.getDate();

    const prevMonthLastDate = new Date(currentYear, currentMonth, 0).getDate();

    // Helper to generate dots (mobile) and event items (desktop) for a day
    function getDayHtml(dayNum, dateStr, isToday, isPrevOrNext) {
        const dayEvents = calendarEvents.filter(ev => getEventLocalDateString(ev.start) === dateStr);
        
        let dotsHTML = '';
        let desktopEventsHTML = '';
        
        if (dayEvents.length > 0) {
            // Event list visible always on all devices
            desktopEventsHTML = `<div class="desktop-event-list flex flex-col gap-1 w-full px-1 mt-1 overflow-y-auto" style="max-height: 50px; md:max-height: 80px;">`;
            dayEvents.forEach(ev => {
                const desc = ev.extendedProps?.description || ev.description || '';
                const type = ev.extendedProps?.type || ev.type || (desc.includes('[Task]') ? 'task' : 'personal');
                
                // Color badges based on event types
                let badgeBg = 'rgba(217, 140, 158, 0.15)';
                let badgeColor = '#d98c9e';
                if (type === 'task') {
                    badgeBg = 'rgba(93, 87, 77, 0.12)';
                    badgeColor = '#5d574d';
                } else if (type === 'shared') {
                    badgeBg = 'rgba(74, 101, 78, 0.15)';
                    badgeColor = '#4A6741';
                }
                
                const cleanTitle = ev.title || '제목 없음';
                let displayTitle = cleanTitle;
                if (type === 'task') {
                    const meta = parseTaskMetadata(desc);
                    const remainingTimeStr = getRemainingTimeStr(ev.end || ev.start);
                    const progressPercent = meta.rating > 0 ? (meta.rating * 20) : 0;
                    
                    let badgeInfo = '';
                    if (remainingTimeStr) {
                        const shortTime = remainingTimeStr.replace(' 남음', '');
                        badgeInfo = `${shortTime} | ${progressPercent}%`;
                    } else {
                        badgeInfo = `${progressPercent}%`;
                    }
                    displayTitle = `${cleanTitle} (${badgeInfo})`;
                }
                
                desktopEventsHTML += `
                    <div class="calendar-event-badge px-1.5 py-0.5 text-[10px] rounded font-semibold truncate w-full text-left cursor-pointer transition-colors hover:opacity-85"
                         style="background-color: ${badgeBg}; color: ${badgeColor};"
                         title="${cleanTitle}${desc ? ' - ' + desc : ''}"
                         data-event-id="${ev.id}">
                        ${displayTitle}
                    </div>
                `;
            });
            desktopEventsHTML += `</div>`;
        }

        const numClass = isToday ? 'day-number-wrapper relative z-0' : 'day-number-wrapper';
        const todayCircle = isToday ? `
            <div class="absolute inset-0 flex items-center justify-center -z-10 md:hidden">
                <div class="w-8 h-8 rounded-full bg-primary"></div>
            </div>
        ` : '';
        
        return `
            <div class="${numClass}">
                ${dayNum}
                ${todayCircle}
            </div>
            ${dotsHTML}
            ${desktopEventsHTML}
        `;
    }

    function addCellListener(cell, dateStr) {
        cell.addEventListener('click', (e) => {
            const badge = e.target.closest('.calendar-event-badge');
            if (badge) {
                e.stopPropagation();
                const evId = badge.getAttribute('data-event-id');
                const matchedEvent = calendarEvents.find(ev => ev.id == evId);
                if (matchedEvent && typeof openEventModal === 'function') {
                    openEventModal('edit', matchedEvent);
                }
                return;
            }
            selectedDateStr = dateStr;
            openDayView(dateStr);
            renderCustomGrid();
        });
    }

    // 1. 이전 달 날짜들 렌더링
    for (let i = startDayOfWeek - 1; i >= 0; i--) {
        const prevDayNum = prevMonthLastDate - i;
        const cell = document.createElement('div');
        const dateStr = `${currentMonth === 0 ? currentYear - 1 : currentYear}-${String(currentMonth === 0 ? 12 : currentMonth).padStart(2, '0')}-${String(prevDayNum).padStart(2, '0')}`;
        
        let selectedClass = '';
        if (dateStr === selectedDateStr) {
            selectedClass = ' border-2 border-primary rounded-lg bg-surface-container-low';
        }
        cell.className = `calendar-day text-on-surface-variant/30 text-label-md cursor-pointer relative ${selectedClass}`;
        cell.innerHTML = getDayHtml(prevDayNum, dateStr, false, true);
        addCellListener(cell, dateStr);
        grid.appendChild(cell);
    }

    // 2. 이번 달 날짜들 렌더링
    for (let day = 1; day <= totalDays; day++) {
        const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const cellDate = new Date(currentYear, currentMonth, day);
        
        const cell = document.createElement('div');
        
        const today = new Date();
        const isToday = today.getFullYear() === currentYear && today.getMonth() === currentMonth && today.getDate() === day;
        
        let activeBorder = '';
        if (dateStr === selectedDateStr) {
            activeBorder = ' border-2 border-primary rounded-lg bg-surface-container';
        }

        if (isToday) {
            cell.className = `calendar-day text-on-primary relative z-0 font-bold text-label-md bg-tertiary-container/30${activeBorder}`;
        } else {
            let colorClass = 'text-on-surface';
            if (cellDate.getDay() === 0) {
                colorClass = 'text-error';
            } else if (cellDate.getDay() === 6) {
                colorClass = 'text-primary';
            }
            cell.className = `calendar-day relative cursor-pointer text-label-md ${colorClass}${activeBorder}`;
        }
        
        cell.innerHTML = getDayHtml(day, dateStr, isToday, false);
        addCellListener(cell, dateStr);
        grid.appendChild(cell);
    }

    // 3. 다음 달 날짜들 렌더링
    const totalRendered = startDayOfWeek + totalDays;
    const remaining = (totalRendered % 7 === 0) ? 0 : 7 - (totalRendered % 7);
    for (let i = 1; i <= remaining; i++) {
        const cell = document.createElement('div');
        const dateStr = `${currentMonth === 11 ? currentYear + 1 : currentYear}-${String(currentMonth === 11 ? 1 : currentMonth + 2).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
        
        let selectedClass = '';
        if (dateStr === selectedDateStr) {
            selectedClass = ' border-2 border-primary rounded-lg bg-surface-container-low';
        }
        cell.className = `calendar-day text-on-surface-variant/30 text-label-md cursor-pointer relative ${selectedClass}`;
        cell.innerHTML = getDayHtml(i, dateStr, false, true);
        addCellListener(cell, dateStr);
        grid.appendChild(cell);
    }
}

export function openDayView(dateStr) {
    const timelineList = document.getElementById('v2-timeline-list');
    const timelineTitle = document.getElementById('v2-timeline-title');
    if (!timelineList) return;

    const baseDate = parseDateSafe(dateStr);
    const dayName = getDayName(baseDate.getDay());
    const dateText = `${baseDate.getFullYear()}년 ${baseDate.getMonth() + 1}월 ${baseDate.getDate()}일 (${dayName})`;

    if (timelineTitle) {
        timelineTitle.innerText = `${dateText}의 상세 일정`;
    }

    // 해당 날짜 일정 필터링
    const dayEvents = calendarEvents.filter(ev => {
        return getEventLocalDateString(ev.start) === dateStr;
    });

    timelineList.innerHTML = '';

    if (dayEvents.length === 0) {
        timelineList.innerHTML = `<p class="text-on-surface-variant text-center py-4 text-sm ml-6">이 날에는 상세 일정이 없습니다.</p>`;
        return;
    }

    dayEvents.forEach(ev => {
        const desc = ev.extendedProps?.description || ev.description || '';
        const type = ev.extendedProps?.type || ev.type || (desc.includes('[Task]') ? 'task' : 'personal');
        
        let icon = 'calendar_today';
        let bgClass = 'bg-primary';
        let textClass = 'text-on-primary';
        let timeColorClass = 'text-primary';
        let statusText = 'Done';
        
        if (type === 'task') {
            icon = 'eco';
            bgClass = 'bg-tertiary-container';
            textClass = 'text-on-tertiary-container';
            timeColorClass = 'text-tertiary';
            statusText = 'Active';
        } else if (type === 'shared') {
            icon = 'palette';
            bgClass = 'bg-secondary';
            textClass = 'text-white';
            timeColorClass = 'text-secondary';
            statusText = 'Upcoming';
        }

        const evId = ev.id || '';
        const evTitle = ev.title || '제목 없음';
        
        const startTime = new Date(ev.start);
        let timeStr = startTime.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });

        const cleanDesc = desc.replace(/\[Task\]/g, '')
                              .replace(/\[Progress:\s*\d+\]/g, '')
                              .replace(/\[Rating:\s*\d+\]/g, '')
                              .replace(/\[ReviewDate:\s*[^\]]+\]/g, '')
                              .replace(/\[Reflection:\s*[^\]]+\]/g, '')
                              .trim();

        const hasImage = ev.extendedProps?.imageUrl || ev.imageUrl;
        let cardHTML = '';

        let taskProgressHTML = '';
        if (type === 'task') {
            const meta = parseTaskMetadata(desc);
            const remainingTimeStr = getRemainingTimeStr(ev.end || ev.start);
            const progressPercent = meta.rating > 0 ? (meta.rating * 20) : 0;
            
            taskProgressHTML = `
            <div class="mt-3 space-y-2 border-t border-outline-variant/10 pt-2">
                <div class="flex justify-between items-center text-[10px] text-on-surface-variant">
                    <span>진행률</span>
                    <span class="font-bold text-primary">${progressPercent}%</span>
                </div>
                <div class="h-1.5 w-full bg-surface-container-highest rounded-full overflow-hidden">
                    <div class="h-full bg-primary rounded-full" style="width: ${progressPercent}%"></div>
                </div>
                ${remainingTimeStr ? `
                <div class="flex items-center gap-1 text-[10px] text-secondary font-semibold mt-1">
                    <span class="material-symbols-outlined text-[12px]">alarm</span>
                    <span>${remainingTimeStr}</span>
                </div>
                ` : ''}
            </div>`;
        }

        if (hasImage) {
            const imageUrl = ev.extendedProps?.imageUrl || ev.imageUrl;
            cardHTML = `
            <div class="flex-1 group overflow-hidden bg-surface-container-highest/60 backdrop-blur-sm rounded-xl p-0 shadow-sm border border-outline-variant/10">
                <div class="relative h-32 overflow-hidden">
                    <img class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" src="${imageUrl}" alt="${evTitle}">
                    <div class="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent"></div>
                    <div class="absolute bottom-3 left-4 text-white">
                        <span class="text-label-sm font-bold opacity-80">${timeStr}</span>
                        <h4 class="font-label-md">${evTitle}</h4>
                    </div>
                </div>
                <div class="p-4 journal-texture relative" style="transform: translateY(0px); transition: transform 0.3s; padding-bottom: 2.5rem;">
                    <p class="text-label-sm text-on-surface-variant leading-relaxed">${cleanDesc || '설명이 없습니다.'}</p>
                    ${taskProgressHTML}
                    <div class="absolute right-3 bottom-3 flex gap-1">
                        <button class="p-1 text-on-surface-variant hover:text-primary edit-event-btn" data-id="${evId}"><span class="material-symbols-outlined text-[18px]">edit</span></button>
                    </div>
                </div>
            </div>`;
        } else {
            cardHTML = `
            <div class="flex-1 bg-surface-container-highest/60 backdrop-blur-sm rounded-xl p-4 journal-texture shadow-sm border border-outline-variant/10 relative" style="transform: translateY(0px); transition: transform 0.3s; padding-bottom: 2.5rem;">
                <div class="flex justify-between items-start mb-1">
                    <span class="text-label-sm ${timeColorClass} font-bold">${timeStr}</span>
                    <span class="text-[10px] text-on-surface-variant/60 uppercase font-bold tracking-widest">${statusText}</span>
                </div>
                <h4 class="font-label-md text-on-surface">${evTitle}</h4>
                <p class="text-label-sm text-on-surface-variant mt-2 leading-relaxed italic">${cleanDesc || '설명이 없습니다.'}</p>
                ${taskProgressHTML}
                <div class="absolute right-3 bottom-3 flex gap-1">
                    <button class="p-1 text-on-surface-variant hover:text-primary edit-event-btn" data-id="${evId}"><span class="material-symbols-outlined text-[18px]">edit</span></button>
                </div>
            </div>`;
        }

        const item = document.createElement('div');
        item.className = 'flex gap-gutter-md relative';
        item.innerHTML = `
            <div class="z-10 mt-1 w-6 h-6 rounded-full ${bgClass} flex items-center justify-center border-4 border-surface shadow-sm">
                <span class="material-symbols-outlined ${textClass} text-[14px]">${icon}</span>
            </div>
            ${cardHTML}
        `;

        const cardBody = item.querySelector('.journal-texture');
        if (cardBody) {
            cardBody.addEventListener('mouseenter', () => {
                cardBody.style.transform = 'translateY(-2px)';
            });
            cardBody.addEventListener('mouseleave', () => {
                cardBody.style.transform = 'translateY(0)';
            });
        }

        const editBtn = item.querySelector('.edit-event-btn');
        if (editBtn) {
            editBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                openEventModal('edit', ev);
            });
        }

        item.addEventListener('click', (e) => {
            if (e.target.closest('.edit-event-btn')) return;
            openEventModal('edit', ev);
        });

        timelineList.appendChild(item);
    });
}

export function closeDayView() {
    // No-op since we render in-page now
}

function openEventModal(mode, eventData) {
    const desc = eventData?.extendedProps?.description || eventData?.description || '';
    const type = eventData?.extendedProps?.type || eventData?.type || 'event';
    const resolvedType = (type === 'task' || desc.includes('[Task]')) ? 'task' : 'event';
    openTaskEditor(mode, eventData, resolvedType);
}

export function parseTaskMetadata(description) {
    const meta = {
        progress: 0,
        rating: 0,
        reviewDate: '',
        reflection: '',
        cleanDescription: description || ''
    };
    if (!description) return meta;

    // Remove [Task] tag first
    let clean = description.replace(/\[Task\]/g, '').trim();

    // Parse [Progress: X]
    const progMatch = clean.match(/\[Progress:\s*(\d+)\]/);
    if (progMatch) {
        meta.progress = parseInt(progMatch[1], 10);
        clean = clean.replace(progMatch[0], '').trim();
    }

    // Parse [Rating: X]
    const ratingMatch = clean.match(/\[Rating:\s*(\d+)\]/);
    if (ratingMatch) {
        meta.rating = parseInt(ratingMatch[1], 10);
        clean = clean.replace(ratingMatch[0], '').trim();
    }

    // Parse [ReviewDate: X]
    const dateMatch = clean.match(/\[ReviewDate:\s*([^\]]+)\]/);
    if (dateMatch) {
        meta.reviewDate = dateMatch[1].trim();
        clean = clean.replace(dateMatch[0], '').trim();
    }

    // Parse [Reflection: X]
    const reflMatch = clean.match(/\[Reflection:\s*([^\]]+)\]/);
    if (reflMatch) {
        meta.reflection = reflMatch[1].trim();
        clean = clean.replace(reflMatch[0], '').trim();
    }

    meta.cleanDescription = clean;
    return meta;
}

export function serializeTaskMetadata(cleanDescription, progress, rating, reviewDate, reflection) {
    let parts = [cleanDescription];
    if (progress !== undefined && progress !== null && progress !== '') parts.push(`[Progress: ${progress}]`);
    if (rating !== undefined && rating !== null && rating !== '') parts.push(`[Rating: ${rating}]`);
    if (reviewDate) parts.push(`[ReviewDate: ${reviewDate}]`);
    if (reflection) parts.push(`[Reflection: ${reflection}]`);
    parts.push('[Task]');
    return parts.join(' ').trim();
}

function getDDay(endDateStr) {
    if (!endDateStr) return '';
    const now = new Date();
    const end = new Date(endDateStr);
    
    const nowDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endDate = new Date(end.getFullYear(), end.getMonth(), end.getDate());
    
    const diffTime = endDate.getTime() - nowDate.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) return 'D-Day';
    if (diffDays > 0) return `D-${diffDays}`;
    return `D+${Math.abs(diffDays)}`;
}

function getRemainingTimeStr(endDateStr) {
    if (!endDateStr) return '';
    const now = new Date();
    const end = new Date(endDateStr);
    
    // If only date is specified (YYYY-MM-DD), set to end of that day (23:59:59)
    if (endDateStr.length <= 10) {
        end.setHours(23, 59, 59, 999);
    }
    
    const diffMs = end.getTime() - now.getTime();
    if (diffMs <= 0) {
        return '만료됨';
    }
    
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const diffHours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    
    if (diffDays > 0) {
        return `${diffDays}일 ${diffHours}시간 남음`;
    } else {
        return `${diffHours}시간 남음`;
    }
}

function getTaskIconInfo(title) {
    const t = title || '';
    if (t.includes('명상') || t.includes('스트레칭') || t.includes('요가') || t.includes('마음')) {
        return { icon: 'self_improvement', colorClass: 'text-primary', bgClass: 'bg-primary/10' };
    }
    if (t.includes('독서') || t.includes('공부') || t.includes('공독') || t.includes('공책') || t.includes('학습') || t.includes('책')) {
        return { icon: 'menu_book', colorClass: 'text-tertiary', bgClass: 'bg-tertiary/10' };
    }
    if (t.includes('드로잉') || t.includes('그림') || t.includes('수채화') || t.includes('미술') || t.includes('스케치')) {
        return { icon: 'brush', colorClass: 'text-secondary', bgClass: 'bg-secondary/10' };
    }
    if (t.includes('식물') || t.includes('가드닝') || t.includes('물주기') || t.includes('꽃')) {
        return { icon: 'eco', colorClass: 'text-primary', bgClass: 'bg-primary/10' };
    }
    if (t.includes('운동') || t.includes('러닝') || t.includes('산책') || t.includes('헬스')) {
        return { icon: 'directions_run', colorClass: 'text-secondary', bgClass: 'bg-secondary/10' };
    }
    return { icon: 'check_circle', colorClass: 'text-primary', bgClass: 'bg-primary/10' };
}

export function renderV2TaskList() {
    const listContainer = document.getElementById('v2-task-list');
    if (!listContainer) return;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const tasks = calendarEvents.filter(ev => {
        const desc = ev.extendedProps?.description || ev.description || '';
        const type = ev.extendedProps?.type || ev.type || 'personal';
        if (type !== 'task' && !desc.includes('[Task]')) return false;

        const meta = parseTaskMetadata(desc);
        const progressPercent = meta.rating > 0 ? (meta.rating * 20) : (meta.progress || 0);

        // 마감일/종료일이 오늘보다 과거이면서 진행률이 100% 미만이면 노출 유지 (완료된 과거 태스크만 숨김)
        const dateStr = ev.end || ev.start;
        if (dateStr) {
            const taskDate = parseDateSafe(dateStr);
            taskDate.setHours(23, 59, 59, 999);
            if (taskDate < today && progressPercent >= 100) {
                return false;
            }
        }
        return true;
    });

    if (tasks.length === 0) {
        listContainer.innerHTML = `<p class="text-on-surface-variant text-center py-4 text-sm">과제가 없습니다.</p>`;
        return;
    }

    // Group tasks by parentTitle
    const groups = {};
    tasks.forEach(t => {
        const desc = t.extendedProps?.description || t.description || '';
        
        let parentTitle = t.extendedProps?.parentTitle || t.parentTitle || '';
        if (!parentTitle) {
            const match = desc.match(/대과제:\s*([^\n\r\)]+)/);
            if (match) {
                parentTitle = match[1].trim();
            }
        }
        
        if (!parentTitle) {
            parentTitle = '일반 과제';
        }

        if (!groups[parentTitle]) {
            groups[parentTitle] = [];
        }
        groups[parentTitle].push(t);
    });

    listContainer.innerHTML = Object.keys(groups).map(parentTitle => {
        const groupTasks = groups[parentTitle];
        
        // Sort subtasks by date
        groupTasks.sort((a, b) => {
            const aStart = a.start || '';
            const bStart = b.start || '';
            return aStart.localeCompare(bStart);
        });

        // Compute average progress
        let totalProgress = 0;
        groupTasks.forEach(t => {
            const desc = t.extendedProps?.description || t.description || '';
            const meta = parseTaskMetadata(desc);
            totalProgress += (meta.rating > 0 ? (meta.rating * 20) : (meta.progress || 0));
        });
        const avgProgress = Math.round(totalProgress / groupTasks.length);

        const isGeneral = parentTitle === '일반 과제';
        const iconName = isGeneral ? 'assignment' : 'menu_book';
        const colorClass = isGeneral ? 'text-secondary' : 'text-primary';
        const bgClass = isGeneral ? 'bg-secondary/10' : 'bg-primary/10';
        
        // Render subtasks HTML
        const subtasksHtml = groupTasks.map(t => {
            const desc = t.extendedProps?.description || t.description || '';
            const meta = parseTaskMetadata(desc);
            const dday = getDDay(t.end || t.start);
            const remainingTimeStr = getRemainingTimeStr(t.end || t.start);
            const progressPercent = meta.rating > 0 ? (meta.rating * 20) : (meta.progress || 0);

            let reviewSection = '';
            if (meta.rating > 0 || meta.reflection || meta.reviewDate) {
                let starsHTML = '';
                for (let i = 1; i <= 5; i++) {
                    const isFilled = i <= meta.rating;
                    starsHTML += `<span class="material-symbols-outlined ${isFilled ? 'text-primary' : 'text-outline-variant'} text-[16px]" style="font-variation-settings: 'FILL' ${isFilled ? 1 : 0};">star</span>`;
                }

                reviewSection = `
                <div class="bg-primary/5 rounded-lg p-2.5 space-y-1.5 mt-2">
                    <div class="flex justify-between items-center text-[10px]">
                        <h5 class="font-bold text-primary">세부 평가</h5>
                        <span class="text-on-surface-variant/60">${meta.reviewDate || ''}</span>
                    </div>
                    <div class="flex gap-0.5">${starsHTML}</div>
                    ${meta.reflection ? `<p class="text-[11px] text-on-surface-variant italic leading-relaxed">"${meta.reflection}"</p>` : ''}
                </div>`;
            }

            const cleanTitle = (t.title || '제목 없음').replace(/^👼\s*/, '').replace(/\s*마감$/, '');

            return `
            <div class="p-3 bg-surface-container-high/40 rounded-lg border border-outline-variant/10 space-y-2 text-left transition-all hover:bg-surface-container-high/60">
                <div class="flex justify-between items-start">
                    <div class="space-y-0.5">
                        <p class="font-semibold text-on-surface text-[12px]">${cleanTitle}</p>
                        <p class="text-[10px] text-primary flex items-center gap-1">
                            <span class="material-symbols-outlined text-[12px]">calendar_today</span>
                            기한: ${t.start || t.end || ''} (${dday || 'D-Day'})
                        </p>
                    </div>
                    ${remainingTimeStr ? `
                    <span class="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-secondary/10 text-secondary text-[9px] font-bold rounded">
                        <span class="material-symbols-outlined text-[10px]">alarm</span>
                        ${remainingTimeStr}
                    </span>` : ''}
                </div>
                
                <div class="space-y-1">
                    <div class="flex justify-between items-center text-[10px]">
                        <span class="text-on-surface-variant">진행률</span>
                        <span class="text-primary font-semibold">${progressPercent}%</span>
                    </div>
                    <div class="h-1.5 w-full bg-surface-container-highest rounded-full overflow-hidden">
                        <div class="h-full bg-primary rounded-full" style="width: ${progressPercent}%"></div>
                    </div>
                </div>

                ${reviewSection}

                <div class="flex gap-2 justify-end pt-1">
                    <button type="button" class="px-2 py-0.5 bg-error/10 text-error hover:bg-error hover:text-on-error rounded text-[10px] font-semibold transition-all" onclick="event.stopPropagation(); window.v2TaskDeleteTrigger('${t.id}');">삭제</button>
                    <button type="button" class="px-2 py-0.5 bg-primary/10 text-primary hover:bg-primary hover:text-on-primary rounded text-[10px] font-semibold transition-all" onclick="event.stopPropagation(); window.v2TaskEditTrigger('${t.id}');">평가/수정</button>
                </div>
            </div>`;
        }).join('<div class="h-2"></div>');

        // Style the parent card with a clear left border when it contains subtasks (is not general)
        const parentBorderClass = isGeneral ? 'border-outline-variant/20' : 'border-l-4 border-l-primary border-y-outline-variant/20 border-r-outline-variant/20';

        return `
        <div class="task-expandable bg-surface-container-low rounded-xl p-4 border ${parentBorderClass} shadow-sm transition-all duration-300 cursor-pointer" data-id="group-${parentTitle.replace(/\s+/g, '')}" aria-expanded="false" onclick="window.v2ToggleTaskAccordion(this, event)">
            <div class="flex items-center justify-between">
                <div class="flex items-center gap-3">
                    <div class="w-10 h-10 rounded-full ${bgClass} flex items-center justify-center">
                        <span class="material-symbols-outlined ${colorClass} text-[20px]">${iconName}</span>
                    </div>
                    <div class="text-left">
                        <span class="font-bold text-on-surface text-sm block">${parentTitle}</span>
                        <span class="text-[10px] text-on-surface-variant">${groupTasks.length}개의 세부 과제</span>
                    </div>
                </div>
                <div class="flex items-center gap-2">
                    ${(() => {
                        let taskId = '';
                        groupTasks.forEach(gt => {
                            const gtId = gt.extendedProps?.taskId || gt.taskId;
                            if (gtId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(gtId)) {
                                taskId = gtId;
                            }
                        });
                        return (!isGeneral && taskId) ? `
                        <button type="button" class="px-2.5 py-1 bg-amber-500 hover:bg-amber-600 text-white rounded text-[10px] font-semibold transition-all mr-2 shadow-sm" onclick="event.stopPropagation(); window.v2RescheduleTaskWithAi('${parentTitle.replace(/'/g, "\\'")}', '${taskId}')">
                            일정 재조정 (AI)
                        </button>
                        ` : '';
                    })()}
                    <span class="text-xs text-primary font-bold">${avgProgress}%</span>
                    <span class="material-symbols-outlined text-on-surface-variant expand-icon transition-transform duration-300">expand_more</span>
                </div>
            </div>
            
            <div class="task-details mt-3 pt-3 border-t border-outline-variant/10 text-left">
                <!-- Group progress bar -->
                <div class="space-y-1 mb-4">
                    <div class="flex justify-between items-center text-[10px]">
                        <span class="text-on-surface-variant">전체 진행도</span>
                        <span class="text-primary font-bold">${avgProgress}%</span>
                    </div>
                    <div class="h-2 w-full bg-surface-container-highest rounded-full overflow-hidden">
                        <div class="h-full bg-primary rounded-full" style="width: ${avgProgress}%"></div>
                    </div>
                </div>
                
                <!-- Subtasks grouped styling -->
                <div class="space-y-2 mt-2 pl-4 border-l border-dashed border-outline-variant/60">
                    ${subtasksHtml}
                </div>
            </div>
        </div>`;
    }).join('');
}

function updateEditorStarsUI(rating) {
    const stars = document.querySelectorAll('#v2-task-rating-container .rating-star-btn');
    stars.forEach(btn => {
        const btnRating = parseInt(btn.dataset.rating, 10);
        const icon = btn.querySelector('.material-symbols-outlined');
        if (icon) {
            if (btnRating <= rating) {
                btn.classList.remove('text-outline-variant');
                btn.classList.add('text-primary');
                icon.style.fontVariationSettings = "'FILL' 1";
            } else {
                btn.classList.remove('text-primary');
                btn.classList.add('text-outline-variant');
                icon.style.fontVariationSettings = "'FILL' 0";
            }
        }
    });
}

export function openTaskEditor(mode, taskData = {}, defaultType = null) {
    const container = document.getElementById('v2-task-editor-container');
    const scrim = document.getElementById('v2-editor-scrim');
    if (!container) return;

    const titleInput = document.getElementById('v2-task-title-input');
    const startInput = document.getElementById('v2-task-start-input');
    const endInput = document.getElementById('v2-task-end-input');
    const descInput = document.getElementById('v2-task-desc-input');

    const progressInput = document.getElementById('v2-task-progress-input');
    const progressVal = document.getElementById('v2-task-progress-val');
    const ratingInput = document.getElementById('v2-task-rating-input');
    const reviewDateInput = document.getElementById('v2-task-review-date-input');
    const reflectionInput = document.getElementById('v2-task-reflection-input');
    const deleteContainer = document.getElementById('v2-task-delete-container');

    // Initialize/register toggle script on window if not yet set
    if (!window.v2ToggleTaskType) {
        window.v2ToggleTaskType = function(type) {
            container.dataset.type = type;
            const eventBtn = document.getElementById('type-event');
            const taskBtn = document.getElementById('type-task');
            const taskFields = document.getElementById('v2-task-only-fields');

            if (type === 'event') {
                if (eventBtn) {
                    eventBtn.className = 'px-6 py-2 rounded-full font-label-md transition-all bg-secondary-container text-on-secondary-container shadow-sm';
                }
                if (taskBtn) {
                    taskBtn.className = 'px-6 py-2 rounded-full font-label-md transition-all text-on-surface-variant';
                }
                if (taskFields) {
                    taskFields.classList.add('hidden');
                }
            } else {
                if (taskBtn) {
                    taskBtn.className = 'px-6 py-2 rounded-full font-label-md transition-all bg-secondary-container text-on-secondary-container shadow-sm';
                }
                if (eventBtn) {
                    eventBtn.className = 'px-6 py-2 rounded-full font-label-md transition-all text-on-surface-variant';
                }
                if (taskFields) {
                    taskFields.classList.remove('hidden');
                }
            }
        };
        window.toggleType = window.v2ToggleTaskType; // HTML inline compatibility
    }

    let resolvedType = defaultType;

    if (mode === 'add') {
        container.dataset.mode = 'add';
        container.dataset.id = '';
        titleInput.value = '';
        
        // Use taskData.start/end if provided (e.g. from calendar grid click)
        const now = new Date();
        const startVal = taskData.start ? new Date(taskData.start) : now;
        const endVal = taskData.end ? new Date(taskData.end) : new Date(startVal.getTime() + 60 * 60 * 1000);
        
        startInput.value = formatLocalISO(startVal);
        endInput.value = formatLocalISO(endVal);
        descInput.value = '';

        if (progressInput) progressInput.value = 0;
        if (progressVal) progressVal.innerText = '0%';
        if (ratingInput) ratingInput.value = 0;
        updateEditorStarsUI(0);
        const todayStr = new Date().toISOString().split('T')[0];
        if (reviewDateInput) reviewDateInput.value = todayStr;
        if (reflectionInput) reflectionInput.value = '';

        if (deleteContainer) deleteContainer.classList.add('hidden');
        
        if (!resolvedType) {
            resolvedType = 'event';
        }
    } else {
        container.dataset.mode = 'edit';
        container.dataset.id = taskData.id || '';
        titleInput.value = taskData.title || '';
        startInput.value = formatLocalISO(new Date(taskData.start));
        endInput.value = formatLocalISO(new Date(taskData.end || taskData.start));
        
        const rawDesc = taskData.description || taskData.extendedProps?.description || '';
        const meta = parseTaskMetadata(rawDesc);
        descInput.value = meta.cleanDescription;

        const calculatedProgress = meta.rating > 0 ? (meta.rating * 20) : 0;
        if (progressInput) progressInput.value = calculatedProgress;
        if (progressVal) progressVal.innerText = `${calculatedProgress}%`;
        if (ratingInput) ratingInput.value = meta.rating;
        updateEditorStarsUI(meta.rating);
        if (reviewDateInput) {
            reviewDateInput.value = meta.reviewDate || new Date().toISOString().split('T')[0];
        }
        if (reflectionInput) reflectionInput.value = meta.reflection;

        if (deleteContainer) deleteContainer.classList.remove('hidden');

        if (!resolvedType) {
            const isTask = taskData.type === 'task' || taskData.extendedProps?.type === 'task' || rawDesc.includes('[Task]');
            resolvedType = isTask ? 'task' : 'event';
        }
    }

    // Toggle to the resolved type (shows/hides task fields and updates toggle UI state)
    window.v2ToggleTaskType(resolvedType);

    scrim?.classList.remove('hidden');
    container.classList.remove('hidden');
    setTimeout(() => {
        scrim?.classList.remove('opacity-0');
        scrim?.classList.add('opacity-100');
        container.style.transform = 'translateY(0)';
    }, 10);
}

export function closeTaskEditor() {
    const container = document.getElementById('v2-task-editor-container');
    const scrim = document.getElementById('v2-editor-scrim');
    if (!container) return;

    container.style.transform = 'translateY(100%)';
    scrim?.classList.remove('opacity-100');
    scrim?.classList.add('opacity-0');
    setTimeout(() => {
        container.classList.add('hidden');
        scrim?.classList.add('hidden');
    }, 400);
}
