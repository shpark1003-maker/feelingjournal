import { store, API_URL } from './state.js?v=5.2.0';

let initialized = false;
let currentYear = new Date().getFullYear();
let currentMonth = new Date().getMonth(); // 0-indexed
let calendarEvents = [];

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
                const providerToken = await store.getProviderToken();

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
                        'Authorization': `Bearer ${token}`,
                        'x-provider-token': providerToken || ''
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
                const providerToken = await store.getProviderToken();

                // 구글 캘린더 삭제 API 호출
                const res = await fetch(`${API_URL}/calendar/events/${id}`, {
                    method: 'DELETE',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'x-provider-token': providerToken || ''
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
}

export async function loadCalendar(forceRefresh = false) {
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
        const providerToken = await store.getProviderToken();

        const res = await fetch(`${API_URL}/calendar${forceRefresh ? '?refresh=true' : ''}`, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'x-provider-token': providerToken || ''
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
                        const response = await fetch(`${API_URL}/auth/unlink-google`, {
                            method: 'POST',
                            headers: {
                                'Authorization': `Bearer ${session?.access_token}`
                            }
                        });
                        const resData = await response.json();
                        if (!resData.success) throw new Error(resData.error || '연동 해제 실패');

                        const { error } = await store.supabaseClient.auth.linkIdentity({
                            provider: 'google',
                            options: {
                                redirectTo: window.location.href.split('?')[0],
                                scopes: 'https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/contacts.readonly',
                                queryParams: {
                                    access_type: 'offline',
                                    prompt: 'consent',
                                }
                            }
                        });
                        if (error) throw error;
                    } catch (err) {
                        alert('연동 실패: ' + err.message);
                        linkBtn.disabled = false;
                        linkBtn.innerHTML = '구글 계정 연동';
                    }
                });
                
                const cardContainer = document.getElementById('calendar-container');
                cardContainer.parentNode.insertBefore(banner, cardContainer);
            }
        } else {
            if (banner) banner.remove();
        }

        renderCustomGrid();
    } catch (e) {
        console.error(e);
        container.innerHTML = `<div style="grid-column: span 7; text-align: center; padding: 40px; color: #ff4d4d;">캘린더 로드 실패: ${e.message}</div>`;
    }
}

function renderCustomGrid() {
    const grid = document.getElementById('calendar-days-grid');
    const monthYearText = document.getElementById('calendar-month-year-text');
    if (!grid || !monthYearText) return;

    // 월 이름 업데이트
    monthYearText.innerText = `${getMonthName(currentMonth)} ${currentYear}`;

    grid.innerHTML = '';

    // 이번 달 1일 정보 및 전체 일수 계산
    const firstDayDate = new Date(currentYear, currentMonth, 1);
    const startDayOfWeek = firstDayDate.getDay(); // 0: 일요일, 6: 토요일
    const lastDayDate = new Date(currentYear, currentMonth + 1, 0);
    const totalDays = lastDayDate.getDate();

    // 지난 달의 마지막 날 정보
    const prevMonthLastDate = new Date(currentYear, currentMonth, 0).getDate();

    // 1. 지난 달 날짜 칸 렌더링 (그리드 시작을 일요일에 정렬)
    for (let i = startDayOfWeek - 1; i >= 0; i--) {
        const prevDayNum = prevMonthLastDate - i;
        const cell = document.createElement('div');
        cell.className = 'border border-[#5D574D]/10 p-2 h-32 flex flex-col hover:bg-[#FDFCF0]/50 transition-colors cursor-pointer opacity-40 rounded-lg m-[2px]';
        cell.innerHTML = `<span class="text-sm font-medium mb-1 text-[#8D775F]">${prevDayNum}</span>`;
        
        // 날짜 클릭 시 이전 달 뷰로 이동 또는 이전 달 날짜에 대한 조회
        const dateStr = `${currentMonth === 0 ? currentYear - 1 : currentYear}-${String(currentMonth === 0 ? 12 : currentMonth).padStart(2, '0')}-${String(prevDayNum).padStart(2, '0')}`;
        cell.addEventListener('click', () => openDayView(dateStr));
        grid.appendChild(cell);
    }

    // 2. 이번 달 날짜 칸 렌더링
    for (let day = 1; day <= totalDays; day++) {
        const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const cellDate = new Date(currentYear, currentMonth, day);
        
        const cell = document.createElement('div');
        cell.className = 'border border-[#5D574D]/30 p-2 h-32 flex flex-col hover:bg-[#FDFCF0] transition-colors cursor-pointer bg-white/60 shadow-[0_4px_12px_-5px_rgba(184,166,142,0.2)] rounded-lg m-[2px]';
        
        // 오늘 날짜 하이라이팅
        const today = new Date();
        const isToday = today.getFullYear() === currentYear && today.getMonth() === currentMonth && today.getDate() === day;
        let dayClass = 'text-sm font-bold mb-1 text-[#4A6741]';
        if (isToday) {
            dayClass += ' text-primary bg-primary/10 px-2 py-0.5 rounded-full w-fit';
        }
        
        // 상단 날짜 숫자 및 클라우드 아이콘(일정에 비서 조언이 있는 경우) 표시
        let dayHeaderHTML = `<div class="flex justify-between items-start"><span class="${dayClass}">${day}</span>`;
        
        // 해당 날짜의 일정들 매핑
        const dayEvents = calendarEvents.filter(ev => {
            const evStart = new Date(ev.start);
            return evStart.getFullYear() === currentYear && evStart.getMonth() === currentMonth && evStart.getDate() === day;
        });

        // 조언이 담긴 AI 일정이 있는지 검사해 마스코트 아이콘 노출
        const hasAdvice = dayEvents.some(ev => ev.extendedProps?.advice || ev.advice);
        if (hasAdvice) {
            dayHeaderHTML += `<img alt="Cloud Spirit" class="w-6 h-6 object-contain opacity-70 floating-cloud" src="mascot.png" style="width: 24px; height: 24px;"/>`;
        }
        dayHeaderHTML += `</div>`;
        
        let eventsHTML = '<div class="flex-1 overflow-y-auto space-y-1 mt-1 no-scrollbar">';
        // 칩 카드 형태로 최대 3개까지 노출
        const isPastDay = cellDate < new Date(new Date().setHours(0,0,0,0));
        dayEvents.slice(0, 3).forEach(ev => {
            const type = ev.extendedProps?.type || ev.type || 'personal';
            let chipStyle = '';
            
            if (type === 'task') {
                chipStyle = 'bg-[#A2C4E1] text-[#2d3436] border-[#8D775F] shadow-sm font-bold';
            } else if (type === 'shared') {
                chipStyle = 'bg-[#e8f0e0] text-[#6b4c2a] border-[#d4a373] shadow-sm font-bold';
            } else {
                chipStyle = 'bg-[#7a9e7e] text-white border-[#4A6741] shadow-sm font-bold';
            }

            if (isPastDay) {
                chipStyle += ' opacity-50 line-through';
            }

            const title = ev.title || '제목 없음';
            eventsHTML += `<div class="px-1.5 py-0.5 mb-1 rounded-lg text-[clamp(9px,1.5vw+4px,11.5px)] border truncate transition hover:brightness-95 ${chipStyle}">${title}</div>`;
        });
        eventsHTML += '</div>';

        cell.innerHTML = dayHeaderHTML + eventsHTML;
        cell.addEventListener('click', () => openDayView(dateStr));
        grid.appendChild(cell);
    }

    // 3. 다음 달 날짜 칸 렌더링 (그리드 남은 칸 채우기, 총 42칸 기준)
    const totalRendered = startDayOfWeek + totalDays;
    const remaining = (totalRendered % 7 === 0) ? 0 : 7 - (totalRendered % 7);
    for (let i = 1; i <= remaining; i++) {
        const cell = document.createElement('div');
        cell.className = 'border border-[#5D574D]/10 p-2 h-32 flex flex-col hover:bg-[#FDFCF0]/50 transition-colors cursor-pointer opacity-40 rounded-lg m-[2px]';
        cell.innerHTML = `<span class="text-sm font-medium mb-1 text-[#8D775F]">${i}</span>`;
        
        const dateStr = `${currentMonth === 11 ? currentYear + 1 : currentYear}-${String(currentMonth === 11 ? 1 : currentMonth + 2).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
        cell.addEventListener('click', () => openDayView(dateStr));
        grid.appendChild(cell);
    }
}

export function openDayView(dateStr) {
    const container = document.getElementById('dayViewContainer');
    const card = document.getElementById('dayViewCard');
    if (!container || !card) return;

    const baseDate = new Date(dateStr);
    const dayName = getDayName(baseDate.getDay());
    const dateText = `${getMonthName(baseDate.getMonth())} ${baseDate.getDate()}, ${baseDate.getFullYear()}`;

    // 상세 카드 헤더 데이터 반영
    document.getElementById('day-view-day-name').innerText = dayName;
    document.getElementById('day-view-date-text').innerText = dateText;

    // '일정 등록' 버튼에 타겟 날짜 문자열 주입
    const addBtn = document.getElementById('day-view-add-btn');
    if (addBtn) addBtn.dataset.date = dateStr;

    // 해당 날짜 일정 필터링
    const dayEvents = calendarEvents.filter(ev => {
        const evStart = new Date(ev.start);
        return evStart.getFullYear() === baseDate.getFullYear() && 
               evStart.getMonth() === baseDate.getMonth() && 
               evStart.getDate() === baseDate.getDate();
    });

    const eventsList = document.getElementById('day-view-events-list');
    eventsList.innerHTML = '';

    if (dayEvents.length === 0) {
        eventsList.innerHTML = `<div style="text-align: center; padding: 20px; color: #8c7e6d; font-style: italic;">이 날에는 일정이 없습니다.</div>`;
    } else {
        dayEvents.forEach(ev => {
            const type = ev.extendedProps?.type || ev.type || 'personal';
            let categoryClass = 'bg-primary';
            let cardBg = 'bg-primary/10 border-primary/20';

            if (type === 'task') {
                categoryClass = 'bg-tertiary';
                cardBg = 'bg-tertiary/10 border-tertiary/20';
            } else if (type === 'shared') {
                categoryClass = 'bg-secondary';
                cardBg = 'bg-secondary/10 border-secondary/20';
            }

            const evId = ev.id || '';
            const evTitle = ev.title || '제목 없음';
            const timeStr = new Date(ev.start).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });

            const item = document.createElement('div');
            item.className = `flex items-center gap-4 p-5 rounded-[1.5rem] border-2 ${cardBg} cursor-pointer hover:opacity-90 transition-opacity`;
            item.innerHTML = `
                <div class="w-4 h-4 rounded-full ${categoryClass}" style="width:16px; height:16px; border-radius:50%;"></div>
                <div style="flex:1; text-align:left;">
                    <h4 class="text-xl font-bold text-on-surface" style="margin:0; font-size: clamp(14px, 3vw + 8px, 20px);">${evTitle}</h4>
                    <p class="text-on-surface-variant" style="margin:2px 0 0 0; font-size: clamp(11px, 2vw + 6px, 14px);">${timeStr} • ${type.toUpperCase()}</p>
                </div>
                <button class="p-2 text-on-surface-variant hover:text-primary edit-event-btn" style="background:none; border:none; cursor:pointer;" data-id="${evId}">
                    <span class="material-symbols-outlined text-2xl">edit</span>
                </button>
            `;
            
            // 일정 카드 클릭 시 상세보기/수정 모달 띄우기
            item.querySelector('.edit-event-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                openEventModal('edit', ev);
            });
            item.addEventListener('click', () => {
                openEventModal('edit', ev);
            });
            eventsList.appendChild(item);
        });
    }

    // AI Insight 조언 카드 렌더링
    const adviceCard = document.getElementById('day-view-advice-card');
    const adviceText = document.getElementById('day-view-advice-text');
    const evWithAdvice = dayEvents.find(ev => ev.extendedProps?.advice || ev.advice);

    if (evWithAdvice) {
        const advice = evWithAdvice.extendedProps?.advice || evWithAdvice.advice;
        adviceText.innerText = `"${advice}"`;
        adviceCard.style.display = 'block';
    } else {
        adviceCard.style.display = 'none';
    }

    // 슬라이더 상승 애니메이션 실행
    container.classList.remove('hidden');
    container.classList.add('flex');
    setTimeout(() => {
        card.classList.remove('translate-y-full');
        card.classList.add('translate-y-0');
    }, 10);
    document.body.style.overflow = 'hidden';
}

export function closeDayView() {
    const container = document.getElementById('dayViewContainer');
    const card = document.getElementById('dayViewCard');
    if (!container || !card) return;

    card.classList.remove('translate-y-0');
    card.classList.add('translate-y-full');
    setTimeout(() => {
        container.classList.add('hidden');
        container.classList.remove('flex');
        document.body.style.overflow = 'auto';
    }, 500);
}

function openEventModal(mode, eventData) {
    const modal = document.getElementById('calendar-event-modal');
    if (!modal) return;

    const isReadOnly = eventData.extendedProps?.type === 'task' || eventData.extendedProps?.type === 'shared' || eventData.type === 'task' || eventData.type === 'shared';

    document.getElementById('calendar-modal-title').innerText = mode === 'add' ? '📌 일정 추가' : '📌 일정 상세';
    document.getElementById('calendar-event-id').value = eventData.id || '';
    document.getElementById('calendar-event-summary').value = eventData.title || '';
    document.getElementById('calendar-event-summary').disabled = isReadOnly;

    // ISO 문자열 날짜를 datetime-local 포맷에 맞춰 슬라이싱
    const startISO = formatLocalISO(new Date(eventData.start));
    const endISO = formatLocalISO(new Date(eventData.end || eventData.start));

    document.getElementById('calendar-event-start').value = startISO;
    document.getElementById('calendar-event-start').disabled = isReadOnly;

    document.getElementById('calendar-event-end').value = endISO;
    document.getElementById('calendar-event-end').disabled = isReadOnly;

    document.getElementById('calendar-event-desc').value = eventData.extendedProps?.description || eventData.description || '';
    document.getElementById('calendar-event-desc').disabled = isReadOnly;

    const advice = eventData.extendedProps?.advice || eventData.advice;
    const adviceGroup = document.getElementById('calendar-event-advice-group');
    const adviceText = document.getElementById('calendar-event-advice-text');

    if (advice) {
        adviceText.innerText = advice;
        adviceGroup.style.display = 'flex';
    } else {
        adviceGroup.style.display = 'none';
    }

    const deleteBtn = document.getElementById('delete-calendar-event-btn');
    const saveBtn = document.getElementById('save-calendar-event-btn');

    if (isReadOnly) {
        if (deleteBtn) deleteBtn.style.display = 'none';
        if (saveBtn) saveBtn.style.display = 'none';
    } else {
        if (deleteBtn) deleteBtn.style.display = mode === 'edit' ? 'block' : 'none';
        if (saveBtn) saveBtn.style.display = 'block';
    }

    modal.style.display = 'flex';
}
