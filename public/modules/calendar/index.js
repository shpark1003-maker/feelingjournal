import { store, API_URL } from '../state.js';
import { calendarState } from './calendarState.js';
import { loadCalendar } from './calendarGrid.js';
import { openTaskEditor } from './taskEditor.js';
import { initAiAngel } from './aiAngel.js';

// Global exports for inline HTML handlers
window.v2TaskEditTrigger = function(id) {
    const task = calendarState.events.find(t => t.id === id);
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
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        if (data.success) {
            alert('과제가 성공적으로 삭제되었습니다.');
            loadCalendar(true);
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
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        if (data.success) {
            alert('과제가 성공적으로 삭제되었습니다.');
            loadCalendar(true);
        } else {
            alert('과제 삭제에 실패했습니다: ' + (data.error || '알 수 없는 오류'));
        }
    } catch (err) {
        console.error('Task Delete Error:', err);
        alert('과제 삭제 중 오류가 발생했습니다.');
    }
};

window.v2ToggleTaskAccordion = function(el, event) {
    if (event && (event.target.closest('.edit-task-btn') || event.target.closest('.task-details'))) {
        return;
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
        if (isCollapsed) t.classList.remove('hidden');
        else t.classList.add('hidden');
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

// Initialize App
export function init() {
    initAiAngel(loadCalendar);
}
