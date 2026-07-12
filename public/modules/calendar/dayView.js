import { calendarState } from './calendarState.js';
import { getEventLocalDateString, formatLocalISO, parseDateSafe, isEventOnDate } from './dateUtils.js';
import { escapeHTML } from './sanitize.js';
import { openTaskEditor, parseTaskMetadata } from './taskEditor.js';

function getDayName(dayIndex) {
    const days = ['일', '월', '화', '수', '목', '금', '토']; // Or English if preferred, but Korean matches dateText
    return days[dayIndex];
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

export function getRemainingTimeStr(endDateStr) {
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

export function getTaskIconInfo(title) {
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
    const dayEvents = (calendarState.events || []).filter(ev => {
        return isEventOnDate(ev, dateStr);
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
        const evTitle = escapeHTML(ev.title || '제목 없음');
        
        const startTime = new Date(ev.start);
        let timeStr = startTime.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });

        const cleanDesc = escapeHTML(desc.replace(/\[Task\]/g, '')
                              .replace(/\[Progress:\s*\d+\]/g, '')
                              .replace(/\[Rating:\s*\d+\]/g, '')
                              .replace(/\[ReviewDate:\s*[^\]]+\]/g, '')
                              .replace(/\[Reflection:\s*[^\]]+\]/g, '')
                              .trim());

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

