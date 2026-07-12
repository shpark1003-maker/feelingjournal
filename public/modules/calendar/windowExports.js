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

window.v2DeleteEntireTask = async function(taskId, parentTitle) {
    if (!confirm(`'${parentTitle}' 과제와 이에 포함된 모든 세부 일정을 정말로 삭제하시겠습니까?`)) return;
    try {
        const token = await store.getSessionToken();
        const response = await fetch(`${API_URL}/calendar/tasks/${taskId}`, {
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
        container.dataset.parentTitle = taskData.parentTitle || taskData.extendedProps?.parentTitle || '';
        container.dataset.parentTaskId = taskData.taskId || taskData.extendedProps?.taskId || '';
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
};

