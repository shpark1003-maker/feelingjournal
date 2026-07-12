import { store, API_URL, assertIds } from '../state.js';
import { calendarState } from './calendarState.js';
import { escapeHTML } from './sanitize.js';
import { isEventOnDate, getEventLocalDateString } from './dateUtils.js';
import { openDayView, closeDayView, getRemainingTimeStr } from './dayView.js';
import { renderV2TaskList } from './taskList.js';
import { initAiAngel } from './aiAngel.js';

// Re-export for external consumers
export { openDayView, closeDayView };

let initialized = false;
let currentYear = calendarState.currentYear;
let currentMonth = calendarState.currentMonth;
let selectedDateStr = calendarState.selectedDateStr || null;

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

                    if (type === 'task') {
                        const progress = parseInt(document.getElementById('v2-task-progress-input').value, 10) || 0;
                        if (progress <= 50) {
                            const parentTitle = container.dataset.parentTitle || '';
                            const parentTaskId = container.dataset.parentTaskId || '';
                            if (parentTaskId) {
                                setTimeout(() => {
                                    if (confirm(`달성률이 ${progress}%로 50% 이하입니다.\n이 대과제('${parentTitle}')의 남은 일정을 AI 일정 천사와 함께 재조정하시겠습니까?`)) {
                                        window.v2RescheduleTaskWithAi(parentTitle, parentTaskId);
                                    }
                                }, 500);
                            }
                        }
                    }
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
                                loadCalendar(true);
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
                        // 이미 advice는 출력됨
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
        const dayEvents = (calendarState.events || []).filter(ev => isEventOnDate(ev, dateStr));
        
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
                
                const cleanTitle = escapeHTML(ev.title || '제목 없음');
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
                const matchedEvent = (calendarState.events || []).find(ev => ev.id == evId);
                if (matchedEvent && typeof openEventModal === 'function') {
                    openEventModal('edit', matchedEvent);
                }
                return;
            }
            selectedDateStr = dateStr;
            calendarState.selectedDateStr = selectedDateStr;
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

        calendarState.events = data.events || [];
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
            calendarState.selectedDateStr = selectedDateStr;
        }
        openDayView(selectedDateStr);
    } catch (e) {
        console.error(e);
        container.innerHTML = `<div style="grid-column: span 7; text-align: center; padding: 40px; color: #ff4d4d;">캘린더 로드 실패: ${e.message}</div>`;
    }
}

