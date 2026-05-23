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

        const res = await fetch(`${API_URL}/calendar`, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'x-provider-token': providerToken || ''
            }
        });

        const data = await res.json();
        if (!data.success) throw new Error(data.error);

        if (fullCalendar) fullCalendar.destroy();

        fullCalendar = new FullCalendar.Calendar(container, {
            initialView: 'dayGridMonth',
            locale: 'ko',
            height: 'auto',
            selectable: true,
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
                const eventEnd = info.event.end || info.event.start;
                if (eventEnd && new Date(eventEnd) < new Date()) {
                    info.el.style.opacity = '0.45'; // 지난 일정은 글자색과 투명도 반감
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
