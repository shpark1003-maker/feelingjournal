import { calendarState } from './calendarState.js';
import { formatLocalISO, getEventLocalDateString, parseDateSafe } from './dateUtils.js';
import { escapeHTML } from './sanitize.js';
import { parseTaskMetadata } from './taskEditor.js';
import { getRemainingTimeStr, getTaskIconInfo } from './dayView.js';

function getDDay(endDateStr) {
    if (!endDateStr) return '';
    const now = new Date();
    const end = parseDateSafe(endDateStr);

    const nowDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endDate = new Date(end.getFullYear(), end.getMonth(), end.getDate());

    const diffTime = endDate.getTime() - nowDate.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'D-Day';
    if (diffDays > 0) return `D-${diffDays}`;
    return `D+${Math.abs(diffDays)}`;
}

export function renderV2TaskList() {
    const listContainer = document.getElementById('v2-task-list');
    if (!listContainer) return;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const tasks = (calendarState.events || []).filter(ev => {
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
        
        // Render subtasks HTML with Show More toggle support and grid support
        const subtasksHtml = groupTasks.map((t, idx) => {
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
            const isHiddenClass = idx >= 3 ? 'v2-subtask-hidden hidden' : '';

            return `
            <div class="p-3 bg-surface-container-high/40 rounded-lg border border-outline-variant/10 space-y-2 text-left transition-all hover:bg-surface-container-high/60 ${isHiddenClass}">
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
        }).join('');

        // Style the parent card with a clear left border when it contains subtasks (is not general)
        const parentBorderClass = isGeneral ? 'border-outline-variant/20' : 'border-l-4 border-l-primary border-y-outline-variant/20 border-r-outline-variant/20';

        // Add Show More button if there are more than 3 subtasks
        const hasMoreBtn = groupTasks.length > 3;
        const showMoreBtnHtml = hasMoreBtn ? `
        <div class="flex justify-center pt-3">
            <button type="button" class="v2-show-more-btn px-4 py-1.5 bg-primary/5 hover:bg-primary/10 text-primary rounded-full text-[11px] font-semibold flex items-center gap-1 transition-all shadow-sm" onclick="event.stopPropagation(); window.v2ToggleSubtasksVisibility(this)">
                <span>세부 과제 더 보기 (+${groupTasks.length - 3})</span>
                <span class="material-symbols-outlined text-[14px]">keyboard_arrow_down</span>
            </button>
        </div>
        ` : '';

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
                        <div class="flex items-center gap-1 mr-2" onclick="event.stopPropagation();">
                            <button type="button" class="px-2 py-1 bg-amber-500 hover:bg-amber-600 text-white rounded text-[10px] font-semibold transition-all shadow-sm" onclick="window.v2RescheduleTaskWithAi('${parentTitle.replace(/'/g, "\\'")}', '${taskId}')">
                                수정
                            </button>
                            <button type="button" class="p-1 hover:bg-error/10 text-error rounded transition-all flex items-center justify-center" onclick="window.v2DeleteEntireTask('${taskId}', '${parentTitle.replace(/'/g, "\\'")}')" title="전체 과제 삭제">
                                <span class="material-symbols-outlined text-[16px]">delete</span>
                            </button>
                        </div>
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
                
                <!-- Subtasks grouped styling (Grid for md and up) -->
                <div class="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2 pl-4 border-l border-dashed border-outline-variant/60">
                    ${subtasksHtml}
                </div>
                ${showMoreBtnHtml}
            </div>
        </div>`;
    }).join('');

    // Global toggle subtasks helper function
    window.v2ToggleSubtasksVisibility = function(btn) {
        const detailsContainer = btn.closest('.task-details');
        const hiddenTasks = detailsContainer.querySelectorAll('.v2-subtask-hidden');
        const isCollapsed = btn.getAttribute('data-expanded') !== 'true';

        hiddenTasks.forEach(t => {
            if (isCollapsed) {
                t.classList.remove('hidden');
            } else {
                t.classList.add('hidden');
            }
        });

        const spanText = btn.querySelector('span:first-child');
        const iconSpan = btn.querySelector('.material-symbols-outlined');

        if (isCollapsed) {
            btn.setAttribute('data-expanded', 'true');
            spanText.textContent = '세부 과제 접기';
            iconSpan.textContent = 'keyboard_arrow_up';
        } else {
            btn.setAttribute('data-expanded', 'false');
            spanText.textContent = `세부 과제 더 보기 (+${hiddenTasks.length})`;
            iconSpan.textContent = 'keyboard_arrow_down';
        }
    };
}

