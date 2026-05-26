import { store, API_URL } from './state.js';

let fullCalendar = null;
let initialized = false;

function formatLocalISO(date) {
    if (!date) return '';
    const tzOffset = date.getTimezoneOffset() * 60000;
    return (new Date(date - tzOffset)).toISOString().slice(0, 16);
}

function initCalendarModal() {
    if (initialized) return;
    initialized = true;

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
            const summary = document.getElementById('calendar-event-summary').value;
            const startTime = document.getElementById('calendar-event-start').value;
            const endTime = document.getElementById('calendar-event-end').value;
            const description = document.getElementById('calendar-event-desc').value;

            try {
                const token = await store.getSessionToken();
                const providerToken = await store.getProviderToken();

                const res = await fetch(`${API_URL}/calendar`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`,
                        'x-provider-token': providerToken || ''
                    },
                    body: JSON.stringify({
                        summary,
                        startTime,
                        endTime,
                        description
                    })
                });

                const data = await res.json();
                if (data.success) {
                    alert('일정이 구글 캘린더에 성공적으로 저장되었습니다.');
                    modal.style.display = 'none';
                    loadCalendar();
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

                const res = await fetch(`${API_URL}/calendar?id=${encodeURIComponent(id)}`, {
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
                    loadCalendar();
                } else {
                    alert('일정 삭제 실패: ' + data.error);
                }
            } catch (err) {
                console.error(err);
                alert('서버 통신 오류');
            }
        });
    }
}

export async function loadCalendar() {
    initCalendarModal();
    const container = document.getElementById('calendar-container');
    if (!container) return;

    container.innerHTML = '<div class="loading-full">일정을 불러오는 중...</div>';

    try {
        const token = await store.getSessionToken();
        const providerToken = await store.getProviderToken();

        // res API 호출을 먼저 단행하여 백엔드 unlinked 정보를 받아옴
        const res = await fetch(`${API_URL}/calendar`, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'x-provider-token': providerToken || ''
            }
        });

        const data = await res.json();
        if (!data.success) throw new Error(data.error);

        const isUnlinked = data.unlinked || !providerToken || providerToken === 'mock' || providerToken === 'null' || providerToken === 'undefined';

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
                    <a href="/api/auth/google" style="
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
                        text-decoration: none;
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
                    </a>
                `;
                container.parentNode.insertBefore(banner, container);
            }
        } else {
            if (banner) banner.remove();
        }

        if (fullCalendar) fullCalendar.destroy();
        container.innerHTML = '';

        fullCalendar = new FullCalendar.Calendar(container, {
            initialView: 'dayGridMonth',
            locale: 'ko',
            height: 'auto',
            selectable: true,
            eventDisplay: 'block',
            headerToolbar: {
                left: 'prev,next today',
                center: 'title',
                right: 'dayGridMonth,timeGridWeek,listMonth'
            },
            events: data.events,
            select: (info) => {
                const modal = document.getElementById('calendar-event-modal');
                document.getElementById('calendar-modal-title').innerText = '📌 일정 추가';
                document.getElementById('calendar-event-id').value = '';
                document.getElementById('calendar-event-summary').value = '';
                document.getElementById('calendar-event-summary').disabled = false;
                
                // Set starts and ends
                document.getElementById('calendar-event-start').value = formatLocalISO(info.start);
                document.getElementById('calendar-event-start').disabled = false;
                
                let endDate = info.end;
                if (info.allDay) {
                    endDate = new Date(info.start.getTime() + 60 * 60 * 1000); // default +1 hour
                }
                document.getElementById('calendar-event-end').value = formatLocalISO(endDate);
                document.getElementById('calendar-event-end').disabled = false;

                document.getElementById('calendar-event-desc').value = '';
                document.getElementById('calendar-event-desc').disabled = false;

                document.getElementById('calendar-event-advice-group').style.display = 'none';
                document.getElementById('delete-calendar-event-btn').style.display = 'none';
                document.getElementById('save-calendar-event-btn').style.display = 'block';

                modal.style.display = 'flex';
                fullCalendar.unselect();
            },
            eventClick: (info) => {
                const modal = document.getElementById('calendar-event-modal');
                const type = info.event.extendedProps.type;
                const isReadOnly = type === 'task' || type === 'shared';

                let modalTitle = '📌 일정 상세';
                if (type === 'task') modalTitle = '📝 일기 분석 약속';
                else if (type === 'shared') modalTitle = '👥 공유된 약속 일정';

                document.getElementById('calendar-modal-title').innerText = modalTitle;
                document.getElementById('calendar-event-id').value = info.event.id || '';
                document.getElementById('calendar-event-summary').value = info.event.title || '';
                document.getElementById('calendar-event-summary').disabled = isReadOnly;

                document.getElementById('calendar-event-start').value = formatLocalISO(info.event.start);
                document.getElementById('calendar-event-start').disabled = isReadOnly;

                document.getElementById('calendar-event-end').value = formatLocalISO(info.event.end || info.event.start);
                document.getElementById('calendar-event-end').disabled = isReadOnly;

                document.getElementById('calendar-event-desc').value = info.event.extendedProps.description || '';
                document.getElementById('calendar-event-desc').disabled = isReadOnly;

                const advice = info.event.extendedProps.advice;
                if (advice) {
                    document.getElementById('calendar-event-advice-group').style.display = 'block';
                    document.getElementById('calendar-event-advice-text').innerText = advice;
                } else {
                    document.getElementById('calendar-event-advice-group').style.display = 'none';
                }

                if (isReadOnly) {
                    document.getElementById('delete-calendar-event-btn').style.display = 'none';
                    document.getElementById('save-calendar-event-btn').style.display = 'none';
                } else {
                    document.getElementById('delete-calendar-event-btn').style.display = 'block';
                    document.getElementById('save-calendar-event-btn').style.display = 'block';
                }

                modal.style.display = 'flex';
            },
            eventDidMount: (info) => {
                const type = info.event.extendedProps.type;
                if (type === 'task') {
                    info.el.classList.add('event-task');
                } else if (type === 'shared') {
                    info.el.classList.add('event-shared');
                } else {
                    info.el.classList.add('event-personal');
                }

                const eventEnd = info.event.end || info.event.start;
                if (eventEnd && new Date(eventEnd) < new Date()) {
                    info.el.style.opacity = '0.70'; // 지난 일정은 가시성을 위해 0.70으로 조정
                    info.el.style.filter = 'grayscale(15%)'; // 세련된 은은한 그레이스케일
                }

                const title = info.event.title || '제목 없음';
                const desc = info.event.extendedProps.description || '';
                const advice = info.event.extendedProps.advice || '';
                
                let tooltipContent = `<div style="text-align:left; padding:6px; max-width:260px; font-family:'Outfit', 'Nanum', sans-serif;">`;
                tooltipContent += `<strong style="font-size:0.95rem; color:#fff; display:block; margin-bottom:4px;">📌 ${title}</strong>`;
                if (desc) {
                    tooltipContent += `<hr style="border:none; border-top:1px solid rgba(255,255,255,0.15); margin:6px 0;">`;
                    tooltipContent += `<div style="font-size:0.82rem; color:#dfe4ea; white-space:pre-wrap; line-height:1.4;">${desc}</div>`;
                }
                if (advice) {
                    tooltipContent += `<hr style="border:none; border-top:1px solid rgba(255,255,255,0.15); margin:6px 0;">`;
                    tooltipContent += `<div style="font-size:0.82rem; color:#ffeaa7; font-weight:600; line-height:1.4;">💡 비서: ${advice}</div>`;
                }
                tooltipContent += `</div>`;
                
                tippy(info.el, {
                    content: tooltipContent,
                    allowHTML: true,
                    placement: 'top',
                    interactive: true,
                    theme: 'translucent'
                });
            }
        });

        fullCalendar.render();
    } catch (e) {
        console.error(e);
        container.innerHTML = `<div class="error">캘린더 로드 실패: ${e.message}</div>`;
    }
}
