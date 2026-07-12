import { formatLocalISO } from './dateUtils.js';

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

